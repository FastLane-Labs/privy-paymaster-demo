import { Client, getContract, encodeFunctionData, type Address, type Hex } from "viem";
import { sponsorWallet } from "./config";

// Function to initialize a contract with public and account clients
export async function initContract(
  address: Address,
  abi: any,
  publicClient: Client,
  accountClient?: Client
) {
  return getContract({
    address: address,
    abi: abi,
    client: {
      public: publicClient,
      wallet: accountClient,
    },
  });
}

// Function to generate paymaster data based on the mode
export function paymasterMode(
  mode: "user" | "sponsor",
  validUntil?: bigint,
  validAfter?: bigint,
  sponsorSignature?: Hex
): Hex {
  if (mode === "user") {
    return "0x00" as Hex;
  } else if (mode === "sponsor") {
    // When sponsorSignature is provided, format the paymaster data with the signature
    if (sponsorSignature) {
      // Get the sponsor address from the wallet account that was used for signing
      const sponsorAddress = "0x" + sponsorSignature.slice(2, 42); // Extract from signature
      
      // Format validUntil and validAfter as hex strings
      const validUntilHex = validUntil ? validUntil.toString(16).padStart(12, "0") : "000000000000";
      const validAfterHex = validAfter ? validAfter.toString(16).padStart(12, "0") : "000000000000";
      
      // Format the complete paymaster data with sponsor signature
      return `0x01${sponsorAddress.slice(2)}${validUntilHex}${validAfterHex}${sponsorSignature.slice(2)}` as Hex;
    }
    
    // For demo purposes in the context where we don't have a full sponsor setup,
    // we'll use a simplified sponsor mode with no validation
    return "0x01" as Hex;
  } else {
    throw new Error(`Unsupported paymaster mode: ${mode}`);
  }
}

// Full implementation of sponsor mode with validation would look like this:
// Note: This is not used in the current demo but left here for reference
export async function generateSponsorPaymasterData(
  accountAddress: Address,
  validUntil: bigint = BigInt(Math.floor(Date.now() / 1000) + 3600), // Valid for 1 hour
  validAfter: bigint = BigInt(Math.floor(Date.now() / 1000) - 60) // Valid from 1 minute ago
): Promise<Hex> {
  if (!sponsorWallet) {
    throw new Error("Sponsor wallet not configured");
  }

  // Create the message to sign (typically the user address and validity window)
  const messageToSign = encodeFunctionData({
    abi: [{
      name: "getSponsorshipInfo",
      type: "function",
      inputs: [
        { name: "account", type: "address" },
        { name: "validUntil", type: "uint48" },
        { name: "validAfter", type: "uint48" }
      ],
      outputs: [{ type: "bytes" }]
    }],
    functionName: "getSponsorshipInfo",
    args: [accountAddress, validUntil, validAfter]
  });

  // Sign the message with the sponsor wallet
  const signature = await sponsorWallet.signMessage({
    message: { raw: messageToSign as Hex }
  });

  // Format the paymaster data
  // The format depends on the specific paymaster implementation
  // This is a simplified example
  return `0x01${accountAddress.slice(2)}${validUntil
    .toString(16)
    .padStart(12, "0")}${validAfter
    .toString(16)
    .padStart(12, "0")}${signature.slice(2)}` as Hex;
} 