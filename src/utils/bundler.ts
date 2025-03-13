import {
  type BundlerClient,
  type SmartAccount,
  createBundlerClient,
  type UserOperation,
  type GetPaymasterDataParameters,
  type GetPaymasterDataReturnType,
  entryPoint06Address,
  entryPoint07Address,
  type BundlerClientConfig,
} from 'viem/account-abstraction';
import {
  http,
  type Client,
  type Hex,
  hexToBigInt,
  type Transport,
  type Chain,
  type Address,
  type PublicClient,
} from 'viem';
import { MONAD_CHAIN, SHBUNDLER_URL, ENTRY_POINT_ADDRESS } from './config';
import { logger, formatUserOp } from './logger';

// Type for ShBundler which adds our custom actions
export type ShBundler = BundlerClient & {
  getUserOperationGasPrice: () => Promise<GasPriceResult>;
  verifyPaymasterIntegration?: () => Promise<boolean>;
};

// Gas price response types
interface GasPricesEncoded {
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
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

// Type to handle "prettify" in TypeScript (similar to Pimlico's implementation)
type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

// Define the configuration for ShBundlerClient with EntryPoint version generics
export type ShBundlerClientConfig<
  entryPointVersion extends '0.6' | '0.7' = '0.7',
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends SmartAccount | undefined = SmartAccount | undefined,
> = Prettify<{
  transport: Transport;
  account?: account;
  client?: Client;
  chain?: chain;
  entryPoint?: {
    address: Address;
    version: entryPointVersion;
  };
  paymaster?: {
    getPaymasterData?: (
      parameters: GetPaymasterDataParameters
    ) => Promise<GetPaymasterDataReturnType>;
  };
}>;

// Create our custom ShBundler with added methods
function createShBundler(client: BundlerClient): ShBundler {
  return {
    ...client,
    getUserOperationGasPrice: async (): Promise<GasPriceResult> => {
      // Use the direct fetch implementation that works
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

      const resultEncoded = data.result;

      return {
        slow: {
          maxFeePerGas: BigInt(resultEncoded.slow.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(resultEncoded.slow.maxPriorityFeePerGas),
        },
        standard: {
          maxFeePerGas: BigInt(resultEncoded.standard.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(resultEncoded.standard.maxPriorityFeePerGas),
        },
        fast: {
          maxFeePerGas: BigInt(resultEncoded.fast.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(resultEncoded.fast.maxPriorityFeePerGas),
        },
      };
    },
    verifyPaymasterIntegration: async function (this: BundlerClient): Promise<boolean> {
      try {
        logger.info('Verifying paymaster integration...');

        // First check bundler's gas price functionality
        try {
          // Use "this" to access the method on the returned object
          const gasPrice = await (this as ShBundler).getUserOperationGasPrice();
          logger.info('Bundler gas price API working:', {
            maxFeePerGas: gasPrice.standard.maxFeePerGas.toString(),
            maxPriorityFeePerGas: gasPrice.standard.maxPriorityFeePerGas.toString(),
          });
        } catch (gasPriceError) {
          logger.error('Bundler gas price API failed:', gasPriceError);
          logger.info('This indicates a possible issue with the bundler connection');
        }

        // Try to prepare a user operation to check if paymaster data is included
        logger.info('Preparing minimal user operation with the bundler...');

        const account = this.account;

        if (!account) {
          logger.error('No account configured in bundler client');
          return false;
        }

        const userOp = await this.prepareUserOperation({
          account,
          calls: [
            {
              to: account.address,
              value: 0n,
              data: '0x',
            },
          ],
        });

        logger.info('User operation prepared');

        // Check if paymasterAndData is present (v0.6) or paymaster and paymasterData (v0.7)
        if (userOp?.paymasterAndData && userOp.paymasterAndData !== '0x') {
          logger.info(
            'PAYMASTER INTEGRATION VERIFIED (v0.6):',
            userOp.paymasterAndData.substring(0, 66) + '...'
          );
          return true;
        } else if ((userOp as any)?.paymaster && (userOp as any)?.paymasterData) {
          logger.info('PAYMASTER INTEGRATION VERIFIED (v0.7):', {
            paymaster: (userOp as any).paymaster,
            paymasterData: (userOp as any).paymasterData.substring(0, 10) + '...',
          });
          return true;
        } else {
          logger.warn('Paymaster integration NOT verified - no paymaster data in user operation');
          return false;
        }
      } catch (error) {
        logger.error('Error verifying paymaster integration:', error);
        return false;
      }
    },
  };
}

// Simple function to initialize a bundler with paymaster
export function initShBundler(
  smartAccount: SmartAccount,
  publicClient: Client,
  paymasterClient: any,
  mode: 'sponsor' | 'user' = 'sponsor'
): ShBundler {
  logger.info(`Creating ShBundler with ${mode} mode paymaster`);

  // Create a bundler client without any BigInt values in paymasterContext
  // to prevent "Do not know how to serialize a BigInt" errors
  return createShBundler(
    createBundlerClient({
      transport: http(SHBUNDLER_URL),
      account: smartAccount,
      client: publicClient,
      chain: MONAD_CHAIN,
      paymaster: paymasterClient,
      paymasterContext: {
        mode: mode,
        address: smartAccount.address,
        // IMPORTANT: Only include serializable values in paymasterContext
        // Any BigInt values must be converted to strings before being added here
      },
    })
  );
}

// Basic bundler without paymaster for non-sponsored operations
export function initBasicBundler(smartAccount: SmartAccount, publicClient: Client): ShBundler {
  logger.info('Creating basic ShBundler without paymaster');

  return createShBundler(
    createBundlerClient({
      transport: http(SHBUNDLER_URL),
      account: smartAccount,
      client: publicClient,
      chain: MONAD_CHAIN,
    })
  );
}
