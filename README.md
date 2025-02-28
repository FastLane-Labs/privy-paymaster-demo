# Privy 4337 Account Abstraction Demo

This is a demo application that showcases the integration of Privy's embedded wallet with ERC-4337 Account Abstraction on the Monad blockchain using viem account abstraction and permissionless.js libraries.

## Core Technology Stack

### 1. Privy Embedded Wallet
- Secure and non-custodial wallet embedded directly in the application
- Handles private key management and transaction signing
- Serves as the base signer (owner) for the smart account
- Provides a seamless authentication and wallet creation flow

### 2. Account Abstraction with viem and permissionless.js
- Leverages viem's account abstraction implementation for ERC-4337 compatibility
- Uses permissionless.js for smart account creation and management
- Supports Safe account implementation with advanced features
- Handles UserOperation creation, signing, and submission

### 3. Custom Paymaster Backend
- Implements a custom paymaster backend service for transaction sponsorship
- Uses the paymasterClient pattern for gas fee sponsorship
- Supports both EntryPoint v0.6 and v0.7 formats
- Enables gasless transactions for end users

## Features

- Privy authentication with embedded wallet creation
- ERC-4337 Account Abstraction using Smart Accounts
- Custom UserOperation serialization
- Paymaster integration for gasless transactions
- Transaction sending with status tracking
- Privy to Viem wallet conversion for standard Web3 interactions
- Sponsored transactions with balance display
- Dynamic wallet balance updates

## Prerequisites

