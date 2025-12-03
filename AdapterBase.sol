// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IAdapter.sol";

/**
 * @title AdapterBase
 * @author NeoMesh Team
 * @notice Standardized interface for connecting external protocols (Aave, Uniswap, etc)
 * @dev Abstract base contract for protocol-agnostic integrations
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

    // ============ State Variables ============

    address public owner;
    address public strategyRouter;
    string public protocolName;
    uint256 public riskScore;
    bool public paused;

    mapping(address => uint256) public userDeposits;
    uint256 public totalDeposits;

    // ============ Events ============

    event Deposited(address indexed user, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, uint256 amount, uint256 shares);
    event Harvested(address indexed user, uint256 yieldAmount);
    event AdapterPaused(string reason);
    event AdapterUnpaused();

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
     * @param amount Amount to deposit
     * @param data Additional protocol-specific data
     * @return shares Number of shares received
     */
    function deposit(
        uint256 amount,
        bytes calldata data
    ) external override onlyRouter whenNotPaused returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();

        shares = _executeDeposit(amount, data);

        userDeposits[tx.origin] += amount;
        totalDeposits += amount;

        emit Deposited(tx.origin, amount, shares);
    }

    /**
     * @notice Withdraw funds from the protocol
     * @param amount Amount to withdraw
     * @param data Additional protocol-specific data
     * @return received Amount received after withdrawal
     */
    function withdraw(
        uint256 amount,
        bytes calldata data
    ) external override onlyRouter whenNotPaused returns (uint256 received) {
        if (amount == 0) revert ZeroAmount();
        if (userDeposits[tx.origin] < amount) revert InsufficientBalance();

        received = _executeWithdraw(amount, data);

        userDeposits[tx.origin] -= amount;
        totalDeposits -= amount;

        emit Withdrawn(tx.origin, amount, received);
    }

    /**
     * @notice Harvest yield from the protocol
     * @return yieldAmount Amount of yield harvested
     */
    function harvest() external override onlyRouter whenNotPaused returns (uint256 yieldAmount) {
        yieldAmount = _executeHarvest();
        emit Harvested(tx.origin, yieldAmount);
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
        riskScore = newScore;
    }

    // ============ Internal Functions (Override in implementations) ============

    function _executeDeposit(uint256 amount, bytes calldata data) internal virtual returns (uint256 shares);
    function _executeWithdraw(uint256 amount, bytes calldata data) internal virtual returns (uint256 received);
    function _executeHarvest() internal virtual returns (uint256 yieldAmount);
    function _getProtocolAPY() internal view virtual returns (uint256);
    function _getProtocolTVL() internal view virtual returns (uint256);
    function _getUserProtocolBalance(address user) internal view virtual returns (uint256);
}
