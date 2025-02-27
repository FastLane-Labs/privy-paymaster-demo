import {
  type BundlerClient,
  type SmartAccount,
  createBundlerClient,
  type UserOperation,
  type GetPaymasterDataParameters,
  type GetPaymasterDataReturnType,
  entryPoint06Address,
  entryPoint07Address,
  type BundlerClientConfig
} from 'viem/account-abstraction';
import { http, type Client, type Hex, hexToBigInt, type Transport, type Chain, type Address, type PublicClient } from 'viem';
import { MONAD_CHAIN, SHBUNDLER_URL, ENTRY_POINT_ADDRESS } from './config';
import { logger, formatUserOp } from './logger';

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

// Type to handle "prettify" in TypeScript (similar to Pimlico's implementation)
type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

// Define our custom actions
export type ShBundlerActions = {
  getUserOperationGasPrice: () => Promise<GasPriceResult>;
  verifyPaymasterIntegration?: () => Promise<boolean>;
}

// Define our custom client type with EntryPoint version generics
export type ShBundlerClient<
  entryPointVersion extends "0.6" | "0.7" = "0.7",
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends SmartAccount | undefined = SmartAccount | undefined
> = Prettify<
  BundlerClient<transport, chain, account> & ShBundlerActions
>;

// Define the configuration for ShBundlerClient with EntryPoint version generics
export type ShBundlerClientConfig<
  entryPointVersion extends "0.6" | "0.7" = "0.7",
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends SmartAccount | undefined = SmartAccount | undefined
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
    getPaymasterData?: (parameters: GetPaymasterDataParameters) => Promise<GetPaymasterDataReturnType>;
  };
}>;

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

// Add our custom actions
export function shBundlerActions(): ShBundlerActions {
  return {
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
    },
    verifyPaymasterIntegration: async function(): Promise<boolean> {
      try {
        logger.info('Verifying paymaster integration...');
        
        // First check bundler's gas price functionality
        try {
          const gasPrice = await this.getUserOperationGasPrice();
          logger.info('Bundler gas price API working:', {
            maxFeePerGas: gasPrice.standard.maxFeePerGas.toString(),
            maxPriorityFeePerGas: gasPrice.standard.maxPriorityFeePerGas.toString()
          });
        } catch (gasPriceError) {
          logger.error('Bundler gas price API failed:', gasPriceError);
          logger.info('This indicates a possible issue with the bundler connection');
        }
        
        // Try to prepare a user operation to check if paymaster data is included
        logger.info('Preparing minimal user operation with the bundler...');
        
        // We need to cast 'this' to BundlerClient to access its methods
        const bundlerClient = this as unknown as BundlerClient;
        const account = bundlerClient.account;
        
        if (!account) {
          logger.error('No account configured in bundler client');
          return false;
        }
        
        const userOp = await bundlerClient.prepareUserOperation({
          account,
          calls: [{
            to: account.address,
            value: 0n,
            data: '0x',
          }],
        });
        
        // Log formatted user operation with improved signature details
        logger.info('User operation prepared');
        logger.debug('User operation details:', formatUserOp(userOp));
        
        // Check if paymasterAndData is present (v0.6) or paymaster and paymasterData (v0.7)
        if (userOp?.paymasterAndData && userOp.paymasterAndData !== '0x') {
          logger.info('PAYMASTER INTEGRATION VERIFIED (v0.6):', userOp.paymasterAndData.substring(0, 66) + '...');
          
          // Try to parse the paymaster address from paymasterAndData
          try {
            const paymasterAddress = '0x' + userOp.paymasterAndData.substring(2, 42);
            logger.info('Extracted paymaster address:', paymasterAddress);
          } catch (parseError) {
            logger.warn('Could not parse paymaster address from paymasterAndData');
          }
          
          return true;
        } else if ((userOp as any)?.paymaster && (userOp as any)?.paymasterData) {
          logger.info('PAYMASTER INTEGRATION VERIFIED (v0.7):', {
            paymaster: (userOp as any).paymaster,
            paymasterData: (userOp as any).paymasterData.substring(0, 10) + '...'
          });
          return true;
        } else {
          logger.warn('Paymaster integration NOT verified - no paymaster data in user operation');
          
          // Try to diagnose why paymaster data is missing
          logger.info('Diagnosing paymaster integration issues:');
          logger.debug('Bundler configuration:', {
            bundlerUrl: SHBUNDLER_URL,
            entryPoint: ENTRY_POINT_ADDRESS,
            chainId: MONAD_CHAIN.id
          });
          
          return false;
        }
      } catch (error) {
        logger.error('Error verifying paymaster integration:', error);
        
        // Provide more context based on the error
        if (error instanceof Error) {
          if (error.message.includes('paymaster')) {
            logger.error('This appears to be a paymaster-specific error.');
          } else if (error.message.includes('gas')) {
            logger.error('This appears to be a gas estimation error.');
          } else if (error.message.includes('account') || error.message.includes('sender')) {
            logger.error('This appears to be an account initialization error.');
          }
        }
        
        return false;
      }
    }
  };
}

