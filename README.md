# ZK Rock Paper Scissors Game

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![Solidity 0.8.20](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity)
![Hardhat 3](https://img.shields.io/badge/Hardhat-3.0-fff100?logo=hardhat&logoColor=black) ![Noir](https://img.shields.io/badge/Noir-ZK-black?logo=aztec&labelColor=000000)
![Vite](https://img.shields.io/badge/Vite-4.x-646CFF?logo=vite)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js)

A fully functional zero-knowledge rock-paper-scissors game where Player 1 commits their move, Player 2 joins with their move directly, and Player 1 reveals with ZK proofs to resolve the game on-chain. Built with **Noir**, **Barretenberg**, **Hardhat 3**, and **Ethereum**.

## Overview

Players generate cryptographic zero-knowledge proofs using Noir circuits that prove:

- The winner calculation is mathematically correct
- Both moves are valid (0=Rock, 1=Paper, 2=Scissors)
- The game logic matches the smart contract's resolution logic

**Current State:**

- ✅ Real ZK proofs generated client-side using NoirJS and Barretenberg backend
- ✅ Proofs verified locally before submission
- ✅ Commit-reveal scheme for Player 1 prevents front-running
- ✅ Player 2 submits move directly when joining (no commit/reveal needed)
- ⏳ On-chain proof verification (requires verifier contract generation)

## Technology Stack

### Zero-Knowledge Layer

- **Noir**: Domain-specific language for ZK circuits
- **Barretenberg**: UltraPLONK proof system backend (via `@aztec/bb.js`)
- **NoirJS**: JavaScript bindings for Noir circuits

### Smart Contract Layer

- **Solidity 0.8.20**: Game logic and state management
- **Hardhat 3**: Development environment

### Frontend

- **Vite**: Lightweight build tool
- **Ethers.js v6**: Ethereum interaction
- **NoirJS**: Circuit execution and proof generation

## How Zero-Knowledge Works Here

### The Circuit (`circuit/src/main.nr`)

The Noir circuit defines the game logic in zero-knowledge:

```rust
fn main(
    player1_move: Field,  // Private input
    player2_move: Field,   // Private input
    winner: pub Field      // Public output
) {
    // Validates moves are 0, 1, or 2
    // Computes winner using determine_winner()
    // Asserts winner matches provided value
}
```

**What the proof proves:**

1. Both moves are valid (0, 1, or 2)
2. The winner calculation is correct according to game rules
3. The public `winner` field matches the computed result

### Proof Generation Flow

1. **Player 2 joins** and submits their move directly to the contract
2. **Player 1 reveals their move** (move + salt) after Player 2 has joined
3. **Frontend computes expected winner** using the same logic as the contract
4. **Noir circuit executes** with both moves and winner as inputs
5. **Barretenberg backend generates a proof** proving the computation is correct
6. **Proof is verified locally** before sending to contract
7. **Proof is sent to contract** via `resolveGame()` (on-chain verification pending)

### Commit-Reveal Scheme

To prevent front-running and ensure fair play:

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
zk-rps/
├── circuit/                    # Noir ZK circuit
│   ├── src/
│   │   └── main.nr           # Circuit: validates moves & determines winner
│   └── Nargo.toml            # Noir project config
├── contracts/                 # Solidity smart contracts
│   ├── contracts/
│   │   ├── RockPaperScissors.sol    # Main game contract
│   │   └── RockPaperScissors.t.sol  # Solidity tests
│   ├── ignition/
│   │   └── modules/
│   │       └── RockPaperScissors.ts  # Deployment module
│   └── hardhat.config.ts      # Hardhat 3 config
└── frontend/                  # Web frontend
    ├── index.html            # UI
    ├── app.js                # Game logic + ZK proof generation
    ├── vite.config.js        # Vite config with node polyfills
    └── target/
        └── circuit.json      # Compiled Noir circuit (copied from circuit/)
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

## Running Locally

### 1. Start Hardhat Node

```bash
cd contracts
npx hardhat node
```

This starts a local Ethereum node at `http://127.0.0.1:8545` with Chain ID `31337`.

### 2. Deploy Contract

In a new terminal:

```bash
cd contracts
npx hardhat ignition deploy ignition/modules/RockPaperScissors.ts --network localhost
```

Copy the contract address from the output (e.g., `0x5FbDB2315678afecb367f032d93F642f64180aa3`).

### 3. Configure Frontend

1. Open `frontend/index.html` in browser (or use Vite dev server)
2. Enter the contract address in the UI
3. Click "Set Contract"

Alternatively, set it in `frontend/app.js`:

```javascript
let CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
```

### 4. Start Frontend Dev Server

```bash
cd frontend
npm run dev
```

Visit `http://localhost:5173`

### 5. Fund Your Wallet

Hardhat node creates 20 accounts with 10,000 ETH each. Choose one:

**Option A: Import Hardhat Account to MetaMask**

- Copy a private key from the Hardhat node output
- In MetaMask: Account icon → Import Account → Paste private key

**Option B: Send ETH to MetaMask**

```bash
cd contracts
npx hardhat run scripts/fundWallet.ts --network localhost <YOUR_METAMASK_ADDRESS>
```

**Option C: Configure MetaMask Network**

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

   - Moves are valid (0, 1, or 2)
   - Winner calculation matches circuit logic
   - Public output matches computed result

4. **Verify Locally**: Proof is verified before submission to ensure validity

5. **Submit to Contract**: Proof bytes are sent via `resolveGame()` (on-chain verification pending)

### Smart Contract Logic

The contract handles:

- **Game State**: Manages game lifecycle (WaitingForPlayer → Committed → Revealed → Completed)
- **Player 1 Commitment**: Validates `keccak256(move || salt) == commitment` when Player 1 resolves
- **Player 2 Move**: Stored directly on-chain when Player 2 joins (no commit/reveal)
- **Winner Resolution**: Uses `_determineWinner()` matching circuit logic
- **ZK Proof Verification**: Receives proof bytes via `resolveGame()` (verification pending if verifier is set)

### TODO

- **On-chain verification not yet implemented**: Proofs are generated and verified client-side, but contract doesn't verify them yet (unless verifier contract is deployed and set)
- **To enable on-chain verification**: Generate verifier contract using Noir's verifier generation tools, deploy it, and call `setVerifier()` on the game contract

## License

GPLv3
