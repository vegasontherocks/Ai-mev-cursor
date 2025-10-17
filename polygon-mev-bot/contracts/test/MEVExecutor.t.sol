// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test} from "forge-std/Test.sol";
import {MEVExecutor} from "../src/generated/MEVExecutor.sol";
import {IERC20, IFlashLoanRecipient, IQuoter, ISwapRouter, IVault} from "../src/generated/Interfaces.sol";
import { AggregatorV3Interface } from "../src/generated/Interfaces.sol";

contract MEVExecutorTest is Test {
    event Executed(MEVExecutor.Strategy indexed strategy, uint256 profit);

    MEVExecutor public executor;
    MockVault public vault;
    MockERC20 public baseToken;
    MockERC20 public quoteToken;
    MockSwapRouter public router;
    MockQuoter public quoter;
    MockAggregator public aggregator;
    MockAggregator public aggregator2;

    function setUp() public {
        vault = new MockVault();
        baseToken = new MockERC20("Base Token", "BASE", 18);
        quoteToken = new MockERC20("Quote Token", "QUOTE", 18);
        router = new MockSwapRouter();
        quoter = new MockQuoter();

        baseToken.setMinter(address(this), true);
        baseToken.setMinter(address(router), true);
        quoteToken.setMinter(address(router), true);
        quoteToken.setMinter(address(this), true);

        baseToken.mint(address(vault), 1_000 ether);

        executor = new MEVExecutor(address(vault));
        vault.setExpectedRecipient(address(executor));
        aggregator = new MockAggregator();
        aggregator.setLatestAnswer(int256(12e17)); // 1.2 * 1e18 to match quoted route in tests
        aggregator2 = new MockAggregator();
        aggregator2.setLatestAnswer(int256(118e16)); // 1.18 * 1e18 a slightly different feed
        executor.setPriceFeed(address(baseToken), AggregatorV3Interface(address(aggregator)));
        executor.addPriceFeed(address(baseToken), AggregatorV3Interface(address(aggregator2)));
    }

    function testDeployment() public view {
        assertEq(address(executor.BALANCER_VAULT()), address(vault));
        assertEq(executor.owner(), address(this));
        MEVExecutor.CircuitBreaker memory circuit = _getCircuitBreaker();
        assertEq(circuit.paused, false);
        assertGt(circuit.minProfit, 0);
    }

    function testPauseUnpause() public {
        executor.pause();
        MEVExecutor.CircuitBreaker memory circuit = _getCircuitBreaker();
        assertEq(circuit.paused, true);

        executor.unpause();
        circuit = _getCircuitBreaker();
        assertEq(circuit.paused, false);
    }

    function testReceiveETH() public {
        uint256 balanceBefore = address(executor).balance;
        (bool success,) = address(executor).call{value: 1 ether}("");
        assertTrue(success);

        uint256 balanceAfter = address(executor).balance;
        assertEq(balanceAfter - balanceBefore, 1 ether);
    }

    function testSetCircuitBreakerConfig() public {
        executor.setCircuitBreakerConfig(0.02 ether, 0.2 ether, 6 ether);

        MEVExecutor.CircuitBreaker memory circuit = _getCircuitBreaker();
        assertEq(circuit.minProfit, 0.02 ether);
        assertEq(circuit.maxLoss, 0.2 ether);
        assertEq(circuit.dailyLimit, 6 ether);
    }

    function testSetCircuitBreakerConfigReverts() public {
        vm.expectRevert("Min profit");
        executor.setCircuitBreakerConfig(0, 1, 1);

        vm.expectRevert("Invalid limits");
        executor.setCircuitBreakerConfig(1, 0, 0);
    }

    function testTransferOwnershipFlow() public {
        address newOwner = address(0xBEEF);
        executor.transferOwnership(newOwner);
        assertEq(executor.pendingOwner(), newOwner);

        vm.prank(newOwner);
        executor.acceptOwnership();

        assertEq(executor.owner(), newOwner);
        assertEq(executor.pendingOwner(), address(0));
    }

    function testWithdrawOnlyOwner() public {
        baseToken.mint(address(executor), 1 ether);

        vm.expectRevert("Not owner");
        vm.prank(address(0xBEEF));
        executor.withdraw(address(baseToken));

        uint256 ownerBalanceBefore = baseToken.balanceOf(address(this));
        executor.withdraw(address(baseToken));
        uint256 ownerBalanceAfter = baseToken.balanceOf(address(this));

        assertEq(ownerBalanceAfter - ownerBalanceBefore, 1 ether);
    }

    function testExecuteArbitrageRequiresOwner() public {
        address[] memory loanTokens = new address[](1);
        loanTokens[0] = address(baseToken);
        uint256[] memory loanAmounts = new uint256[](1);
        loanAmounts[0] = 1 ether;
        bytes memory routeData = _buildRouteData(loanAmounts[0]);

        vm.expectRevert("Not owner");
        vm.prank(address(0xBEEF));
        executor.executeArbitrage(loanTokens, loanAmounts, routeData);
    }

    function testExecuteArbitrageRevertsWhenPaused() public {
        executor.pause();
        address[] memory loanTokens = new address[](1);
        loanTokens[0] = address(baseToken);
        uint256[] memory loanAmounts = new uint256[](1);
        loanAmounts[0] = 1 ether;
        bytes memory routeData = _buildRouteData(loanAmounts[0]);

        vm.expectRevert("Paused");
        executor.executeArbitrage(loanTokens, loanAmounts, routeData);
    }

    function testExecuteArbitrageSuccess() public {
        address[] memory loanTokens = new address[](1);
        loanTokens[0] = address(baseToken);
        uint256[] memory loanAmounts = new uint256[](1);
        loanAmounts[0] = 1 ether;
        bytes memory routeData = _buildRouteData(loanAmounts[0]);

        executor.executeArbitrage(loanTokens, loanAmounts, routeData);

        uint256 remainingBalance = baseToken.balanceOf(address(executor));
        MEVExecutor.CircuitBreaker memory circuit = _getCircuitBreaker();
        assertGt(remainingBalance, circuit.minProfit);
    }

    function _buildRouteData(uint256 amountIn) internal returns (bytes memory) {
        address[] memory tokensPathHigh = new address[](3);
        tokensPathHigh[0] = address(baseToken);
        tokensPathHigh[1] = address(quoteToken);
        tokensPathHigh[2] = address(baseToken);

        uint24[] memory feesHigh = new uint24[](2);
        feesHigh[0] = 500;
        feesHigh[1] = 3_000;

        address[] memory tokensPathLow = new address[](3);
        tokensPathLow[0] = address(baseToken);
        tokensPathLow[1] = address(quoteToken);
        tokensPathLow[2] = address(baseToken);

        uint24[] memory feesLow = new uint24[](2);
        feesLow[0] = 3_000;
        feesLow[1] = 3_000;

        bytes memory pathHigh = _encodeV3Path(tokensPathHigh, feesHigh);
        bytes memory pathLow = _encodeV3Path(tokensPathLow, feesLow);

        uint256 highQuote = amountIn + 0.2 ether;
        uint256 lowQuote = amountIn + 0.05 ether;

        quoter.setExactInputQuote(pathHigh, highQuote);
        quoter.setExactInputQuote(pathLow, lowQuote);
        router.setExactInputPathConfig(pathHigh, tokensPathHigh[0], tokensPathHigh[2], highQuote);
        router.setExactInputPathConfig(pathLow, tokensPathLow[0], tokensPathLow[2], lowQuote);

        MEVExecutor.RouteCalldata[] memory routes = new MEVExecutor.RouteCalldata[](2);
        routes[0].routeType = 1;
        routes[0].router = address(router);
        routes[0].quoter = address(quoter);
        routes[0].tokens = tokensPathHigh;
        routes[0].fees = feesHigh;
        routes[0].estimatedGas = 600_000;
        routes[0].minAmountOut = amountIn + 0.1 ether;

        routes[1].routeType = 1;
        routes[1].router = address(router);
        routes[1].quoter = address(quoter);
        routes[1].tokens = tokensPathLow;
        routes[1].fees = feesLow;
        routes[1].estimatedGas = 400_000;
        routes[1].minAmountOut = amountIn + 0.02 ether;

        MEVExecutor.ArbitragePayload memory payload;
        payload.routes = routes;
        payload.minProfitOverride = 0;
        payload.gasPriceWei = 30 gwei;

        return abi.encode(payload);
    }

    function _encodeV3Path(address[] memory tokens, uint24[] memory fees) internal pure returns (bytes memory path) {
        require(tokens.length == fees.length + 1, "path mismatch");
        path = abi.encodePacked(tokens[0]);
        for (uint256 i = 0; i < fees.length; i++) {
            path = bytes.concat(path, abi.encodePacked(bytes3(fees[i])), abi.encodePacked(tokens[i + 1]));
        }
    }

    function _getCircuitBreaker() internal view returns (MEVExecutor.CircuitBreaker memory circuit) {
        (circuit.minProfit, circuit.maxLoss, circuit.dailyLimit, circuit.dailyLoss, circuit.lastReset, circuit.paused) =
            executor.cb();
    }
}

