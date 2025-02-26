import { useState, useEffect } from 'react';
import Head from 'next/head';
import { usePrivy, useWallets, useCreateWallet, Wallet, ConnectedWallet } from '@privy-io/react-auth';
import { initBundler, type ShBundler } from '@/utils/bundler';
import { publicClient, ENTRY_POINT_ADDRESS, ADDRESS_HUB, MONAD_CHAIN, RPC_URL, SPONSOR_PRIVATE_KEY } from '@/utils/config';
import { paymasterMode, initContract } from '@/utils/contracts';
import { encodeFunctionData, parseEther, formatEther, type Address, type Hex, WalletClient, createWalletClient, custom, http } from 'viem';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { toPackedUserOperation, type UserOperation } from 'viem/account-abstraction';
import { createPublicClient } from 'viem';

// Import ABIs
import addressHubAbi from '@/abis/addressHub.json';
import paymasterAbi from '@/abis/paymaster.json';
import shmonadAbi from '@/abis/shmonad.json';
import { privateKeyToAccount } from 'viem/accounts';

// Function to adapt the Privy wallet to a compatible wallet for Safe
function adaptPrivyWallet(privyWallet: any): any {
  // Create an adapted wallet that includes required properties
  return {
    ...privyWallet,
    account: {
      address: privyWallet.address,
      type: 'json-rpc',
    },
    getAddresses: async () => [privyWallet.address],
  };
}

