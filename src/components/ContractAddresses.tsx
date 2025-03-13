import React from 'react';
import { formatEther } from 'viem';
import { type Address } from 'viem';
import Image from 'next/image';

interface ContractAddressesProps {
  paymaster: Address;
  shmonad: Address;
  paymasterDeposit: string;
}

export default function ContractAddresses({
  paymaster,
  shmonad,
  paymasterDeposit,
}: ContractAddressesProps) {
  return (
    <div className="border p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-2">Contract Addresses</h2>

      <div className="mb-4 p-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border border-gray-200">
        <div className="flex items-center gap-3 mb-2">
          <div className="relative w-[120px] h-[40px]">
            <Image
              src="/images/fastlane-logo.svg"
              alt="Fastlane Logo"
              fill
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <div className="text-sm font-medium text-gray-700">Paymaster Sponsored by Fastlane</div>
        </div>
        <p className="text-xs text-gray-500">
          Transactions are sponsored via Fastlane infrastructure
        </p>
      </div>

      <p>
        <strong>Paymaster:</strong> <span className="break-all">{paymaster}</span>
      </p>
      <p>
        <strong>shMON:</strong> <span className="break-all">{shmonad}</span>
      </p>
      <p>
        <strong>Paymaster Deposit:</strong>{' '}
        {paymasterDeposit ? formatEther(BigInt(paymasterDeposit)) : 'N/A'} MON
      </p>
    </div>
  );
}
