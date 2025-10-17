// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test} from "forge-std/Test.sol";
import {AaveAdapter} from "../src/generated/AaveAdapter.sol";

contract AaveAdapterHarness {
    function quote(AaveAdapter.AccountSnapshot memory snapshot, AaveAdapter.LiquidationParams memory params)
        external
        pure
        returns (AaveAdapter.LiquidationQuote memory)
    {
        return AaveAdapter.quoteLiquidation(snapshot, params);
    }

    function liquidatable(AaveAdapter.AccountSnapshot memory snapshot) external pure returns (bool) {
        return AaveAdapter.isLiquidatable(snapshot);
    }
}

contract AaveAdapterTest is Test {
    AaveAdapterHarness internal harness;

    function setUp() public {
        harness = new AaveAdapterHarness();
    }

    function testRecognisesUnhealthyPosition() public view {
        AaveAdapter.AccountSnapshot memory snapshot = _buildSnapshot(5 ether, 3 ether, 0.8 ether, 9e17);
        assertTrue(harness.liquidatable(snapshot));
    }

    function testHealthyPositionNotLiquidatable() public view {
        AaveAdapter.AccountSnapshot memory snapshot = _buildSnapshot(5 ether, 3 ether, 0.8 ether, 11e17);
        assertFalse(harness.liquidatable(snapshot));
    }

    function testQuoteLiquidationReturnsProfit() public view {
        AaveAdapter.AccountSnapshot memory snapshot = _buildSnapshot(8 ether, 6 ether, 0, 8e17);
        AaveAdapter.LiquidationParams memory params = AaveAdapter.LiquidationParams({
            closeFactorBps: 5_000,
            liquidationBonusBps: 10_500,
            minProfitBase: 0.1 ether
        });

        AaveAdapter.LiquidationQuote memory quote = harness.quote(snapshot, params);

        uint256 expectedDebtToCover = (snapshot.totalDebtBase * params.closeFactorBps) / 10_000;
        uint256 expectedCollateral = (expectedDebtToCover * params.liquidationBonusBps) / 10_000;

        assertEq(quote.debtToCoverBase, expectedDebtToCover);
        assertEq(quote.collateralValueBase, expectedCollateral);
        assertEq(quote.profitBase, expectedCollateral - expectedDebtToCover);
        assertTrue(quote.profitable);
    }

    function testQuoteLiquidationBelowProfitThreshold() public view {
        AaveAdapter.AccountSnapshot memory snapshot = _buildSnapshot(4 ether, 3 ether, 0, 8e17);
        AaveAdapter.LiquidationParams memory params = AaveAdapter.LiquidationParams({
            closeFactorBps: 5_000,
            liquidationBonusBps: 10_100,
            minProfitBase: 0.2 ether
        });

        AaveAdapter.LiquidationQuote memory quote = harness.quote(snapshot, params);
        assertFalse(quote.profitable);
    }

    function _buildSnapshot(uint256 collateral, uint256 debt, uint256 availableBorrow, uint256 healthFactor)
        internal
        pure
        returns (AaveAdapter.AccountSnapshot memory snapshot)
    {
        snapshot.totalCollateralBase = collateral;
        snapshot.totalDebtBase = debt;
        snapshot.availableBorrowsBase = availableBorrow;
        snapshot.currentLiquidationThreshold = 0;
        snapshot.ltv = 0;
        snapshot.healthFactor = healthFactor;
        return snapshot;
    }
}
