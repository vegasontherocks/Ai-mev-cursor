# Troubleshooting Guide (Reality-Based)

Use this guide to diagnose the most common failures when working toward a verifiable Polygon MEV bot. Each section lists the symptoms you are likely to see today and the mitigation steps to unblock progress.

## 1. Before You Troubleshoot

- Confirm environment variables:
  ```bash
  grep -E "THIRDWEB|PRIVATE_KEY|POLYGON" .env
  ```
- Inspect the generated contracts directory:
  ```bash
  ls -1 contracts/src/generated
  ```
  You should see **six** files. If not, start with [Issue 2](#issue-missing-generated-adapters).

## 2. Contract Generation & Compilation

### Issue: Missing Generated Adapters
- **Symptoms**: `ls contracts/src/generated` only shows `MEVExecutor.sol` and `Interfaces.sol`; `forge build` fails with `File not found: ... DEXAdapter.sol`.
- **Fix**:
  1. Re-run `./GENERATE_NOW.sh` and watch the console for Nebula errors.
  2. If Nebula omits files, inspect any output saved under `scripts/.nebula-cache` (if enabled) or the terminal log.
  3. Manually implement the missing adapters (`DEXAdapter.sol`, `AaveAdapter.sol`, `JITAdapter.sol`, `OracleLib.sol`) when Nebula cannot deliver them. Document deviations so the prompts can be updated later.

### Issue: Thirdweb SDK / Nebula Errors (`Missing required environment variable` or `Thirdweb SDK wallet call() method unavailable`)
- **Symptoms**: The generator exits immediately with configuration errors.
- **Fix**:
  - Ensure `.env` contains `PRIVATE_KEY`, `THIRDWEB_SECRET_KEY`, and `THIRDWEB_CLIENT_ID`.
  - Verify the SDK version in `scripts/package.json`; update via `npm install @thirdweb-dev/sdk@latest` if the wallet `call` helper is missing.

### Issue: Generation Succeeds but Files Contain Empty Bodies
- **Symptoms**: Generated file exists but lacks `pragma` or contract code; downstream compilation fails with parser errors.
- **Fix**: Delete the empty file, re-run the generator, and confirm the file includes `pragma solidity` plus the expected contract/library body. The generator now fails automatically when any output is empty thanks to `scripts/validate-generated-contracts.mjs`, which exits with errors like `AaveAdapter.sol appears to be empty or truncated`.

## 3. Foundry Builds & Tests

### Issue: `forge build` Fails Because Imports Cannot Be Resolved
- **Symptoms**: Errors such as `CompilerError: Source "../src/generated/DEXAdapter.sol" not found`.
- **Fix**: Regenerate or create the missing generated adapters. The new `GeneratedContractsPresenceTest` intentionally imports every generated file so compilation fails until all six are present.

### Issue: Adapter Interfaces Change Between Runs
- **Symptoms**: Tests that reference functions in the adapters fail to compile after regeneration.
- **Fix**: Stabilise the prompts or manually maintain the adapter interfaces. Consider pinning adapter ABI surface area in mocks/tests so you notice contract drift early.

### Issue: `forge test` Hangs or Reverts Inside `MEVExecutor.t.sol`
- **Symptoms**: Tests never finish because mocks expect functionality that the real contract does not implement.
- **Fix**: Update the mocks/test expectations to match the actual executor implementation. Focus on ensuring circuit breaker defaults, ownership flows, and basic flash-loan repayment logic behave as expected until adapters exist.

## 4. Agent & MCP Pipeline

### Issue: `TypeError: callTool is not a function` or Stubbed Responses
- **Symptoms**: `npm start` prints that the agent fell back to heuristics or cannot contact Nebula.
- **Fix**: Implement the real HTTP client in `eliza-agent-ai/src/services/thirdweb-nebula-integration.ts`, calling `POST https://api.thirdweb.com/ai/chat` with the documented headers. Add error logging that surfaces HTTP status codes.

### Issue: RL Model Missing (`ENOENT: no such file or directory, open 'models/ppo_agent.onnx'`)
- **Symptoms**: Agent falls back to placeholder strategies.
- **Fix**: Supply the ONNX model locally, adjust configuration to point to the downloaded path, or modify the agent to download and cache the model during startup. Do not enable live execution until the model load succeeds.

### Issue: MCP Client Fails to Connect (`ECONNREFUSED 127.0.0.1:7001`)
- **Symptoms**: Agent startup stops at “Connecting to MCP server…”.
- **Fix**: Start the MCP server (`npm run start` inside `mcp-servers/polygon-blockchain`) or update `mcp-config.json` to use the official `@thirdweb-dev/mcp-server` endpoint with valid credentials.

## 5. Deployment & Runtime Checks

### Issue: `forge script` Deployment Fails Because Constructor Arguments Differ
- **Symptoms**: `TypeError: wrong number of arguments to constructor`.
- **Fix**: Keep `DeployGenerated.s.sol` synchronized with the regenerated `MEVExecutor` constructor signature. If you customize the executor, update both the deployment script and the tests that assert constructor behaviour.

### Issue: Dry-Run Transactions Attempt On-Chain Sends
- **Symptoms**: Agent tries to broadcast despite `DRY_RUN=true`.
- **Fix**: Double-check `.env` across the project (`root`, `eliza-agent`, `eliza-agent-ai`) for mismatched values. Guard every execution path with `ALLOW_EXECUTION` / `ALLOW_NEBULA_EXECUTION` booleans when wiring the agent pipeline.

## 6. Diagnostics Commands

Use these when filing issues or updating the verification matrix:

```bash
# List required generated artifacts
ls -1 contracts/src/generated

# Run the post-generation validator
node scripts/validate-generated-contracts.mjs

# Run the generator with verbose logging
DEBUG=nebula ./GENERATE_NOW.sh

# Build and run tests
cd contracts
forge clean && forge build
forge test -vv

# Check agent dependencies
cd ../eliza-agent-ai
npm ls @thirdweb-dev/sdk
node -e "console.log(require('path').resolve('models/ppo_agent.onnx'))"

# Validate MCP connectivity
curl -i http://localhost:7001/health || echo "MCP offline"
```

## 7. When to Stop and Reassess

Pause active development and capture findings in the verification matrix when:

- Contract generation fails repeatedly or produces code that will not compile even after pruning markdown artefacts.
- Foundry tests reveal logic gaps (e.g., no repayment inside `receiveFlashLoan`) that require architectural changes.
- The agent runs without the RL model or Nebula connectivity—continuing without these makes subsequent logs misleading.

Document the exact error output, commands executed, and any manual edits made. This context is critical for updating prompts, adjusting the roadmap, and avoiding regressions once CI enforces generation completeness.
