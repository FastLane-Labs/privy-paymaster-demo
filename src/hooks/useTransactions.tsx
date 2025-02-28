import { useState } from 'react';
import { MONAD_CHAIN, publicClient } from '@/utils/config';
import { encodeFunctionData, parseEther, type Address, type Hex } from 'viem';
import shmonadAbi from '@/abis/shmonad.json';
import { WalletManagerState } from './useWalletManager';
import { ShBundlerClient } from '@/utils/bundler';
import { isAddress, maxUint256 } from 'viem';
import { getPaymasterData, UserOperation } from 'viem/account-abstraction';
import { logger } from '../utils/logger';
import { paymasterMode } from '@/utils/contracts';

// Helper function to serialize BigInt values for logging
function serializeBigInt(obj: any): any {
  return JSON.stringify(obj, (_, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
}

type TransactionState = {
  txHash: string;
  txStatus: string;
  sponsoredTxHash: string;
  sponsoredTxStatus: string;
  selfSponsoredTxHash: string;
  selfSponsoredTxStatus: string;
};

// Update the WalletManager interface to include smartAccountClient and setLoading
interface TransactionWalletManager extends Partial<WalletManagerState> {
  setLoading?: (loading: boolean) => void;
  smartAccountClient?: any; // Renamed from kernelClient
  bundler?: ShBundlerClient | null; // Accept null or undefined
  bundlerWithPaymaster?: ShBundlerClient | null; // Bundler with paymaster for sponsored transactions
  bundlerWithoutPaymaster?: ShBundlerClient | null; // Bundler without paymaster for self-sponsored transactions
  embeddedWallet?: any;
}

// Helper to handle transaction errors consistently
function handleTransactionError(error: unknown, setErrorStatus: (status: string) => void) {
  console.error('Transaction error:', error);

  // Try to extract JSON error details
  let errorCode = '';
  let detailedMessage = '';

  // Check for signature validation errors
  if (error instanceof Error) {
    const errorMessage = error.message;

    // Try to extract JSON error details if present
    try {
      // Look for JSON-like details in the error message
      const detailsMatch = errorMessage.match(/Details:\s*(\{.*\})/);
      if (detailsMatch && detailsMatch[1]) {
        const errorDetails = JSON.parse(detailsMatch[1]);
        if (errorDetails.code) errorCode = errorDetails.code;
        if (errorDetails.message) detailedMessage = errorDetails.message;
      }
    } catch (e) {
      console.log('Could not parse error details as JSON');
    }

    // Also check for AA24 code format directly in the message
    const aa24Match = errorMessage.match(/(AA\d+)\s+([^"]+)/);
    if (aa24Match) {
      if (!errorCode) errorCode = aa24Match[1];
      if (!detailedMessage) detailedMessage = aa24Match[2];
    }

    if (
      errorMessage.includes('signature error') ||
      errorMessage.includes('AA24') ||
      errorMessage.includes('Signature provided for the User Operation is invalid')
    ) {
      const errorDetail = errorCode
        ? `${errorCode}: ${detailedMessage || 'signature error'}`
        : 'signature error';
      setErrorStatus(
        `Signature validation failed (${errorDetail}). This may be due to an issue with your smart account configuration. ` +
          'Try refreshing the page or reconnecting your wallet.'
      );
    } else if (errorMessage.includes('paymaster') || errorMessage.includes('AA31')) {
      const errorDetail = errorCode
        ? `${errorCode}: ${detailedMessage || 'paymaster error'}`
        : 'paymaster error';
      setErrorStatus(
        `Paymaster validation failed (${errorDetail}). The paymaster may be out of funds or rejecting the transaction.`
      );
    } else if (errorMessage.includes('gas')) {
      const errorDetail = errorCode
        ? `${errorCode}: ${detailedMessage || 'gas estimation error'}`
        : 'gas estimation error';
      setErrorStatus(
        `Gas estimation failed (${errorDetail}). The transaction may be too complex or your account may have insufficient funds.`
      );
    } else {
      // If we have detailed error info, include it
      const errorPrefix = errorCode ? `[${errorCode}] ` : '';
      const errorSuffix = detailedMessage ? `: ${detailedMessage}` : '';

      setErrorStatus(
        `Error${errorSuffix ? errorPrefix : ''}: ${errorMessage}${!errorSuffix && errorPrefix ? ` ${errorPrefix}` : ''}`
      );
    }
  } else {
    setErrorStatus(`Unknown error occurred. Please check the console for details.`);
  }
}

export function useTransactions(walletManager: TransactionWalletManager) {
  const { 
    smartAccount, 
    bundler, 
    bundlerWithPaymaster,
    bundlerWithoutPaymaster,
    contractAddresses, 
    smartAccountClient, 
    embeddedWallet,
    walletClient,
    setLoading 
  } = walletManager;

  // Transaction state
  const [txHash, setTxHash] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [sponsoredTxHash, setSponsoredTxHash] = useState('');
  const [sponsoredTxStatus, setSponsoredTxStatus] = useState('');
  const [selfSponsoredTxHash, setSelfSponsoredTxHash] = useState('');
  const [selfSponsoredTxStatus, setSelfSponsoredTxStatus] = useState('');

  // Debug function to check paymaster configuration
  const verifyPaymasterConfiguration = async () => {
    console.log('🧪 Verifying paymaster configuration');
    console.log('Smart account available:', !!smartAccount);
    console.log('Bundler with paymaster:', !!bundlerWithPaymaster);
    console.log('Bundler without paymaster:', !!bundlerWithoutPaymaster);
    console.log('Contract addresses:', contractAddresses);
    
    // Instead of trying to inspect the bundler internal structure,
    // let's test its functionality directly
    
    if (bundlerWithPaymaster) {
      try {
        console.log('🧪 Testing bundler with paymaster functionality...');
        
        // Test if the bundler can get gas prices
        const gasPrice = await bundlerWithPaymaster.getUserOperationGasPrice();
        console.log('✅ Bundler with paymaster can get gas prices:', {
          slow: gasPrice.slow,
          standard: gasPrice.standard,
          fast: gasPrice.fast,
        });
        
        // Test a minimal user operation to verify the bundler works
        if (smartAccount) {
          console.log('🧪 Testing bundler with a minimal user operation...');
          
          // Create a minimal user operation
          try {
            // Prepare the user operation - this will automatically include paymaster data if configured
            console.log('Preparing minimal user operation with the bundler with paymaster...');
            const userOp = await bundlerWithPaymaster.prepareUserOperation({
              account: smartAccount,
              calls: [{
                to: smartAccount.address,
                value: 0n,
                data: '0x',
              }],
            });
            
            console.log('✅ User operation prepared:', {
              sender: userOp.sender,
              nonce: userOp.nonce.toString(),
              callGasLimit: userOp.callGasLimit?.toString() || 'not set',
              verificationGasLimit: userOp.verificationGasLimit?.toString() || 'not set',
              preVerificationGas: userOp.preVerificationGas?.toString() || 'not set',
              hasPaymasterData: !!userOp.paymasterAndData && userOp.paymasterAndData !== '0x',
            });
            console.log('Full user operation:', serializeBigInt(userOp));
            
            // We successfully prepared the user operation
            return {
              paymaster: 'CONFIGURED',
              smartAccount: !!smartAccount,
              bundler: !!bundlerWithPaymaster
            };
          } catch (prepareError) {
            console.error('❌ Error preparing user operation:', prepareError);
            return {
              paymaster: 'ERROR_PREPARING',
              smartAccount: !!smartAccount,
              bundler: !!bundlerWithPaymaster
            };
          }
        }
        
        return {
          paymaster: 'TESTING_INCOMPLETE',
          smartAccount: !!smartAccount,
          bundler: !!bundlerWithPaymaster
        };
      } catch (error) {
        console.error('❌ Error testing bundler with paymaster functionality:', error);
        return {
          paymaster: 'ERROR',
          smartAccount: !!smartAccount,
          bundler: !!bundlerWithPaymaster
        };
      }
    }
    
    return {
      paymaster: 'NOT_CONFIGURED',
      smartAccount: !!smartAccount,
      bundler: !!bundlerWithPaymaster
    };
  };

  // Regular transaction - updated to use Smart Account Client
  async function sendTransaction(recipient: string, amount: string) {
    if (!smartAccount) {
      setTxStatus('Smart account not initialized');
      return null;
    }
    
    try {
      setLoading?.(true);
      setTxStatus('Preparing transaction...');

      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);

      // Create recipient address - if not valid, send to self
      const to =
        recipient && recipient.startsWith('0x') && recipient.length === 42
          ? (recipient as Address)
          : smartAccount.address;

      // Only use the smartAccountClient approach - no bundler or paymaster
      if (smartAccountClient) {
        setTxStatus('Using smart account client for transaction...');
        console.log('💰 Using smart account client directly for NON-SPONSORED transaction');
        
        // Use the smart account client for the transaction
        const hash = await smartAccountClient.sendTransaction({
          to: to,
          value: parsedAmount,
          data: '0x' as Hex,
        });

        setTxHash(hash);
        setTxStatus('Waiting for transaction confirmation...');

        // Wait for the transaction receipt
        const receipt = await smartAccountClient.waitForTransactionReceipt({
          hash: hash,
        });

        setTxStatus(`Transaction confirmed! Transaction hash: ${receipt.transactionHash}`);
        setLoading?.(false);
        return receipt.transactionHash;
      } else {
        throw new Error('Smart account client not available to send the transaction');
      }
    } catch (error) {
      handleTransactionError(error, setTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Send a transaction sponsored by the paymaster
  const sendSponsoredTransaction = async (to: string, amount: string) => {
    try {
      logger.info('Starting sponsored transaction flow');
      logger.debug('Recipient address received', to);
      setTxStatus('Preparing transaction...');
      
      // Validate inputs
      if (!smartAccount || !bundlerWithPaymaster) {
        logger.error('Smart account or bundler with paymaster not initialized');
        setTxStatus('Smart account or bundler with paymaster not initialized');
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
        logger.warn('Invalid or empty recipient address, using smart account address as fallback', targetAddress);
      }

      // Convert amount from ETH to wei
      let amountWei: bigint;
      try {
        amountWei = parseEther(amount);
        logger.debug('Amount in wei', amountWei.toString());
      } catch (error) {
        logger.error('Invalid amount', amount);
        setTxStatus('Invalid amount');
        return null;
      }
      
      // Get gas prices from the bundler
      logger.info('Getting gas prices...');
      setTxStatus('Getting gas prices...');
      
      const gasPrice = await bundlerWithPaymaster.getUserOperationGasPrice();
      logger.gasPrice('Gas prices received', gasPrice);
      
      try {
        // STEP 1: Prepare the user operation
        logger.info('Preparing and signing user operation...');
        setTxStatus('Preparing and signing user operation...');
        
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
        });
        
        logger.userOp('User operation prepared', userOperation);
        
        // STEP 2: Explicitly sign the user operation
        logger.info('Explicitly signing the user operation with smart account owner...');
        const signature = await smartAccount.signUserOperation(userOperation);
        
        // Update the signature in the user operation
        userOperation.signature = signature;
        logger.debug('User operation signed with signature', signature.substring(0, 10) + '...');
        
        // STEP 3: Send the signed user operation
        logger.info('Submitting signed user operation...');
        setTxStatus('Submitting signed transaction...');
        
        // We must create a new sendUserOperation call with the account parameter
        // This is required by the API - the account is used for type checking and validation
        // but not for signing (since we already signed the operation)
        const userOpHash = await bundlerWithPaymaster.sendUserOperation(userOperation as UserOperation);
        
        logger.info('Sponsored transaction submitted with hash', userOpHash);
        setTxStatus('Transaction submitted, waiting for confirmation...');
        
        // Wait for receipt
        const receipt = await bundlerWithPaymaster.waitForUserOperationReceipt({ hash: userOpHash });
        logger.info('Sponsored transaction confirmed! Hash', receipt.receipt.transactionHash);
        setTxStatus('Sponsored transaction confirmed!');
        
        return receipt.receipt.transactionHash;
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
      setLoading?.(true);
      setSelfSponsoredTxStatus('Preparing self-sponsored transaction...');

      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);

      // Create recipient address - if not valid, send to self
      const to =
        recipient && recipient.startsWith('0x') && recipient.length === 42
          ? (recipient as Address)
          : smartAccount.address;

      setSelfSponsoredTxStatus('Sending self-sponsored transaction via bundler without paymaster...');

      // Default gas limit values from demo script
      const paymasterVerificationGasLimit = 75000n;
      const paymasterPostOpGasLimit = 120000n;
      const preVerificationGas = BigInt('0x350f7');
      const verificationGasLimit = BigInt('0x501ab');

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

      console.log('🔍 User operation prepared:', serializeBigInt(preparedUserOperation));
      // TODO: Add paymaster data
      const userOperation = {
        ...preparedUserOperation,
        paymasterAndData: paymasterMode('user') as Hex,
        preVerificationGas,
        verificationGasLimit,
        paymasterPostOpGasLimit,
        paymasterVerificationGasLimit,
      };

      // Update the signature in the user operation
      // STEP 2: Explicitly sign the user operation
      logger.info('Explicitly signing the user operation with smart account owner...');
      const signature = await smartAccount.signUserOperation(userOperation);

      // Update the signature in the user operation
      userOperation.signature = signature;
      logger.debug('User operation signed with signature', signature.substring(0, 10) + '...');

      // STEP 3: Send the signed user operation
      logger.info('Submitting signed user operation for self-sponsored transaction...');
      setSelfSponsoredTxStatus('Submitting signed self-sponsored transaction...');

      // Use the bundler without paymaster to send the transaction
      const hash = await bundlerWithoutPaymaster.sendUserOperation(userOperation);

      setSelfSponsoredTxHash(hash);
      setSelfSponsoredTxStatus('Waiting for self-sponsored transaction confirmation...');

      // Wait for the transaction receipt
      const receipt = await bundlerWithoutPaymaster.waitForUserOperationReceipt({ hash: hash });

      setSelfSponsoredTxStatus(
        `Self-sponsored transaction confirmed! Transaction hash: ${receipt.receipt.transactionHash}`
      );
      setLoading?.(false);
      return receipt;
    } catch (error) {
      handleTransactionError(error, setSelfSponsoredTxStatus);
      setLoading?.(false);
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
      setLoading?.(true);
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
        bondAmount: 'Using all minted shares (type(uint256).max)' // Using all minted shares
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
      setLoading?.(false);

      // Return receipt to indicate success
      return receipt;
    } catch (error) {
      handleTransactionError(error, setTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Debug function to test a user operation with paymaster
  const debugUserOpWithPaymaster = async () => {
    console.log('🧪 Debug - Testing user operation with paymaster integration');
    
    // Check all required components are available
    console.log('🔍 Checking all required components:');
    console.log('Smart account:', !!smartAccount ? '✅ Available' : '❌ Missing');
    console.log('Bundler with paymaster:', !!bundlerWithPaymaster ? '✅ Available' : '❌ Missing');
    console.log('Bundler without paymaster:', !!bundlerWithoutPaymaster ? '✅ Available' : '❌ Missing');
    console.log('Paymaster address:', contractAddresses?.paymaster ? `✅ ${contractAddresses.paymaster}` : '❌ Missing');
    console.log('Paymaster ABI:', '✅ Should be imported from abis/paymaster.json');
    
    // First verify the paymaster configuration
    const config = await verifyPaymasterConfiguration();
    
    if (!config.smartAccount || !bundlerWithPaymaster) {
      console.error('❌ Cannot proceed - smart account or bundler with paymaster not available');
      return null;
    }
    
    try {
      console.log('🧪 Testing bundler with paymaster transaction flow...');
      
      // Get gas price
      const gasPrice = await bundlerWithPaymaster.getUserOperationGasPrice();
      console.log('✅ Got gas prices:', {
        slow: `${gasPrice.slow.maxFeePerGas.toString()} / ${gasPrice.slow.maxPriorityFeePerGas.toString()}`,
        standard: `${gasPrice.standard.maxFeePerGas.toString()} / ${gasPrice.standard.maxPriorityFeePerGas.toString()}`,
        fast: `${gasPrice.fast.maxFeePerGas.toString()} / ${gasPrice.fast.maxPriorityFeePerGas.toString()}`
      });
      
      // First try to prepare a user operation to check if paymaster data is included
      console.log('🔍 Preparing user operation to check for paymaster data...');
      const preparedOp = await bundlerWithPaymaster.prepareUserOperation({
        account: smartAccount,
        calls: [
          {
            to: smartAccount.address,
            value: 0n,
            data: '0x',
          },
        ],
      });
      
      console.log('✅ User operation prepared:', {
        sender: preparedOp.sender,
        nonce: preparedOp.nonce.toString(),
        hasPaymasterData: !!preparedOp.paymasterAndData && preparedOp.paymasterAndData !== '0x',
        paymasterDataPrefix: preparedOp.paymasterAndData ? 
          preparedOp.paymasterAndData.substring(0, 10) + '...' : 
          'None'
      });
      console.log('Full user operation:', serializeBigInt(preparedOp));
      
      // Now try to send the user operation
      logger.info('Sending minimal user operation via bundler with paymaster...');
      
      // Send the prepared user operation
      const userOpHash = await bundlerWithPaymaster.sendUserOperation(preparedOp as UserOperation);
      
      logger.info('User operation hash received', userOpHash);
      
      // Wait for the transaction to be confirmed
      logger.info('Waiting for transaction confirmation...');
      const receipt = await bundlerWithPaymaster.waitForUserOperationReceipt({ hash: userOpHash });
      
      logger.info('Transaction confirmed! Hash', receipt.receipt.transactionHash);
      return receipt.receipt.transactionHash;
    } catch (error) {
      logger.error('Error in debug user operation', error);
      
      // Try to extract more details about the error
      if (error instanceof Error) {
        logger.error('Error message', error.message);
        
        if (error.message.includes('paymaster') || error.message.includes('AA31')) {
          logger.error('Paymaster-related error detected!');
        }
        
        if (error.message.includes('initCode')) {
          logger.error('⚠️ InitCode-related error detected!');
          logger.error('This may indicate an issue with the smart account initialization.');
        }
        
        if (error.message.includes('sender')) {
          logger.error('⚠️ Sender-related error detected!');
          logger.error('This may indicate an issue with the smart account address.');
        }
      }
      
      return null;
    }
  };

  // New method to directly verify paymaster integration using the enhanced bundler
  const verifyPaymasterIntegrationDirect = async () => {
    if (!bundlerWithPaymaster) {
      console.error('❌ Cannot verify paymaster integration - bundler with paymaster not available');
      return false;
    }
    
    // Check if the bundler has the verifyPaymasterIntegration method
    if ('verifyPaymasterIntegration' in bundlerWithPaymaster) {
      try {
        // @ts-ignore - The verifyPaymasterIntegration method is added dynamically
        const result = await bundlerWithPaymaster.verifyPaymasterIntegration();
        return result;
      } catch (error) {
        console.error('❌ Error verifying paymaster integration:', error);
        return false;
      }
    } else {
      console.warn('⚠️ Bundler with paymaster does not have verifyPaymasterIntegration method');
      // Fall back to the regular verification method
      const config = await verifyPaymasterConfiguration();
      return config.paymaster === 'CONFIGURED' || config.paymaster === 'WORKING';
    }
  };

  return {
    // Transaction state
    txHash,
    txStatus,
    sponsoredTxHash,
    sponsoredTxStatus,
    selfSponsoredTxHash,
    selfSponsoredTxStatus,

    // Transaction functions
    sendTransaction,
    sendSponsoredTransaction,
    sendSelfSponsoredTransaction,
    bondMonToShmon,
    setTxStatus,
    
    // Debug functions
    verifyPaymasterConfiguration,
    debugUserOpWithPaymaster,
    verifyPaymasterIntegrationDirect
  };
}
