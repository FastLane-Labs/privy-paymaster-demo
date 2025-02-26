import { createPublicClient, http, type Address, type Chain } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";

// Define chain configuration for Monad Testnet
export const MONAD_TESTNET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "10143");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.ankr.com/monad_testnet";
export const SHBUNDLER_URL = process.env.NEXT_PUBLIC_SHBUNDLER_URL || "https://monad-testnet.4337-shbundler-fra.fastlane-labs.xyz";
export const ADDRESS_HUB = process.env.NEXT_PUBLIC_ADDRESS_HUB as Address;
export const ENTRY_POINT_ADDRESS = entryPoint07Address;
export const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_PRIVATE_KEY;

export const MONAD_CHAIN: Chain = {
  id: MONAD_TESTNET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Monad",
    symbol: "MON",
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
};

// Create a public client for read operations
export const publicClient = createPublicClient({
  chain: MONAD_CHAIN,
  transport: http(RPC_URL, {
    fetchOptions: {
      mode: 'cors',
      cache: 'no-cache',
    },
  }),
});