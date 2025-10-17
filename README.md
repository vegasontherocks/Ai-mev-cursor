# AI-Powered MEV Bot

An autonomous MEV (Maximal Extractable Value) bot powered by AI, featuring:

- 🤖 **AI Strategy Selection**: Reinforcement learning + LLM reasoning
- ⚡ **Thirdweb Nebula Integration**: Blockchain-native LLM for contract generation and execution
- 🔌 **MCP Servers**: Model Context Protocol for blockchain tools
- 🎯 **Multi-Strategy**: Arbitrage, JIT liquidity, liquidations, backrunning
- 🔒 **Production Ready**: Comprehensive testing, safety controls, monitoring

## Quick Start

```bash
cd polygon-mev-bot
./quick-setup.sh
```

This automated setup will:
1. Install all dependencies
2. Setup RL model (placeholder for development)
3. Verify system is ready
4. Show next steps

## Documentation

- **[polygon-mev-bot/SETUP_GUIDE.md](polygon-mev-bot/SETUP_GUIDE.md)** - Comprehensive setup instructions
- **[polygon-mev-bot/IMPLEMENTATION_STATUS.md](polygon-mev-bot/IMPLEMENTATION_STATUS.md)** - Current implementation status
- **[polygon-mev-bot/README.md](polygon-mev-bot/README.md)** - Main project documentation
- **[polygon-mev-bot/WHAT_TO_RUN.txt](polygon-mev-bot/WHAT_TO_RUN.txt)** - Quick reference

## Project Structure

```
polygon-mev-bot/
├── contracts/           # Foundry smart contracts
│   ├── src/generated/  # 6 AI-generated contracts (MEVExecutor, adapters, etc.)
│   ├── script/         # Deployment scripts
│   └── test/           # Contract tests
├── eliza-agent-ai/     # Main AI agent
│   ├── src/            # Agent source code
│   ├── scripts/        # Setup and verification scripts
│   └── models/         # RL model (placeholder by default)
├── scripts/            # Contract generation utilities
└── mcp-servers/        # Local MCP server
```

## Features

### Smart Contracts
- ✅ MEVExecutor with flash loan support (Balancer, Aave)
- ✅ DEX adapters (Uniswap V2/V3, SushiSwap, QuickSwap)
- ✅ Aave V3 liquidation adapter
- ✅ Uniswap V3 JIT liquidity adapter
- ✅ Oracle price validation

### AI Agent
- ✅ Opportunity detection from mempool
- ✅ AI-powered analysis (LLM + RL model)
- ✅ Strategy selection with confidence scoring
- ✅ Simulation and execution
- ✅ Continuous learning from outcomes

### Infrastructure
- ✅ Thirdweb Nebula blockchain LLM integration
- ✅ MCP server for blockchain tools
- ✅ Comprehensive monitoring and metrics
- ✅ DRY_RUN mode for safe testing
- ✅ CI/CD with automated verification

## Requirements

- Node.js v20+
- npm v10+
- Foundry (for contract compilation)
- Thirdweb API credentials
- Polygon RPC endpoint
- LLM API key (OpenAI or Anthropic)

## Safety Features

⚠️ **Critical Safety Controls:**
- `DRY_RUN` mode prevents real transactions
- `ALLOW_EXECUTION` flag requires explicit opt-in
- Kelly criterion for position sizing
- Gas price limits
- Slippage protection
- Oracle price validation

## Next Steps

1. **Setup**: Run `./quick-setup.sh` in `polygon-mev-bot/`
2. **Configure**: Copy `.env.example` to `.env` and add your credentials
3. **Build**: Run `npm run build`
4. **Test**: Start with `DRY_RUN=true npm start`
5. **Deploy**: Deploy contracts to testnet first
6. **Monitor**: Watch logs, metrics, and performance

## Status

- ✅ All infrastructure implemented
- ✅ All contracts generated (6/6)
- ✅ TypeScript builds successfully
- ✅ Verification system passes
- ⚠️ Requires user credentials
- ⚠️ RL model is placeholder (train for production)

See [IMPLEMENTATION_STATUS.md](polygon-mev-bot/IMPLEMENTATION_STATUS.md) for detailed status.

## Support

For issues, questions, or contributions, please refer to the documentation in `polygon-mev-bot/docs/` or see the setup guide.

## License

See LICENSE file for details.

## Security Warning

⚠️ **MEV trading carries significant risks. Start with testnet and small capital. Use at your own risk.**
