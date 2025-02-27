import React, { useState } from 'react';
import FastlaneSponsor from './FastlaneSponsor';

interface TransactionFormProps {
  title: string;
  buttonText: string;
  onSubmit: (recipient: string, amount: string) => void;
  loading: boolean;
  disabled?: boolean;
  disabledReason?: string;
  txHash?: string;
  txStatus?: string;
  defaultAmount?: string;
  description?: string;
  isFastlaneSponsored?: boolean;
}

export default function TransactionForm({
  title,
  buttonText,
  onSubmit,
  loading,
  disabled = false,
  disabledReason,
  txHash,
  txStatus,
  defaultAmount = '0.001',
  description,
  isFastlaneSponsored = false,
}: TransactionFormProps) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState(defaultAmount);
  const [copied, setCopied] = useState(false);
  const isError =
    txStatus?.toLowerCase().includes('error') ||
    txStatus?.toLowerCase().includes('failed') ||
    txStatus?.toLowerCase().includes('invalid');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(recipient, amount);
  };

  const copyErrorToClipboard = () => {
    if (txStatus) {
      navigator.clipboard.writeText(txStatus);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Extract error codes for highlighting
  const errorCodeRegex = /(AA\d+|[-\d]+)/g;
  const highlightedErrorStatus = txStatus
    ? txStatus.replace(errorCodeRegex, '<span class="font-mono bg-red-100 px-1 rounded">$1</span>')
    : '';

  return (
    <div className="border p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      {description && (
        <p className="text-sm text-gray-600 mb-3">{description}</p>
      )}
      
      {isFastlaneSponsored && (
        <div className="mb-4">
          <FastlaneSponsor size="sm" />
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            placeholder="0x..."
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Amount (MON)</label>
          <input
            type="text"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className={`px-4 py-2 ${isFastlaneSponsored ? 'bg-black' : 'bg-green-500'} text-white rounded hover:${isFastlaneSponsored ? 'bg-gray-800' : 'bg-green-600'} disabled:bg-gray-400 disabled:cursor-not-allowed`}
            disabled={loading || disabled || isError}
            title={disabled ? disabledReason : ''}
          >
            {buttonText}
          </button>

          {isError && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Refresh Page
            </button>
          )}
        </div>

        {disabled && disabledReason && <p className="text-red-500 text-sm">{disabledReason}</p>}

        {txHash && (
          <p>
            <strong>UserOp Hash:</strong> <span className="break-all">{txHash}</span>
          </p>
        )}

        {txStatus && (
          <div className={`mt-2 ${isError ? 'text-red-600' : ''}`}>
            <div className="flex items-center gap-2">
              <p>
                <strong>Status:</strong>
              </p>
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
                  <li>
                    If you see a signature error (AA24), try refreshing the page and connecting your
                    wallet again
                  </li>
                  <li>Make sure you have sufficient MON tokens in your wallet</li>
                  <li>Try a different recipient address or a smaller amount</li>
                  <li>Check that your account has the correct permissions</li>
                </ul>
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
