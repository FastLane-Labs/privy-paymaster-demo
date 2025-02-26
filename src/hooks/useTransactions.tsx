import { useState } from 'react';
import { publicClient } from '@/utils/config';
import { initContract } from '@/utils/contracts';
import { encodeFunctionData, parseEther, type Address, type Hex } from 'viem';
import shmonadAbi from '@/abis/shmonad.json';
import { WalletManagerState } from './useWalletManager';
import { ShBundlerClient } from '@/utils/bundler';
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
  bundler?: ShBundlerClient | null; // Accept null or undefined
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
  const verifyPaymasterConfiguration = async () => {
    console.log('🧪 Verifying paymaster configuration');
    console.log('Smart account available:', !!smartAccount);
    console.log('Bundler available:', !!bundler);
    console.log('Sponsor wallet available:', !!sponsorWallet);
    console.log('Contract addresses:', contractAddresses);
    
    // Instead of trying to inspect the bundler internal structure,
    // let's test its functionality directly
    
    if (bundler) {
      try {
        console.log('🧪 Testing bundler functionality...');
        
        // Test if the bundler can get gas prices
        const gasPrice = await bundler.getUserOperationGasPrice();
        console.log('✅ Bundler can get gas prices:', {
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
            console.log('Preparing minimal user operation with the bundler...');
            const userOpHash = await bundler.prepareUserOperation({
              account: smartAccount,
              calls: [{
                to: smartAccount.address,
                value: 0n,
                data: '0x',
              }],
            });
            
            console.log('✅ Successfully prepared user operation:', {
              userOpHash: userOpHash ? 'Generated' : 'Not generated',
              paymasterAndData: userOpHash?.paymasterAndData && typeof userOpHash.paymasterAndData === 'string'
                ? `${userOpHash.paymasterAndData.substring(0, 20)}...` 
                : 'Not present',
            });
            
            // Check if paymasterAndData is present - this is the key indicator of paymaster integration
            if (userOpHash?.paymasterAndData && userOpHash.paymasterAndData !== '0x') {
              console.log('✅ PAYMASTER INTEGRATION CONFIRMED - paymasterAndData is present in the user operation');
              return {
                paymaster: 'CONFIGURED',
                smartAccount: !!smartAccount,
                bundler: !!bundler,
                sponsorWallet: !!sponsorWallet
              };
            } else {
              console.log('❌ Paymaster integration NOT detected - no paymasterAndData in the user operation');
            }
          } catch (prepareError) {
            console.error('❌ Error preparing user operation with the bundler:', prepareError);
          }
        }
        
        return {
          paymaster: 'TESTING_INCOMPLETE',
          smartAccount: !!smartAccount,
          bundler: !!bundler,
          sponsorWallet: !!sponsorWallet
        };
      } catch (error) {
        console.error('❌ Error testing bundler functionality:', error);
        return {
          paymaster: 'ERROR',
          smartAccount: !!smartAccount,
          bundler: !!bundler,
          sponsorWallet: !!sponsorWallet
        };
      }
    }
    
    return {
      paymaster: 'NOT_CONFIGURED',
      smartAccount: !!smartAccount,
      bundler: !!bundler,
      sponsorWallet: !!sponsorWallet
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

      // First, try using the bundler with paymaster integration
      if (bundler) {
        try {
          setTxStatus('Using bundler with paymaster integration...');
          console.log('💵 Sending transaction via bundler with paymaster integration');
          
          // Try sponsored transaction - this has better error handling for recipient addresses
          const txHash = await sendSponsoredTransaction(recipient, amount);
          if (txHash) {
            setTxHash(txHash);
            setTxStatus(`Transaction confirmed! Transaction hash: ${txHash}`);
            setLoading?.(false);
            return txHash;
          } else {
            throw new Error('Sponsored transaction failed without an error');
          }
        } catch (sponsorError) {
          console.error('Failed to use integrated paymaster for transaction:', sponsorError);
          setTxStatus('Paymaster integration failed. Trying alternative methods...');
        }
      }
      
      // If bundler + paymaster failed or isn't available, try the kernelClient next if available
      if (smartAccountClient) {
        setTxStatus('Using smart account client for transaction...');
        console.log('💰 Using smart account client directly');
        
        // Use the smart account client for the transaction instead of the bundler
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
      
      // Create recipient address - if not valid, send to self (similar to sendTransaction)
      const to = recipient && recipient.startsWith('0x') && recipient.length === 42
        ? (recipient as Address)
        : smartAccount.address;
      
      console.log(`💰 Sending ${amount} ETH to ${to}`);
      
      // Get gas price
      const gasPrice = await bundler.getUserOperationGasPrice();
      
      console.log('📤 Sending user operation via bundler...');
      
      // Send the user operation
      const userOpHash = await bundler.sendUserOperation({
        account: smartAccount,
        calls: [
          {
            to: to,
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

  // Bond MON to shMON
  async function bondMonToShmon() {
    if (!smartAccount) {
      setTxStatus('Smart account not initialized');
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

      // Amount to bond (hardcoded to 1 MON for simplicity)
      const bondAmount = parseEther('1');

      // Encode the function call
      const callData = encodeFunctionData({
        abi: shmonadAbi,
        functionName: 'deposit',
        args: [],
      });

      setTxStatus('Submitting transaction to bond MON to shMON...');

      // Try bundler with paymaster integration first
      if (bundler) {
        try {
          setTxStatus('Using bundler with paymaster integration for bonding...');
          console.log('💵 Sending bond transaction via bundler with paymaster');
          
          // Get gas price
          const gasPrice = await bundler.getUserOperationGasPrice();
          
          // Send the user operation
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

          setTxStatus(`Bond transaction confirmed! Transaction hash: ${receipt.receipt.transactionHash}`);
          setLoading?.(false);
          return receipt;
        } catch (bundlerError) {
          console.error('Failed to use bundler with paymaster for bonding:', bundlerError);
          setTxStatus('Paymaster integration failed for bonding. Trying alternative methods...');
        }
      }

      // Fall back to using smartAccountClient if available
      if (smartAccountClient) {
        try {
          setTxStatus('Using smart account client for bonding...');
          console.log('💰 Using smart account client directly for bonding');

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
        } catch (clientError) {
          console.error('Failed to use smart account client for bonding:', clientError);
          throw new Error('Smart account client failed to send bond transaction');
        }
      } else {
        throw new Error('No suitable client available for bonding');
      }
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
    console.log('Bundler:', !!bundler ? '✅ Available' : '❌ Missing');
    console.log('Sponsor wallet:', !!sponsorWallet ? '✅ Available' : '❌ Missing');
    console.log('Paymaster address:', contractAddresses?.paymaster ? `✅ ${contractAddresses.paymaster}` : '❌ Missing');
    console.log('Paymaster ABI:', '✅ Should be imported from abis/paymaster.json');
    
    // First verify the paymaster configuration
    const config = await verifyPaymasterConfiguration();
    
    // Check why the bundler is not configured with the paymaster
    if (bundler) {
      try {
        // @ts-ignore - Accessing bundler's internal properties
        const bundlerOptions = bundler._bundlerClient?.options || {};
        console.log('🔬 Bundler internal options:', {
          hasPaymaster: !!bundlerOptions.paymaster,
          entryPoint: bundlerOptions.entryPoint?.address || 'undefined',
          account: bundlerOptions.account?.address || 'undefined'
        });
        
        // If paymaster is missing, provide guidance on fixing it
        if (!bundlerOptions.paymaster) {
          console.log('❗ ISSUE DETECTED: Bundler is missing paymaster configuration');
          console.log('💡 SOLUTION: Ensure the following in your useWalletManager.tsx file:');
          console.log('1. createCustomPaymasterClient is being called with valid parameters');
          console.log('2. initBundlerWithPaymaster is used instead of initBundler');
          console.log('3. The custom paymaster client is passed to initBundlerWithPaymaster');
          console.log('4. Verify the paymaster address is correct and the contract is deployed');
        }
      } catch (error) {
        console.error('❌ Error examining bundler configuration:', error);
      }
    }
    
    if (!config.smartAccount || !config.bundler) {
      console.error('❌ Cannot proceed - smart account or bundler not available');
      return null;
    }
    
    if (!config.sponsorWallet) {
      console.error('❌ Cannot proceed - sponsor wallet not available for paymaster integration');
      return null;
    }
    
    try {
      console.log('🔍 Examining bundler configuration in detail...');
      
      // Try to access the bundler's internal paymaster client directly
      // @ts-ignore - Inspecting bundler internal properties
      const bundlerClient = bundler?._bundlerClient;
      
      if (bundlerClient) {
        console.log('✅ Bundler client is available');
        
        // @ts-ignore - Inspecting internal properties
        const paymasterConfig = bundlerClient.options?.paymaster;
        
        if (paymasterConfig) {
          console.log('✅ Paymaster is configured in bundler', {
            // @ts-ignore - Inspecting internal properties
            hasGetPaymasterData: !!paymasterConfig.getPaymasterData,
            // @ts-ignore - Inspecting internal properties
            type: paymasterConfig.type || 'unknown'
          });
          
          console.log('🧪 Testing bundler transaction flow...');
          
          // Get gas price
          const gasPrice = await bundler!.getUserOperationGasPrice();
          
          console.log('📤 Sending minimal user operation via bundler...');
          
          // Send a minimal user operation (0 ETH to self)
          const userOpHash = await bundler!.sendUserOperation({
            account: smartAccount!,
            calls: [
              {
                to: smartAccount!.address,
                value: 0n,
                data: '0x',
              },
            ],
            maxFeePerGas: gasPrice.slow.maxFeePerGas,
            maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
          });
          
          console.log('📫 User operation hash received:', userOpHash);
          
          // Wait for the transaction to be confirmed
          console.log('⏳ Waiting for transaction confirmation...');
          const receipt = await bundler!.waitForUserOperationReceipt({ hash: userOpHash });
          
          console.log('✅ Transaction confirmed! Hash:', receipt.receipt.transactionHash);
          return receipt.receipt.transactionHash;
        } else {
          console.error('❌ No paymaster configuration found in bundler');
          console.log('💡 This indicates the bundler was not initialized with a paymaster.');
          console.log('💡 Check the initialization in useWalletManager to ensure the paymaster client is created and passed to the bundler.');
          return null;
        }
      } else {
        console.error('❌ Cannot access bundler internal client');
        console.log('💡 This might indicate the bundler object structure is different than expected.');
        return null;
      }
    } catch (error) {
      console.error('❌ Error in debug user operation:', error);
      
      // Try to extract more details about the error
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        
        if (error.message.includes('paymaster') || error.message.includes('AA31')) {
          console.error('⚠️ Paymaster-related error detected!');
          console.error('This may indicate an issue with the paymaster integration.');
        }
        
        if (error.message.includes('initCode')) {
          console.error('⚠️ InitCode-related error detected!');
          console.error('This may indicate an issue with the smart account initialization.');
        }
        
        if (error.message.includes('sender')) {
          console.error('⚠️ Sender-related error detected!');
          console.error('This may indicate an issue with the smart account address.');
        }
      }
      
      return null;
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
    
    // Debug functions
    verifyPaymasterConfiguration,
    debugUserOpWithPaymaster,

    // Status setters
    setTxStatus,
    setSponsoredTxStatus,
    setSelfSponsoredTxStatus,
  };
}
