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
  customPaymaster: CustomPaymaster
): ShBundlerClient {
  console.log('🚀 Creating ShBundlerClient with paymaster');
  
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
          nonce: params.nonce,
        });
        
        try {
          const result = await customPaymaster.sponsorUserOperation({ userOperation: params });
          console.log('✅ Paymaster data received:', 
            result?.paymasterAndData ? 
            result.paymasterAndData.substring(0, 20) + '...' : 
            'No paymaster data available');
          return result;
        } catch (error) {
          console.error('❌ Error getting paymaster data:', error);
          throw error;
        }
      },
    },
  });

  console.log('📦 Paymaster integration enabled');
  return bundlerClient;
}
