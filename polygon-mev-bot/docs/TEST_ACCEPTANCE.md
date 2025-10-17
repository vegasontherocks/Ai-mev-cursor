# Test Acceptance Criteria

This document describes the minimal, actionable acceptance criteria for the contract and agent test-suite. It is intended to be used by developers and CI to determine readiness for further operational validation.

1) Build / Lint
- Command: `cd contracts && forge fmt && forge build`
- Acceptance: build completes with zero compiler errors and `forge fmt` makes no changes.

2) Unit & Integration Tests
- Command: `cd contracts && forge test -vv`
- Acceptance: All tests in `contracts/test/` pass.
- If tests fail, record failing test names and add issues describing the fixes.

3) Generated Contracts Presence (smoke)
- Command: `node scripts/validate-generated-contracts.mjs` (or see `scripts/` alternatives)
- Acceptance: At least 6 generated artifacts present in `contracts/src/generated/`. Tests include `GeneratedContractsPresence.t.sol`.

4) Agent Dry-Run Pipeline
- Startup: `cd eliza-agent-ai && npm ci && npm start -- --dry-run`
- Acceptance: Agent starts, connects to MCP (local or Thirdweb), performs at least one `SIMULATION_RESULT` event within 60s, and emits structured JSON logs (see `eliza-agent-ai/src/actions/executeMEV.ts`).

5) MCP Smoke Test
- Command: `cd eliza-agent-ai && npm run smoke:mcp` (see package.json)
- Acceptance: Returns a successful JSON response or clear error with remediation steps.

6) Critical Safety Checks
- DRY_RUN gating works: when `DRY_RUN=true`, attempts to execute live transactions must be skipped and `DRY_RUN_SKIP` events emitted.
- Environment toggles: `ALLOW_EXECUTION` must default to `false` and prevent live sends.

7) Performance & Latency (Optional)
- Run a synthetic simulation and measure `simulation → bundle creation` latency. Record median and 95th percentile over 50 runs.

8) Documentation
- `polygon-mev-bot/README.md` and `docs/QUICK_START.md` must mention `.env.example` and basic setup steps.

Recording Results: Attach logs, failing tests, and a short remediation plan to the related issue or PR.
