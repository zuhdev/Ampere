// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IPaymaster
 * @notice Minimal ERC-4337 v0.7 paymaster interface subset used by Ampere.
 * @dev Mirrors the canonical v0.7 interface (EntryPoint 0x0000000071727De22E5E9d8BAf0edAc6f37da032).
 */

enum PostOpMode {
    opSucceeded, // UserOp succeeded
    opReverted, // UserOp reverted; still compensate the bundler
    postOpReverted // postOp itself reverted
}

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

interface IPaymaster {
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}
