import { NextApiRequest, NextApiResponse } from 'next';
import { paymasterMode } from '../../utils/contracts';
import { toPackedUserOperation, UserOperation } from 'viem/account-abstraction';
import { createWalletClient, http, type Hex, type Address, createPublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ADDRESS_HUB } from '../../utils/config';
import paymasterAbi from '../../abis/paymaster.json';
import addressHubAbi from '../../abis/addressHub.json';
import { monadTestnet } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { logger } from '../../utils/logger';

// Use a backend-specific RPC URL (not prefixed with NEXT_PUBLIC_)
const BACKEND_RPC_URL = process.env.RPC_URL || 'https://rpc.ankr.com/monad_testnet';

// Create backend-specific public client
const backendPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(BACKEND_RPC_URL)
});

// Create a sponsor wallet client using the private key
const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_WALLET_PRIVATE_KEY;
if (!SPONSOR_PRIVATE_KEY) {
  logger.error('SPONSOR_WALLET_PRIVATE_KEY environment variable is not set');
  logger.error('This is required for the paymaster to work properly');
}

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

/**
 * Helper: Read paymaster address directly from the contract
 */
async function getPaymasterAddress(): Promise<Address | null> {
  if (!ADDRESS_HUB) {
    logger.error('ADDRESS_HUB is not defined. Please check your environment variables.');
    return null;
  }

  try {
    const paymasterAddress = await backendPublicClient.readContract({
      address: ADDRESS_HUB,
      abi: addressHubAbi,
      functionName: 'paymaster4337',
      args: []
    }) as Address;
    
    if (!paymasterAddress || paymasterAddress === '0x0000000000000000000000000000000000000000') {
      logger.error('Invalid paymaster address read from contract');
      return null;
    }
    
    return paymasterAddress;
  } catch (error) {
    logger.error('Error reading paymaster address:', error);
    return null;
  }
}

/**
 * Helper: Generate and sign paymaster data for a user operation
 */
async function signUserOperationWithSponsor(
  userOperation: UserOperation,
  validUntil: bigint,
  validAfter: bigint
): Promise<{ 
  signature: Hex, 
  paymasterAddress: Address,
  paymasterData: Hex
} | null> {
  try {
    // Get paymaster address
    const paymasterAddress = await getPaymasterAddress();
    if (!paymasterAddress) {
      logger.error('No paymaster address available for signing');
      return null;
    }
    
    // Validate sponsor wallet
    if (!sponsorWallet || !sponsorAccount) {
      logger.error('No sponsor wallet available');
      return null;
    }
    
    // Get hash to sign directly from the contract
    const hash = await backendPublicClient.readContract({
      address: paymasterAddress,
      abi: paymasterAbi,
      functionName: 'getHash',
      args: [
        toPackedUserOperation(userOperation),
        validUntil,
        validAfter
      ]
    }) as Hex;
    
    if (!hash) {
      throw new Error(`Invalid hash returned from paymaster contract ${paymasterAddress}`);
    }
    
    // Sign hash with sponsor wallet
    const signature = await sponsorWallet.signMessage({
      account: sponsorAccount,
      message: { raw: hash },
    });
    
    logger.info('Generated signature for user operation', { 
      sender: userOperation.sender,
      signature: signature.substring(0, 10) + '...'
    });

    // Create paymaster data with the signature
    const paymasterData = paymasterMode(
      "sponsor",
      validUntil,
      validAfter,
      signature as Hex,
      sponsorWallet
    ) as Hex;
    
    return { 
      signature: signature as Hex, 
      paymasterAddress,
      paymasterData
    };
  } catch (error) {
    logger.error('Failed to sign user operation with sponsor:', error);
    return null;
  }
}

/**
 * Helper: Classify and format error for consistent response
 */
