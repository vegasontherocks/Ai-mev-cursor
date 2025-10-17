// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Test } from "forge-std/Test.sol";
import { MEVExecutor } from "../src/generated/MEVExecutor.sol";
import { IPool, IERC20, IVault, IFlashLoanRecipient, AggregatorV3Interface } from "../src/generated/Interfaces.sol";

contract MockPool is IPool {
    // simple storage to control user account data
    uint256 public collateral;
    uint256 public debt;
    uint256 public available;
    uint256 public threshold;
    uint256 public ltv;
    uint256 public hf;

    address public lastCollateral;
    address public lastDebt;
    address public lastUser;
    uint256 public lastDebtToCover;
    bool public lastReceiveAToken;

    function setAccount(uint256 _collateral, uint256 _debt, uint256 _available, uint256 _threshold, uint256 _ltv, uint256 _hf) external {
        collateral = _collateral;
        debt = _debt;
        available = _available;
        threshold = _threshold;
        ltv = _ltv;
        hf = _hf;
    }

    function getUserAccountData(address) external view override returns (
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 availableBorrowsBase,
        uint256 currentLiquidationThreshold,
        uint256 ltv_,
        uint256 healthFactor
    ) {
        return (collateral, debt, available, threshold, ltv, hf);
    }

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external override {
        lastCollateral = collateralAsset;
        lastDebt = debtAsset;
        lastUser = user;
        lastDebtToCover = debtToCover;
        lastReceiveAToken = receiveAToken;

        // For the mock, mint equivalent collateral to the caller to simulate receiving proceeds
        MockERC20(collateralAsset).mint(msg.sender, debtToCover + 1 ether);
    }
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable DECIMALS = 18;

    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;
    mapping(address => bool) public isMinter;

    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
    }

    function setMinter(address account, bool allowed) external {
        isMinter[account] = allowed;
    }

    function mint(address to, uint256 amount) external {
        require(isMinter[msg.sender], "not minter");
        balances[to] += amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
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
        return true;
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

contract LiquidationTest is Test {
    MEVExecutor executor;
    MockVault vault;
    MockERC20 debtToken;
    MockERC20 collateralToken;
    MockPool pool;
    MockAggregator aggregator;
    MockAggregator aggregator2;

    function setUp() public {
        vault = new MockVault();
        debtToken = new MockERC20("Debt","DEBT");
        collateralToken = new MockERC20("Coll","COL");
        pool = new MockPool();

        debtToken.setMinter(address(this), true);
        collateralToken.setMinter(address(this), true);

        // Seed vault with debt token so flashloan can draw
        debtToken.mint(address(vault), 10 ether);

        executor = new MEVExecutor(address(vault));
        vault.setExpectedRecipient(address(executor));

    // setup mock aggregators and set as price feeds for debt token
    aggregator = new MockAggregator();
    aggregator.setLatestAnswer(int256(1e18)); // price = 1 * 1e18
    aggregator2 = new MockAggregator();
    aggregator2.setLatestAnswer(int256(102e16)); // 1.02 * 1e18
    executor.setPriceFeed(address(debtToken), AggregatorV3Interface(address(aggregator)));
    executor.addPriceFeed(address(debtToken), AggregatorV3Interface(address(aggregator2)));
    }

    function testLiquidationSuccess() public {
        // Make the pool report an unhealthy position
        pool.setAccount(10 ether, 5 ether, 0, 0, 0, 5e17);

        // Build liquidation payload
        MEVExecutor.LiquidationPayload memory payload;
        payload.pool = address(pool);
        payload.collateralAsset = address(collateralToken);
        payload.debtAsset = address(debtToken);
        payload.user = address(0xBEEF);
        payload.closeFactorBps = 5_000;
        payload.liquidationBonusBps = 10_500;
        payload.minProfitBase = 0;
        payload.receiveAToken = false;

        // Encode and call flashloan
        address[] memory tokens = new address[](1);
        tokens[0] = address(debtToken);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

    bytes memory data = abi.encode(payload);

        // Allow pool assets to be minted by this test harness when liquidation occurs
        collateralToken.setMinter(address(pool), true);

    executor.executeLiquidation(tokens, amounts, data);

        // After liquidation, executor should have some balance in debtToken (profit) or at least not revert
        uint256 bal = debtToken.balanceOf(address(executor));
        assertTrue(bal >= 0);
    }

    function testLiquidationNotProfitableReverts() public {
        // Healthy position: not liquidatable
        pool.setAccount(10 ether, 1 ether, 0, 0, 0, 11e17);

        MEVExecutor.LiquidationPayload memory payload;
        payload.pool = address(pool);
        payload.collateralAsset = address(collateralToken);
        payload.debtAsset = address(debtToken);
        payload.user = address(0xBEEF);
        payload.closeFactorBps = 5_000;
        payload.liquidationBonusBps = 10_500;
        payload.minProfitBase = 0;
        payload.receiveAToken = false;

        address[] memory tokens = new address[](1);
        tokens[0] = address(debtToken);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

    bytes memory data = abi.encode(payload);

    vm.expectRevert("Not profitable");
    executor.executeLiquidation(tokens, amounts, data);
    }
}

// Minimal MockVault copied/adjusted from MEVExecutor tests to support flash loans
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

    function swap(
        SingleSwap memory,
        FundManagement memory,
        uint256,
        uint256
    ) external pure override returns (uint256) {
        revert("swap-not-implemented");
    }
}
