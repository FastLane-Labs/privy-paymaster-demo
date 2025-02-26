# Privy 4337 Account Abstraction Demo

This is a minimal demo application that showcases the integration of Privy's embedded wallet with ERC-4337 Account Abstraction on the Monad blockchain. The demo demonstrates custom UserOperation serialization and interaction with a bundler and paymaster.

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

Replace `your-privy-app-id` with your Privy App ID and `your-sponsor-wallet-private-key` with a private key for sponsoring transactions (only needed if you want to use the sponsor wallet feature).

4. Start the development server:

```bash
npm run dev
# or
yarn dev
```

5. Open [http://localhost:3000](http://localhost:3000) with your browser to see the demo.

## Usage

1. Click "Login with Privy" to authenticate
2. The Privy embedded wallet will be created automatically for new users
3. A Smart Account will be created for the embedded wallet
4. You'll see your EOA and Smart Account balances displayed
5. Choose one of the transaction types:
   - **Sponsored Transaction**: Send a transaction with gas fees covered by the paymaster
   - **Account Abstraction**: Send a transaction from your Smart Account
   - **Viem Wallet**: Send a regular transaction from your EOA
6. Follow the transaction status in the UI

## How It Works

1. **Authentication**: Users authenticate with Privy to create or access their embedded wallet
2. **Smart Account Creation**: The embedded wallet is used to create a Smart Account
3. **UserOperation Creation**: When sending a transaction, a custom UserOperation is created
4. **UserOperation Signing**: The embedded wallet signs the UserOperation hash
5. **Transaction Submission**: The signed UserOperation is sent to the bundler
6. **Transaction Confirmation**: The receipt is retrieved and status is updated

## Sponsored Transactions

The demo includes a sponsored transaction feature that uses the paymaster to cover gas fees:

```typescript
// Create the standard user operation
const userOp = await bundler.prepareUserOperation({
  account: smartAccount,
  calls: [
    {
      to: recipient,
      value: parseEther('0.001'),
      data: '0x',
    },
  ],
});

// Add paymaster data for sponsored transaction
const userOpWithPaymaster = {
  ...userOp,
  paymaster: paymasterAddress,
  paymasterData: paymasterMode("sponsor"),
  maxFeePerGas: gasPrice.slow.maxFeePerGas,
  maxPriorityFeePerGas: gasPrice.slow.maxPriorityFeePerGas,
};

// Convert to packed format using viem's utility
const packedUserOp = toPackedUserOperation(userOpWithPaymaster);

// Send the user operation
const userOpHash = await bundler.sendUserOperation({
  userOperation: packedUserOp,
  entryPoint: ENTRY_POINT_ADDRESS,
});
```

## Privy to Viem Wallet Conversion

The demo includes a utility that converts a Privy embedded wallet to a Viem wallet client:

```typescript
// Convert Privy embedded wallet to Viem wallet client
const viemWallet = createHybridPrivyWallet(privyWallet, rpcUrl);

// Use it like a regular Viem wallet
const txHash = await viemWallet.sendTransaction({
  to: recipient,
  value: parseEther('0.001'),
  data: '0x',
});
```

This conversion allows you to use the Privy embedded wallet with any Viem functions that require a wallet client, without needing direct access to the private key.

## UserOperation Serialization

The application supports both custom UserOperation serialization and Viem's built-in `toPackedUserOperation` utility:

```typescript
// Custom serialization
const packedUserOp = packUserOperation(userOpParams);

// Or using Viem's utility
const packedUserOp = toPackedUserOperation(userOpWithPaymaster);
```

Both methods produce a packed UserOperation that follows the ERC-4337 standard:

```solidity
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}
```

## Architecture

- **Next.js**: Frontend framework
- **Privy**: Authentication and embedded wallet provider
- **Viem**: Ethereum interaction library
- **Permissionless**: Account abstraction library
- **Tailwind CSS**: Styling

## Credits

This demo builds upon the Fastlane 4337 Infrastructure for the Monad blockchain.
