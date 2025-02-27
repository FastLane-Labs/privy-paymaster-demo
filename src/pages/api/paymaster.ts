import { NextApiRequest, NextApiResponse } from 'next';
import { initContract, paymasterMode } from '../../utils/contracts';
import { toPackedUserOperation, UserOperation } from 'viem/account-abstraction';
import { createWalletClient, http, type Hex, type Address, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ADDRESS_HUB } from '../../utils/config';
import paymasterAbi from '../../abis/paymaster.json';
import addressHubAbi from '../../abis/addressHub.json';
import { monadTestnet } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';

// Initialization state tracking
let PAYMASTER_INITIALIZING = false;
let INITIALIZATION_ERROR: Error | null = null;
let INITIALIZATION_ATTEMPTS = 0;
const MAX_INITIALIZATION_ATTEMPTS = 5;

// Define non-zero placeholder addresses to use when the real paymaster isn't ready
const TEMP_PAYMASTER_ADDRESS = '0x1111111111111111111111111111111100000123' as Address;
const STUB_PAYMASTER_ADDRESS = '0x2222222222222222222222222222222200000456' as Address;

// Use a backend-specific RPC URL (not prefixed with NEXT_PUBLIC_)
const BACKEND_RPC_URL = process.env.RPC_URL || 'https://rpc.ankr.com/monad_testnet';
console.log('🌐 Backend using RPC URL:', BACKEND_RPC_URL);
console.log('Environment variables available:', {
  RPC_URL: process.env.RPC_URL ? 'defined' : 'undefined',
  SPONSOR_WALLET_PRIVATE_KEY: process.env.SPONSOR_WALLET_PRIVATE_KEY ? 'defined' : 'undefined',
  NODE_ENV: process.env.NODE_ENV
});

const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_WALLET_PRIVATE_KEY;
if (!SPONSOR_PRIVATE_KEY) {
  console.error('❌ SPONSOR_WALLET_PRIVATE_KEY environment variable is not set.');
  console.error('   Please add it to your .env.local file or set it in your environment.');
  console.error('   This is required for the paymaster to work properly.');
}

// Define the paymaster address - retrieved from the address hub contract
let PAYMASTER_ADDRESS: Address | undefined;

// Create backend-specific public client
const backendPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(BACKEND_RPC_URL)
});

// Create a sponsor wallet client using the private key
const sponsorAccount = SPONSOR_PRIVATE_KEY 
  ? privateKeyToAccount(SPONSOR_PRIVATE_KEY as Hex) 
  : undefined;

const sponsorWallet = sponsorAccount 
  ? createWalletClient({
      account: sponsorAccount,
      chain: monadTestnet,
      transport: http(BACKEND_RPC_URL)
    })
  : undefined;

