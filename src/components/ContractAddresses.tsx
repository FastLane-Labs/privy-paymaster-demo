import React from 'react';
import { formatEther } from 'viem';
import { type Address } from 'viem';

interface ContractAddressesProps {
  paymaster: Address;
  shmonad: Address;
  paymasterDeposit: string;
}

export default function ContractAddresses({
  paymaster,
  shmonad,
  paymasterDeposit
}: ContractAddressesProps) {
  return (
    <div className="border p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-2">Contract Addresses</h2>
      <p><strong>Paymaster:</strong> <span className="break-all">{paymaster}</span></p>
      <p><strong>shMON:</strong> <span className="break-all">{shmonad}</span></p>
      <p><strong>Paymaster Deposit:</strong> {formatEther(BigInt(paymasterDeposit))} MON</p>
    </div>
  );
} 