import { useState, useEffect } from 'react';
import { usePrivy, useWallets, useCreateWallet, ConnectedWallet } from '@privy-io/react-auth';
import { initBundler, type ShBundler } from '@/utils/bundler';
import { publicClient, ENTRY_POINT_ADDRESS, ADDRESS_HUB, MONAD_CHAIN, RPC_URL, SPONSOR_PRIVATE_KEY } from '@/utils/config';
import { WalletClient, createWalletClient, custom, http, type Address, type Hex } from 'viem';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { privateKeyToAccount } from 'viem/accounts';
import { initContract } from '@/utils/contracts';
import addressHubAbi from '@/abis/addressHub.json';
import paymasterAbi from '@/abis/paymaster.json';
import shmonadAbi from '@/abis/shmonad.json';
import { createPublicClient } from 'viem';

export type WalletManagerState = {
  embeddedWallet: ConnectedWallet | null;
  smartAccount: any | null;
  sponsorWallet: WalletClient | null;
  bundler: ShBundler | null;
  loading: boolean;
  contractAddresses: {
    paymaster: Address;
    shmonad: Address;
  };
  walletBalance: string;
  smartAccountBalance: string;
  bondedShmon: string;
  paymasterDeposit: string;
};

export function useWalletManager() {
  const { authenticated, ready, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { wallets } = useWallets();
  const [embeddedWallet, setEmbeddedWallet] = useState<ConnectedWallet | null>(null);
  const [smartAccount, setSmartAccount] = useState<any>(null);
  const [sponsorWallet, setSponsorWallet] = useState<any>(null);
  const [bundler, setBundler] = useState<ShBundler | null>(null);
  const [loading, setLoading] = useState(false);
  const [contractAddresses, setContractAddresses] = useState({
    paymaster: '' as Address,
    shmonad: '' as Address,
  });
  
  // Balance states
  const [walletBalance, setWalletBalance] = useState<string>('0');
  const [smartAccountBalance, setSmartAccountBalance] = useState<string>('0');
  const [bondedShmon, setBondedShmon] = useState<string>('0');
  const [paymasterDeposit, setPaymasterDeposit] = useState<string>('0');
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
          // Add detailed logging of the embedded wallet
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
            }
          } catch (error) {
            console.error("Error creating smart account:", error);
            console.error("Error details:", error instanceof Error ? {
              message: error.message,
              stack: error.stack,
              name: error.name
            } : String(error));
          }
          
          setLoading(false);
        } catch (error) {
          console.error("Error initializing smart account:", error);
          setLoading(false);
        }
      }
      
      console.log("SPONSOR_PRIVATE_KEY:", SPONSOR_PRIVATE_KEY ? "defined" : "undefined");
      if (SPONSOR_PRIVATE_KEY) {
        try {
          console.log("Creating sponsor wallet with private key");
          const sponsorWallet = await createSponsorWallet();
          console.log("Sponsor wallet created:", sponsorWallet.account?.address);
          setSponsorWallet(sponsorWallet);
        } catch (error) {
          console.error("Failed to create sponsor wallet:", error);
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
          setWalletBalance(eoaBalance.toString());
          console.log("EOA balance:", eoaBalance.toString());

          // Get Smart Account balance
          const saBalance = await publicClient.getBalance({
            address: smartAccount.address
          });
          setSmartAccountBalance(saBalance.toString());
          console.log("Smart Account balance:", saBalance.toString());
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
              setPaymasterDeposit(deposit.toString());
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
                setBondedShmon(bondedAmount.toString());
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

  return {
    authenticated,
    ready,
    embeddedWallet,
    smartAccount,
    sponsorWallet,
    bundler,
    loading,
    setLoading,
    contractAddresses,
    walletBalance,
    smartAccountBalance,
    bondedShmon,
    paymasterDeposit,
    shmonadAddress
  };
} 