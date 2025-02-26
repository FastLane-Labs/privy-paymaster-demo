import { type BundlerClient, type SmartAccount, createBundlerClient } from 'viem/account-abstraction';
import { http, type Client, type Hex, hexToBigInt } from 'viem';
import { MONAD_CHAIN, SHBUNDLER_URL } from './config';

interface GasPriceRequest {
  method: "gas_getUserOperationGasPrice";
  params: [];
  ReturnType: GasPriceResultEncoded;
}

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

interface GasPriceResult {
  fast: GasPrices;
  standard: GasPrices;
  slow: GasPrices;
}

export interface ShBundler extends BundlerClient {
  getUserOperationGasPrice: () => Promise<GasPriceResult>;
}

function createShBundler(client: BundlerClient): ShBundler {
  return {
    ...client,
    getUserOperationGasPrice: async (): Promise<GasPriceResult> => {
      const resultEncoded = await client.request<GasPriceRequest>({
        method: "gas_getUserOperationGasPrice",
        params: [],
      });

      return {
        slow: {
          maxFeePerGas: hexToBigInt(resultEncoded.slow.maxFeePerGas),
          maxPriorityFeePerGas: hexToBigInt(
            resultEncoded.slow.maxPriorityFeePerGas
          ),
        },
        standard: {
          maxFeePerGas: hexToBigInt(resultEncoded.standard.maxFeePerGas),
          maxPriorityFeePerGas: hexToBigInt(
            resultEncoded.standard.maxPriorityFeePerGas
          ),
        },
        fast: {
          maxFeePerGas: hexToBigInt(resultEncoded.fast.maxFeePerGas),
          maxPriorityFeePerGas: hexToBigInt(
            resultEncoded.fast.maxPriorityFeePerGas
          ),
        },
      };
    },
  };
}

export function initBundler(account: SmartAccount, publicClient: Client): ShBundler {
  return createShBundler(
    createBundlerClient({
      transport: http(SHBUNDLER_URL),
      name: "shBundler",
      account: account,
      client: publicClient,
      chain: MONAD_CHAIN,
    })
  );
} 