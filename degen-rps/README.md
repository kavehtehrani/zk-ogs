# DegenRPS

A winner-takes-all Rock Paper Scissors game contract built with Foundry.

## Overview

DegenRPS is a simple smart contract that facilitates Rock Paper Scissors games between two players using ERC20 tokens. The game uses a commit-reveal scheme where:

1. **Maker** creates a game by betting X amount of ERC20 tokens and posting a commitment hash (keccak256 of their move + salt)
2. **Player2** (taker) joins the game by betting the same amount of the same token and posting their move directly
3. **Maker** reveals their move within a time window
4. The contract settles the winner (winner takes all, or both players get refunded on a tie)

## Features

- Commit-reveal scheme for maker's move (prevents front-running)
- Winner-takes-all payout
- Tie handling (both players refunded)
- Timeout protection (maker must reveal within 1 hour, or player2 can claim refund)
- Refund mechanism if player2 doesn't join

## Contract Functions

### `createGame(address tokenAddress, uint256 betAmount, bytes32 commitment)`
Creates a new game. The maker bets `betAmount` of the specified token and commits to their move.

### `joinGame(uint256 gameId, Move move)`
Player2 joins an existing game by betting the same amount and revealing their move.

### `revealAndSettle(uint256 gameId, Move move, bytes32 salt)`
Maker reveals their move and the contract settles the game. Winner takes all, or both players get refunded on a tie.

### `refund(uint256 gameId)`
- If no player2 joined: Maker can refund their bet
- If maker didn't reveal in time: Player2 can claim both bets

### `getGame(uint256 gameId)`
Returns the full game struct.

### `getGamesWaitingForPlayer2()`
Returns an array of game IDs waiting for a player2 to join.

## Game Flow

1. Maker calls `createGame()` with token, bet amount, and commitment hash
2. Player2 calls `joinGame()` with the game ID and their move
3. Maker calls `revealAndSettle()` with their move and salt
4. Contract determines winner and distributes funds

## Testing

Run tests with:
```bash
forge test
```

All tests pass! ✅

## License

MIT
