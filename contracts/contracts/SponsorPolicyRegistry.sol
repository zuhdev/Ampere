// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ISponsorPolicyRegistry} from "./interfaces/ISponsorPolicyRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SponsorPolicyRegistry
 * @notice On-chain storage + enforcement of declarative sponsorship policies.
 *         Caps are enforced HERE, not only in the API (security requirement #2).
 *         Empty allowlist == deny-all (security requirement #4).
 */
contract SponsorPolicyRegistry is ISponsorPolicyRegistry, Ownable, ReentrancyGuard {
    // Rolling 24h window for per-address caps; daily budget resets 00:00 UTC.
    uint256 public constant ROLLING_WINDOW = 24 hours;

    /// @notice Paymaster allowed to call recordSpend. Set once at deploy.
    address public paymaster;

    struct PolicyState {
        address owner;
        SponsorPolicy policy;
        // ---- budget tracking ----
        uint256 dayIndex; // days since epoch for current daily window
        uint256 daySpent; // spent in current daily window
        // ---- per-address rolling 24h spend ----
        mapping(address => uint256) addrSpent;
        mapping(address => uint256) addrWindowStart;
        // ---- recorded spend events for API/usage ----
        SpendRecord[] spends;
    }

    struct SpendRecord {
        address beneficiary;
        uint256 gasCost;
        uint64 timestamp;
    }

    mapping(bytes32 => PolicyState) private _states;
    bytes32[] private _appKeys;

    error ZeroAddress();
    error PolicyNotFound();

    event PaymasterSet(address indexed oldPaymaster, address indexed newPaymaster);

    constructor() Ownable(msg.sender) {}

    // ---------------- admin ----------------

    function setPaymaster(address _paymaster) external onlyOwner {
        if (_paymaster == address(0)) revert ZeroAddress();
        emit PaymasterSet(paymaster, _paymaster);
        paymaster = _paymaster;
    }

    // ---------------- policy management ----------------

    function setPolicy(bytes32 appKey, SponsorPolicy calldata p) external override {
        PolicyState storage s = _states[appKey];

        if (s.owner == address(0)) {
            // create
            s.owner = msg.sender;
            _appKeys.push(appKey);
            emit PolicySet(appKey, msg.sender, p);
        } else {
            // update: only the policy owner may modify
            if (msg.sender != s.owner) revert NotPolicyOwner();
            emit PolicySet(appKey, msg.sender, p);
        }

        s.policy = p;
        // Reset cumulative trackers if policy was (re)created fresh
        // NOTE: trackers survive policy updates deliberately (rolling caps continue).
    }

    function getPolicies(bytes32 appKey) external view override returns (SponsorPolicy memory) {
        return _states[appKey].policy;
    }

    function policyOwner(bytes32 appKey) external view override returns (address) {
        return _states[appKey].owner;
    }

    function appKeys() external view returns (bytes32[] memory) {
        return _appKeys;
    }

    function spendCount(bytes32 appKey) external view returns (uint256) {
        return _states[appKey].spends.length;
    }

    function spends(bytes32 appKey, uint256 offset, uint256 limit)
        external
        view
        returns (SpendRecord[] memory)
    {
        SpendRecord[] storage all = _states[appKey].spends;
        if (offset >= all.length) return new SpendRecord[](0);
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        SpendRecord[] memory out = new SpendRecord[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            out[i - offset] = all[i];
        }
        return out;
    }

    function daySpent(bytes32 appKey) external view returns (uint256) {
        return _currentDaySpend(_states[appKey]);
    }

    function addressSpent(bytes32 appKey, address beneficiary) external view returns (uint256) {
        PolicyState storage s = _states[appKey];
        (uint256 start, uint256 spent) = _currentAddressWindow(s, beneficiary);
        if (start == 0 || block.timestamp - start > ROLLING_WINDOW) return 0;
        return spent;
    }

    // ---------------- spend recording ----------------

    /// @inheritdoc ISponsorPolicyRegistry
    function spendFreshness(bytes32 appKey, address beneficiary)
        external
        view
        override
        returns (bool freshAppKey, bool freshBeneficiary, bool dayRollover)
    {
        PolicyState storage s = _states[appKey];
        uint256 today = block.timestamp / 1 days;
        freshAppKey = s.dayIndex == 0; // first spend ever → zero→nonzero day + array-length writes
        dayRollover = !freshAppKey && s.dayIndex != today; // day reset → daySpent zero→nonzero again
        freshBeneficiary = s.addrWindowStart[beneficiary] == 0; // first window → two zero→nonzero writes
    }

    function recordSpend(bytes32 appKey, address beneficiary, uint256 gasCost)
        external
        override
        nonReentrant
    {
        if (msg.sender != paymaster) revert NotPaymaster();
        if (gasCost == 0) return;

        PolicyState storage s = _states[appKey];
        if (s.owner == address(0)) revert PolicyNotFound();

        // Daily window bookkeeping (00:00 UTC reset)
        uint256 today = block.timestamp / 1 days;
        if (s.dayIndex != today) {
            s.dayIndex = today;
            s.daySpent = 0;
        }
        s.daySpent += gasCost;

        // Rolling 24h window bookkeeping per beneficiary
        // Read RAW storage: start == 0 means first-ever spend → open a fresh window.
        uint256 rawStart = s.addrWindowStart[beneficiary];
        uint256 rawSpent = s.addrSpent[beneficiary];
        if (rawStart == 0 || block.timestamp - rawStart > ROLLING_WINDOW) {
            s.addrWindowStart[beneficiary] = block.timestamp;
            s.addrSpent[beneficiary] = gasCost;
        } else {
            s.addrSpent[beneficiary] = rawSpent + gasCost;
        }

        s.spends.push(SpendRecord({beneficiary: beneficiary, gasCost: gasCost, timestamp: uint64(block.timestamp)}));

        emit SpendRecorded(appKey, beneficiary, gasCost);
    }

    // ---------------- enforcement ----------------

    function isSponsorable(
        bytes32 appKey,
        address target,
        address beneficiary,
        uint256 gasCost
    ) public view override returns (bool) {
        PolicyState storage s = _states[appKey];
        SponsorPolicy storage p = s.policy;

        if (s.owner == address(0)) return false; // deny unknown appKey
        if (p.paused) return false; // pause kills sponsorship instantly
        if (p.expiresAt != 0 && block.timestamp >= p.expiresAt) return false; // expiry
        if (p.allowlist.length == 0) return false; // deny-all when allowlist empty
        if (_contains(p.blocklist, target)) return false;

        // allowlist hit (exact target match only)
        if (!_contains(p.allowlist, target)) return false;

        // per-address rolling 24h cap (start == 0 → fresh window, 0 spent)
        (uint256 start, uint256 spent) = _currentAddressWindow(s, beneficiary);
        if (start != 0 && block.timestamp - start <= ROLLING_WINDOW) {
            if (spent + gasCost > p.perAddressCap) return false;
        }

        // daily budget (00:00 UTC reset)
        uint256 today = block.timestamp / 1 days;
        uint256 daySpend = s.dayIndex == today ? s.daySpent : 0;
        if (daySpend + gasCost > p.dailyBudget) return false;

        return true;
    }

    // ---------------- internal ----------------

    function _contains(address[] storage list, address target) private view returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == target) return true;
        }
        return false;
    }

    function _currentDaySpend(PolicyState storage s) private view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        return s.dayIndex == today ? s.daySpent : 0;
    }

    function _currentAddressWindow(PolicyState storage s, address beneficiary)
        private
        view
        returns (uint256 start, uint256 spent)
    {
        start = s.addrWindowStart[beneficiary];
        spent = s.addrSpent[beneficiary];
        if (block.timestamp - start > ROLLING_WINDOW) {
            return (block.timestamp, 0);
        }
        return (start, spent);
    }
}
