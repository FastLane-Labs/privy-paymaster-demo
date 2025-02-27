import {
  type BundlerClient,
  type SmartAccount,
  createBundlerClient,
  type UserOperation,
  type GetPaymasterDataParameters,
  type GetPaymasterDataReturnType,
} from 'viem/account-abstraction';
import { http, type Client, type Hex, hexToBigInt, type Transport, type Chain, type Address, type PublicClient } from 'viem';
import { MONAD_CHAIN, SHBUNDLER_URL, ENTRY_POINT_ADDRESS } from './config';

// Gas price response types
interface GasPricesEncoded {
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
}

interface GasPriceResultEncoded {
  fast: GasPricesEncoded;
  standard: GasPricesEncoded;
  slow: GasPricesEncoded;
}

interface GasPrices {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface GasPriceResult {
  fast: GasPrices;
  standard: GasPrices;
  slow: GasPrices;
}

// Interface for a custom paymaster client
export interface CustomPaymaster {
  sponsorUserOperation: (params: { userOperation: any }) => Promise<GetPaymasterDataReturnType>;
}

// Define our custom client type with the additional method
export type ShBundlerClient = BundlerClient & {
  getUserOperationGasPrice: () => Promise<GasPriceResult>;
};

// Define the configuration for ShBundlerClient
export interface ShBundlerClientConfig {
  transport: Transport;
  account?: SmartAccount;
  client?: Client;
  chain?: Chain;
  entryPoint?: {
    address: Address;
    version: "0.6" | "0.7";
  };
  paymaster?: {
    getPaymasterData?: (parameters: GetPaymasterDataParameters) => Promise<GetPaymasterDataReturnType>;
  };
}

// Fetch gas prices directly using fetch API
async function fetchGasPrice(): Promise<GasPriceResultEncoded> {
  const response = await fetch(SHBUNDLER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'gas_getUserOperationGasPrice',
      params: [],
    }),
  });
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Error fetching gas price: ${data.error.message}`);
  }
  
  return data.result;
}

// Factory function to create a ShBundlerClient
export function createShBundlerClient(
  config: ShBundlerClientConfig
): ShBundlerClient {
  // Create standard bundler client first
  console.log('🚀 Creating ShBundlerClient', config.paymaster ? 'with paymaster' : 'without paymaster');
  
  // Define the paymaster configuration safely
  const paymasterConfig = config.paymaster ? {
    getPaymasterData: config.paymaster.getPaymasterData,
  } : undefined;
  
  if (paymasterConfig) {
    console.log('📦 Paymaster integration enabled');
  }
  
  const bundlerClient = createBundlerClient({
    transport: config.transport,
    account: config.account,
    client: config.client,
    chain: config.chain || MONAD_CHAIN,
    paymaster: paymasterConfig,
  });
  
  // Add our custom methods
  const shBundlerClient: ShBundlerClient = {
    ...bundlerClient,
    getUserOperationGasPrice: async () => {
      const resultEncoded = await fetchGasPrice();
      
      return {
        slow: {
          maxFeePerGas: hexToBigInt(resultEncoded.slow.maxFeePerGas),
          maxPriorityFeePerGas: hexToBigInt(resultEncoded.slow.maxPriorityFeePerGas),
        },
        standard: {
          maxFeePerGas: hexToBigInt(resultEncoded.standard.maxFeePerGas),
          maxPriorityFeePerGas: hexToBigInt(resultEncoded.standard.maxPriorityFeePerGas),
        },
        fast: {
          maxFeePerGas: hexToBigInt(resultEncoded.fast.maxFeePerGas),
          maxPriorityFeePerGas: hexToBigInt(resultEncoded.fast.maxPriorityFeePerGas),
        },
      };
    }
  };
  
  return shBundlerClient;
}

// Function to create a regular bundler client without a paymaster
export function initBundler(
  account: SmartAccount, 
  publicClient: Client
): ShBundlerClient {
  console.log('🔄 Creating regular ShBundlerClient');
  return createShBundlerClient({
    transport: http(SHBUNDLER_URL),
    account,
    client: publicClient,
    chain: MONAD_CHAIN,
    entryPoint: {
      address: ENTRY_POINT_ADDRESS as Address,
      version: "0.7"
    }
  });
}

// Function to create a bundler with a custom paymaster client
export function initBundlerWithPaymaster(
  account: SmartAccount, 
  publicClient: Client,
  paymasterClient: any // Use the PaymasterClient type
): ShBundlerClient {
  console.log('🚀 Creating ShBundlerClient with paymaster');
  console.log('📌 Entry point address:', ENTRY_POINT_ADDRESS);
  console.log('📌 Chain ID:', MONAD_CHAIN.id);
  
  // Create a configured bundler client with paymaster
  const bundlerClient = createShBundlerClient({
    transport: http(SHBUNDLER_URL),
    account,
    client: publicClient,
    chain: MONAD_CHAIN,
    entryPoint: {
      address: ENTRY_POINT_ADDRESS as Address,
      version: '0.7',
    },
    paymaster: {
      getPaymasterData: async (params) => {
        console.log('📬 Bundler requesting paymaster data', {
          sender: params.sender,
          nonce: params.nonce ? params.nonce.toString() : 'undefined',
          callData: params.callData ? params.callData.substring(0, 10) + '...' : 'undefined',
        });
        
        try {
          // Use the PaymasterClient's getPaymasterData method with explicit entryPoint and chainId
          const result = await paymasterClient.getPaymasterData({
            ...params,
            chainId: MONAD_CHAIN.id,
            entryPointAddress: ENTRY_POINT_ADDRESS as Address,
          });
          
          // Log the result for debugging
          if (result?.paymasterAndData) {
            console.log('✅ Paymaster data received:', {
              paymaster: `0x${result.paymasterAndData.substring(2, 42)}`,
              dataLength: result.paymasterAndData.length,
              prefix: result.paymasterAndData.substring(0, 66) + '...',
            });
          } else {
            console.warn('⚠️ No paymaster data returned from paymasterClient');
          }
          
          return result;
        } catch (error) {
          console.error('❌ Error getting paymaster data:', error);
          // Rethrow the error to be handled by the bundler
          throw error;
        }
      },
    },
  });

  console.log('📦 Paymaster integration enabled');
  
  // Add a debug method to verify the paymaster integration and override sendUserOperation
  const enhancedBundler = {
    ...bundlerClient,
    // Override sendUserOperation to ensure proper paymaster integration
    sendUserOperation: async (params: any) => {
      console.log('📤 Enhanced bundler sending user operation...');
      
      console.log('📝 User operation details:', {
        calls: params.calls ? `${params.calls.length} calls` : 'No calls',
        entryPoint: ENTRY_POINT_ADDRESS,
        account: params.account?.address || 'No account'
      });
      
      // Always add the required paymaster gas limits to the params
      const userOpParams = {
        ...params,
        paymasterVerificationGasLimit: 75000n,
        paymasterPostOpGasLimit: 120000n
      };
      
      console.log('⛽ Setting paymaster gas limits:', {
        verificationGasLimit: '75000n',
        postOpGasLimit: '120000n'
      });
      
      // First prepare the operation to ensure paymaster data is properly included
      try {
        const preparedOp = await bundlerClient.prepareUserOperation(userOpParams);
        
        // If we have paymasterAndData, extract the paymaster address
        if (preparedOp.paymasterAndData && preparedOp.paymasterAndData !== '0x') {
          console.log('✅ Paymaster data found:', preparedOp.paymasterAndData.substring(0, 66) + '...');
          
          // Extract the paymaster address from paymasterAndData (first 20 bytes after 0x)
          const paymasterAddress = '0x' + preparedOp.paymasterAndData.substring(2, 42);
          console.log('📍 Extracted paymaster address:', paymasterAddress);
          
          // Add the paymaster as a separate field for the bundler (some bundlers require this)
          userOpParams.paymaster = paymasterAddress;
        } else {
          console.warn('⚠️ No paymaster data in prepared operation - paymaster integration may fail');
        }
        
        console.log('✅ User operation prepared with:', {
          sender: preparedOp.sender,
          paymasterData: preparedOp.paymasterAndData ? `${preparedOp.paymasterAndData.substring(0, 66)}...` : 'None',
          signature: preparedOp.signature ? `${preparedOp.signature.substring(0, 10)}...` : 'None'
        });
        
        // Send the updated operation with all necessary fields
        return bundlerClient.sendUserOperation(userOpParams);
      } catch (prepareError) {
        console.error('❌ Error preparing user operation:', prepareError);
        // If preparation fails, try sending with the enhanced params directly
        return bundlerClient.sendUserOperation(userOpParams);
      }
    },
    verifyPaymasterIntegration: async () => {
      try {
        console.log('🔍 Verifying paymaster integration...');
        
        // First check bundler's gas price functionality
        try {
          const gasPrice = await bundlerClient.getUserOperationGasPrice();
          console.log('✅ Bundler gas price API working:', {
            maxFeePerGas: gasPrice.standard.maxFeePerGas.toString(),
            maxPriorityFeePerGas: gasPrice.standard.maxPriorityFeePerGas.toString()
          });
        } catch (gasPriceError) {
          console.error('❌ Bundler gas price API failed:', gasPriceError);
          console.log('This indicates a possible issue with the bundler connection');
        }
        
        // Try to prepare a user operation to check if paymaster data is included
        console.log('Preparing minimal user operation with the bundler...');
        const userOp = await bundlerClient.prepareUserOperation({
          account,
          calls: [{
            to: account.address,
            value: 0n,
            data: '0x',
          }],
        });
        
        console.log('✅ User operation prepared:', {
          sender: userOp.sender,
          nonce: userOp.nonce.toString(),
          callData: userOp.callData.substring(0, 10) + '...',
          signature: userOp.signature ? userOp.signature.substring(0, 10) + '...' : 'None',
        });
        
        // Check if paymasterAndData is present
        if (userOp?.paymasterAndData && userOp.paymasterAndData !== '0x') {
          console.log('✅ PAYMASTER INTEGRATION VERIFIED:', userOp.paymasterAndData.substring(0, 66) + '...');
          
          // Try to parse the paymaster address from paymasterAndData
          try {
            const paymasterAddress = '0x' + userOp.paymasterAndData.substring(2, 42);
            console.log('📍 Extracted paymaster address:', paymasterAddress);
          } catch (parseError) {
            console.warn('⚠️ Could not parse paymaster address from paymasterAndData');
          }
          
          return true;
        } else {
          console.warn('⚠️ Paymaster integration NOT verified - no paymasterAndData in user operation');
          
          // Try to diagnose why paymaster data is missing
          console.log('🔍 Diagnosing paymaster integration issues:');
          console.log('1. Checking bundler configuration...');
          console.log('   - Bundler URL:', SHBUNDLER_URL);
          console.log('   - Entry Point:', ENTRY_POINT_ADDRESS);
          console.log('   - Chain ID:', MONAD_CHAIN.id);
          
          return false;
        }
      } catch (error) {
        console.error('❌ Error verifying paymaster integration:', error);
        
        // Provide more context based on the error
        if (error instanceof Error) {
          if (error.message.includes('paymaster')) {
            console.error('This appears to be a paymaster-specific error.');
          } else if (error.message.includes('gas')) {
            console.error('This appears to be a gas estimation error.');
          } else if (error.message.includes('account') || error.message.includes('sender')) {
            console.error('This appears to be an account initialization error.');
          }
        }
        
        return false;
      }
    }
  };
  
  return enhancedBundler as ShBundlerClient;
}
