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
  
  console.log('🔨 Creating custom paymaster client');
  console.log('📝 Paymaster address:', paymasterAddress);
  console.log('🔑 Sponsor wallet address:', sponsorWallet.account?.address);

  // Return the paymaster client object with the required methods
  return {
    /**
     * Returns paymaster data for a user operation
     */
    async sponsorUserOperation({ 
      userOperation
    }: { 
      userOperation: GetPaymasterDataParameters 
    }): Promise<GetPaymasterDataReturnType> {
      console.log('🎯 Paymaster sponsorUserOperation called for sender:', userOperation.sender);
      console.log('📄 User operation details:', {
        sender: userOperation.sender,
        nonce: userOperation.nonce?.toString(),
        callData: userOperation.callData?.slice(0, 10) + '...',
      });

      try {
        // Initialize the paymaster contract
        const paymasterContract = await initContract(
          paymasterAddress,
          paymasterAbi,
          publicClient
        );
        console.log('📋 Paymaster contract initialized');

        // Set validity window for the sponsorship
        const validAfter = 0n;
        const validUntil = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // Valid for 1 hour
        console.log('⏰ Setting sponsorship validity window until:', new Date((Number(validUntil) * 1000)).toISOString());

        // Pack the user operation for hashing
        console.log('📦 Packing user operation for hashing...');
        const packedUserOp = toPackedUserOperation({
          sender: userOperation.sender,
          nonce: userOperation.nonce,
          initCode: userOperation.initCode || "0x" as Hex,
          callData: userOperation.callData,
          callGasLimit: userOperation.callGasLimit || 100000n,
          verificationGasLimit: userOperation.verificationGasLimit || 100000n,
          preVerificationGas: userOperation.preVerificationGas || 100000n,
          maxFeePerGas: userOperation.maxFeePerGas || 0n,
          maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas || 0n,
          paymasterAndData: "0x" as Hex,
          signature: "0x" as Hex
        });
        
        // Get the hash to sign from the paymaster
        console.log('🧮 Getting hash from paymaster contract...');
        const hash = await paymasterContract.read.getHash([
          packedUserOp,
          validUntil,
          validAfter,
        ]) as Hex;
        console.log('📋 Got hash to sign from paymaster:', hash.slice(0, 10) + '...');

        // The sponsor wallet must have an account configured
        if (!sponsorWallet.account) {
          throw new Error("Sponsor wallet account is not available");
        }
        
        // Sign the hash with the sponsor wallet
        console.log('✍️ Signing hash with sponsor wallet...');
        const sponsorSignature = await sponsorWallet.signMessage({
          account: sponsorWallet.account,
          message: { raw: hash },
        });
        console.log('🖋️ Sponsor signed the hash with signature:', sponsorSignature.slice(0, 10) + '...');

        // Create paymaster data
        console.log('🛠️ Creating paymaster data...');
        const paymasterData = paymasterMode(
          "sponsor",
          validUntil,
          validAfter,
          sponsorSignature,
          sponsorWallet
        ) as Hex;
        console.log('📊 Created paymaster data:', paymasterData.slice(0, 10) + '...');

        // Return with proper type casting
        return paymasterData as unknown as GetPaymasterDataReturnType;
      } catch (error) {
        console.error('❌ Error in sponsorUserOperation:', error);
        throw error;
      }
    }
  };
} 