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
import { parseAbi } from 'viem';
import { isAddress } from 'viem';

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

  // Debug function to check paymaster configuration
  const verifyPaymasterConfiguration = () => {
    console.log('🧪 Verifying paymaster configuration');
    console.log('Smart account available:', !!smartAccount);
    console.log('Bundler available:', !!bundler);
    console.log('Sponsor wallet available:', !!sponsorWallet);
    console.log('Contract addresses:', contractAddresses);
    
    // Check if bundler has paymaster integration
    if (bundler) {
      // @ts-ignore - Inspecting the bundler object
      const hasPaymasterConfig = bundler._bundlerClient?.options?.paymaster;
      console.log('Bundler paymaster config:', hasPaymasterConfig ? 'CONFIGURED' : 'NOT CONFIGURED');
    }
    
    // Test the bundler's userOperation functionality
    if (smartAccount && bundler) {
      console.log('🧪 Testing bundler functionality...');
      bundler.getUserOperationGasPrice()
        .then(gasPrice => {
          console.log('✅ Bundler can get gas prices:', {
            slow: gasPrice.slow,
            standard: gasPrice.standard,
            fast: gasPrice.fast,
          });
        })
        .catch(error => {
          console.error('❌ Bundler failed to get gas prices:', error);
        });
    }
    
    return {
      smartAccount: !!smartAccount,
      bundler: !!bundler,
      sponsorWallet: !!sponsorWallet,
      contractAddresses: contractAddresses,
    };
  };

  // Regular transaction - updated to use Smart Account Client
  async function sendTransaction(recipient: string, amount: string) {
    if (!smartAccount) {
      setTxStatus('Smart account not initialized');
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

      // Check if bundler with paymaster is available
      if (bundler) {
        setTxStatus('Using bundler with paymaster integration...');
        
        // Get gas price
        const gasPrice = await bundler.getUserOperationGasPrice();
        
        // Use the bundler to send the transaction
        const userOpHash = await bundler.sendUserOperation({
          account: smartAccount,
          calls: [
            {
              to: to,
              value: parsedAmount,
              data: '0x' as Hex,
            },
          ],
          maxFeePerGas: gasPrice.slow.maxFeePerGas,
          maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
        });

        setTxHash(userOpHash);
        setTxStatus('Waiting for transaction confirmation...');

        // Wait for the transaction receipt
        const receipt = await bundler.waitForUserOperationReceipt({
          hash: userOpHash,
        });

        setTxStatus(`Transaction confirmed! Transaction hash: ${receipt.receipt.transactionHash}`);
        setLoading?.(false);
        return receipt;
      } 
      else if (smartAccountClient) {
        setTxStatus('Using smart account client (without paymaster)...');
        
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
      }
      else {
        throw new Error('No suitable client available to send the transaction');
      }
    } catch (error) {
      handleTransactionError(error, setTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Sponsored transaction using the paymaster sponsorship
  const sendSponsoredTransaction = async (recipient: string, amount: string) => {
    console.log('🚀 Beginning sponsored transaction process');
    
    if (!smartAccount || !bundler) {
      console.error('❌ Smart account or bundler not initialized');
      return null;
    }
    
    console.log('📱 Smart account ready:', smartAccount.address);
    console.log('🔄 Using bundler with paymaster integration');
    
    try {
      // Parse amount to wei
      const amountWei = parseEther(amount);
      
      // Validate recipient address
      if (!isAddress(recipient)) {
        throw new Error(`Invalid recipient address: ${recipient}`);
      }
      
      console.log(`💰 Sending ${amount} ETH to ${recipient}`);
      
      // Get gas price
      const gasPrice = await bundler.getUserOperationGasPrice();
      
      console.log('📤 Sending user operation via bundler...');
      
      // Send the user operation
      const userOpHash = await bundler.sendUserOperation({
        account: smartAccount,
        calls: [
          {
            to: recipient,
            value: amountWei,
            data: '0x',
          },
        ],
        maxFeePerGas: gasPrice.slow.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
      });
      
      console.log('📫 User operation hash received:', userOpHash);
      
      // Wait for the transaction to be confirmed
      console.log('⏳ Waiting for transaction confirmation...');
      const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash });
      
      console.log('✅ Transaction confirmed! Hash:', receipt.receipt.transactionHash);
      return receipt.receipt.transactionHash;
    } catch (error) {
      console.error('❌ Error in sendSponsoredTransaction:', error);
      throw error;
    }
  };

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
    
    // Debug functions
    verifyPaymasterConfiguration,

    // Status setters
    setTxStatus,
    setSponsoredTxStatus,
    setSelfSponsoredTxStatus,
  };
}