- Node.js (v18 or later)
- npm or yarn
- A Privy App ID (sign up at [privy.io](https://privy.io))
- Monad testnet access

## Setup

1. Clone the repository and navigate to the project directory:

```bash
cd privy-demo
```

2. Install dependencies:

```bash
npm install
# or
yarn
```

3. Create a `.env.local` file in the root directory with your configuration:

```
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
SPONSOR_WALLET_PRIVATE_KEY=your-sponsor-wallet-private-key
NEXT_PUBLIC_CHAIN_ID=10143
NEXT_PUBLIC_RPC_URL=https://rpc.monad-testnet.io
NEXT_PUBLIC_SHBUNDLER_URL=https://monad-testnet.4337-shbundler-fra.fastlane-labs.xyz
NEXT_PUBLIC_ADDRESS_HUB=0xC9f0cDE8316AbC5Efc8C3f5A6b571e815C021B51
```

Replace `your-privy-app-id` with your Privy App ID and `your-sponsor-wallet-private-key` with a private key for sponsoring transactions.

4. Start the development server:

```bash
npm run dev
# or
yarn dev
```

5. Open [http://localhost:3000](http://localhost:3000) with your browser to see the demo.

## How It Works

### Integration Flow

1. **Authentication**: Users authenticate with Privy to create or access their embedded wallet
2. **Smart Account Creation**: The embedded wallet is used to create a Safe smart account
3. **UserOperation Creation**: When sending a transaction, a custom UserOperation is created
4. **Paymaster Integration**: The Sponsor EOA (paymaster) adds sponsorship data to the UserOperation and signs it
5. **UserOperation Signing**: After the paymaster has signed, the embedded wallet signs the complete UserOperation
6. **Transaction Submission**: The fully signed UserOperation is sent to the fastlane bundler
7. **Transaction Confirmation**: The receipt is retrieved and status is updated

This sequence is important because:
- The paymaster must commit to sponsoring the transaction before the user signs
- The user's signature needs to cover the complete UserOperation (including paymaster data)
- This ensures proper validation at the bundler and entry point level

### Safe Smart Account Creation

The demo uses permissionless.js to create a Safe smart account, which serves as an account abstraction wallet owned by the Privy embedded wallet:

```typescript
// Create Safe smart account
const safeSmartAccount = await toSafeSmartAccount({
  client: publicClient,
  entryPoint: {
    address: entryPoint07Address as Address,
    version: "0.7",
  },
  owners: [walletClient], // Privy wallet client as the owner
  version: "1.4.1" // Safe account version
});

// Initialize bundler with the smart account and paymaster
const bundler = initBundlerWithPaymaster(
  safeSmartAccount,
  publicClient,
  paymasterClient,
  "0.7" // EntryPoint version
);
```

This approach leverages permissionless.js's `toSafeSmartAccount` function which prepopulates the smart wallet configuration specifically for Safe accounts. Other smart account implementations would require different setup functions.

### Sponsored Transaction Flow

```typescript
// Function to send a sponsored transaction
async function sendSponsoredTransaction(recipient: Address, amount: bigint) {
  try {
    // Get gas price from bundler
    const gasPrice = await bundler.getUserOperationGasPrice();
    console.log('Gas price retrieved:', gasPrice);

    // Prepare the user operation with the smart account
    const userOp = await bundler.prepareUserOperation({
      account: smartAccount,
      calls: [
        {
          to: recipient,
          value: amount,
          data: '0x',
        },
      ],
      maxFeePerGas: gasPrice.standard.maxFeePerGas,
      maxPriorityFeePerGas: gasPrice.standard.maxPriorityFeePerGas,
    });
    
    console.log('User operation prepared:', userOp);

    // Send the user operation - with explicit signing handled internally
    const userOpHash = await bundler.sendUserOperation({
      userOperation: userOp,
      entryPoint: ENTRY_POINT_ADDRESS,
    });
    
    console.log('User operation submitted, hash:', userOpHash);

    // Wait for transaction confirmation
    const receipt = await bundler.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    
    return {
      userOpHash,
      txHash: receipt.receipt.transactionHash,
      success: true
    };
  } catch (error) {
    console.error('Error sending sponsored transaction:', error);
    return {
      error: error.message,
      success: false
    };
  }
}
```

### Self-Sponsored Transaction Flow

The demo also supports self-sponsored transactions, which require users to bond to shMONAD using the Fastlane paymaster policy ID. This approach allows users to pay for their own gas fees using their smart account balance.

Key aspects of the self-sponsored flow:

1. **shMONAD Bonding Requirement**: 
   - Users must bond to shMONAD using the Fastlane paymaster policy ID
   - This bonding relationship is required for the bundler to accept self-sponsored transactions
   - The bond is established through a special transaction to the shMONAD contract
   - The Fastlane paymaster policy ID is a specific identifier that links the user's account to the Fastlane infrastructure
   - Without this bond, self-sponsored transactions will be rejected by the bundler

2. **Embedded EOA for Initial Bond**:
   - The Privy embedded wallet (EOA) is used to sponsor the initial bonding transaction
   - This one-time sponsorship allows the smart account to establish the required bond
   - After bonding, the smart account can pay for its own transactions
   - The embedded EOA signs the bonding transaction, which is then submitted to the network
   - This approach bootstraps the smart account's ability to interact with the Fastlane infrastructure

3. **Custom Paymaster Data Generation**:
   - Self-sponsored transactions use a custom paymaster data generation flow
   - Unlike sponsored transactions, the paymaster backend is not set in the bundler client
   - Instead, the `generateSelfSponsoredPaymasterAndData` function creates the necessary paymaster data
   - This approach allows for more flexibility in how transactions are processed
   - The paymaster data includes the policy ID and other metadata required by the Fastlane bundler

4. **Bond-to-Transaction Flow**:
   - User bonds MON to shMONAD using the embedded EOA to pay for gas
   - The bonding transaction includes the Fastlane policy ID as part of the transaction data
   - Once bonded, the smart account can send self-sponsored transactions
   - The bundler recognizes the bond and processes the transaction using the smart account's balance
   - This creates a seamless user experience where users can pay for their own gas without managing separate wallets

```typescript
// Function to send a self-sponsored transaction
async function sendSelfSponsoredTransaction(recipient: string, amount: string) {
  try {
    // Get gas price from bundler
    const gasPrice = await bundlerWithoutPaymaster.getUserOperationGasPrice();
    
    // Prepare the user operation with the smart account
    const userOperation = await bundlerWithoutPaymaster.prepareUserOperation({
      account: smartAccount,
      calls: [
        {
          to: targetAddress,
          value: amountWei,
          data: '0x' as Hex,
        },
      ],
      maxFeePerGas: gasPrice.standard.maxFeePerGas,
      maxPriorityFeePerGas: gasPrice.standard.maxPriorityFeePerGas,
    });
    
    // Generate self-sponsored paymaster data
    const paymasterAndData = await generateSelfSponsoredPaymasterAndData(
      userOperation,
      smartAccount.address
    );
    
    // Update the user operation with the paymaster data
    userOperation.paymasterAndData = paymasterAndData;
    
    // Sign and send the user operation
    const signature = await smartAccount.signUserOperation(userOperation);
    userOperation.signature = signature;
    
    const hash = await bundlerWithoutPaymaster.sendUserOperation(userOperation);
    
    // Wait for transaction confirmation
    const receipt = await bundlerWithoutPaymaster.waitForUserOperationReceipt({ hash });
    
    return {
      userOpHash: hash,
      transactionHash: receipt.receipt.transactionHash
    };
  } catch (error) {
    console.error('Error sending self-sponsored transaction:', error);
    return null;
  }
}
```

This self-sponsored approach provides users with more flexibility in how they pay for transactions, allowing them to use their own funds rather than relying on a third-party sponsor.

### Custom Paymaster Client Implementation

The demo includes a custom paymaster client that interfaces with the backend paymaster API:

```typescript
// Create a paymaster client for gas sponsorship
const paymasterClient = {
  getPaymasterData: async (userOperation) => {
    try {
      // First get stub data for gas estimation
      const stubResponse = await fetch('/api/paymaster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'pm_getPaymasterStubData',
          params: [userOperation, ENTRY_POINT_ADDRESS, CHAIN_ID]
        })
      });
      
      const stubData = await stubResponse.json();
      if (stubData.error) {
        throw new Error(`Paymaster stub error: ${stubData.error.message}`);
      }
      
      // After gas estimation, get the real paymaster data with signature
      const response = await fetch('/api/paymaster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'pm_getPaymasterData',
          params: [userOperation, ENTRY_POINT_ADDRESS, CHAIN_ID]
        })
      });
      
      const data = await response.json();
      if (data.error) {
        throw new Error(`Paymaster error: ${data.error.message}`);
      }
      
      return data.result;
    } catch (error) {
      console.error('Error getting paymaster data:', error);
      throw error;
    }
  }
};
```

## Architecture

- **Next.js**: Frontend framework
- **Privy**: Authentication and embedded wallet provider
- **Viem**: Ethereum interaction library with account abstraction support
- **Permissionless.js**: Smart account creation and management using the Safe implementation
- **ShBundler**: Custom bundler for UserOperation handling
- **Custom Paymaster**: Backend service for transaction sponsorship

## Credits

This demo builds upon the Fastlane 4337 Infrastructure for the Monad blockchain.
