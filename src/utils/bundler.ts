import {
  type BundlerClient,
  type SmartAccount,
  createBundlerClient,
  type UserOperation,
  type GetPaymasterDataParameters,
  type GetPaymasterDataReturnType,
} from 'viem/account-abstraction';
import { http, type Client, type Hex, hexToBigInt, type Transport, type Chain, type Address } from 'viem';
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

// Custom paymaster client interface
export interface CustomPaymaster {
  sponsorUserOperation: (params: { userOperation: GetPaymasterDataParameters }) => Promise<GetPaymasterDataReturnType>;
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
  const bundlerClient = createBundlerClient({
    transport: config.transport,
    account: config.account,
    client: config.client,
    chain: config.chain || MONAD_CHAIN,
    paymaster: config.paymaster ? {
      getPaymasterData: config.paymaster.getPaymasterData,
    } : undefined,
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

// Function to create a bundler with a custom paymaster client
export function initBundlerWithPaymaster(
  account: SmartAccount, 
  publicClient: Client,
  customPaymaster: CustomPaymaster
): ShBundlerClient {
  return createShBundlerClient({
    transport: http(SHBUNDLER_URL),
    account,
    client: publicClient,
    chain: MONAD_CHAIN,
    entryPoint: {
      address: ENTRY_POINT_ADDRESS as Address,
      version: "0.7"
    },
    paymaster: {
      getPaymasterData: (parameters) => customPaymaster.sponsorUserOperation({ userOperation: parameters }),
    }
  });
}

// For backward compatibility
export function initBundler(account: SmartAccount, publicClient: Client): ShBundlerClient {
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
