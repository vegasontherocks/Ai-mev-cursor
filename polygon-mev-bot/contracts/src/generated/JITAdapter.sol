// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {INonfungiblePositionManager} from "./Interfaces.sol";

/// @title JITAdapter
/// @notice Lightweight helpers for managing temporary Uniswap V3 liquidity positions.
/// @dev The adapter keeps arithmetic deterministic and avoids external dependencies so
///      Foundry tests can exercise executor wiring without requiring full JIT logic.
library JITAdapter {
    int24 internal constant MIN_TICK = -887_272;
    int24 internal constant MAX_TICK = 887_272;

    /// @notice Maps pool fee tiers to canonical tick spacing multipliers.
    function tickSpacingForFee(uint24 fee) internal pure returns (int24) {
        if (fee == 100) return 1;
        if (fee == 500) return 10;
        if (fee == 3_000) return 60;
        if (fee == 10_000) return 200;
        revert("fee");
    }

    struct PositionConfig {
        address token0;
        address token1;
        int24 tickLower;
        int24 tickUpper;
        uint24 fee;
        uint256 amount0;
        uint256 amount1;
    }

    struct MintResult {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0;
        uint256 amount1;
    }

    /// @notice Returns a symmetric range around the current tick constrained by spacing and bounds.
    function computeCenteredRange(int24 currentTick, int24 tickSpacing, int24 halfWidth)
        internal
        pure
        returns (int24 lower, int24 upper)
    {
        int24 center = nearestUsableTick(currentTick, tickSpacing);
        int24 spacedHalfSteps = halfWidth / tickSpacing;
        int24 spacedHalf = spacedHalfSteps * tickSpacing;
        if (spacedHalf <= 0) {
            spacedHalf = tickSpacing;
        }
        lower = clampTick(center - spacedHalf);
        upper = clampTick(center + spacedHalf);
        if (upper <= lower) {
            upper = clampTick(lower + tickSpacing);
        }
    }

    /// @notice Validates that the provided ticks form a valid position for the given spacing.
    function validateTickRange(int24 tickLower, int24 tickUpper, int24 tickSpacing) internal pure {
        require(tickLower < tickUpper, "range");
        int24 lowerQuotient = tickLower / tickSpacing;
        int24 upperQuotient = tickUpper / tickSpacing;
        int24 lowerAligned = lowerQuotient * tickSpacing;
        int24 upperAligned = upperQuotient * tickSpacing;
        require(lowerAligned == tickLower, "lower-spacing");
        require(upperAligned == tickUpper, "upper-spacing");
        require(tickLower >= MIN_TICK && tickUpper <= MAX_TICK, "bounds");
    }

    /// @notice Computes the nearest usable tick respecting pool spacing.
    function nearestUsableTick(int24 tick, int24 tickSpacing) internal pure returns (int24) {
        require(tickSpacing > 0, "tickSpacing=0");
        int24 quotient = tick / tickSpacing;
        int24 rounded = quotient * tickSpacing;
        if (tick >= 0) {
            return rounded;
        }
        if (rounded < 0 && (tick % tickSpacing) != 0) {
            rounded -= tickSpacing;
        }
        return rounded;
    }

    /// @notice Clamps ticks into the allowed global range.
    function clampTick(int24 tick) internal pure returns (int24) {
        if (tick < MIN_TICK) return MIN_TICK;
        if (tick > MAX_TICK) return MAX_TICK;
        return tick;
    }

    /// @notice Mints a temporary concentrated liquidity position.
    function mintPosition(INonfungiblePositionManager manager, PositionConfig memory config, address recipient)
        internal
        returns (MintResult memory result)
    {
        require(config.token0 != address(0) && config.token1 != address(0), "token=0");
        validateTickRange(config.tickLower, config.tickUpper, tickSpacingForFee(config.fee));
        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: config.token0,
            token1: config.token1,
            fee: config.fee,
            tickLower: clampTick(config.tickLower),
            tickUpper: clampTick(config.tickUpper),
            amount0Desired: config.amount0,
            amount1Desired: config.amount1,
            amount0Min: 0,
            amount1Min: 0,
            recipient: recipient,
            deadline: block.timestamp
        });

        // Manager expects token ordering handled externally; callers should ensure
        // token0/token1 ordering before invoking this helper.
        (result.tokenId, result.liquidity, result.amount0, result.amount1) = manager.mint(params);
    }

    /// @notice Withdraws liquidity and collects accrued fees in a single step.
    function withdrawPosition(INonfungiblePositionManager manager, uint256 tokenId, uint128 liquidity)
        internal
        returns (uint256 amount0, uint256 amount1)
    {
        if (liquidity > 0) {
            INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseParams = INonfungiblePositionManager
                .DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: liquidity,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            });
            (amount0, amount1) = manager.decreaseLiquidity(decreaseParams);
        }

        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager.CollectParams({
            tokenId: tokenId,
            recipient: address(this),
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        });
        (uint256 collected0, uint256 collected1) = manager.collect(collectParams);
        amount0 += collected0;
        amount1 += collected1;
    }
}
