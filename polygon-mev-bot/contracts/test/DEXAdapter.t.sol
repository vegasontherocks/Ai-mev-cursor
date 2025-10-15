// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Test } from "forge-std/Test.sol";
import { DEXAdapter } from "../src/generated/DEXAdapter.sol";
import { IQuoter, IUniswapV2Pair } from "../src/generated/Interfaces.sol";

contract DEXAdapterHarness {
    function computeAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeBps
    ) external pure returns (uint256) {
        return DEXAdapter.getAmountOutV2(amountIn, reserveIn, reserveOut, feeBps);
    }

    function quoteV2(DEXAdapter.V2Hop[] memory hops, uint256 amountIn) external view returns (uint256) {
        return DEXAdapter.quoteV2Route(hops, amountIn);
    }

    function quoteV3(address quoter, bytes memory path, uint256 amountIn) external returns (uint256) {
        return DEXAdapter.quoteV3Route(quoter, path, amountIn);
    }

    function selectBest(DEXAdapter.RouteCandidate[] memory candidates, uint256 gasPriceWei)
        external
        pure
        returns (uint256, int256)
    {
        return DEXAdapter.selectBestRoute(candidates, gasPriceWei);
    }
}

contract MockPair is IUniswapV2Pair {
    address public override token0;
    address public override token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setReserves(uint112 reserve0_, uint112 reserve1_) external {
        reserve0 = reserve0_;
        reserve1 = reserve1_;
        blockTimestampLast = uint32(block.timestamp);
    }

    function getReserves()
        external
        view
        override
        returns (uint112 reserve0_, uint112 reserve1_, uint32 blockTimestampLast_)
    {
        reserve0_ = reserve0;
        reserve1_ = reserve1;
        blockTimestampLast_ = blockTimestampLast;
    }

    function price0CumulativeLast() external pure override returns (uint256) {
        return 0;
    }

    function price1CumulativeLast() external pure override returns (uint256) {
        return 0;
    }
}

contract MockQuoter is IQuoter {
    mapping(bytes => uint256) private exactInputQuotes;
    mapping(bytes32 => uint256) private singleQuotes;

    uint256 public lastExactInputAmount;
    uint256 public lastExactInputSingleAmount;

    function setExactInputQuote(bytes memory path, uint256 amountOut) external {
        exactInputQuotes[path] = amountOut;
    }

    function setExactInputSingleQuote(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut
    ) external {
        bytes32 key = keccak256(abi.encode(tokenIn, tokenOut, fee, amountIn));
        singleQuotes[key] = amountOut;
    }

    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160
    ) external override returns (uint256 amountOut) {
        bytes32 key = keccak256(abi.encode(tokenIn, tokenOut, fee, amountIn));
        lastExactInputSingleAmount = amountIn;
        amountOut = singleQuotes[key];
        require(amountOut != 0, "quote-missing");
    }

    function quoteExactInput(bytes memory path, uint256 amountIn) external override returns (uint256 amountOut) {
        lastExactInputAmount = amountIn;
        amountOut = exactInputQuotes[path];
        require(amountOut != 0, "quote-missing");
    }
}

