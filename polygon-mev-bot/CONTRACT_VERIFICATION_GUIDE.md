# 📝 Contract Verification Guide

Your MEV contract is deployed but needs manual verification on PolygonScan.

## 🔍 Contract Details

**Address**: `0x0CD75B9605ad928a47616a6a1549FC856c07dbB7`

**PolygonScan**: https://polygonscan.com/address/0x0CD75B9605ad928a47616a6a1549FC856c07dbB7

## ✅ Manual Verification Steps

### 1. Go to PolygonScan Verification Page

Visit: https://polygonscan.com/verifyContract?a=0x0CD75B9605ad928a47616a6a1549FC856c07dbB7

### 2. Fill in the Form

**Compiler Type**: 
- Select: `Solidity (Single file)`

**Compiler Version**: 
- Select: `v0.8.20+commit.a1b79de6`

**License Type**: 
- Select: `MIT License (MIT)`

### 3. Enter Source Code

Copy the flattened contract from:
```bash
cat /workspace/polygon-mev-bot/contracts/MEVExecutor_flattened.sol
```

Or use this source code:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// Interfaces
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface IVault {
    function flashLoan(
        IFlashLoanRecipient recipient,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IFlashLoanRecipient {
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external;
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    
    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);
}

interface IPool {
    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;
}

// Main Contract
contract MEVExecutor is IFlashLoanRecipient {
    address public immutable owner;
    IVault public immutable BALANCER_VAULT;
    
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
    
    CircuitBreaker public cb;
    uint256 private _locked = 1;
    
    event Executed(Strategy indexed strategy, uint256 profit);
    event Paused();
    
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
        owner = msg.sender;
        BALANCER_VAULT = IVault(_vault);
        cb = CircuitBreaker(0.01 ether, 0.1 ether, 5 ether, 0, block.timestamp, false);
    }
    
    function executeArbitrage(
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata path
    ) external onlyOwner nonReentrant {
        require(!cb.paused, "Paused");
        
        IERC20[] memory flashTokens = new IERC20[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            flashTokens[i] = IERC20(tokens[i]);
        }
        
        BALANCER_VAULT.flashLoan(
            this,
            flashTokens,
            amounts,
            abi.encode(Strategy.ARBITRAGE, path)
        );
    }
    
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory fees,
        bytes memory userData
    ) external override {
        require(msg.sender == address(BALANCER_VAULT), "Unauthorized");
        
        (Strategy strategy, bytes memory params) = abi.decode(userData, (Strategy, bytes));
        
        uint256 initial = tokens[0].balanceOf(address(this));
        
        if (strategy == Strategy.ARBITRAGE) {
            _arbitrage(tokens[0], amounts[0], params);
        }
        
        uint256 finalBalance = tokens[0].balanceOf(address(this));
        uint256 profit = finalBalance > initial ? finalBalance - initial : 0;
        
        require(profit >= cb.minProfit, "Low profit");
        
        for (uint256 i = 0; i < tokens.length; i++) {
            tokens[i].transfer(address(BALANCER_VAULT), amounts[i] + fees[i]);
        }
        
        emit Executed(strategy, profit);
    }
    
    function _arbitrage(IERC20 token, uint256 amount, bytes memory path) internal {
        (address[] memory dexes, address[] memory tokens) = abi.decode(path, (address[], address[]));
        
        uint256 current = amount;
        address currentToken = address(token);
        
        for (uint256 i = 0; i < dexes.length; i++) {
            IERC20(currentToken).approve(dexes[i], current);
            
            if (dexes[i] == UNISWAP_V3) {
                current = _swapV3(currentToken, tokens[i], current);
            } else {
                current = _swapV2(dexes[i], currentToken, tokens[i], current);
            }
            
            currentToken = tokens[i];
        }
    }
    
    function _swapV2(address router, address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        uint256[] memory amounts = IUniswapV2Router02(router).swapExactTokensForTokens(
            amountIn,
            0,
            path,
            address(this),
            block.timestamp
        );
        
        return amounts[1];
    }
    
    function _swapV3(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256) {
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: 3000,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        
        return ISwapRouter(UNISWAP_V3).exactInputSingle(params);
    }
    
    function pause() external onlyOwner {
        cb.paused = true;
        emit Paused();
    }
    
    function unpause() external onlyOwner {
        cb.paused = false;
    }
    
    function withdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner, balance);
    }
    
    receive() external payable {}
}
```

### 4. Constructor Arguments

**Constructor Arguments (ABI-encoded)**:
```
000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8
```

### 5. Optimization Settings

**Optimization Enabled**: `Yes`

**Runs**: `200`

### 6. Submit

Click "Verify and Publish"

---

## 🔧 Alternative: Command Line Verification

If you have the PolygonScan API working properly:

```bash
cd /workspace/polygon-mev-bot/contracts

forge verify-contract \
  0x0CD75B9605ad928a47616a6a1549FC856c07dbB7 \
  src/generated/MEVExecutor.sol:MEVExecutor \
  --chain-id 137 \
  --constructor-args 000000000000000000000000ba12222222228d8ba445958a75a0704d566bf2c8 \
  --etherscan-api-key $POLYGONSCAN_API_KEY
```

---

## ✅ After Verification

Once verified, your contract will show:
- ✅ Green checkmark on PolygonScan
- 📝 Source code publicly visible
- 🔍 "Read Contract" and "Write Contract" tabs
- 📊 Enhanced transparency and trust

---

**Contract Address**: `0x0CD75B9605ad928a47616a6a1549FC856c07dbB7`
**PolygonScan**: https://polygonscan.com/address/0x0CD75B9605ad928a47616a6a1549FC856c07dbB7

**Status**: ✅ Deployed & Ready (Verification Pending)
