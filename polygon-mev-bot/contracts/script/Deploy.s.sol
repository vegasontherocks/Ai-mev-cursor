// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MEVExecutor} from "../src/generated/MEVExecutor.sol";

contract DeployMEVExecutor is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address balancerVault = vm.envAddress("BALANCER_VAULT_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        MEVExecutor executor = new MEVExecutor(balancerVault);

        // Optional: adjust circuit breaker thresholds if different from defaults
        uint256 minProfit = _envOrUint("MEV_MIN_PROFIT", 0.01 ether);
        uint256 maxLoss = _envOrUint("MEV_MAX_LOSS", 0.1 ether);
        uint256 dailyLimit = _envOrUint("MEV_DAILY_LIMIT", 5 ether);
        executor.setCircuitBreakerConfig(minProfit, maxLoss, dailyLimit);

        vm.stopBroadcast();

        console2.log("MEVExecutor deployed at", address(executor));
        console2.log("Owner", executor.owner());
        console2.log("Balancer Vault", address(executor.BALANCER_VAULT()));
    }

    function _envOrUint(string memory key, uint256 defaultValue) internal view returns (uint256) {
        return vm.envExists(key) ? vm.envUint(key) : defaultValue;
    }
}
