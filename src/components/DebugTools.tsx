import React, { useState } from 'react';

interface DebugToolsProps {
  onDebugUserOpSignature: () => void;
  onDebugUserOpWithPaymaster: () => void;
  loading: boolean;
  txStatus: string;
}

export default function DebugTools({
  onDebugUserOpSignature,
  onDebugUserOpWithPaymaster,
  loading,
  txStatus
}: DebugToolsProps) {
  const [copied, setCopied] = useState(false);
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
  
  // Check if there are specific error codes
  const hasAA24Error = txStatus.includes('AA24') || txStatus.includes('signature');
                 
  return (
    <div className="border p-4 rounded-lg">
      <h2 className="text-xl font-semibold mb-2">Debug Tools</h2>
      <div className="flex flex-wrap gap-2">
        <button 
          onClick={onDebugUserOpSignature} 
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
          disabled={loading}
        >
          Debug UserOp Signature
        </button>
        <button 
          onClick={onDebugUserOpWithPaymaster} 
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
          disabled={loading}
        >
          Debug Paymaster
        </button>
        
        {isError && (
          <button 
            onClick={() => window.location.reload()} 
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Refresh Page
          </button>
        )}
      </div>
      
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
          
          {isError && hasAA24Error && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-800">
                <strong>Signature Error Troubleshooting (AA24):</strong>
              </p>
              <ul className="list-disc pl-5 text-sm text-red-700 mt-1">
                <li>Refresh the page and reconnect your wallet</li>
                <li>Check your wallet's connection status</li>
                <li>Ensure you're using the correct account</li>
                <li>Try restarting your browser</li>
                <li>Check console logs for detailed error information</li>
              </ul>
              <p className="text-xs mt-2 text-gray-600">
                Error code AA24 indicates a signature validation problem in ERC-4337.
                This usually means the signature was incorrectly generated or the account contract rejected it.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 