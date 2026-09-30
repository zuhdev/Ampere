// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IGaslessPaymaster} from "./interfaces/IGaslessPaymaster.sol";
import {IPaymaster, PostOpMode, PackedUserOperation} from "./interfaces/IPaymaster.sol";
import {ISponsorPolicyRegistry} from "./interfaces/ISponsorPolicyRegistry.sol";
import {IBudgetVault} from "./interfaces/IBudgetVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title GaslessPaymaster
 * @notice Pays gas for policy-compliant calls on BOT Chain. Two paths:
 *
 *  1) EOA relay path (mirrors BOT's documented paymaster protocol):
 *     the Ampere relay calls sponsorAndSend(); the paymaster executes the target
 *     call, measures gas, records spend against the policy, and refills itself
 *     from the sponsor's BudgetVault. The target MUST be on the allowlist.
 *
 *  2) ERC-4337 v0.7 path: standard validatePaymasterUserOp/postOp against
 *     EntryPoint 0x0000000071727De22E5E9d8BAf0edAc6f37da032.
 *     paymasterAndData = paymaster(20) ++ validationGasLimit(16) ++ postOpGasLimit(16) ++ appKey(32)
 *
 * SECURITY: the paymaster holds ONLY its own gas float. Sponsor budgets live in
 * BudgetVault; user funds never pass through here. All caps are enforced on-chain
 * by SponsorPolicyRegistry.isSponsorable — not only in the API.
 */
