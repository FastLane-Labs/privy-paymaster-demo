import { type WalletClient, createWalletClient, custom, http, type Account } from 'viem';
import { type PrivyWallet } from '@privy-io/react-auth';
import { MONAD_CHAIN } from './config';

/**
 * Creates a Viem wallet client from a Privy embedded wallet
 * 
 * This adapter allows using the Privy embedded wallet with Viem functions
 * without needing direct access to the private key
 */
export function privyWalletToViemWallet(wallet: any): WalletClient {
  // Create a custom transport that uses Privy's methods
  const privyTransport = custom({
    async request({ method, params }) {
      // Handle the different Ethereum JSON-RPC methods
      switch (method) {
        case 'eth_accounts':
          return [wallet.address];
          
        case 'eth_chainId':
          return `0x${MONAD_CHAIN.id.toString(16)}`;
          
        case 'personal_sign':
          // personal_sign params: [message, address]
          const message = params?.[0] as string;
          
          // Check for getEthereumProvider method
          if (typeof wallet.getEthereumProvider === 'function') {
            const provider = await wallet.getEthereumProvider();
            return provider.request({
              method: 'personal_sign',
              params: [message, wallet.address],
            });
          }
          
          // Use signMessage if available
          if (typeof wallet.signMessage === 'function') {
            return await wallet.signMessage({
              message: { raw: message as `0x${string}` },
            });
          }
          
          throw new Error('Wallet does not support signMessage');
          
        case 'eth_sendTransaction':
          // Forward transaction request to Privy
          const tx = params?.[0] as any;
          
          // Check for getEthereumProvider method
          if (typeof wallet.getEthereumProvider === 'function') {
            const provider = await wallet.getEthereumProvider();
            return provider.request({
              method: 'eth_sendTransaction',
              params: [tx],
            });
          }
          
          // Use sendTransaction if available
          if (typeof wallet.sendTransaction === 'function') {
            return await wallet.sendTransaction({
              to: tx.to,
              value: tx.value,
              data: tx.data,
            });
          }
          
          throw new Error('Wallet does not support sendTransaction');
          
        case 'eth_signTypedData_v4':
          // Handle EIP-712 signing
          const typedData = JSON.parse(params?.[1] as string);
          
          // Check for getEthereumProvider method
          if (typeof wallet.getEthereumProvider === 'function') {
            const provider = await wallet.getEthereumProvider();
            return provider.request({
              method: 'eth_signTypedData_v4',
              params: [wallet.address, params?.[1]],
            });
          }
          
          // Use signTypedData if available
          if (typeof wallet.signTypedData === 'function') {
            return await wallet.signTypedData({
              domain: typedData.domain,
              types: typedData.types,
              primaryType: typedData.primaryType,
              message: typedData.message,
            });
          }
          
          throw new Error('Wallet does not support signTypedData');
          
        default:
          throw new Error(`Method ${method} not supported by Privy wallet adapter`);
      }
    },
  });

  // Create a wallet client with the Privy transport
  return createWalletClient({
    account: wallet.address as `0x${string}`,
    chain: MONAD_CHAIN,
    transport: privyTransport,
  });
}

/**
 * Creates a hybrid wallet client that uses Privy for signing but RPC for read operations
 */
export function createHybridPrivyWallet(privyWallet: PrivyWallet, rpcUrl: string): WalletClient {
  // Create a custom account that uses Privy for signing
  const privyAccount = {
    address: privyWallet.address as `0x${string}`,
    type: 'local' as const,
    async signMessage({ message }: { message: string | { raw: `0x${string}` } }) {
      return privyWallet.signMessage({
        message: typeof message === 'string' 
          ? { raw: message as `0x${string}` } 
          : { raw: message.raw },
      }) as Promise<`0x${string}`>;
    },
    async signTransaction() {
      throw new Error('Direct transaction signing not supported - use sendTransaction instead');
    },
    async signTypedData(typedData: any) {
      // Check if the wallet supports signTypedData
      if (typeof privyWallet.signTypedData !== 'function') {
        console.warn('signTypedData not supported by this Privy wallet. Using signMessage as fallback.');
        // Use signMessage as a fallback (not cryptographically equivalent, but works for demo)
        const message = JSON.stringify(typedData);
        return privyWallet.signMessage({
          message: { raw: `0x${Buffer.from(message).toString('hex')}` as `0x${string}` }
        }) as Promise<`0x${string}`>;
      }
      
      return privyWallet.signTypedData(typedData) as Promise<`0x${string}`>;
    },
    publicKey: '0x' as `0x${string}`, // Required by Account type
    source: 'privyWallet', // Required by Account type
  } as Account;

  // Create a wallet client with the Privy account and HTTP transport
  return createWalletClient({
    account: privyAccount,
    chain: MONAD_CHAIN,
    transport: http(rpcUrl),
  });
} 