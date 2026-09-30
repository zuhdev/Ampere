// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title MockTarget
 * @notice Target contract for relay tests. Tracks lastCaller/lastValue, can revert
 *         on demand, and carries a receive() so the paymaster can forward value.
 */
contract MockTarget {
    address public lastCaller;
    uint256 public lastValue;
    uint256 public hitCount;
    bool public shouldRevert;

    event Called(address indexed caller, uint256 value, bytes data);

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function doWork(bytes calldata data) external payable returns (bool) {
        if (shouldRevert) revert("target reverted");
        lastCaller = msg.sender;
        lastValue = msg.value;
        hitCount += 1;
        emit Called(msg.sender, msg.value, data);
        return true;
    }

    receive() external payable {}
}
