// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IBudgetVault
 * @notice Holds sponsorship budget only. Never touches user funds.
 */
interface IBudgetVault {
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event BudgetDebited(bytes32 indexed appKey, uint256 amount);

    /// @notice Credit `appKey`'s budget with native BOT. `amount` must equal msg.value.
    function depositNative(bytes32 appKey) external payable;

    /// @notice Credit `appKey`'s budget with an ERC-20 (e.g. USDT/WBOT).
    function depositToken(bytes32 appKey, address token, uint256 amount) external;

    /// @notice Owner-only withdrawal of the sponsor's own budget.
    function withdraw(address payable to, uint256 amount) external;

    /// @notice Paymaster-only debit of `appKey`'s budget; transfers to paymaster.
    function debit(bytes32 appKey, uint256 amount) external;

    function budgetOf(bytes32 appKey) external view returns (uint256);

    function paymaster() external view returns (address);
}
