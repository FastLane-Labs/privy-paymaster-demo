import { type WalletClient, createWalletClient, custom } from 'viem';
import { MONAD_CHAIN } from './config';

/**
 * Creates a Viem wallet client from a Privy embedded wallet
 *
 * This adapter allows using the Privy embedded wallet with Viem functions
 * without needing direct access to the private key
 */
export async function privyWalletToViemWallet(wallet: any): Promise<WalletClient> {
  const provider = await wallet.getEthereumProvider();
  // Create a wallet client with the Privy transport
  return createWalletClient({
    account: wallet.address as `0x${string}`,
    chain: MONAD_CHAIN,
    transport: custom(provider),
  });
}
