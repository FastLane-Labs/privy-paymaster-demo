import { useState } from 'react';
import { publicClient } from '@/utils/config';
import { initContract } from '@/utils/contracts';
import { encodeFunctionData, parseEther, type Address, type Hex } from 'viem';
import shmonadAbi from '@/abis/shmonad.json';
import { WalletManagerState } from './useWalletManager';
import { ShBundlerClient } from '@/utils/bundler';
import { isAddress } from 'viem';
import { UserOperation } from 'viem/account-abstraction';

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
  const { smartAccount, bundler, contractAddresses, smartAccountClient, setLoading } =
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
            const userOp = await bundler.prepareUserOperation({
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
              bundler: !!bundler
            };
          } catch (prepareError) {
            console.error('❌ Error preparing user operation:', prepareError);
            return {
              paymaster: 'ERROR_PREPARING',
              smartAccount: !!smartAccount,
              bundler: !!bundler
            };
          }
        }
        
        return {
          paymaster: 'TESTING_INCOMPLETE',
          smartAccount: !!smartAccount,
          bundler: !!bundler
        };
      } catch (error) {
        console.error('❌ Error testing bundler functionality:', error);
        return {
          paymaster: 'ERROR',
          smartAccount: !!smartAccount,
          bundler: !!bundler
        };
      }
    }
    
    return {
      paymaster: 'NOT_CONFIGURED',
      smartAccount: !!smartAccount,
      bundler: !!bundler
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
      console.log('📱 Starting sponsored transaction flow...');
      console.log('📬 Recipient address received:', to);
      setTxStatus('Preparing transaction...');
      
      // Validate inputs
      if (!smartAccount || !bundler) {
        console.error('❌ Smart account or bundler not initialized');
        setTxStatus('Smart account or bundler not initialized');
        return null;
      }

      // Default gas limit values from demo script
      const paymasterVerificationGasLimit = 75000n;
      const paymasterPostOpGasLimit = 120000n;
      
      // Check if recipient address is valid - if not, use smart account address as fallback
      let targetAddress: Address;
      if (to && isAddress(to)) {
        targetAddress = to as Address;
        console.log('✅ Using provided recipient address:', targetAddress);
      } else {
        targetAddress = smartAccount.address;
        console.log('⚠️ Invalid or empty recipient address. Using smart account address as fallback:', targetAddress);
      }

      // Convert amount from ETH to wei
      let amountWei: bigint;
      try {
        amountWei = parseEther(amount);
        console.log('💰 Amount in wei:', amountWei.toString());
      } catch (error) {
        console.error('❌ Invalid amount:', amount);
        setTxStatus('Invalid amount');
        return null;
      }
      
      // Get gas prices from the bundler
      console.log('⛽ Getting gas prices...');
      setTxStatus('Getting gas prices...');
      
      const gasPrice = await bundler.getUserOperationGasPrice();
      console.log('✅ Gas prices received:', {
        slow: `${gasPrice.slow.maxFeePerGas.toString()} / ${gasPrice.slow.maxPriorityFeePerGas.toString()}`,
        standard: `${gasPrice.standard.maxFeePerGas.toString()} / ${gasPrice.standard.maxPriorityFeePerGas.toString()}`,
        fast: `${gasPrice.fast.maxFeePerGas.toString()} / ${gasPrice.fast.maxPriorityFeePerGas.toString()}`
      });
      
      try {
        // STEP 1: Prepare the user operation
        console.log('🔄 Preparing and signing user operation...');
        setTxStatus('Preparing and signing user operation...');
        
        // First create the user operation but don't send it
        const userOperation = await bundler.prepareUserOperation({
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
        
        console.log('✅ User operation prepared:', {
          sender: userOperation.sender,
          nonce: userOperation.nonce.toString(),
          callGasLimit: userOperation.callGasLimit?.toString() || 'not set',
          verificationGasLimit: userOperation.verificationGasLimit?.toString() || 'not set',
          preVerificationGas: userOperation.preVerificationGas?.toString() || 'not set',
          hasPaymasterData: !!userOperation.paymasterAndData && userOperation.paymasterAndData !== '0x',
        });
        
        // STEP 2: Explicitly sign the user operation
        console.log('✍️ Explicitly signing the user operation with smart account owner...');
        const signature = await smartAccount.signUserOperation(userOperation);
        
        // Update the signature in the user operation
        userOperation.signature = signature;
        console.log('✅ User operation signed with signature:', signature.substring(0, 10) + '...');
        
        // STEP 3: Send the signed user operation
        console.log('📤 Submitting signed user operation...');
        setTxStatus('Submitting signed transaction...');
        
        // We must create a new sendUserOperation call with the account parameter
        // This is required by the API - the account is used for type checking and validation
        // but not for signing (since we already signed the operation)
        const userOpHash = await bundler.sendUserOperation(userOperation as UserOperation);
        
        console.log('✅ Sponsored transaction submitted with hash:', userOpHash);
        setTxStatus('Transaction submitted, waiting for confirmation...');
        
        // Wait for receipt
        const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash });
        console.log('✅ Sponsored transaction confirmed! Hash:', receipt.receipt.transactionHash);
        setTxStatus('Sponsored transaction confirmed!');
        
        return receipt.receipt.transactionHash;
      } catch (error) {
        console.error('❌ Sponsored transaction failed:', error);
        
        // Extract more detailed error message if possible
        let errorMessage = 'Sponsored transaction failed';
        
        if (error instanceof Error) {
          errorMessage = error.message;
          
          // Check for specific error types
          if (error.message.includes('paymaster fields must be set together')) {
            errorMessage = 'Paymaster configuration error - fields must be set together';
            console.error('❌ Detailed error about paymaster fields:', error);
            
            // This suggests the bundler's paymaster integration is not correctly configured
            console.warn('⚠️ Make sure the paymaster is properly set up in your bundler configuration');
          } else if (error.message.includes('paymaster required')) {
            errorMessage = 'Paymaster required but not configured correctly';
          } else if (error.message.includes('gas')) {
            errorMessage = 'Gas estimation failed for sponsored transaction';
          } else if (error.message.includes('signature')) {
            errorMessage = 'Signature validation failed for sponsored transaction';
            console.error('❌ Signature error details:', error);
            console.warn('⚠️ This could be related to the Privy signature popup not showing');
          }
        }
        
        // Set error status and fail - no fallback
        setTxStatus(`Sponsored transaction failed: ${errorMessage}`);
        return null;
      }
    } catch (error) {
      console.error('❌ Error in sendSponsoredTransaction:', error);
      
      let errorMessage = 'Unknown error in sponsored transaction';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      setTxStatus(`Sponsored transaction failed: ${errorMessage}`);
      return null;  // No fallback
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
      return null;
    }

    if (!contractAddresses?.shmonad) {
      setTxStatus('shMONAD contract address not available. Check network connectivity.');
      return null;
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

      // Use the bundler with paymaster integration for sponsored transaction
      if (bundler) {
        setTxStatus('Using paymaster-sponsored transaction for bonding...');
        console.log('💵 Sending bond transaction via bundler with paymaster');
        
        try {
          // Get gas price
          const gasPrice = await bundler.getUserOperationGasPrice();
          console.log('✅ Gas prices received for bonding:', {
            slow: `${gasPrice.slow.maxFeePerGas.toString()} / ${gasPrice.slow.maxPriorityFeePerGas.toString()}`,
            standard: `${gasPrice.standard.maxFeePerGas.toString()} / ${gasPrice.standard.maxPriorityFeePerGas.toString()}`
          });
          
          // STEP 1: First prepare a minimal user operation to get initial values
          console.log('📝 Preparing bond operation...');
          setTxStatus('Preparing bond operation...');
          
          // This step will validate the operation but won't submit anything
          const preparedOp = await bundler.prepareUserOperation({
            account: smartAccount,
            calls: [
              {
                to: contractAddresses.shmonad as Address,
                value: bondAmount,
                data: callData as Hex,
              }
            ]
          });
          
          console.log('✅ Initial bond operation prepared:', {
            sender: preparedOp.sender,
            nonce: preparedOp.nonce.toString(),
            callGasLimit: preparedOp.callGasLimit?.toString() || 'not set',
            verificationGasLimit: preparedOp.verificationGasLimit?.toString() || 'not set',
            preVerificationGas: preparedOp.preVerificationGas?.toString() || 'not set',
            hasPaymasterData: !!preparedOp.paymasterAndData && preparedOp.paymasterAndData !== '0x',
          });
          console.log('Full user operation:', serializeBigInt(preparedOp));
          
          // STEP 2: Send the bond operation with the bundler
          console.log('🚀 Sending sponsored bond operation...');
          setTxStatus('Sending sponsored bond transaction...');
          
          const userOpHash = await bundler.sendRawUserOperation({
            ...userOpParams,
            userOperation: preparedOp
          });
          
          console.log('✅ Bond operation submitted with hash:', userOpHash);
          setTxHash(userOpHash);
          setTxStatus('Bond transaction submitted, waiting for confirmation...');

          // Wait for receipt and update UI
          const receipt = await bundler.waitForUserOperationReceipt({
            hash: userOpHash,
          });

          setTxStatus(`Sponsored bond transaction confirmed! Transaction hash: ${receipt.receipt.transactionHash}`);
          setLoading?.(false);
          return receipt;
        } catch (error) {
          console.error('❌ Sponsored bond transaction failed:', error);
          
          // Extract more detailed error message if possible
          let errorMessage = 'Sponsored bond transaction failed';
          
          if (error instanceof Error) {
            errorMessage = error.message;
            
            // Check for specific error types
            if (error.message.includes('paymaster fields must be set together')) {
              errorMessage = 'Paymaster configuration error - fields must be set together';
              console.error('❌ Detailed error about paymaster fields:', error);
              
              // This suggests the bundler's paymaster integration is not correctly configured
              console.warn('⚠️ The Zero-dev bundler paymaster integration may not be correctly configured');
              console.warn('⚠️ Make sure the paymaster is properly set up in your bundler configuration');
            } else if (error.message.includes('paymaster required')) {
              errorMessage = 'Paymaster required but not configured correctly';
            } else if (error.message.includes('gas')) {
              errorMessage = 'Gas estimation failed for sponsored bond transaction';
            } else if (error.message.includes('signature')) {
              errorMessage = 'Signature validation failed for sponsored bond transaction';
              console.error('❌ Signature error details:', error);
              console.warn('⚠️ This could be related to the Privy signature popup not showing');
            }
          }
          
          // Set error status and fail - no fallback
          setTxStatus(`Sponsored bond transaction failed: ${errorMessage}`);
          setLoading?.(false);
          return null;
        }
      }
      // Use non-sponsored transaction via smartAccountClient
      else if (smartAccountClient) {
        setTxStatus('Using non-sponsored transaction for bonding...');
        console.log('💰 Using smart account client directly for non-sponsored bonding');

        try {
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
        } catch (error) {
          console.error('❌ Non-sponsored bond transaction failed:', error);
          setTxStatus('Non-sponsored bond transaction failed: ' + (error as Error).message);
          setLoading?.(false);
          return null;
        }
      } else {
        console.error('No suitable client available for bonding');
        setTxStatus('No suitable client available for bonding');
        setLoading?.(false);
        return null;
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
    console.log('Paymaster address:', contractAddresses?.paymaster ? `✅ ${contractAddresses.paymaster}` : '❌ Missing');
    console.log('Paymaster ABI:', '✅ Should be imported from abis/paymaster.json');
    
    // First verify the paymaster configuration
    const config = await verifyPaymasterConfiguration();
    
    if (!config.smartAccount || !config.bundler) {
      console.error('❌ Cannot proceed - smart account or bundler not available');
      return null;
    }
    
    try {
      console.log('🧪 Testing bundler transaction flow...');
      
      // Get gas price
      const gasPrice = await bundler!.getUserOperationGasPrice();
      console.log('✅ Got gas prices:', {
        slow: `${gasPrice.slow.maxFeePerGas.toString()} / ${gasPrice.slow.maxPriorityFeePerGas.toString()}`,
        standard: `${gasPrice.standard.maxFeePerGas.toString()} / ${gasPrice.standard.maxPriorityFeePerGas.toString()}`,
        fast: `${gasPrice.fast.maxFeePerGas.toString()} / ${gasPrice.fast.maxPriorityFeePerGas.toString()}`
      });
      
      // First try to prepare a user operation to check if paymaster data is included
      console.log('🔍 Preparing user operation to check for paymaster data...');
      const preparedOp = await bundler!.prepareUserOperation({
        account: smartAccount!,
        calls: [
          {
            to: smartAccount!.address,
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
      console.log('📤 Sending minimal user operation via bundler...');
      
      // Send a minimal user operation (0 ETH to self)
      const userOpHash = await bundler!.sendRawUserOperation({
        ...userOpParams,
        userOperation: preparedOp
      });
      
      console.log('📫 User operation hash received:', userOpHash);
      
      // Wait for the transaction to be confirmed
      console.log('⏳ Waiting for transaction confirmation...');
      const receipt = await bundler!.waitForUserOperationReceipt({ hash: userOpHash });
      
      console.log('✅ Transaction confirmed! Hash:', receipt.receipt.transactionHash);
      return receipt.receipt.transactionHash;
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

  // New method to directly verify paymaster integration using the enhanced bundler
  const verifyPaymasterIntegrationDirect = async () => {
    if (!bundler) {
      console.error('❌ Cannot verify paymaster integration - bundler not available');
      return false;
    }
    
    // Check if the bundler has the verifyPaymasterIntegration method
    if ('verifyPaymasterIntegration' in bundler) {
      try {
        // @ts-ignore - The verifyPaymasterIntegration method is added dynamically
        const result = await bundler.verifyPaymasterIntegration();
        return result;
      } catch (error) {
        console.error('❌ Error verifying paymaster integration:', error);
        return false;
      }
    } else {
      console.warn('⚠️ Bundler does not have verifyPaymasterIntegration method');
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
