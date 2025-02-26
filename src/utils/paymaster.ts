import { type Address, type Hex, type Client, type WalletClient } from 'viem';
import { 
  type GetPaymasterDataParameters,
  type GetPaymasterDataReturnType 
} from 'viem/account-abstraction';
import { toPackedUserOperation } from 'viem/account-abstraction';
import { initContract, paymasterMode } from './contracts';
import { publicClient } from './config';

/**
 * Interface for the paymaster client configuration
 */
export interface CustomPaymasterClientConfig {
  paymasterAddress: Address;
  paymasterAbi: any;
  sponsorWallet: WalletClient;
}

/**
 * Creates a custom paymaster client for sponsor-based transactions
 */
export function createCustomPaymasterClient(config: CustomPaymasterClientConfig) {
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
  
  return {
    /**
     * Returns paymaster data for a user operation
     */
    async sponsorUserOperation({ 
      userOperation
    }: { 
      userOperation: GetPaymasterDataParameters 
    }): Promise<GetPaymasterDataReturnType> {
      try {
        console.log('🎯 Paymaster sponsorUserOperation called for sender:', userOperation.sender);
        
        if (!userOperation || !userOperation.sender) {
          console.error('❌ Invalid user operation:', userOperation);
          throw new Error('User operation is required with valid sender address');
        }
        
        console.log('📄 User operation details:', {
          sender: userOperation.sender,
          nonce: userOperation.nonce?.toString() || 'undefined',
          callData: userOperation.callData?.substring(0, 10) + '...' || 'undefined',
        });
        
        // Current timestamp for validity window
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        
        // Set validity window (valid for 1 hour)
        const validUntil = currentTime + BigInt(3600);
        const validAfter = BigInt(0);
        
        // Convert validity times to readable format for logging
        const validUntilDate = new Date(Number(validUntil) * 1000);
        console.log('⏰ Setting sponsorship validity window until:', validUntilDate.toISOString());
        
        console.log('📦 Creating packed user operation for hashing');
        
        // Instead of manually creating the packed user operation, use the viem utility
        console.log('Using toPackedUserOperation to properly format the user operation');
        
        // First ensure we have all required fields with default values
        const userOpWithDefaults = {
          sender: userOperation.sender,
          nonce: userOperation.nonce || 0n,
          callData: userOperation.callData || '0x',
          initCode: userOperation.initCode || '0x',
          callGasLimit: userOperation.callGasLimit || 1000000n,
          verificationGasLimit: userOperation.verificationGasLimit || 1000000n,
          preVerificationGas: userOperation.preVerificationGas || 1000000n,
          maxFeePerGas: userOperation.maxFeePerGas || 1000000n,
          maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas || 1000000n,
          paymasterAndData: '0x' as `0x${string}`,
          signature: '0x' as `0x${string}`
        };
        
        // Use the viem utility to properly pack the user operation
        const packedUserOp = toPackedUserOperation(userOpWithDefaults);
        
        console.log('✅ Successfully packed user operation using viem utility');
        console.log('📝 Packed user operation:', {
          sender: packedUserOp.sender,
          nonce: packedUserOp.nonce.toString(),
          callData: packedUserOp.callData?.substring(0, 10) + '...',
          initCode: packedUserOp.initCode,
          accountGasLimits: packedUserOp.accountGasLimits,
          preVerificationGas: packedUserOp.preVerificationGas.toString(),
          gasFees: packedUserOp.gasFees,
        });
        
        console.log('🧮 Getting hash from paymaster contract...');
        
        // Initialize the paymaster contract
        const paymasterContract = await initContract(
          paymasterAddress,
          paymasterAbi,
          publicClient
        );
        
        if (!paymasterContract) {
          throw new Error(`Failed to initialize paymaster contract at ${paymasterAddress}`);
        }
        
        // Log the user operation we're sending to get hash
        console.log('📝 User operation for hashing:', {
          sender: packedUserOp.sender,
          nonce: packedUserOp.nonce.toString(),
          callData: packedUserOp.callData?.substring(0, 10) + '...',
          initCode: packedUserOp.initCode,
          accountGasLimits: packedUserOp.accountGasLimits,
          preVerificationGas: packedUserOp.preVerificationGas.toString(),
          gasFees: packedUserOp.gasFees,
          signature: packedUserOp.signature
        });
        
        // Ensure all required fields are present
        if (!packedUserOp.sender || packedUserOp.nonce === undefined || !packedUserOp.callData) {
          throw new Error(`Invalid user operation - missing required fields: 
            sender=${!!packedUserOp.sender}, 
            nonce=${packedUserOp.nonce !== undefined}, 
            callData=${!!packedUserOp.callData}`);
        }
        
        // Ensure we have initCode (even if empty)
        if (packedUserOp.initCode === undefined) {
          packedUserOp.initCode = '0x';
        }
        
        try {
          console.log('🔍 Calling getHash on paymaster contract...');
          console.log('   Contract address:', paymasterAddress);
          console.log('   Valid until:', validUntil.toString());
          console.log('   Valid after:', validAfter.toString());
          
          // Get hash to sign
          console.log('🧠 Calling getHash with packedUserOp:', {
            sender: packedUserOp.sender,
            nonce: packedUserOp.nonce.toString(),
            // Add other key fields to validate
          });
          
          const hash = await paymasterContract.read.getHash([
            packedUserOp,
            validUntil,
            validAfter,
          ]) as Hex;
          
          console.log('📊 Raw hash result:', hash);
          console.log('📊 Hash type:', typeof hash);
          console.log('📊 Is hash array?', Array.isArray(hash));
          
          if (!hash) {
            throw new Error('Paymaster returned null hash');
          }
          
          console.log('📋 Got hash to sign from paymaster:', 
            typeof hash === 'string' && hash.substring ? 
            hash.substring(0, 10) + '...' : 
            `[Hash format: ${typeof hash}]`);
          
          console.log('✍️ Signing hash with sponsor wallet...');
          
          // Ensure sponsor wallet has an account
          if (!sponsorWallet.account) {
            throw new Error('Sponsor wallet account is undefined');
          }
          
          // Sign hash with sponsor wallet
          const signature = await sponsorWallet.signMessage({
            account: sponsorWallet.account,
            message: { raw: hash as Hex },
          });
          
          if (!signature) {
            throw new Error('Failed to sign hash with sponsor wallet');
          }
          
          console.log('🖋️ Sponsor signed the hash with signature:', signature.slice(0, 10) + '...');
          
          console.log('🛠️ Creating paymaster data...');
          
          // Create paymaster data
          const paymasterData = paymasterMode(
            "sponsor",
            validUntil,
            validAfter,
            signature,
            sponsorWallet
          ) as Hex;
          
          if (!paymasterData) {
            throw new Error('Failed to create paymaster data');
          }
          
          console.log('📊 Created paymaster data:', paymasterData.slice(0, 10) + '...');
          
          return paymasterData as unknown as GetPaymasterDataReturnType;
        } catch (error) {
          console.error('❌ Error getting hash from paymaster:', error);
          // Provide detailed debug information
          console.error('Debug info:', {
            paymasterAddress,
            userOpSender: packedUserOp.sender,
            userOpNonce: packedUserOp.nonce.toString(),
            validUntil: validUntil.toString(),
            validAfter: validAfter.toString(),
          });
          throw error;
        }
      } catch (outerError) {
        console.error('❌❌ Critical error in paymaster sponsorUserOperation:', outerError);
        
        if (outerError instanceof Error) {
          const errorMessage = outerError.message || 'Unknown error';
          
          // Check for common error patterns
          if (errorMessage.includes('length')) {
            console.error('⚠️ Length-related error detected. This usually indicates a problem with the format of one of the user operation fields.');
            console.error('⚠️ Check for undefined or null values in the user operation.');
          }
          
          if (errorMessage.includes('invalid address')) {
            console.error('⚠️ Invalid address error detected. Check the sender address and other address fields.');
          }
        }
        
        throw outerError;
      }
    }
  };
} 