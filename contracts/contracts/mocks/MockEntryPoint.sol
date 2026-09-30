// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IPaymaster, PostOpMode, PackedUserOperation} from "../interfaces/IPaymaster.sol";

/**
 * @title MockEntryPoint
 * @notice Stands in for ERC-4337 EntryPoint v0.7 in unit tests. Implements just
 *         enough surface (depositTo/balanceOf + entrypoint-style dispatch into the
 *         paymaster) to exercise GaslessPaymaster's 4337 path with mocked UserOps.
 */
contract MockEntryPoint {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public stakeOf;

    event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, bool success);

    receive() external payable {}

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function withdrawTo(address payable to, uint256 amount) external {
        address paymaster = msg.sender;
        require(balanceOf[paymaster] >= amount, "insufficient deposit");
        balanceOf[paymaster] -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "eth send failed");
    }

    function addStake(uint32) external payable {
        stakeOf[msg.sender] += msg.value;
    }

    /// @dev Call validatePaymasterUserOp AS the entrypoint (msg.sender == this).
    function callValidate(address paymaster, PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
        external
        returns (bytes memory context, uint256 validationData)
    {
        (context, validationData) = IPaymaster(paymaster).validatePaymasterUserOp(userOp, userOpHash, maxCost);
    }

    /// @dev Call postOp AS the entrypoint (msg.sender == this).
    function callPostOp(
        address paymaster,
        uint8 mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external {
        IPaymaster(paymaster).postOp(PostOpMode(mode), context, actualGasCost, actualUserOpFeePerGas);
    }

    /// @dev Drive a UserOp through the paymaster the way the real EntryPoint does:
    ///      validate → execute on the account → postOp(opSucceeded).
    function handleOps(PackedUserOperation calldata userOp, bytes32 userOpHash) external {
        address paymaster = address(bytes20(userOp.paymasterAndData[:20]));

        (, uint256 validationData) = IPaymaster(paymaster).validatePaymasterUserOp(
            userOp,
            userOpHash,
            0
        );
        require(validationData == 0, "validation failed");

        // "Execute" the callData on the sender account (mock: direct external call).
        (bool ok, ) = userOp.sender.call(userOp.callData);
        emit UserOperationEvent(userOpHash, userOp.sender, ok);

        IPaymaster(paymaster).postOp(PostOpMode.opSucceeded, "", 21000 * 1e9, 1e9);
    }
}
