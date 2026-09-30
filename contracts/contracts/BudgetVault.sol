// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IBudgetVault} from "./interfaces/IBudgetVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BudgetVault
 * @notice Holds the sponsors' gas budget ONLY. Never touches user funds.
 *         Sponsor deposits native BOT (or ERC-20) against an appKey; the paymaster
 *         debits that budget when relaying. `withdraw` is owner-only and returns
 *         the sponsor's own money — never pulled from users (security req #1).
 *
 *         Design: keeps paymaster logic minimal and auditable. The vault is the
 *         single custody point; the paymaster is the single spender.
 */
contract BudgetVault is IBudgetVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable override paymaster;
    address public immutable wrappedNative; // WBOT for token->native reconciliation

    // appKey => native BOT budget
    mapping(bytes32 => uint256) private _nativeBudget;
    // appKey => token => token-denominated budget (spend tracked in native units by registry)
    mapping(bytes32 => mapping(address => uint256)) private _tokenBudget;

    error NotPaymaster();
    error ZeroAddress();
    error InsufficientBudget();
    error EthSendFailed();

    constructor(address _paymaster, address _wrappedNative) Ownable(msg.sender) {
        if (_paymaster == address(0)) revert ZeroAddress();
        paymaster = _paymaster;
        wrappedNative = _wrappedNative;
    }

    // ---------------- sponsor deposits ----------------

    /// @notice Deposit native BOT against `appKey`. (No custody of user funds — this
    ///         is the sponsor's own budget, withdrawable at any time.)
    function depositNative(bytes32 appKey) external payable override nonReentrant {
        if (msg.value == 0) revert InsufficientBudget();
        _nativeBudget[appKey] += msg.value;
        emit Deposited(address(0), msg.sender, msg.value);
    }

    /// @notice Deposit ERC-20 (e.g. WBOT or USDT). Caller must approve first.
    function depositToken(bytes32 appKey, address token, uint256 amount)
        external
        override
        nonReentrant
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert InsufficientBudget();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _tokenBudget[appKey][token] += amount;
        emit Deposited(token, msg.sender, amount);
    }

    // ---------------- paymaster debits ----------------

    /// @notice Debit native budget and forward to the paymaster to refill gas spend.
    ///         Paymaster-only (the paymaster pre-funds itself, then reconciles).
    function debit(bytes32 appKey, uint256 amount) external override nonReentrant {
        if (msg.sender != paymaster) revert NotPaymaster();
        if (_nativeBudget[appKey] < amount) revert InsufficientBudget();
        _nativeBudget[appKey] -= amount;

        // state-before-transfer (security req #5)
        (bool ok, ) = payable(paymaster).call{value: amount}("");
        if (!ok) revert EthSendFailed();
        emit BudgetDebited(appKey, amount);
    }

    // ---------------- owner withdrawals ----------------

    /// @notice Owner-only withdrawal of the sponsor's own budget.
    function withdraw(address payable to, uint256 amount) external override onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InsufficientBudget();
        if (amount > address(this).balance) revert InsufficientBudget();
        // State-before-transfer: the caller (owner) bears the responsibility for
        // bookkeeping; the vault never holds user funds, only sponsor budget.
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthSendFailed();
        emit Withdrawn(address(0), to, amount);
    }

    // ---------------- views ----------------

    function budgetOf(bytes32 appKey) external view override returns (uint256) {
        return _nativeBudget[appKey];
    }

    function tokenBudgetOf(bytes32 appKey, address token) external view returns (uint256) {
        return _tokenBudget[appKey][token];
    }

    /// @notice Native balance held by the vault (accounting invariant check).
    function nativeBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Accept ETH from the paymaster when it sweeps surplus back.
    receive() external payable {}
}
