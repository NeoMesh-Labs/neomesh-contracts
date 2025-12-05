// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IAdapter.sol";

/**
 * @title MockAdapter
 * @notice Mock adapter for testing purposes
 */
contract MockAdapter is IAdapter {
    address public strategyRouter;
    string public protocolName;
    uint256 public riskScore;
    uint256 public mockAPY;
    uint256 public mockTVL;

    mapping(address => uint256) public balances;

    constructor(
        address _strategyRouter,
        string memory _protocolName,
        uint256 _riskScore,
        uint256 _mockAPY
    ) {
        strategyRouter = _strategyRouter;
        protocolName = _protocolName;
        riskScore = _riskScore;
        mockAPY = _mockAPY;
        mockTVL = 1000 ether;
    }

    function deposit(uint256 amount, bytes calldata) external override returns (uint256) {
        balances[tx.origin] += amount;
        return amount; // 1:1 shares
    }

    function withdraw(uint256 amount, bytes calldata) external override returns (uint256) {
        balances[tx.origin] -= amount;
        return amount;
    }

    function harvest() external override returns (uint256) {
        return 0;
    }

    function getCurrentAPY() external view override returns (uint256) {
        return mockAPY;
    }

    function getRiskScore() external view override returns (uint256) {
        return riskScore;
    }

    function getTVL() external view override returns (uint256) {
        return mockTVL;
    }

    function getUserBalance(address user) external view override returns (uint256) {
        return balances[user];
    }

    // Test helpers
    function setMockAPY(uint256 _apy) external {
        mockAPY = _apy;
    }

    function setMockTVL(uint256 _tvl) external {
        mockTVL = _tvl;
    }
}
