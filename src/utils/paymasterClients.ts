import { 
  createPaymasterClient, 
  type PaymasterClient
} from 'viem/account-abstraction';
import { http } from 'viem';

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