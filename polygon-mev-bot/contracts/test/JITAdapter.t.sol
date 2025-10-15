// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Test } from "forge-std/Test.sol";
import { JITAdapter } from "../src/generated/JITAdapter.sol";
import { INonfungiblePositionManager } from "../src/generated/Interfaces.sol";

contract DummyPositionManager is INonfungiblePositionManager {
    uint256 private nextTokenId = 1;

    struct Position {
        address owner;
        uint256 amount0;
        uint256 amount1;
        uint128 liquidity;
        int24 tickLower;
        int24 tickUpper;
        uint24 fee;
    }

    mapping(uint256 => Position) public positions;

    function mint(MintParams calldata params)
        external
        payable
        override
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        tokenId = nextTokenId++;
        liquidity = uint128(params.amount0Desired + params.amount1Desired);
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;

        positions[tokenId] = Position({
            owner: msg.sender,
            amount0: amount0,
            amount1: amount1,
            liquidity: liquidity,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            fee: params.fee
        });
    }

    function collect(CollectParams calldata params)
        external
        payable
        override
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage position = positions[params.tokenId];
        require(position.owner == msg.sender, "owner");
        amount0 = position.amount0 / 10;
        amount1 = position.amount1 / 10;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        override
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage position = positions[params.tokenId];
        require(position.owner == msg.sender, "owner");
        require(position.liquidity >= params.liquidity, "liquidity");
        position.liquidity -= params.liquidity;
        amount0 = params.liquidity / 2;
        amount1 = params.liquidity / 2;
    }
}

contract JITAdapterHarness {
    function validate(int24 tickLower, int24 tickUpper, int24 tickSpacing) external pure {
        JITAdapter.validateTickRange(tickLower, tickUpper, tickSpacing);
    }
}

contract JITAdapterTest is Test {
    JITAdapterHarness private harness;

    function setUp() public {
        harness = new JITAdapterHarness();
    }

    function testComputeCenteredRangeRespectsSpacing() public pure {
        (int24 lower, int24 upper) = JITAdapter.computeCenteredRange(123, 10, 40);
        assertEq(lower % 10, 0);
        assertEq(upper % 10, 0);
        assertLt(lower, upper);
    }

    function testValidateTickRangeRevertsOnSpacing() public {
        vm.expectRevert("lower-spacing");
        harness.validate(11, 20, 10);
    }

    function testMintPositionValidatesRange() public {
        DummyPositionManager manager = new DummyPositionManager();
        JITAdapter.PositionConfig memory config = JITAdapter.PositionConfig({
            token0: address(0x1),
            token1: address(0x2),
            tickLower: -120,
            tickUpper: 120,
            fee: 3_000,
            amount0: 1 ether,
            amount1: 2 ether
        });

        JITAdapter.MintResult memory result = JITAdapter.mintPosition(manager, config, address(this));
        assertEq(result.amount0, config.amount0);
        assertEq(result.amount1, config.amount1);
        assertGt(result.tokenId, 0);
        assertGt(result.liquidity, 0);
    }

    function testWithdrawPositionAggregatesAmounts() public {
        DummyPositionManager manager = new DummyPositionManager();
        JITAdapter.PositionConfig memory config = JITAdapter.PositionConfig({
            token0: address(0x1),
            token1: address(0x2),
            tickLower: -60,
            tickUpper: 60,
            fee: 3_000,
            amount0: 2 ether,
            amount1: 2 ether
        });

        JITAdapter.MintResult memory minted = JITAdapter.mintPosition(manager, config, address(this));
        (uint256 amount0, uint256 amount1) = JITAdapter.withdrawPosition(manager, minted.tokenId, minted.liquidity);
        assertGt(amount0, 0);
        assertGt(amount1, 0);
    }
}