// Initialize the address hub contract and get the paymaster address
async function initializePaymaster() {
  if (PAYMASTER_INITIALIZING) {
    console.log('⏳ Paymaster already initializing, skipping duplicate initialization');
    return; // Already initializing
  }
  
  if (PAYMASTER_ADDRESS) {
    console.log('✅ Paymaster already initialized:', PAYMASTER_ADDRESS);
    return; // Already initialized
  }
  
  PAYMASTER_INITIALIZING = true;
  INITIALIZATION_ATTEMPTS++;
  
  try {
    console.log(`📡 Initializing Address Hub contract to get paymaster address... (attempt ${INITIALIZATION_ATTEMPTS}/${MAX_INITIALIZATION_ATTEMPTS})`);
    console.log('    Address Hub address:', ADDRESS_HUB);
    console.log('    RPC URL:', BACKEND_RPC_URL);
    
    if (!ADDRESS_HUB) {
      throw new Error('ADDRESS_HUB is not defined. Please check your environment variables.');
    }
    
    if (!SPONSOR_PRIVATE_KEY) {
      throw new Error('SPONSOR_WALLET_PRIVATE_KEY is not defined. Please check your environment variables.');
    }
    
    // Log some details about the backend client to help diagnose issues
    console.log('🔄 Creating backend public client for chain:', monadTestnet.name, monadTestnet.id);
    
    // Create the address hub contract instance
    const addressHubContract = await initContract(
      ADDRESS_HUB,
      addressHubAbi,
      backendPublicClient
    );
    
    if (!addressHubContract) {
      throw new Error('Failed to initialize Address Hub contract');
    }
    
    console.log('✅ Address Hub contract initialized successfully');
    
    // Read the paymaster address from the contract
    console.log('📡 Reading paymaster address from AddressHub contract...');
    const paymasterAddress = (await addressHubContract.read.paymaster4337([])) as Address;
    console.log('📝 Raw paymaster address received:', paymasterAddress);
    
    // Validate the paymaster address
    if (!paymasterAddress) {
      throw new Error('Null or undefined paymaster address returned from AddressHub');
    }
    
    if (paymasterAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Zero address returned as paymaster address from AddressHub. This indicates the AddressHub contract may not be properly configured.');
    }
    
    console.log('✅ Got valid paymaster address:', paymasterAddress);
    
    // Store the address globally
    PAYMASTER_ADDRESS = paymasterAddress;
    
    // Initialize the paymaster contract for faster access later
    console.log('📡 Initializing paymaster contract...');
    const paymasterContract = await initContract(
      PAYMASTER_ADDRESS as Address,
      paymasterAbi,
      backendPublicClient
    );
    
    if (!paymasterContract) {
      throw new Error(`Failed to initialize paymaster contract at address ${PAYMASTER_ADDRESS}`);
    }
    
    // Try to read something from the paymaster contract to verify it works
    try {
      console.log('🔍 Verifying paymaster contract by reading from it...');
      const owner = await paymasterContract.read.owner([]);
      console.log('✅ Paymaster contract verified, owner:', owner);
    } catch (readError) {
      console.warn('⚠️ Could not read from paymaster contract, but proceeding anyway:', readError);
    }
    
    console.log('✅ Successfully initialized both Address Hub and Paymaster contracts');
    INITIALIZATION_ERROR = null;
  } catch (error) {
    console.error('❌ Error initializing paymaster:', error);
    INITIALIZATION_ERROR = error as Error;
    
    // If we haven't exceeded max attempts, schedule a retry
    if (INITIALIZATION_ATTEMPTS < MAX_INITIALIZATION_ATTEMPTS) {
      console.log(`⏱️ Scheduling retry in ${INITIALIZATION_ATTEMPTS * 2} seconds...`);
      setTimeout(() => {
        PAYMASTER_INITIALIZING = false; // Reset flag to allow retry
        initializePaymaster(); // Retry initialization
      }, INITIALIZATION_ATTEMPTS * 2000); // Exponential backoff
    } else {
      console.error(`❌ Failed to initialize paymaster after ${MAX_INITIALIZATION_ATTEMPTS} attempts.`);
      console.error('🔍 Last error:', INITIALIZATION_ERROR.message);
      console.error('💡 Check your ADDRESS_HUB environment variable and make sure the contract is deployed correctly.');
      console.error('💡 Check your SPONSOR_WALLET_PRIVATE_KEY environment variable is correct.');
      
      // Force a refresh after a longer timeout
      setTimeout(() => {
        console.log('🔄 Forcing paymaster initialization refresh after timeout...');
        PAYMASTER_INITIALIZING = false;
        INITIALIZATION_ATTEMPTS = 0;
        initializePaymaster();
      }, 30000); // Try again after 30 seconds
    }
  } finally {
    // Even if we fail, reset the initializing flag to allow retries
    if (PAYMASTER_ADDRESS) {
      console.log('✅ Paymaster initialization successful, address:', PAYMASTER_ADDRESS);
      PAYMASTER_INITIALIZING = false; // Only reset if successful
    } else {
      // Reset after a delay to prevent too frequent retries
      setTimeout(() => {
        console.log('⏱️ Resetting PAYMASTER_INITIALIZING flag after timeout');
        PAYMASTER_INITIALIZING = false;
      }, 5000);
    }
  }
}

// Start initialization immediately
initializePaymaster();
// Schedule periodic refresh of paymaster address
setInterval(() => {
  // Only try to refresh if not currently initializing and either not initialized or previously errored
  if (!PAYMASTER_INITIALIZING && (!PAYMASTER_ADDRESS || INITIALIZATION_ERROR)) {
    console.log('🔄 Attempting periodic refresh of paymaster address...');
    INITIALIZATION_ATTEMPTS = 0; // Reset attempt counter for refresh
    initializePaymaster();
  }
}, 60000); // Check every minute

