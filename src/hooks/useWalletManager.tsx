import { useState, useEffect } from 'react';
import { usePrivy, useWallets, useCreateWallet, ConnectedWallet } from '@privy-io/react-auth';
import { 
  initBundler, 
  initBundlerWithPaymaster, 
  type ShBundlerClient, 
  createShBundlerClient 
} from '@/utils/bundler';
import {
  publicClient,
  ENTRY_POINT_ADDRESS,
  ADDRESS_HUB,
  MONAD_CHAIN,
  RPC_URL,
  SHBUNDLER_URL,
} from '@/utils/config';
import {
  WalletClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Hex,
  createPublicClient,
  EIP1193Provider,
} from 'viem';
import { initContract } from '@/utils/contracts';
import addressHubAbi from '@/abis/addressHub.json';
import paymasterAbi from '@/abis/paymaster.json';
import shmonadAbi from '@/abis/shmonad.json';
import { createSmartAccountClient } from 'permissionless';
import { toSafeSmartAccount } from 'permissionless/accounts';
import { createLocalPaymasterClient } from '@/utils/paymasterClient';
import { logger } from '@/utils/logger';

// Define the EntryPoint address
const entryPoint07Address = ENTRY_POINT_ADDRESS;

// Add this function before the useWalletManager function
async function debugPrivyProvider(provider: any) {
  logger.debug('DEBUGGING PRIVY PROVIDER', {
    providerType: typeof provider,
    hasRequestMethod: typeof provider.request === 'function'
  });
  
  if (typeof provider.request === 'function') {
    try {
      // Test basic provider functionality
      logger.debug('Testing provider.request with eth_accounts...');
      const accounts = await provider.request({ method: 'eth_accounts' });
      logger.debug('Provider accounts', accounts);
      
      // Test chain ID
      logger.debug('Testing provider.request with eth_chainId...');
      const chainId = await provider.request({ method: 'eth_chainId' });
      logger.debug('Provider chainId', chainId);
      
      // Check if the provider has the expected methods
      const methods = [
        'eth_accounts',
        'eth_chainId',
        'eth_sendTransaction',
        'eth_sign',
        'personal_sign',
        'eth_signTypedData_v4'
      ];
      
      logger.debug('Checking provider methods...');
      for (const method of methods) {
        try {
          // Just check if the method exists by calling it with invalid params
          // This will throw, but we can catch the error to see if it's supported
          await provider.request({ method });
        } catch (error: any) {
          const supported = !error.message.includes('not supported');
          logger.debug(`Method ${method}`, supported ? 'supported' : 'NOT SUPPORTED');
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Error testing provider', error);
      return false;
    }
  } else {
    logger.error('Provider does not have a request method');
    return false;
  }
}

export type WalletManagerState = {
  embeddedWallet: ConnectedWallet | null;
  smartAccount: any | null;
  smartAccountClient: any | null;
  bundler: ShBundlerClient | null;
  walletClient: WalletClient | null;
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
  const { authenticated, ready, user, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { wallets } = useWallets();
  const [embeddedWallet, setEmbeddedWallet] = useState<ConnectedWallet | null>(null);
  const [smartAccount, setSmartAccount] = useState<any>(null);
  const [smartAccountClient, setSmartAccountClient] = useState<any>(null);
  const [bundler, setBundler] = useState<ShBundlerClient | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
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
    console.log('Wallets change detected:', wallets?.length);
    if (wallets && wallets.length > 0) {
      console.log(
        'Available wallets:',
        wallets.map(w => w.walletClientType)
      );

      // Find either embedded or privy wallet type (depending on Privy version)
      const embedded = wallets.find(
        wallet => wallet.walletClientType === 'privy' || wallet.walletClientType === 'embedded'
      );

      if (embedded) {
        console.log('Found embedded wallet:', embedded.address);
        setEmbeddedWallet(embedded as ConnectedWallet);
      } else {
        console.log(
          'No embedded wallet found. Available wallet types:',
          wallets.map((w: any) => w.walletClientType).join(', ')
        );
      }
    }
  }, [wallets]);

  // Initialize smart account and bundler when embedded wallet is available
  useEffect(() => {
    async function initializeAccount() {
      if (embeddedWallet) {
        try {
          console.log('🚀 INITIALIZATION STARTED: Initializing smart account with permissionless.js...');
          setLoading(true);
          
          try {
            // Get the Ethereum provider from Privy's embedded wallet
            console.log('📝 STEP 1: Getting Ethereum provider from Privy wallet...');
            const provider = await embeddedWallet.getEthereumProvider();

            if (!provider) {
              console.error('❌ STEP 1 FAILED: No Ethereum provider found from Privy wallet');
              throw new Error('No Ethereum provider found from Privy wallet');
            }
            console.log('✅ STEP 1 COMPLETE: Ethereum provider obtained');
            
            // Debug the provider to ensure it's working correctly
            console.log('📝 STEP 1.5: Debugging Ethereum provider...');
            const providerIsValid = await debugPrivyProvider(provider);
            if (!providerIsValid) {
              console.error('❌ Provider validation failed. The provider may not be functioning correctly.');
              console.log('Attempting to continue anyway...');
            } else {
              console.log('✅ Provider validation successful!');
            }

            console.log('📝 STEP 2: Creating public client...');
            const client = createPublicClient({
              chain: MONAD_CHAIN,
              transport: http(RPC_URL),
            });
            console.log('✅ STEP 2 COMPLETE: Public client created');

            // Configure ShBundler URL
            const bundlerUrl = SHBUNDLER_URL;
            console.log('📝 STEP 3: Creating ShBundler client with URL:', bundlerUrl);
            const bundlerClient = createShBundlerClient({
              transport: http(bundlerUrl),
              entryPoint: {
                address: entryPoint07Address as Address,
                version: '0.7',
              },
            });
            console.log('✅ STEP 3 COMPLETE: ShBundler client created');

            console.log('📝 STEP 4: Creating smart account...');
            // Create a Safe Smart Account instead of Simple Smart Account
            try {
              console.log('Provider type:', typeof provider, 'Provider value:', provider ? 'exists' : 'null');
              
              // Log the parameters being passed to toSafeSmartAccount
              console.log('🔍 toSafeSmartAccount params:', {
                client: client ? 'public client created' : 'null',
                entryPoint: {
                  address: entryPoint07Address,
                  version: '0.7'
                },
                owners: ['provider object (EOA)'],
                version: '1.4.1'
              });
              
              // Wrap this call in a try-catch with detailed error logging
              try {
                console.log('📋 Calling toSafeSmartAccount...');
                // Convert provider to wallet client for owners parameter
                const accounts = await provider.request({ method: 'eth_accounts' });
                const EOA = accounts[0] as Address;
                
                console.log('📋 Using EOA address as owner:', EOA);
                
                // Create a wallet client from the provider
                const walletClient = createWalletClient({
                  account: EOA,
                  chain: MONAD_CHAIN,
                  transport: custom(provider as EIP1193Provider)
                });

                // Switch to the correct chain
                await walletClient.switchChain({ id: MONAD_CHAIN.id });
                // Store the wallet client for later use
                setWalletClient(walletClient);
                
                const safeSmartAccount = await toSafeSmartAccount({
                  client,
                  entryPoint: {
                    address: entryPoint07Address as Address,
                    version: "0.7",
                  },
                  owners: [walletClient],
                  version: "1.4.1"
                });
                
                console.log('✅ STEP 4 COMPLETE: Safe Smart Account created:', safeSmartAccount.address);
                setSmartAccount(safeSmartAccount);
                
                console.log('📝 STEP 5: Creating smart account client...');
                // Create Smart Account Client using ShBundler
                const smartAccountClient = createSmartAccountClient({
                  account: safeSmartAccount,
                  chain: MONAD_CHAIN,
                  bundlerTransport: http(bundlerUrl),
                  // Get fee data from our ShBundler client
                  userOperation: {
                    estimateFeesPerGas: async () => {
                      console.log('Estimating gas fees through user operation...');
                      const gasPrice = await bundlerClient.getUserOperationGasPrice();
                      return gasPrice.fast;
                    },
                  }
                });
                
                console.log('✅ STEP 5 COMPLETE: Smart Account client created');
                // Store the smart account client for transaction operations
                setSmartAccountClient(smartAccountClient);
                
                try {
                  console.log('📝 STEP 6: Getting contract addresses from hub...');
                  // Get contract addresses from the hub
                  const addressHubContract = await initContract(
                    ADDRESS_HUB,
                    addressHubAbi,
                    publicClient
                  );
  
                  console.log('Initialized Address Hub contract, getting paymaster and shmonad addresses...');
                  const paymaster = (await addressHubContract.read.paymaster4337([])) as Address;
                  const shmonad = (await addressHubContract.read.shMonad([])) as Address;
  
                  console.log('✅ STEP 6 COMPLETE: Contract addresses fetched:', { paymaster, shmonad });
                  setContractAddresses({
                    paymaster,
                    shmonad,
                  });
                  
                  // Setup the bundler with paymaster using our RPC-based paymaster client
                  console.log('📝 STEP 7: Creating paymaster client via RPC endpoint...');
                  try {
                    // Use the RPC-based paymaster client
                    const paymasterClient = createLocalPaymasterClient();
                    
                    console.log('📝 STEP 7B: Initializing bundler with paymaster...');
                    const bundlerWithPaymaster = initBundlerWithPaymaster(
                      safeSmartAccount,
                      client,
                      paymasterClient
                    );
                    
                    // Update the bundler to use the one with paymaster integration
                    console.log('✅ STEP 7 COMPLETE: Using bundler with paymaster integration');
                    setBundler(bundlerWithPaymaster);
                  } catch (paymasterError) {
                    console.error('❌ Error setting up paymaster:', paymasterError);
                    console.log('⚠️ Falling back to bundler without paymaster');
                    // Fall back to the regular bundler without paymaster
                    const regularBundler = initBundler(safeSmartAccount, client);
                    setBundler(regularBundler);
                  }
                  
                  console.log('🎉 INITIALIZATION COMPLETE: Account setup finished successfully');
                } catch (error) {
                  console.error('❌ STEP 6/7 FAILED: Error getting contract addresses:', error);
                  console.log('⚠️ Falling back to regular bundler');
                  // Fall back to regular bundler without paymaster integration
                  setBundler(bundlerClient);
                }
              } catch (safeAccountCreationError) {
                console.error('💥 ERROR IN toSafeSmartAccount:', safeAccountCreationError);
                console.error('Detailed error:', 
                  safeAccountCreationError instanceof Error 
                    ? {
                        message: safeAccountCreationError.message,
                        name: safeAccountCreationError.name,
                        stack: safeAccountCreationError.stack?.split('\n').slice(0, 5).join('\n')
                      } 
                    : String(safeAccountCreationError)
                );
                throw safeAccountCreationError; // Re-throw to be caught by the outer try-catch
              }
            } catch (safeAccountError) {
              console.error('❌ STEP 4 FAILED: Error creating Safe account:', safeAccountError);
              console.error(
                'Error details:',
                safeAccountError instanceof Error
                  ? {
                      message: safeAccountError.message,
                      stack: safeAccountError.stack,
                      name: safeAccountError.name,
                    }
                  : String(safeAccountError)
              );
            }

            setLoading(false);
          } catch (error) {
            console.error('❌ OUTER INITIALIZATION FAILED: Error initializing smart account:', error);
            setLoading(false);
          }
        } catch (error) {
          console.error('❌ OUTER INITIALIZATION FAILED: Error initializing smart account:', error);
          setLoading(false);
        }
      } else {
        console.log('⏳ Waiting for embedded wallet before initialization...');
      }
    }

    // Initialize account when embedded wallet is available
    if (embeddedWallet) {
      console.log('🔄 Embedded wallet detected, starting initialization...');
      initializeAccount();
    }
  }, [embeddedWallet]);

  // Fetch balances when accounts are available
  useEffect(() => {
    async function fetchBalances() {
      if (embeddedWallet && smartAccount) {
        try {
          console.log('Fetching balances...');
          // Get EOA balance
          const eoaBalance = await publicClient.getBalance({
            address: embeddedWallet.address as Address,
          });
          setWalletBalance(eoaBalance.toString());
          console.log('EOA balance:', eoaBalance.toString());

          // Get Smart Account balance
          const saBalance = await publicClient.getBalance({
            address: smartAccount.address,
          });
          setSmartAccountBalance(saBalance.toString());
          console.log('Smart Account balance:', saBalance.toString());
        } catch (error) {
          console.error('Error fetching balances:', error);
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
      if (
        embeddedWallet &&
        smartAccount &&
        publicClient &&
        contractAddresses.paymaster &&
        contractAddresses.shmonad
      ) {
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
            const policyId = (await paymasterContract.read.POLICY_ID([])) as bigint;

            // Get paymaster deposit
            try {
              const deposit = (await paymasterContract.read.getDeposit([])) as bigint;
              setPaymasterDeposit(deposit.toString());
            } catch (depositError) {
              console.warn('Error fetching paymaster deposit');
              setPaymasterDeposit('Error');
            }

            // Get smart account bonded amount to shmonad
            try {
              // Check if the function exists before calling
              if (typeof shMonadContract.read.balanceOfBonded !== 'function') {
                console.warn('balanceOfBonded function not found in contract ABI');
                setBondedShmon('0');
                return;
              }

              // Handle expected contract revert for accounts with no bonds
              try {
                const bondedAmount = (await shMonadContract.read.balanceOfBonded([
                  policyId,
                  smartAccount.address,
                ])) as bigint;
                setBondedShmon(bondedAmount.toString());
              } catch (contractCallError) {
                // This is expected behavior for new accounts - the contract reverts instead of returning 0
                setBondedShmon('0');
              }
            } catch (bondedError) {
              // Only log if this is an unexpected error
              console.warn('Unexpected error checking bonded tokens');
              setBondedShmon('0');
            }
          } catch (policyError) {
            console.warn('Error fetching policy ID');
          }
        } catch (error) {
          console.error('Error initializing contracts');
        }
      }
    }

    fetchExtendedData();
    // Set up a refresh interval with reduced frequency to avoid excessive error logs
    const interval = setInterval(fetchExtendedData, 60000); // refresh every minute

    return () => clearInterval(interval);
  }, [embeddedWallet, smartAccount, contractAddresses, walletClient]);

  return {
    authenticated,
    ready,
    embeddedWallet,
    smartAccount,
    smartAccountClient,
    bundler,
    walletClient,
    loading,
    setLoading,
    contractAddresses,
    walletBalance,
    smartAccountBalance,
    bondedShmon,
    paymasterDeposit,
    shmonadAddress,
    logout,
  };
}
