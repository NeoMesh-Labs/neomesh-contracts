// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title PolicyGuard
 * @author NeoMesh Team
 * @notice Enforces spending limits, whitelists, and risk caps per asset and protocol
 * @dev Security contract for policy-driven risk management
 * @custom:security-contact security@neomesh.io
 * @custom:version 1.0.0
 */
contract PolicyGuard {
    // ============ Constants ============

    uint256 public constant MAX_BPS = 10000; // 100% in basis points
    uint256 public constant MAX_RISK_SCORE = 10;
    uint256 public constant MIN_RISK_SCORE = 1;
    string public constant VERSION = "1.0.0";

    // ============ Custom Errors ============

    error NotOwner();
    error NotAuthorized();
    error NoActivePolicy();
    error UserBlacklisted();
    error InvalidDailyLimit();
    error InvalidExposureLimit();
    error InvalidRiskScore();
    error ZeroAddress();
    error DailyLimitExceeded();
    error ProtocolNotWhitelisted();
    error RiskScoreTooHigh();
    error PolicyAlreadyExists();
    error InvalidAmount();
    error ExposureUnderflow();

    // ============ State Variables ============

    address public owner;
    bool public paused;

    mapping(address => UserPolicy) public userPolicies;
    mapping(address => mapping(address => uint256)) public protocolExposure;
    mapping(address => bool) public whitelistedProtocols;
    mapping(address => uint256) public protocolRiskScores;
    mapping(address => bool) public blacklistedUsers;
    mapping(address => bool) public authorizedCallers; // StrategyRouter, adapters

    // ============ Structs ============

    struct UserPolicy {
        uint256 dailyLimit;
        uint256 dailySpent;
        uint256 lastResetTimestamp;
        uint256 maxProtocolExposure; // in basis points (e.g., 2000 = 20%)
        uint256 maxRiskScore;
        bool requireWhitelist;
        bool active;
    }

    // ============ Events ============

    event PolicyCreated(
        address indexed user,
        uint256 dailyLimit,
        uint256 maxExposure,
        uint256 maxRiskScore
    );
    event PolicyUpdated(
        address indexed user,
        uint256 newDailyLimit,
        uint256 newMaxExposure,
        uint256 newMaxRiskScore
    );
    event TransferValidated(
        address indexed user,
        address indexed protocol,
        uint256 amount
    );
    event TransferBlocked(
        address indexed user,
        address indexed protocol,
        bytes32 reason
    );
    event ProtocolWhitelisted(address indexed protocol, uint256 riskScore);
    event ProtocolRemoved(address indexed protocol);
    event ProtocolRiskUpdated(address indexed protocol, uint256 oldScore, uint256 newScore);
    event EmergencyPause(address indexed user, string reason);
    event UserBlacklistedEvent(address indexed user, string reason);
    event UserUnblacklisted(address indexed user);
    event CallerAuthorized(address indexed caller);
    event CallerRevoked(address indexed caller);
    event ExposureDecreased(address indexed user, address indexed protocol, uint256 amount);
    event ExposureReset(address indexed user, address indexed protocol);
    event PolicyGuardPaused(string reason);
    event PolicyGuardUnpaused();
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner) revert NotAuthorized();
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

    modifier whenNotPaused() {
        if (paused) revert UserBlacklisted(); // Reusing error for simplicity
        _;
    }

    // ============ Constructor ============

    constructor() {
        owner = msg.sender;
    }

    // ============ External Functions ============

    /**
     * @notice Create a new user policy
     * @param dailyLimit Maximum daily transfer limit in wei
     * @param maxProtocolExposure Maximum exposure to single protocol (basis points, e.g., 2000 = 20%)
     * @param maxRiskScore Maximum acceptable risk score (1-10)
     * @param requireWhitelist Whether to require protocol whitelist
     */
    function createPolicy(
        uint256 dailyLimit,
        uint256 maxProtocolExposure,
        uint256 maxRiskScore,
        bool requireWhitelist
    ) external notBlacklisted whenNotPaused {
        if (userPolicies[msg.sender].active) revert PolicyAlreadyExists();
        if (dailyLimit == 0) revert InvalidDailyLimit();
        if (maxProtocolExposure > MAX_BPS) revert InvalidExposureLimit();
        if (maxRiskScore < MIN_RISK_SCORE || maxRiskScore > MAX_RISK_SCORE) {
            revert InvalidRiskScore();
        }

        userPolicies[msg.sender] = UserPolicy({
            dailyLimit: dailyLimit,
            dailySpent: 0,
            lastResetTimestamp: block.timestamp,
            maxProtocolExposure: maxProtocolExposure,
            maxRiskScore: maxRiskScore,
            requireWhitelist: requireWhitelist,
            active: true
        });

        emit PolicyCreated(msg.sender, dailyLimit, maxProtocolExposure, maxRiskScore);
    }

    /**
     * @notice Update an existing user policy
     * @param dailyLimit New maximum daily transfer limit
     * @param maxProtocolExposure New maximum exposure to single protocol (basis points)
     * @param maxRiskScore New maximum acceptable risk score
     * @param requireWhitelist New whitelist requirement
     */
    function updatePolicy(
        uint256 dailyLimit,
        uint256 maxProtocolExposure,
        uint256 maxRiskScore,
        bool requireWhitelist
    ) external hasActivePolicy(msg.sender) whenNotPaused {
        if (dailyLimit == 0) revert InvalidDailyLimit();
        if (maxProtocolExposure > MAX_BPS) revert InvalidExposureLimit();
        if (maxRiskScore < MIN_RISK_SCORE || maxRiskScore > MAX_RISK_SCORE) {
            revert InvalidRiskScore();
        }

        UserPolicy storage policy = userPolicies[msg.sender];
        policy.dailyLimit = dailyLimit;
        policy.maxProtocolExposure = maxProtocolExposure;
        policy.maxRiskScore = maxRiskScore;
        policy.requireWhitelist = requireWhitelist;

        emit PolicyUpdated(msg.sender, dailyLimit, maxProtocolExposure, maxRiskScore);
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
    ) external hasActivePolicy(user) whenNotPaused returns (bool valid) {
        if (amount == 0) revert InvalidAmount();
        
        UserPolicy storage policy = userPolicies[user];

        // Reset daily limit if 24 hours have passed (FIXED: removed -1)
        if (block.timestamp >= policy.lastResetTimestamp + 1 days) {
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

        // Update daily spent and protocol exposure
        policy.dailySpent += amount;
        protocolExposure[user][protocol] += amount;

        emit TransferValidated(user, protocol, amount);
        return true;
    }

    /**
     * @notice Decrease protocol exposure when user withdraws
     * @dev Only callable by authorized contracts (StrategyRouter, adapters)
     * @param user User address
     * @param protocol Protocol address
     * @param amount Amount to decrease
     */
    function decreaseExposure(
        address user,
        address protocol,
        uint256 amount
    ) external onlyAuthorized {
        if (amount == 0) return;

        uint256 currentExposure = protocolExposure[user][protocol];
        
        if (currentExposure >= amount) {
            protocolExposure[user][protocol] -= amount;
        } else {
            // If amount exceeds current exposure, set to zero
            protocolExposure[user][protocol] = 0;
        }

        emit ExposureDecreased(user, protocol, amount);
    }

    /**
     * @notice Reset protocol exposure for a user
     * @dev Emergency function - use with caution
     * @param user User address
     * @param protocol Protocol address
     */
    function resetExposure(address user, address protocol) external onlyOwner {
        protocolExposure[user][protocol] = 0;
        emit ExposureReset(user, protocol);
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
        if (totalPortfolio == 0) return (false, 0);

        UserPolicy storage policy = userPolicies[user];
        uint256 newExposure = protocolExposure[user][protocol] + amount;
        currentExposureBps = (newExposure * MAX_BPS) / totalPortfolio;

        allowed = currentExposureBps <= policy.maxProtocolExposure;
    }

    /**
     * @notice Whitelist a protocol with risk score
     * @param protocol Protocol address
     * @param riskScore Risk score (1-10)
     */
    function whitelistProtocol(address protocol, uint256 riskScore) external onlyOwner {
        if (protocol == address(0)) revert ZeroAddress();
        if (riskScore < MIN_RISK_SCORE || riskScore > MAX_RISK_SCORE) {
            revert InvalidRiskScore();
        }

        whitelistedProtocols[protocol] = true;
        protocolRiskScores[protocol] = riskScore;

        emit ProtocolWhitelisted(protocol, riskScore);
    }

    /**
     * @notice Remove protocol from whitelist
     * @param protocol Protocol address
     */
    function removeProtocol(address protocol) external onlyOwner {
        whitelistedProtocols[protocol] = false;
        emit ProtocolRemoved(protocol);
    }

    /**
     * @notice Update protocol risk score
     * @param protocol Protocol address
     * @param newRiskScore New risk score (1-10)
     */
    function updateProtocolRiskScore(address protocol, uint256 newRiskScore) external onlyOwner {
        if (newRiskScore < MIN_RISK_SCORE || newRiskScore > MAX_RISK_SCORE) {
            revert InvalidRiskScore();
        }

        uint256 oldScore = protocolRiskScores[protocol];
        protocolRiskScores[protocol] = newRiskScore;

        emit ProtocolRiskUpdated(protocol, oldScore, newRiskScore);
    }

    /**
     * @notice Authorize a contract to call decreaseExposure
     * @dev Typically StrategyRouter and adapter contracts
     * @param caller Address to authorize
     */
    function authorizeCaller(address caller) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = true;
        emit CallerAuthorized(caller);
    }

    /**
     * @notice Revoke authorization from a contract
     * @param caller Address to revoke
     */
    function revokeCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
        emit CallerRevoked(caller);
    }

    /**
     * @notice Emergency pause for a specific user (deactivates policy)
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
        if (user == address(0)) revert ZeroAddress();
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

    /**
     * @notice Pause all PolicyGuard operations
     * @param reason Reason for pausing
     */
    function pause(string calldata reason) external onlyOwner {
        paused = true;
        emit PolicyGuardPaused(reason);
    }

    /**
     * @notice Unpause PolicyGuard operations
     */
    function unpause() external onlyOwner {
        paused = false;
        emit PolicyGuardUnpaused();
    }

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
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
     * @return Remaining daily limit in wei
     */
    function getRemainingDailyLimit(address user) external view returns (uint256) {
        UserPolicy storage policy = userPolicies[user];

        // Check if reset is due (FIXED: removed -1)
        if (block.timestamp >= policy.lastResetTimestamp + 1 days) {
            return policy.dailyLimit;
        }

        // Check if already exceeded
        if (policy.dailySpent >= policy.dailyLimit) {
            return 0;
        }

        return policy.dailyLimit - policy.dailySpent;
    }

    /**
     * @notice Get user's exposure to a specific protocol
     * @param user User address
     * @param protocol Protocol address
     * @return Exposure amount in wei
     */
    function getProtocolExposure(address user, address protocol) 
        external 
        view 
        returns (uint256) 
    {
        return protocolExposure[user][protocol];
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
     * @return Risk score (1-10), 0 if not set
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

    /**
     * @notice Check if caller is authorized
     * @param caller Address to check
     * @return Whether caller is authorized
     */
    function isCallerAuthorized(address caller) external view returns (bool) {
        return authorizedCallers[caller];
    }

    /**
     * @notice Check if user has an active policy
     * @param user User address
     * @return Whether user has an active policy
     */
    function hasPolicy(address user) external view returns (bool) {
        return userPolicies[user].active && !blacklistedUsers[user];
    }

    /**
     * @notice Get time until daily limit reset
     * @param user User address
     * @return Seconds until reset, 0 if already due
     */
    function getTimeUntilReset(address user) external view returns (uint256) {
        UserPolicy storage policy = userPolicies[user];
        uint256 resetTime = policy.lastResetTimestamp + 1 days;
        
        if (block.timestamp >= resetTime) {
            return 0;
        }
        
        return resetTime - block.timestamp;
    }

    /**
     * @notice Simulate transfer validation without state changes
     * @param user User address
     * @param protocol Protocol address
     * @param amount Amount to transfer
     * @return canTransfer Whether transfer would be allowed
     * @return reason Reason if transfer would fail (empty if canTransfer is true)
     */
    function canTransfer(
        address user,
        address protocol,
        uint256 amount
    ) external view returns (bool canTransfer, string memory reason) {
        // Check if paused
        if (paused) {
            return (false, "PolicyGuard is paused");
        }

        // Check if user is blacklisted
        if (blacklistedUsers[user]) {
            return (false, "User is blacklisted");
        }

        // Check if policy is active
        if (!userPolicies[user].active) {
            return (false, "No active policy");
        }

        UserPolicy storage policy = userPolicies[user];
        uint256 dailySpent = policy.dailySpent;

        // Check if reset is due
        if (block.timestamp >= policy.lastResetTimestamp + 1 days) {
            dailySpent = 0;
        }

        // Check daily limit
        if (dailySpent + amount > policy.dailyLimit) {
            return (false, "Daily limit exceeded");
        }

        // Check whitelist requirement
        if (policy.requireWhitelist && !whitelistedProtocols[protocol]) {
            return (false, "Protocol not whitelisted");
        }

        // Check protocol risk score
        if (protocolRiskScores[protocol] > policy.maxRiskScore) {
            return (false, "Risk score too high");
        }

        return (true, "");
    }
}