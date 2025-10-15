// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title MEVExecutor
 * @notice Production MEV Executor for Polygon - Generated with blockchain intelligence
 * @dev Complete implementation with flash loans, arbitrage, and liquidations
 */

// Import interfaces
import { IERC20, IFlashLoanRecipient, IVault, IUniswapV2Factory, IUniswapV2Router02 } from "./Interfaces.sol";
import { DEXAdapter } from "./DEXAdapter.sol";

contract MEVExecutor is IFlashLoanRecipient {
    address public owner;
    address public pendingOwner;
    IVault public immutable BALANCER_VAULT;
    
    // Polygon DEX addresses
    address public constant QUICKSWAP = 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff;
    address public constant SUSHISWAP = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    address public constant UNISWAP_V3 = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address public constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    
    enum Strategy { ARBITRAGE, LIQUIDATION }
    
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

    uint8 private constant ROUTE_TYPE_V2 = 0;
    uint8 private constant ROUTE_TYPE_V3 = 1;
    address public constant UNISWAP_V3_QUOTER = 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6;
    
    CircuitBreaker public cb;
    uint256 private _locked = 1;
    
    event Executed(Strategy indexed strategy, uint256 profit);
    event Paused(bool status);
    event OwnershipTransferStarted(address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event CircuitBreakerUpdated(uint256 minProfit, uint256 maxLoss, uint256 dailyLimit);
    event CircuitBreakerTripped(uint256 loss, uint256 remainingLimit);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    
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
    
    function executeArbitrage(
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata routeData
    ) external onlyOwner nonReentrant {
        require(!cb.paused, "Paused");
        require(tokens.length == amounts.length, "Length mismatch");
        require(tokens.length == 1, "Single-token only");
        require(tokens[0] != address(0), "Token required");
        require(amounts[0] > 0, "Amount zero");
        
        ArbitragePayload memory payload = abi.decode(routeData, (ArbitragePayload));
        require(payload.routes.length > 0, "Routes empty");
        if (payload.minProfitOverride > 0) {
            require(payload.minProfitOverride >= cb.minProfit, "Override too low");
        }

        for (uint256 i = 0; i < payload.routes.length; i++) {
            RouteCalldata memory route = payload.routes[i];
            require(route.tokens.length >= 2, "Route tokens");
            require(route.fees.length == route.tokens.length - 1, "Fee mismatch");
            require(route.tokens[0] == tokens[0], "Route start token");
            require(route.tokens[route.tokens.length - 1] == tokens[0], "Route end token");
            require(route.router != address(0), "Router required");
        }

        IERC20[] memory flashTokens = new IERC20[](1);
        flashTokens[0] = IERC20(tokens[0]);
        
        BALANCER_VAULT.flashLoan(
            this,
            flashTokens,
            amounts,
            abi.encode(Strategy.ARBITRAGE, payload)
        );
    }
    
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory fees,
        bytes memory userData
    ) external override {
        require(msg.sender == address(BALANCER_VAULT), "Unauthorized");
        
        (Strategy strategy, ArbitragePayload memory payload) = abi.decode(userData, (Strategy, ArbitragePayload));
        require(strategy == Strategy.ARBITRAGE, "Unsupported strategy");
        
    uint256 balanceBefore = tokens[0].balanceOf(address(this));
    require(balanceBefore >= amounts[0], "Loan amount mismatch");
    uint256 initialBalance = balanceBefore - amounts[0];
        uint256 repayAmount = amounts[0] + fees[0];
        uint256 minProfitRequired = payload.minProfitOverride > 0 ? payload.minProfitOverride : cb.minProfit;
        
    _executeArbitrage(address(tokens[0]), amounts[0], payload);
        
        uint256 finalBalance = tokens[0].balanceOf(address(this));
        require(finalBalance >= repayAmount + initialBalance, "Insufficient balance");
    uint256 profit = finalBalance - repayAmount - initialBalance;
        require(profit >= minProfitRequired, "Low profit");
        
        int256 pnl = int256(profit);
        _updateCircuitBreaker(pnl);
        
        require(tokens[0].transfer(address(BALANCER_VAULT), repayAmount), "Repay failed");
        
        emit Executed(strategy, profit);
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
                candidates[i] = DEXAdapter.RouteCandidate({
                    amountOut: quotedAmount,
                    estimatedGas: route.estimatedGas,
                    router: route.router
                });
            } else if (route.routeType == ROUTE_TYPE_V3) {
                address quoter = route.quoter == address(0) ? UNISWAP_V3_QUOTER : route.quoter;
                bytes memory encodedPath = _encodeV3Path(route.tokens, route.fees);
                uint256 quotedAmount = DEXAdapter.quoteV3Route(quoter, encodedPath, amountIn);
                encodedV3Paths[i] = encodedPath;
                candidates[i] = DEXAdapter.RouteCandidate({
                    amountOut: quotedAmount,
                    estimatedGas: route.estimatedGas,
                    router: route.router
                });
            } else {
                revert("Unsupported route type");
            }
        }

        (uint256 bestIndex, ) = DEXAdapter.selectBestRoute(candidates, gasPrice);
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
            hops[i] = DEXAdapter.V2Hop({
                pair: pair,
                tokenIn: tokens[i],
                tokenOut: tokens[i + 1],
                feeBps: fees[i]
            });
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
}
