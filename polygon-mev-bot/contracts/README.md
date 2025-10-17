## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
# Configure .env with PRIVATE_KEY and BALANCER_VAULT_ADDRESS (and optional MEV_* overrides)
$ forge script script/Deploy.s.sol:DeployMEVExecutor \
	--rpc-url <your_rpc_url> \
	--broadcast \
	--legacy
```

The deployment scripts under `script/` are aligned with `src/generated/MEVExecutor.sol` and accept the
following environment variables:

- `PRIVATE_KEY` – funded deployer key used for broadcasting
- `BALANCER_VAULT_ADDRESS` – Balancer vault that supplies flash loans on the target network
- `MEV_MIN_PROFIT`, `MEV_MAX_LOSS`, `MEV_DAILY_LIMIT` – optional overrides for runtime circuit breaker tuning

Use `forge script --dry-run` against a forked RPC endpoint to validate constructor arguments and post-deploy
configuration before wiring the address into the bot stack.

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
