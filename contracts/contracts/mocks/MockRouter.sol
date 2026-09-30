// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title MockRouter
 * @notice Minimal UniswapV2-style router mock: quotes a fixed price and swaps
 *         from its own pre-funded balance. Lets tests exercise the full relay
 *         path (allowlisted router + token transfers) without a real DEX.
 */
contract MockRouter {
    // price: amountOut = amountIn * numerator / denominator (in token decimals)
    uint256 public numerator;
    uint256 public denominator;

    constructor(uint256 _numerator, uint256 _denominator) {
        numerator = _numerator;
        denominator = _denominator;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = (amounts[i - 1] * numerator) / denominator;
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = (amountIn * numerator) / denominator;
        require(amounts[path.length - 1] >= amountOutMin, "slippage");

        // Router must hold the output token; caller must have funded it beforehand.
        MockToken(path[path.length - 1]).transfer(to, amounts[path.length - 1]);
    }

    receive() external payable {}
}

/// Minimal token shim so the router can push output tokens without importing ERC20.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    string public name = "Mock";
    string public symbol = "MKT";
    uint8 public decimals = 18;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }
}
