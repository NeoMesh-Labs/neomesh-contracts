// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IAdapter.sol";
import "./PolicyGuard.sol";

/**
 * @title StrategyRouter
 * @author NeoMesh Team
 * @notice Routes capital between connected adapters based on defined intents and gas costs
 * @dev Core contract for intent-based fund allocation across DeFi protocols
 */
contract StrategyRouter {
    // ============ Custom Errors ============

    error NotOwner();
    error IntentNotActive();
    error NotIntentOwner();
    error InvalidRiskLevel();
    error UnrealisticAPY();
    error InvalidAdapter();
    error PolicyViolation();
    error GasLimitExceeded();
    error ZeroAddress();
    error AlreadyRegistered();

    // ============ State Variables ============

    address public owner;
    PolicyGuard public policyGuard;

    mapping(bytes32 => Intent) public intents;
    mapping(address => bool) public registeredAdapters;
    address[] public adapters;

    // ============ Structs ============

    struct Intent {
        bytes32 id;
        address user;
        uint256 targetAPY;
        uint256 maxRisk;
        uint256 liquidityReserve;
        uint256 maxGasCost;
        bool active;
    }

    struct RouteParams {
        address fromAdapter;
        address toAdapter;
        uint256 amount;
        bytes data;
    }

    // ============ Events ============

    event IntentCreated(bytes32 indexed intentId, address indexed user, uint256 targetAPY);
    event IntentUpdated(bytes32 indexed intentId, uint256 newTargetAPY, uint256 newMaxRisk);
    event IntentDeactivated(bytes32 indexed intentId);
    event FundsRouted(address indexed from, address indexed to, uint256 amount, uint256 gasUsed);
    event AdapterRegistered(address indexed adapter, string protocol);
    event AdapterRemoved(address indexed adapter);

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyValidIntent(bytes32 intentId) {
        if (!intents[intentId].active) revert IntentNotActive();
        if (intents[intentId].user != msg.sender) revert NotIntentOwner();
        _;
    }

    // ============ Constructor ============

    constructor(address _policyGuard) {
        owner = msg.sender;
        policyGuard = PolicyGuard(_policyGuard);
    }

    // ============ External Functions ============

    /**
     * @notice Create a new investment intent
     * @param targetAPY Target annual percentage yield in basis points
     * @param maxRisk Maximum risk tolerance (1-10)
     * @param liquidityReserve Amount to keep liquid for immediate access
     * @param maxGasCost Maximum gas cost per rebalance operation
     * @return intentId The unique identifier for the created intent
     */
    function createIntent(
        uint256 targetAPY,
        uint256 maxRisk,
        uint256 liquidityReserve,
        uint256 maxGasCost
    ) external returns (bytes32 intentId) {
        if (maxRisk < 1 || maxRisk > 10) revert InvalidRiskLevel();
        if (targetAPY > 5000) revert UnrealisticAPY();

        intentId = keccak256(abi.encodePacked(msg.sender, block.timestamp, targetAPY));

        intents[intentId] = Intent({
            id: intentId,
            user: msg.sender,
            targetAPY: targetAPY,
            maxRisk: maxRisk,
            liquidityReserve: liquidityReserve,
            maxGasCost: maxGasCost,
            active: true
        });

        emit IntentCreated(intentId, msg.sender, targetAPY);
    }

    /**
     * @notice Execute optimal routing based on intent parameters
     * @param intentId The intent to execute
     * @param routes Array of routing instructions
     */
    function executeRoute(
        bytes32 intentId,
        RouteParams[] calldata routes
    ) external onlyValidIntent(intentId) {
        Intent storage intent = intents[intentId];
        uint256 gasStart = gasleft();

        for (uint256 i; i < routes.length; ++i) {
            RouteParams calldata route = routes[i];

            if (!registeredAdapters[route.fromAdapter]) revert InvalidAdapter();
            if (!registeredAdapters[route.toAdapter]) revert InvalidAdapter();

            if (!policyGuard.validateTransfer(intent.user, route.toAdapter, route.amount)) {
                revert PolicyViolation();
            }

            IAdapter(route.fromAdapter).withdraw(route.amount, route.data);
            IAdapter(route.toAdapter).deposit(route.amount, route.data);

            emit FundsRouted(route.fromAdapter, route.toAdapter, route.amount, gasStart - gasleft());
        }

        uint256 gasUsed = gasStart - gasleft();
        if (gasUsed * tx.gasprice > intent.maxGasCost) revert GasLimitExceeded();
    }

    /**
     * @notice Register a new protocol adapter
     * @param adapter Address of the adapter contract
     * @param protocol Name of the protocol
     */
    function registerAdapter(address adapter, string calldata protocol) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (registeredAdapters[adapter]) revert AlreadyRegistered();

        registeredAdapters[adapter] = true;
        adapters.push(adapter);

        emit AdapterRegistered(adapter, protocol);
    }

    /**
     * @notice Get optimal route for given parameters
     * @param targetAPY Target APY in basis points
     * @param maxRisk Maximum risk tolerance
     * @return bestAdapter Address of the best adapter
     * @return expectedAPY Expected APY from the best adapter
     */
    function getOptimalRoute(
        uint256,
        uint256 targetAPY,
        uint256 maxRisk
    ) external view returns (address bestAdapter, uint256 expectedAPY) {
        uint256 bestScore;

        for (uint256 i; i < adapters.length; ++i) {
            IAdapter adapter = IAdapter(adapters[i]);
            uint256 apy = adapter.getCurrentAPY();
            uint256 risk = adapter.getRiskScore();

            if (risk < maxRisk + 1 && apy > targetAPY - 1) {
                uint256 score = (apy * (10 - risk)) / 10;
                if (score > bestScore) {
                    bestScore = score;
                    bestAdapter = adapters[i];
                    expectedAPY = apy;
                }
            }
        }
    }

    // ============ View Functions ============

    /**
     * @notice Get intent details by ID
     * @param intentId The intent identifier
     * @return Intent struct with all details
     */
    function getIntent(bytes32 intentId) external view returns (Intent memory) {
        return intents[intentId];
    }

    /**
     * @notice Get all registered adapters
     * @return Array of adapter addresses
     */
    function getAdapters() external view returns (address[] memory) {
        return adapters;
    }

    /**
     * @notice Get the number of registered adapters
     * @return Number of adapters
     */
    function getAdapterCount() external view returns (uint256) {
        return adapters.length;
    }
}
