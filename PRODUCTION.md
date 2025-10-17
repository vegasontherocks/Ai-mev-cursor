Production readiness checklist and safe deployment steps

1) Environment and secrets
  - Provide a .env with POLYGON_RPC_URL, PRIVATE_KEY, MEV_EXECUTOR_ADDRESS
  - Keep PRIVATE_KEY in a secrets manager (don't commit to repo)

2) DRY_RUN gating
  - Ensure DRY_RUN=true and ALLOW_EXECUTION=false in staging
  - Only set ALLOW_EXECUTION=true in a controlled environment after tests

3) CI
  - GitHub Actions `/.github/workflows/ci.yml` runs `forge build`, `forge test`, and Node build
  - Add `POLYGON_RPC_URL` and `MEV_EXECUTOR_ADDRESS` in repo secrets for optional preflight

4) Preflight and simulation
  - Use `npm run preflight:sim` to run an RPC-based deterministic preflight (estimateGas + eth_call)
  - Use `npm run smoke:encode` to validate calldata encoding

5) Rollout
  - Stage: run full suite against a fork or testnet with DRY_RUN=false but ALLOW_EXECUTION=false
  - Canary: configure a small wallet with limited funds and allow a single controlled execution
  - Production: enable ALLOW_EXECUTION=true after repeated green runs

6) Observability
  - Persist logs, tx hashes, and execution metrics for at least 30 days
  - Alert on unexpected reverts, gas spikes, or profit below threshold
