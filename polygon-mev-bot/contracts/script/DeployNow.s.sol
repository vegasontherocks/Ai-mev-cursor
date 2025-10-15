// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {MEVExecutor} from "../src/generated/MEVExecutor.sol";

contract DeployNow is Script {
    function run() external returns (address) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address balancerVault = vm.envAddress("BALANCER_VAULT_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        MEVExecutor executor = new MEVExecutor(balancerVault);
        vm.stopBroadcast();

        return address(executor);
    }
}
