// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { IQuoter, ISwapRouter, IUniswapV2Pair, IUniswapV2Router02 } from "./Interfaces.sol";

/// @title DEXAdapter
/// @notice Deterministic helpers for quoting and executing Polygon DEX routes.
library DEXAdapter {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    error InvalidPath();
    error SlippageExceeded(uint256 expectedMin, uint256 actualOut);
    error FeeTooHigh();
    error TokenMismatch();
    error NoProfitableRoute();
    error GasCostOverflow();
    error ValueTooLarge();

    struct V2Hop {
        address pair;
        address tokenIn;
        address tokenOut;
        uint24 feeBps;
    }

    struct RouteCandidate {
        uint256 amountOut;
        uint256 estimatedGas;
        address router;
    }

    function getAmountOutV2(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeBasisPoints
    ) internal pure returns (uint256) {
        if (amountIn == 0) revert InvalidPath();
        if (reserveIn == 0 || reserveOut == 0) revert InvalidPath();
        if (feeBasisPoints >= BPS_DENOMINATOR) revert FeeTooHigh();

        uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - feeBasisPoints);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * BPS_DENOMINATOR + amountInWithFee;
        return numerator / denominator;
    }

    function quoteV2Route(V2Hop[] memory hops, uint256 amountIn) internal view returns (uint256 amountOut) {
        if (hops.length == 0) revert InvalidPath();
        amountOut = amountIn;
        for (uint256 i = 0; i < hops.length; i++) {
            V2Hop memory hop = hops[i];
            if (hop.pair == address(0) || hop.tokenIn == address(0) || hop.tokenOut == address(0)) {
                revert InvalidPath();
            }
            (uint256 reserveIn, uint256 reserveOut) = fetchReserves(hop.pair, hop.tokenIn, hop.tokenOut);
            amountOut = getAmountOutV2(amountOut, reserveIn, reserveOut, hop.feeBps);
            if (amountOut == 0) revert SlippageExceeded(1, 0);
        }
    }

    function fetchReserves(address pair, address tokenIn, address tokenOut)
        internal
        view
        returns (uint256 reserveIn, uint256 reserveOut)
    {
        IUniswapV2Pair pool = IUniswapV2Pair(pair);
        address token0 = pool.token0();
        address token1 = pool.token1();
        (uint112 reserve0, uint112 reserve1, ) = pool.getReserves();

        if (tokenIn == token0 && tokenOut == token1) {
            reserveIn = reserve0;
            reserveOut = reserve1;
        } else if (tokenIn == token1 && tokenOut == token0) {
            reserveIn = reserve1;
            reserveOut = reserve0;
        } else {
            revert TokenMismatch();
        }
    }

    function swapExactTokensForTokensV2(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin
    ) internal returns (uint256 amountOut) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        return swapExactTokensForTokensV2(router, path, amountIn, amountOutMin);
    }

    function swapExactTokensForTokensV2(
        address router,
        address[] memory path,
        uint256 amountIn,
        uint256 amountOutMin
    ) internal returns (uint256 amountOut) {
        if (path.length < 2) revert InvalidPath();
        uint256[] memory amounts = IUniswapV2Router02(router).swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            address(this),
            block.timestamp
        );

        amountOut = amounts[amounts.length - 1];
        if (amountOut < amountOutMin) revert SlippageExceeded(amountOutMin, amountOut);
    }

    function swapExactTokensForTokensV3(
        address router,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMin
    ) internal returns (uint256 amountOut) {
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0
        });

        amountOut = ISwapRouter(router).exactInputSingle(params);
        if (amountOut < amountOutMin) revert SlippageExceeded(amountOutMin, amountOut);
    }

    function swapExactTokensForTokensV3(
        address router,
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMin
    ) internal returns (uint256 amountOut) {
        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin
        });

        amountOut = ISwapRouter(router).exactInput(params);
        if (amountOut < amountOutMin) revert SlippageExceeded(amountOutMin, amountOut);
    }

    function quoteSingleHopV3(
        address quoter,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    ) internal returns (uint256) {
        return IQuoter(quoter).quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
    }

    function quoteV3Route(address quoter, bytes memory path, uint256 amountIn) internal returns (uint256 amountOut) {
        amountOut = IQuoter(quoter).quoteExactInput(path, amountIn);
        if (amountOut == 0) revert SlippageExceeded(1, 0);
    }

    function selectBestRoute(RouteCandidate[] memory candidates, uint256 gasPriceWei)
        internal
        pure
        returns (uint256 bestIndex, int256 bestNetOut)
    {
        if (candidates.length == 0) revert NoProfitableRoute();

        bool found;
        int256 currentBest = type(int256).min;

        for (uint256 i = 0; i < candidates.length; i++) {
            RouteCandidate memory candidate = candidates[i];
            if (candidate.amountOut == 0) continue;

            if (candidate.amountOut > uint256(type(int256).max)) revert ValueTooLarge();

            uint256 cost = candidate.estimatedGas * gasPriceWei;
            if (candidate.estimatedGas != 0 && cost / candidate.estimatedGas != gasPriceWei) {
                revert GasCostOverflow();
            }
            if (cost > uint256(type(int256).max)) revert ValueTooLarge();

            int256 net = int256(candidate.amountOut) - int256(cost);
            if (!found || net > currentBest) {
                currentBest = net;
                bestIndex = i;
                found = true;
            }
        }

        if (!found || currentBest <= 0) revert NoProfitableRoute();
        return (bestIndex, currentBest);
    }
}