export default function Home() {
  const { login, authenticated, ready, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { wallets } = useWallets();
  const [embeddedWallet, setEmbeddedWallet] = useState< ConnectedWallet | null>(null);
  const [smartAccount, setSmartAccount] = useState<any>(null);
  const [sponsorWallet, setSponsorWallet] = useState<any>(null);
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
        setEmbeddedWallet(embedded as ConnectedWallet);
      } else {
        console.log("No embedded wallet found. Available wallet types:", wallets.map((w: any) => w.walletClientType).join(', '));
      }
    }
  }, [wallets]);


  const createSponsorWallet = async () => {
    const sponsorAccount = privateKeyToAccount(SPONSOR_PRIVATE_KEY as Hex);
    const sponsorWallet = createWalletClient({
      account: sponsorAccount,
      chain: MONAD_CHAIN,
      transport: http(RPC_URL),
    });

    return sponsorWallet;
  }

  // Initialize smart account and bundler when embedded wallet is available
  useEffect(() => {
    async function initializeAccount() {
      if (embeddedWallet) {
        try {
          console.log("Initializing smart account...");
          // Add detailed logging of the embedded wallet`
          setLoading(true);
          
          try {
            // Use the proper approach for Safe smart account with Privy
            console.log("Creating Safe smart account with Privy wallet...");
            
            const embeddedWalletProvider = await embeddedWallet.getEthereumProvider();
            const embeddedWalletClient = createPublicClient({
              chain: MONAD_CHAIN,
              transport: custom(embeddedWalletProvider),
            });

            // Create a compatible wallet for Safe account creation
            const walletForSafe = createWalletClient({
              account: { address: embeddedWallet.address as Address, type: 'json-rpc' },
              transport: custom(embeddedWalletProvider)
            });

            const smartAccount = await toSafeSmartAccount({
              client: embeddedWalletClient,
              entryPoint: {
                address: ENTRY_POINT_ADDRESS,
                version: "0.7",
              },
              owners: [walletForSafe],
              version: "1.4.1",
            });
            
            console.log("Smart account created:", smartAccount.address);
            setSmartAccount(smartAccount);
            
            // Initialize bundler with smart account
            const bundlerInstance = initBundler(smartAccount as any, publicClient);
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
            console.error("Error details:", error instanceof Error ? {
              message: error.message,
              stack: error.stack,
              name: error.name
            } : String(error));
            setTxStatus("Error: Failed to create smart account. Check parameters and network.");
          }
          
          setLoading(false);
        } catch (error) {
          console.error("Error initializing smart account:", error);
          setTxStatus(`Initialization error: ${error instanceof Error ? error.message : String(error)}`);
          setLoading(false);
        }
      }
      console.log("SPONSOR_PRIVATE_KEY:", SPONSOR_PRIVATE_KEY);
      if (SPONSOR_PRIVATE_KEY) {
        try {
          console.log("Creating sponsor wallet with private key");
          const sponsorWallet = await createSponsorWallet();
          console.log("Sponsor wallet created:", sponsorWallet.account?.address);
          setSponsorWallet(sponsorWallet);
        } catch (error) {
          console.error("Failed to create sponsor wallet:", error);
          setTxStatus("Failed to create sponsor wallet. Check your SPONSOR_PRIVATE_KEY.");
        }
      } else {
        console.warn("No SPONSOR_PRIVATE_KEY provided. Sponsored transactions will not work.");
        // Clear any previously set sponsor wallet
        setSponsorWallet(null);
      }
    }
    
    initializeAccount();
  }, [embeddedWallet, SPONSOR_PRIVATE_KEY]);

  // Fetch balances when accounts are available
  useEffect(() => {
    async function fetchBalances() {
      if (embeddedWallet && smartAccount) {
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
  }, [embeddedWallet, smartAccount]);

  // Fetch additional data about shmonad bonds and paymaster deposit
  useEffect(() => {
    async function fetchExtendedData() {
      if (embeddedWallet && smartAccount && publicClient && contractAddresses.paymaster && contractAddresses.shmonad) {
        try {
          // Initialize shmonad and paymaster contracts
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
            
            // Get paymaster deposit
            try {
              const deposit = await paymasterContract.read.getDeposit([]) as bigint;
              setPaymasterDeposit(formatEther(deposit));
            } catch (depositError) {
              console.warn("Error fetching paymaster deposit");
              setPaymasterDeposit("Error");
            }
            
            // Get smart account bonded amount to shmonad
            try {
              // Check if the function exists before calling
              if (typeof shMonadContract.read.balanceOfBonded !== 'function') {
                console.warn("balanceOfBonded function not found in contract ABI");
                setBondedShmon("0");
                return;
              }
              
              // Handle expected contract revert for accounts with no bonds
              try {
                const bondedAmount = await shMonadContract.read.balanceOfBonded([
                  policyId,
                  smartAccount.address
                ]) as bigint;
                setBondedShmon(formatEther(bondedAmount));
              } catch (contractCallError) {
                // This is expected behavior for new accounts - the contract reverts instead of returning 0
                setBondedShmon("0");
              }
            } catch (bondedError) {
              // Only log if this is an unexpected error
              console.warn("Unexpected error checking bonded tokens");
              setBondedShmon("0");
            }
          } catch (policyError) {
            console.warn("Error fetching policy ID");
          }
        } catch (error) {
          console.error("Error initializing contracts");
        }
      }
    }

    fetchExtendedData();
    // Set up a refresh interval with reduced frequency to avoid excessive error logs
    const interval = setInterval(fetchExtendedData, 60000); // refresh every minute
    
    return () => clearInterval(interval);
  }, [embeddedWallet, smartAccount, contractAddresses]);

  // Function to send a transaction using the UserOperation
  async function sendTransaction() {
    if (!smartAccount || !bundler) {
      setTxStatus('Smart account or bundler not initialized');
      return;
    }
    
    if (!contractAddresses.paymaster) {
      setTxStatus('Paymaster address not available. Check network connectivity.');
      return;
    }
    
    if (!sponsorWallet) {
      setTxStatus('Sponsor wallet not initialized. Check if SPONSOR_PRIVATE_KEY is provided in your environment variables.');
      return;
    }
    
    try {
      setLoading(true);
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
            
      // Prepare a basic UserOperation with account and calls, similar to standalone script
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
      
      // Set validation times like in standalone script
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
        message: { raw: hash as Hex }
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
      
      // Sign the UserOperation with the appropriate method based on account type
      setTxStatus('Signing UserOperation...');
      
      // Check if the account is a Safe account
      const isSafeAccount = 'owners' in smartAccount;
      console.log("Is Safe account:", isSafeAccount);
      
      const signature = await smartAccount.signUserOperation(userOpWithPaymaster) as Hex;
      
      console.log("Generated signature:", signature);
      
      // Send the UserOperation with all the required properties
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
      setLoading(false);
    } catch (error) {
      console.error("Error sending transaction:", error);
      setTxStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setLoading(false);
    }
  }

  // Function to send a sponsored transaction
  async function sendSponsoredTransaction() {
    if (!smartAccount || !bundler) {
      setSponsoredTxStatus('Smart account or bundler not initialized');
      return;
    }
    
    if (!contractAddresses.paymaster) {
      setSponsoredTxStatus('Paymaster address not available. Check network connectivity.');
      return;
    }
    
    if (!sponsorWallet) {
      setSponsoredTxStatus('Sponsor wallet not initialized. Check if SPONSOR_PRIVATE_KEY is provided in your environment variables.');
      return;
    }
    
    try {
      setLoading(true);
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
      
      // 2. Get policy ID and check balances (similar to standalone script)
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
      
      // Required bond amount (same as in standalone script)
      const depositAmount = parseEther("2.5"); // 2.5 MON
      
      // Check if enough tokens are bonded
      if (sponsorBondedAmount < depositAmount) {
        setSponsoredTxStatus(`Not enough bonded tokens. Need ${formatEther(depositAmount)} MON bonded, but only have ${formatEther(sponsorBondedAmount)}. Please bond more tokens first.`);
        setLoading(false);
        return;
      }
      
      // Check paymaster deposit
      const paymasterDeposit = await paymasterContract.read.getDeposit([]) as bigint;
      setSponsoredTxStatus(`Paymaster has ${formatEther(paymasterDeposit)} MON deposited...`);
      
      if (paymasterDeposit < depositAmount) {
        setSponsoredTxStatus(`Paymaster doesn't have enough deposit. Has ${formatEther(paymasterDeposit)} MON, needs ${formatEther(depositAmount)} MON.`);
        setLoading(false);
        return;
      }
      
      // 3. Create recipient address
      const to = sponsoredRecipient && sponsoredRecipient.startsWith('0x') && sponsoredRecipient.length === 42 
        ? sponsoredRecipient as Address 
        : smartAccount.address;
      
      // 4. Get gas price and prepare the UserOperation
      setSponsoredTxStatus('Getting gas price and preparing user operation...');
      const gasPrice = await bundler.getUserOperationGasPrice();
      
      // Parse the amount for the transaction
      const parsedAmount = parseEther(sponsoredAmount);
      
      // 5. Prepare the UserOperation - following standalone script approach
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
      
      // 7. Get hash to sign from paymaster contract - exactly like in standalone script
      const hash = await paymasterContract.read.getHash([
        toPackedUserOperation(userOperation as any),
        validUntil,
        validAfter,
      ]) as Hex;
      
      setSponsoredTxStatus(`Signing hash with wallet: ${hash.slice(0, 10)}...`);
      
      // 8. Sign the hash with the sponsor's wallet - using sponsorWallet which has correct typing
      if (!sponsorWallet?.account) {
        throw new Error("Sponsor wallet not properly initialized. Check your environment variables.");
      }
      const sponsorSignature = await sponsorWallet.signMessage({
        message: { raw: hash },
        account: sponsorWallet.account,
      });
      
      // 9. Create paymaster data using the same helper as standalone script
      const paymasterData = paymasterMode(
        "sponsor",
        validUntil,
        validAfter,
        sponsorSignature
      ) as Hex;
      
      // Create a copy of userOperation with the correct paymaster properties
      const packedUserOp = {
        ...userOperation,
        signature: await smartAccount.signUserOperation({
          ...userOperation,
          paymaster: contractAddresses.paymaster,
          paymasterData: paymasterData
        })
      };
      
      // 12. Send the UserOperation - using same approach as standalone script
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
      });
      
      setSponsoredTxHash(userOpHash);
      setSponsoredTxStatus('Waiting for sponsored transaction confirmation...');
      
      // 13. Wait for receipt and update UI
      const finalReceipt = await bundler.waitForUserOperationReceipt({
        hash: userOpHash,
      });
      
      setSponsoredTxStatus(`Sponsored transaction confirmed! Transaction hash: ${finalReceipt.receipt.transactionHash}`);
    } catch (error) {
      console.error("Error sending sponsored transaction:", error);
      setSponsoredTxStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  // Function to send a self-sponsored transaction
  async function sendSelfSponsoredTransaction() {
    if (!smartAccount || !bundler || !contractAddresses.paymaster || !contractAddresses.shmonad) {
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
      
      // Get hash to sign from paymaster contract (following standalone script pattern)
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
      const signature = await smartAccount.signUserOperation({
        ...userOperation,
        paymaster: contractAddresses.paymaster,
        paymasterData: paymasterData
      });
      
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
      } catch (sendError) {
        console.error("Error sending self-sponsored tx:", sendError);
        throw sendError;
      }
      
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
    if (!smartAccount || !contractAddresses.shmonad) {
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

  // Debug function to analyze UserOperation signatures
  async function debugUserOpSignature() {
    if (!smartAccount) {
      console.error("Smart account not initialized");
      setTxStatus("Cannot debug: Smart account not initialized");
      return;
    }
    
    try {
      setLoading(true);
      setTxStatus("Debugging UserOperation signature...");
      
      // Check if embedded wallet is defined
      if (!embeddedWallet) {
        setTxStatus("Cannot debug: Embedded wallet is not initialized");
        setLoading(false);
        return;
      }
      
      if (!bundler) {
        setTxStatus("Cannot debug: Bundler not initialized");
        setLoading(false);
        return;
      }
      
      // Create a minimal test UserOperation
      const minTestUserOp = {
        account: smartAccount,
        calls: [
          {
            to: smartAccount.address, // Send to self for testing
            value: parseEther("0.0001"), // Minimal value
            data: '0x' as Hex,
          }
        ],
      };
      
      // Prepare the UserOperation using the bundler
      console.log("Debug - Preparing test UserOperation...");
      const testUserOp = await bundler.prepareUserOperation(minTestUserOp);
      
      console.log("Original UserOperation:", testUserOp);
      
      // Check if smartAccount is a Safe account
      const isSafeAccount = 'owners' in smartAccount;
      console.log("Is Safe account:", isSafeAccount);
      
      try {
        if (isSafeAccount) {
          console.log("Using SafeSmartAccount.signUserOperation for signing");
          
          // For Safe accounts, use the SafeSmartAccount.signUserOperation method directly
          // by importing and using the specific function from permissionless/accounts/safe
          const signature = await smartAccount.signUserOperation(testUserOp);
          
          console.log("Successfully signed with Safe account. Signature:", signature);
          setTxStatus("Successfully signed with Safe account! Check console for signature details.");
        } else {
          console.log("Using standard signUserOperation for non-Safe account");
          // Standard signing for non-Safe accounts
          const signature = await smartAccount.signUserOperation(testUserOp);
          console.log("Successfully signed with standard method:", signature);
          setTxStatus("Successfully signed! Check console for signature details.");
        }
      } catch (signError) {
        console.error("Error signing UserOperation:", signError);
        setTxStatus(`Signing error: ${signError instanceof Error ? signError.message : String(signError)}`);
      }
    } catch (error) {
      console.error("Debug error:", error);
      setTxStatus(`Debug error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  // Add this new debug function after debugUserOpSignature
  async function debugUserOpWithPaymaster() {
    if (!smartAccount || !bundler || !contractAddresses.paymaster) {
      setTxStatus("Cannot debug: Smart account, bundler or paymaster not initialized");
      return;
    }
    
    try {
      setLoading(true);
      setTxStatus("Debugging UserOperation with paymaster validation...");
      
      // Initialize contracts
      const paymasterContract = await initContract(
        contractAddresses.paymaster,
        paymasterAbi,
        publicClient
      );
      
      // Initialize address hub contract
      const addressHubContract = await initContract(
        ADDRESS_HUB,
        addressHubAbi,
        publicClient
      );
      
      // Get the paymaster address from the hub to make sure we're using the correct one
      const paymasterFromHub = await addressHubContract.read.paymaster4337([]) as Address;
      console.log("Debug - Paymaster address from hub:", paymasterFromHub);
      console.log("Debug - Paymaster address from contractAddresses:", contractAddresses.paymaster);
      console.log("Debug - Addresses match:", paymasterFromHub.toLowerCase() === contractAddresses.paymaster.toLowerCase());
      
      // Create a minimal test UserOperation
      const minTestUserOp = {
        account: smartAccount,
        calls: [
          {
            to: smartAccount.address, // Send to self for testing
            value: parseEther("0.0001"), // Minimal value
            data: '0x' as Hex,
          }
        ],
      };
      
      // Prepare the UserOperation using the bundler
      console.log("Debug - Preparing test UserOperation...");
      const testUserOp = await bundler.prepareUserOperation(minTestUserOp);
      console.log("Debug - UserOp prepared:", testUserOp);
      
      // Set validation times
      const validAfter = 0n;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 3600); // Valid for 1 hour
      
      // Get the hash to sign
      console.log("Debug - Getting hash to sign from paymaster...");
      const hash = await paymasterContract.read.getHash([
        toPackedUserOperation(testUserOp as any),
        validUntil,
        validAfter,
      ]) as Hex;
      
      console.log("Debug - Hash to sign:", hash);
      
      // Sign the hash with sponsor wallet
      console.log("Debug - Signing hash with sponsor wallet account:", sponsorWallet?.account?.address);
      
      if (!sponsorWallet?.account) {
        throw new Error("Sponsor wallet not properly initialized. Check your environment variables.");
      }
      
      const sponsorSignature = await sponsorWallet.signMessage({
        message: { raw: hash },
        account: sponsorWallet.account,
      });
      
      console.log("Debug - Signature generated:", sponsorSignature);
      
      // Create paymaster data with signature
      const paymasterData = `0x01${sponsorWallet.account.address.slice(2)}${validUntil
        .toString(16)
        .padStart(12, "0")}${validAfter
        .toString(16)
        .padStart(12, "0")}${(sponsorSignature as Hex).slice(2)}`;
      
      console.log("Debug - PaymasterData:", paymasterData);
      
      // Now try to validate the UserOperation directly with the paymaster contract
      try {
        console.log("Debug - Attempting to validate UserOperation with paymaster...");
        
        // Try to estimate gas for the operation with the generated paymaster data
        const estimatedGas = await bundler.estimateUserOperationGas({
          ...minTestUserOp,
          paymaster: contractAddresses.paymaster,
          paymasterData: paymasterData as Hex,
        });
        
        console.log("Debug - Gas estimation successful:", estimatedGas);
        setTxStatus("Paymaster validation successful! The UserOperation is valid.");
      } catch (validationError) {
        console.error("Debug - Paymaster validation error:", validationError);
        setTxStatus(`Paymaster validation failed with error: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
      }
    } catch (error) {
      console.error("Debug error:", error);
      setTxStatus(`Debug error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <Head>
        <title>Privy + Account Abstraction Demo</title>
        <meta name="description" content="Privy demo with Account Abstraction" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="relative py-3 sm:max-w-3xl mx-auto w-full px-4">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>
        <div className="relative px-4 py-8 bg-white shadow-lg sm:rounded-3xl sm:p-10">
          <div className="mx-auto">
            <div className="divide-y divide-gray-200">
              <div className="py-6 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <h1 className="text-3xl font-bold text-center">Privy + Account Abstraction Demo</h1>
                <p className="text-center">Demonstrating ERC-4337 Account Abstraction with Privy</p>
                
                {!ready ? (
                  <p className="text-center">Loading Privy...</p>
                ) : !authenticated ? (
                  <div className="text-center">
                    <button onClick={login} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                      Login with Privy
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="border p-4 rounded-lg">
                      <h2 className="text-xl font-semibold mb-2">Wallet Status</h2>
                      {!embeddedWallet ? (
                        <div>
                          <p>No embedded wallet found. Please wait for Privy to create one automatically or refresh the page.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p><strong>EOA Address:</strong> <span className="break-all">{embeddedWallet.address}</span></p>
                          <p><strong>EOA Balance:</strong> {walletBalance} MON</p>
                          {smartAccount && (
                            <>
                              <p><strong>Smart Account:</strong> <span className="break-all">{smartAccount.address}</span></p>
                              <p><strong>Smart Account Balance:</strong> {smartAccountBalance} MON</p>
                              {bondedShmon && (
                                <p><strong>Bonded shMON:</strong> {bondedShmon} shMON</p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {smartAccount && contractAddresses.paymaster && (
                      <>
                        <div className="border p-4 rounded-lg">
                          <h2 className="text-xl font-semibold mb-2">Contract Addresses</h2>
                          <p><strong>Paymaster:</strong> <span className="break-all">{contractAddresses.paymaster}</span></p>
                          <p><strong>shMON:</strong> <span className="break-all">{contractAddresses.shmonad}</span></p>
                          <p><strong>Paymaster Deposit:</strong> {paymasterDeposit} MON</p>
                        </div>

                        <div className="border p-4 rounded-lg">
                          <h2 className="text-xl font-semibold mb-2">Debug Tools</h2>
                          <div className="flex flex-wrap gap-2">
                            <button 
                              onClick={debugUserOpSignature} 
                              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
                              disabled={loading}
                            >
                              Debug UserOp Signature
                            </button>
                            <button 
                              onClick={debugUserOpWithPaymaster} 
                              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
                              disabled={loading}
                            >
                              Debug Paymaster
                            </button>
                          </div>
                        </div>

                        <div className="border p-4 rounded-lg">
                          <h2 className="text-xl font-semibold mb-2">Send Transaction</h2>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700">
                                Recipient Address
                              </label>
                              <input
                                type="text"
                                value={recipient}
                                onChange={(e) => setRecipient(e.target.value)}
                                placeholder="0x..."
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">
                                Amount (MON)
                              </label>
                              <input
                                type="text"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button 
                                onClick={sendTransaction} 
                                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                disabled={loading || !sponsorWallet}
                                title={!sponsorWallet ? "Sponsor wallet not available" : ""}
                              >
                                Send Transaction
                              </button>
                            </div>
                            {!sponsorWallet && (
                              <p className="text-red-500 text-sm">Sponsor wallet not available. SPONSOR_PRIVATE_KEY is missing.</p>
                            )}
                            {txHash && (
                              <p><strong>UserOp Hash:</strong> <span className="break-all">{txHash}</span></p>
                            )}
                            {txStatus && (
                              <p><strong>Status:</strong> <span className="break-words">{txStatus}</span></p>
                            )}
                          </div>
                        </div>

                        <div className="border p-4 rounded-lg">
                          <h2 className="text-xl font-semibold mb-2">Sponsored Transaction</h2>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700">
                                Recipient Address
                              </label>
                              <input
                                type="text"
                                value={sponsoredRecipient}
                                onChange={(e) => setSponsoredRecipient(e.target.value)}
                                placeholder="0x..."
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700">
                                Amount (MON)
                              </label>
                              <input
                                type="text"
                                value={sponsoredAmount}
                                onChange={(e) => setSponsoredAmount(e.target.value)}
                                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                              />
                            </div>
                            <button 
                              onClick={sendSponsoredTransaction} 
                              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                              disabled={loading || !sponsorWallet}
                              title={!sponsorWallet ? "Sponsor wallet not available" : ""}
                            >
                              Send Sponsored Transaction
                            </button>
                            {!sponsorWallet && (
                              <p className="text-red-500 text-sm">Sponsor wallet not available. SPONSOR_PRIVATE_KEY is missing.</p>
                            )}
                            {sponsoredTxHash && (
                              <p><strong>UserOp Hash:</strong> <span className="break-all">{sponsoredTxHash}</span></p>
                            )}
                            {sponsoredTxStatus && (
                              <p><strong>Status:</strong> <span className="break-words">{sponsoredTxStatus}</span></p>
                            )}
                          </div>
                        </div>

                        <div className="border p-4 rounded-lg">
                          <h2 className="text-xl font-semibold mb-2">Bond MON to shMON</h2>
                          {bondedShmon === "0" ? (
                            <div>
                              <p>You need to bond MON to shMON to use self-sponsored transactions.</p>
                              <button 
                                onClick={bondMonToShmon} 
                                className="mt-2 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
                                disabled={loading}
                              >
                                Bond 2 MON to shMON
                              </button>
                            </div>
                          ) : (
                            <p>You have {bondedShmon} shMON bonded.</p>
                          )}
                        </div>

                        {bondedShmon !== "0" && (
                          <div className="border p-4 rounded-lg">
                            <h2 className="text-xl font-semibold mb-2">Self-Sponsored Transaction</h2>
                            <div className="space-y-3">
                              <div>
                                <label className="block text-sm font-medium text-gray-700">
                                  Recipient Address
                                </label>
                                <input
                                  type="text"
                                  value={selfSponsoredRecipient}
                                  onChange={(e) => setSelfSponsoredRecipient(e.target.value)}
                                  placeholder="0x..."
                                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700">
                                  Amount (MON)
                                </label>
                                <input
                                  type="text"
                                  value={selfSponsoredAmount}
                                  onChange={(e) => setSelfSponsoredAmount(e.target.value)}
                                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                />
                              </div>
                              <button 
                                onClick={sendSelfSponsoredTransaction} 
                                className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
                                disabled={loading}
                              >
                                Send Self-Sponsored Transaction
                              </button>
                              {selfSponsoredTxHash && (
                                <p><strong>UserOp Hash:</strong> <span className="break-all">{selfSponsoredTxHash}</span></p>
                              )}
                              {selfSponsoredTxStatus && (
                                <p><strong>Status:</strong> <span className="break-words">{selfSponsoredTxStatus}</span></p>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}