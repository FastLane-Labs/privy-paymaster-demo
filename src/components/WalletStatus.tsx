import React from 'react';
import { formatEther } from 'viem';

interface WalletStatusProps {
  embeddedWallet: any;
  smartAccount: any;
  walletBalance: string;
  smartAccountBalance: string;
  bondedShmon: string;
}

export default function WalletStatus({
  embeddedWallet,
  smartAccount,
  walletBalance,
  smartAccountBalance,
  bondedShmon,
}: WalletStatusProps) {
  return (
    <div className="border p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-2">Wallet Status</h2>
      {!embeddedWallet ? (
        <div>
          <p>
            No embedded wallet found. Please wait for Privy to create one automatically or refresh
            the page.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p>
            <strong>EOA Address:</strong>{' '}
            <span className="break-all">{embeddedWallet.address}</span>
          </p>
          <p>
            <strong>EOA Balance:</strong> {formatEther(BigInt(walletBalance))} MON
          </p>
          {smartAccount && (
            <>
              <p>
                <strong>Smart Account:</strong>{' '}
                <span className="break-all">{smartAccount.address}</span>
              </p>
              <p>
                <strong>Smart Account Balance:</strong> {formatEther(BigInt(smartAccountBalance))}{' '}
                MON
              </p>
              {bondedShmon && (
                <p>
                  <strong>Bonded shMON:</strong> {formatEther(BigInt(bondedShmon))} shMON
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
