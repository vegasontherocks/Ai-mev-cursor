# Quick Start – Current Reality

This repository is **not** turnkey. Use this checklist to bring the Polygon MEV bot up to a verifiable baseline while closing the known gaps.

## 0. Reality Check Before You Touch Anything

- Only `MEVExecutor.sol` and `Interfaces.sol` exist under `contracts/src/generated/`. The adapters (`DEXAdapter.sol`, `AaveAdapter.sol`, `JITAdapter.sol`, `OracleLib.sol`) are missing and must be regenerated or implemented manually.
- `scripts/generate-contracts-with-nebula.ts` does not currently enforce success criteria; it can report success even when Nebula fails to return all artifacts.
- The Eliza agent's Nebula client (`eliza-agent-ai/src/services/thirdweb-nebula-integration.ts`) still contains a stubbed `callTool` implementation.
- The RL model (`models/ppo_agent.onnx`) referenced in the agent is absent; executions fall back to heuristics.
- Documentation files outside `docs/` are historical marketing drafts—treat them as unverified until replaced.

## 1. Prerequisites

- Node.js 18+, npm, and Foundry (`forge`, `cast`).
- Thirdweb credentials with access to the `/ai/chat` and contract tooling APIs (`THIRDWEB_SECRET_KEY`, `THIRDWEB_CLIENT_ID`).
- Polygon RPC + WebSocket endpoints, PolygonScan API key, funded wallet private key.
- Optional: Tenderly or a dedicated simulation RPC for dry runs.

### Solidity & Lint Standards

- All contracts must import explicit symbols from `Interfaces.sol` (e.g. `import { IERC20 } from "./Interfaces.sol";`). Wildcard imports now fail CI lint checks.
- The legacy `IUniswapV2Router02.WETH()` method has been removed because it was unused. If you reintroduce it, add `// forge-ignore-next-line mixed-case-function` above the declaration and cover the call path with tests.
- `forge build` should complete without warnings. Treat warnings as build failures.

## 2. Configure Environment Variables

1. Copy `.env.example` to `.env` at the repo root and replace every placeholder value. Keys you **must** supply:
   - `POLYGON_RPC_URL`, `POLYGON_WSS_URL`
   - `PRIVATE_KEY`, `WALLET_ADDRESS`
   - `THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY`
   - `POLYGONSCAN_API_KEY`
   - `DRY_RUN=true`, `ALLOW_EXECUTION=false` until you finish testing
2. Mirror any shared variables to `eliza-agent/.env` and `eliza-agent-ai/.env`.

## 3. Install Dependencies

```bash
# From repo root
foundryup                         # installs/updates Forge & Cast

cd scripts
npm install                       # Nebula tooling

cd ../eliza-agent-ai
npm install                       # agent + MCP client

cd ../eliza-agent
npm install                       # legacy agent (keep in sync)

cd ..
```

## 4. Regenerate or Implement Contracts

1. Run the generator:
   ```bash
   ./GENERATE_NOW.sh
   ```
2. Inspect `contracts/src/generated/`. The quick sanity check should show **at least six** Solidity files. If fewer files are produced, you must:
   - Review the Nebula response logs under `scripts/.nebula-cache` (if enabled) or console output.
   - Re-run generation with corrected prompts/credentials, **or** implement the missing adapters manually following the contract suite plan in `.github/copilot-instructions.md`.
3. Document any manual edits so tests can assert the presence of all required adapters.

## 5. Build and Test

```bash
cd contracts
forge fmt
forge build
forge test -vv
```

- Add targeted tests in `contracts/test/MEVExecutor.t.sol` (and new adapter test files) that exercise flash loans, arbitrage routes, JIT liquidity, and liquidation flows once those contracts exist.
- Do not proceed to deployment until the test suite passes and gas reports look reasonable.
- The test harness now emits structured execution events—review the agent logs when failures occur to diagnose dry-run skips vs. on-chain reverts quickly.

## 6. Wire Up the Agent Stack

1. Replace the stubbed Nebula client in `eliza-agent-ai/src/services/thirdweb-nebula-integration.ts` with real calls to `https://api.thirdweb.com/ai/chat`, using the authentication rules from the Thirdweb API documentation.
2. Confirm `eliza-agent-ai/mcp-config.json` references both the local Polygon MCP server and the hosted Thirdweb MCP endpoint. The hosted entry should read `https://api.thirdweb.com/mcp?secretKey=${THIRDWEB_SECRET_KEY}` to avoid hard-coding secrets.
3. Run the smoke test after installing dependencies:
   ```bash
   cd eliza-agent-ai
   npm run smoke:mcp
   ```
   The script issues a `listServerWallets` request and reports latency/response status. Investigate any non-200 responses before enabling live execution.
4. Provide or download `models/ppo_agent.onnx`, or update the agent to make the model path configurable.
5. Keep `DRY_RUN=true` until the agent can simulate opportunities end-to-end without failing.

## 7. (Optional) Deployment Once Everything Passes

```bash
cd contracts
forge script script/DeployGenerated.s.sol \
  --rpc-url $POLYGON_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $POLYGONSCAN_API_KEY
```

- Set `MEV_EXECUTOR_ADDRESS` in all `.env` files after deployment.
- Run smoke tests against the deployed contract (e.g., read-only calls and guarded dry runs) before enabling `ALLOW_EXECUTION`.

## 8. Verification Checklist

- [ ] `contracts/src/generated/` contains the six expected contracts.
- [ ] `forge build` and `forge test -vv` succeed without warnings.
- [ ] Agent can reach the Thirdweb AI API and MCP server (check logs).
- [ ] RL model file is present and loaded without falling back to heuristics.
- [ ] Dry-run transaction simulations complete successfully.
- [ ] Documentation (including this file) reflects any local deviations.

## 9. Next Steps

1. Expand the Foundry test suite to cover each adapter and all execution guards.
2. Add CI checks that fail when fewer than six generated artifacts are present.
3. Document the Nebula generation process and troubleshooting results in `docs/TROUBLESHOOTING.md`.
4. Once end-to-end dry runs succeed, plan supervised live trials with minimal capital and full monitoring.

Keep logs of every change—you will need them to complete the verification matrix referenced in `.github/copilot-instructions.md`.
