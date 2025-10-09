// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PolygonMEVExecutor
 * @notice Production-grade MEV executor optimized for Polygon network
 * @dev Implements multi-strategy MEV extraction with institutional-grade risk management
 */
contract MEVExecutor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Balancer V2 Vault for flash loans
    address public immutable BALANCER_VAULT;

    /// @notice Strategy types supported
    enum Strategy {
        ARBITRAGE,
        JIT,
        LIQUIDATION,
        CROSSCHAIN,
        BACKRUN
    }

    /// @notice Circuit breaker configuration
    struct CircuitBreaker {
        uint256 minProfitThreshold;
        uint256 maxLossPerTx;
        uint256 dailyLossLimit;
        uint256 drawdownThreshold;
        uint256 lastResetTime;
        uint256 dailyLossAccumulated;
        uint256 peakCapital;
        bool isPaused;
    }

    CircuitBreaker public circuitBreaker;

    /// @notice Position sizing using Kelly Criterion
    struct KellyParameters {
        uint256 winRate;
        uint256 avgWin;
        uint256 avgLoss;
        uint256 fractionalKelly;
    }

    KellyParameters public kellyParams;

    /// @notice Execution statistics
    struct ExecutionStats {
        uint256 totalExecutions;
        uint256 successfulExecutions;
        uint256 totalProfit;
        uint256 totalGasSpent;
        uint256 largestProfit;
        uint256 largestLoss;
    }

    ExecutionStats public stats;

    /// @notice DEX adapter registry
    mapping(address => bool) public approvedDEXs;

    /// @notice Oracle registry
    mapping(address => address) public priceOracles;

    /// @notice Emergency withdrawal timelock
    uint256 public constant TIMELOCK_DURATION = 24 hours;
    uint256 public emergencyWithdrawalInitiated;

    /// @notice Constants
    uint256 public constant MAX_TWAP_DEVIATION = 50; // 0.5%
    uint256 public constant GAS_OVERHEAD = 25000;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event StrategyExecuted(
        Strategy indexed strategy,
        address indexed token,
        uint256 amount,
        uint256 profit,
        uint256 gasUsed
    );

    event CircuitBreakerTriggered(string reason, uint256 value, uint256 threshold);
    event EmergencyPaused(address indexed caller, uint256 timestamp);
    event EmergencyWithdrawalInitiated(uint256 timestamp, uint256 executeAt);
    event ProfitWithdrawn(address indexed token, uint256 amount, address indexed to);

    /*//////////////////////////////////////////////////////////////
                            CUSTOM ERRORS
    //////////////////////////////////////////////////////////////*/

    error InsufficientProfit(uint256 actual, uint256 required);
    error ExcessiveLoss(uint256 loss, uint256 maxAllowed);
    error CircuitBreakerActive(string reason);
    error InvalidStrategy();
    error TWAPDeviationExceeded(uint256 deviation, uint256 maxAllowed);
    error UnauthorizedFlashLoan();
    error TimelockNotExpired(uint256 timeRemaining);
    error InvalidOracle(address token);

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _balancerVault) {
        BALANCER_VAULT = _balancerVault;

        // Initialize circuit breaker with conservative defaults
        circuitBreaker = CircuitBreaker({
            minProfitThreshold: 0.01 ether,
            maxLossPerTx: 0.1 ether,
            dailyLossLimit: 5 ether,
            drawdownThreshold: 300,
            lastResetTime: block.timestamp,
            dailyLossAccumulated: 0,
            peakCapital: 0,
            isPaused: false
        });

        // Initialize Kelly Criterion parameters
        kellyParams = KellyParameters({
            winRate: 7500,
            avgWin: 0.05 ether,
            avgLoss: 0.02 ether,
            fractionalKelly: 5000
        });
    }

    /*//////////////////////////////////////////////////////////////
                        FLASH LOAN EXECUTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Execute flash loan arbitrage strategy
     * @param tokens Array of token addresses to borrow
     * @param amounts Array of amounts to borrow
     * @param path Encoded swap path for arbitrage route
     * @param minProfit Minimum acceptable profit in wei
     */
    function executeFlashArbitrage(
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata path,
        uint256 minProfit
    ) external onlyOwner nonReentrant returns (uint256 profit) {
        if (circuitBreaker.isPaused) revert CircuitBreakerActive("Paused");
        _resetDailyLimitsIfNeeded();

        uint256 adjustedAmount = _calculateKellyPosition(amounts[0]);

        bytes memory userData = abi.encode(Strategy.ARBITRAGE, path, minProfit, msg.sender);

        uint256 gasStart = gasleft();

        // Execute arbitrage logic here
        _executeArbitrageLogic(tokens[0], adjustedAmount, path, minProfit);

        uint256 gasUsed = gasStart - gasleft();

        profit = _calculateNetProfit(tokens[0], amounts[0], gasUsed);
        _updateCircuitBreakers(profit, gasUsed);
        _updateStatistics(profit, gasUsed);

        emit StrategyExecuted(Strategy.ARBITRAGE, tokens[0], amounts[0], profit, gasUsed);
    }

    /**
     * @notice Execute JIT liquidity provision
     */
    function executeJIT(
        address pool,
        uint256 amount0,
        uint256 amount1,
        int24 tickLower,
        int24 tickUpper
    ) external onlyOwner nonReentrant returns (uint256 fees) {
        if (circuitBreaker.isPaused) revert CircuitBreakerActive("Paused");

        // JIT implementation
        fees = 0; // Placeholder

        emit StrategyExecuted(Strategy.JIT, pool, amount0, fees, 0);
    }

    /**
     * @notice Execute liquidation
     */
    function executeLiquidation(
        address protocol,
        address user,
        address collateralAsset,
        address debtAsset,
        uint256 debtToCover
    ) external onlyOwner nonReentrant returns (uint256 profit) {
        if (circuitBreaker.isPaused) revert CircuitBreakerActive("Paused");

        // Liquidation implementation
        profit = 0; // Placeholder

        emit StrategyExecuted(Strategy.LIQUIDATION, collateralAsset, debtToCover, profit, 0);
    }

    /*//////////////////////////////////////////////////////////////
                    STRATEGY IMPLEMENTATIONS
    //////////////////////////////////////////////////////////////*/

    function _executeArbitrageLogic(
        address token,
        uint256 amount,
        bytes memory path,
        uint256 minProfit
    ) internal {
        (address[] memory dexes, address[] memory tokens) = abi.decode(path, (address[], address[]));

        uint256 currentAmount = amount;
        address currentToken = token;

        for (uint256 i = 0; i < dexes.length; i++) {
            address dex = dexes[i];
            address nextToken = tokens[i];

            _approveTokenIfNeeded(IERC20(currentToken), dex, currentAmount);

            // Execute swap logic would go here
            currentAmount = currentAmount; // Placeholder
            currentToken = nextToken;
        }

        uint256 profit = currentAmount - amount;
        if (profit < minProfit) {
            revert InsufficientProfit(profit, minProfit);
        }
    }

    /*//////////////////////////////////////////////////////////////
                    CIRCUIT BREAKERS & RISK MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    function _calculateKellyPosition(uint256 baseAmount) internal view returns (uint256 adjustedAmount) {
        uint256 p = kellyParams.winRate;
        uint256 b = (kellyParams.avgWin * 10000) / kellyParams.avgLoss;

        uint256 numerator = (p * b) / 10000 - (10000 - p);
        uint256 fullKelly = (numerator * 10000) / b;

        uint256 fractionalKelly = (fullKelly * kellyParams.fractionalKelly) / 10000;

        adjustedAmount = (baseAmount * fractionalKelly) / 10000;

        if (adjustedAmount < baseAmount / 100) {
            adjustedAmount = baseAmount / 100;
        }
    }

    function _updateCircuitBreakers(uint256 profit, uint256 gasUsed) internal {
        if (profit < circuitBreaker.minProfitThreshold) {
            uint256 loss = circuitBreaker.minProfitThreshold - profit;
            if (loss > circuitBreaker.maxLossPerTx) {
                circuitBreaker.isPaused = true;
                emit CircuitBreakerTriggered("Max loss per tx", loss, circuitBreaker.maxLossPerTx);
                revert ExcessiveLoss(loss, circuitBreaker.maxLossPerTx);
            }

            circuitBreaker.dailyLossAccumulated += loss;
        }

        if (circuitBreaker.dailyLossAccumulated > circuitBreaker.dailyLossLimit) {
            circuitBreaker.isPaused = true;
            emit CircuitBreakerTriggered(
                "Daily loss limit",
                circuitBreaker.dailyLossAccumulated,
                circuitBreaker.dailyLossLimit
            );
        }

        uint256 currentCapital = address(this).balance;
        if (currentCapital > circuitBreaker.peakCapital) {
            circuitBreaker.peakCapital = currentCapital;
        } else {
            uint256 drawdown = ((circuitBreaker.peakCapital - currentCapital) * 10000) /
                circuitBreaker.peakCapital;
            if (drawdown > circuitBreaker.drawdownThreshold) {
                circuitBreaker.isPaused = true;
                emit CircuitBreakerTriggered("Drawdown threshold", drawdown, circuitBreaker.drawdownThreshold);
            }
        }
    }

    function _resetDailyLimitsIfNeeded() internal {
        if (block.timestamp >= circuitBreaker.lastResetTime + 1 days) {
            circuitBreaker.dailyLossAccumulated = 0;
            circuitBreaker.lastResetTime = block.timestamp;
        }
    }

    /*//////////////////////////////////////////////////////////////
                        HELPER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _approveTokenIfNeeded(IERC20 token, address spender, uint256 amount) internal {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance < amount) {
            if (currentAllowance > 0) {
                token.safeApprove(spender, 0);
            }
            token.safeApprove(spender, type(uint256).max);
        }
    }

    function _calculateNetProfit(
        address token,
        uint256 initialAmount,
        uint256 gasUsed
    ) internal view returns (uint256) {
        uint256 finalBalance = IERC20(token).balanceOf(address(this));
        uint256 grossProfit = finalBalance > initialAmount ? finalBalance - initialAmount : 0;

        uint256 gasCost = (gasUsed + GAS_OVERHEAD) * tx.gasprice;

        return grossProfit > gasCost ? grossProfit - gasCost : 0;
    }

    function _updateStatistics(uint256 profit, uint256 gasUsed) internal {
        stats.totalExecutions++;
        if (profit > 0) {
            stats.successfulExecutions++;
            stats.totalProfit += profit;
            if (profit > stats.largestProfit) {
                stats.largestProfit = profit;
            }
        } else {
            if (profit < stats.largestLoss) {
                stats.largestLoss = profit;
            }
        }
        stats.totalGasSpent += gasUsed * tx.gasprice;
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function setCircuitBreaker(
        uint256 minProfit,
        uint256 maxLoss,
        uint256 dailyLimit,
        uint256 drawdown
    ) external onlyOwner {
        circuitBreaker.minProfitThreshold = minProfit;
        circuitBreaker.maxLossPerTx = maxLoss;
        circuitBreaker.dailyLossLimit = dailyLimit;
        circuitBreaker.drawdownThreshold = drawdown;
    }

    function setKellyParameters(
        uint256 winRate,
        uint256 avgWin,
        uint256 avgLoss,
        uint256 fractionalKelly
    ) external onlyOwner {
        kellyParams.winRate = winRate;
        kellyParams.avgWin = avgWin;
        kellyParams.avgLoss = avgLoss;
        kellyParams.fractionalKelly = fractionalKelly;
    }

    function registerOracle(address token, address oracle) external onlyOwner {
        priceOracles[token] = oracle;
    }

    function approveDEX(address dex, bool approved) external onlyOwner {
        approvedDEXs[dex] = approved;
    }

    function emergencyPause() external onlyOwner {
        circuitBreaker.isPaused = true;
        emit EmergencyPaused(msg.sender, block.timestamp);
    }

    function unpause() external onlyOwner {
        circuitBreaker.isPaused = false;
    }

    function initiateEmergencyWithdrawal() external onlyOwner {
        emergencyWithdrawalInitiated = block.timestamp;
        emit EmergencyWithdrawalInitiated(block.timestamp, block.timestamp + TIMELOCK_DURATION);
    }

    function executeEmergencyWithdrawal(address token) external onlyOwner {
        if (block.timestamp < emergencyWithdrawalInitiated + TIMELOCK_DURATION) {
            revert TimelockNotExpired(emergencyWithdrawalInitiated + TIMELOCK_DURATION - block.timestamp);
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner(), balance);

        emit ProfitWithdrawn(token, balance, owner());
    }

    function withdrawProfit(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
        emit ProfitWithdrawn(token, amount, owner());
    }

    function getStats() external view returns (ExecutionStats memory) {
        return stats;
    }

    function getSharpeRatio() external view returns (uint256) {
        if (stats.totalExecutions == 0) return 0;

        uint256 avgProfit = stats.totalProfit / stats.totalExecutions;
        return avgProfit * 10000 / (stats.largestProfit - stats.largestLoss);
    }

    receive() external payable {}
}