// Function to create a ShBundlerClient - TypeScript generics declaration
export function createShBundlerClient<
  entryPointVersion extends "0.6" | "0.7" = "0.7",
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends SmartAccount | undefined = SmartAccount | undefined
>(
  config: ShBundlerClientConfig<entryPointVersion, transport, chain, account>
): ShBundlerClient<entryPointVersion, transport, chain, account>;

// Actual implementation
export function createShBundlerClient(
  config: ShBundlerClientConfig
): ShBundlerClient {
  const {
    transport,
    account,
    client,
    chain = MONAD_CHAIN,
    entryPoint,
    paymaster
  } = config;

  logger.info('Creating ShBundlerClient', paymaster ? 'with paymaster' : 'without paymaster');
  
  // Log entry point info
  let entryPointAddress = entryPoint?.address;
  if (!entryPointAddress) {
    // If no address is provided, determine based on version
    if (entryPoint?.version && typeof entryPoint.version === 'string' && entryPoint.version.includes('0.6')) {
      entryPointAddress = entryPoint06Address;
    } else {
      entryPointAddress = entryPoint07Address;
    }
  }
  
  const entryPointVersion = entryPoint?.version || "0.7";
  
  logger.info(`Using EntryPoint ${entryPointVersion} at address ${entryPointAddress}`);
  
  if (paymaster) {
    logger.info('Paymaster integration enabled');
  }
  
  // Create bundler client with the correct configuration
  // We need to separate the bundler config to avoid type errors
  const bundlerConfig: BundlerClientConfig = {
    transport,
    account,
    client,
    chain
  };
  
  // Add paymaster to config if provided
  if (paymaster) {
    bundlerConfig.paymaster = paymaster;
  }
  
  // Create the bundler client
  const bundlerClient = createBundlerClient(bundlerConfig);
  
  // Extend with our custom actions
  return Object.assign(bundlerClient, shBundlerActions());
}

// Function to create a regular bundler client without a paymaster
export function initBundler<
  entryPointVersion extends "0.6" | "0.7" = "0.7"
>(
  account: SmartAccount, 
  publicClient: Client,
  version: entryPointVersion = "0.7" as entryPointVersion
): ShBundlerClient<entryPointVersion> {
  logger.info(`Creating regular ShBundlerClient with EntryPoint v${version}`);
  
  // Determine entry point address based on version string
  let entryPointAddress: Address;
  if (typeof version === 'string' && version.includes('0.6')) {
    entryPointAddress = entryPoint06Address;
  } else {
    entryPointAddress = entryPoint07Address;
  }
  
  return createShBundlerClient({
    transport: http(SHBUNDLER_URL),
    account,
    client: publicClient,
    chain: MONAD_CHAIN,
    entryPoint: {
      address: entryPointAddress,
      version
    }
  });
}

