import { useState } from 'react';
import { publicClient } from '@/utils/config';
import { initContract } from '@/utils/contracts';
import { paymasterMode } from '@/utils/contracts';
import { toPackedUserOperation } from 'viem/account-abstraction';
import { encodeFunctionData, parseEther, formatEther, type Address, type Hex } from 'viem';
import paymasterAbi from '@/abis/paymaster.json';
import shmonadAbi from '@/abis/shmonad.json';
import { WalletManagerState } from './useWalletManager';

type TransactionState = {
  txHash: string;
  txStatus: string;
  sponsoredTxHash: string;
  sponsoredTxStatus: string;
  selfSponsoredTxHash: string;
  selfSponsoredTxStatus: string;
};

// Update the WalletManager interface to include setLoading
interface TransactionWalletManager extends Partial<WalletManagerState> {
  setLoading?: (loading: boolean) => void;
}

// Helper to handle transaction errors consistently
function handleTransactionError(error: unknown, setErrorStatus: (status: string) => void) {
  console.error("Transaction error:", error);
  
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
      console.log("Could not parse error details as JSON");
    }
    
    // Also check for AA24 code format directly in the message
    const aa24Match = errorMessage.match(/(AA\d+)\s+([^"]+)/);
    if (aa24Match) {
      if (!errorCode) errorCode = aa24Match[1];
      if (!detailedMessage) detailedMessage = aa24Match[2];
    }
    
    if (
      errorMessage.includes("signature error") || 
      errorMessage.includes("AA24") || 
      errorMessage.includes("Signature provided for the User Operation is invalid")
    ) {
      const errorDetail = errorCode ? `${errorCode}: ${detailedMessage || 'signature error'}` : 'signature error';
      setErrorStatus(
        `Signature validation failed (${errorDetail}). This may be due to an issue with your smart account configuration. ` +
        "Try refreshing the page or reconnecting your wallet."
      );
    } else if (errorMessage.includes("paymaster") || errorMessage.includes("AA31")) {
      const errorDetail = errorCode ? `${errorCode}: ${detailedMessage || 'paymaster error'}` : 'paymaster error';
      setErrorStatus(
        `Paymaster validation failed (${errorDetail}). The paymaster may be out of funds or rejecting the transaction.`
      );
    } else if (errorMessage.includes("gas")) {
      const errorDetail = errorCode ? `${errorCode}: ${detailedMessage || 'gas estimation error'}` : 'gas estimation error';
      setErrorStatus(
        `Gas estimation failed (${errorDetail}). The transaction may be too complex or your account may have insufficient funds.`
      );
    } else {
      // If we have detailed error info, include it
      const errorPrefix = errorCode ? `[${errorCode}] ` : '';
      const errorSuffix = detailedMessage ? `: ${detailedMessage}` : '';
      
      setErrorStatus(`Error${errorSuffix ? errorPrefix : ''}: ${errorMessage}${!errorSuffix && errorPrefix ? ` ${errorPrefix}` : ''}`);
    }
  } else {
    setErrorStatus(`Unknown error occurred. Please check the console for details.`);
  }
}

export function useTransactions(walletManager: TransactionWalletManager) {
  const { smartAccount, bundler, contractAddresses, sponsorWallet, setLoading } = walletManager;

  // Transaction state
  const [txHash, setTxHash] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [sponsoredTxHash, setSponsoredTxHash] = useState('');
  const [sponsoredTxStatus, setSponsoredTxStatus] = useState('');
  const [selfSponsoredTxHash, setSelfSponsoredTxHash] = useState('');
  const [selfSponsoredTxStatus, setSelfSponsoredTxStatus] = useState('');

  // Regular transaction
  async function sendTransaction(recipient: string, amount: string) {
    if (!smartAccount || !bundler) {
      setTxStatus('Smart account or bundler not initialized');
      return;
    }
    
    if (!contractAddresses?.paymaster) {
      setTxStatus('Paymaster address not available. Check network connectivity.');
      return;
    }
    
    if (!sponsorWallet) {
      setTxStatus('Sponsor wallet not initialized. Check if SPONSOR_PRIVATE_KEY is provided in your environment variables.');
      return;
    }
    
    try {
      setLoading?.(true);
      setTxStatus('Preparing transaction...');
            
      // Initialize paymasterContract
      const paymasterContract = await initContract(
        contractAddresses.paymaster,
        paymasterAbi,
        publicClient
      );

      // Create recipient address - if not valid, send to self
      const to = recipient && recipient.startsWith('0x') && recipient.length === 42 
        ? recipient as Address 
        : smartAccount.address;
      
      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);
      
      // Get gas price from bundler
      const gasPrice = await bundler.getUserOperationGasPrice();
      setTxStatus('Got gas price...');
            
      // Prepare a basic UserOperation with account and calls
      const userOperation = await bundler.prepareUserOperation({
        account: smartAccount,
        calls: [
          {
            to: to,
            value: parsedAmount,
          }
        ],
        maxFeePerGas: gasPrice.slow.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
      });
      
      // Log the UserOperation before signing
      console.log("UserOperation before signing:", userOperation);
      
      // Set validation times
      const validAfter = 0n;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 3600); // Valid for 1 hour
      
      // Get hash from paymaster contract
      const hash = await paymasterContract.read.getHash([
        toPackedUserOperation(userOperation as any),
        validUntil,
        validAfter,
      ]) as Hex;
      
      console.log("Hash to sign:", hash);

      if (!sponsorWallet.account) {
        throw new Error("Sponsor wallet not properly initialized. Check your environment variables.");
      }

      const sponsorSignature = await sponsorWallet.signMessage({
        message: { raw: hash as Hex },
        account: sponsorWallet.account
      });
      console.log("Sponsor signature:", sponsorSignature);
      // Create paymaster data
      const paymasterData = paymasterMode(
        "sponsor",
        validUntil,
        validAfter,
        sponsorSignature,
        sponsorWallet
      ) as Hex;
      
      // Create a proper UserOp with paymaster data for signing and submission
      const userOpWithPaymaster = {
        ...userOperation,
        paymaster: contractAddresses.paymaster,
        paymasterData: paymasterData,
        paymasterVerificationGasLimit: 75000n,
        paymasterPostOpGasLimit: 120000n,
      };
      
      // Sign the UserOperation
      setTxStatus('Signing UserOperation...');
      
      let signature: Hex;
      try {
        signature = await smartAccount.signUserOperation(userOpWithPaymaster) as Hex;
        console.log("Generated signature:", signature);
      } catch (signError) {
        console.error("Error signing UserOperation:", signError);
        setTxStatus(`Signing error: ${signError instanceof Error ? signError.message : String(signError)}`);
        setLoading?.(false);
        return;
      }
      
      // Send the UserOperation with all the required properties
      try {
        const userOpHash = await bundler.sendUserOperation({
          account: smartAccount,
          calls: [
            {
              to: to,
              value: parsedAmount,
            }
          ],
          maxFeePerGas: gasPrice.slow.maxFeePerGas,
          maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
          paymaster: contractAddresses.paymaster,
          paymasterData: paymasterData,
          paymasterVerificationGasLimit: 75000n,
          paymasterPostOpGasLimit: 120000n,
          signature: signature
        });
        
        setTxHash(userOpHash);
        setTxStatus('Waiting for transaction confirmation...');
        
        const receipt = await bundler.waitForUserOperationReceipt({
          hash: userOpHash,
        });
        
        setTxStatus('Transaction confirmed!');
        setLoading?.(false);
        return receipt;
      } catch (sendError) {
        handleTransactionError(sendError, setTxStatus);
        setLoading?.(false);
        return null;
      }
    } catch (error) {
      handleTransactionError(error, setTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Sponsored transaction
  async function sendSponsoredTransaction(recipient: string, amount: string) {
    if (!smartAccount || !bundler) {
      setSponsoredTxStatus('Smart account or bundler not initialized');
      return;
    }
    
    if (!contractAddresses?.paymaster) {
      setSponsoredTxStatus('Paymaster address not available. Check network connectivity.');
      return;
    }
    
    if (!sponsorWallet) {
      setSponsoredTxStatus('Sponsor wallet not initialized. Check if SPONSOR_PRIVATE_KEY is provided in your environment variables.');
      return;
    }
    
    try {
      setLoading?.(true);
      setSponsoredTxStatus('Preparing sponsored transaction...');
      
      // 1. Initialize contracts
      setSponsoredTxStatus('Initializing contracts...');
      const paymasterContract = await initContract(
        contractAddresses.paymaster,
        paymasterAbi,
        publicClient
      );
      
      const shMonadContract = await initContract(
        contractAddresses.shmonad,
        shmonadAbi,
        publicClient
      );
      
      // 2. Get policy ID and check balances
      const policyId = await paymasterContract.read.POLICY_ID([]) as bigint;
      setSponsoredTxStatus('Checking sponsor bond amounts...');
      
      // Check sponsor bonded amount
      let sponsorBondedAmount;
      try {
        sponsorBondedAmount = await shMonadContract.read.balanceOfBonded([
          policyId,
          sponsorWallet?.account?.address as Address
        ]) as bigint;
        console.log("Sponsor bonded amount:", formatEther(sponsorBondedAmount));
      } catch (error) {
        console.log("Sponsor has no bonded tokens");
        sponsorBondedAmount = 0n;
      }
      
      // Required bond amount
      const depositAmount = parseEther("2.5"); // 2.5 MON
      
      // Check if enough tokens are bonded
      if (sponsorBondedAmount < depositAmount) {
        setSponsoredTxStatus(`Not enough bonded tokens. Need ${formatEther(depositAmount)} MON bonded, but only have ${formatEther(sponsorBondedAmount)}. Please bond more tokens first.`);
        setLoading?.(false);
        return;
      }
      
      // Check paymaster deposit
      const paymasterDeposit = await paymasterContract.read.getDeposit([]) as bigint;
      setSponsoredTxStatus(`Paymaster has ${formatEther(paymasterDeposit)} MON deposited...`);
      
      if (paymasterDeposit < depositAmount) {
        setSponsoredTxStatus(`Paymaster doesn't have enough deposit. Has ${formatEther(paymasterDeposit)} MON, needs ${formatEther(depositAmount)} MON.`);
        setLoading?.(false);
        return;
      }
      
      // 3. Create recipient address
      const to = recipient && recipient.startsWith('0x') && recipient.length === 42 
        ? recipient as Address 
        : smartAccount.address;
      
      // 4. Get gas price and prepare the UserOperation
      setSponsoredTxStatus('Getting gas price and preparing user operation...');
      const gasPrice = await bundler.getUserOperationGasPrice();
      
      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);
      
      // 5. Prepare the UserOperation
      const userOperation = await bundler.prepareUserOperation({
        account: smartAccount,
        calls: [
          {
            to: to,
            value: parsedAmount,
            data: '0x' as Hex,
          }
        ],
        maxFeePerGas: gasPrice.slow.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
      });
      
      // 6. Set validation times
      setSponsoredTxStatus('Setting validity times and getting hash...');
      const validAfter = 0n;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 3600); // Valid for 1 hour
      
      // 7. Get hash to sign from paymaster contract
      const hash = await paymasterContract.read.getHash([
        toPackedUserOperation(userOperation as any),
        validUntil,
        validAfter,
      ]) as Hex;
      
      setSponsoredTxStatus(`Signing hash with wallet: ${hash.slice(0, 10)}...`);
      
      // 8. Sign the hash with the sponsor's wallet
      if (!sponsorWallet?.account) {
        throw new Error("Sponsor wallet not properly initialized. Check your environment variables.");
      }
      const sponsorSignature = await sponsorWallet.signMessage({
        message: { raw: hash },
        account: sponsorWallet.account,
      });
      
      // 9. Create paymaster data
      const paymasterData = paymasterMode(
        "sponsor",
        validUntil,
        validAfter,
        sponsorSignature
      ) as Hex;
      
      // Sign the user operation with paymaster data included
      let userOpSignature: Hex;
      try {
        setSponsoredTxStatus('Signing user operation...');
        userOpSignature = await smartAccount.signUserOperation({
          ...userOperation,
          paymaster: contractAddresses.paymaster,
          paymasterData: paymasterData
        }) as Hex;
        console.log("Generated user operation signature:", userOpSignature);
      } catch (signError) {
        console.error("Error signing sponsored UserOperation:", signError);
        setSponsoredTxStatus(`Signing error: ${signError instanceof Error ? signError.message : String(signError)}`);
        setLoading?.(false);
        return;
      }
      
      // Send the UserOperation
      try {
        setSponsoredTxStatus('Sending sponsored transaction...');
        const userOpHash = await bundler.sendUserOperation({
          account: smartAccount,
          calls: [
            {
              to: to,
              value: parsedAmount,
              data: '0x' as Hex,
            }
          ],
          maxFeePerGas: gasPrice.slow.maxFeePerGas,
          maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
          paymaster: contractAddresses.paymaster,
          paymasterData: paymasterData,
          paymasterVerificationGasLimit: 75000n,
          paymasterPostOpGasLimit: 120000n,
          signature: userOpSignature
        });
        
        setSponsoredTxHash(userOpHash);
        setSponsoredTxStatus('Waiting for sponsored transaction confirmation...');
        
        // 13. Wait for receipt and update UI
        const finalReceipt = await bundler.waitForUserOperationReceipt({
          hash: userOpHash,
        });
        
        setSponsoredTxStatus(`Sponsored transaction confirmed! Transaction hash: ${finalReceipt.receipt.transactionHash}`);
        setLoading?.(false);
        return finalReceipt;
      } catch (sendError) {
        handleTransactionError(sendError, setSponsoredTxStatus);
        setLoading?.(false);
        return null;
      }
    } catch (error) {
      handleTransactionError(error, setSponsoredTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Self-sponsored transaction
  async function sendSelfSponsoredTransaction(recipient: string, amount: string) {
    if (!smartAccount || !bundler || !contractAddresses?.paymaster || !contractAddresses?.shmonad) {
      setSelfSponsoredTxStatus('Smart account or bundler not initialized');
      return;
    }
    
    setLoading?.(true);
    setSelfSponsoredTxStatus('Preparing self-sponsored transaction...');
    
    try {
      // Initialize contracts
      const paymasterContract = await initContract(
        contractAddresses.paymaster,
        paymasterAbi,
        publicClient
      );
      
      const shMonadContract = await initContract(
        contractAddresses.shmonad,
        shmonadAbi,
        publicClient
      );
      
      // Get policy ID from paymaster
      const policyId = await paymasterContract.read.POLICY_ID([]) as bigint;
      console.log("Paymaster policy ID:", policyId.toString());
      
      // Check if smart account has enough bonded balance
      const bondAmount = parseEther("2");  // 2 MON
      const smartAccountBondedAmount = await shMonadContract.read.balanceOfBonded([
        policyId,
        smartAccount.address
      ]) as bigint;
      setSelfSponsoredTxStatus(`Smart account has ${formatEther(smartAccountBondedAmount)} MON bonded...`);
      
      if (smartAccountBondedAmount < bondAmount) {
        setSelfSponsoredTxStatus(`Not enough bonded tokens. Need ${formatEther(bondAmount)} MON. Please add funds to your smart account first and try again.`);
        setLoading?.(false);
        return;
      }
      
      // Check if paymaster has enough deposit
      const paymasterDeposit = await paymasterContract.read.getDeposit([]) as bigint;
      setSelfSponsoredTxStatus(`Paymaster has ${formatEther(paymasterDeposit)} MON deposited...`);
      
      const paymasterDepositAmount = parseEther("5");
      if (paymasterDeposit < paymasterDepositAmount) {
        setSelfSponsoredTxStatus(`Paymaster doesn't have enough deposit. Has ${formatEther(paymasterDeposit)} MON, needs ${formatEther(paymasterDepositAmount)} MON.`);
        setLoading?.(false);
        return;
      }
      
      // Send user operation
      setSelfSponsoredTxStatus('Creating and sending UserOperation through bundler...');
      
      // Create recipient address - if not valid, send to self
      const to = recipient && recipient.startsWith('0x') && recipient.length === 42 
        ? recipient as Address 
        : smartAccount.address;
      
      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);
      
      // Get gas price from bundler
      const gasPrice = await bundler.getUserOperationGasPrice();
      
      // Prepare the UserOperation
      const userOperation = await bundler.prepareUserOperation({
        account: smartAccount,
        calls: [{
          to: contractAddresses.shmonad,
          data: encodeFunctionData({
            abi: shmonadAbi,
            functionName: 'transfer',
            args: [to, parsedAmount],
          }),
          value: 0n,
        }],
        maxFeePerGas: gasPrice.slow.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
      });
      
      // Set validation times
      const validAfter = 0n;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 3600); // Valid for 1 hour
      
      // Get hash to sign from paymaster contract
      const hash = await paymasterContract.read.getHash([
        toPackedUserOperation(userOperation as any),
        validUntil,
        validAfter,
      ]) as Hex;
      
      console.log("Hash to sign for self-sponsored tx:", hash);
      
      // Send the user operation with "user" paymasterData (self-sponsored)
      const paymasterData = paymasterMode("user") as Hex;
      console.log("Self-sponsored transaction using paymaster data:", paymasterData);
      
      // Sign the UserOperation with proper paymaster data
      let signature: Hex;
      try {
        setSelfSponsoredTxStatus('Signing user operation...');
        signature = await smartAccount.signUserOperation({
          ...userOperation,
          paymaster: contractAddresses.paymaster,
          paymasterData: paymasterData
        }) as Hex;
        console.log("Generated self-sponsored signature:", signature);
      } catch (signError) {
        console.error("Error signing self-sponsored UserOperation:", signError);
        setSelfSponsoredTxStatus(`Signing error: ${signError instanceof Error ? signError.message : String(signError)}`);
        setLoading?.(false);
        return;
      }
      
      try {
        setSelfSponsoredTxStatus('Sending self-sponsored transaction...');
        
        // Send the self-sponsored UserOperation with proper paymaster data
        const selfSponsoredOpHash = await bundler.sendUserOperation({
          account: smartAccount,
          calls: [{
            to: contractAddresses.shmonad,
            data: encodeFunctionData({
              abi: shmonadAbi,
              functionName: 'transfer',
              args: [to, parsedAmount],
            }),
            value: 0n,
          }],
          maxFeePerGas: gasPrice.slow.maxFeePerGas,
          maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
          paymaster: contractAddresses.paymaster,
          paymasterData: paymasterData,
          paymasterVerificationGasLimit: 75000n,
          paymasterPostOpGasLimit: 120000n,
          signature: signature
        });
        
        setSelfSponsoredTxHash(selfSponsoredOpHash);
        setSelfSponsoredTxStatus('Waiting for transaction confirmation...');
        
        // Wait for the transaction to be included in a block
        const transactionReceipt = await bundler.waitForUserOperationReceipt({
          hash: selfSponsoredOpHash,
        });

        setSelfSponsoredTxStatus(`Self-sponsored transaction confirmed! Transaction hash: ${transactionReceipt.receipt.transactionHash}`);
        setLoading?.(false);
        return transactionReceipt;
      } catch (sendError) {
        handleTransactionError(sendError, setSelfSponsoredTxStatus);
        setLoading?.(false);
        return null;
      }
    } catch (error) {
      handleTransactionError(error, setSelfSponsoredTxStatus);
      setLoading?.(false);
      return null;
    }
  }

  // Bond MON to shMON
  async function bondMonToShmon() {
    if (!smartAccount || !contractAddresses?.shmonad) {
      setTxStatus('Smart account and shmonad contract must be initialized');
      return;
    }
    
    try {
      setLoading?.(true);
      setTxStatus('Preparing to bond MON to shMON...');
      
      // Initialize shmonad contract
      const shMonadContract = await initContract(
        contractAddresses.shmonad,
        shmonadAbi,
        publicClient
      );
      
      // Initialize paymaster contract to get policy ID
      const paymasterContract = await initContract(
        contractAddresses.paymaster,
        paymasterAbi,
        publicClient
      );
      
      // Get policy ID from paymaster
      const policyId = await paymasterContract.read.POLICY_ID([]) as bigint;
      
      // Check current bonded amount
      const currentBondedAmount = await shMonadContract.read.balanceOfBonded([
        policyId,
        smartAccount.address
      ]) as bigint;
      
      const bondAmount = parseEther("2"); // 2 MON
      
      if (currentBondedAmount >= bondAmount) {
        setTxStatus(`Already bonded ${formatEther(currentBondedAmount)} MON, which meets the requirement of 2 MON`);
        setLoading?.(false);
        return;
      }
      
      // Calculate amount to deposit
      const amountToDeposit = bondAmount - currentBondedAmount;
      
      // Calculate shMON to bond
      const shMONToBond = await shMonadContract.read.previewDeposit([
        amountToDeposit
      ]) as bigint;
      
      setTxStatus(`Preparing to deposit ${formatEther(amountToDeposit)} MON and bond ${formatEther(shMONToBond)} shMON...`);
      
      // First, create deposit transaction
      // We need to call the deposit function on the shMON contract
      const depositData = encodeFunctionData({
        abi: shmonadAbi,
        functionName: 'deposit',
        args: []
      });
      
      // Check smart account balance first
      const saBalance = await publicClient.getBalance({
        address: smartAccount.address
      });
      
      if (saBalance < amountToDeposit) {
        setTxStatus(`Insufficient balance in smart account. Need ${formatEther(amountToDeposit)} MON but have ${formatEther(saBalance)} MON.`);
        setLoading?.(false);
        return;
      }
      
      // Get gas price from bundler
      if (!bundler) {
        setTxStatus("Bundler not initialized");
        setLoading?.(false);
        return;
      }
      
      const depositGasPrice = await bundler.getUserOperationGasPrice();
      
      // Send the UserOperation through bundler
      const depositOpHash = await bundler.sendUserOperation({
        account: smartAccount,
        calls: [
          {
            to: contractAddresses.shmonad,
            value: amountToDeposit,
            data: depositData,
          }
        ],
        ...depositGasPrice.slow,
        // No paymaster for this operation since we're adding funds
      });
      
      setTxStatus(`Depositing MON to get shMON... Hash: ${depositOpHash}`);
      
      // Wait for the deposit transaction
      await bundler.waitForUserOperationReceipt({
        hash: depositOpHash,
      });
      
      // Now, bond the shMON
      // We need to call the bond function on the shMON contract
      const bondData = encodeFunctionData({
        abi: shmonadAbi,
        functionName: 'bond',
        args: [policyId, shMONToBond]
      });
      
      // Get gas price from bundler
      const bondGasPrice = await bundler.getUserOperationGasPrice();
      
      // For bond operation, we need to get paymaster data
      // The paymaster mode for user-sponsored transactions should be "user"
      const paymasterModeData = paymasterMode("user") as Hex;
      console.log("Using paymaster mode:", paymasterModeData); // Debug log
      
      // Create the user operation for bond
      const bondUserOp = {
        account: smartAccount,
        calls: [
          {
            to: contractAddresses.shmonad,
            value: 0n,
            data: bondData,
          }
        ],
        ...bondGasPrice.slow,
        paymaster: contractAddresses.paymaster,
        paymasterData: paymasterModeData,
      };
      
      // Estimate gas for the operation
      let bondOpHash: `0x${string}`;
      try {
        const estimatedGas = await bundler.estimateUserOperationGas(bondUserOp);
        console.log("Estimated gas for bond operation:", estimatedGas);
        
        // Send the bond UserOperation
        bondOpHash = await bundler.sendUserOperation({
          ...bondUserOp,
          paymasterVerificationGasLimit: estimatedGas.verificationGasLimit || 75000n,
          paymasterPostOpGasLimit: estimatedGas.paymasterPostOpGasLimit || 120000n,
          callGasLimit: estimatedGas.callGasLimit || 500000n,
          verificationGasLimit: estimatedGas.verificationGasLimit || 500000n,
          preVerificationGas: estimatedGas.preVerificationGas || 50000n,
        });
      } catch (gasEstimateError) {
        console.error("Error estimating gas:", gasEstimateError);
        // Fallback to default values if estimation fails
        bondOpHash = await bundler.sendUserOperation({
          ...bondUserOp,
          paymasterVerificationGasLimit: 75000n,
          paymasterPostOpGasLimit: 120000n,
          callGasLimit: 500000n,
          verificationGasLimit: 500000n,
          preVerificationGas: 50000n,
        });
      }
      
      setTxStatus(`Bonding shMON... Hash: ${bondOpHash}`);
      
      // Wait for the bond transaction
      await bundler.waitForUserOperationReceipt({
        hash: bondOpHash,
      });
      
      // Verify the new bonded amount
      const newBondedAmount = await shMonadContract.read.balanceOfBonded([
        policyId,
        smartAccount.address
      ]) as bigint;
      
      setTxStatus(`Successfully bonded MON to shMON! New bonded amount: ${formatEther(newBondedAmount)} shMON`);
      setLoading?.(false);
      return formatEther(newBondedAmount);
    } catch (error) {
      console.error("Error bonding MON to shMON:", error);
      setTxStatus(`Error bonding MON to shMON: ${error instanceof Error ? error.message : String(error)}`);
      setLoading?.(false);
      throw error;
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
    setSelfSponsoredTxStatus
  };
} 