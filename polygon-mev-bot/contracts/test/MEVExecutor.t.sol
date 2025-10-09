// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import "../src/MEVExecutor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MEVExecutorTest is Test {
    MEVExecutor public executor;
    address public constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
    address public constant USDC = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;

    address public owner;

    function setUp() public {
        // Fork Polygon mainnet
        vm.createSelectFork(vm.envString("POLYGON_RPC_URL"));

        owner = address(this);
        executor = new MEVExecutor(BALANCER_VAULT);

        // Fund the executor
        vm.deal(address(executor), 100 ether);
    }

    function testDeployment() public {
        assertEq(executor.BALANCER_VAULT(), BALANCER_VAULT);
        assertEq(executor.owner(), owner);
        assertFalse(executor.circuitBreaker().isPaused);
    }

    function testCircuitBreakerConfiguration() public {
        executor.setCircuitBreaker(0.02 ether, 0.2 ether, 10 ether, 500);

        MEVExecutor.CircuitBreaker memory cb = executor.circuitBreaker();
        assertEq(cb.minProfitThreshold, 0.02 ether);
        assertEq(cb.maxLossPerTx, 0.2 ether);
        assertEq(cb.dailyLossLimit, 10 ether);
        assertEq(cb.drawdownThreshold, 500);
    }

    function testKellyParameters() public {
        executor.setKellyParameters(8000, 0.1 ether, 0.03 ether, 6000);

        MEVExecutor.KellyParameters memory kelly = executor.kellyParams();
        assertEq(kelly.winRate, 8000);
        assertEq(kelly.avgWin, 0.1 ether);
        assertEq(kelly.avgLoss, 0.03 ether);
        assertEq(kelly.fractionalKelly, 6000);
    }

    function testOracleRegistration() public {
        address mockOracle = address(0x123);
        executor.registerOracle(WMATIC, mockOracle);

        assertEq(executor.priceOracles(WMATIC), mockOracle);
    }

    function testDEXApproval() public {
        address dex = address(0x456);
        executor.approveDEX(dex, true);

        assertTrue(executor.approvedDEXs(dex));
    }

    function testEmergencyPause() public {
        executor.emergencyPause();

        assertTrue(executor.circuitBreaker().isPaused);
    }

    function testUnpause() public {
        executor.emergencyPause();
        executor.unpause();

        assertFalse(executor.circuitBreaker().isPaused);
    }

    function testEmergencyWithdrawalTimelock() public {
        executor.initiateEmergencyWithdrawal();

        uint256 initiated = executor.emergencyWithdrawalInitiated();
        assertGt(initiated, 0);
        assertEq(initiated, block.timestamp);
    }

    function testCannotExecuteWithdrawalBeforeTimelock() public {
        executor.initiateEmergencyWithdrawal();

        vm.expectRevert();
        executor.executeEmergencyWithdrawal(WMATIC);
    }

    function testCanExecuteWithdrawalAfterTimelock() public {
        // Give executor some WMATIC
        deal(WMATIC, address(executor), 10 ether);

        executor.initiateEmergencyWithdrawal();

        // Fast forward 24 hours
        vm.warp(block.timestamp + 24 hours + 1);

        uint256 balanceBefore = IERC20(WMATIC).balanceOf(owner);
        executor.executeEmergencyWithdrawal(WMATIC);
        uint256 balanceAfter = IERC20(WMATIC).balanceOf(owner);

        assertEq(balanceAfter - balanceBefore, 10 ether);
    }

    function testWithdrawProfit() public {
        // Give executor some USDC
        deal(USDC, address(executor), 1000e6); // 1000 USDC

        uint256 balanceBefore = IERC20(USDC).balanceOf(owner);
        executor.withdrawProfit(USDC, 500e6);
        uint256 balanceAfter = IERC20(USDC).balanceOf(owner);

        assertEq(balanceAfter - balanceBefore, 500e6);
    }

    function testGetStats() public {
        MEVExecutor.ExecutionStats memory stats = executor.getStats();

        assertEq(stats.totalExecutions, 0);
        assertEq(stats.successfulExecutions, 0);
        assertEq(stats.totalProfit, 0);
    }

    function testSharpeRatioWhenNoExecutions() public {
        uint256 sharpe = executor.getSharpeRatio();
        assertEq(sharpe, 0);
    }

    function testOnlyOwnerCanPause() public {
        address notOwner = address(0x999);
        vm.prank(notOwner);

        vm.expectRevert("Ownable: caller is not the owner");
        executor.emergencyPause();
    }

    function testOnlyOwnerCanWithdraw() public {
        address notOwner = address(0x999);
        vm.prank(notOwner);

        vm.expectRevert("Ownable: caller is not the owner");
        executor.withdrawProfit(WMATIC, 1 ether);
    }

    function testReceiveETH() public {
        uint256 balanceBefore = address(executor).balance;
        (bool success, ) = address(executor).call{value: 1 ether}("");
        assertTrue(success);

        uint256 balanceAfter = address(executor).balance;
        assertEq(balanceAfter - balanceBefore, 1 ether);
    }
}
