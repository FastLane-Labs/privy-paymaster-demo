import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import { PrivyProvider } from '@privy-io/react-auth';
import { MONAD_CHAIN } from '@/utils/config';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''}
      config={{
        loginMethods: ['email', 'wallet'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        appearance: {
          theme: 'light',
          accentColor: '#676FFF',
        },
        supportedChains: [MONAD_CHAIN],
      }}
    >
      <Component {...pageProps} />
    </PrivyProvider>
  );
}
