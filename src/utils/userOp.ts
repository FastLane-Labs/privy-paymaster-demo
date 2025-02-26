import { Hex, Address, encodeFunctionData, keccak256, concat, encodeAbiParameters, parseAbiParameters, toHex } from 'viem';

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
 * Convert unpacked UserOperationParams to packed PackedUserOperation
 */
export function packUserOperation(params: UserOperationParams): PackedUserOperation {
  return {
    sender: params.sender,
    nonce: params.nonce,
    initCode: params.initCode,
    callData: params.callData,
    accountGasLimits: packAccountGasLimits(params.callGasLimit, params.verificationGasLimit),
    preVerificationGas: params.preVerificationGas,
    gasFees: packGasFees(params.maxFeePerGas, params.maxPriorityFeePerGas),
    paymasterAndData: packPaymasterAndData(params.paymaster, params.paymasterData),
    signature: params.signature
  };
}

/**
 * Unpack a PackedUserOperation to UserOperationParams
 */
export function unpackUserOperation(packedOp: PackedUserOperation): UserOperationParams {
  // Extract callGasLimit and verificationGasLimit
  const accountGasLimits = BigInt(packedOp.accountGasLimits);
  const callGasLimit = accountGasLimits >> 128n;
  const verificationGasLimit = accountGasLimits & ((1n << 128n) - 1n);
  
  // Extract maxFeePerGas and maxPriorityFeePerGas
  const gasFees = BigInt(packedOp.gasFees);
  const maxFeePerGas = gasFees >> 128n;
  const maxPriorityFeePerGas = gasFees & ((1n << 128n) - 1n);
  
  // Extract paymaster and paymasterData
  let paymaster = '0x0000000000000000000000000000000000000000' as Address;
  let paymasterData = '0x' as Hex;
  
  if (packedOp.paymasterAndData !== '0x' && packedOp.paymasterAndData.length >= 42) {
    paymaster = packedOp.paymasterAndData.substring(0, 42) as Address;
    paymasterData = ('0x' + packedOp.paymasterAndData.substring(42)) as Hex;
  }
  
  return {
    sender: packedOp.sender,
    nonce: packedOp.nonce,
    initCode: packedOp.initCode,
    callData: packedOp.callData,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas: packedOp.preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
    paymasterData,
    signature: packedOp.signature
  };
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

/**
 * Helper to create a UserOperation with smart defaults
 */
export async function createUserOperation({
  sender,
  nonce,
  initCode = '0x' as Hex,
  callData,
  callGasLimit,
  verificationGasLimit,
  preVerificationGas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  paymaster = '0x0000000000000000000000000000000000000000' as Address,
  paymasterData = '0x' as Hex,
  signature = '0x' as Hex,
}: Partial<UserOperationParams> & { 
  sender: Address;
  nonce: bigint;
  callData: Hex;
}): Promise<PackedUserOperation> {
  
  const userOpParams: UserOperationParams = {
    sender,
    nonce,
    initCode,
    callData,
    callGasLimit: callGasLimit || 100000n,
    verificationGasLimit: verificationGasLimit || 100000n,
    preVerificationGas: preVerificationGas || 50000n,
    maxFeePerGas: maxFeePerGas || 10000000000n,
    maxPriorityFeePerGas: maxPriorityFeePerGas || 1000000000n,
    paymaster,
    paymasterData,
    signature,
  };
  
  return packUserOperation(userOpParams);
} 