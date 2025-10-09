// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {MEVExecutor} from "../src/generated/MEVExecutor.sol";
import {console} from "forge-std/console.sol";

contract DeployReal is Script {
    function run() external returns (MEVExecutor) {
        address balancerVault = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
        
        // Get deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy MEVExecutor
        MEVExecutor executor = new MEVExecutor(balancerVault);
        
        console.log("MEVExecutor deployed at:", address(executor));
        console.log("Owner:", executor.owner());
        console.log("Balancer Vault:", address(executor.BALANCER_VAULT()));
        
        vm.stopBroadcast();
        
        return executor;
    }
}
