// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IAdapter
 * @author NeoMesh Team
 * @notice Standard interface for all protocol adapters
 * @dev All adapters must implement this interface for StrategyRouter compatibility
 * @custom:security-contact security@neomesh.io
 */
interface IAdapter {
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
    ) external returns (uint256 shares);

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
    ) external returns (uint256 received);

    /**
     * @notice Harvest yield from the protocol
     * @param user Address of the user harvesting
     * @param minYield Minimum acceptable yield (slippage protection)
     * @return yieldAmount Amount of yield harvested
     */
    function harvest(address user, uint256 minYield) 
        external 
        returns (uint256 yieldAmount);

    /**
     * @notice Get current APY from the protocol
     * @return Current APY in basis points (e.g., 800 = 8%)
     */
    function getCurrentAPY() external view returns (uint256);

    /**
     * @notice Get risk score of this adapter
     * @return Risk score (1-10, where 1 is lowest risk)
     */
    function getRiskScore() external view returns (uint256);

    /**
     * @notice Get total value locked in this adapter
     * @return Total value locked in wei
     */
    function getTVL() external view returns (uint256);

    /**
     * @notice Get user's balance in this adapter
     * @param user User address
     * @return User's balance in wei
     */
    function getUserBalance(address user) external view returns (uint256);
}