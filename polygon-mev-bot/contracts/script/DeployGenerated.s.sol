// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MEVExecutor} from "../src/generated/MEVExecutor.sol";

contract DeployGenerated is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address balancerVault = vm.envAddress("BALANCER_VAULT_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        MEVExecutor executor = new MEVExecutor(balancerVault);
        vm.stopBroadcast();

        console2.log("MEVExecutor deployed at", address(executor));
    }
}
