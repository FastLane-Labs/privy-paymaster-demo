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
        {ready && authenticated && (
          <div className="flex justify-end mb-4">
            <button
              onClick={logout}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 shadow-md"
            >
              Logout
            </button>
          </div>
        )}
        
        {!ready ? (
          <div className="text-center p-4 bg-white rounded-lg shadow mb-6">
            <p>Loading Privy...</p>
          </div>
        ) : !authenticated ? (
          <div className="text-center p-4 bg-white rounded-lg shadow mb-6">
            <h2 className="text-xl font-semibold mb-2">Account Access</h2>
            <p className="mb-3">Login to access your account abstraction demo.</p>
            <button
              onClick={login}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Login with Privy
            </button>
          </div>
        ) : null}

        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-indigo-500 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>
        <div className="relative px-4 py-8 bg-white shadow-lg sm:rounded-3xl sm:p-10">
          <div className="mx-auto">
            <div className="divide-y divide-gray-200">
              <div className="py-6 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <h1 className="text-3xl font-bold text-center">Privy + Account Abstraction Demo</h1>
                <p className="text-center">Demonstrating ERC-4337 Account Abstraction with Privy</p>

                {ready && authenticated && (
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
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
