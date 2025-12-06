// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./interfaces/IAdapter.sol";
import "./PolicyGuard.sol";

/**
 * @title StrategyRouter
 * @author NeoMesh Team
 * @notice Routes capital between connected adapters based on defined intents and gas costs
 * @dev Core contract for intent-based fund allocation across DeFi protocols
 * @custom:security-contact security@neomesh.io
 * @custom:version 1.0.0
 */
contract StrategyRouter {
    // ============ Constants ============

    uint256 public constant MAX_REALISTIC_APY = 5000; // 50% APY maximum
    uint256 public constant MAX_RISK_SCORE = 10;
    uint256 public constant MIN_RISK_SCORE = 1;
    string public constant VERSION = "1.0.0";

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
    error EmptyRoutes();
    error InsufficientBalance();
    error WithdrawFailed();
    error DepositFailed();
    error IsPaused();
    error UserBlacklisted();
    error AdapterHasFunds();
    error AdapterNotRegistered();
    error GasCalculationOverflow();
    error SlippageExceeded();
    error InvalidLiquidityReserve();
    error InvalidMaxGasCost();

    // ============ State Variables ============

    address public owner;
    PolicyGuard public policyGuard;
    bool public paused;

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
        uint256 minReceived; // Slippage protection
        bytes data;
    }

    // ============ Events ============

    event IntentCreated(
        bytes32 indexed intentId,
        address indexed user,
        uint256 targetAPY,
        uint256 maxRisk
    );
    event IntentUpdated(
        bytes32 indexed intentId,
        uint256 newTargetAPY,
        uint256 newMaxRisk,
        uint256 newLiquidityReserve,
        uint256 newMaxGasCost
    );
    event IntentDeactivated(bytes32 indexed intentId, address indexed user);
    event FundsRouted(
        bytes32 indexed intentId,
        address indexed from,
        address indexed to,
        uint256 amountRequested,
        uint256 amountWithdrawn,
        uint256 amountDeposited,
        uint256 gasUsed
    );
    event AdapterRegistered(address indexed adapter, string protocol);
    event AdapterRemoved(address indexed adapter, string reason);
    event RouterPaused(string reason);
    event RouterUnpaused();
    event GasLimitExceededWarning(
        bytes32 indexed intentId,
        uint256 actualCost,
        uint256 maxCost
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyValidIntent(bytes32 intentId) {
        Intent storage intent = intents[intentId];
        if (!intent.active) revert IntentNotActive();
        if (intent.user != msg.sender) revert NotIntentOwner();
        
        // Check if user is blacklisted in PolicyGuard
        if (policyGuard.isUserBlacklisted(intent.user)) revert UserBlacklisted();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    // ============ Constructor ============

    constructor(address _policyGuard) {
        if (_policyGuard == address(0)) revert ZeroAddress();
        owner = msg.sender;
        policyGuard = PolicyGuard(_policyGuard);
    }

    // ============ External Functions ============

    /**
     * @notice Create a new investment intent
     * @param targetAPY Target annual percentage yield in basis points (e.g., 800 = 8%)
     * @param maxRisk Maximum risk tolerance (1-10, where 1 is lowest risk)
     * @param liquidityReserve Amount to keep liquid for immediate access
     * @param maxGasCost Maximum gas cost per rebalance operation in wei
     * @return intentId The unique identifier for the created intent
     */
    function createIntent(
        uint256 targetAPY,
        uint256 maxRisk,
        uint256 liquidityReserve,
        uint256 maxGasCost
    ) external whenNotPaused returns (bytes32 intentId) {
        if (maxRisk < MIN_RISK_SCORE || maxRisk > MAX_RISK_SCORE) revert InvalidRiskLevel();
        if (targetAPY > MAX_REALISTIC_APY) revert UnrealisticAPY();
        
        // Check if user is blacklisted
        if (policyGuard.isUserBlacklisted(msg.sender)) revert UserBlacklisted();

        // Generate unique intent ID
        intentId = keccak256(abi.encodePacked(msg.sender, block.timestamp, targetAPY, maxRisk));

        intents[intentId] = Intent({
            id: intentId,
            user: msg.sender,
            targetAPY: targetAPY,
            maxRisk: maxRisk,
            liquidityReserve: liquidityReserve,
            maxGasCost: maxGasCost,
            active: true
        });

        emit IntentCreated(intentId, msg.sender, targetAPY, maxRisk);
    }

    /**
     * @notice Update an existing intent
     * @param intentId The intent to update
     * @param targetAPY New target APY in basis points
     * @param maxRisk New maximum risk level (1-10)
     * @param liquidityReserve New liquidity reserve amount
     * @param maxGasCost New maximum gas cost in wei
     */
    function updateIntent(
        bytes32 intentId,
        uint256 targetAPY,
        uint256 maxRisk,
        uint256 liquidityReserve,
        uint256 maxGasCost
    ) external onlyValidIntent(intentId) {
        if (maxRisk < MIN_RISK_SCORE || maxRisk > MAX_RISK_SCORE) revert InvalidRiskLevel();
        if (targetAPY > MAX_REALISTIC_APY) revert UnrealisticAPY();

        Intent storage intent = intents[intentId];
        intent.targetAPY = targetAPY;
        intent.maxRisk = maxRisk;
        intent.liquidityReserve = liquidityReserve;
        intent.maxGasCost = maxGasCost;

        emit IntentUpdated(intentId, targetAPY, maxRisk, liquidityReserve, maxGasCost);
    }

    /**
     * @notice Deactivate an intent
     * @param intentId The intent to deactivate
     */
    function deactivateIntent(bytes32 intentId) external onlyValidIntent(intentId) {
        intents[intentId].active = false;
        emit IntentDeactivated(intentId, msg.sender);
    }

    /**
     * @notice Execute optimal routing based on intent parameters
     * @dev Routes funds between adapters according to the intent's strategy
     * @param intentId The intent to execute
     * @param routes Array of routing instructions
     */
    function executeRoute(
        bytes32 intentId,
        RouteParams[] calldata routes
    ) external onlyValidIntent(intentId) whenNotPaused {
        if (routes.length == 0) revert EmptyRoutes();

        Intent storage intent = intents[intentId];
        uint256 gasStart = gasleft();

        for (uint256 i; i < routes.length;) {
            RouteParams calldata route = routes[i];

            // Validate adapters are registered
            if (!registeredAdapters[route.fromAdapter]) revert InvalidAdapter();
            if (!registeredAdapters[route.toAdapter]) revert InvalidAdapter();

            // Check balance before withdrawal
            uint256 balanceBefore = IAdapter(route.fromAdapter).getUserBalance(intent.user);
            if (balanceBefore < route.amount) revert InsufficientBalance();

            // Validate against policy constraints
            if (!policyGuard.validateTransfer(intent.user, route.toAdapter, route.amount)) {
                revert PolicyViolation();
            }

            // Execute withdrawal from source adapter
            uint256 withdrawn = IAdapter(route.fromAdapter).withdraw(
                intent.user,
                route.amount,
                route.data
            );
            if (withdrawn == 0) revert WithdrawFailed();

            // Execute deposit to destination adapter (use actual withdrawn amount)
            uint256 deposited = IAdapter(route.toAdapter).deposit(
                intent.user,
                withdrawn,
                route.data
            );
            if (deposited == 0) revert DepositFailed();

            // Slippage protection - ensure minimum received amount
            if (deposited < route.minReceived) revert SlippageExceeded();

            emit FundsRouted(
                intentId,
                route.fromAdapter,
                route.toAdapter,
                route.amount,
                withdrawn,
                deposited,
                gasStart - gasleft()
            );

            unchecked {
                ++i;
            }
        }

        // Gas limit check with overflow protection
        uint256 gasUsed = gasStart - gasleft();
        uint256 gasCost;
        
        unchecked {
            gasCost = gasUsed * tx.gasprice;
            // Check for overflow: if gasCost / tx.gasprice != gasUsed, overflow occurred
            if (gasCost / tx.gasprice != gasUsed) revert GasCalculationOverflow();
        }

        // Soft limit - emit warning instead of reverting to avoid wasting user gas
        if (gasCost > intent.maxGasCost) {
            emit GasLimitExceededWarning(intentId, gasCost, intent.maxGasCost);
        }
    }

    /**
     * @notice Register a new protocol adapter
     * @param adapter Address of the adapter contract
     * @param protocol Name of the protocol (e.g., "Aave", "Uniswap")
     */
    function registerAdapter(address adapter, string calldata protocol) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        if (registeredAdapters[adapter]) revert AlreadyRegistered();

        registeredAdapters[adapter] = true;
        adapters.push(adapter);

        emit AdapterRegistered(adapter, protocol);
    }

    /**
     * @notice Remove an adapter (only if TVL is zero)
     * @dev Safety measure to prevent removing adapters with locked funds
     * @param adapter Address of the adapter to remove
     */
    function removeAdapter(address adapter) external onlyOwner {
        if (!registeredAdapters[adapter]) revert AdapterNotRegistered();

        // Check TVL is zero before removal
        uint256 tvl = IAdapter(adapter).getTVL();
        if (tvl > 0) revert AdapterHasFunds();

        registeredAdapters[adapter] = false;

        // Remove from array
        uint256 length = adapters.length;
        for (uint256 i; i < length;) {
            if (adapters[i] == adapter) {
                adapters[i] = adapters[length - 1];
                adapters.pop();
                break;
            }
            unchecked {
                ++i;
            }
        }

        emit AdapterRemoved(adapter, "TVL zero - safe removal");
    }

    /**
     * @notice Pause the router to prevent new intent creation and route execution
     * @param reason Reason for pausing (logged for transparency)
     */
    function pause(string calldata reason) external onlyOwner {
        paused = true;
        emit RouterPaused(reason);
    }

    /**
     * @notice Unpause the router to resume normal operations
     */
    function unpause() external onlyOwner {
        paused = false;
        emit RouterUnpaused();
    }

    /**
     * @notice Transfer ownership of the router
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @notice Get optimal route for given parameters
     * @dev Finds the best adapter based on APY-to-risk ratio
     * @param intentId Intent identifier (reserved for future use)
     * @param targetAPY Target APY in basis points
     * @param maxRisk Maximum acceptable risk level
     * @return bestAdapter Address of the best adapter
     * @return expectedAPY Expected APY from the best adapter
     */
    function getOptimalRoute(
        bytes32 intentId,
        uint256 targetAPY,
        uint256 maxRisk
    ) external view returns (address bestAdapter, uint256 expectedAPY) {
        // Silence unused variable warning (intentId reserved for future use)
        intentId;

        uint256 bestScore;
        uint256 length = adapters.length;

        for (uint256 i; i < length;) {
            IAdapter adapter = IAdapter(adapters[i]);
            uint256 apy = adapter.getCurrentAPY();
            uint256 risk = adapter.getRiskScore();

            // Check if adapter meets criteria
            if (risk <= maxRisk && apy >= targetAPY) {
                // Score formula: APY weighted by inverse risk
                // Higher APY and lower risk yield higher scores
                // Using (11 - risk) to give full weight to risk 1, minimal to risk 10
                uint256 score = (apy * (11 - risk)) / 10;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestAdapter = adapters[i];
                    expectedAPY = apy;
                }
            }

            unchecked {
                ++i;
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
     * @return Number of registered adapters
     */
    function getAdapterCount() external view returns (uint256) {
        return adapters.length;
    }

    /**
     * @notice Check if an adapter is registered
     * @param adapter Adapter address to check
     * @return true if adapter is registered, false otherwise
     */
    function isAdapterRegistered(address adapter) external view returns (bool) {
        return registeredAdapters[adapter];
    }

    /**
     * @notice Check if an intent is active
     * @param intentId Intent identifier
     * @return true if intent is active, false otherwise
     */
    function isIntentActive(bytes32 intentId) external view returns (bool) {
        return intents[intentId].active;
    }

    /**
     * @notice Get the owner of an intent
     * @param intentId Intent identifier
     * @return Address of the intent owner
     */
    function getIntentOwner(bytes32 intentId) external view returns (address) {
        return intents[intentId].user;
    }

    /**
     * @notice Estimate gas cost for executing a route
     * @dev Provides rough estimate based on average gas per operation
     * @param routes Array of routing instructions
     * @return Estimated gas cost in wei
     */
    function estimateRouteCost(RouteParams[] calldata routes) 
        external 
        view 
        returns (uint256) 
    {
        if (routes.length == 0) return 0;
        
        // Average gas per route operation:
        // - Withdraw: ~100k gas
        // - Deposit: ~100k gas  
        // - Overhead (checks, events): ~50k gas
        uint256 avgGasPerRoute = 250000;
        
        return routes.length * avgGasPerRoute * tx.gasprice;
    }

    /**
     * @notice Get detailed adapter information
     * @param adapter Adapter address
     * @return isRegistered Whether adapter is registered
     * @return currentAPY Current APY from the adapter
     * @return riskScore Risk score of the adapter
     * @return tvl Total value locked in the adapter
     */
    function getAdapterInfo(address adapter) 
        external 
        view 
        returns (
            bool isRegistered,
            uint256 currentAPY,
            uint256 riskScore,
            uint256 tvl
        ) 
    {
        isRegistered = registeredAdapters[adapter];
        
        if (isRegistered) {
            IAdapter adapterContract = IAdapter(adapter);
            currentAPY = adapterContract.getCurrentAPY();
            riskScore = adapterContract.getRiskScore();
            tvl = adapterContract.getTVL();
        }
    }

    /**
     * @notice Get user's total balance across all adapters
     * @param user User address
     * @return totalBalance Sum of user's balances across all registered adapters
     */
    function getUserTotalBalance(address user) 
        external 
        view 
        returns (uint256 totalBalance) 
    {
        uint256 length = adapters.length;
        
        for (uint256 i; i < length;) {
            totalBalance += IAdapter(adapters[i]).getUserBalance(user);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Get user's balances in each adapter
     * @param user User address
     * @return adapterAddresses Array of adapter addresses
     * @return balances Corresponding balances in each adapter
     */
    function getUserBalancesByAdapter(address user) 
        external 
        view 
        returns (
            address[] memory adapterAddresses,
            uint256[] memory balances
        ) 
    {
        uint256 length = adapters.length;
        adapterAddresses = new address[](length);
        balances = new uint256[](length);
        
        for (uint256 i; i < length;) {
            adapterAddresses[i] = adapters[i];
            balances[i] = IAdapter(adapters[i]).getUserBalance(user);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Check if route execution would be allowed
     * @dev Performs validation without executing (useful for UI)
     * @param intentId Intent identifier
     * @param routes Array of routing instructions
     * @return canExecute Whether route can be executed
     * @return reason Reason if execution would fail (empty if canExecute is true)
     */
    function canExecuteRoute(
        bytes32 intentId,
        RouteParams[] calldata routes
    ) external view returns (bool canExecute, string memory reason) {
        // Check if paused
        if (paused) {
            return (false, "Router is paused");
        }

        // Check if routes empty
        if (routes.length == 0) {
            return (false, "Empty routes array");
        }

        Intent storage intent = intents[intentId];
        
        // Check if intent is active
        if (!intent.active) {
            return (false, "Intent not active");
        }

        // Check if user is blacklisted
        if (policyGuard.isUserBlacklisted(intent.user)) {
            return (false, "User is blacklisted");
        }

        // Check each route
        for (uint256 i; i < routes.length;) {
            RouteParams calldata route = routes[i];

            // Check adapters are registered
            if (!registeredAdapters[route.fromAdapter]) {
                return (false, "Source adapter not registered");
            }
            if (!registeredAdapters[route.toAdapter]) {
                return (false, "Destination adapter not registered");
            }

            // Check balance
            uint256 balance = IAdapter(route.fromAdapter).getUserBalance(intent.user);
            if (balance < route.amount) {
                return (false, "Insufficient balance");
            }

            unchecked {
                ++i;
            }
        }

        return (true, "");
    }
}