// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IUniswapV3Quoter
 * @notice QuoterV2 returns its quote by REVERTING with the answer encoded — callable
 *         off-chain via eth_call only. Never call inside a transaction.
 */
interface IUniswapV3Quoter {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    /// @dev Returns (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
    ///      via a revert with selector 0x36a12f96 (QuoteExactInputSingle).
    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut);
}