contract MockVault is IVault {
    address public expectedRecipient;

    function setExpectedRecipient(address recipient) external {
        expectedRecipient = recipient;
    }

    function flashLoan(
        IFlashLoanRecipient recipient,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external override {
        require(address(recipient) == expectedRecipient, "unexpected recipient");
        uint256 len = tokens.length;
        uint256[] memory fees = new uint256[](len);
        uint256[] memory balancesBefore = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            MockERC20 token = MockERC20(address(tokens[i]));
            balancesBefore[i] = token.balanceOf(address(this));
            require(token.transfer(address(recipient), amounts[i]));
        }

        recipient.receiveFlashLoan(tokens, amounts, fees, userData);

        for (uint256 i = 0; i < len; i++) {
            MockERC20 token = MockERC20(address(tokens[i]));
            uint256 balanceAfter = token.balanceOf(address(this));
            require(balanceAfter >= balancesBefore[i], "flash loan not repaid");
        }
    }

    function swap(SingleSwap memory, FundManagement memory, uint256, uint256)
        external
        pure
        override
        returns (uint256)
    {
        revert("swap-not-implemented");
    }
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable DECIMALS;

    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;
    mapping(address => bool) public isMinter;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        DECIMALS = decimals_;
    }

    function setMinter(address account, bool allowed) external {
        isMinter[account] = allowed;
    }

    function mint(address to, uint256 amount) external {
        require(isMinter[msg.sender], "not minter");
        balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        require(balances[msg.sender] >= amount, "insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function allowance(address owner_, address spender) external view returns (uint256) {
        return allowances[owner_][spender];
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowances[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowances[from][msg.sender] = allowed - amount;
        require(balances[from] >= amount, "balance");
        balances[from] -= amount;
        balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract MockQuoter is IQuoter {
    mapping(bytes => uint256) private exactInputQuotes;
    mapping(bytes32 => uint256) private singleQuotes;

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

    function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160)
        external
        view
        override
        returns (uint256 amountOut)
    {
        bytes32 key = keccak256(abi.encode(tokenIn, tokenOut, fee, amountIn));
        amountOut = singleQuotes[key];
        require(amountOut != 0, "quote-missing");
    }

    function quoteExactInput(bytes memory path, uint256) external view override returns (uint256 amountOut) {
        amountOut = exactInputQuotes[path];
        require(amountOut != 0, "quote-missing");
    }
}

contract MockAggregator {
    int256 private latest;
    uint8 private dec = 18;

    function setLatestAnswer(int256 a) external {
        latest = a;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (uint80(1), latest, uint256(0), block.timestamp, uint80(1));
    }

    function decimals() external view returns (uint8) {
        return dec;
    }
}

contract MockSwapRouter is ISwapRouter {
    struct SingleConfig {
        uint256 amountOut;
        address tokenOut;
    }

    struct PathConfig {
        uint256 amountOut;
        address tokenIn;
        address tokenOut;
    }

    mapping(bytes32 => SingleConfig) private singleConfigs;
    mapping(bytes32 => PathConfig) private pathConfigs;

    function setExactInputSingleConfig(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut
    ) external {
        bytes32 key = keccak256(abi.encode(tokenIn, tokenOut, fee, amountIn));
        singleConfigs[key] = SingleConfig({amountOut: amountOut, tokenOut: tokenOut});
    }

    function setExactInputPathConfig(bytes memory path, address tokenIn, address tokenOut, uint256 amountOut)
        external
    {
        bytes32 key = keccak256(path);
        pathConfigs[key] = PathConfig({amountOut: amountOut, tokenIn: tokenIn, tokenOut: tokenOut});
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        bytes32 key = keccak256(abi.encode(params.tokenIn, params.tokenOut, params.fee, params.amountIn));
        SingleConfig memory config = singleConfigs[key];
        require(config.amountOut != 0, "config-missing");

        bool pulled = MockERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        require(pulled, "transfer-failed");
        MockERC20(config.tokenOut).mint(params.recipient, config.amountOut);
        amountOut = config.amountOut;
    }

    function exactInput(ExactInputParams calldata params) external payable override returns (uint256 amountOut) {
        bytes32 key = keccak256(params.path);
        PathConfig memory config = pathConfigs[key];
        require(config.amountOut != 0, "config-missing");

        bool pulled = MockERC20(config.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        require(pulled, "transfer-failed");
        MockERC20(config.tokenOut).mint(params.recipient, config.amountOut);
        amountOut = config.amountOut;
    }
}
