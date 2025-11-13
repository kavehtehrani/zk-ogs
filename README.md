# Uniswap V4 Hook with ZK Rock Paper Scissors Game

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![Solidity 0.8.20](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)
![Hardhat 3](https://img.shields.io/badge/Hardhat-3.0-fff100?logo=hardhat&logoColor=black) ![Noir](https://img.shields.io/badge/Noir-ZK-black?logo=aztec&labelColor=000000)
![Vite](https://img.shields.io/badge/Vite-4.x-646CFF?logo=vite)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js)

A fully functional zero-knowledge rock-paper-scissors game where Player 1 commits their move, Player 2 joins with their move directly, and Player 1 reveals with ZK proofs to resolve the game on-chain. Built with **Noir**, **Barretenberg**, **Hardhat 3**, and **Ethereum**.

## Overview

Each game unfolds alongside a Uniswap swap:

- **Player A** creates a game during the hook’s pre-swap phase, escrowing 5% (configurable) of the swap amount and submitting a commitment to their move (`keccak256(move || salt)`).
- **Player B** joins any open game by matching the stake and submitting their clear-text move; no commitment step is required.
- Once matched, **Player A** reveals their move plus salt along with a Noir-generated ZK proof that the outcome was computed correctly.
- The hook contract validates the commitment, verifies the ZK proof through the game manager contract, and pays the escrowed tokens to the winner (or slashes Player A if they fail to reveal before expiry).

**Current State:**

- ✅ Real ZK proofs generated client-side using NoirJS and Barretenberg backend
- ✅ Proofs verified locally before submission
- ✅ Commit-reveal scheme for Player 1 prevents front-running
- ✅ Player 2 submits move directly when joining (no commit/reveal needed)
- ⏳ On-chain proof verification (requires verifier contract generation)

## Technology Stack

### Zero-Knowledge Layer

- **Noir**: Defines the rock-paper-scissors circuit, including move validation and outcome computation.
- **Barretenberg (`@aztec/bb.js`)**: Generates UltraPLONK proofs that attest the circuit ran correctly.
- **NoirJS**: Bridges the browser to Noir so Player A can compile witnesses and proofs client-side.

### Game Manager Contracts

- **Solidity 0.8.20**: Implements the commit/reveal lifecycle, escrow bookkeeping, and proof verification interface.
- **Hardhat 3**: Provides compilation, testing, and deployment tooling for the core game logic.

1. **Player 2 joins** and submits their move directly to the contract
2. **Player 1 reveals their move** (move + salt) after Player 2 has joined
3. **Frontend computes expected winner** using the same logic as the contract
4. **Noir circuit executes** with both moves and winner as inputs
5. **Barretenberg backend generates a proof** proving the computation is correct
6. **Proof is verified locally** before sending to contract
7. **Proof is sent to contract** via `resolveGame()` (on-chain verification pending)

- **Solidity 0.8.20**: Extends Uniswap v4’s `IHooks` to siphon a configurable percentage of each swap into a game escrow, call into the manager contract, and release funds atomically with the swap outcome.
- **Hardhat 3**: Supplies the local fork environment and scripts used to exercise hook callbacks during development.

### Frontend Layer

1. **Player 1 Commit Phase**:

   - Player 1 generates random salt
   - Creates commitment: `keccak256(move || salt)`
   - Submits commitment hash to contract via `createGame()` (move is hidden)

2. **Player 2 Join Phase**:

   - Player 2 joins the game and submits their move directly via `joinGame()`
   - No commit/reveal needed for Player 2 (move is stored on-chain immediately)
   - Sets a deadline for Player 1 to reveal

3. **Player 1 Reveal Phase**:

   - Player 1 reveals move + salt via `resolveGame()`
   - Contract verifies `keccak256(move || salt) == commitment`
   - ZK proof generated proving winner calculation

4. **Resolution**:
   - Contract's `_resolveGame()` determines winner
   - ZK proof proves this calculation is correct

## Game Flow

```
Player 1                     Contract                    Player 2
   |                            |                            |
   |-- createGame(commitment) ->|                            |
   |                            |                            |
   |                            |<-- joinGame(move) ------|
   |                            |    (move stored on-chain) |
   |                            |                            |
   |-- resolveGame(move+salt) ->|                            |
   |     + ZK proof             |                            |
   |                            |-- _resolveGame() ----------|
   |<-- GameResolved event -----|                            |
```

## Project Structure

```
zk-ogs/
├── circuit/                        # Noir ZK circuit & witness generation
│   ├── src/main.nr                 # Circuit: validates moves & outcome
│   └── regenerate-verifier.sh      # Helper script for verifier artifacts
├── contracts/                      # Core game manager (commit/reveal + proof)
│   ├── contracts/
│   │   ├── RockPaperScissors.sol   # Game lifecycle & escrow accounting
│   │   ├── Verifier.sol            # Generated verifier scaffold
│   │   └── RockPaperScissors.t.sol # Foundry-based tests
│   ├── ignition/modules/
│   │   └── RockPaperScissors.ts    # Hardhat Ignition deployment module
│   └── hardhat.config.ts           # Hardhat 3 configuration
├── degen-rps/                      # Standalone Foundry project for RPS variant
│   ├── src/DegenRPS.sol            # Alternative game manager
│   ├── script/Deploy.s.sol         # Foundry deployment script
│   └── test/DegenRPS.t.sol         # Variant-specific tests
├── notes/                          # Design investigations & scratch notes
│   └── different_approach.md       # Alternative architecture sketch
├── raffle-pool/                    # Uniswap v4 hook + Foundry deployment flow
│   ├── src/RPSHook.sol             # Pre-swap hook escrow logic
│   ├── script/                     # Foundry scripts for pools & swaps
│   └── test/RPSHook.t.sol          # Hook integration tests
└── pool-ui/                        # React dashboard for pool + hook monitoring
    └── src/                        # Components, hooks, and routing
```

## Setup

### Prerequisites

- **Node.js** 18+ and npm
- **Noir** ([install instructions](https://noir-lang.org/docs/getting_started/nargo_installation))
- **MetaMask** (for wallet connection)

### 1. Install Dependencies

```bash
# Circuit dependencies (Noir comes with nargo)
cd circuit
nargo --version  # Verify installation

# Contract dependencies
cd ../contracts
npm install

# Frontend dependencies
cd ../frontend
npm install
```

### 2. Compile Circuit

```bash
cd circuit
nargo compile
nargo test  # Verify all tests pass
```

This generates `target/circuit.json` needed by the frontend.

### 3. Setup Frontend Artifacts

```bash
cd frontend

# Copy compiled circuit
mkdir -p target
cp ../circuit/target/circuit.json target/

# Copy contract artifact (after compilation)
cp ../contracts/artifacts/contracts/RockPaperScissors.sol/RockPaperScissors.json contract-artifact.json
```

## Try the game we deployed

[Game Page](https://degen-rps.vercel.app/swap-rps)

[Fund your wallet with Test Token](https://degen-rps.vercel.app/fund)

## The steps of playing the game

1. **Connect your wallet**  
   Launch `pool-ui` (`npm run dev`) and connect to your local Anvil / Hardhat network. The dashboard auto-loads deployed addresses from `deployments.json`.

2. **Swap & start a game (Player A)**  
   - Open the **Swap & Play** page.  
   - Choose the token pair, amount, and toggle the percentage of the swap you want to escrow (default 5%).  
   - Pick your move (Rock, Paper, or Scissors) and click **Swap & Start Game**.  
   - The UI submits a Uniswap swap routed through `RPSHook.sol`, escrows the stake, and stores your move + salt commitment locally (keep browser storage intact).

3. **Join an open game (Player B)**  
   - Visit **Games** to browse matches waiting for an opponent.  
   - Match the stake, pick your move, and confirm **Join Game**. Your move is written on-chain in clear text—no commitment phase required.

4. **Reveal & settle (Player A)**  
   - After someone joins, return to your game card and hit **Reveal Move**.  
   - The app reads your committed move/salt from localStorage, runs the Noir circuit to produce the proof, and calls `resolveGame`.  
   - The hook contract validates the commitment, verifies the proof via the manager contract, pays the winner from escrow, and releases the swap back to Uniswap.

- Network Name: `Hardhat Local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency Symbol: `ETH`

## Playing the Game

1. **Connect Wallet**: Click "Connect Wallet" in the UI
2. **Create/Join Game**:
   - Player 1: Select move (Rock 🪨, Paper 📄, or Scissors ✂️), then click "Create Game"
   - Player 2: Select move, enter Game ID, then click "Join Game" (move is submitted directly)
3. **Resolve Game** (Player 1 only):
   - After Player 2 joins, Player 1 clicks "Resolve Game"
   - Frontend generates ZK proof proving winner calculation
   - Proof is verified locally before submission
   - Player 1's move and proof are submitted to contract
4. **View Result**: Winner is announced after resolution

## How It Works

### ZK Proof Generation

When Player 1 resolves the game (after Player 2 has joined):

1. **Player 2's move** is already stored on-chain from `joinGame()`

2. **Compute Witness**: Noir circuit executes with:

   - `player1_move`: Field (private - from Player 1's reveal)
   - `player2_move`: Field (private - already on-chain from Player 2's join)
   - `winner`: Field (public - computed result)

3. **Generate Proof**: Barretenberg backend creates a PLONK proof proving:

### Hook Settlement Path

4. **Verify Locally**: Proof is verified before submission to ensure validity

5. **Submit to Contract**: Proof bytes are sent via `resolveGame()` (on-chain verification pending)

- **Timeouts** – Non-responsive Player A forfeits their stake after the reveal window expires; automation scripts and UI actions enforce this.  
- **Swap reentrancy** – Escrow updates happen before the pool’s state changes to avoid double-escrowing across nested hooks.  
- **Proof optionality** – During development you can deploy without the verifier contract; the manager accepts a mock flag to skip proof verification while still enforcing commitments.

## Design Exploration

- **Game State**: Manages game lifecycle (WaitingForPlayer → Committed → Revealed → Completed)
- **Player 1 Commitment**: Validates `keccak256(move || salt) == commitment` when Player 1 resolves
- **Player 2 Move**: Stored directly on-chain when Player 2 joins (no commit/reveal)
- **Winner Resolution**: Uses `_determineWinner()` matching circuit logic
- **ZK Proof Verification**: Receives proof bytes via `resolveGame()` (verification pending if verifier is set)