// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../src/generated/MEVExecutor.sol";

contract DeployGenerated {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address balancerVault = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
        
        vm.startBroadcast(deployerPrivateKey);
        
        MEVExecutor executor = new MEVExecutor(balancerVault);
        
        vm.stopBroadcast();
        
        console.log("MEVExecutor deployed at:", address(executor));
    }
}