// Function to create a bundler with a custom paymaster client
export function initBundlerWithPaymaster<
  entryPointVersion extends "0.6" | "0.7" = "0.7"
>(
  account: SmartAccount, 
  publicClient: Client,
  paymasterClient: any,
  version: entryPointVersion = "0.7" as entryPointVersion
): ShBundlerClient<entryPointVersion> {
  logger.info(`Creating ShBundlerClient with paymaster (EntryPoint v${version})`);
  
  // Determine entry point address based on version string
  let entryPointAddress: Address;
  if (typeof version === 'string' && version.includes('0.6')) {
    entryPointAddress = entryPoint06Address;
  } else {
    entryPointAddress = entryPoint07Address;
  }
  
  logger.debug('Bundler configuration details:', {
    entryPointAddress: entryPointAddress,
    chainId: MONAD_CHAIN.id
  });
  
  // Create a configured bundler client with paymaster
  return createShBundlerClient({
    transport: http(SHBUNDLER_URL),
    account,
    client: publicClient,
    chain: MONAD_CHAIN,
    entryPoint: {
      address: entryPointAddress,
      version
    },
    paymaster: {
      getPaymasterData: async (userOperation: GetPaymasterDataParameters) => {
        logger.debug('Bundler requesting paymaster data', {
          sender: userOperation.sender,
          nonce: userOperation.nonce ? userOperation.nonce.toString() : 'undefined',
          callData: userOperation.callData ? userOperation.callData.substring(0, 10) + '...' : 'undefined',
        });
        
        try {
          // Use the PaymasterClient's getPaymasterData method with explicit entryPoint and chainId
          const result = await paymasterClient.getPaymasterData({
            ...userOperation,
            chainId: MONAD_CHAIN.id,
            entryPointAddress: entryPointAddress,
          });
          
          // Log the complete result structure for debugging
          logger.debug('Raw paymaster result structure:', JSON.stringify(result, null, 2));
          
          // Log the result for debugging
          if (result?.paymasterAndData) {
            logger.info('Paymaster data received (v0.6 format):', {
              paymaster: `0x${result.paymasterAndData.substring(2, 42)}`,
              dataLength: result.paymasterAndData.length,
              prefix: result.paymasterAndData.substring(0, 66) + '...',
            });
            
            // Validate the paymaster address
            const extractedPaymaster = `0x${result.paymasterAndData.substring(2, 42)}`;
            if (extractedPaymaster === '0x0000000000000000000000000000000000000000') {
              logger.warn('Invalid zero address detected in paymasterAndData!');
            }
          } else if (result?.paymaster && result?.paymasterData) {
            // For v0.7 format, validate the paymaster address
            if (result.paymaster === '0x0000000000000000000000000000000000000000') {
              logger.warn('Invalid zero address detected for paymaster!');
            }
            
            logger.info('Paymaster data received (v0.7 format):', {
              paymaster: result.paymaster,
              dataLength: result.paymasterData.length,
              prefix: result.paymasterData.substring(0, 10) + '...',
            });
            
            // Additional validation for other fields
            logger.debug('Additional v0.7 fields:', {
              isFinal: result.isFinal !== undefined ? result.isFinal : 'not set',
              verificationGasLimit: result.verificationGasLimit || 'not set',
              callGasLimit: result.callGasLimit || 'not set',
              preVerificationGas: result.preVerificationGas || 'not set',
              sponsor: result.sponsor ? 'present' : 'not set'
            });
          } else {
            logger.warn('No paymaster data returned from paymasterClient');
            logger.debug('Response structure:', Object.keys(result || {}).join(', '));
          }
          
          return result;
        } catch (error) {
          logger.error('Error getting paymaster data:', error);
          // Rethrow the error to be handled by the bundler
          throw error;
        }
      },
    },
  });
}
