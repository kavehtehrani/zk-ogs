# Script Workflow Guide

## Overview

This project includes deployment scripts for the RPS Hook on Uniswap V4. The scripts are designed to work with local Anvil development and can be adapted for testnets/mainnets.

## Quick Start (Local Anvil)

```bash
# 1. Start Anvil in a separate terminal
anvil

# 2. Run complete setup (deploys everything)
just setup
```

This will:
1. Deploy test tokens
2. Deploy V4 infrastructure (PoolManager, PositionManager, Router)
3. Deploy RPSHook
4. Create a pool with the hook
5. Add initial liquidity

## Manual Step-by-Step

If you prefer to run steps individually:

```bash
# 1. Deploy test tokens
just deploy-tokens

# 2. Deploy V4 infrastructure
just deploy-v4

# 3. Deploy the hook
just deploy-hook

# 4. Create pool and add liquidity
just create-pool

# 5. (Optional) Add more liquidity
just add-liquidity

# 6. Execute swaps
just swap                    # Regular swap
just swap-rps 0x1234...     # RPS game swap with commitment hash
```

## Script Files

### `script/00_DeployTokens.s.sol`
- Deploys two test ERC20 tokens for local development
- Mints tokens to the deployer
- **Note**: Token addresses are saved and can be used via `TOKEN0_ADDRESS` and `TOKEN1_ADDRESS` env vars

### `script/00_DeployHook.s.sol`
- Mines a salt to find a hook address with correct flags
- Deploys RPSHook using CREATE2
- **Requires**: `POOL_MANAGER_ADDRESS` env var (or will deploy new one)
- **Saves**: Hook address to `.hook_address` file

### `script/testing/00_DeployV4.s.sol`
- Deploys V4 infrastructure (PoolManager, PositionManager, Router)
- Only works on local Anvil (chainid 31337)
- **Saves**: Addresses to `.pool_manager_address`, `.position_manager_address`, `.router_address`

### `script/01_CreatePoolAndAddLiquidity.s.sol`
- Creates a new pool with the hook
- Adds initial liquidity (100e18 of each token by default)
- **Requires**: `HOOK_ADDRESS`, `POOL_MANAGER_ADDRESS`, `POSITION_MANAGER_ADDRESS`, `ROUTER_ADDRESS` env vars
- **Uses**: `BaseScriptWithAddresses` to reuse deployed infrastructure

### `script/02_AddLiquidity.s.sol`
- Adds more liquidity to an existing pool
- **Requires**: Same as above

### `script/03_Swap.s.sol`
- Executes a swap in the pool
- Supports regular swaps and RPS game swaps with commitment hash
- **Requires**: Same as above
- **Optional**: `COMMITMENT_HASH` env var for RPS game

## Environment Variables

The scripts use environment variables for configuration:

- `HOOK_ADDRESS` - Address of deployed RPSHook
- `POOL_MANAGER_ADDRESS` - Address of V4 PoolManager
- `POSITION_MANAGER_ADDRESS` - Address of V4 PositionManager
- `ROUTER_ADDRESS` - Address of V4 Router (base router, not SenderRelayRouter)
- `TOKEN0_ADDRESS` - Address of token0 (optional, has defaults)
- `TOKEN1_ADDRESS` - Address of token1 (optional, has defaults)
- `COMMITMENT_HASH` - Commitment hash for RPS game swaps (optional)
- `RPC_URL` - RPC URL (defaults to `http://localhost:8545`)
- `PRIVATE_KEY` - Private key for signing (defaults to Anvil's first account)

## Address Files

The Justfile automatically saves and loads addresses from files:

- `.hook_address` - Deployed hook address
- `.pool_manager_address` - Deployed PoolManager address
- `.position_manager_address` - Deployed PositionManager address
- `.router_address` - Deployed Router address

These are automatically created when you run `just deploy-hook` and `just deploy-v4`.

## Important Notes

1. **V4 Infrastructure**: Must be deployed once and reused. Each script run creates new instances if addresses aren't provided.

2. **Hook Deployment**: The hook must be deployed with the same PoolManager address that will be used for pools. Use `POOL_MANAGER_ADDRESS` when deploying the hook.

3. **Token Addresses**: For local Anvil, tokens are deployed fresh. Update `BaseScript.sol` defaults or use `TOKEN0_ADDRESS`/`TOKEN1_ADDRESS` env vars.

4. **Private Key**: For local Anvil, the default private key is Anvil's first account. For other networks, use `--account` with a keystore name instead.

5. **Script Order**: The correct order is:
   - Deploy tokens
   - Deploy V4 infrastructure
   - Deploy hook (with POOL_MANAGER_ADDRESS)
   - Create pool
   - Add liquidity / swap

## Troubleshooting

- **"PoolNotInitialized"**: Make sure you've run `just create-pool` first
- **"NotPoolManager"**: The hook was deployed with a different PoolManager. Redeploy the hook with the correct `POOL_MANAGER_ADDRESS`
- **"call to non-contract address"**: Tokens aren't deployed. Run `just deploy-tokens` first
- **"Hook contract not set"**: Set `HOOK_ADDRESS` env var or run `just deploy-hook` first
