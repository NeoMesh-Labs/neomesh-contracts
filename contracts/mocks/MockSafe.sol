// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title MockSafe
 * @notice Mock Gnosis Safe for testing purposes
 */
contract MockSafe {
    mapping(address => bool) public owners;
    address[] public ownerList;

    constructor(address[] memory _owners) {
        for (uint256 i = 0; i < _owners.length; i++) {
            owners[_owners[i]] = true;
            ownerList.push(_owners[i]);
        }
    }

    function isOwner(address account) external view returns (bool) {
        return owners[account];
    }

    function getOwners() external view returns (address[] memory) {
        return ownerList;
    }

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes calldata
    ) external returns (bool success) {
        // Simple mock execution
        if (value > 0 && address(this).balance >= value) {
            (success, ) = to.call{value: value}(data);
        } else if (value == 0) {
            (success, ) = to.call(data);
        } else {
            success = true; // Mock success for testing
        }
    }

    receive() external payable {}
}