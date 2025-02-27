import { type Address, type Hex, type WalletClient, http } from 'viem';
import { 
  type GetPaymasterDataParameters,
  type GetPaymasterDataReturnType,
  type GetPaymasterStubDataReturnType,
  type GetPaymasterStubDataParameters,
  createPaymasterClient,
  type PaymasterClient
} from 'viem/account-abstraction';
import { toPackedUserOperation } from 'viem/account-abstraction';
import { initContract, paymasterMode } from './contracts';
import { publicClient, RPC_URL } from './config';

/**
 * Interface for the paymaster client configuration
 */
export interface CustomPaymasterClientConfig {
  paymasterAddress: Address;
  paymasterAbi: any;
  sponsorWallet: WalletClient;
}

/**
 * Creates a custom paymaster client for sponsor-based transactions using viem's createPaymasterClient
 */
export function createCustomPaymasterClient(config: CustomPaymasterClientConfig): PaymasterClient {
  const { paymasterAddress, paymasterAbi, sponsorWallet } = config;
  
  // Log detailed information about the paymaster configuration
  console.log('🔨 Creating custom paymaster client', { 
    paymasterAddress: paymasterAddress || 'undefined', 
    sponsorAddress: sponsorWallet?.account?.address || 'undefined' 
  });
  
  // Validate configuration
  if (!paymasterAddress) {
    console.error('❌ Invalid paymaster address:', paymasterAddress);
    throw new Error('Paymaster address is required to create custom paymaster client');
  }
  
  if (!sponsorWallet) {
    console.error('❌ Sponsor wallet not provided');
    throw new Error('Sponsor wallet is required to create custom paymaster client');
  }
  
  if (!sponsorWallet.account) {
    console.error('❌ Sponsor wallet has no account configured');
    throw new Error('Sponsor wallet must have an account to create custom paymaster client');
  }
  
  console.log('✅ Paymaster client configuration is valid');

  // Create a standard paymaster client
  const paymasterClient = createPaymasterClient({
    transport: http(RPC_URL),
    name: 'Custom Sponsor Paymaster',
  });
  
  // Extend the client with our custom getPaymasterData implementation
  return paymasterClient.extend((client) => ({
    getPaymasterData: async (params: GetPaymasterDataParameters): Promise<GetPaymasterDataReturnType> => {
      try {
        console.log('🎯 Paymaster getPaymasterData called for sender:', params.sender);
        
        if (!params || !params.sender) {
          console.error('❌ Invalid user operation:', params);
          throw new Error('User operation is required with valid sender address');
        }
        
        console.log('📄 User operation details:', {
          sender: params.sender,
          nonce: params.nonce?.toString() || 'undefined',
          callData: params.callData?.substring(0, 10) + '...' || 'undefined',
        });
        
        // Current timestamp for validity window
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        
        // Set validity window (valid for 1 hour)
        const validUntil = currentTime + BigInt(3600);
        const validAfter = BigInt(0);
        
        // Convert validity times to readable format for logging
        const validUntilDate = new Date(Number(validUntil) * 1000);
        console.log('⏰ Setting sponsorship validity window until:', validUntilDate.toISOString());
        
        // Initialize the paymaster contract
        const paymasterContract = await initContract(
          paymasterAddress,
          paymasterAbi,
          publicClient
        );
        
        if (!paymasterContract) {
          throw new Error(`Failed to initialize paymaster contract at ${paymasterAddress}`);
        }
        
        try {
          console.log('🔍 Calling getHash on paymaster contract...');
          console.log('   Contract address:', paymasterAddress);
          console.log('   Valid until:', validUntil.toString());
          console.log('   Valid after:', validAfter.toString());
          
          // Create a complete user operation with all required fields
          const completeUserOp = {
            ...params,
            callGasLimit: params.callGasLimit || 100000n,
            verificationGasLimit: params.verificationGasLimit || 100000n,
            preVerificationGas: params.preVerificationGas || 100000n,
            maxFeePerGas: params.maxFeePerGas || 1000000000n,
            maxPriorityFeePerGas: params.maxPriorityFeePerGas || 1000000000n,
            paymasterAndData: '0x' as Hex,
            signature: '0x' as Hex,
            initCode: params.initCode || '0x' as Hex
          };
          
          // Get hash to sign from the paymaster contract
          console.log('🧠 Calling getHash with packed user operation');
          const hash = await paymasterContract.read.getHash([
            toPackedUserOperation(completeUserOp as any),
            validUntil,
            validAfter,
          ]) as Hex;
          
          if (!hash) {
            throw new Error('Paymaster returned null hash');
          }
          
          console.log('📋 Got hash to sign from paymaster:', hash.substring(0, 10) + '...');
          
          // Ensure sponsor wallet has an account
          if (!sponsorWallet.account) {
            throw new Error('Sponsor wallet account is undefined');
          }
          
          // Sign hash with sponsor wallet
          const sponsorSignature = await sponsorWallet.signMessage({
            account: sponsorWallet.account,
            message: { raw: hash as Hex },
          });
          
          console.log('🖋️ Sponsor signed the hash with signature:', sponsorSignature.slice(0, 10) + '...');
          
          // Create paymaster data
          const paymasterData = paymasterMode(
            "sponsor",
            validUntil,
            validAfter,
            sponsorSignature,
            sponsorWallet
          ) as Hex;
          
          console.log('📊 Created paymaster data:', paymasterData.slice(0, 10) + '...');
          
          // Format the paymasterAndData field - this is crucial for the bundler
          // It should be formatted as: paymasterAddress + paymasterData (without 0x prefix)
          const formattedPaymasterAndData = `0x${paymasterAddress.slice(2)}${paymasterData.slice(2)}` as Hex;
          console.log('🔑 Formatted paymasterAndData:', formattedPaymasterAndData.slice(0, 66) + '...');
          
          // Return paymaster data in the correct format expected by the bundler (single paymasterAndData field)
          return {
            paymasterAndData: formattedPaymasterAndData
          };
        } catch (error) {
          console.error('❌ Error getting hash from paymaster:', error);
          // Provide detailed debug information
          console.error('Debug info:', {
            paymasterAddress,
            userOpSender: params.sender,
            userOpNonce: params.nonce?.toString() || 'undefined',
            validUntil: validUntil.toString(),
            validAfter: validAfter.toString(),
          });
          throw error;
        }
      } catch (outerError) {
        console.error('❌❌ Critical error in paymaster getPaymasterData:', outerError);
        
        if (outerError instanceof Error) {
          const errorMessage = outerError.message || 'Unknown error';
          
          // Check for common error patterns
          if (errorMessage.includes('length') || errorMessage.includes('bytes')) {
            console.error('⚠️ Length-related error detected. This usually indicates a problem with the format of one of the user operation fields.');
            console.error('⚠️ Check for undefined or null values in the user operation.');
          }
          
          if (errorMessage.includes('invalid address')) {
            console.error('⚠️ Invalid address error detected. Check the sender address and other address fields.');
          }
        }
        
        throw outerError;
      }
    },
    
    // Stub implementation for getPaymasterStubData required by PaymasterActions interface
    getPaymasterStubData: async (params: GetPaymasterStubDataParameters): Promise<GetPaymasterStubDataReturnType> => {
      console.log('🔍 Paymaster getPaymasterStubData called for gas estimation', {
        sender: params.sender,
        chainId: params.chainId,
        entryPointAddress: params.entryPointAddress
      });
      
      // Generate empty paymaster data for the stub (for gas estimation)
      const emptyPaymasterData = '0x' + '00'.repeat(64) as Hex;
      
      console.log('📈 Generating stub paymaster data with:', {
        paymasterAddress,
        verificationGasLimit: '75000n',
        postOpGasLimit: '120000n'
      });
      
      // Using the alternative format with just paymasterAndData
      // This is simpler and avoids type issues
      const paymasterAndData = `0x${paymasterAddress.slice(2)}${'00'.repeat(64)}` as Hex;
      
      return {
        paymasterAndData,
        sponsor: {
          name: 'Custom Sponsor Paymaster'
        },
        isFinal: true
      };
    }
  }));
} 