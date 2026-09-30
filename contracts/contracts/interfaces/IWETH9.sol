// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IWETH9
 * @notice Minimal WETH-style interface — BOT Chain V3 outputs WBOT (ERC-20) for
 *         native legs; unwrap with withdraw() if native BOT is needed.
 */
interface IWETH9 {
    function deposit() external payable;

    function withdraw(uint256 amount) external;

    function balanceOf(address account) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);
}