function formatPaymasterError(error: any, id: any): any {
  const errorMsg = error?.message || 'Unknown error';
  
  if (errorMsg.includes('insufficient') && errorMsg.includes('balance')) {
    return {
      jsonrpc: '2.0',
      id,
      error: { 
        code: -32010, 
        message: 'Paymaster has insufficient balance',
        data: errorMsg
      }
    };
  }
  
  if (errorMsg.includes('policy') || errorMsg.includes('limit')) {
    return {
      jsonrpc: '2.0',
      id,
      error: { 
        code: -32011, 
        message: 'Policy limit exceeded',
        data: errorMsg
      }
    };
  }
  
  // Default error
  return {
    jsonrpc: '2.0',
    id,
    error: { 
      code: -32603, 
      message: 'Paymaster internal error',
      data: errorMsg
    }
  };
}

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

    // Validate the JSON-RPC request
    if (jsonrpc !== '2.0' || !id || !method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32600, message: 'Invalid request' }
      });
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
    logger.error('RPC handler error:', error);
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
  
  try {
    // Extract parameters
    const [userOperation, entryPointAddress, chainId, context] = params;
    
    // Detect EntryPoint version based on the address
    const isEntryPointV07 = entryPointAddress == entryPoint07Address;
    
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
    
    // Set validity window (valid for 1 hour)
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const validUntil = currentTime + BigInt(3600);
    const validAfter = BigInt(0);
    
    // Generate and sign the paymaster data
    const signResult = await signUserOperationWithSponsor(
      userOperation as UserOperation, 
      validUntil,
      validAfter
    );
    
    if (!signResult) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32603, 
          message: 'Failed to sign user operation',
          data: 'Error generating paymaster signature'
        }
      });
    }
    
    const { signature, paymasterAddress, paymasterData } = signResult;
    
    // Format the combined paymasterAndData field if needed
    const formattedPaymasterAndData = `0x${paymasterAddress.slice(2)}${paymasterData.slice(2)}` as Hex;
    
    // Return successful response based on EntryPoint version
    if (isEntryPointV07) {
      // For EntryPoint v0.7: separate paymaster and paymasterData fields
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        result: {
          paymaster: paymasterAddress,
          paymasterData: paymasterData,
          sponsor: {
            name: 'Fastlane Paymaster'
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
            name: 'Fastlane Paymaster'
          },
          isFinal: true // This is the final data with real signature
        }
      });
    }
  } catch (error) {
    logger.error('Error in getPaymasterData:', error);
    
    // Format the error for consistent response
    const errorResponse = formatPaymasterError(error, id);
    return res.status(500).json(errorResponse);
  }
}

/**
 * Handle pm_getPaymasterStubData method
 */
async function handleGetPaymasterStubData(req: NextApiRequest, res: NextApiResponse) {
  const { id, params } = req.body;
  
  try {
    // Extract parameters
    const [userOperation, entryPointAddress, chainId, context] = params;
    
    // Detect EntryPoint version based on the address
    const isEntryPointV07 = entryPointAddress == entryPoint07Address;
    
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
    
    // Get paymaster address
    const paymasterAddress = await getPaymasterAddress();
    if (!paymasterAddress) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: { 
          code: -32603, 
          message: 'Paymaster address unavailable for stub data',
          data: 'Could not retrieve paymaster address from hub contract'
        }
      });
    }
    
    // Generate stub paymaster data with zeros for the signature part
    const paymasterAndData = `0x${paymasterAddress.slice(2)}${'00'.repeat(64)}` as Hex;
    
    // Return response based on EntryPoint version
    if (isEntryPointV07) {
      return res.status(200).json({
        jsonrpc: '2.0',
        id,
        result: {
          paymaster: paymasterAddress,
          paymasterData: '0x' + '00'.repeat(64) as Hex,
          paymasterVerificationGasLimit: 75000n,
          paymasterPostOpGasLimit: 120000n,
          sponsor: {
            name: 'Fastlane Paymaster'
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
            name: 'Fastlane Paymaster'
          },
          isFinal: false
        }
      });
    }
  } catch (error) {
    logger.error('Error in getPaymasterStubData:', error);
    
    // Format the error for consistent response
    const errorResponse = formatPaymasterError(error, id);
    return res.status(500).json(errorResponse);
  }
} 