contract DEXAdapterTest is Test {
    DEXAdapterHarness internal harness;
    MockPair internal pairAb;
    MockPair internal pairBc;
    MockQuoter internal quoter;

    address internal constant TOKEN_A = address(0xA11CE);
    address internal constant TOKEN_B = address(0xB0B);
    address internal constant TOKEN_C = address(0xC0FFEE);

    function setUp() public {
        harness = new DEXAdapterHarness();
        pairAb = new MockPair(TOKEN_A, TOKEN_B);
        pairBc = new MockPair(TOKEN_B, TOKEN_C);
        quoter = new MockQuoter();

        pairAb.setReserves(uint112(1_000 ether), uint112(1_500 ether));
        pairBc.setReserves(uint112(500 ether), uint112(2_000 ether));
    }

    function testGetAmountOutMatchesManualCalculation() public view {
        uint256 amountIn = 10 ether;
        uint256 feeBps = 30;
        uint256 numerator = amountIn * (10_000 - feeBps);
        numerator = numerator * 1_500 ether;
        uint256 denominator = 1_000 ether * 10_000;
        denominator += amountIn * (10_000 - feeBps);

        uint256 direct = harness.computeAmountOut(amountIn, 1_000 ether, 1_500 ether, feeBps);
        uint256 manual = numerator / denominator;

        assertEq(direct, manual);
    }

    function testQuoteV2RouteSingleHop() public view {
        DEXAdapter.V2Hop[] memory hops = new DEXAdapter.V2Hop[](1);
        hops[0] = DEXAdapter.V2Hop({
            pair: address(pairAb),
            tokenIn: TOKEN_A,
            tokenOut: TOKEN_B,
            feeBps: 30
        });

        uint256 quote = harness.quoteV2(hops, 10 ether);
        uint256 expected = harness.computeAmountOut(10 ether, 1_000 ether, 1_500 ether, 30);
        assertEq(quote, expected);
    }

    function testQuoteV2RouteMultiHopAccumulates() public view {
        DEXAdapter.V2Hop[] memory hops = new DEXAdapter.V2Hop[](2);
        hops[0] = DEXAdapter.V2Hop({
            pair: address(pairAb),
            tokenIn: TOKEN_A,
            tokenOut: TOKEN_B,
            feeBps: 30
        });
        hops[1] = DEXAdapter.V2Hop({
            pair: address(pairBc),
            tokenIn: TOKEN_B,
            tokenOut: TOKEN_C,
            feeBps: 10
        });

        uint256 firstStep = harness.computeAmountOut(5 ether, 1_000 ether, 1_500 ether, 30);
        uint256 expected = harness.computeAmountOut(firstStep, 500 ether, 2_000 ether, 10);

        uint256 quote = harness.quoteV2(hops, 5 ether);
        assertEq(quote, expected);
    }

    function testQuoteV2RouteRevertsOnTokenMismatch() public {
        DEXAdapter.V2Hop[] memory hops = new DEXAdapter.V2Hop[](1);
        hops[0] = DEXAdapter.V2Hop({
            pair: address(pairAb),
            tokenIn: TOKEN_B,
            tokenOut: TOKEN_C,
            feeBps: 30
        });

        vm.expectRevert(DEXAdapter.TokenMismatch.selector);
        harness.quoteV2(hops, 1 ether);
    }

    function testQuoteV3RouteUsesQuoter() public {
        bytes memory path = abi.encodePacked(TOKEN_A, uint24(500), TOKEN_B, uint24(3_000), TOKEN_C);
        quoter.setExactInputQuote(path, 12 ether);

        uint256 amountOut = harness.quoteV3(address(quoter), path, 10 ether);
        assertEq(amountOut, 12 ether);
        assertEq(quoter.lastExactInputAmount(), 10 ether);
    }

    function testSelectBestRoutePrefersHighestNetAfterGas() public view {
        DEXAdapter.RouteCandidate[] memory candidates = new DEXAdapter.RouteCandidate[](3);
        candidates[0] = DEXAdapter.RouteCandidate({
            amountOut: 1 ether,
            estimatedGas: 300_000,
            router: address(0x1)
        });
        candidates[1] = DEXAdapter.RouteCandidate({
            amountOut: 1050 ether / 1000,
            estimatedGas: 600_000,
            router: address(0x2)
        });
        candidates[2] = DEXAdapter.RouteCandidate({
            amountOut: 1200 ether / 1000,
            estimatedGas: 800_000,
            router: address(0x3)
        });

        uint256 gasPrice = 50 gwei;
        uint256 expectedCost = candidates[2].estimatedGas * gasPrice;
        int256 expectedNet = int256(candidates[2].amountOut) - int256(expectedCost);

        (uint256 index, int256 net) = harness.selectBest(candidates, gasPrice);
        assertEq(index, 2);
        assertEq(net, expectedNet);
    }

    function testSelectBestRouteRevertsWhenNoProfit() public {
        DEXAdapter.RouteCandidate[] memory candidates = new DEXAdapter.RouteCandidate[](1);
        candidates[0] = DEXAdapter.RouteCandidate({
            amountOut: 1 ether / 100,
            estimatedGas: 600_000,
            router: address(this)
        });

        vm.expectRevert(DEXAdapter.NoProfitableRoute.selector);
        harness.selectBest(candidates, 30 gwei);
    }

    function testSelectBestRouteRevertsWhenEmpty() public {
        DEXAdapter.RouteCandidate[] memory candidates = new DEXAdapter.RouteCandidate[](0);
        vm.expectRevert(DEXAdapter.NoProfitableRoute.selector);
        harness.selectBest(candidates, 1);
    }
}