/**
 * JSON-RPC Handler for Paymaster methods
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { jsonrpc, id, method, params } = req.body;

    // Log the incoming request
    console.log(`📡 Received RPC request for method: ${method}`);

    // Validate the JSON-RPC request
    if (jsonrpc !== '2.0' || !id || !method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32600, message: 'Invalid request' }
      });
    }

    // Try to initialize paymaster if not already initialized
    if (!PAYMASTER_ADDRESS && !PAYMASTER_INITIALIZING) {
      console.log('🔄 Paymaster not initialized yet, attempting initialization...');
      await initializePaymaster();
    }

    // Handle different RPC methods
    switch (method) {
      case 'pm_getPaymasterData':
        return handleGetPaymasterData(req, res);
      
      case 'pm_getPaymasterStubData':
        return handleGetPaymasterStubData(req, res);
      
      default:
        return res.status(400).json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found' }
        });
    }
  } catch (error) {
    console.error('❌ RPC handler error:', error);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: { code: -32603, message: 'Internal error', data: (error as Error).message }
    });
  }
}

/**
 * Handle pm_getPaymasterData method
 */
async function handleGetPaymasterData(req: NextApiRequest, res: NextApiResponse) {
  const { id, params } = req.body;
  const startTime = Date.now();
  
  try {
    // Read critical environment variables directly in the request handler
    // This ensures we get the latest values even in serverless environments
    const hotPathPrivateKey = process.env.SPONSOR_WALLET_PRIVATE_KEY;
    const hotPathRpcUrl = process.env.RPC_URL || BACKEND_RPC_URL;
    const hotPathAddressHub = process.env.ADDRESS_HUB || ADDRESS_HUB;
    
    console.log('🌡️ Hot path environment check:', {
      SPONSOR_KEY: hotPathPrivateKey ? 'defined' : 'undefined',
      RPC_URL: hotPathRpcUrl ? 'defined' : 'undefined',
      ADDRESS_HUB: hotPathAddressHub ? 'defined' : 'undefined'
    });

    // Extract parameters
    const [userOperation, entryPointAddress, chainId, context] = params;
    
    console.log('🎯 Processing paymaster data request for sender:', userOperation.sender);
    console.log('⏱️ Request received at:', new Date().toISOString());
    console.log('📄 User operation details:', {
      sender: userOperation.sender,
      nonce: userOperation.nonce ? BigInt(userOperation.nonce).toString() : 'undefined',
      callData: userOperation.callData?.substring(0, 10) + '...' || 'undefined',
      entryPointAddress: entryPointAddress,
      chainId: chainId
    });
    
    // Detect EntryPoint version based on the address
    // Match the entryPointAddress with the entryPoint07Address
    const isEntryPointV07 = entryPointAddress == entryPoint07Address;
    console.log(`🔍 Detected EntryPoint version: ${isEntryPointV07 ? 'v0.7' : 'v0.6'}`);
    
    // QUICK VALIDATION - must respond fast to avoid timeouts
    if (!userOperation || !userOperation.sender || !entryPointAddress || !chainId) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32602, 
          message: 'Invalid params',
          data: 'Required parameters: userOperation, entryPointAddress, chainId' 
        }
      });
    }
    
    // If hot path private key is available but global one isn't, create the sponsor account on demand
    let dynamicSponsorAccount = sponsorAccount;
    let dynamicSponsorWallet = sponsorWallet;
    
    if (hotPathPrivateKey && !dynamicSponsorAccount) {
      console.log('🔥 Creating sponsor account on hot path with fresh private key');
      try {
        dynamicSponsorAccount = privateKeyToAccount(hotPathPrivateKey as Hex);
        dynamicSponsorWallet = createWalletClient({
          account: dynamicSponsorAccount,
          chain: monadTestnet,
          transport: http(hotPathRpcUrl)
        });
        console.log('✅ Successfully created sponsor wallet on hot path');
      } catch (walletError) {
        console.error('❌ Failed to create sponsor wallet on hot path:', walletError);
      }
    }
    
    // Start initialization if not already done (avoids edge cases where auto-init fails)
    if (!PAYMASTER_ADDRESS && !PAYMASTER_INITIALIZING) {
      // If we have hot path values that differ from globals, update globals
      if (hotPathPrivateKey && hotPathPrivateKey !== SPONSOR_PRIVATE_KEY) {
        console.log('🔄 Updating sponsor private key from hot path value');
        // We can't modify the const, but we can log that we detected a change
      }
      
      INITIALIZATION_ATTEMPTS = 0; // Reset for fresh start
      initializePaymaster();
    }
    
    // Use dynamic wallet if available, otherwise fall back to global
    const activeWallet = dynamicSponsorWallet || sponsorWallet;
    const activeAccount = dynamicSponsorAccount || sponsorAccount;
    
    // We need either a paymaster address or a wallet to proceed
    if (!PAYMASTER_ADDRESS && (!activeWallet || !activeAccount)) {
      // If we have neither paymaster address nor wallet, that's a critical error
      console.error('❌ Critical error: No paymaster address AND no sponsor wallet available');
      console.error('   Hot path environment check:', {
        SPONSOR_KEY: hotPathPrivateKey ? 'defined' : 'undefined',
        ADDRESS_HUB: hotPathAddressHub ? 'defined' : 'undefined',
        RPC_URL: hotPathRpcUrl ? 'defined' : 'undefined'
      });
      
      return res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32603, 
          message: 'Both paymaster address and sponsor wallet unavailable',
          data: {
            initialization: PAYMASTER_INITIALIZING ? 'in progress' : 'not started',
            attempts: INITIALIZATION_ATTEMPTS,
            error: INITIALIZATION_ERROR ? INITIALIZATION_ERROR.message : undefined,
            walletStatus: {
              hotPathKey: !!hotPathPrivateKey,
              globalKey: !!SPONSOR_PRIVATE_KEY,
              dynamicWallet: !!dynamicSponsorWallet,
              globalWallet: !!sponsorWallet
            }
          }
        }
      });
    }
    
    // At this point, we've already validated that either paymaster address or wallet is available
    // But let's add an explicit check just to be safe
    if (!activeWallet || !activeAccount) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32603, 
          message: 'Sponsor wallet not available for signing',
          data: 'Critical error: wallet was available earlier but is now undefined'
        }
      });
    }
    
    // Try to use PAYMASTER_ADDRESS or read it on demand if not available
    let effectivePaymasterAddress = PAYMASTER_ADDRESS;
    if (!effectivePaymasterAddress && activeWallet) {
      // Try to read it directly from the contract
      const onDemandAddress = await readPaymasterAddressOnDemand(hotPathAddressHub as Address, activeWallet);
      
      if (onDemandAddress) {
        effectivePaymasterAddress = onDemandAddress;
        console.log('✅ Successfully read paymaster address on demand:', effectivePaymasterAddress);
        
        // Store it for future use
        PAYMASTER_ADDRESS = effectivePaymasterAddress;
        INITIALIZATION_ERROR = null;
      }
    }
    
    // If we still don't have a paymaster address but we have a wallet, we can't proceed with real data
    // We need to return an error - we don't want to use dummy addresses for actual signed operations
    if (!effectivePaymasterAddress) {
      console.error('❌ Could not obtain a valid paymaster address');
      return res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32603, 
          message: 'Failed to obtain a valid paymaster address',
          data: {
            initialization: PAYMASTER_INITIALIZING ? 'in progress' : 'not started',
            attempts: INITIALIZATION_ATTEMPTS,
            error: INITIALIZATION_ERROR ? INITIALIZATION_ERROR.message : undefined
          }
        }
      });
    }
    
    // FULL PROCESSING - We have everything we need, process the actual signature
    // Set validity window (valid for 1 hour)
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const validUntil = currentTime + BigInt(3600);
    const validAfter = BigInt(0);
    
    // Initialize the paymaster contract
    const paymasterContract = await initContract(
      effectivePaymasterAddress,
      paymasterAbi,
      backendPublicClient
    );
    
    if (!paymasterContract) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32603, 
          message: 'Failed to initialize paymaster contract',
          data: `Paymaster address: ${effectivePaymasterAddress}` 
        }
      });
    }
  
    
    // Get the hash to sign from the paymaster contract
    const hash = await paymasterContract.read.getHash([
      toPackedUserOperation(userOperation as UserOperation),
      validUntil,
      validAfter,
    ]) as Hex;
    
    if (!hash) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'Paymaster returned null hash' }
      });
    }
    
    // Sign the hash with sponsor wallet
    const sponsorSignature = await activeWallet.signMessage({
      account: activeAccount,
      message: { raw: hash as Hex },
    });
    
    // Create paymaster data with the signature we obtained
    const paymasterData = paymasterMode(
      "sponsor",
      validUntil,
      validAfter,
      sponsorSignature as Hex,
      activeWallet
    ) as Hex;
    
    // Format the paymasterAndData field
    const formattedPaymasterAndData = `0x${effectivePaymasterAddress.slice(2)}${paymasterData.slice(2)}` as Hex;
    
    // Check how long we've been processing
    const processingTime = Date.now() - startTime;
    console.log(`⏱️ Full processing completed in ${processingTime}ms`);
    
    // Return successful response based on EntryPoint version
    if (isEntryPointV07) {
      // For EntryPoint v0.7: separate paymaster and paymasterData fields
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        result: {
          paymaster: effectivePaymasterAddress,
          paymasterData: paymasterData,
          sponsor: {
            name: 'Custom Sponsor Paymaster'
          },
          isFinal: true // This is the final data with real signature
        }
      });
    } else {
      // For EntryPoint v0.6: combined paymasterAndData field plus gas limits
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        result: {
          paymasterAndData: formattedPaymasterAndData,
          // Add estimated gas limits for v0.6 - these ensure proper operation execution
          preVerificationGas: userOperation.preVerificationGas || '0x350f7',
          verificationGasLimit: userOperation.verificationGasLimit || '0x501ab',
          callGasLimit: userOperation.callGasLimit || '0x212df',
          sponsor: {
            name: 'Custom Sponsor Paymaster'
          },
          isFinal: true // This is the final data with real signature
        }
      });
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Error in getPaymasterData after ${processingTime}ms:`, error);
    return res.status(500).json({
      jsonrpc: '2.0',
      id,
      error: { 
        code: -32603, 
        message: 'Internal error processing paymaster data', 
        data: (error as Error).message 
      }
    });
  }
}

/**
 * Handle pm_getPaymasterStubData method
 */
async function handleGetPaymasterStubData(req: NextApiRequest, res: NextApiResponse) {
  const { id, params } = req.body;
  const startTime = Date.now();
  
  try {
    // Read critical environment variables directly in the request handler
    // This ensures we get the latest values even in serverless environments
    const hotPathPrivateKey = process.env.SPONSOR_WALLET_PRIVATE_KEY;
    const hotPathRpcUrl = process.env.RPC_URL || BACKEND_RPC_URL;
    const hotPathAddressHub = process.env.ADDRESS_HUB || ADDRESS_HUB;
    
    console.log('🌡️ Hot path environment check for stub data:', {
      SPONSOR_KEY: hotPathPrivateKey ? 'defined' : 'undefined',
      RPC_URL: hotPathRpcUrl ? 'defined' : 'undefined',
      ADDRESS_HUB: hotPathAddressHub ? 'defined' : 'undefined'
    });

    // Extract parameters
    const [userOperation, entryPointAddress, chainId, context] = params;
    
    console.log('🔍 Processing paymaster stub data request for sender:', userOperation.sender);
    console.log('⏱️ Request received at:', new Date().toISOString());
    console.log('📄 EntryPoint version details:', {
      entryPointAddress: entryPointAddress,
      chainId: chainId
    });
    
    // Detect EntryPoint version based on the address
    const isEntryPointV07 = entryPointAddress == entryPoint07Address;
    console.log(`🔍 Detected EntryPoint version for stub: ${isEntryPointV07 ? 'v0.7' : 'v0.6'}`);
    
    // Validate required parameters
    if (!userOperation || !userOperation.sender || !entryPointAddress || !chainId) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32602, 
          message: 'Invalid params',
          data: 'Required parameters: userOperation, entryPointAddress, chainId' 
        }
      });
    }
    
    // If hot path private key is available but global one isn't, create the sponsor account on demand
    let dynamicSponsorAccount = sponsorAccount;
    let dynamicSponsorWallet = sponsorWallet;
    
    if (hotPathPrivateKey && !dynamicSponsorAccount) {
      console.log('🔥 Creating sponsor account on hot path for stub data with fresh private key');
      try {
        dynamicSponsorAccount = privateKeyToAccount(hotPathPrivateKey as Hex);
        dynamicSponsorWallet = createWalletClient({
          account: dynamicSponsorAccount,
          chain: monadTestnet,
          transport: http(hotPathRpcUrl)
        });
        console.log('✅ Successfully created sponsor wallet on hot path for stub data');
      } catch (walletError) {
        console.error('❌ Failed to create sponsor wallet on hot path for stub data:', walletError);
      }
    }
    
    // Start initialization if not already done
    if (!PAYMASTER_ADDRESS && !PAYMASTER_INITIALIZING) {
      INITIALIZATION_ATTEMPTS = 0;
      initializePaymaster();
    }
    
    // Use dynamic wallet if available, otherwise fall back to global
    const activeWallet = dynamicSponsorWallet || sponsorWallet;
    const activeAccount = dynamicSponsorAccount || sponsorAccount;
    
    // We need either a paymaster address or a wallet to proceed
    if (!PAYMASTER_ADDRESS && (!activeWallet || !activeAccount)) {
      // If we have neither paymaster address nor wallet, that's a real error
      console.error('❌ Critical error: No paymaster address AND no sponsor wallet available');
      console.error('   Hot path environment check:', {
        SPONSOR_KEY: hotPathPrivateKey ? 'defined' : 'undefined',
        ADDRESS_HUB: hotPathAddressHub ? 'defined' : 'undefined'
      });
      
      return res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32603, 
          message: 'Both paymaster address and sponsor wallet unavailable',
          data: {
            initialization: PAYMASTER_INITIALIZING ? 'in progress' : 'not started',
            attempts: INITIALIZATION_ATTEMPTS,
            error: INITIALIZATION_ERROR ? INITIALIZATION_ERROR.message : undefined,
            walletStatus: {
              hotPathKey: !!hotPathPrivateKey,
              globalKey: !!SPONSOR_PRIVATE_KEY,
              dynamicWallet: !!dynamicSponsorWallet,
              globalWallet: !!sponsorWallet
            }
          }
        }
      });
    }
    
    // Use the REAL paymaster address if available (preferred), otherwise attempt to read it from contract
    // Only as a last resort, use the stub address to avoid returning an error
    let effectivePaymasterAddress: Address = PAYMASTER_ADDRESS || STUB_PAYMASTER_ADDRESS;
    
    // Try to read it directly from the contract if not available and we have a wallet
    if (effectivePaymasterAddress === STUB_PAYMASTER_ADDRESS && activeWallet) {
      const onDemandAddress = await readPaymasterAddressOnDemand(hotPathAddressHub as Address, activeWallet);
      if (onDemandAddress) {
        effectivePaymasterAddress = onDemandAddress;
        // Store for future use
        PAYMASTER_ADDRESS = onDemandAddress;
      }
    }
    
    console.log(`📍 Using effective paymaster address for stub: ${effectivePaymasterAddress}`);
    
    // Generate stub paymaster data with the effective address
    const paymasterAndData = `0x${effectivePaymasterAddress.slice(2)}${'00'.repeat(64)}` as Hex;
    
    // Check how long we've been processing
    const processingTime = Date.now() - startTime;
    console.log(`⏱️ Stub data prepared in ${processingTime}ms`);
    
    // Return response based on EntryPoint version
    if (isEntryPointV07) {
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        result: {
          paymaster: effectivePaymasterAddress,
          paymasterData: '0x' + '00'.repeat(64) as Hex,
          paymasterVerificationGasLimit: 75000n,
          paymasterPostOpGasLimit: 120000n,
          sponsor: {
            name: 'Custom Sponsor Paymaster'
          },
          isFinal: false
        }
      });
    } else {
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        result: {
          paymasterAndData,
          preVerificationGas: '0x350f7',
          verificationGasLimit: '0x501ab',
          callGasLimit: '0x212df',
          sponsor: {
            name: 'Custom Sponsor Paymaster'
          },
          isFinal: false
        }
      });
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Error in getPaymasterStubData after ${processingTime}ms:`, error);
    return res.status(500).json({
      jsonrpc: '2.0',
      id,
      error: { 
        code: -32603, 
        message: 'Internal error processing paymaster stub data', 
        data: (error as Error).message 
      }
    });
  }
}

// Helper function to read paymaster address on demand directly from contract
async function readPaymasterAddressOnDemand(addressHubAddress: Address, wallet: any): Promise<Address | null> {
  console.log('🔄 Attempting to read paymaster address on demand from contract');
  try {
    const addressHubContract = await initContract(
      addressHubAddress,
      addressHubAbi,
      backendPublicClient
    );
    
    if (!addressHubContract) {
      console.error('❌ Failed to initialize Address Hub contract on demand');
      return null;
    }
    
    const paymasterAddress = (await addressHubContract.read.paymaster4337([])) as Address;
    
    if (!paymasterAddress || paymasterAddress === '0x0000000000000000000000000000000000000000') {
      console.error('❌ Invalid paymaster address read from contract on demand');
      return null;
    }
    
    console.log('✅ Successfully read paymaster address on demand:', paymasterAddress);
    return paymasterAddress;
  } catch (error) {
    console.error('❌ Error reading paymaster address on demand:', error);
    return null;
  }
} 