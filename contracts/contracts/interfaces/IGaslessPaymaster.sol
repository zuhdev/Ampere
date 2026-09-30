// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {PackedUserOperation, PostOpMode} from "./IPaymaster.sol";

/**
 * @title IGaslessPaymaster
 * @notice EOA relay path + ERC-4337 v0.7 paymaster path for BOT Chain.
 */
interface IGaslessPaymaster {
    // ---------- EOA path (mirrors BOT's documented paymaster protocol) ----------

    /// @notice Would this call be sponsored under `appKey`'s policy?
    function gm_sponsorable(
        bytes32 appKey,
        address to,
        address token,
        uint256 value
    ) external view returns (bool sponsorable, bytes32 policyId);

    /// @notice Relay a call, paying gas from the vault. Target must be on allowlist.
    function sponsorAndSend(
        bytes32 appKey,
        address target,
        address beneficiary,
        uint256 amount,
        bytes calldata data
    ) external payable returns (uint256 gasUsed, bool success);

    // ---------- ERC-4337 (EntryPoint v0.7) ----------

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

    function deposit() external payable;

    function getDeposit() external view returns (uint256);

    function addStake(uint32 unstakeDelaySec) external payable;

    // ---------- Admin ----------

    function pause() external;

    function unpause() external;

    function withdraw(address payable to, uint256 amount) external;
}
