// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Script.sol";
import "../src/MEVExecutor.sol";

contract DeployMEVExecutor is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address balancerVault = vm.envAddress("BALANCER_VAULT_ADDRESS");

        console.log("Deploying MEVExecutor...");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Balancer Vault:", balancerVault);

        vm.startBroadcast(deployerPrivateKey);

        MEVExecutor executor = new MEVExecutor(balancerVault);

        // Register Chainlink oracles for Polygon
        executor.registerOracle(
            0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270, // WMATIC
            0xAB594600376Ec9fD91F8e885dADF0CE036862dE0 // MATIC/USD feed
        );

        executor.registerOracle(
            0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174, // USDC
            0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7 // USDC/USD feed
        );

        executor.registerOracle(
            0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619, // WETH
            0xF9680D99D6C9589e2a93a78A04A279e509205945 // ETH/USD feed
        );

        // Approve major DEXs
        executor.approveDEX(0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff, true); // QuickSwap
        executor.approveDEX(0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506, true); // SushiSwap
        executor.approveDEX(0xE592427A0AEce92De3Edee1F18E0157C05861564, true); // Uniswap V3

        // Set initial circuit breaker parameters
        executor.setCircuitBreaker(
            0.01 ether, // minProfit: 0.01 MATIC
            0.1 ether, // maxLoss: 0.1 MATIC per tx
            5 ether, // dailyLimit: 5 MATIC
            300 // drawdown: 3%
        );

        // Set Kelly Criterion parameters
        executor.setKellyParameters(
            7500, // 75% win rate
            0.05 ether, // 0.05 MATIC avg win
            0.02 ether, // 0.02 MATIC avg loss
            5000 // 50% fractional Kelly
        );

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===");
        console.log("MEVExecutor deployed at:", address(executor));
        console.log("\nAdd this to your .env file:");
        console.log("MEV_EXECUTOR_ADDRESS=%s", address(executor));
    }
}
