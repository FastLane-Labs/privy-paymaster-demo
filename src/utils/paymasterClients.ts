import { 
  createPaymasterClient, 
  type PaymasterClient
} from 'viem/account-abstraction';
import { Hex, Address, http } from 'viem';
import { paymasterMode } from './contracts';

/**
 * Creates a viem paymaster client that uses our custom paymaster RPC endpoint
 */
export function createApiPaymasterClient(): PaymasterClient {
  console.log('🔨 Creating local paymaster client using API endpoint');
  
  // Create the paymaster client using the factory function from viem
  // This will automatically handle the RPC calls to our backend API
  const paymasterClient = createPaymasterClient({
    transport: http('/api/paymaster'),
    name: 'Fastlane Paymaster RPC',
  });
  
  console.log('✅ Fastlane paymaster client initialized with backend API endpoint');
  console.log('🔄 Will use RPC methods: pm_getPaymasterStubData and pm_getPaymasterData');
  
  return paymasterClient;
} 

/**
 * Generates the paymasterAndData field for self-sponsored transactions
 * 
 * This function creates the correctly formatted paymasterAndData field required by the ERC-4337 standard.
 * It combines the paymaster address with the paymaster data in the format expected by the ERC-4337 standard.
 * 
 */
export function generateSelfSponsoredPaymasterAndData(paymasterAddress: Address): {
  paymaster: Address;
  paymasterData: Hex;
  paymasterVerificationGasLimit: string;
  paymasterPostOpGasLimit: string;
  preVerificationGas: string;
  verificationGasLimit: string;
} {
  console.log('🔨 Creating local paymaster client using local endpoint');
  
  // Create the paymaster client using the factory function from viem
  // This will automatically handle the RPC calls to our local endpoint

  const paymasterData = paymasterMode('user') as Hex;
  
  // Store these values as strings instead of BigInt for JSON serialization
  const paymasterVerificationGasLimit = '75000'; // fine-tuned for the fastlane paymaster
  const paymasterPostOpGasLimit = '120000';      // fine-tuned for the fastlane paymaster
  const preVerificationGas = '217335';           // fine-tuned for the fastlane paymaster
  const verificationGasLimit = '328107';         // fine-tuned for the fastlane paymaster

  return {
    paymaster: paymasterAddress,
    paymasterData,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    preVerificationGas,
    verificationGasLimit,
  };
}
