As of 2025-10-14, all contracts and tests build clean and pass; legacy docs/tests archived or restored in `docs/archive/`. E2E agent pipeline validation pending.

## Polygon MEV Bot – Reality Guide

This repository contains a Foundry-based contract suite (`contracts/`) and an Eliza agent (`eliza-agent-ai/`) that orchestrate Polygon MEV strategies (flash loans, arbitrage, liquidations, and Uniswap v3 JIT liquidity). The project has been brought to a lint-clean state with comprehensive tests, but production readiness still requires operational validation.

### Repository Layout

| Path | Purpose |
| --- | --- |
| `contracts/` | Foundry workspace with generated executor/adapters and tests |
| `docs/` | Authoritative setup & troubleshooting guides |
| `eliza-agent-ai/` | Primary agent, MCP integration, and opportunity pipeline |
| `mcp-servers/` | Local MCP server (Polygon blockchain tooling) |
| `scripts/` | Nebula contract generation utilities |

Historical marketing documents in the root folder have been removed from `main`; rely on `docs/` for verified guidance.

### Current Status

- ✅ `forge build` and `forge test` run silently (no warnings) when the generated contracts and adapters are present.
- ✅ All Solidity sources import specific symbols from `Interfaces.sol` (named imports only) to keep Foundry lint quiet.
- ✅ `eliza-agent-ai` actions emit structured success/failure events for both dry-run and live execution paths.
- ⚠️ End-to-end (agent → simulation → live send) still needs validation on forks/live infrastructure—see **Operational Checklist** below.

### Development Standards

1. **Named Imports Required** – Always import only the interfaces you use:
   ```solidity
   import { IERC20, IVault } from "./Interfaces.sol";
   ```
   Wildcard imports trigger Foundry lint failures in CI.

2. **Router `WETH()` Handling** – The legacy `IUniswapV2Router02.WETH()` signature has been removed because it is unused. If a future update needs it:
   - reintroduce the method in `Interfaces.sol`,
   - add `// forge-ignore-next-line mixed-case-function` above it,
   - ensure every caller is covered by tests.

3. **Testing Discipline** – Any contract or adapter change must keep `forge fmt`, `forge build`, and `forge test` (at least `-vv`) green. Add regression tests in `contracts/test/` for new behaviours.

4. **Secrets** – `.env` stays untracked. Use `polygon-mev-bot/.env.example` (now sanitized) as the template and never commit real keys.

See `docs/QUICK_START.md` for the full dev flow and troubleshooting tips.

### Operational Checklist

Before calling the stack production-ready, work through the validation plan (documented in `docs/QUICK_START.md` and `docs/TROUBLESHOOTING.md`):

1. **Opportunity Detection** – Run the Eliza/Nebula agent on a fork or live mempool feed and confirm real opportunities are ranked with profit estimates.
2. **Bundle Creation** – Ensure every detected opportunity yields executable calldata with correct ordering, slippage, and token accounting.
3. **Execution Pipeline** – Exercise the full path (simulation → `executeMEV`) both in `DRY_RUN` and live modes, capture latency, and flag reverts immediately.
4. **Flash Loan & JIT Scenarios** – Simulate profitable price windows to ensure the adapters settle net-positive and repayments return to the executor wallet.
5. **Resilience** – Validate recovery after missed opportunities, simulation failures, and reverted live transactions.

### Thirdweb MCP Integration

The agent now supports both the local Polygon MCP server and Thirdweb’s hosted MCP endpoint:

1. Populate `THIRDWEB_SECRET_KEY` in your `.env` (never commit real values).
2. Update `eliza-agent-ai/mcp-config.json` (done in this branch) so the agent knows about the remote MCP.
3. Run the new smoke script (see below) or call `ThirdwebMCPIntegration.callTool("listServerWallets", {})` to verify connectivity.

Refer to `docs/QUICK_START.md` for the command sequence and troubleshooting.

### Structured Execution Logs

`eliza-agent-ai/src/actions/executeMEV.ts` now records JSON-formatted events for:

- simulations (`SIMULATION_RESULT`),
- dry-run skips (`DRY_RUN_SKIP`),
- live submissions (`TX_SUBMITTED`),
- mined transactions (`TX_MINED`),
- failures (`TX_FAILED`).

Events are both logged via `elizaLogger` and persisted as memories, making them easy to scrape for dashboards/alerting.

### Quick Commands

```bash
# Contracts
cd contracts
forge fmt
forge build
forge test

# Agent (after `npm install` in each workspace)
cd ../eliza-agent-ai
npm start -- --dry-run           # honour DRY_RUN=true
npm run smoke:mcp                # sample MCP call (see package.json)
```

### Need More Detail?

- `docs/QUICK_START.md` – step-by-step setup, regeneration, and validation guidance.
- `docs/TROUBLESHOOTING.md` – known failure modes and investigation tips.
- `.github/copilot-instructions.md` – verification matrix for tracking project readiness.

Contributions should leave the repository lint-clean, keep the Foundry suite green, and document any workflow changes so the team can reproduce results.
