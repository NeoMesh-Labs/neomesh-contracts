// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./interfaces/IAdapter.sol";

/**
 * @title AdapterBase
 * @author NeoMesh Team
 * @notice Standardized interface for connecting external protocols (Aave, Uniswap, etc)
 * @dev Abstract base contract for protocol-agnostic integrations
 * @custom:security-contact security@neomesh.io
 */
abstract contract AdapterBase is IAdapter {
    // ============ Custom Errors ============

    error NotOwner();
    error NotRouter();
    error IsPaused();
    error ZeroRouter();
    error InvalidRiskScore();
    error ZeroAmount();
    error InsufficientBalance();
    error EmergencyModeNotActive();
    error EmergencyModeNotInitiated();
    error EmergencyDelayNotPassed();
    error NoDeposits();
    error ZeroAddress();

    // ============ State Variables ============

    address public owner;
    address public strategyRouter;
    string public protocolName;
    uint256 public riskScore;
    bool public paused;

    mapping(address => uint256) public userDeposits;
    uint256 public totalDeposits;

    // Emergency withdrawal state
    uint256 public constant EMERGENCY_DELAY = 7 days;
    uint256 public emergencyUnlockTime;
    bool public emergencyMode;

    // Version
    string public constant VERSION = "1.0.0";

    // ============ Events ============

    event Deposited(address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, uint256 amount, uint256 shares);
    event Harvested(address indexed user, uint256 yieldAmount);
    event AdapterPaused(string reason);
    event AdapterUnpaused();
    event RiskScoreUpdated(uint256 oldScore, uint256 newScore);
    event EmergencyModeInitiated(uint256 unlockTime);
    event EmergencyWithdrawal(address indexed user, uint256 amount);
    event EmergencyModeCancelled();
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != strategyRouter) revert NotRouter();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _strategyRouter,
        string memory _protocolName,
        uint256 _riskScore
    ) {
        if (_strategyRouter == address(0)) revert ZeroRouter();
        if (_riskScore < 1 || _riskScore > 10) revert InvalidRiskScore();

        owner = msg.sender;
        strategyRouter = _strategyRouter;
        protocolName = _protocolName;
        riskScore = _riskScore;
    }

    // ============ External Functions ============

    /**
     * @notice Deposit funds into the protocol
     * @param user Address of the user making deposit
     * @param amount Amount to deposit
     * @param data Additional protocol-specific data
     * @return shares Number of shares received
     */
    function deposit(
        address user,
        uint256 amount,
        bytes calldata data
    ) external override onlyRouter whenNotPaused returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        if (user == address(0)) revert ZeroAddress();

        // Execute deposit first (checks)
        shares = _executeDeposit(amount, data);

        // Update state after successful deposit (effects)
        userDeposits[user] += amount;
        totalDeposits += amount;

        emit Deposited(user, amount, shares);
    }

    /**
     * @notice Withdraw funds from the protocol
     * @param user Address of the user withdrawing
     * @param amount Amount to withdraw
     * @param data Additional protocol-specific data
     * @return received Amount received after withdrawal
     */
    function withdraw(
        address user,
        uint256 amount,
        bytes calldata data
    ) external override onlyRouter whenNotPaused returns (uint256 received) {
        if (amount == 0) revert ZeroAmount();
        if (user == address(0)) revert ZeroAddress();
        if (userDeposits[user] < amount) revert InsufficientBalance();

        // Update state BEFORE external call (CEI pattern - prevents reentrancy)
        userDeposits[user] -= amount;
        totalDeposits -= amount;

        // Execute withdrawal (interactions)
        received = _executeWithdraw(amount, data);

        emit Withdrawn(user, amount, received);
    }

    /**
     * @notice Harvest yield from the protocol
     * @param user Address of the user harvesting
     * @param minYield Minimum acceptable yield (slippage protection)
     * @return yieldAmount Amount of yield harvested
     */
    function harvest(address user, uint256 minYield) 
        external 
        override 
        onlyRouter 
        whenNotPaused 
        returns (uint256 yieldAmount) 
    {
        if (user == address(0)) revert ZeroAddress();
        
        yieldAmount = _executeHarvest();
        
        // Slippage protection
        if (yieldAmount < minYield) revert InsufficientBalance();
        
        emit Harvested(user, yieldAmount);
    }

    /**
     * @notice Get current APY from the protocol
     * @return Current APY in basis points
     */
    function getCurrentAPY() external view override returns (uint256) {
        return _getProtocolAPY();
    }

    /**
     * @notice Get risk score of this adapter
     * @return Risk score (1-10)
     */
    function getRiskScore() external view override returns (uint256) {
        return riskScore;
    }

    /**
     * @notice Get total value locked in this adapter
     * @return Total value locked
     */
    function getTVL() external view override returns (uint256) {
        return _getProtocolTVL();
    }

    /**
     * @notice Get user's balance in this adapter
     * @param user User address
     * @return User's balance
     */
    function getUserBalance(address user) external view override returns (uint256) {
        if (user == address(0)) return 0;
        return _getUserProtocolBalance(user);
    }

    // ============ Admin Functions ============

    /**
     * @notice Pause the adapter
     * @param reason Reason for pausing
     */
    function pause(string calldata reason) external onlyOwner {
        paused = true;
        emit AdapterPaused(reason);
    }

    /**
     * @notice Unpause the adapter
     */
    function unpause() external onlyOwner {
        paused = false;
        emit AdapterUnpaused();
    }

    /**
     * @notice Update the risk score
     * @param newScore New risk score (1-10)
     */
    function updateRiskScore(uint256 newScore) external onlyOwner {
        if (newScore < 1 || newScore > 10) revert InvalidRiskScore();
        uint256 oldScore = riskScore;
        riskScore = newScore;
        emit RiskScoreUpdated(oldScore, newScore);
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

    // ============ Emergency Functions ============

    /**
     * @notice Initiate emergency mode with 7-day timelock
     * @dev Allows users to bypass router and withdraw directly after delay
     *      Use this when router is compromised or non-functional
     */
    function initiateEmergencyMode() external onlyOwner {
        emergencyUnlockTime = block.timestamp + EMERGENCY_DELAY;
        emergencyMode = true;
        emit EmergencyModeInitiated(emergencyUnlockTime);
    }

    /**
     * @notice Cancel emergency mode before timelock expires
     * @dev Use this if router is fixed before delay passes
     */
    function cancelEmergencyMode() external onlyOwner {
        emergencyMode = false;
        emergencyUnlockTime = 0;
        emit EmergencyModeCancelled();
    }

    /**
     * @notice Emergency withdrawal bypassing router
     * @dev Only callable after emergency delay has passed
     *      Users call this themselves - no trust needed
     */
    function emergencyWithdraw() external {
        if (!emergencyMode) revert EmergencyModeNotActive();
        if (emergencyUnlockTime == 0) revert EmergencyModeNotInitiated();
        if (block.timestamp < emergencyUnlockTime) revert EmergencyDelayNotPassed();
        
        uint256 amount = userDeposits[msg.sender];
        if (amount == 0) revert NoDeposits();
        
        // Update state before external call (CEI pattern)
        userDeposits[msg.sender] = 0;
        totalDeposits -= amount;
        
        // Execute withdrawal through protocol (with empty data)
        bytes memory emptyData = "";
        uint256 received = _executeWithdraw(amount, emptyData);
        
        // Transfer received funds to user
        _transferToUser(msg.sender, received);
        
        emit EmergencyWithdrawal(msg.sender, received);
    }

    // ============ Internal Functions (Override in implementations) ============

    /**
     * @dev Execute deposit to underlying protocol
     * @param amount Amount to deposit
     * @param data Protocol-specific data
     * @return shares Number of shares received
     */
    function _executeDeposit(uint256 amount, bytes calldata data) 
        internal 
        virtual 
        returns (uint256 shares);

    /**
     * @dev Execute withdrawal from underlying protocol
     * @param amount Amount to withdraw
     * @param data Protocol-specific data (can be memory or calldata in implementations)
     * @return received Amount received after withdrawal
     */
    function _executeWithdraw(uint256 amount, bytes memory data) 
        internal 
        virtual 
        returns (uint256 received);

    /**
     * @dev Execute harvest from underlying protocol
     * @return yieldAmount Amount of yield harvested
     */
    function _executeHarvest() 
        internal 
        virtual 
        returns (uint256 yieldAmount);

    /**
     * @dev Get current APY from underlying protocol
     * @return APY in basis points
     */
    function _getProtocolAPY() 
        internal 
        view 
        virtual 
        returns (uint256);

    /**
     * @dev Get total value locked in underlying protocol
     * @return Total value locked
     */
    function _getProtocolTVL() 
        internal 
        view 
        virtual 
        returns (uint256);

    /**
     * @dev Get user's balance in underlying protocol
     * @param user User address
     * @return User's balance
     */
    function _getUserProtocolBalance(address user) 
        internal 
        view 
        virtual 
        returns (uint256);

    /**
     * @dev Transfer funds to user - must be implemented by concrete adapters
     * @param user Address to receive funds
     * @param amount Amount to transfer
     */
    function _transferToUser(address user, uint256 amount) 
        internal 
        virtual;
}