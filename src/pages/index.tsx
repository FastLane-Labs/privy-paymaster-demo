import Head from 'next/head';
import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';

// Custom hooks
import { useWalletManager } from '@/hooks/useWalletManager';
import { useTransactions } from '@/hooks/useTransactions';

// Components
import WalletStatus from '@/components/WalletStatus';
import ContractAddresses from '@/components/ContractAddresses';
import TransactionForm from '@/components/TransactionForm';
import BondMonForm from '@/components/BondMonForm';

// Demo types
type DemoType = 'paymaster' | 'self-sponsored' | 'bond-mon' | 'eoa-direct';

export default function Home() {
  const { login, authenticated, ready } = usePrivy();
  const [selectedDemo, setSelectedDemo] = useState<DemoType>('paymaster');

  // Use custom hooks
  const walletManager = useWalletManager();
  const {
    embeddedWallet,
    smartAccount,
    bundler,
    loading,
    setLoading,
    contractAddresses,
    walletBalance,
    smartAccountBalance,
    bondedShmon,
    paymasterDeposit,
    logout,
  } = walletManager;

  const txOperations = useTransactions(walletManager);
  const {
    txStatus,
    txHash,
    sponsoredTxHash,
    sponsoredTxStatus,
    selfSponsoredTxHash,
    selfSponsoredTxStatus,
    sendTransaction,
    sendSponsoredTransaction,
    sendSelfSponsoredTransaction,
    bondMonToShmon,
    setTxStatus,
  } = txOperations;

  // State to store transaction hashes
  const [selfSponsoredTransactionHash, setSelfSponsoredTransactionHash] = useState<
    string | undefined
  >();
  const [sponsoredTransactionHash, setSponsoredTransactionHash] = useState<string | undefined>();
  const [eoaTransactionHash, setEoaTransactionHash] = useState<string | undefined>();

  // Wrapper for self-sponsored transaction to capture transaction hash
  const handleSelfSponsoredTransaction = async (recipient: string, amount: string) => {
    const result = await sendSelfSponsoredTransaction(recipient, amount);
    if (result && 'transactionHash' in result) {
      setSelfSponsoredTransactionHash(result.transactionHash);
    }
  };

  // Wrapper for sponsored transaction to capture transaction hash
  const handleSponsoredTransaction = async (recipient: string, amount: string) => {
    const result = await sendSponsoredTransaction(recipient, amount);
    if (result && typeof result === 'object' && 'transactionHash' in result) {
      setSponsoredTransactionHash(result.transactionHash);
    }
  };

  // Bond MON to shMON handler
  const handleBondMonToShmon = async (amount: string) => {
    try {
      const result = await bondMonToShmon(amount);
      return result; // Return the result directly to the BondMonForm component
    } catch (error) {
      console.error('Error bonding MON to shMON:', error);
      throw error; // Throw the error to be caught by the BondMonForm component
    }
  };

  // Wrapper for EOA transaction to capture transaction hash
  const handleEoaTransaction = async (recipient: string, amount: string) => {
    const transactionHash = await sendTransaction(recipient, amount);
    if (transactionHash) {
      setEoaTransactionHash(transactionHash);
    }
  };

  // Check if wallet data is still initializing
  const isWalletInitializing = ready && authenticated && (loading || !embeddedWallet);

  // Check if smart account and contract data is ready
  const isSmartAccountReady = !!smartAccount && !!contractAddresses.paymaster;

  // Demo options for the dropdown
  const demoOptions = [
    { value: 'paymaster', label: 'Paymaster Sponsored Transaction' },
    { value: 'self-sponsored', label: 'Self Sponsored Transaction', disabled: bondedShmon === '0' },
    { value: 'bond-mon', label: 'Bond MON to shMON' },
    { value: 'eoa-direct', label: 'Direct EOA Transaction', disabled: !embeddedWallet },
  ];

  // Handle demo selection change
  const handleDemoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDemo(e.target.value as DemoType);
  };

  // Rendering helper for loading state
  const renderLoadingIndicator = () => (
    <div className="flex items-center justify-center space-x-2">
      <div className="w-4 h-4 rounded-full bg-blue-500 animate-pulse"></div>
      <div
        className="w-4 h-4 rounded-full bg-blue-500 animate-pulse"
        style={{ animationDelay: '0.2s' }}
      ></div>
      <div
        className="w-4 h-4 rounded-full bg-blue-500 animate-pulse"
        style={{ animationDelay: '0.4s' }}
      ></div>
    </div>
  );

  // Render the selected demo component
  const renderSelectedDemo = () => {
    switch (selectedDemo) {
      case 'paymaster':
        return (
          <div className={!isSmartAccountReady ? 'opacity-75 pointer-events-none' : ''}>
            <TransactionForm
              title="Send Paymaster Sponsored (Transfer)"
              buttonText="Send Transaction"
              onSubmit={handleSponsoredTransaction}
              loading={loading}
              disabled={!isSmartAccountReady}
              disabledReason={
                !isSmartAccountReady ? 'Waiting for smart account to initialize' : undefined
              }
              txHash={sponsoredTxHash}
              txStatus={sponsoredTxStatus}
              description="Transaction fees are covered by the Fastlane paymaster contract"
              isFastlaneSponsored={true}
              transactionHash={sponsoredTransactionHash}
              showUserOpHash={true}
            />
          </div>
        );

      case 'self-sponsored':
        return (
          <div className={!isSmartAccountReady ? 'opacity-75 pointer-events-none' : ''}>
            {bondedShmon !== '0' ? (
              <TransactionForm
                title="Send Self Sponsored (Transfer)"
                buttonText="Send Transaction"
                onSubmit={handleSelfSponsoredTransaction}
                loading={loading}
                disabled={!isSmartAccountReady}
                disabledReason={
                  !isSmartAccountReady ? 'Waiting for smart account to initialize' : undefined
                }
                txHash={selfSponsoredTxHash}
                txStatus={selfSponsoredTxStatus}
                description="Embedded EOA sponsors the smart account"
                transactionHash={selfSponsoredTransactionHash}
                showUserOpHash={true}
              />
            ) : (
              <div className="border p-4 rounded-lg bg-gray-50">
                <h2 className="text-xl font-semibold mb-2">Send Self Sponsored (Transfer)</h2>
                <p className="text-sm text-gray-600 mb-2">
                  Embedded EOA sponsors the smart account
                </p>
                <div className="bg-amber-100 border-l-4 border-amber-500 p-3 mb-4">
                  <p className="text-sm text-amber-700">
                    Bond MON to shMON in the section below to enable self-sponsored transactions
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      case 'bond-mon':
        return (
          <div className={!isSmartAccountReady ? 'opacity-75 pointer-events-none' : ''}>
            <BondMonForm
              bondedShmon={bondedShmon}
              onBond={handleBondMonToShmon}
              loading={loading || !isSmartAccountReady}
            />
          </div>
        );

      case 'eoa-direct':
        return (
          <div className={!embeddedWallet ? 'opacity-75 pointer-events-none' : ''}>
            {embeddedWallet ? (
              <TransactionForm
                title="Send Funds from EOA"
                buttonText="Send from EOA"
                onSubmit={handleEoaTransaction}
                loading={loading}
                disabled={!embeddedWallet}
                disabledReason={
                  !embeddedWallet ? 'Waiting for embedded wallet to initialize' : undefined
                }
                txHash={txHash}
                txStatus={txStatus}
                description="Transfer funds directly from your embedded EOA wallet"
                transactionHash={eoaTransactionHash}
                showUserOpHash={false}
              />
            ) : (
              <div className="border p-4 rounded-lg bg-gray-50">
                <h2 className="text-xl font-semibold mb-2">Send Funds from EOA</h2>
                <p className="text-sm text-gray-600 mb-2">
                  Transfer funds directly from your embedded EOA wallet
                </p>
                <div className="bg-blue-100 border-l-4 border-blue-500 p-3 mb-4">
                  <p className="text-sm text-blue-700">
                    Waiting for embedded wallet to initialize...
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return <div>Select a demo to continue</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <Head>
        <title>Privy Account Abstraction Demo</title>
        <meta name="description" content="Demo for Privy with Account Abstraction" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="relative py-3 sm:max-w-3xl mx-auto w-full px-4">
        {/* Header with title and auth button - always on top */}
        <div className="flex flex-col sm:flex-row justify-between items-center mb-6 relative z-10">
          {!authenticated && (
            <h1 className="text-2xl font-bold text-gray-800 mb-4 sm:mb-0">
              Privy + Account Abstraction Demo
            </h1>
          )}

          {ready ? (
            authenticated ? (
              <div className="ml-auto">
                <button
                  onClick={logout}
                  className="px-5 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg hover:from-red-600 hover:to-red-700 shadow-md transition-all duration-200 flex items-center font-medium"
                  disabled={loading}
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    ></path>
                  </svg>
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={login}
                className="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 shadow-md transition-all duration-200 flex items-center font-medium"
              >
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  ></path>
                </svg>
                Connect Wallet
              </button>
            )
          ) : (
            <button
              disabled
              className="px-5 py-2 bg-gradient-to-r from-blue-300 to-blue-400 text-white rounded-lg shadow-md flex items-center font-medium cursor-not-allowed"
            >
              <svg
                className="w-4 h-4 mr-2 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                ></path>
              </svg>
              Initializing...
            </button>
          )}
        </div>

        {/* Main content - always rendered but with appropriate loading states */}
        {!authenticated && ready ? (
          <div className="text-center p-8 bg-white rounded-xl shadow-xl mb-6 mx-auto border border-gray-100">
            <div className="mb-6">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                ></path>
              </svg>
              <h2 className="text-2xl font-bold mb-2 text-gray-800">Get Started</h2>
              <div className="h-1 w-16 bg-blue-500 mx-auto mb-4 rounded-full"></div>
            </div>

            <p className="mb-6 text-gray-600 leading-relaxed">
              Connect your wallet to access gas-free transactions and explore the power of account
              abstraction.
            </p>

            <p className="mt-4 text-xs text-gray-500">
              Powered by Privy and ERC-4337 Account Abstraction
            </p>
          </div>
        ) : !ready ? (
          <div className="text-center p-8 bg-white rounded-xl shadow-lg mb-6 max-w-md mx-auto">
            <div className="flex justify-center mb-4">
              <svg className="w-12 h-12 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-700">Loading Privy...</p>
            <p className="text-sm text-gray-500 mt-2">
              Please wait while we initialize your wallet
            </p>
          </div>
        ) : (
          <>
            {/* Background gradient - positioned behind content */}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>

            {/* Main content - positioned above background */}
            <div className="relative px-4 py-8 bg-white shadow-lg sm:rounded-3xl sm:p-10 z-10">
              <div className="mx-auto">
                <div className="divide-y divide-gray-200">
                  <div className="py-6 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                    <h1 className="text-3xl font-bold text-center">
                      Privy + Account Abstraction Demo
                    </h1>
                    <p className="text-center">
                      Demonstrating ERC-4337 Account Abstraction with Privy
                    </p>

                    <div className="space-y-6">
                      {/* Wallet Status - always rendered with loading state if needed */}
                      <div
                        className={
                          isWalletInitializing
                            ? 'opacity-75 pointer-events-none relative'
                            : 'relative'
                        }
                      >
                        <WalletStatus
                          embeddedWallet={embeddedWallet}
                          smartAccount={smartAccount}
                          walletBalance={walletBalance}
                          smartAccountBalance={smartAccountBalance}
                          bondedShmon={bondedShmon}
                        />
                        {isWalletInitializing && (
                          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-50 rounded-lg">
                            {renderLoadingIndicator()}
                          </div>
                        )}
                      </div>

                      {/* Contract Addresses - render skeleton if not loaded */}
                      <div
                        className={
                          !isSmartAccountReady
                            ? 'opacity-75 pointer-events-none relative'
                            : 'relative'
                        }
                      >
                        {isSmartAccountReady ? (
                          <ContractAddresses
                            paymaster={contractAddresses.paymaster}
                            shmonad={contractAddresses.shmonad}
                            paymasterDeposit={paymasterDeposit}
                          />
                        ) : (
                          <div className="border rounded-lg p-4 bg-white">
                            <h2 className="text-xl font-semibold mb-2">Contract Addresses</h2>
                            <div className="space-y-2">
                              <div className="h-6 bg-gray-200 rounded animate-pulse"></div>
                              <div className="h-6 bg-gray-200 rounded animate-pulse"></div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Demo Selection Dropdown */}
                      <div className="mb-6">
                        <label
                          htmlFor="demo-select"
                          className="block text-sm font-medium text-gray-700 mb-2"
                        >
                          Select a Demo:
                        </label>
                        <div className="relative">
                          <select
                            id="demo-select"
                            value={selectedDemo}
                            onChange={handleDemoChange}
                            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md appearance-none"
                          >
                            {demoOptions.map(option => (
                              <option
                                key={option.value}
                                value={option.value}
                                disabled={option.disabled}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                            <svg
                              className="h-5 w-5"
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path
                                fillRule="evenodd"
                                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Render only the selected demo */}
                      {renderSelectedDemo()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
