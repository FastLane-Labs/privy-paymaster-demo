import { useState, useEffect } from 'react';
import Head from 'next/head';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { initBundler, type ShBundler } from '@/utils/bundler';
import { publicClient, ENTRY_POINT_ADDRESS, ADDRESS_HUB, MONAD_CHAIN, RPC_URL } from '@/utils/config';
import { createUserOperation, packUserOperation, getUserOperationHash, encodeUserOperationForBundler } from '@/utils/userOp';
import { paymasterMode, initContract } from '@/utils/contracts';
import { privyWalletToViemWallet, createHybridPrivyWallet } from '@/utils/wallet';
import { encodeFunctionData, parseEther, formatEther, type Address, type Hex, WalletClient, createWalletClient, custom } from 'viem';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { entryPoint07Address, toPackedUserOperation, type UserOperation } from 'viem/account-abstraction';

// Import ABIs
import addressHubAbi from '@/abis/addressHub.json';
import paymasterAbi from '@/abis/paymaster.json';
import shmonadAbi from '@/abis/shmonad.json';

export default function Home() {
  const { login, authenticated, ready, user, createWallet } = usePrivy();
  const { wallets } = useWallets();
  const [embeddedWallet, setEmbeddedWallet] = useState<any>(null);
  const [viemWallet, setViemWallet] = useState<WalletClient | null>(null);
  const [smartAccount, setSmartAccount] = useState<any>(null);
  const [bundler, setBundler] = useState<ShBundler | null>(null);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [contractAddresses, setContractAddresses] = useState({
    paymaster: '' as Address,
    shmonad: '' as Address,
  });
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.001');
  const [viemTxHash, setViemTxHash] = useState('');
  const [viemTxStatus, setViemTxStatus] = useState('');
  
  // New state for balances and sponsored transactions
  const [walletBalance, setWalletBalance] = useState<string>('0');
  const [smartAccountBalance, setSmartAccountBalance] = useState<string>('0');
  const [sponsoredTxHash, setSponsoredTxHash] = useState('');
  const [sponsoredTxStatus, setSponsoredTxStatus] = useState('');
  const [sponsoredAmount, setSponsoredAmount] = useState('0.001');
  const [sponsoredRecipient, setSponsoredRecipient] = useState('');

  // New state for self-sponsored transactions
  const [bondedShmon, setBondedShmon] = useState<string>('0');
  const [paymasterDeposit, setPaymasterDeposit] = useState<string>('0');
  const [selfSponsoredAmount, setSelfSponsoredAmount] = useState('0.001');
  const [selfSponsoredRecipient, setSelfSponsoredRecipient] = useState('');
  const [selfSponsoredTxHash, setSelfSponsoredTxHash] = useState('');
  const [selfSponsoredTxStatus, setSelfSponsoredTxStatus] = useState('');
  const [shmonadAddress, setShmonadAddress] = useState<Address | null>(null);

  // Find the embedded wallet when wallets are available
  useEffect(() => {
    console.log("Wallets change detected:", wallets?.length);
    if (wallets && wallets.length > 0) {
      console.log("Available wallets:", wallets.map(w => w.walletClientType));
      
      // Find either embedded or privy wallet type (depending on Privy version)
      const embedded = wallets.find(wallet => 
        wallet.walletClientType === 'privy' || 
        wallet.walletClientType === 'embedded'
      );
      
      if (embedded) {
        console.log("Found embedded wallet:", embedded.address);
        setEmbeddedWallet(embedded);
        
        try {
          // Use simplified privyWalletToViemWallet function that handles different wallet types
          console.log("Creating Viem wallet using privyWalletToViemWallet...");
          const wallet = privyWalletToViemWallet(embedded);
          console.log("Viem wallet created successfully with address:", wallet.account?.address);
          setViemWallet(wallet);
        } catch (error) {
          console.error("Error creating Viem wallet:", error);
        }
      } else {
        console.log("No embedded wallet found. Available wallet types:", wallets.map((w: any) => w.walletClientType).join(', '));
      }
    }
  }, [wallets]);

  // Function to create an embedded wallet
  const createEmbeddedWallet = async () => {
    try {
      console.log("Creating embedded wallet...");
      if (createWallet) {
        await createWallet();
        console.log("Embedded wallet creation initiated");
      } else {
        console.error("createWallet function not available");
      }
    } catch (error) {
      console.error("Error creating embedded wallet:", error);
    }
  };

  // Initialize smart account and bundler when embedded wallet is available
  useEffect(() => {
    async function initializeAccount() {
      if (embeddedWallet && viemWallet && publicClient) {
        try {
          console.log("Initializing smart account...");
          setLoading(true);
          
          // Make sure we have a proper account
          if (!viemWallet?.account) {
            console.error("Viem wallet client or account is undefined");
            setTxStatus("Error: Failed to create wallet account");
            setLoading(false);
            return;
          }
          
          // Create smart account using a simpler approach
          console.log("Creating smart account for address:", viemWallet.account.address);
          
          try {
            // Using the viem wallet account for the smart account
            const account = await toSafeSmartAccount({
              client: publicClient,
              entryPoint: {
                address: ENTRY_POINT_ADDRESS,
                version: "0.7",
              },
              owners: [viemWallet.account],
              version: "1.4.1",
            } as any);
            
            console.log("Smart account created:", account.address);
            setSmartAccount(account);
            
            // Initialize bundler with smart account
            const bundlerInstance = initBundler(account, publicClient);
            console.log("Bundler initialized");
            setBundler(bundlerInstance);
            
            try {
              // Get contract addresses from the hub
              const addressHubContract = await initContract(
                ADDRESS_HUB,
                addressHubAbi,
                publicClient
              );
              
              console.log("Getting paymaster and shmonad addresses...");
              const paymaster = await addressHubContract.read.paymaster4337([]) as Address;
              const shmonad = await addressHubContract.read.shMonad([]) as Address;
              
              console.log("Contract addresses:", { paymaster, shmonad });
              setContractAddresses({
                paymaster,
                shmonad,
              });
            } catch (error) {
              console.error("Error getting contract addresses:", error);
              setTxStatus("Error: Failed to get contract addresses. Check network connectivity.");
            }
          } catch (error) {
            console.error("Error creating smart account:", error);
            setTxStatus("Error: Failed to create smart account. Check parameters and network.");
          }
          
          setLoading(false);
        } catch (error) {
          console.error("Error initializing smart account:", error);
          setTxStatus(`Initialization error: ${error instanceof Error ? error.message : String(error)}`);
          setLoading(false);
        }
      }
    }
    
    initializeAccount();
  }, [embeddedWallet]);

  // Fetch balances when accounts are available
  useEffect(() => {
    async function fetchBalances() {
      if (embeddedWallet && smartAccount && publicClient) {
        try {
          console.log("Fetching balances...");
          // Get EOA balance
          const eoaBalance = await publicClient.getBalance({
            address: embeddedWallet.address as Address
          });
          setWalletBalance(formatEther(eoaBalance));
          console.log("EOA balance:", formatEther(eoaBalance));

          // Get Smart Account balance
          const saBalance = await publicClient.getBalance({
            address: smartAccount.address
          });
          setSmartAccountBalance(formatEther(saBalance));
          console.log("Smart Account balance:", formatEther(saBalance));
        } catch (error) {
          console.error("Error fetching balances:", error);
        }
      }
    }

    fetchBalances();
    // Set up a refresh interval
    const interval = setInterval(fetchBalances, 30000); // refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [embeddedWallet, smartAccount, publicClient]);

  // Fetch additional data about shmonad bonds and paymaster deposit
  useEffect(() => {
    async function fetchExtendedData() {
      if (embeddedWallet && smartAccount && publicClient && contractAddresses.paymaster && contractAddresses.shmonad) {
        try {
          // Initialize shmonad and paymaster contracts
          console.log("Fetching shmonad and paymaster data...");
          
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
          
          setShmonadAddress(contractAddresses.shmonad);
          
          // Get policy ID from paymaster
          try {
            const policyId = await paymasterContract.read.POLICY_ID([]) as bigint;
            console.log("Paymaster policy ID:", policyId.toString());
            
            // Get paymaster deposit
            try {
              const deposit = await paymasterContract.read.getDeposit([]) as bigint;
              setPaymasterDeposit(formatEther(deposit));
              console.log("Paymaster deposit:", formatEther(deposit));
            } catch (depositError) {
              console.warn("Error fetching paymaster deposit:", depositError);
              setPaymasterDeposit("Error");
            }
            
            // Get smart account bonded amount to shmonad - with better error handling
            try {
              console.log("Calling balanceOfBonded with policyId:", policyId.toString(), "and account:", smartAccount.address);
              
              // Check if the function exists before calling
              if (typeof shMonadContract.read.balanceOfBonded !== 'function') {
                console.warn("balanceOfBonded function not found in contract ABI");
                setBondedShmon("0");
                return;
              }
              
              // Add a try-catch specifically for the contract call
              try {
                const bondedAmount = await shMonadContract.read.balanceOfBonded([
                  policyId,
                  smartAccount.address
                ]) as bigint;
                setBondedShmon(formatEther(bondedAmount));
                console.log("Smart account shmonad bonded:", formatEther(bondedAmount));
              } catch (contractCallError) {
                console.warn("Contract call error for balanceOfBonded:", contractCallError);
                // Check if this is expected behavior (e.g., account not registered yet)
                console.log("This may be normal for new accounts with no bonded tokens");
                setBondedShmon("0");
              }
            } catch (bondedError) {
              console.warn("Error preparing balanceOfBonded call:", bondedError);
              // Don't update state on error to keep previous value if any
              setBondedShmon("0");
            }
          } catch (policyError) {
            console.warn("Error fetching policy ID:", policyError);
          }
        } catch (error) {
          console.error("Error fetching extended data:", error);
        }
      }
    }

    fetchExtendedData();
    // Set up a refresh interval
    const interval = setInterval(fetchExtendedData, 30000); // refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [embeddedWallet, smartAccount, publicClient, contractAddresses]);

  // Function to send a transaction using the UserOperation
  async function sendTransaction() {
    if (!smartAccount || !bundler || !contractAddresses.paymaster || !viemWallet) {
      setTxStatus('Smart account, bundler, or wallet not initialized');
      return;
    }
    
    try {
      setLoading(true);
      setTxStatus('Preparing transaction...');
      
      // Create calldata for transfer - using empty data for simple ETH transfer
      const callData = '0x' as Hex;
      
      // Get gas price from bundler
      const gasPrice = await bundler.getUserOperationGasPrice();
      setTxStatus('Got gas price...');
      
      // Get nonce for the account
      const nonce = await publicClient.readContract({
        address: entryPoint07Address,
        abi: [{
          name: "getNonce",
          type: "function",
          stateMutability: "view",
          inputs: [
            { name: "sender", type: "address" },
            { name: "key", type: "uint192" }
          ],
          outputs: [{ type: "uint256" }]
        }],
        functionName: "getNonce",
        args: [smartAccount.address, 0n]
      });
      
      setTxStatus('Creating UserOperation...');
      
      // Create the recipient address - if not valid, send to self
      const to = recipient && recipient.startsWith('0x') && recipient.length === 42 
        ? recipient as Address 
        : smartAccount.address;
      
      // Create user operation params
      const userOpParams = {
        sender: smartAccount.address,
        nonce,
        initCode: '0x' as Hex,
        callData,
        callGasLimit: 100000n,
        verificationGasLimit: 100000n,
        preVerificationGas: 50000n,
        maxFeePerGas: gasPrice.slow.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
        paymaster: contractAddresses.paymaster,
        paymasterData: paymasterMode("user") as Hex,
        signature: '0x' as Hex
      };
      
      // Pack the UserOperation
      const packedUserOp = packUserOperation(userOpParams);
      
      // Calculate the UserOperation hash for signing
      const chainId = BigInt(MONAD_CHAIN.id);
      const userOpHash = getUserOperationHash(packedUserOp, ENTRY_POINT_ADDRESS, chainId);
      
      setTxStatus('Signing UserOperation...');
      
      // Use viemWallet for signing instead of embeddedWallet
      if (!viemWallet.account) {
        throw new Error("Wallet account is not initialized");
      }
      
      const signature = await viemWallet.signMessage({
        account: viemWallet.account,
        message: { raw: userOpHash },
      }) as Hex;
      
      // Update the UserOperation with the signature
      packedUserOp.signature = signature;
      
      setTxStatus('Sending UserOperation...');
      
      // Send the UserOperation through bundler
      const parsedAmount = parseEther(amount);
      
      const userOpHashFromBundler = await bundler.sendUserOperation({
        account: smartAccount,
        paymaster: contractAddresses.paymaster,
        paymasterData: paymasterMode("user") as Hex,
        calls: [
          {
            to: to,
            value: parsedAmount,
            data: '0x' as Hex,
          },
        ],
        maxFeePerGas: userOpParams.maxFeePerGas,
        maxPriorityFeePerGas: userOpParams.maxPriorityFeePerGas,
      });
      
      setTxHash(userOpHashFromBundler);
      setTxStatus('Waiting for transaction confirmation...');
      
      const receipt = await bundler.waitForUserOperationReceipt({
        hash: userOpHashFromBundler,
      });
      
      setTxStatus('Transaction confirmed!');
      setLoading(false);
    } catch (error) {
      console.error("Error sending transaction:", error);
      setTxStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setLoading(false);
    }
  }

  // Function to send a transaction using the Viem wallet client
  async function sendViemTransaction() {
    if (!viemWallet || !smartAccount || !bundler || !contractAddresses.paymaster) {
      setViemTxStatus('Viem wallet and smart account must be initialized');
      return;
    }
    
    try {
      setLoading(true);
      setViemTxStatus('Preparing bundled transaction...');
      
      // Check RPC connectivity first
      try {
        await publicClient.getChainId();
      } catch (error) {
        setViemTxStatus('Error: Cannot connect to RPC endpoint. Check your network connectivity.');
        setLoading(false);
        return;
      }
      
      // Create recipient address - if not valid, send to self
      const to = recipient && recipient.startsWith('0x') && recipient.length === 42 
        ? recipient as Address 
        : embeddedWallet.address as Address;
      
      // Get gas price from bundler
      const gasPrice = await bundler.getUserOperationGasPrice();
      setViemTxStatus('Got gas price from bundler...');
      
      // Parse the amount for the transaction
      const parsedAmount = parseEther(amount);
      
      // Instead of using direct eth_sendTransaction, use the bundler
      setViemTxStatus('Creating and sending UserOperation through bundler...');
      
      // Send the operation through the bundler (similar to the main sendTransaction function)
      const userOpHash = await bundler.sendUserOperation({
        account: smartAccount,
        paymaster: contractAddresses.paymaster,
        paymasterData: paymasterMode("user") as Hex,
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
      
      setViemTxHash(userOpHash);
      setViemTxStatus('Transaction sent through bundler! Waiting for confirmation...');
      
      // Wait for the receipt using the bundler
      const receipt = await bundler.waitForUserOperationReceipt({
        hash: userOpHash,
      });
      
      setViemTxStatus(`Transaction confirmed! UserOp Hash: ${userOpHash}`);
      setLoading(false);
    } catch (error) {
      console.error("Error sending bundled transaction:", error);
      setViemTxStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setLoading(false);
    }
  }

  // Function to send a sponsored transaction
  async function sendSponsoredTransaction() {
    if (!smartAccount || !bundler || !contractAddresses.paymaster) {
      setSponsoredTxStatus('Smart account, bundler, or paymaster not initialized');
      return;
    }
    
    if (!viemWallet) {
      setSponsoredTxStatus('ERROR: Viem wallet not initialized - cannot sign transaction');
      console.error("viemWallet is null or undefined");
      return;
    }
    
    // Verify account is available in viemWallet
    if (!viemWallet.account) {
      setSponsoredTxStatus('ERROR: Viem wallet account not available - cannot sign transaction');
      console.error("viemWallet.account is null or undefined");
      return;
    }
    
    try {
      setLoading(true);
      setSponsoredTxStatus('Preparing sponsored transaction...');
      
      // Create recipient address - if not valid, send to self
      const to = sponsoredRecipient && sponsoredRecipient.startsWith('0x') && sponsoredRecipient.length === 42 
        ? sponsoredRecipient as Address 
        : smartAccount.address;
      
      setSponsoredTxStatus('Getting gas price...');
      // Get gas price from bundler
      const gasPrice = await bundler.getUserOperationGasPrice();
      
      // Parse the amount for the transaction
      const parsedAmount = parseEther(sponsoredAmount);
      
      setSponsoredTxStatus('Preparing user operation...');
      
      // Initialize paymaster contract
      const paymasterContract = await initContract(
        contractAddresses.paymaster,
        paymasterAbi,
        publicClient
      );
      
      // Create all parameters for UserOperation
      const userOpParams = {
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
      };
      
      // Use the bundler to prepare a complete UserOperation
      const userOp = await bundler.prepareUserOperation(userOpParams);
      
      setSponsoredTxStatus('Setting validity times and getting hash...');
      // Set validity times for the transaction
      const validAfter = 0n;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 3600); // Valid for 1 hour
      
      // Get the hash to sign from the paymaster contract
      const hash = await paymasterContract.read.getHash([
        toPackedUserOperation(userOp as any),
        validUntil,
        validAfter,
      ]) as Hex;
      
      setSponsoredTxStatus(`Signing hash with viemWallet: ${hash.slice(0, 10)}...`);
      console.log("About to sign hash:", hash);
      console.log("Using viemWallet account:", viemWallet.account);
      
      try {
        // Sign the hash with the viem wallet
        const sponsorSignature = await viemWallet.signMessage({
          account: viemWallet.account,
          message: { raw: hash },
        });
        
        console.log("Successfully signed! Signature:", sponsorSignature);
        setSponsoredTxStatus('Constructing paymaster data with signature...');
        
        // Construct the paymasterData with the sponsor signature - fixed format to match contracts.ts
        // NOTE: Using the correct format from contracts.ts:
        // For "sponsor" mode, we need: 0x01 + sponsor address + validUntil + validAfter + signature
        const walletAddress = viemWallet.account.address;
        console.log("Using wallet address for sponsor:", walletAddress);
        
        const paymasterDataRaw = `0x01${walletAddress.slice(2)}${validUntil
          .toString(16)
          .padStart(12, "0")}${validAfter
          .toString(16)
          .padStart(12, "0")}${(sponsorSignature as Hex).slice(2)}`;
        
        console.log("Generated paymasterData:", paymasterDataRaw);
        
        setSponsoredTxStatus('Sending sponsored transaction...');
        // Send the user operation with all parameters
        const finalUserOpHash = await bundler.sendUserOperation({
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
          paymasterData: paymasterDataRaw as Hex,
          paymasterVerificationGasLimit: 75000n,
          paymasterPostOpGasLimit: 120000n,
        });
        
        setSponsoredTxHash(finalUserOpHash);
        setSponsoredTxStatus('Waiting for sponsored transaction confirmation...');
        
        const finalReceipt = await bundler.waitForUserOperationReceipt({
          hash: finalUserOpHash,
        });
        
        setSponsoredTxStatus(`Sponsored transaction confirmed! Transaction hash: ${finalReceipt.receipt.transactionHash}`);
      } catch (signError) {
        console.error("Error during message signing:", signError);
        setSponsoredTxStatus(`Signing error: ${signError instanceof Error ? signError.message : String(signError)}`);
      }
    } catch (error) {
      console.error("Error sending sponsored transaction:", error);
      setSponsoredTxStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  // Function to send a self-sponsored transaction
  async function sendSelfSponsoredTransaction() {
    if (!viemWallet || !smartAccount || !bundler || !contractAddresses.paymaster || !contractAddresses.shmonad) {
      setSelfSponsoredTxStatus('Smart account or bundler not initialized');
      return;
    }
    
    setLoading(true);
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
      
      // Step 2 from demo: Check if smart account has enough bonded balance
      const bondAmount = parseEther("2");  // 2 MON
      const smartAccountBondedAmount = await shMonadContract.read.balanceOfBonded([
        policyId,
        smartAccount.address
      ]) as bigint;
      setSelfSponsoredTxStatus(`Smart account has ${formatEther(smartAccountBondedAmount)} MON bonded...`);
      
      if (smartAccountBondedAmount < bondAmount) {
        setSelfSponsoredTxStatus(`Not enough bonded tokens. Need ${formatEther(bondAmount)} MON. Please add funds to your smart account first and try again.`);
        setLoading(false);
        return;
      }
      
      // Step 3 from demo: Check if paymaster has enough deposit
      const paymasterDeposit = await paymasterContract.read.getDeposit([]) as bigint;
      setSelfSponsoredTxStatus(`Paymaster has ${formatEther(paymasterDeposit)} MON deposited...`);
      
      const paymasterDepositAmount = parseEther("5");
      if (paymasterDeposit < paymasterDepositAmount) {
        setSelfSponsoredTxStatus(`Paymaster doesn't have enough deposit. Has ${formatEther(paymasterDeposit)} MON, needs ${formatEther(paymasterDepositAmount)} MON.`);
        setLoading(false);
        return;
      }
      
      // Step 4 from demo: Send user operation
      setSelfSponsoredTxStatus('Creating and sending UserOperation through bundler...');
      
      // Create recipient address - if not valid, send to self
      const to = selfSponsoredRecipient && selfSponsoredRecipient.startsWith('0x') && selfSponsoredRecipient.length === 42 
        ? selfSponsoredRecipient as Address 
        : smartAccount.address;
      
      // Parse the amount for the transaction
      const parsedAmount = parseEther(selfSponsoredAmount);
      
      // Get gas price from bundler
      const gasPrice = await bundler.getUserOperationGasPrice();
      
      // Send the user operation with "user" paymasterData (self-sponsored)
      const paymasterData = paymasterMode("user") as Hex;
      console.log("Self-sponsored transaction using paymaster data:", paymasterData);
      
      // Create the transaction calls
      const calls = [{
        to: contractAddresses.shmonad,
        data: encodeFunctionData({
          abi: shmonadAbi,
          functionName: 'transfer',
          args: [to, parsedAmount],
        }),
        value: 0n,
      }];
      
      // Create the user operation object
      const selfSponsoredUserOp = {
        account: smartAccount.address,
        calls,
        paymasterData: paymasterData,
      };

      // Estimate gas for the operation
      let selfSponsoredOpHash: `0x${string}`;
      try {
        const estimatedGas = await bundler.estimateUserOperationGas(selfSponsoredUserOp);
        console.log("Estimated gas for self-sponsored operation:", estimatedGas);
        
        // Send the self-sponsored UserOperation
        selfSponsoredOpHash = await bundler.sendUserOperation({
          ...selfSponsoredUserOp,
          paymasterVerificationGasLimit: estimatedGas.verificationGasLimit || 75000n,
          paymasterPostOpGasLimit: estimatedGas.paymasterPostOpGasLimit || 120000n,
          callGasLimit: estimatedGas.callGasLimit || 500000n,
          verificationGasLimit: estimatedGas.verificationGasLimit || 500000n,
          preVerificationGas: estimatedGas.preVerificationGas || 50000n,
        });
      } catch (gasEstimateError) {
        console.error("Error estimating gas for self-sponsored tx:", gasEstimateError);
        // Fallback to default values if estimation fails
        selfSponsoredOpHash = await bundler.sendUserOperation({
          ...selfSponsoredUserOp,
          paymasterVerificationGasLimit: 75000n,
          paymasterPostOpGasLimit: 120000n,
          callGasLimit: 500000n,
          verificationGasLimit: 500000n,
          preVerificationGas: 50000n,
        });
      }
      
      setSelfSponsoredTxHash(selfSponsoredOpHash);
      setSelfSponsoredTxStatus('Waiting for transaction confirmation...');
      
      // Wait for the transaction to be included in a block
      const transactionReceipt = await bundler.waitForUserOperationReceipt({
        hash: selfSponsoredOpHash,
      });

      setSelfSponsoredTxStatus(`Self-sponsored transaction confirmed! Transaction hash: ${transactionReceipt.receipt.transactionHash}`);
      setLoading(false);
      
      // Refresh balances
      if (embeddedWallet && smartAccount && publicClient) {
        const saBalance = await publicClient.getBalance({
          address: smartAccount.address
        });
        setSmartAccountBalance(formatEther(saBalance));
      }
    } catch (error) {
      console.error("Error sending self-sponsored transaction:", error);
      setSelfSponsoredTxStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setLoading(false);
    }
  }

  // Function to bond MON to shMON
  async function bondMonToShmon() {
    if (!viemWallet || !smartAccount || !contractAddresses.shmonad) {
      setTxStatus('Smart account and shmonad contract must be initialized');
      return;
    }
    
    try {
      setLoading(true);
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
        setLoading(false);
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
        setLoading(false);
        return;
      }
      
      // Get gas price from bundler
      if (!bundler) {
        setTxStatus("Bundler not initialized");
        setLoading(false);
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
      setBondedShmon(formatEther(newBondedAmount));
    } catch (error) {
      console.error("Error bonding MON to shMON:", error);
      setTxStatus(`Error bonding MON to shMON: ${error instanceof Error ? error.message : String(error)}`);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen p-4 bg-gray-50 text-gray-900">
      <Head>
        <title>Privy 4337 Demo</title>
        <meta name="description" content="ERC-4337 with Privy Wallet Demo" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Debug section */}
      <div className="fixed bottom-0 left-0 right-0 bg-red-100 p-4 text-xs font-mono z-50 max-h-48 overflow-auto">
        <h3 className="font-bold text-red-800">Debug Info:</h3>
        <div>Privy Ready: {ready ? 'Yes' : 'No'}</div>
        <div>Authenticated: {authenticated ? 'Yes' : 'No'}</div>
        <div>Wallets Available: {wallets ? wallets.length : 0}</div>
        <div>Wallets Types: {wallets ? wallets.map(w => w.walletClientType).join(', ') : 'None'}</div>
        <div>Embedded Wallet: {embeddedWallet ? 'Loaded' : 'Not Loaded'}</div>
        <div>Embedded Address: {embeddedWallet ? embeddedWallet.address : 'None'}</div>
        <div>Viem Wallet: {viemWallet ? 'Initialized' : 'Not Initialized'}</div>
        <div>Smart Account: {smartAccount ? smartAccount.address : 'Not Created'}</div>
        <div>Bundler: {bundler ? 'Ready' : 'Not Ready'}</div>
        <div>Paymaster: {contractAddresses.paymaster || 'Not Set'}</div>
        <div>Loading: {loading ? 'Yes' : 'No'}</div>
      </div>

      <main className="max-w-3xl mx-auto bg-white p-6 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
          Privy 4337 Account Abstraction Demo
        </h1>
        
        {!ready ? (
          <div className="text-center text-gray-700">Loading Privy...</div>
        ) : !authenticated ? (
          <div className="text-center">
            <button 
              className="button bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-md transition-colors" 
              onClick={() => login({
                createWallet: true
              } as any)}
            >
              Login with Privy
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="card bg-white border border-gray-200 p-6 rounded-lg shadow-sm">
              <h2 className="text-xl font-semibold mb-2 text-gray-800">Wallet Information</h2>
              <p className="text-gray-700">User: {user?.id}</p>
              {embeddedWallet ? (
                <div className="mt-2">
                  <p className="text-gray-700">Embedded Wallet Address: {embeddedWallet.address}</p>
                  {smartAccount && (
                    <p className="mt-2 text-gray-700">Smart Account Address: {smartAccount.address}</p>
                  )}
                  {viemWallet && (
                    <p className="mt-2 text-green-700">Viem Wallet: Initialized ✓</p>
                  )}
                  
                  {/* Display balances */}
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div className="p-3 bg-blue-50 rounded">
                      <p className="text-sm font-medium text-blue-800">EOA Balance:</p>
                      <p className="text-xl font-bold text-blue-600">{walletBalance} MON</p>
                    </div>
                    <div className="p-3 bg-purple-50 rounded">
                      <p className="text-sm font-medium text-purple-800">Smart Account Balance:</p>
                      <p className="text-xl font-bold text-purple-600">{smartAccountBalance} MON</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-gray-600 mb-2">No embedded wallet detected. You need to create one to use this demo.</p>
                  <p className="text-yellow-600 mb-2">Current wallets: {wallets ? wallets.map(w => w.walletClientType).join(', ') : 'None'}</p>
                  <button 
                    className="button bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-md transition-colors mt-2" 
                    onClick={createEmbeddedWallet}
                  >
                    Create Embedded Wallet
                  </button>
                </div>
              )}
            </div>
            
            {/* New section for sponsored transactions */}
            {smartAccount && (
              <div className="card bg-gradient-to-r from-green-50 to-blue-50 border border-green-100 p-6 rounded-lg shadow-sm">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">Sponsored Transaction</h2>
                <div className="mb-2 text-sm text-gray-700">
                  This transaction is sponsored by the paymaster - you don't need gas!
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700">
                    Recipient Address (Optional - defaults to self)
                  </label>
                  <input
                    type="text"
                    value={sponsoredRecipient}
                    onChange={(e) => setSponsoredRecipient(e.target.value)}
                    placeholder="0x..."
                    className="w-full p-2 border rounded text-gray-900"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700">
                    Amount (MON)
                  </label>
                  <input
                    type="text"
                    value={sponsoredAmount}
                    onChange={(e) => setSponsoredAmount(e.target.value)}
                    placeholder="0.001"
                    className="w-full p-2 border rounded text-gray-900"
                  />
                </div>
                <button
                  className="button w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded-md transition-colors"
                  onClick={sendSponsoredTransaction}
                  disabled={loading}
                >
                  {loading ? 'Processing...' : 'Send Sponsored Transaction'}
                </button>
                
                {sponsoredTxStatus && (
                  <div className="mt-4 p-3 bg-gray-100 rounded">
                    <p className="font-medium text-gray-800">Status:</p>
                    <p className="text-gray-700">{sponsoredTxStatus}</p>
                    {sponsoredTxHash && (
                      <p className="mt-2">
                        <span className="font-medium text-gray-800">Transaction Hash:</span>{' '}
                        <span className="break-all text-gray-700">{sponsoredTxHash}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* New section for self-sponsored transactions matching the demo script */}
            {smartAccount && (
              <div className="card bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-100 p-6 rounded-lg shadow-sm">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">Self-Sponsored Transaction (Demo Flow)</h2>
                <div className="mb-2 text-sm text-gray-700">
                  This follows the exact demo script flow for a self-sponsored transaction.
                </div>
                
                {/* Display bond and deposit information */}
                <div className="mb-4 grid grid-cols-2 gap-4">
                  <div className="p-3 bg-yellow-100 rounded text-sm">
                    <p className="font-medium text-gray-800">Bonded MON:</p>
                    <p className="text-lg font-bold text-amber-700">{bondedShmon} MON</p>
                    <p className="text-xs text-gray-600 mt-1">(Need 2.0 MON to self-sponsor)</p>
                  </div>
                  <div className="p-3 bg-orange-100 rounded text-sm">
                    <p className="font-medium text-gray-800">Paymaster Deposit:</p>
                    <p className="text-lg font-bold text-amber-700">{paymasterDeposit} MON</p>
                    <p className="text-xs text-gray-600 mt-1">(Need 5.0 MON for ops)</p>
                  </div>
                </div>
                
                {/* Add Bond button */}
                <div className="mb-4">
                  <button
                    className="button w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-md transition-colors mb-4"
                    onClick={bondMonToShmon}
                    disabled={loading || parseFloat(bondedShmon) >= 2.0}
                  >
                    {loading ? 'Processing...' : parseFloat(bondedShmon) >= 2.0 ? 'Already Bonded ✓' : 'Bond MON to shMON (2.0 MON)'}
                  </button>
                </div>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700">
                    Recipient Address (Optional - defaults to self)
                  </label>
                  <input
                    type="text"
                    value={selfSponsoredRecipient}
                    onChange={(e) => setSelfSponsoredRecipient(e.target.value)}
                    placeholder="0x..."
                    className="w-full p-2 border rounded text-gray-900"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700">
                    Amount (MON)
                  </label>
                  <input
                    type="text"
                    value={selfSponsoredAmount}
                    onChange={(e) => setSelfSponsoredAmount(e.target.value)}
                    placeholder="0.001"
                    className="w-full p-2 border rounded text-gray-900"
                  />
                </div>
                <button
                  className="button w-full bg-amber-600 hover:bg-amber-700 text-white font-medium py-2 rounded-md transition-colors"
                  onClick={sendSelfSponsoredTransaction}
                  disabled={loading || parseFloat(bondedShmon) < 2.0}
                >
                  {loading ? 'Processing...' : 'Send Self-Sponsored Transaction'}
                </button>
                
                {selfSponsoredTxStatus && (
                  <div className="mt-4 p-3 bg-amber-50 rounded">
                    <p className="font-medium text-gray-800">Status:</p>
                    <p className="text-gray-700">{selfSponsoredTxStatus}</p>
                    {selfSponsoredTxHash && (
                      <p className="mt-2">
                        <span className="font-medium text-gray-800">Transaction Hash:</span>{' '}
                        <span className="break-all text-gray-700">{selfSponsoredTxHash}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {smartAccount && (
              <div className="card bg-white border border-gray-200 p-6 rounded-lg shadow-sm">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">Send Transaction with Account Abstraction</h2>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700">
                    Recipient Address (Optional - defaults to self)
                  </label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="0x..."
                    className="w-full p-2 border rounded text-gray-900"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700">
                    Amount (MON)
                  </label>
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.001"
                    className="w-full p-2 border rounded text-gray-900"
                  />
                </div>
                <button
                  className="button w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-md transition-colors"
                  onClick={sendTransaction}
                  disabled={loading}
                >
                  {loading ? 'Processing...' : 'Send Transaction with AA'}
                </button>
                
                {txStatus && (
                  <div className="mt-4 p-3 bg-gray-100 rounded">
                    <p className="font-medium text-gray-800">Status:</p>
                    <p className="text-gray-700">{txStatus}</p>
                    {txHash && (
                      <p className="mt-2">
                        <span className="font-medium text-gray-800">Transaction Hash:</span>{' '}
                        <span className="break-all text-gray-700">{txHash}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {viemWallet && (
              <div className="card bg-white border border-gray-200 p-6 rounded-lg shadow-sm">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">Send Transaction with Viem Wallet</h2>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700">
                    Recipient Address (Optional - defaults to self)
                  </label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="0x..."
                    className="w-full p-2 border rounded text-gray-900"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700">
                    Amount (MON)
                  </label>
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.001"
                    className="w-full p-2 border rounded text-gray-900"
                  />
                </div>
                <button
                  className="button w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded-md transition-colors"
                  onClick={sendViemTransaction}
                  disabled={loading}
                >
                  {loading ? 'Processing...' : 'Send with Viem Wallet'}
                </button>
                
                {viemTxStatus && (
                  <div className="mt-4 p-3 bg-gray-100 rounded">
                    <p className="font-medium text-gray-800">Status:</p>
                    <p className="text-gray-700">{viemTxStatus}</p>
                    {viemTxHash && (
                      <p className="mt-2">
                        <span className="font-medium text-gray-800">Transaction Hash:</span>{' '}
                        <span className="break-all text-gray-700">{viemTxHash}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            
            <div className="card bg-gray-50 border border-gray-200 p-6 rounded-lg shadow-sm">
              <h2 className="text-xl font-semibold mb-2 text-gray-800">About This Demo</h2>
              <p className="text-gray-700">
                This demo shows how to use the Privy embedded wallet with ERC-4337 Account Abstraction.
                It creates a Smart Account for the embedded wallet and uses custom UserOperation 
                serialization to send transactions through a bundler with a paymaster.
              </p>
              <p className="mt-2 text-gray-700">
                Additionally, it demonstrates how to convert a Privy embedded wallet to a Viem wallet client,
                allowing you to use it with standard Viem functions.
              </p>
              <p className="mt-2 text-green-700 font-semibold">
                NEW: The demo now includes a sponsored transaction feature where gas fees are covered
                by the paymaster, enabling gasless transactions for your users!
              </p>
            </div>
          </div>
        )}
      </main>
      
      <style jsx global>{`
        html, body {
          background-color: #f5f7fa;
        }
        .button {
          display: inline-block;
          padding: 0.5rem 1rem;
          font-weight: 600;
          text-align: center;
          border-radius: 0.375rem;
          transition: all 150ms ease-in-out;
        }
        .card {
          border-radius: 0.5rem;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
} 