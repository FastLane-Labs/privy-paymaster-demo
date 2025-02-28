import { useState } from 'react';
import Head from 'next/head';
import { usePrivy } from '@privy-io/react-auth';

// Custom hooks
import { useWalletManager } from '@/hooks/useWalletManager';
import { useTransactions } from '@/hooks/useTransactions';

// Components
import WalletStatus from '@/components/WalletStatus';
import ContractAddresses from '@/components/ContractAddresses';
import TransactionForm from '@/components/TransactionForm';
import BondMonForm from '@/components/BondMonForm';
import DebugTools from '@/components/DebugTools';

export default function Home() {
  const { login, authenticated, ready } = usePrivy();

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
    txHash,
    txStatus,
    sponsoredTxHash,
    sponsoredTxStatus,
    selfSponsoredTxHash,
    selfSponsoredTxStatus,
    sendTransaction,
    sendSponsoredTransaction,
    sendSelfSponsoredTransaction,
    bondMonToShmon,
    verifyPaymasterConfiguration,
    setTxStatus,
  } = txOperations;

  // Debug functions
  async function debugUserOpSignature() {
    if (!smartAccount) {
      setTxStatus('Cannot debug: Smart account not initialized');
      return;
    }

    try {
      setLoading(true);
      setTxStatus('Debugging UserOperation signature...');

      // Check if embedded wallet is defined
      if (!embeddedWallet) {
        setTxStatus('Cannot debug: Embedded wallet is not initialized');
        setLoading(false);
        return;
      }

      if (!bundler) {
        setTxStatus('Cannot debug: Bundler not initialized');
        setLoading(false);
        return;
      }

      // Create a minimal test UserOperation
      const minTestUserOp = {
        account: smartAccount,
        calls: [
          {
            to: smartAccount.address, // Send to self for testing
            value: BigInt('100000000000000'), // 0.0001 (in wei)
            data: '0x',
          },
        ],
      };

      // Prepare the UserOperation using the bundler
      console.log('Debug - Preparing test UserOperation...');
      const testUserOp = await bundler.prepareUserOperation(minTestUserOp);

      console.log('Original UserOperation:', testUserOp);

      // Check if smartAccount is a Safe account
      const isSafeAccount = 'owners' in smartAccount;
      console.log('Is Safe account:', isSafeAccount);

      try {
        if (isSafeAccount) {
          console.log('Using SafeSmartAccount.signUserOperation for signing');

          // For Safe accounts, use the SafeSmartAccount.signUserOperation method directly
          const signature = await smartAccount.signUserOperation(testUserOp);

          console.log('Successfully signed with Safe account. Signature:', signature);
          setTxStatus(
            'Successfully signed with Safe account! Check console for signature details.'
          );
        } else {
          console.log('Using standard signUserOperation for non-Safe account');
          // Standard signing for non-Safe accounts
          const signature = await smartAccount.signUserOperation(testUserOp);
          console.log('Successfully signed with standard method:', signature);
          setTxStatus('Successfully signed! Check console for signature details.');
        }
      } catch (signError) {
        console.error('Error signing UserOperation:', signError);
        setTxStatus(
          `Signing error: ${signError instanceof Error ? signError.message : String(signError)}`
        );
      }
    } catch (error) {
      console.error('Debug error:', error);
      setTxStatus(`Debug error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function debugUserOpWithPaymaster() {
    if (!smartAccount) {
      setTxStatus('Cannot debug: Smart account not initialized');
      return;
    }

    try {
      setLoading(true);
      setTxStatus('Verifying paymaster configuration...');
      
      // Use our new verification function
      const configStatus = verifyPaymasterConfiguration();
      console.log('Paymaster config check result:', configStatus);
      
      setTxStatus(`Paymaster configuration check completed. Check console logs for details.`);
      
      // If we have a bundler, try a sponsored transaction to test it
      if (smartAccount && bundler && (await configStatus).paymaster) {
        try {
          setTxStatus('Testing sponsored transaction with minimal value...');
          // Send a minimal test transaction to self
          const testResult = await sendSponsoredTransaction(
            smartAccount.address,  // to self 
            '0.0000001'           // tiny amount
          );
          
          if (testResult) {
            setTxStatus(`✅ Sponsored transaction successful! TX: ${testResult}`);
          } else {
            setTxStatus(`❌ Sponsored transaction failed. Check console for details.`);
          }
        } catch (error) {
          console.error('Test transaction error:', error);
          setTxStatus(`❌ Sponsored transaction test error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Paymaster debug error:', error);
      setTxStatus(`Error debugging paymaster: ${error instanceof Error ? error.message : String(error)}`);
      setLoading(false);
    }
  }

  const handleBondMonToShmon = async (amount: string) => {
    const newBondedAmount = await bondMonToShmon(amount);
    if (newBondedAmount) {
      // Update the bonded amount if needed
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <Head>
        <title>Privy + Account Abstraction Demo</title>
        <meta name="description" content="Privy demo with Account Abstraction" />
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
          
          {ready && !loading && (
            authenticated ? (
              <div className="ml-auto">
                <button
                  onClick={logout}
                  className="px-5 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg hover:from-red-600 hover:to-red-700 shadow-md transition-all duration-200 flex items-center font-medium"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                  </svg>
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={login}
                className="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 shadow-md transition-all duration-200 flex items-center font-medium"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                </svg>
                Connect Wallet
              </button>
            )
          )}
        </div>
        
        {/* Loading state */}
        {!ready ? (
          <div className="text-center p-8 bg-white rounded-xl shadow-lg mb-6 max-w-md mx-auto animate-pulse">
            <div className="flex justify-center mb-4">
              <svg className="w-12 h-12 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-700">Loading Privy...</p>
            <p className="text-sm text-gray-500 mt-2">Please wait while we initialize your wallet</p>
          </div>
        ) : !authenticated ? (
          <div className="text-center p-8 bg-white rounded-xl shadow-xl mb-6 mx-auto border border-gray-100">
            <div className="mb-6">
              <svg className="w-16 h-16 mx-auto mb-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
              </svg>
              <h2 className="text-2xl font-bold mb-2 text-gray-800">Get Started</h2>
              <div className="h-1 w-16 bg-blue-500 mx-auto mb-4 rounded-full"></div>
            </div>
            
            <p className="mb-6 text-gray-600 leading-relaxed">
              Connect your wallet to access gas-free transactions and explore the power of account abstraction.
            </p>
            
            <p className="mt-4 text-xs text-gray-500">
              Powered by Privy and ERC-4337 Account Abstraction
            </p>
          </div>
        ) : null}

        {/* Authenticated content */}
        {ready && authenticated && (
          <>
            {/* Background gradient - positioned behind content */}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>
            
            {/* Main content - positioned above background */}
            <div className="relative px-4 py-8 bg-white shadow-lg sm:rounded-3xl sm:p-10 z-10">
              <div className="mx-auto">
                <div className="divide-y divide-gray-200">
                  <div className="py-6 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                    <h1 className="text-3xl font-bold text-center">Privy + Account Abstraction Demo</h1>
                    <p className="text-center">Demonstrating ERC-4337 Account Abstraction with Privy</p>

                    <div className="space-y-6">
                      <WalletStatus
                        embeddedWallet={embeddedWallet}
                        smartAccount={smartAccount}
                        walletBalance={walletBalance}
                        smartAccountBalance={smartAccountBalance}
                        bondedShmon={bondedShmon}
                      />

                      {smartAccount && contractAddresses.paymaster && (
                        <>
                          <ContractAddresses
                            paymaster={contractAddresses.paymaster}
                            shmonad={contractAddresses.shmonad}
                            paymasterDeposit={paymasterDeposit}
                          />

                          <DebugTools
                            onDebugUserOpSignature={debugUserOpSignature}
                            onDebugUserOpWithPaymaster={debugUserOpWithPaymaster}
                            loading={loading}
                            txStatus={txStatus}
                          />

                          <TransactionForm
                            title="Send Paymaster Sponsored (Transfer)"
                            buttonText="Send Transaction"
                            onSubmit={sendSponsoredTransaction}
                            loading={loading}
                            disabled={false}
                            disabledReason={undefined}
                            txHash={sponsoredTxHash}
                            txStatus={sponsoredTxStatus}
                            description="Transaction fees are covered by the Fastlane paymaster contract"
                            isFastlaneSponsored={true}
                          />

                          {bondedShmon !== '0' ? (
                            <TransactionForm
                              title="Send Self Sponsored (Transfer)"
                              buttonText="Send Transaction" 
                              onSubmit={sendSelfSponsoredTransaction}
                              loading={loading}
                              txHash={selfSponsoredTxHash}
                              txStatus={selfSponsoredTxStatus}
                              description="Embedded EOA sponsors the smart account"
                            />
                          ) : (
                            <div className="border p-4 rounded-lg bg-gray-50">
                              <h2 className="text-xl font-semibold mb-2">Send Self Sponsored (Transfer)</h2>
                              <p className="text-sm text-gray-600 mb-2">Embedded EOA sponsors the smart account</p>
                              <div className="bg-amber-100 border-l-4 border-amber-500 p-3 mb-4">
                                <p className="text-sm text-amber-700">
                                  Bond MON to shMON in the section below to enable self-sponsored transactions
                                </p>
                              </div>
                            </div>
                          )}

                          <BondMonForm
                            bondedShmon={bondedShmon}
                            onBond={handleBondMonToShmon}
                            loading={loading}
                            txStatus={txStatus}
                          />
                        </>
                      )}
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
