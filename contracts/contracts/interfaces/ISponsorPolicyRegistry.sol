// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title ISponsorPolicyRegistry
 * @notice Declarative sponsorship policy storage + on-chain enforcement gates.
 */
interface ISponsorPolicyRegistry {
    struct SponsorPolicy {
        address[] allowlist; // target contracts only; empty = deny-all
        address[] blocklist;
        uint256 perAddressCap; // BOT per beneficiary per rolling 24h
        uint256 dailyBudget; // BOT, resets 00:00 UTC
        uint256 expiresAt; // unix seconds; 0 = never expires
        bool paused;
    }

    event PolicySet(bytes32 indexed appKey, address indexed owner, SponsorPolicy policy);
    event SpendRecorded(bytes32 indexed appKey, address indexed beneficiary, uint256 gasCost);

    error NotPolicyOwner();
    error NotPaymaster();
    error PolicyPaused();
    error PolicyExpired();

    function setPolicy(bytes32 appKey, SponsorPolicy calldata p) external;

    function getPolicies(bytes32 appKey) external view returns (SponsorPolicy memory);

    function policyOwner(bytes32 appKey) external view returns (address);

    /// @notice Record gas spend against a policy. Paymaster only.
    function recordSpend(bytes32 appKey, address beneficiary, uint256 gasCost) external;

    function isSponsorable(
        bytes32 appKey,
        address target,
        address beneficiary,
        uint256 gasCost
    ) external view returns (bool);

    /// @notice Storage-freshness flags for gas-estimate sizing. Zero→nonzero writes in
    ///         recordSpend cost ~20k gas each, so the paymaster sizes its charge on these
    ///         instead of a flat worst-case constant.
    /// @param freshAppKey      no spend ever recorded for appKey (dayIndex still zero)
    /// @param freshBeneficiary beneficiary has never opened a rolling window
    /// @param dayRollover      previous daily window exists but is not today
    function spendFreshness(bytes32 appKey, address beneficiary)
        external
        view
        returns (bool freshAppKey, bool freshBeneficiary, bool dayRollover);
}
