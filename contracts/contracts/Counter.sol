// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title Counter
 * @notice Demo target for the gasless playground: increments a counter, emits an
 *         event, accepts value. Used by e2e.ts / frontend playground.
 */
contract Counter {
    uint256 public count;
    address public lastCaller;

    event Incremented(address indexed caller, uint256 newCount);

    function increment() external payable returns (uint256) {
        count += 1;
        lastCaller = msg.sender;
        emit Incremented(msg.sender, count);
        return count;
    }

    receive() external payable {}
}
