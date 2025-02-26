import { Hex, Address, keccak256, concat, encodeAbiParameters, parseAbiParameters, toHex } from 'viem';

/**
 * Represents a packed UserOperation according to ERC-4337 standard
 */
export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex; // packed callGasLimit and verificationGasLimit
  preVerificationGas: bigint;
  gasFees: Hex; // packed maxFeePerGas and maxPriorityFeePerGas
  paymasterAndData: Hex;
  signature: Hex;
}

/**
 * Unpacked representation with explicit fields for easier manipulation
 */
export interface UserOperationParams {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster: Address;
  paymasterData: Hex;
  signature: Hex;
}

/**
 * Pack callGasLimit and verificationGasLimit into a single bytes32
 */
export function packAccountGasLimits(callGasLimit: bigint, verificationGasLimit: bigint): Hex {
  const packedValue = (BigInt(callGasLimit) << 128n) | BigInt(verificationGasLimit);
  return toHex(packedValue);
}

/**
 * Pack maxFeePerGas and maxPriorityFeePerGas into a single bytes32
 */
export function packGasFees(maxFeePerGas: bigint, maxPriorityFeePerGas: bigint): Hex {
  const packedValue = (BigInt(maxFeePerGas) << 128n) | BigInt(maxPriorityFeePerGas);
  return toHex(packedValue);
}

/**
 * Pack paymaster address and data into paymasterAndData
 */
export function packPaymasterAndData(paymaster: Address, paymasterData: Hex): Hex {
  if (paymaster === '0x0000000000000000000000000000000000000000') {
    return '0x' as Hex;
  }
  
  return concat([paymaster, paymasterData || '0x']) as Hex;
}

/**
 * Calculate the hash of a UserOperation
 */
export function getUserOperationHash(userOp: PackedUserOperation, entryPoint: Address, chainId: bigint): Hex {
  const encoded = encodeAbiParameters(
    parseAbiParameters('address, uint256, bytes32, bytes32, bytes32, uint256, bytes32, bytes32, bytes32'),
    [
      userOp.sender,
      userOp.nonce,
      keccak256(userOp.initCode),
      keccak256(userOp.callData),
      userOp.accountGasLimits,
      userOp.preVerificationGas,
      userOp.gasFees,
      keccak256(userOp.paymasterAndData),
      toHex(chainId)
    ]
  );
  
  const hash = keccak256(encoded);
  
  // The final hash combines the hash with the entryPoint address
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, address'),
      [hash, entryPoint]
    )
  );
}

/**
 * Encode a UserOperation for sending to the bundler
 */
export function encodeUserOperationForBundler(userOp: PackedUserOperation): any {
  return {
    sender: userOp.sender,
    nonce: userOp.nonce.toString(),
    initCode: userOp.initCode,
    callData: userOp.callData,
    accountGasLimits: userOp.accountGasLimits,
    preVerificationGas: userOp.preVerificationGas.toString(),
    gasFees: userOp.gasFees,
    paymasterAndData: userOp.paymasterAndData,
    signature: userOp.signature
  };
}