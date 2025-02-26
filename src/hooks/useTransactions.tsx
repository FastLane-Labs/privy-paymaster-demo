import { useState } from 'react';
import { publicClient } from '@/utils/config';
import { initContract } from '@/utils/contracts';
import { paymasterMode } from '@/utils/contracts';
import { encodeFunctionData, parseEther, formatEther, type Address, type Hex } from 'viem';
import { toPackedUserOperation } from 'viem/account-abstraction';
import paymasterAbi from '@/abis/paymaster.json';
import shmonadAbi from '@/abis/shmonad.json';
import { WalletManagerState } from './useWalletManager';
import { ShBundlerClient } from '@/utils/bundler';

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
  bundler?: ShBundlerClient; // Use ShBundlerClient type
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
  const { smartAccount, bundler, contractAddresses, sponsorWallet, smartAccountClient, setLoading } =
    walletManager;

  // Transaction state
  const [txHash, setTxHash] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [sponsoredTxHash, setSponsoredTxHash] = useState('');
  const [sponsoredTxStatus, setSponsoredTxStatus] = useState('');
  const [selfSponsoredTxHash, setSelfSponsoredTxHash] = useState('');
  const [selfSponsoredTxStatus, setSelfSponsoredTxStatus] = useState('');

  // Regular transaction - updated to use Smart Account Client
  async function sendTransaction(recipient: string, amount: string) {
    if (!smartAccount) {
      setTxStatus('Smart account not initialized');
      return;
    }

    if (!smartAccountClient) {
      setTxStatus('Smart account client not initialized');
      return;
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

      setTxStatus('Sending transaction...');

      // Use the smart account client to send the transaction
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
      return receipt;
    } catch (error) {
      handleTransactionError(error, setTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Sponsored transaction using the paymaster sponsorship
  async function sendSponsoredTransaction(recipient: string, amount: string) {
    if (!smartAccount || !bundler || !sponsorWallet || !contractAddresses?.paymaster) {
      setSponsoredTxStatus('Required components not initialized');
      return;
    }

    try {
      setLoading?.(true);
      setSponsoredTxStatus('Preparing sponsored transaction...');

      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);

      // Create recipient address - if not valid, send to self
      const to = recipient && recipient.startsWith('0x') && recipient.length === 42
        ? (recipient as Address)
        : smartAccount.address;

      // Step 1: Initialize the paymaster contract
      const paymasterContract = await initContract(
        contractAddresses.paymaster,
        paymasterAbi,
        publicClient
      );

      // Step 2: Get gas price
      const gasPrice = await bundler.getUserOperationGasPrice();

      // Step 3: Create the transaction call
      const call = {
        to: to,
        value: parsedAmount,
        data: '0x' as Hex,
      };

      // Step 4: Set validity window for the sponsorship
      const validAfter = 0n;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // Valid for 1 hour

      // Step 5: Prepare UserOperation (this handles all the gas estimation and formatting)
      setSponsoredTxStatus('Preparing UserOperation...');
      const userOp = await bundler.prepareUserOperation({
        account: smartAccount,
        calls: [call],
        ...gasPrice.slow,
      });

      // Step 6: Get the hash to sign from the paymaster
      setSponsoredTxStatus('Getting hash for sponsor to sign...');
      const hash = await paymasterContract.read.getHash([
        toPackedUserOperation(userOp),
        validUntil,
        validAfter,
      ]) as Hex;

      // Step 7: Sign the hash with the sponsor wallet
      setSponsoredTxStatus('Sponsor signing transaction hash...');
      if (!sponsorWallet.account) {
        throw new Error("Sponsor wallet account is not available");
      }
      
      const sponsorSignature = await sponsorWallet.signMessage({
        account: sponsorWallet.account,
        message: { raw: hash },
      });

      // Step 8: Create paymaster data
      const paymasterData = paymasterMode(
        "sponsor",
        validUntil,
        validAfter,
        sponsorSignature,
        sponsorWallet
      ) as Hex;

      // Step 9: Send the transaction with sponsorship
      setSponsoredTxStatus('Sending sponsored transaction...');
      // Note: In actual ShBundler implementation, there might be more sophisticated
      // ways to send with paymaster data, but for now we follow this approach
      const userOpHash = await bundler.sendUserOperation({
        account: smartAccount,
        calls: [call],
        maxFeePerGas: gasPrice.slow.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
        paymasterAndData: paymasterData
      });
      
      setSponsoredTxHash(userOpHash);
      setSponsoredTxStatus('Waiting for transaction confirmation...');

      // Step 10: Wait for the receipt
      const receipt = await bundler.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      setSponsoredTxStatus(
        `Sponsored transaction confirmed! Transaction hash: ${receipt.receipt.transactionHash}`
      );
      setLoading?.(false);
      return receipt;
    } catch (error) {
      handleTransactionError(error, setSponsoredTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Self-sponsored transaction - updated to use smartAccountClient
  async function sendSelfSponsoredTransaction(recipient: string, amount: string) {
    if (!smartAccount) {
      setSelfSponsoredTxStatus('Smart account not initialized');
      return;
    }

    if (!smartAccountClient) {
      setSelfSponsoredTxStatus('Smart account client not initialized');
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

      setSelfSponsoredTxStatus('Sending transaction via Smart Account client...');

      // Use the smartAccountClient to send the transaction (this handles all the AA details internally)
      const hash = await smartAccountClient.sendTransaction({
        to: to,
        value: parsedAmount,
        data: '0x' as Hex,
      });

      setSelfSponsoredTxHash(hash);
      setSelfSponsoredTxStatus('Waiting for transaction confirmation...');

      // Wait for the transaction receipt
      const receipt = await smartAccountClient.waitForTransactionReceipt({
        hash: hash,
      });

      setSelfSponsoredTxStatus(
        `Self-sponsored transaction confirmed! Transaction hash: ${receipt.transactionHash}`
      );
      setLoading?.(false);
      return receipt;
    } catch (error) {
      handleTransactionError(error, setSelfSponsoredTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Bond MON to shMON - keep using bundler for now
  async function bondMonToShmon() {
    if (!smartAccount || !bundler) {
      setTxStatus('Smart account or bundler not initialized');
      return;
    }

    if (!contractAddresses?.shmonad) {
      setTxStatus('shMONAD contract address not available. Check network connectivity.');
      return;
    }

    try {
      setLoading?.(true);
      setTxStatus('Preparing to bond MON to shMON...');

      // Initialize shMONAD contract
      const shMonadContract = await initContract(
        contractAddresses.shmonad,
        shmonadAbi,
        publicClient
      );

      // Get gas price
      const gasPrice = await bundler.getUserOperationGasPrice();

      // Amount to bond (hardcoded to 1 MON for simplicity)
      const bondAmount = parseEther('1');

      // Encode the function call
      const callData = encodeFunctionData({
        abi: shmonadAbi,
        functionName: 'deposit',
        args: [],
      });

      setTxStatus('Submitting transaction to bond MON to shMON...');

      // Use the smartAccountClient if available, otherwise fall back to bundler
      if (smartAccountClient) {
        setTxStatus('Sending bond transaction via Smart Account client...');

        // Send transaction using smartAccountClient
        const hash = await smartAccountClient.sendTransaction({
          to: contractAddresses.shmonad as Address,
          value: bondAmount,
          data: callData as Hex,
        });

        setTxHash(hash);
        setTxStatus('Waiting for bond transaction confirmation...');

        // Wait for transaction receipt
        const receipt = await smartAccountClient.waitForTransactionReceipt({
          hash: hash,
        });

        setTxStatus(`Bond transaction confirmed! Transaction hash: ${receipt.transactionHash}`);
        setLoading?.(false);
        return receipt;
      } else {
        // Fall back to bundler if smartAccountClient not available
        const userOpHash = await bundler.sendUserOperation({
          account: smartAccount,
          calls: [
            {
              to: contractAddresses.shmonad as Address,
              value: bondAmount,
              data: callData as Hex,
            },
          ],
          maxFeePerGas: gasPrice.slow.maxFeePerGas,
          maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
        });

        setTxHash(userOpHash);
        setTxStatus('Waiting for bond transaction confirmation...');

        // Wait for receipt and update UI
        const receipt = await bundler.waitForUserOperationReceipt({
          hash: userOpHash,
        });

        setTxStatus(
          `Bond transaction confirmed! Transaction hash: ${receipt.receipt.transactionHash}`
        );
        setLoading?.(false);
        return receipt;
      }
    } catch (error) {
      handleTransactionError(error, setTxStatus);
      setLoading?.(false);
      return null;
    }
  }

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

    // Status setters
    setTxStatus,
    setSponsoredTxStatus,
    setSelfSponsoredTxStatus,
  };
}
