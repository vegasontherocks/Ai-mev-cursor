# Action Plan: Prototype → Production MEV Bot

This plan splits work into phases, each with clear acceptance criteria, owners (TBD), estimated effort, and risks. Use it as the single source of truth for turning the prototype into an operational, profit-generating system.

Phases
------

1) Audit & Stabilize (1–2 weeks)
- Tasks:
  - Run `forge build` and `forge test -vv`. Fix any test regressions.
  - Ensure `contracts/src/generated/` contains at least the expected artifacts; implement missing adapters if generation fails.
  - Add missing `Interfaces.sol` symbols and small helper mocks used by tests.
- Acceptance: All tests pass locally and CI.
- Risks: Foundry or remapping issues; mitigation: keep changes small and add tests.

2) Environment & Secrets (0.5–1 day)
- Tasks:
  - Add `.env.example` (done).
  - Document required third-party credentials and keys.
- Acceptance: Developers can bootstrap a local environment following `README.md`.

3) MCP & Nebula Integration (1–2 weeks)
- Tasks:
  - Replace stubbed `ThirdwebMCPIntegration` with a real client or clearly documented local MCP server.
  - Add smoke tests to verify toolcall flows end-to-end.
  - Add retry/backoff for transient failures.
- Acceptance: Smoke test passes against both local MCP server and Thirdweb hosted MCP.
- Risks: API changes in Nebula/Thirdweb; mitigation: pin SDK versions and integration tests.

4) Agent Decision Pipeline (2–3 weeks)
- Tasks:
  - Ensure Nebula responses are wired into `analyzeOpportunity`, `selectStrategy`, and `executeMEV`.
  - Preserve `DRY_RUN` and `ALLOW_EXECUTION` gates; log decisions and simulation results.
  - Add end-to-end tests that simulate a profitable arbitrage/liquidation and verify proposal creation.
- Acceptance: Agent can detect an opportunity, create a bundle, simulate it, and produce a ready-to-send transaction payload.

5) On-chain Execution Safety & Risk Controls (1–2 weeks)
- Tasks:
  - Implement Kelly-sizing or conservative position sizing for bundles.
  - Add on-chain checks and OracleLib (price sanity) to prevent feeding bad prices.
  - Add circuit breakers for gas price, slippage, and account balance thresholds.
- Acceptance: Live execution runs only when checks pass; tests cover these checks.

6) Deployment & Monitoring (1 week)
- Tasks:
  - Harden deployment scripts (`contracts/script/Deploy*.s.sol`) and document `forge script --verify` steps.
  - Add observability: structured logs, metrics, and alerting (Sentry/Tenderly integration optional).
  - Run staged rollout: dry-run on fork → limited live with small capital → scale.
- Acceptance: Deployment runs reliably; alerts trip on errors and key metrics are recorded.

7) Production Ramp & Performance Tuning (ongoing)
- Tasks:
  - Capture latency metrics (simulation-to-send), monitor profitability per-opportunity, and tune gas/ordering.
  - Iterate strategy selection thresholds, trading edge cases, and risk parameters.
- Acceptance: Positive PnL across a statistically significant sample (e.g., 30 days) and sustainable risk metrics.

Safety & Compliance
-------------------
- Keep `.env` out of git and use vaults for production keys.
- Run human-in-the-loop checks for the first 100 live bundles.
- Set emergency disable flags that immediately stop live execution.

Short-term next steps (this sprint)
----------------------------------
1. Merge `.env.example`, `TEST_ACCEPTANCE.md`, and `ACTION_PLAN.md` to `main`.
2. Run `forge build` and `forge test -vv`. Document failures.
3. Implement or stub missing adapters so compile passes.
4. Add MCP smoke-test script (see `scripts/`).

Appendix: Contact / owners
- Assign owners to each phase and list expected reviewers for code & ops (TBD).
