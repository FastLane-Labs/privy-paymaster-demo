import React, { useState } from 'react';
import { formatEther } from 'viem';

interface BondMonFormProps {
  bondedShmon: string;
  onBond: () => void;
  loading: boolean;
  txStatus: string;
}

export default function BondMonForm({
  bondedShmon,
  onBond,
  loading,
  txStatus
}: BondMonFormProps) {
  const [copied, setCopied] = useState(false);
  const isBonded = bondedShmon !== "0";
  const isError = txStatus.toLowerCase().includes('error') || 
                  txStatus.toLowerCase().includes('failed') ||
                  txStatus.toLowerCase().includes('invalid');
  
  const copyErrorToClipboard = () => {
    if (txStatus) {
      navigator.clipboard.writeText(txStatus);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  // Extract error codes for highlighting
  const errorCodeRegex = /(AA\d+|[-\d]+)/g;
  const highlightedErrorStatus = txStatus ? txStatus.replace(
    errorCodeRegex, 
    '<span class="font-mono bg-red-100 px-1 rounded">$1</span>'
  ) : '';
  
  return (
    <div className="border p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-2">Bond MON to shMON</h2>
      {!isBonded ? (
        <div>
          <p>You need to bond MON to shMON to use self-sponsored transactions.</p>
          <button 
            onClick={onBond} 
            className="mt-2 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            disabled={loading}
          >
            Bond 2 MON to shMON
          </button>
        </div>
      ) : (
        <p>You have {formatEther(BigInt(bondedShmon))} shMON bonded.</p>
      )}
      
      {txStatus && (
        <div className={`mt-2 ${isError ? 'text-red-600' : ''}`}>
          <div className="flex items-center gap-2">
            <p><strong>Status:</strong></p>
            {isError && (
              <button 
                onClick={copyErrorToClipboard}
                className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded"
                title="Copy error details"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
          <p 
            dangerouslySetInnerHTML={{ __html: highlightedErrorStatus }}
            className="break-words mt-1"
          />
          
          {isError && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-800">
                <strong>Troubleshooting:</strong>
              </p>
              <ul className="list-disc pl-5 text-sm text-red-700 mt-1">
                <li>Try refreshing the page and reconnecting your wallet</li>
                <li>Ensure you have sufficient MON tokens in your smart account</li>
                <li>Check if the network is congested</li>
                <li>If issues persist, contact support</li>
              </ul>
              {txStatus.includes('AA24') && (
                <p className="text-xs mt-2 text-gray-600">
                  Error code AA24 indicates a signature validation problem in ERC-4337.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
} 