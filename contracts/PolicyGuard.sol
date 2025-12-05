// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title PolicyGuard
 * @author NeoMesh Team
 * @notice Enforces spending limits, whitelists, and risk caps per asset and protocol
 * @dev Security contract for policy-driven risk management
 */
contract PolicyGuard {
    // ============ Custom Errors ============

    error NotOwner();
    error NoActivePolicy();
    error UserBlacklisted();
    error InvalidDailyLimit();
    error InvalidExposureLimit();
    error InvalidRiskScore();
    error ZeroAddress();
    error DailyLimitExceeded();
    error ProtocolNotWhitelisted();
    error RiskScoreTooHigh();

    // ============ State Variables ============

    address public owner;

    mapping(address => UserPolicy) public userPolicies;
    mapping(address => mapping(address => uint256)) public protocolExposure;
    mapping(address => bool) public whitelistedProtocols;
    mapping(address => uint256) public protocolRiskScores;
    mapping(address => bool) public blacklistedUsers;

    // ============ Structs ============

    struct UserPolicy {
        uint256 dailyLimit;
        uint256 dailySpent;
        uint256 lastResetTimestamp;
        uint256 maxProtocolExposure;
        uint256 maxRiskScore;
        bool requireWhitelist;
        bool active;
    }

    // ============ Events ============

    event PolicyCreated(address indexed user, uint256 dailyLimit, uint256 maxExposure);
    event PolicyUpdated(address indexed user, uint256 newDailyLimit);
    event TransferValidated(address indexed user, address indexed protocol, uint256 amount);
    event TransferBlocked(address indexed user, address indexed protocol, bytes32 reason);
    event ProtocolWhitelisted(address indexed protocol, uint256 riskScore);
    event ProtocolRemoved(address indexed protocol);
    event EmergencyPause(address indexed user, string reason);
    event UserBlacklistedEvent(address indexed user, string reason);
    event UserUnblacklisted(address indexed user);

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier hasActivePolicy(address user) {
        if (blacklistedUsers[user]) revert UserBlacklisted();
        if (!userPolicies[user].active) revert NoActivePolicy();
        _;
    }

    modifier notBlacklisted() {
        if (blacklistedUsers[msg.sender]) revert UserBlacklisted();
        _;
    }

    // ============ Constructor ============

    constructor() {
        owner = msg.sender;
    }

    // ============ External Functions ============

    /**
     * @notice Create a new user policy
     * @param dailyLimit Maximum daily transfer limit
     * @param maxProtocolExposure Maximum exposure to single protocol (basis points)
     * @param maxRiskScore Maximum acceptable risk score
     * @param requireWhitelist Whether to require protocol whitelist
     */
    function createPolicy(
        uint256 dailyLimit,
        uint256 maxProtocolExposure,
        uint256 maxRiskScore,
        bool requireWhitelist
    ) external notBlacklisted {
        if (dailyLimit == 0) revert InvalidDailyLimit();
        if (maxProtocolExposure > 10000) revert InvalidExposureLimit();
        if (maxRiskScore < 1 || maxRiskScore > 10) revert InvalidRiskScore();

        userPolicies[msg.sender] = UserPolicy({
            dailyLimit: dailyLimit,
            dailySpent: 0,
            lastResetTimestamp: block.timestamp,
            maxProtocolExposure: maxProtocolExposure,
            maxRiskScore: maxRiskScore,
            requireWhitelist: requireWhitelist,
            active: true
        });

        emit PolicyCreated(msg.sender, dailyLimit, maxProtocolExposure);
    }

    /**
     * @notice Validate a transfer against user policy
     * @param user Address of the user
     * @param protocol Target protocol address
     * @param amount Transfer amount
     * @return valid Whether the transfer is allowed
     */
    function validateTransfer(
        address user,
        address protocol,
        uint256 amount
    ) external hasActivePolicy(user) returns (bool valid) {
        UserPolicy storage policy = userPolicies[user];

        // Reset daily limit if needed
        if (block.timestamp > policy.lastResetTimestamp + 1 days - 1) {
            policy.dailySpent = 0;
            policy.lastResetTimestamp = block.timestamp;
        }

        // Check daily limit
        if (policy.dailySpent + amount > policy.dailyLimit) {
            emit TransferBlocked(user, protocol, "DAILY_LIMIT");
            return false;
        }

        // Check whitelist requirement
        if (policy.requireWhitelist && !whitelistedProtocols[protocol]) {
            emit TransferBlocked(user, protocol, "NOT_WHITELISTED");
            return false;
        }

        // Check protocol risk score
        if (protocolRiskScores[protocol] > policy.maxRiskScore) {
            emit TransferBlocked(user, protocol, "RISK_TOO_HIGH");
            return false;
        }

        // Update daily spent
        policy.dailySpent += amount;
        protocolExposure[user][protocol] += amount;

        emit TransferValidated(user, protocol, amount);
        return true;
    }

    /**
     * @notice Check if exposure limit would be exceeded
     * @param user User address
     * @param protocol Protocol address
     * @param amount Amount to add
     * @param totalPortfolio User's total portfolio value
     * @return allowed Whether the exposure is within limits
     * @return currentExposureBps Current exposure in basis points
     */
    function checkExposureLimit(
        address user,
        address protocol,
        uint256 amount,
        uint256 totalPortfolio
    ) external view hasActivePolicy(user) returns (bool allowed, uint256 currentExposureBps) {
        UserPolicy storage policy = userPolicies[user];

        uint256 newExposure = protocolExposure[user][protocol] + amount;
        currentExposureBps = (newExposure * 10000) / totalPortfolio;

        allowed = currentExposureBps < policy.maxProtocolExposure + 1;
    }

    /**
     * @notice Whitelist a protocol with risk score
     * @param protocol Protocol address
     * @param riskScore Risk score (1-10)
     */
    function whitelistProtocol(address protocol, uint256 riskScore) external onlyOwner {
        if (protocol == address(0)) revert ZeroAddress();
        if (riskScore < 1 || riskScore > 10) revert InvalidRiskScore();

        whitelistedProtocols[protocol] = true;
        protocolRiskScores[protocol] = riskScore;

        emit ProtocolWhitelisted(protocol, riskScore);
    }

    /**
     * @notice Emergency pause for a user (deactivates policy)
     * @param user User address
     * @param reason Reason for pause
     */
    function emergencyPause(address user, string calldata reason) external onlyOwner {
        userPolicies[user].active = false;
        emit EmergencyPause(user, reason);
    }

    /**
     * @notice Blacklist a user permanently (persists across policy recreation)
     * @param user User address
     * @param reason Reason for blacklisting
     */
    function blacklistUser(address user, string calldata reason) external onlyOwner {
        blacklistedUsers[user] = true;
        userPolicies[user].active = false;
        emit UserBlacklistedEvent(user, reason);
    }

    /**
     * @notice Remove user from blacklist
     * @param user User address
     */
    function unblacklistUser(address user) external onlyOwner {
        blacklistedUsers[user] = false;
        emit UserUnblacklisted(user);
    }

    // ============ View Functions ============

    /**
     * @notice Get user policy details
     * @param user User address
     * @return UserPolicy struct
     */
    function getPolicy(address user) external view returns (UserPolicy memory) {
        return userPolicies[user];
    }

    /**
     * @notice Get remaining daily limit for user
     * @param user User address
     * @return Remaining daily limit
     */
    function getRemainingDailyLimit(address user) external view returns (uint256) {
        UserPolicy storage policy = userPolicies[user];

        if (block.timestamp > policy.lastResetTimestamp + 1 days - 1) {
            return policy.dailyLimit;
        }

        if (policy.dailySpent > policy.dailyLimit - 1) {
            return 0;
        }

        return policy.dailyLimit - policy.dailySpent;
    }

    /**
     * @notice Check if protocol is whitelisted
     * @param protocol Protocol address
     * @return Whether protocol is whitelisted
     */
    function isProtocolWhitelisted(address protocol) external view returns (bool) {
        return whitelistedProtocols[protocol];
    }

    /**
     * @notice Get protocol risk score
     * @param protocol Protocol address
     * @return Risk score (1-10)
     */
    function getProtocolRiskScore(address protocol) external view returns (uint256) {
        return protocolRiskScores[protocol];
    }

    /**
     * @notice Check if user is blacklisted
     * @param user User address
     * @return Whether user is blacklisted
     */
    function isUserBlacklisted(address user) external view returns (bool) {
        return blacklistedUsers[user];
    }
}
