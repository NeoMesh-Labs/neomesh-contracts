// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IAdapter
 * @author NeoMesh Team
 * @notice Interface for protocol adapters
 */
interface IAdapter {
    function deposit(uint256 amount, bytes calldata data) external returns (uint256 shares);
    function withdraw(uint256 amount, bytes calldata data) external returns (uint256 received);
    function harvest() external returns (uint256 yield);
    function getCurrentAPY() external view returns (uint256);
    function getRiskScore() external view returns (uint256);
    function getTVL() external view returns (uint256);
    function getUserBalance(address user) external view returns (uint256);
}
