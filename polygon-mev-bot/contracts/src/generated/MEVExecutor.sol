// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title MEVExecutor
 * @notice Production MEV Executor for Polygon - Generated with blockchain intelligence
 * @dev Complete implementation with flash loans, arbitrage, and liquidations
 */

// Import interfaces
import {IERC20, IFlashLoanRecipient, IVault, IUniswapV2Factory, IUniswapV2Router02, IPool} from "./Interfaces.sol";
import {DEXAdapter} from "./DEXAdapter.sol";
import {AaveAdapter} from "./AaveAdapter.sol";
import {AggregatorV3Interface} from "./Interfaces.sol";
import {OracleLib} from "./OracleLib.sol";

contract MEVExecutor is IFlashLoanRecipient {
    address public owner;
    address public pendingOwner;
    IVault public immutable BALANCER_VAULT;

    // Polygon DEX addresses
    address public constant QUICKSWAP = 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff;
    address public constant SUSHISWAP = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    address public constant UNISWAP_V3 = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address public constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;

    enum Strategy {
        ARBITRAGE,
        LIQUIDATION
    }

    struct CircuitBreaker {
        uint256 minProfit;
        uint256 maxLoss;
        uint256 dailyLimit;
        uint256 dailyLoss;
        uint256 lastReset;
        bool paused;
    }

    struct RouteCalldata {
        uint8 routeType; // 0 = Uniswap V2 style, 1 = Uniswap V3 path
        address router;
        address quoter; // optional for V3; falls back to default when zero
        address[] tokens;
        uint24[] fees;
        uint256 estimatedGas;
        uint256 minAmountOut;
    }

    struct ArbitragePayload {
        RouteCalldata[] routes;
        uint256 minProfitOverride;
        uint256 gasPriceWei;
    }

    struct LiquidationPayload {
        address pool;
        address collateralAsset;
        address debtAsset;
        address user;
        uint256 closeFactorBps;
        uint256 liquidationBonusBps;
        uint256 minProfitBase;
        bool receiveAToken;
    }

    uint8 private constant ROUTE_TYPE_V2 = 0;
    uint8 private constant ROUTE_TYPE_V3 = 1;
    address public constant UNISWAP_V3_QUOTER = 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6;

    CircuitBreaker public cb;
    uint256 private _locked = 1;
    mapping(address => AggregatorV3Interface) public priceFeeds; // token => chainlink feed
    uint256 public maxDeviationBps = 500; // 5% default
    // support multiple feeds per token for redundancy (addresses of AggregatorV3Interface)
    mapping(address => address[]) internal priceFeedList;

    event Executed(Strategy indexed strategy, uint256 profit);
    event Paused(bool status);
    event OwnershipTransferStarted(address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event CircuitBreakerUpdated(uint256 minProfit, uint256 maxLoss, uint256 dailyLimit);
    event CircuitBreakerTripped(uint256 loss, uint256 remainingLimit);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event DebugCandidate(uint256 index, uint256 amountOut, uint256 estimatedGas, address router, uint256 gasPrice);
        event PriceFeedAdded(address indexed token, address indexed feed);
        event PriceFeedRemoved(address indexed token, address indexed feed);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "Reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address _vault) {
        require(_vault != address(0), "Vault required");
        owner = msg.sender;
        BALANCER_VAULT = IVault(_vault);
        cb = CircuitBreaker(0.01 ether, 0.1 ether, 5 ether, 0, block.timestamp, false);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function executeArbitrage(address[] calldata tokens, uint256[] calldata amounts, bytes calldata routeData)
        external
        onlyOwner
        nonReentrant
    {
        require(!cb.paused, "Paused");
        require(tokens.length == amounts.length, "Length mismatch");

        ArbitragePayload memory payload = abi.decode(routeData, (ArbitragePayload));
        require(payload.routes.length > 0, "Routes empty");
        if (payload.minProfitOverride > 0) {
            require(payload.minProfitOverride >= cb.minProfit, "Override too low");
        }
        for (uint256 i = 0; i < payload.routes.length; i++) {
            RouteCalldata memory route = payload.routes[i];
            require(route.tokens.length >= 2, "Route tokens");
            require(route.fees.length == route.tokens.length - 1, "Fee mismatch");
            require(route.router != address(0), "Router required");
        }

        // Request flashloan for all tokens provided. Caller must ensure payload.routes can be applied per-token.
        IERC20[] memory flashTokens = new IERC20[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "Token required");
            require(amounts[i] > 0, "Amount zero");
            flashTokens[i] = IERC20(tokens[i]);
        }

        BALANCER_VAULT.flashLoan(this, flashTokens, amounts, abi.encode(Strategy.ARBITRAGE, abi.encode(payload)));
    }

    function executeLiquidation(address[] calldata tokens, uint256[] calldata amounts, bytes calldata liqData)
        external
        onlyOwner
        nonReentrant
    {
        require(!cb.paused, "Paused");
        require(tokens.length == amounts.length, "Length mismatch");

        LiquidationPayload memory payload = abi.decode(liqData, (LiquidationPayload));
        // some basic validations
        require(payload.pool != address(0), "pool required");
        require(payload.debtAsset != address(0), "debt asset");

        IERC20[] memory flashTokens = new IERC20[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "Token required");
            require(amounts[i] > 0, "Amount zero");
            flashTokens[i] = IERC20(tokens[i]);
        }

        BALANCER_VAULT.flashLoan(this, flashTokens, amounts, abi.encode(Strategy.LIQUIDATION, abi.encode(payload)));
    }

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory fees,
        bytes memory userData
    ) external override {
        require(msg.sender == address(BALANCER_VAULT), "Unauthorized");

        (Strategy strategy, bytes memory payload) = abi.decode(userData, (Strategy, bytes));

        if (strategy == Strategy.ARBITRAGE) {
            ArbitragePayload memory arb = abi.decode(payload, (ArbitragePayload));
            uint256 totalProfit = 0;
            uint256 minProfitRequired = arb.minProfitOverride > 0 ? arb.minProfitOverride : cb.minProfit;

            for (uint256 i = 0; i < tokens.length; i++) {
                IERC20 loan = tokens[i];
                uint256 amount = amounts[i];
                uint256 fee = fees.length > i ? fees[i] : 0;

                uint256 balanceBefore = loan.balanceOf(address(this));
                require(balanceBefore >= amount, "Loan amount mismatch");
                uint256 initialBalance = balanceBefore - amount;
                uint256 repayAmount = amount + fee;

                _executeArbitrage(address(loan), amount, arb);

                uint256 finalBalance = loan.balanceOf(address(this));
                require(finalBalance >= repayAmount + initialBalance, "Insufficient balance");
                uint256 profit = finalBalance - repayAmount - initialBalance;
                require(profit >= 0, "Negative profit");
                totalProfit += profit;

                // repay this token loan
                require(loan.transfer(address(BALANCER_VAULT), repayAmount), "Repay failed");
            }

            require(totalProfit >= minProfitRequired, "Low profit");
            int256 pnl = int256(totalProfit);
            _updateCircuitBreaker(pnl);
            emit Executed(strategy, totalProfit);
        } else if (strategy == Strategy.LIQUIDATION) {
            LiquidationPayload memory liq = abi.decode(payload, (LiquidationPayload));
            uint256 totalProfit = 0;
            for (uint256 i = 0; i < tokens.length; i++) {
                IERC20 loan = tokens[i];
                uint256 amount = amounts[i];
                uint256 fee = fees.length > i ? fees[i] : 0;

                _executeLiquidation(loan, amount, fee, liq);
                // _executeLiquidation repays its own loan, and updates circuit breaker
            }
            emit Executed(strategy, totalProfit);
        } else {
            revert("Unsupported strategy");
        }
    }

    function _executeLiquidation(IERC20 loanToken, uint256 amount, uint256 fee, LiquidationPayload memory liq) internal {
        AaveAdapter.AccountSnapshot memory snapshot = AaveAdapter.getAccountSnapshot(IPool(liq.pool), liq.user);

        AaveAdapter.LiquidationParams memory params = AaveAdapter.LiquidationParams({
            closeFactorBps: liq.closeFactorBps,
            liquidationBonusBps: liq.liquidationBonusBps,
            minProfitBase: liq.minProfitBase
        });

        AaveAdapter.LiquidationQuote memory quote = AaveAdapter.quoteLiquidation(snapshot, params);
        require(quote.profitable, "Not profitable");

        // Oracle safeguard: if a price feed exists for the debt asset, ensure the reported oracle price is reasonable
            (uint256 oraclePrice, ) = _readConsensusPrice(liq.debtAsset);
            if (oraclePrice > 0) {
                if (quote.debtToCoverBase > 0) {
                    uint256 spotPrice = (quote.collateralValueBase * 1e18) / quote.debtToCoverBase;
                    OracleLib.validateDeviation(oraclePrice, spotPrice, maxDeviationBps);
                }
            }

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= amount, "Loan amount mismatch");
        uint256 initialBalance = balanceBefore - amount;
        uint256 repayAmount = amount + fee;

        AaveAdapter.liquidate(IPool(liq.pool), liq.collateralAsset, liq.debtAsset, liq.user, quote.debtToCoverBase, liq.receiveAToken);

        uint256 finalBalance = loanToken.balanceOf(address(this));
        require(finalBalance >= repayAmount + initialBalance, "Insufficient balance");
        uint256 profit = finalBalance - repayAmount - initialBalance;

        int256 pnl = int256(profit);
        _updateCircuitBreaker(pnl);

        require(loanToken.transfer(address(BALANCER_VAULT), repayAmount), "Repay failed");

        emit Executed(Strategy.LIQUIDATION, profit);
    }

    function _executeArbitrage(address loanToken, uint256 amountIn, ArbitragePayload memory payload) internal {
        uint256 routeCount = payload.routes.length;
        DEXAdapter.RouteCandidate[] memory candidates = new DEXAdapter.RouteCandidate[](routeCount);
        bytes[] memory encodedV3Paths = new bytes[](routeCount);
        uint256 gasPrice = payload.gasPriceWei > 0 ? payload.gasPriceWei : tx.gasprice;

        for (uint256 i = 0; i < routeCount; i++) {
            RouteCalldata memory route = payload.routes[i];

            if (route.routeType == ROUTE_TYPE_V2) {
                DEXAdapter.V2Hop[] memory hops = _buildV2Hops(route.router, route.tokens, route.fees);
                uint256 quotedAmount = DEXAdapter.quoteV2Route(hops, amountIn);
                candidates[i] = DEXAdapter.RouteCandidate({amountOut: quotedAmount, estimatedGas: route.estimatedGas, router: route.router});
            } else if (route.routeType == ROUTE_TYPE_V3) {
                address quoter = route.quoter == address(0) ? UNISWAP_V3_QUOTER : route.quoter;
                bytes memory encodedPath = _encodeV3Path(route.tokens, route.fees);
                uint256 quotedAmount = DEXAdapter.quoteV3Route(quoter, encodedPath, amountIn);
                encodedV3Paths[i] = encodedPath;
                candidates[i] = DEXAdapter.RouteCandidate({amountOut: quotedAmount, estimatedGas: route.estimatedGas, router: route.router});
            } else {
                revert("Unsupported route type");
            }
        }

        for (uint256 i = 0; i < routeCount; i++) {
            emit DebugCandidate(i, candidates[i].amountOut, candidates[i].estimatedGas, candidates[i].router, gasPrice);
        }

        uint256 bestIndex;
        int256 unusedNet;
        (bestIndex, unusedNet) = DEXAdapter.selectBestRoute(candidates, gasPrice);

        // Oracle safeguard: validate best route against oracle price for the loan token when configured
            (, uint8 _dec) = _tryGetFeedForToken(loanToken);
            if (_dec > 0) {
                uint256 spotPrice = (candidates[bestIndex].amountOut * 1e18) / amountIn;
                (uint256 oraclePrice, ) = _readConsensusPrice(loanToken);
                OracleLib.validateDeviation(oraclePrice, spotPrice, maxDeviationBps);
            }

        RouteCalldata memory selected = payload.routes[bestIndex];

        if (selected.routeType == ROUTE_TYPE_V2) {
            _executeV2Route(selected, amountIn);
        } else if (selected.routeType == ROUTE_TYPE_V3) {
            _executeV3Route(selected, encodedV3Paths[bestIndex], amountIn);
        } else {
            revert("Unsupported route type");
        }

        // Ensure we end with the original loan token
        require(selected.tokens[selected.tokens.length - 1] == loanToken, "Route did not end with loan token");
    }

    function _executeV2Route(RouteCalldata memory route, uint256 amountIn) internal {
        _updateAllowance(route.tokens[0], route.router, amountIn);
        DEXAdapter.swapExactTokensForTokensV2(route.router, route.tokens, amountIn, route.minAmountOut);
        require(IERC20(route.tokens[0]).approve(route.router, 0), "Approve clear failed");
    }

    function _executeV3Route(RouteCalldata memory route, bytes memory encodedPath, uint256 amountIn) internal {
        _updateAllowance(route.tokens[0], route.router, amountIn);
        DEXAdapter.swapExactTokensForTokensV3(route.router, encodedPath, amountIn, route.minAmountOut);
        require(IERC20(route.tokens[0]).approve(route.router, 0), "Approve clear failed");
    }

    function _buildV2Hops(address router, address[] memory tokens, uint24[] memory fees)
        internal
        view
        returns (DEXAdapter.V2Hop[] memory hops)
    {
        require(tokens.length >= 2, "Route tokens");
        require(tokens.length == fees.length + 1, "Fee mismatch");

        address factory = IUniswapV2Router02(router).factory();
        require(factory != address(0), "Factory missing");

        hops = new DEXAdapter.V2Hop[](tokens.length - 1);
        for (uint256 i = 0; i < tokens.length - 1; i++) {
            address pair = IUniswapV2Factory(factory).getPair(tokens[i], tokens[i + 1]);
            require(pair != address(0), "Pair missing");
            hops[i] = DEXAdapter.V2Hop({pair: pair, tokenIn: tokens[i], tokenOut: tokens[i + 1], feeBps: fees[i]});
        }
    }

    function _encodeV3Path(address[] memory tokens, uint24[] memory fees) internal pure returns (bytes memory path) {
        require(tokens.length >= 2, "Path tokens");
        require(tokens.length == fees.length + 1, "Path mismatch");

        path = abi.encodePacked(tokens[0]);
        for (uint256 i = 0; i < fees.length; i++) {
            path = bytes.concat(path, abi.encodePacked(bytes3(fees[i])), abi.encodePacked(tokens[i + 1]));
        }
    }

    function pause() external onlyOwner {
        cb.paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        cb.paused = false;
        emit Paused(false);
    }

    function withdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "Nothing to withdraw");
        require(IERC20(token).transfer(owner, balance), "Transfer failed");
        emit Withdrawn(token, balance, owner);
    }

    function setCircuitBreakerConfig(uint256 minProfit, uint256 maxLoss, uint256 dailyLimit) external onlyOwner {
        require(minProfit > 0, "Min profit");
        require(maxLoss > 0 && dailyLimit >= maxLoss, "Invalid limits");
        cb.minProfit = minProfit;
        cb.maxLoss = maxLoss;
        cb.dailyLimit = dailyLimit;
        emit CircuitBreakerUpdated(minProfit, maxLoss, dailyLimit);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }

    receive() external payable {}

    function _updateAllowance(address token, address spender, uint256 amount) internal {
        uint256 currentAllowance = IERC20(token).allowance(address(this), spender);
        if (currentAllowance < amount) {
            require(IERC20(token).approve(spender, 0), "Approve reset failed");
            require(IERC20(token).approve(spender, amount), "Approve failed");
        }
    }

    function _updateCircuitBreaker(int256 pnl) internal {
        if (block.timestamp > cb.lastReset + 1 days) {
            cb.dailyLoss = 0;
            cb.lastReset = block.timestamp;
        }

        if (pnl < 0) {
            uint256 loss = uint256(-pnl);
            require(loss <= cb.maxLoss, "Loss exceeds max");
            cb.dailyLoss += loss;
            require(cb.dailyLoss <= cb.dailyLimit, "Daily loss limit");
            emit CircuitBreakerTripped(loss, cb.dailyLimit - cb.dailyLoss);
            if (cb.dailyLoss == cb.dailyLimit) {
                cb.paused = true;
                emit Paused(true);
            }
        }
    }

    /* Oracle configuration (only owner) */
    function setPriceFeed(address token, AggregatorV3Interface feed) external onlyOwner {
        priceFeeds[token] = feed;
        // ensure feed exists in list for compatibility
        if (address(feed) != address(0)) {
            address[] storage list = priceFeedList[token];
            bool found = false;
            for (uint256 i = 0; i < list.length; i++) {
                if (list[i] == address(feed)) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                list.push(address(feed));
                emit PriceFeedAdded(token, address(feed));
            }
        }
    }

    function setMaxDeviationBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps <= 10_000, "bps");
        maxDeviationBps = bps;
    }

    function addPriceFeed(address token, AggregatorV3Interface feed) external onlyOwner {
        require(token != address(0), "token required");
        require(address(feed) != address(0), "feed required");
        address[] storage list = priceFeedList[token];
        for (uint256 i = 0; i < list.length; i++) {
            require(list[i] != address(feed), "feed exists");
        }
        list.push(address(feed));
        emit PriceFeedAdded(token, address(feed));
    }

    function removePriceFeed(address token, AggregatorV3Interface feed) external onlyOwner {
        address[] storage list = priceFeedList[token];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == address(feed)) {
                list[i] = list[list.length - 1];
                list.pop();
                emit PriceFeedRemoved(token, address(feed));
                return;
            }
        }
        revert("feed not found");
    }

    function getPriceFeeds(address token) external view returns (address[] memory) {
        return priceFeedList[token];
    }

    // Try to detect if we have any feed for the token; returns (feed, decimals) where feed==0 means none
    function _tryGetFeedForToken(address token) internal view returns (address feedAddr, uint8 decimals) {
        address[] storage list = priceFeedList[token];
        if (list.length == 0) {
            AggregatorV3Interface f = priceFeeds[token];
            if (address(f) == address(0)) return (address(0), 0);
            return (address(f), f.decimals());
        }
        AggregatorV3Interface f0 = AggregatorV3Interface(list[0]);
        return (list[0], f0.decimals());
    }

    // Read median price from available feeds (normalized to 18 decimals). Returns (price, decimals)
    function _readConsensusPrice(address token) internal view returns (uint256 price, uint8 decimals) {
        address[] storage list = priceFeedList[token];
        if (list.length == 0) {
            AggregatorV3Interface feed = priceFeeds[token];
            if (address(feed) == address(0)) return (0, 0);
            (, int256 p, , , ) = feed.latestRoundData();
            require(p > 0, "invalid price");
            decimals = feed.decimals();
            return (uint256(p), decimals);
        }

        uint256 n = list.length;
        uint256[] memory prices = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            AggregatorV3Interface f = AggregatorV3Interface(list[i]);
            (, int256 p, , , ) = f.latestRoundData();
            require(p > 0, "feed zero");
            uint8 d = f.decimals();
            if (d < 18) {
                prices[i] = uint256(p) * (10**(18 - d));
            } else if (d > 18) {
                prices[i] = uint256(p) / (10**(d - 18));
            } else {
                prices[i] = uint256(p);
            }
        }

        _sortUintArray(prices);

        if (n % 2 == 1) {
            price = prices[n / 2];
        } else {
            price = (prices[n / 2 - 1] + prices[n / 2]) / 2;
        }
        decimals = 18;
        return (price, decimals);
    }

    // insertion sort for small arrays
    function _sortUintArray(uint256[] memory arr) internal pure {
        uint256 n = arr.length;
        for (uint256 i = 1; i < n; i++) {
            uint256 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] > key) {
                arr[j] = arr[j - 1];
                j--;
            }
            arr[j] = key;
        }
    }
}
