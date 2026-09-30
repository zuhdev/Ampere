// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IUniswapV3SwapRouter
 * @notice BDEX V3 SwapRouter. NOTE: exactInputSingle struct has **8 fields, not 6** —
 *         (tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum,
 *         sqrtPriceLimitX96) — there is NO `data` field. Mismatched ABIs fail silently
 *         with 0x.
 */
interface IUniswapV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Quoting is done OFF-CHAIN via eth_call: QuoterV2 returns its value by
    ///         reverting — never call it inside a transaction.
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);

    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
