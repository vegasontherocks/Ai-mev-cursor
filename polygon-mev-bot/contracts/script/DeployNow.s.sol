// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../src/generated/MEVExecutor.sol";

contract DeployNow {
    function run() external returns (address) {
        address balancerVault = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
        
        MEVExecutor executor = new MEVExecutor(balancerVault);
        
        return address(executor);
    }
}
