# ZK Rock Paper Scissors Game

A fully functional zero-knowledge rock-paper-scissors game where players commit moves, reveal with ZK proofs, and resolve games on-chain. Built with **Noir**, **Barretenberg**, **Hardhat 3**, and **Ethereum**.

## Overview

Players generate cryptographic zero-knowledge proofs using Noir circuits that prove:

- The winner calculation is mathematically correct
- Both moves are valid (0=Rock, 1=Paper, 2=Scissors)
- The game logic matches the smart contract's resolution logic

**Current State:**

- ✅ Real ZK proofs generated client-side using NoirJS and Barretenberg backend
- ✅ Proofs verified locally before submission
- ✅ Commit-reveal scheme prevents front-running
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

1. **Both players reveal their moves** (already committed with Keccak256 hashes)
2. **Frontend computes expected winner** using the same logic as the contract
3. **Noir circuit executes** with moves and winner as inputs
4. **Barretenberg backend generates a proof** proving the computation is correct
5. **Proof is verified locally** before sending to contract
6. **Proof is sent to contract** (on-chain verification pending)

### Commit-Reveal Scheme

To prevent front-running and ensure fair play:

1. **Commit Phase**:

   - Players generate random salt
   - Create commitment: `keccak256(move || salt)`
   - Submit commitment hash to contract (move is hidden)

2. **Reveal Phase**:

   - Players reveal move + salt
   - Contract verifies `keccak256(move || salt) == commitment`
   - ZK proof generated proving winner calculation

3. **Resolution**:
   - Contract's `_resolveGame()` determines winner
   - ZK proof proves this calculation is correct

## Game Flow

```
Player 1                     Contract                    Player 2
   |                            |                            |
   |-- createGame() ----------->|                            |
   |                            |                            |
   |                            |<-- joinGame() ------------|
   |                            |                            |
   |-- commitMove(hash) ------->|                            |
   |                            |<-- commitMove(hash) -------|
   |                            |                            |
   |-- revealMove(move+salt) -->|                            |
   |     + ZK proof             |                            |
   |                            |<-- revealMove(move+salt) --|
   |                            |     + ZK proof             |
   |                            |                            |
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
   - Player 1: Click "Create Game"
   - Player 2: Enter Game ID and click "Join Game"
3. **Commit Move**: Click Rock 🪨, Paper 📄, or Scissors ✂️
4. **Reveal Move**: After both players commit, click "Reveal Move"
   - Frontend generates ZK proof proving winner calculation
   - Proof is verified locally before submission
5. **View Result**: Winner is announced after both reveals

## How It Works

### ZK Proof Generation

When a player reveals their move (and opponent has also revealed):

1. **Compute Witness**: Noir circuit executes with:

   - `player1_move`: Field (private)
   - `player2_move`: Field (private)
   - `winner`: Field (public - computed result)

2. **Generate Proof**: Barretenberg backend creates a PLONK proof proving:

   - Moves are valid (0, 1, or 2)
   - Winner calculation matches circuit logic
   - Public output matches computed result

3. **Verify Locally**: Proof is verified before submission to ensure validity

4. **Submit to Contract**: Proof bytes are sent (on-chain verification pending)

### Smart Contract Logic

The contract handles:

- **Game State**: Manages game lifecycle (Waiting → Committed → Revealed → Completed)
- **Commitment Verification**: Validates `keccak256(move || salt) == commitment`
- **Winner Resolution**: Uses `_determineWinner()` matching circuit logic
- **ZK Proof Storage**: Receives proof bytes (verification pending)

### TODO

- **On-chain verification not yet implemented**: Proofs are generated and verified client-side, but contract doesn't verify them yet
- **To enable on-chain verification**: Generate verifier contract using Noir's verifier generation tools and integrate into `revealMove()`

## License

GPLv3