contract GaslessPaymaster is IGaslessPaymaster, IPaymaster, Ownable, ReentrancyGuard, Pausable {
    ISponsorPolicyRegistry public immutable registry;
    IBudgetVault public vault; // set post-deploy (vault constructor needs this paymaster)
    address public immutable entryPoint;

    /// @notice EOA allowed to drive sponsorAndSend (the Ampere relay). Owner-settable.
    address public relayer;

    /// @notice Extra gas margin (post-measurement accounting) added to gasUsed, in gas units.
    ///         Calibrated from debug_traceTransaction (see scripts/gastrace.ts): covers
    ///         recordSpend + vault.debit + emit + tail when the policy is warm.
    uint256 public constant POST_OVERHEAD_GAS = 112_000;
    /// @notice Zero→nonzero storage surcharges inside recordSpend (spendFreshness flags).
    uint256 public constant FRESH_BENEFICIARY_GAS = 38_000;
    uint256 public constant FRESH_APPKEY_GAS = 57_000;
    uint256 public constant DAY_ROLLOVER_GAS = 21_000;
    /// @notice Calldata decode + modifiers (onlyRelayer/whenNotPaused/nonReentrant) before
    ///         the function body starts measuring.
    uint256 public constant ENTRY_OVERHEAD_GAS = 11_000;

    event Sponsored(
        bytes32 indexed appKey,
        address indexed target,
        address indexed beneficiary,
        uint256 gasUsed,
        uint256 gasCost,
        bool success
    );

    event RelayerSet(address indexed oldRelayer, address indexed newRelayer);
    event UserOpSponsored(bytes32 indexed appKey, address indexed sender, uint256 actualGasCost);

    error NotRelayer();
    error NotSponsorable();
    error NotEntryPoint();
    error BadPaymasterAndData();
    error InsufficientVaultBudget();
    error GasBudgetExceeded();
    error EthSendFailed();
    error ZeroAddress();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(
        address _registry,
        address _entryPoint
    ) Ownable(msg.sender) {
        registry = ISponsorPolicyRegistry(_registry);
        entryPoint = _entryPoint;
        relayer = msg.sender;
    }

    // ---------------- admin ----------------

    /// @notice Wire the vault after deploy (vault's constructor needs this paymaster's
    ///         address, so the pairing is completed here). One-shot, owner-only.
    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        if (address(vault) != address(0)) revert ZeroAddress(); // one-shot
        vault = IBudgetVault(_vault);
    }

    function setRelayer(address _relayer) external onlyOwner {
        if (_relayer == address(0)) revert NotRelayer();
        emit RelayerSet(relayer, _relayer);
        relayer = _relayer;
    }

    function pause() external override onlyOwner {
        _pause();
    }

    function unpause() external override onlyOwner {
        _unpause();
    }

    /// @notice Owner withdrawal of the paymaster's OWN float — never user funds.
    function withdraw(address payable to, uint256 amount)
        external
        override
        onlyOwner
        nonReentrant
    {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthSendFailed();
    }

    // ---------------- EOA path ----------------

    /// @notice View gate mirroring BOT's documented paymaster protocol.
    /// @return sponsorable whether the call would be sponsored under appKey's policy
    /// @return policyId    the appKey (policy id) under which it was evaluated
    function gm_sponsorable(
        bytes32 appKey,
        address to,
        address token,
        uint256 value
    ) external view override returns (bool sponsorable, bytes32 policyId) {
        // beneficiary is the caller for direct EOA usage; the relay passes the real
        // beneficiary in sponsorAndSend, where caps are re-checked on-chain.
        bool allowed = registry.isSponsorable(appKey, to, msg.sender, value);
        sponsorable = allowed && vault.budgetOf(appKey) >= value;
        policyId = appKey;
        // `token` is informational in v1 (EOA path forwards value only); kept in the
        // signature for protocol compatibility with BOT's documented paymaster API.
    }

    /// @notice Relay a call, paying gas from the paymaster float and debiting the
    ///         sponsor's vault budget. `amount` is the maximum gas cost (in wei)
    ///         authorized for this call: the measured cost is charged in full, and
    ///         exceeding `amount` reverts (GasBudgetExceeded) — it is never clamped,
    ///         otherwise the caller could under-record spend and bypass policy caps.
    function sponsorAndSend(
        bytes32 appKey,
        address target,
        address beneficiary,
        uint256 amount,
        bytes calldata data
    ) external payable override onlyRelayer whenNotPaused nonReentrant returns (uint256 gasUsed, bool success) {
        // Measured window starts as the first statement: policy gates, the target call
        // and every account touch below are charged to the sponsor.
        uint256 startGas = gasleft();
        if (amount == 0) revert NotSponsorable();

        // ---- policy gate (on-chain, not API-only) ----
        if (!registry.isSponsorable(appKey, target, beneficiary, amount)) {
            revert NotSponsorable();
        }
        if (vault.budgetOf(appKey) < amount) revert InsufficientVaultBudget();

        // Freshness flags decide the post-measurement overhead; queried here so the
        // query itself lands inside the measured window.
        uint256 postOverhead = _postOverhead(appKey, beneficiary);

        uint256 balanceBefore = address(this).balance; // includes msg.value

        // ---- execute ----
        (success, ) = target.call{value: msg.value}(data);

        // Full tx cost = intrinsic (EIP-2028 upper bound: 16 gas/non-zero byte)
        //                + entry overhead + measured window + post-accounting overhead.
        gasUsed = 21_000 +
            16 *
            msg.data.length +
            ENTRY_OVERHEAD_GAS +
            (startGas - gasleft()) +
            postOverhead;
        uint256 gasCost = gasUsed * tx.gasprice;
        if (gasCost > amount) revert GasBudgetExceeded();

        // ---- accounting: state before transfers ----
        registry.recordSpend(appKey, beneficiary, gasCost);
        vault.debit(appKey, gasCost); // refills the paymaster float from sponsor budget

        // ---- refund any surplus (never strand forwarded value) ----
        // msg.value was forwarded to the target, so it left the balance after
        // balanceBefore was sampled; + msg.value corrects for that (a reverting
        // target returns the value, in which case it IS refunded here).
        uint256 leftover = address(this).balance + msg.value - balanceBefore - gasCost;
        if (leftover > 0) {
            (bool ok, ) = payable(msg.sender).call{value: leftover}("");
            if (!ok) revert EthSendFailed();
        }

        emit Sponsored(appKey, target, beneficiary, gasUsed, gasCost, success);
        return (gasUsed, success);
    }

    // ---------------- ERC-4337 v0.7 path ----------------

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 maxCost
    )
        external
        override(IGaslessPaymaster, IPaymaster)
        whenNotPaused
        returns (bytes memory context, uint256 validationData)
    {
        if (msg.sender != entryPoint) revert NotEntryPoint();

        // paymasterAndData tail: last 32 bytes = appKey
        bytes calldata pad = userOp.paymasterAndData;
        if (pad.length < 52) revert BadPaymasterAndData(); // 20 + 16 + 16
        bytes32 appKey = bytes32(pad[pad.length - 32:]);

        // userOp.callData = execute(address target, uint256 value, bytes data)
        address target = _extractExecuteTarget(userOp.callData);

        if (!registry.isSponsorable(appKey, target, userOp.sender, maxCost)) {
            revert NotSponsorable();
        }
        if (vault.budgetOf(appKey) < maxCost) revert InsufficientVaultBudget();
        if (getDeposit() < maxCost) revert InsufficientVaultBudget();

        context = abi.encode(appKey, userOp.sender, maxCost);
        validationData = 0; // valid, no expiration override
    }

    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /*actualUserOpFeePerGas*/
    ) external override(IGaslessPaymaster, IPaymaster) {
        if (msg.sender != entryPoint) revert NotEntryPoint();

        if (mode == PostOpMode.postOpReverted) {
            // Nothing to account — validation already succeeded, spend was charged.
            return;
        }

        (bytes32 appKey, address sender, ) = abi.decode(context, (bytes32, address, uint256));

        // Record real spend against the policy...
        registry.recordSpend(appKey, sender, actualGasCost);
        // ...and refill the EntryPoint deposit from the sponsor's budget.
        vault.debit(appKey, actualGasCost);
        entryPoint.call{value: actualGasCost}(
            abi.encodeWithSignature("depositTo(address)", address(this))
        );

        emit UserOpSponsored(appKey, sender, actualGasCost);
    }

    // ---------------- EntryPoint float ----------------

    function deposit() external payable override {
        (bool ok, ) = entryPoint.call{value: msg.value}(
            abi.encodeWithSignature("depositTo(address)", address(this))
        );
        if (!ok) revert EthSendFailed();
    }

    function getDeposit() public view override returns (uint256) {
        (bool ok, bytes memory ret) = entryPoint.staticcall(
            abi.encodeWithSignature("balanceOf(address)", address(this))
        );
        if (!ok || ret.length != 32) return 0;
        return abi.decode(ret, (uint256));
    }

    function addStake(uint32 unstakeDelaySec) external payable override onlyOwner {
        (bool ok, ) = entryPoint.call{value: msg.value}(
            abi.encodeWithSignature("addStake(uint32)", unstakeDelaySec)
        );
        if (!ok) revert EthSendFailed();
    }

    // ---------------- receive ----------------

    /// @notice Accept ETH (vault debits, refunds, owner top-ups).
    receive() external payable {}

    // ---------------- internal ----------------

    /// @dev Post-measurement overhead (recordSpend + vault.debit + emit + tail),
    ///      sized on the registry's storage freshness — cold-path zero→nonzero
    ///      writes are worth ~20k gas each and would otherwise be undercharged.
    function _postOverhead(bytes32 appKey, address beneficiary) private view returns (uint256 overhead) {
        (bool freshAppKey, bool freshBeneficiary, bool dayRollover) = registry.spendFreshness(appKey, beneficiary);
        overhead = POST_OVERHEAD_GAS +
            (freshBeneficiary ? FRESH_BENEFICIARY_GAS : 0) +
            (freshAppKey ? FRESH_APPKEY_GAS : 0) +
            (dayRollover ? DAY_ROLLOVER_GAS : 0);
    }

    /// @dev Extracts `target` from callData encoded as
    ///      IAccount.execute(address,uint256,bytes). Falls back to the userOp sender
    ///      for non-standard calldata (still policy-gated by allowlist).
    function _extractExecuteTarget(bytes calldata callData) private pure returns (address) {
        // 4-byte selector + 32-byte offset + 32-byte value + 32-byte data offset;
        // target is the first head-slot word: bytes 4..36
        if (callData.length < 36) return address(0);
        return address(uint160(bytes20(callData[16:36])));
    }
}
