import { type Address, type Hex } from 'viem';

/**
 * Extending the PrivyWallet interface to ensure TypeScript compatibility
 */
declare module '@privy-io/react-auth' {
  export interface PrivyWallet {
    address: Address;
    walletClientType: string;
    signMessage: (params: { message: { raw: Hex } }) => Promise<Hex>;
    signTypedData: (params: {
      domain: Record<string, any>;
      types: Record<string, any>;
      primaryType: string;
      message: Record<string, any>;
    }) => Promise<Hex>;
    sendTransaction: (params: {
      to: Address;
      value?: string | bigint;
      data?: Hex;
    }) => Promise<Hex>;
  }
} 