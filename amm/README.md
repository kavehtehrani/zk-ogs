# Rock-Paper-Scissors Hook for Uniswap v4

A custom Uniswap v4 hook that enables Rock-Paper-Scissors gameplay integrated directly into token swaps. Players can engage in RPS matches by including their choice with their swap, creating a gamified trading experience with prize pools.

## Overview

The RPS Hook transforms standard token swaps into interactive Rock-Paper-Scissors games. When two players submit matching swap amounts with their RPS choices, the hook:

- Matches orders at 95% swap rate (Coincidence of Wants / CoW)
- Determines the winner based on RPS rules
- Distributes a 10% prize pool (5% from each player) to the winner
- Issues claim tokens for the 95% swap amount to both players

## How It Works

### Game Flow

1. **First Player**: Submits a swap with their RPS position (Rock, Paper, or Scissors) encoded in the `hookData`
   - Input tokens are taken (95% held as claim tokens, 5% reserved for prize pool)
   - A pending order is created, waiting for a matching swap

2. **Second Player**: Submits a matching swap amount with their RPS position
   - Orders are automatically matched (CoW)
   - RPS game is resolved
   - Winner receives 10% prize (5% + 5%)
   - Both players receive claim tokens for 95% of their swap amount

3. **Claim Redemption**: Players can redeem their claim tokens to receive their swap output tokens

### RPS Positions

RPS positions are encoded as `uint8` values:
- `1` = Rock (binary: 100)
- `2` = Paper (binary: 010)
- `3` = Scissors (binary: 001)

### Game Rules

- **Rock beats Scissors**
- **Paper beats Rock**
- **Scissors beats Paper**
- **Tie**: Prize pool is held by the hook contract (can be split or handled separately)

## Features

- ✅ **Order Matching**: Automatic matching of orders with identical swap amounts
- ✅ **CoW Swaps**: 95% swap execution when orders match (Coincidence of Wants)
- ✅ **Claim Token System**: ERC6909-like claim tokens for delayed token redemption
- ✅ **Prize Distribution**: Automatic winner determination and prize allocation
- ✅ **Multi-Pool Support**: Single hook contract can service multiple pools

## Architecture

### Core Components

- **RPSHook.sol**: Main hook contract implementing the RPS game logic
- **Order Matching**: Pending orders stored and matched based on swap parameters
- **Claim Token System**: Tracks user claims for swap outputs
- **Token Custody**: Hook holds tokens until claim redemption

### Hook Permissions

The hook uses the following Uniswap v4 hook permissions:
- `beforeSwap`: Validates RPS position and checks for matching orders
- `afterSwap`: Processes order creation and matching logic
- `afterSwapReturnDelta`: Modifies swap deltas to handle token custody

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (stable version recommended)
- Node.js and npm (for dependencies)

### Installation

```bash
# Install dependencies
forge install

# Build the project
forge build

# Run tests
forge test
```

## Usage

### Encoding RPS Position

When performing a swap, encode your RPS position in the `hookData`:

```solidity
// Rock = 1, Paper = 2, Scissors = 3
bytes memory hookData = abi.encode(uint8(1)); // Rock
```

### Performing a Swap

```solidity
swapRouter.swapExactTokensForTokens({
    amountIn: 1e18,
    amountOutMin: 0,
    zeroForOne: true,
    poolKey: poolKey,
    hookData: abi.encode(uint8(1)), // RPS position
    receiver: msg.sender,
    deadline: block.timestamp + 1
});
```

### Redeeming Claims

After a matched swap, players can redeem their claim tokens:

```solidity
hook.redeemClaim(poolKey, claimTokenId);
```

## Deployment

### Local Development with Anvil

1. Start a local Anvil node:

```bash
anvil
```

2. Deploy the hook:

```bash
forge script script/00_DeployHook.s.sol \
    --rpc-url http://localhost:8545 \
    --private-key <PRIVATE_KEY> \
    --broadcast
```

### Production Deployment

1. Configure your deployment parameters in `script/base/BaseScript.sol`

2. Deploy using your keystore:

```bash
forge script script/00_DeployHook.s.sol \
    --rpc-url <YOUR_RPC_URL> \
    --account <YOUR_KEYSTORE_NAME> \
    --sender <YOUR_WALLET_ADDRESS> \
    --broadcast
```

### Contract Verification

```bash
forge verify-contract \
  --rpc-url <RPC_URL> \
  --chain <CHAIN_NAME_OR_ID> \
  --verifier <VERIFICATION_PROVIDER> \
  --verifier-api-key <API_KEY> \
  --constructor-args <ABI_ENCODED_ARGS> \
  --num-of-optimizations <OPTIMIZER_RUNS> \
  <CONTRACT_ADDRESS> \
  src/RPSHook.sol:RPSHook
```

## Configuration

Before deploying, update the following in `script/base/BaseScript.sol`:

- `token0` and `token1`: Token addresses for your target network
- Swap amounts in `script/01_CreatePoolAndAddLiquidity.s.sol`
- Swap parameters in `script/03_Swap.s.sol`

## Testing

Run the test suite:

```bash
# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test
forge test --match-test testMatchOrders
```

## Technical Details

### Token Flow

1. **Unmatched Order**: 
   - Input tokens: Taken from swapper
   - Output tokens: 0 (held as claim tokens)
   - Prize: 5% reserved

2. **Matched Order**:
   - Input tokens: Taken from second swapper
   - Output tokens: Distributed via claim tokens (95% each)
   - Prize: 10% to winner

### Claim Token System

The hook implements an ERC6909-like claim token system:
- Each claim is assigned a unique token ID per pool
- Users can check their claim balance: `getClaimBalance(poolKey, claimTokenId, owner)`
- Claims are redeemed 1:1 for the underlying currency

### Security Considerations

- Orders are matched based on exact amount and direction
- RPS positions are validated before processing
- Claim tokens prevent double-spending
- Hook balances are tracked separately per pool

## Troubleshooting

### Hook Deployment Failures

If deployment fails, verify:
1. Hook flags match `getHookPermissions()` return value
2. Salt mining uses the correct deployer address
3. For scripts: deployer must be CREATE2 Proxy (`0x4e59b44847b379578588920cA78FbF26c0B4956C`)

### Anvil Code Size Limits

If tests fail on Anvil due to code size:

```bash
anvil --code-size-limit 40000
```

### Permission Denied on Install

If `forge install` fails:
- Ensure SSH keys are configured for GitHub
- Or use HTTPS remappings in `foundry.toml`

## License

MIT

## Resources

- [Uniswap v4 Documentation](https://docs.uniswap.org/contracts/v4/overview)
- [Uniswap v4 Core](https://github.com/uniswap/v4-core)
- [Uniswap v4 Periphery](https://github.com/uniswap/v4-periphery)
- [v4 by Example](https://v4-by-example.org)
