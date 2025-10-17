// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test} from "forge-std/Test.sol";

// Import every generated artifact so compilation fails when any file is missing.
import {MEVExecutor} from "../src/generated/MEVExecutor.sol";
import {DEXAdapter} from "../src/generated/DEXAdapter.sol";
import {AaveAdapter} from "../src/generated/AaveAdapter.sol";
import {JITAdapter} from "../src/generated/JITAdapter.sol";
import {OracleLib} from "../src/generated/OracleLib.sol";

contract GeneratedContractsPresenceTest is Test {
    function testGeneratedContractsCompile() external pure {
        bytes memory executorBytecode = type(MEVExecutor).creationCode;
        require(executorBytecode.length > 0, "executor");

        DEXAdapter.RouteCandidate[] memory candidates;
        require(candidates.length == 0, "routes");

        AaveAdapter.LiquidationQuote memory quote;
        require(!quote.profitable, "quote");

        JITAdapter.PositionConfig memory config;
        require(config.token0 == address(0), "config");

        bytes4 oracleSelector = OracleLib.OracleResponseInvalid.selector;
        require(oracleSelector != bytes4(0), "oracle");
    }
}
