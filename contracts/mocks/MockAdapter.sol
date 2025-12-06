// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AdapterBase.sol";

/**
 * @title MockAdapter
 * @notice Mock adapter for testing purposes - extends AdapterBase
 */
contract MockAdapter is AdapterBase {
    uint256 public mockAPY;
    uint256 public mockTVL;

    // Track actual balances for testing
    mapping(address => uint256) public balances;

    constructor(
        address _strategyRouter,
        string memory _protocolName,
        uint256 _riskScore,
        uint256 _mockAPY
    ) AdapterBase(_strategyRouter, _protocolName, _riskScore) {
        mockAPY = _mockAPY;
        mockTVL = 1000 ether;
    }

    // ============ Internal Implementations ============

    function _executeDeposit(uint256 amount, bytes calldata) 
        internal 
        override 
        returns (uint256 shares) 
    {
        // Simple 1:1 deposit for testing
        shares = amount;
    }

    function _executeWithdraw(uint256 amount, bytes memory) 
        internal 
        override 
        returns (uint256 received) 
    {
        // Simple 1:1 withdrawal for testing
        received = amount;
    }

    function _executeHarvest() 
        internal 
        override 
        returns (uint256 yieldAmount) 
    {
        // Return 0 yield for testing
        yieldAmount = 0;
    }

    function _getProtocolAPY() 
        internal 
        view 
        override 
        returns (uint256) 
    {
        return mockAPY;
    }

    function _getProtocolTVL() 
        internal 
        view 
        override 
        returns (uint256) 
    {
        return mockTVL;
    }

    function _getUserProtocolBalance(address user) 
        internal 
        view 
        override 
        returns (uint256) 
    {
        // Return userDeposits tracked by AdapterBase, not balances
        return userDeposits[user];
    }

    function _transferToUser(address user, uint256 amount) 
        internal 
        override 
    {
        // In a real adapter, this would transfer tokens
        // For testing, we just track it
        balances[user] = amount;
    }

    // ============ Test Helper Functions ============

    function setMockAPY(uint256 _apy) external {
        mockAPY = _apy;
    }

    function setMockTVL(uint256 _tvl) external {
        mockTVL = _tvl;
    }

    function setUserBalance(address user, uint256 balance) external {
        balances[user] = balance;
        
        if (balance > userDeposits[user]) {
            uint256 diff = balance - userDeposits[user];
            userDeposits[user] = balance;
            totalDeposits += diff;
        } else if (balance < userDeposits[user]) {
            uint256 diff = userDeposits[user] - balance;
            userDeposits[user] = balance;
            totalDeposits -= diff;
        }
    }
}