import { useState } from 'react';
import { MONAD_CHAIN, publicClient } from '@/utils/config';
import { Account, encodeFunctionData, parseEther, type Address, type Hex } from 'viem';
import { maxUint256, isAddress } from 'viem';
import shmonadAbi from '@/abis/shmonad.json';
import { WalletManagerState } from './useWalletManager';
import { ShBundler } from '@/utils/bundler';
import { logger } from '../utils/logger';
import { generateSelfSponsoredPaymasterAndData } from '@/utils/paymasterClients';
import { UserOperation } from 'viem/account-abstraction';

// Helper function to serialize BigInt values for logging
function serializeBigInt(obj: any): any {
  return JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value));
}

// State for all transaction-related statuses and hashes
type TransactionState = {
  txHash: string;
  txStatus: string;
  sponsoredTxHash: string;
  sponsoredTxStatus: string;
  selfSponsoredTxHash: string;
  selfSponsoredTxStatus: string;
};

// Type for transaction result
type TransactionResult = {
  userOpHash: string;
  transactionHash: string;
};

// Combined type for the hook's return value
type TransactionsHookReturn = TransactionState & {
  // Transaction functions
  sendTransaction: (recipient: string, amount: string) => Promise<string | null>;
  sendSponsoredTransaction: (to: string, amount: string) => Promise<TransactionResult | null>;
  sendSelfSponsoredTransaction: (
    recipient: string,
    amount: string
  ) => Promise<TransactionResult | null | undefined>;
  bondMonToShmon: (amount?: string) => Promise<any>;
  setTxStatus: (status: string) => void;
};

// Helper function for consistent error handling
function handleTransactionError(error: any, setStatusFn: (status: string) => void) {
  logger.error('Transaction error', error);

  const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
  setStatusFn(`Error: ${errorMessage}`);

  // Specific error handling for AA errors
  if (errorMessage.includes('AA') && errorMessage.includes('Execution reverted')) {
    const aaErrorPattern = /(AA\d+: [\w\s]+)/;
    const match = errorMessage.match(aaErrorPattern);

    if (match && match[1]) {
      setStatusFn(`Error: ${match[1]}`);
    }
  }
}

