import { type Address, type Hex, type Client, type WalletClient } from 'viem';
import { 
  type UserOperation,
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
      // Initialize the paymaster contract
      const paymasterContract = await initContract(
        paymasterAddress,
        paymasterAbi,
        publicClient
      );
      
      // Set validity window for the sponsorship
      const validAfter = 0n;
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // Valid for 1 hour
      
      // Pack the user operation for hashing
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
      const hash = await paymasterContract.read.getHash([
        packedUserOp,
        validUntil,
        validAfter,
      ]) as Hex;

      // The sponsor wallet must have an account configured
      if (!sponsorWallet.account) {
        throw new Error("Sponsor wallet account is not available");
      }
      
      // Sign the hash with the sponsor wallet
      const sponsorSignature = await sponsorWallet.signMessage({
        account: sponsorWallet.account,
        message: { raw: hash },
      });

      // Create paymaster data
      const paymasterData = paymasterMode(
        "sponsor",
        validUntil,
        validAfter,
        sponsorSignature,
        sponsorWallet
      ) as Hex;
      
      // Return with proper type casting
      return paymasterData as unknown as GetPaymasterDataReturnType;
    }
  };
} 