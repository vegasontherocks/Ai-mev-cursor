// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { AggregatorV3Interface } from "./Interfaces.sol";

/// @title OracleLib
/// @notice Chainlink-oriented validation helpers to defend against stale or manipulated prices.
/// @dev The library normalises answers to 18 decimals so downstream math is consistent.
library OracleLib {
    uint256 internal constant DEFAULT_MAX_STALENESS = 1 hours;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    error OracleResponseInvalid();
    error OraclePriceStale(uint256 updatedAt, uint256 threshold);
    error OracleDeviationTooHigh(uint256 oraclePrice, uint256 spotPrice, uint256 maxDeviationBps);

    /// @notice Fetches the latest Chainlink price and ensures it is fresh and positive.
    function readPrice(AggregatorV3Interface feed) internal view returns (uint256 price) {
        return readPrice(feed, DEFAULT_MAX_STALENESS);
    }

    /// @notice Fetches the latest price with a custom max staleness window.
    function readPrice(
        AggregatorV3Interface feed,
        uint256 maxStaleness
    ) internal view returns (uint256 price) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        if (answer <= 0 || answeredInRound < roundId) revert OracleResponseInvalid();
        if (updatedAt == 0) revert OracleResponseInvalid();
        if (block.timestamp - updatedAt > maxStaleness) {
            revert OraclePriceStale(updatedAt, maxStaleness);
        }

        price = _normalise(answer, feed.decimals());
    }

    /// @notice Verifies that the DEX spot price matches the oracle price within a deviation budget.
    function validateDeviation(
        uint256 oraclePrice,
        uint256 spotPrice,
        uint256 maxDeviationBps
    ) internal pure {
        if (oraclePrice == 0 || spotPrice == 0) revert OracleResponseInvalid();
        uint256 diff = oraclePrice > spotPrice ? oraclePrice - spotPrice : spotPrice - oraclePrice;
        uint256 allowed = (oraclePrice * maxDeviationBps) / BPS_DENOMINATOR;
        if (diff > allowed) {
            revert OracleDeviationTooHigh(oraclePrice, spotPrice, maxDeviationBps);
        }
    }

    function _normalise(int256 answer, uint8 decimals_) private pure returns (uint256) {
        require(answer > 0, "answer<=0");
        uint256 unsignedAnswer = uint256(answer);
        if (decimals_ == 18) {
            return unsignedAnswer;
        }
        if (decimals_ < 18) {
            uint256 factor = 10 ** (18 - decimals_);
            return unsignedAnswer * factor;
        }
        uint256 divisor = 10 ** (decimals_ - 18);
        return unsignedAnswer / divisor;
    }
}
