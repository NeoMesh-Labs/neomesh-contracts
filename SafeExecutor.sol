// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title SafeExecutor
 * @author NeoMesh Team
 * @notice Module for Gnosis Safe execution with multi-sig fallback options
 * @dev Execution contract for multi-sig ready Safe module integration
 */
contract SafeExecutor {
    // ============ Custom Errors ============

    error NotOwner();
    error NotRouter();
    error NotSigner();
    error SafeNotRegistered();
    error ZeroAddress();
    error InvalidThreshold();
    error NoSigners();
    error InvalidDelay();
    error NotSafeOwner();
    error AlreadyExecuted();
    error TransactionCancelled();
    error AlreadyConfirmed();
    error NotEnoughConfirmations();
    error DelayNotPassed();

    // ============ State Variables ============

    address public owner;
    address public strategyRouter;

    mapping(address => bool) public registeredSafes;
    mapping(bytes32 => Transaction) public pendingTransactions;
    mapping(bytes32 => mapping(address => bool)) public confirmations;

    uint256 public constant MIN_DELAY = 1 hours;
    uint256 public constant MAX_DELAY = 7 days;

    // ============ Structs ============

    struct Transaction {
        address safe;
        address to;
        uint256 value;
        bytes data;
        uint256 confirmationsRequired;
        uint256 confirmationsReceived;
        uint256 executeAfter;
        bool executed;
        bool cancelled;
    }

    struct SafeConfig {
        uint256 threshold;
        address[] signers;
        uint256 delay;
        bool requireDelay;
    }

    mapping(address => SafeConfig) public safeConfigs;

    // ============ Events ============

    event SafeRegistered(address indexed safe, uint256 threshold, uint256 signerCount);
    event TransactionQueued(bytes32 indexed txHash, address indexed safe, address to, uint256 value);
    event TransactionConfirmed(bytes32 indexed txHash, address indexed signer);
    event TransactionExecuted(bytes32 indexed txHash, address indexed safe, bool success);
    event TransactionCancelledEvent(bytes32 indexed txHash, address indexed safe);
    event EmergencyExecuted(address indexed safe, address indexed to, uint256 value);

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != strategyRouter) revert NotRouter();
        _;
    }

    modifier onlyRegisteredSafe(address safe) {
        if (!registeredSafes[safe]) revert SafeNotRegistered();
        _;
    }

    // ============ Constructor ============

    constructor(address _strategyRouter) {
        owner = msg.sender;
        strategyRouter = _strategyRouter;
    }

    // ============ External Functions ============

    /**
     * @notice Register a Gnosis Safe with NeoMesh
     * @param safe Address of the Gnosis Safe
     * @param threshold Number of confirmations required
     * @param signers Array of signer addresses
     * @param delay Time delay before execution (0 for immediate)
     */
    function registerSafe(
        address safe,
        uint256 threshold,
        address[] calldata signers,
        uint256 delay
    ) external {
        if (safe == address(0)) revert ZeroAddress();
        if (threshold == 0 || threshold > signers.length) revert InvalidThreshold();
        if (signers.length == 0) revert NoSigners();

        if (delay != 0) {
            if (delay < MIN_DELAY || delay > MAX_DELAY) revert InvalidDelay();
        }

        if (!_isOwnerOfSafe(safe, msg.sender)) revert NotSafeOwner();

        registeredSafes[safe] = true;
        safeConfigs[safe] = SafeConfig({
            threshold: threshold,
            signers: signers,
            delay: delay,
            requireDelay: delay != 0
        });

        emit SafeRegistered(safe, threshold, signers.length);
    }

    /**
     * @notice Queue a transaction for execution
     * @param safe Address of the Gnosis Safe
     * @param to Target address
     * @param value ETH value
     * @param data Call data
     * @return txHash Hash of the queued transaction
     */
    function queueTransaction(
        address safe,
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyRouter onlyRegisteredSafe(safe) returns (bytes32 txHash) {
        SafeConfig storage config = safeConfigs[safe];

        txHash = keccak256(abi.encodePacked(safe, to, value, data, block.timestamp));

        uint256 executeAfter = config.requireDelay
            ? block.timestamp + config.delay
            : block.timestamp;

        pendingTransactions[txHash] = Transaction({
            safe: safe,
            to: to,
            value: value,
            data: data,
            confirmationsRequired: config.threshold,
            confirmationsReceived: 0,
            executeAfter: executeAfter,
            executed: false,
            cancelled: false
        });

        emit TransactionQueued(txHash, safe, to, value);
    }

    /**
     * @notice Confirm a pending transaction
     * @param txHash Hash of the transaction to confirm
     */
    function confirmTransaction(bytes32 txHash) external {
        Transaction storage txn = pendingTransactions[txHash];

        if (txn.executed) revert AlreadyExecuted();
        if (txn.cancelled) revert TransactionCancelled();
        if (!_isSigner(txn.safe, msg.sender)) revert NotSigner();
        if (confirmations[txHash][msg.sender]) revert AlreadyConfirmed();

        confirmations[txHash][msg.sender] = true;
        ++txn.confirmationsReceived;

        emit TransactionConfirmed(txHash, msg.sender);
    }

    /**
     * @notice Execute a confirmed transaction
     * @param txHash Hash of the transaction to execute
     * @return success Whether execution succeeded
     */
    function executeTransaction(bytes32 txHash) external returns (bool success) {
        Transaction storage txn = pendingTransactions[txHash];

        if (txn.executed) revert AlreadyExecuted();
        if (txn.cancelled) revert TransactionCancelled();
        if (txn.confirmationsReceived < txn.confirmationsRequired) revert NotEnoughConfirmations();
        if (block.timestamp < txn.executeAfter) revert DelayNotPassed();

        txn.executed = true;

        success = _executeSafeTransaction(txn.safe, txn.to, txn.value, txn.data);

        emit TransactionExecuted(txHash, txn.safe, success);
    }

    /**
     * @notice Cancel a pending transaction
     * @param txHash Hash of the transaction to cancel
     */
    function cancelTransaction(bytes32 txHash) external {
        Transaction storage txn = pendingTransactions[txHash];

        if (txn.executed) revert AlreadyExecuted();
        if (!_isSigner(txn.safe, msg.sender)) revert NotSigner();

        txn.cancelled = true;

        emit TransactionCancelledEvent(txHash, txn.safe);
    }

    // ============ View Functions ============

    /**
     * @notice Get transaction details
     * @param txHash Transaction hash
     * @return Transaction struct
     */
    function getTransaction(bytes32 txHash) external view returns (Transaction memory) {
        return pendingTransactions[txHash];
    }

    /**
     * @notice Get Safe configuration
     * @param safe Safe address
     * @return SafeConfig struct
     */
    function getSafeConfig(address safe) external view returns (SafeConfig memory) {
        return safeConfigs[safe];
    }

    /**
     * @notice Check if signer has confirmed transaction
     * @param txHash Transaction hash
     * @param signer Signer address
     * @return Whether signer has confirmed
     */
    function isConfirmed(bytes32 txHash, address signer) external view returns (bool) {
        return confirmations[txHash][signer];
    }

    /**
     * @notice Check if transaction can be executed
     * @param txHash Transaction hash
     * @return Whether transaction can be executed
     */
    function canExecute(bytes32 txHash) external view returns (bool) {
        Transaction storage txn = pendingTransactions[txHash];
        return !txn.executed
            && !txn.cancelled
            && txn.confirmationsReceived > txn.confirmationsRequired - 1
            && block.timestamp > txn.executeAfter - 1;
    }

    // ============ Internal Functions ============

    function _isSigner(address safe, address account) internal view returns (bool) {
        SafeConfig storage config = safeConfigs[safe];
        uint256 len = config.signers.length;
        for (uint256 i; i < len; ++i) {
            if (config.signers[i] == account) {
                return true;
            }
        }
        return false;
    }

    function _isOwnerOfSafe(address safe, address account) internal view returns (bool) {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory data) = safe.staticcall(
            abi.encodeWithSignature("isOwner(address)", account)
        );
        return success && abi.decode(data, (bool));
    }

    function _executeSafeTransaction(
        address safe,
        address to,
        uint256 value,
        bytes memory data
    ) internal returns (bool success) {
        // solhint-disable-next-line avoid-low-level-calls
        (success, ) = safe.call(
            abi.encodeWithSignature(
                "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)",
                to,
                value,
                data,
                uint8(0),
                uint256(0),
                uint256(0),
                uint256(0),
                address(0),
                payable(address(0)),
                ""
            )
        );
    }
}