// Hook for managing all transaction operations
export function useTransactions(walletManager: WalletManagerState): TransactionsHookReturn {
  const {
    smartAccount,
    bundler,
    bundlerWithPaymaster,
    bundlerWithoutPaymaster,
    smartAccountClient,
    walletClient,
    contractAddresses,
    embeddedWallet,
  } = walletManager;

  // Transaction status states
  const [txHash, setTxHash] = useState<string>('');
  const [txStatus, setTxStatus] = useState<string>('');

  // Sponsored transaction states
  const [sponsoredTxHash, setSponsoredTxHash] = useState<string>('');
  const [sponsoredTxStatus, setSponsoredTxStatus] = useState<string>('');

  // Self-sponsored transaction states
  const [selfSponsoredTxHash, setSelfSponsoredTxHash] = useState<string>('');
  const [selfSponsoredTxStatus, setSelfSponsoredTxStatus] = useState<string>('');

  // Regular transaction - updated to use Smart Account Client
  async function sendTransaction(recipient: string, amount: string): Promise<string | null> {
    if (!walletClient) {
      setTxStatus('Wallet client not initialized');
      return null;
    }

    try {
      setTxStatus('Preparing transaction...');

      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);

      // Create recipient address - if not valid, send to self
      const to =
        recipient && recipient.startsWith('0x') && recipient.length === 42
          ? (recipient as Address)
          : walletClient.account?.address;

      // Only use the smartAccountClient approach - no bundler or paymaster
      if (walletClient) {
        setTxStatus('Using smart account client for transaction...');
        console.log('💰 Using smart account client directly for NON-SPONSORED transaction');

        // Use the smart account client for the transaction
        const hash = await walletClient.sendTransaction({
          to: to,
          value: parsedAmount,
          data: '0x' as Hex,
          account: walletClient.account as Account,
          chain: MONAD_CHAIN,
        });

        setTxHash(hash);
        setTxStatus('Waiting for transaction confirmation...');

        // Wait for the transaction receipt
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: hash,
        });

        setTxStatus(`Transaction confirmed! Transaction hash: ${receipt.transactionHash}`);
        return receipt.transactionHash;
      } else {
        throw new Error('Smart account client not available to send the transaction');
      }
    } catch (error) {
      handleTransactionError(error, setTxStatus);
      return null;
    }
  }

  // Send a transaction sponsored by the paymaster
  const sendSponsoredTransaction = async (to: string, amount: string) => {
    try {
      logger.info('Starting sponsored transaction flow');
      logger.debug('Recipient address received', to);
      setSponsoredTxStatus('Preparing transaction...');

      // Validate inputs
      if (!smartAccount || !bundlerWithPaymaster) {
        logger.error('Smart account or bundler with paymaster not initialized');
        setSponsoredTxStatus('Smart account or bundler with paymaster not initialized');
        return null;
      }

      // Default gas limit values from demo script
      const paymasterVerificationGasLimit = 75000n;
      const paymasterPostOpGasLimit = 120000n;

      // Check if recipient address is valid - if not, use smart account address as fallback
      let targetAddress: Address;
      if (to && isAddress(to)) {
        targetAddress = to as Address;
        logger.debug('Using provided recipient address', targetAddress);
      } else {
        targetAddress = smartAccount.address;
        logger.warn(
          'Invalid or empty recipient address, using smart account address as fallback',
          targetAddress
        );
      }

      // Convert amount from ETH to wei
      let amountWei: bigint;
      try {
        amountWei = parseEther(amount);
        logger.debug('Amount in wei', amountWei.toString());
      } catch (error) {
        logger.error('Invalid amount', amount);
        setSponsoredTxStatus('Invalid amount');
        return null;
      }

      // Get gas prices from the bundler
      logger.info('Getting gas prices...');
      setSponsoredTxStatus('Getting gas prices...');

      const gasPrice = await bundlerWithPaymaster.getUserOperationGasPrice();
      logger.gasPrice('Gas prices received', gasPrice);

      try {
        // STEP 1: Prepare the user operation
        logger.info('Preparing and signing user operation...');
        setSponsoredTxStatus('Preparing and signing user operation...');

        // First create the user operation but don't send it
        const userOperation = await bundlerWithPaymaster.prepareUserOperation({
          account: smartAccount,
          calls: [
            {
              to: targetAddress,
              value: amountWei,
              data: '0x' as Hex,
            },
          ],
          maxFeePerGas: gasPrice.standard.maxFeePerGas,
          maxPriorityFeePerGas: gasPrice.standard.maxPriorityFeePerGas,
          paymasterVerificationGasLimit,
          paymasterPostOpGasLimit,
          // Add explicit gas limits to ensure they're not set to zero
          callGasLimit: 100000n, // Explicit reasonable default
          verificationGasLimit: 300000n, // Explicit reasonable default
          preVerificationGas: 210000n, // Explicit reasonable default
        });

        // Simplified logging - just essentials
        logger.info('User operation prepared successfully');

        // STEP 2: Explicitly sign the user operation
        logger.info('Signing the user operation...');
        const signature = await smartAccount.signUserOperation(userOperation);

        // Update the signature in the user operation
        userOperation.signature = signature;
        logger.debug('User operation signed with signature', {
          signatureStart: signature.substring(0, 10) + '...',
          signatureLength: signature.length,
        });

        // Create a plain object copy instead of using structuredClone which can't handle functions
        // This ensures we only include serializable properties
        const finalUserOp = {
          sender: userOperation.sender,
          nonce: userOperation.nonce,
          callGasLimit: userOperation.callGasLimit || 100000n,
          verificationGasLimit: userOperation.verificationGasLimit || 300000n,
          preVerificationGas: userOperation.preVerificationGas || 210000n,
          maxFeePerGas: userOperation.maxFeePerGas,
          maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas,
          signature: userOperation.signature,
          callData: userOperation.callData,
          paymasterVerificationGasLimit: userOperation.paymasterVerificationGasLimit,
          paymasterPostOpGasLimit: userOperation.paymasterPostOpGasLimit,
          // Include EntryPoint version specific fields
          ...('paymaster' in userOperation && userOperation.paymaster
            ? { paymaster: userOperation.paymaster }
            : {}),
          ...('paymasterData' in userOperation && userOperation.paymasterData
            ? { paymasterData: userOperation.paymasterData }
            : {}),
          ...('paymasterAndData' in userOperation && userOperation.paymasterAndData
            ? { paymasterAndData: userOperation.paymasterAndData }
            : {}),
        };

        // STEP 3: Send the signed user operation
        logger.info('Submitting signed user operation...');
        setSponsoredTxStatus('Submitting signed transaction...');

        // We must create a new sendUserOperation call with the account parameter
        // This is required by the API - the account is used for type checking and validation
        // but not for signing (since we already signed the operation)
        // Cast to any first to handle type conversion safely
        const userOpHash = await bundlerWithPaymaster.sendUserOperation(finalUserOp as any);

        logger.info('Sponsored transaction submitted with hash', userOpHash);
        setSponsoredTxHash(userOpHash);
        setSponsoredTxStatus('Transaction submitted, waiting for confirmation...');

        // Wait for receipt
        const receipt = await bundlerWithPaymaster.waitForUserOperationReceipt({
          hash: userOpHash,
        });
        logger.info('Sponsored transaction confirmed! Hash', receipt.receipt.transactionHash);

        // Update status with transaction hash
        setSponsoredTxStatus(
          `Sponsored transaction confirmed! Transaction hash: ${receipt.receipt.transactionHash}`
        );

        return {
          userOpHash: userOpHash,
          transactionHash: receipt.receipt.transactionHash,
        };
      } catch (error) {
        logger.error('Sponsored transaction failed', error);

        let errorMessage = 'Transaction failed';
        if (error instanceof Error) {
          errorMessage = error.message;
        }

        setSponsoredTxStatus(`Transaction failed: ${errorMessage}`);
        return null;
      }
    } catch (error) {
      logger.error('Error in sendSponsoredTransaction', error);

      let errorMessage = 'Unknown error in transaction';
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      setSponsoredTxStatus(`Error: ${errorMessage}`);
      return null;
    }
  };

  // Self-sponsored transaction - updated to use bundlerWithoutPaymaster
  async function sendSelfSponsoredTransaction(recipient: string, amount: string) {
    if (!smartAccount) {
      setSelfSponsoredTxStatus('Smart account not initialized');
      return;
    }

    if (!bundlerWithoutPaymaster) {
      setSelfSponsoredTxStatus('Bundler without paymaster not initialized');
      return;
    }

    if (!smartAccountClient) {
      setSelfSponsoredTxStatus('Smart account client not initialized');
      return;
    }

    if (!contractAddresses?.paymaster) {
      setSelfSponsoredTxStatus('Paymaster address not available');
      return;
    }

    try {
      setSelfSponsoredTxStatus('Preparing self-sponsored transaction...');

      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);

      // Create recipient address - if not valid, send to self
      const to =
        recipient && recipient.startsWith('0x') && recipient.length === 42
          ? (recipient as Address)
          : smartAccount.address;

      setSelfSponsoredTxStatus(
        'Sending self-sponsored transaction via bundler without paymaster...'
      );

      // Get gas prices from the bundler without paymaster
      const gasPrice = await bundlerWithoutPaymaster.getUserOperationGasPrice();
      logger.gasPrice('Gas prices received for self-sponsored transaction', gasPrice);

      // Prepare the user operation using the bundler without paymaster
      const preparedUserOperation = await bundlerWithoutPaymaster.prepareUserOperation({
        account: smartAccount,
        calls: [
          {
            to: to,
            value: parsedAmount,
          },
        ],
        maxFeePerGas: gasPrice.slow.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
      });

      // First get the paymaster data - it contains BigInt values
      const paymasterData = generateSelfSponsoredPaymasterAndData(contractAddresses.paymaster);
      // Combine the prepared operation with the paymaster data
      const userOperation = {
        ...preparedUserOperation,
        paymaster: paymasterData.paymaster,
        paymasterData: paymasterData.paymasterData,
        // Ensure gas limits are set from the paymaster data (these are BigInt values)
        paymasterVerificationGasLimit: paymasterData.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: paymasterData.paymasterPostOpGasLimit,
        preVerificationGas: paymasterData.preVerificationGas,
        verificationGasLimit: paymasterData.verificationGasLimit,
      };

      // STEP 2: Explicitly sign the user operation
      logger.info('Explicitly signing the user operation with smart account owner...');
      const signature = await smartAccount.signUserOperation(userOperation);

      // Update the signature in the user operation
      userOperation.signature = signature;
      logger.debug('User operation signed with signature', {
        signatureStart: signature.substring(0, 10) + '...',
        signatureLength: signature.length,
      });

      // STEP 3: Send the signed user operation
      logger.info('Submitting signed user operation for self-sponsored transaction...');
      setSelfSponsoredTxStatus('Submitting signed self-sponsored transaction...');

      // Use the bundler without paymaster to send the transaction
      // Cast directly to UserOperation type like in the main branch
      const hash = await bundlerWithoutPaymaster.sendUserOperation(userOperation as UserOperation);

      setSelfSponsoredTxHash(hash);
      setSelfSponsoredTxStatus('Waiting for self-sponsored transaction confirmation...');

      // Wait for the transaction receipt
      const receipt = await bundlerWithoutPaymaster.waitForUserOperationReceipt({ hash: hash });

      // Store both the userOp hash and the transaction hash
      setSelfSponsoredTxStatus(
        `Self-sponsored transaction confirmed! Transaction hash: ${receipt.receipt.transactionHash}`
      );
      return {
        userOpHash: hash,
        transactionHash: receipt.receipt.transactionHash,
      };
    } catch (error) {
      handleTransactionError(error, setSelfSponsoredTxStatus);
      return null;
    }
  }

  // Bond MON to shMON
  async function bondMonToShmon(amount: string = '2') {
    if (!smartAccount) {
      setTxStatus('Smart account not initialized');
      return null;
    }

    if (!contractAddresses?.shmonad) {
      setTxStatus('shMONAD contract address not available. Check network connectivity.');
      return null;
    }

    if (!walletClient) {
      setTxStatus('Wallet client not initialized');
      return null;
    }

    if (!embeddedWallet) {
      setTxStatus('Embedded wallet not initialized');
      return null;
    }

    try {
      setTxStatus(`Preparing to bond ${amount} MON to shMON...`);

      // Use provided amount instead of hardcoded value
      const bondAmount = parseEther(amount);

      let policyId;

      console.log('🔍 Contract addresses:', contractAddresses);
      try {
        // Create a proper ABI object for the POLICY_ID function
        const properPolicyAbi = [
          {
            name: 'POLICY_ID',
            type: 'function',
            stateMutability: 'view',
            inputs: [],
            outputs: [{ type: 'uint256' }],
          },
        ] as const;

        // Call the POLICY_ID function with the correct ABI
        policyId = await publicClient.readContract({
          address: contractAddresses?.paymaster as Address,
          abi: properPolicyAbi,
          functionName: 'POLICY_ID',
        });

        logger.info('Policy ID retrieved successfully:', policyId);
      } catch (error) {
        console.log('🔍 Error getting POLICY_ID:', error);
        logger.error('Error getting POLICY_ID with custom ABI approach:', error);

        // Fall back to a default value
        logger.info('Using default POLICY_ID value');
        policyId = BigInt(4);
      }

      // Get the EOA address (embedded wallet address) - this is what we'll bond for
      const addresses = await walletClient.getAddresses();
      if (!addresses.length) {
        throw new Error('No addresses found in wallet client');
      }
      const eoaAddress = addresses[0];

      console.log('🔍 Using EOA address for bonding:', eoaAddress);

      // Encode the depositAndBond function call
      // We need to pass a policyId, recipient, and amount
      // Important: We're bonding from the EOA (embedded wallet), not from the smart account
      // Using type(uint256).max for shMonToBond tells the contract to use all the shares that were just minted
      // This solves the issue where the conversion from ETH to shMON results in slightly fewer shares than expected
      // The contract has a special case: if (shMonToBond == type(uint256).max) shMonToBond = sharesMinted;
      const callData = encodeFunctionData({
        abi: shmonadAbi,
        functionName: 'depositAndBond',
        args: [
          policyId,
          smartAccount.address, // Bond for the smart account, not the EOA
          maxUint256, // type(uint256).max - use all minted shares
        ],
      });

      setTxStatus(`Submitting transaction to bond ${amount} MON to shMON...`);

      // Use sendTransaction instead of signTransaction + sendRawTransaction
      logger.info('🚀 Sending transaction with params:', {
        to: contractAddresses.shmonad,
        value: bondAmount.toString(),
        chainId: MONAD_CHAIN.id,
        bondingFor: smartAccount.address, // Bond for the smart account
        bondAmount: 'Using all minted shares (type(uint256).max)', // Using all minted shares
      });

      // Estimate gas with a safety buffer to prevent "gas limit too low" errors
      logger.info('⛽ Estimating gas for the transaction...');
      let gasLimit;
      try {
        const gasEstimate = await publicClient.estimateGas({
          account: eoaAddress,
          to: contractAddresses.shmonad as Address,
          value: bondAmount,
          data: callData as Hex,
        });

        // Add a 30% buffer to the gas estimate to ensure it's sufficient
        gasLimit = BigInt(Math.floor(Number(gasEstimate) * 1.3));
        logger.info(`✅ Gas estimated: ${gasEstimate}, with buffer: ${gasLimit}`);
      } catch (gasError) {
        logger.warn('⚠️ Gas estimation failed, using fallback value:', gasError);
        // Use a conservative fallback gas limit if estimation fails
        gasLimit = 500000n;
        logger.info(`⚠️ Using fallback gas limit: ${gasLimit}`);
      }

      // Send the transaction
      const hash = await walletClient.sendTransaction({
        to: contractAddresses.shmonad as Address,
        value: bondAmount,
        data: callData as Hex,
        account: eoaAddress as Address, // Explicitly cast to Address to satisfy TypeScript
        chain: MONAD_CHAIN, // Explicitly set chain to MONAD_CHAIN
        gas: gasLimit, // Add explicit gas limit
      });

      setTxHash(hash);
      setTxStatus(`Waiting for bond transaction of ${amount} MON confirmation...`);

      // Wait for transaction to be confirmed
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: hash,
      });

      setTxStatus(
        `Bond transaction of ${amount} MON confirmed! Transaction hash: ${receipt.transactionHash}`
      );
      return receipt;
    } catch (error) {
      // Use the handleTransactionError helper function for consistent error handling
      handleTransactionError(error, setTxStatus);

      // Log the error for debugging purposes
      logger.error('Bond transaction error:', error);

      // Check if this is a user rejection error and handle it specifically
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (
          errorMessage.includes('user rejected') ||
          errorMessage.includes('user denied') ||
          errorMessage.includes('cancelled by user') ||
          errorMessage.includes('canceled by user') ||
          errorMessage.includes('rejected the request')
        ) {
          // Set a more user-friendly message for rejection
          setTxStatus('Transaction canceled: You rejected the bond transaction request.');
        }
      }

      return null;
    }
  }

  // Return combined state and functions
  return {
    // State
    txHash,
    txStatus,
    sponsoredTxHash,
    sponsoredTxStatus,
    selfSponsoredTxHash,
    selfSponsoredTxStatus,

    // Functions
    sendTransaction,
    sendSponsoredTransaction,
    sendSelfSponsoredTransaction,
    bondMonToShmon,
    setTxStatus,
  };
}
