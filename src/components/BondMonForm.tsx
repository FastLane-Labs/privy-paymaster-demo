import React, { useState, useEffect } from 'react';
import { formatEther } from 'viem';

interface BondMonFormProps {
  bondedShmon: string;
  onBond: (amount: string) => Promise<any>;
  loading: boolean;
  txStatus?: string;
}

export default function BondMonForm({ bondedShmon, onBond, loading }: BondMonFormProps) {
  const [copied, setCopied] = useState(false);
  const [bondAmount, setBondAmount] = useState('2');
  const [bondTxStatus, setBondTxStatus] = useState('');
  const [bondTxHash, setBondTxHash] = useState('');
  const isBonded = bondedShmon !== '0';

  // Check if the status indicates an error or user rejection
  const isError =
    bondTxStatus.toLowerCase().includes('error') ||
    bondTxStatus.toLowerCase().includes('failed') ||
    bondTxStatus.toLowerCase().includes('invalid');

  // Specifically check for user rejection
  const isUserRejection =
    bondTxStatus.toLowerCase().includes('user rejected') ||
    bondTxStatus.toLowerCase().includes('user denied') ||
    bondTxStatus.toLowerCase().includes('user cancelled');

  const copyErrorToClipboard = () => {
    if (bondTxStatus) {
      navigator.clipboard.writeText(bondTxStatus);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    if (bondTxStatus) {
      const match = bondTxStatus.match(/Transaction hash: ([a-f0-9x]+)/i);
      if (match && match[1]) {
        setBondTxHash(match[1]);
      }
    }
  }, [bondTxStatus]);

  const errorCodeRegex = /(AA\d+|[-\d]+)/g;
  const highlightedErrorStatus = bondTxStatus
    ? bondTxStatus.replace(
        errorCodeRegex,
        '<span class="font-mono bg-red-100 px-1 rounded">$1</span>'
      )
    : '';

  // Helper function to handle transaction errors
  const handleTransactionError = (error: unknown) => {
    console.error('Bond transaction error:', error);

    if (error instanceof Error) {
      const errorMessage = error.message;

      // Check for user rejection patterns in the error message
      if (
        errorMessage.includes('User rejected') ||
        errorMessage.includes('User denied') ||
        errorMessage.includes('User cancelled') ||
        errorMessage.includes('rejected the request')
      ) {
        setBondTxStatus('Transaction cancelled: You rejected the transaction request.');
      } else {
        // For other errors, show the error message
        setBondTxStatus(`Error: ${errorMessage}`);
      }
    } else {
      setBondTxStatus('An unknown error occurred');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBondTxStatus('Preparing to bond MON to shMON...');
    try {
      const result = await onBond(bondAmount);
      if (result && result.transactionHash) {
        setBondTxStatus(`Transaction confirmed! Transaction hash: ${result.transactionHash}`);
      }
    } catch (error) {
      handleTransactionError(error);
    }
  };

  const handleBondMore = async (e: React.MouseEvent) => {
    e.preventDefault();
    setBondTxStatus('Preparing to bond more MON to shMON...');
    try {
      const result = await onBond(bondAmount);
      if (result && result.transactionHash) {
        setBondTxStatus(`Transaction confirmed! Transaction hash: ${result.transactionHash}`);
      }
    } catch (error) {
      handleTransactionError(error);
    }
  };

  return (
    <div className="border p-4 rounded-lg bg-gradient-to-r from-orange-50 to-yellow-50">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Bond MON to shMON</h2>
        {isBonded && (
          <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
            Active
          </div>
        )}
      </div>

      <div className="mb-4">
        <div className="bg-amber-100 border-l-4 border-amber-500 p-3 mb-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-amber-700">
                <strong>Important:</strong> Bonding MON to shMON enables your embedded EOA wallet to
                execute self-sponsored transactions.
              </p>
            </div>
          </div>
        </div>

        {isBonded ? (
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-700">Current Bonded Amount:</span>
              <span className="font-semibold text-lg">
                {formatEther(BigInt(bondedShmon))} shMON
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-600">
              You can now use self-sponsored transactions with your bonded shMON.
            </p>
            <button
              onClick={handleBondMore}
              className="mt-3 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
              disabled={loading}
            >
              Bond More MON
            </button>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-gray-700">
              Bond your MON tokens to shMON to enable self-sponsored transactions for your embedded
              wallet.
            </p>
            <form onSubmit={handleSubmit} className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex flex-col gap-1">
                <label htmlFor="bondAmount" className="text-sm font-medium text-gray-700">
                  Amount of MON to Bond
                </label>
                <div className="flex items-center">
                  <input
                    id="bondAmount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={bondAmount}
                    onChange={e => setBondAmount(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
                    placeholder="Amount in MON"
                    disabled={loading}
                  />
                  <span className="ml-2 text-gray-600">MON</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  The minimum recommended amount is 1 MON
                </p>
              </div>
              <button
                type="submit"
                className="mt-4 w-full px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                disabled={loading}
              >
                Bond MON to shMON
              </button>
            </form>
          </div>
        )}
      </div>

      {bondTxStatus && (
        <div
          className={`mt-4 ${isUserRejection ? 'text-amber-600' : isError ? 'text-red-600' : 'text-green-600'} bg-white p-3 rounded-lg shadow-sm`}
        >
          <div className="flex items-center gap-2 mb-1">
            <p>
              <strong>Status:</strong>
            </p>
            {isError && !isUserRejection && (
              <button
                onClick={copyErrorToClipboard}
                className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded"
                title="Copy error details"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
          <p dangerouslySetInnerHTML={{ __html: highlightedErrorStatus }} className="break-words" />

          {bondTxHash && !isError && (
            <div className="mt-2">
              <p>
                <strong>Transaction hash:</strong>{' '}
                <a
                  href={`https://monad-testnet.socialscan.io/tx/${bondTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-blue-600 hover:underline"
                >
                  {bondTxHash}
                </a>
              </p>
            </div>
          )}

          {isUserRejection && (
            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded">
              <p className="text-sm text-amber-800">
                <strong>Transaction Cancelled</strong>
              </p>
              <p className="text-sm text-amber-700 mt-1">
                You cancelled the transaction. You can try again when you're ready.
              </p>
            </div>
          )}

          {isError && !isUserRejection && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-800">
                <strong>Troubleshooting:</strong>
              </p>
              <ul className="list-disc pl-5 text-sm text-red-700 mt-1">
                <li>Try refreshing the page and reconnecting your wallet</li>
                <li>Ensure you have sufficient MON tokens in your wallet</li>
                <li>Check if the network is congested</li>
                <li>If issues persist, contact support</li>
              </ul>
              {bondTxStatus.includes('AA24') && (
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
