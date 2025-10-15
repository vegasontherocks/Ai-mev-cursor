// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { IPool } from "./Interfaces.sol";

/// @title AaveAdapter
/// @notice Utility helpers for inspecting and triggering Aave V3 liquidations on Polygon.
/// @dev The real production logic should perform deeper profitability analysis. These
///      helpers keep unit tests compiling while surfacing the data needed for higher
///      level decision making.
library AaveAdapter {
    uint256 internal constant HEALTHY_HEALTH_FACTOR = 1e18; // 1.0 wad
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    struct AccountSnapshot {
        uint256 totalCollateralBase;
        uint256 totalDebtBase;
        uint256 availableBorrowsBase;
        uint256 currentLiquidationThreshold;
        uint256 ltv;
        uint256 healthFactor;
    }

    struct LiquidationParams {
        uint256 closeFactorBps;        // Portion of the debt that can be repaid
        uint256 liquidationBonusBps;   // Bonus on collateral expressed in basis points
        uint256 minProfitBase;         // Minimum expected profit in Aave base currency
    }

    struct LiquidationQuote {
        uint256 debtToCoverBase;
        uint256 collateralValueBase;
        uint256 profitBase;
        bool profitable;
    }

    /// @notice Reads the current account metrics from the lending pool.
    function getAccountSnapshot(IPool pool, address user)
        internal
        view
        returns (AccountSnapshot memory snapshot)
    {
        (
            snapshot.totalCollateralBase,
            snapshot.totalDebtBase,
            snapshot.availableBorrowsBase,
            snapshot.currentLiquidationThreshold,
            snapshot.ltv,
            snapshot.healthFactor
        ) = pool.getUserAccountData(user);
    }

    /// @notice Returns true when the account is below the protocol liquidation threshold.
    function isLiquidatable(AccountSnapshot memory snapshot) internal pure returns (bool) {
        return snapshot.healthFactor < HEALTHY_HEALTH_FACTOR && snapshot.totalDebtBase > 0;
    }

    /// @notice Helper that fetches the snapshot and instantly reports liquidation status.
    function canLiquidate(IPool pool, address user) internal view returns (bool) {
        AccountSnapshot memory snapshot = getAccountSnapshot(pool, user);
        return isLiquidatable(snapshot);
    }

    /// @notice Quotes the maximum liquidatable debt and estimated profit given configuration.
    function quoteLiquidation(AccountSnapshot memory snapshot, LiquidationParams memory params)
        internal
        pure
        returns (LiquidationQuote memory quote)
    {
        require(params.closeFactorBps > 0 && params.closeFactorBps <= BPS_DENOMINATOR, "closeFactor");
        require(params.liquidationBonusBps >= BPS_DENOMINATOR, "bonus");

        if (!isLiquidatable(snapshot)) {
            return quote;
        }

        uint256 debtToCover = (snapshot.totalDebtBase * params.closeFactorBps) / BPS_DENOMINATOR;
        if (debtToCover == 0) {
            return quote;
        }

        uint256 collateralValue = (debtToCover * params.liquidationBonusBps) / BPS_DENOMINATOR;
        uint256 profit = collateralValue > debtToCover ? collateralValue - debtToCover : 0;

        quote.debtToCoverBase = debtToCover;
        quote.collateralValueBase = collateralValue;
        quote.profitBase = profit;
        quote.profitable = profit >= params.minProfitBase && collateralValue <= snapshot.totalCollateralBase;
    }

    /// @notice Executes the actual liquidation call.
    function liquidate(
        IPool pool,
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) internal {
        pool.liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken);
    }
}
