import { Client, getContract, encodeFunctionData, type Address, type Hex } from 'viem';

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
  mode: 'user' | 'sponsor',
  validUntil?: bigint,
  validAfter?: bigint,
  sponsorSignature?: Hex,
  userClient?: Client
) {
  if (mode === 'user') {
    return '0x00' as Hex;
  } else {
    if (userClient === undefined) {
      throw new Error('userClient is undefined');
    }
    if (validUntil === undefined) {
      throw new Error('validUntil is undefined');
    }
    if (validAfter === undefined) {
      throw new Error('validAfter is undefined');
    }
    if (sponsorSignature === undefined) {
      throw new Error('sponsorSignature is undefined');
    }

    const accountAddress = userClient?.account?.address;
    if (!accountAddress) {
      throw new Error('userClient.account is undefined');
    }
    return `0x01${accountAddress.slice(2)}${validUntil.toString(16).padStart(12, '0')}${validAfter
      .toString(16)
      .padStart(12, '0')}${sponsorSignature.slice(2)}`;
  }
}
