# ZK Game System Design Architecture

## Executive Summary

This document outlines a comprehensive system design for building a Zero-Knowledge (ZK) game on ZKsync Era. The architecture leverages ZKsync's Layer 2 scaling solution with zkEVM capabilities to create a trustless, scalable gaming experience with privacy-preserving features.

---

## 1. System Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Game UI    │  │  Wallet      │  │  Web3        │        │
│  │   (React)    │  │  Integration │  │  Provider    │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                            ↕ JSON-RPC / HTTP
┌─────────────────────────────────────────────────────────────────┐
│                      Application Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  Game Logic  │  │   API        │  │  Off-chain   │        │
│  │  Service     │  │   Gateway    │  │  Indexer     │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                            ↕ Contract Calls
┌─────────────────────────────────────────────────────────────────┐
│                    Smart Contract Layer (L2)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Game Core    │  │   NFT/Token  │  │  GameState   │        │
│  │  Contract    │  │   Contract   │  │  Manager     │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  Randomness  │  │  Tournament  │  │  Reward      │        │
│  │   Oracle     │  │   Manager    │  │  Distributor │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                            ↕ State Sync
┌─────────────────────────────────────────────────────────────────┐
│                  ZKsync Era Infrastructure                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   zkEVM      │  │  State       │  │   L1         │        │
│  │   Executor   │  │  Keeper      │  │   Bridge     │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                            ↕ Proof Verification
┌─────────────────────────────────────────────────────────────────┐
│                    Ethereum Layer 1                             │
│  ┌──────────────┐  ┌──────────────┐                           │
│  │  ZKsync L1   │  │  Settlement  │                           │
│  │  Contract    │  │  & Security  │                           │
│  └──────────────┘  └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Core Components

1. **Frontend Layer**: User interface and wallet integration
2. **Application Layer**: Business logic and API services
3. **Smart Contract Layer**: On-chain game logic and state management
4. **ZKsync Infrastructure**: L2 execution and proving system
5. **Ethereum L1**: Final settlement and security guarantees

---

## 2. Component Architecture

### 2.1 Frontend Layer

#### 2.1.1 Game UI Component
**Technology Stack:**
- React 18+ with TypeScript
- Vite for build tooling
- TailwindCSS for styling
- Phaser.js or Three.js for game rendering (if needed)

**Responsibilities:**
- Render game interface
- Handle user interactions
- Display game state updates in real-time
- Manage local game state caching
- Provide responsive design for mobile/desktop

**Key Features:**
```typescript
interface GameUIComponent {
  gameState: GameState;
  playerInventory: NFTAsset[];
  
  methods: {
    renderGameBoard(): void;
    handlePlayerMove(move: Move): Promise<void>;
    updateVisuals(newState: GameState): void;
    displayTransaction(tx: Transaction): void;
  }
}
```

#### 2.1.2 Wallet Integration
**Supported Wallets:**
- MetaMask
- WalletConnect
- Argent zkSync
- Coinbase Wallet

**Implementation:**
```typescript
interface WalletAdapter {
  connect(): Promise<Account>;
  disconnect(): void;
  signMessage(message: string): Promise<Signature>;
  sendTransaction(tx: Transaction): Promise<TxHash>;
  switchNetwork(chainId: number): Promise<void>;
}
```

**ZKsync Network Configuration:**
```typescript
const zkSyncNetwork = {
  chainId: 324, // ZKsync Era Mainnet
  chainName: 'ZKsync Era',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: ['https://mainnet.era.zksync.io'],
  blockExplorerUrls: ['https://explorer.zksync.io/']
};
```

#### 2.1.3 Web3 Provider Layer
**Using zksync-ethers:**
```typescript
import { Provider, Wallet } from 'zksync-ethers';

const provider = new Provider('https://mainnet.era.zksync.io');
const wallet = new Wallet(privateKey, provider);
```

**Contract Interaction:**
```typescript
interface ContractInterface {
  gameContract: Contract;
  nftContract: Contract;
  
  methods: {
    makeMove(moveData: MoveData): Promise<TransactionResponse>;
    claimReward(gameId: string): Promise<TransactionResponse>;
    mintGameAsset(assetType: string): Promise<TransactionResponse>;
    getGameState(gameId: string): Promise<GameState>;
  }
}
```

---

### 2.2 Application Layer

#### 2.2.1 Game Logic Service
**Purpose:** Handle off-chain game logic validation and computation

**Architecture:**
```
Game Logic Service
├── Game Engine
│   ├── Move Validator
│   ├── State Transition Engine
│   ├── AI Opponent (if applicable)
│   └── Physics/Rules Engine
├── Caching Layer (Redis)
│   ├── Active Game Sessions
│   ├── Player State Cache
│   └── Leaderboard Cache
└── Event Processor
    ├── Blockchain Event Listener
    ├── Game Event Handler
    └── Notification Service
```

**Implementation Example:**
```typescript
class GameLogicService {
  private engine: GameEngine;
  private cache: RedisClient;
  private eventProcessor: EventProcessor;
  
  async validateMove(
    gameId: string,
    playerId: string,
    move: Move
  ): Promise<ValidationResult> {
    // 1. Fetch current game state
    const state = await this.getGameState(gameId);
    
    // 2. Validate move against rules
    const isValid = this.engine.validateMove(state, move);
    
    // 3. Return validation result
    return {
      valid: isValid,
      reason: isValid ? null : 'Invalid move',
      estimatedGas: this.estimateGasCost(move)
    };
  }
  
  async processGameAction(
    gameId: string,
    action: GameAction
  ): Promise<GameState> {
    // Process action and return new state
    const newState = await this.engine.applyAction(action);
    await this.cache.set(`game:${gameId}`, newState);
    return newState;
  }
}
```

#### 2.2.2 API Gateway
**Technology:** Node.js + Express/Fastify

**Endpoints:**
```typescript
// Game Management
POST   /api/v1/games/create
GET    /api/v1/games/:gameId
POST   /api/v1/games/:gameId/join
POST   /api/v1/games/:gameId/move
GET    /api/v1/games/:gameId/state

// Player Management
GET    /api/v1/players/:address/profile
GET    /api/v1/players/:address/games
GET    /api/v1/players/:address/assets
GET    /api/v1/players/:address/stats

// Tournament & Leaderboard
GET    /api/v1/tournaments/active
GET    /api/v1/leaderboard/:period
POST   /api/v1/tournaments/:id/register

// Asset Management
GET    /api/v1/assets/:tokenId
GET    /api/v1/assets/marketplace
POST   /api/v1/assets/:tokenId/transfer
```

**Authentication:**
```typescript
interface AuthMiddleware {
  verifySignature(
    message: string,
    signature: string,
    address: string
  ): boolean;
  
  validateSession(token: string): Promise<Session>;
}
```

#### 2.2.3 Off-chain Indexer
**Purpose:** Index and query blockchain data efficiently

**Technology Stack:**
- The Graph Protocol (subgraph)
- PostgreSQL for relational data
- ElasticSearch for full-text search

**Schema Example:**
```graphql
type Game @entity {
  id: ID!
  creator: Player!
  opponent: Player
  state: GameState!
  moves: [Move!]! @derivedFrom(field: "game")
  winner: Player
  createdAt: BigInt!
  endedAt: BigInt
}

type Player @entity {
  id: ID! # wallet address
  gamesPlayed: Int!
  gamesWon: Int!
  totalEarnings: BigInt!
  assets: [Asset!]! @derivedFrom(field: "owner")
}

type Move @entity {
  id: ID!
  game: Game!
  player: Player!
  moveData: String!
  timestamp: BigInt!
  transactionHash: String!
}
```

**Event Listeners:**
```typescript
const gameContractEvents = {
  GameCreated: (gameId, creator, settings) => {
    // Index new game
  },
  MoveMade: (gameId, player, moveData) => {
    // Record move
  },
  GameEnded: (gameId, winner, rewards) => {
    // Update game final state
  }
};
```

---

### 2.3 Smart Contract Layer

#### 2.3.1 Game Core Contract
**Purpose:** Main game logic and state management

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ZKGame is Ownable, ReentrancyGuard {
    // Game state structure
    struct Game {
        uint256 gameId;
        address player1;
        address player2;
        GameStatus status;
        uint256 betAmount;
        uint256 createdAt;
        uint256 lastMoveAt;
        bytes32 stateHash; // Merkle root of game state
        address winner;
    }
    
    enum GameStatus {
        WaitingForPlayer,
        Active,
        Completed,
        Cancelled
    }
    
    // Storage
    mapping(uint256 => Game) public games;
    mapping(uint256 => mapping(uint256 => bytes32)) public moves;
    mapping(address => uint256[]) public playerGames;
    uint256 public gameCounter;
    
    // Events
    event GameCreated(
        uint256 indexed gameId,
        address indexed creator,
        uint256 betAmount
    );
    
    event PlayerJoined(
        uint256 indexed gameId,
        address indexed player
    );
    
    event MoveMade(
        uint256 indexed gameId,
        address indexed player,
        uint256 moveNumber,
        bytes32 moveHash
    );
    
    event GameEnded(
        uint256 indexed gameId,
        address indexed winner,
        uint256 reward
    );
    
    // Game creation
    function createGame() external payable returns (uint256) {
        require(msg.value > 0, "Bet amount required");
        
        uint256 gameId = gameCounter++;
        games[gameId] = Game({
            gameId: gameId,
            player1: msg.sender,
            player2: address(0),
            status: GameStatus.WaitingForPlayer,
            betAmount: msg.value,
            createdAt: block.timestamp,
            lastMoveAt: block.timestamp,
            stateHash: bytes32(0),
            winner: address(0)
        });
        
        playerGames[msg.sender].push(gameId);
        
        emit GameCreated(gameId, msg.sender, msg.value);
        return gameId;
    }
    
    // Join existing game
    function joinGame(uint256 gameId) external payable nonReentrant {
        Game storage game = games[gameId];
        require(game.status == GameStatus.WaitingForPlayer, "Game not available");
        require(msg.value == game.betAmount, "Incorrect bet amount");
        require(msg.sender != game.player1, "Cannot play against yourself");
        
        game.player2 = msg.sender;
        game.status = GameStatus.Active;
        playerGames[msg.sender].push(gameId);
        
        emit PlayerJoined(gameId, msg.sender);
    }
    
    // Make a move
    function makeMove(
        uint256 gameId,
        bytes32 moveHash,
        bytes32 newStateHash
    ) external {
        Game storage game = games[gameId];
        require(game.status == GameStatus.Active, "Game not active");
        require(
            msg.sender == game.player1 || msg.sender == game.player2,
            "Not a player"
        );
        
        uint256 moveNumber = _getMoveCount(gameId);
        moves[gameId][moveNumber] = moveHash;
        game.stateHash = newStateHash;
        game.lastMoveAt = block.timestamp;
        
        emit MoveMade(gameId, msg.sender, moveNumber, moveHash);
    }
    
    // End game and distribute rewards
    function endGame(
        uint256 gameId,
        address winner,
        bytes memory proof
    ) external onlyOwner nonReentrant {
        Game storage game = games[gameId];
        require(game.status == GameStatus.Active, "Game not active");
        require(
            winner == game.player1 || winner == game.player2,
            "Invalid winner"
        );
        
        // Verify game result proof (ZK proof validation)
        require(_verifyGameProof(gameId, winner, proof), "Invalid proof");
        
        game.status = GameStatus.Completed;
        game.winner = winner;
        
        uint256 reward = game.betAmount * 2;
        uint256 fee = (reward * 5) / 100; // 5% platform fee
        uint256 winnerReward = reward - fee;
        
        payable(winner).transfer(winnerReward);
        payable(owner()).transfer(fee);
        
        emit GameEnded(gameId, winner, winnerReward);
    }
    
    // Helper functions
    function _getMoveCount(uint256 gameId) private view returns (uint256) {
        uint256 count = 0;
        while (moves[gameId][count] != bytes32(0)) {
            count++;
        }
        return count;
    }
    
    function _verifyGameProof(
        uint256 gameId,
        address winner,
        bytes memory proof
    ) private view returns (bool) {
        // Implement ZK proof verification
        // This would integrate with a ZK proof verifier contract
        return true; // Placeholder
    }
    
    // Timeout mechanism
    function claimTimeoutWin(uint256 gameId) external nonReentrant {
        Game storage game = games[gameId];
        require(game.status == GameStatus.Active, "Game not active");
        require(
            msg.sender == game.player1 || msg.sender == game.player2,
            "Not a player"
        );
        require(
            block.timestamp > game.lastMoveAt + 24 hours,
            "Timeout not reached"
        );
        
        address winner = msg.sender;
        game.status = GameStatus.Completed;
        game.winner = winner;
        
        uint256 reward = game.betAmount * 2;
        payable(winner).transfer(reward);
        
        emit GameEnded(gameId, winner, reward);
    }
}
```

#### 2.3.2 NFT/Token Contract
**Purpose:** Manage in-game assets as NFTs

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract GameAssetNFT is ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant GAME_ROLE = keccak256("GAME_ROLE");
    
    uint256 private _tokenIdCounter;
    
    struct AssetMetadata {
        uint256 assetType;
        uint256 rarity;
        uint256 power;
        uint256 mintedAt;
        bool isLocked; // Locked during gameplay
    }
    
    mapping(uint256 => AssetMetadata) public assetMetadata;
    mapping(address => mapping(uint256 => uint256)) public playerAssetCount;
    
    event AssetMinted(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 assetType,
        uint256 rarity
    );
    
    event AssetLocked(uint256 indexed tokenId, uint256 gameId);
    event AssetUnlocked(uint256 indexed tokenId);
    
    constructor() ERC721("ZKGameAsset", "ZKGA") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }
    
    function mintAsset(
        address to,
        uint256 assetType,
        uint256 rarity,
        string memory tokenURI
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
        
        assetMetadata[tokenId] = AssetMetadata({
            assetType: assetType,
            rarity: rarity,
            power: _calculatePower(rarity),
            mintedAt: block.timestamp,
            isLocked: false
        });
        
        playerAssetCount[to][assetType]++;
        
        emit AssetMinted(tokenId, to, assetType, rarity);
        return tokenId;
    }
    
    function lockAsset(
        uint256 tokenId,
        uint256 gameId
    ) external onlyRole(GAME_ROLE) {
        require(!assetMetadata[tokenId].isLocked, "Asset already locked");
        assetMetadata[tokenId].isLocked = true;
        emit AssetLocked(tokenId, gameId);
    }
    
    function unlockAsset(uint256 tokenId) external onlyRole(GAME_ROLE) {
        require(assetMetadata[tokenId].isLocked, "Asset not locked");
        assetMetadata[tokenId].isLocked = false;
        emit AssetUnlocked(tokenId);
    }
    
    function _calculatePower(uint256 rarity) private pure returns (uint256) {
        return 100 + (rarity * 50);
    }
    
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        require(!assetMetadata[tokenId].isLocked, "Asset is locked in game");
    }
    
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721URIStorage, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
```

#### 2.3.3 Tournament Manager
**Purpose:** Handle competitive tournaments and prize pools

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TournamentManager is Ownable, ReentrancyGuard {
    struct Tournament {
        uint256 tournamentId;
        string name;
        uint256 entryFee;
        uint256 prizePool;
        uint256 maxPlayers;
        uint256 startTime;
        uint256 endTime;
        TournamentStatus status;
        address[] participants;
        address winner;
    }
    
    enum TournamentStatus {
        Registration,
        Active,
        Completed,
        Cancelled
    }
    
    mapping(uint256 => Tournament) public tournaments;
    mapping(uint256 => mapping(address => bool)) public isRegistered;
    mapping(uint256 => mapping(address => uint256)) public playerScores;
    uint256 public tournamentCounter;
    
    event TournamentCreated(
        uint256 indexed tournamentId,
        string name,
        uint256 prizePool
    );
    
    event PlayerRegistered(
        uint256 indexed tournamentId,
        address indexed player
    );
    
    event TournamentEnded(
        uint256 indexed tournamentId,
        address indexed winner,
        uint256 prize
    );
    
    function createTournament(
        string memory name,
        uint256 entryFee,
        uint256 maxPlayers,
        uint256 startTime,
        uint256 endTime
    ) external payable onlyOwner returns (uint256) {
        require(startTime > block.timestamp, "Invalid start time");
        require(endTime > startTime, "Invalid end time");
        require(msg.value > 0, "Initial prize pool required");
        
        uint256 tournamentId = tournamentCounter++;
        
        tournaments[tournamentId] = Tournament({
            tournamentId: tournamentId,
            name: name,
            entryFee: entryFee,
            prizePool: msg.value,
            maxPlayers: maxPlayers,
            startTime: startTime,
            endTime: endTime,
            status: TournamentStatus.Registration,
            participants: new address[](0),
            winner: address(0)
        });
        
        emit TournamentCreated(tournamentId, name, msg.value);
        return tournamentId;
    }
    
    function register(uint256 tournamentId) external payable nonReentrant {
        Tournament storage tournament = tournaments[tournamentId];
        require(
            tournament.status == TournamentStatus.Registration,
            "Registration closed"
        );
        require(
            tournament.participants.length < tournament.maxPlayers,
            "Tournament full"
        );
        require(!isRegistered[tournamentId][msg.sender], "Already registered");
        require(msg.value == tournament.entryFee, "Incorrect entry fee");
        
        tournament.participants.push(msg.sender);
        tournament.prizePool += msg.value;
        isRegistered[tournamentId][msg.sender] = true;
        
        emit PlayerRegistered(tournamentId, msg.sender);
    }
    
    function updateScore(
        uint256 tournamentId,
        address player,
        uint256 score
    ) external onlyOwner {
        Tournament storage tournament = tournaments[tournamentId];
        require(tournament.status == TournamentStatus.Active, "Not active");
        require(isRegistered[tournamentId][player], "Not registered");
        
        playerScores[tournamentId][player] += score;
    }
    
    function endTournament(
        uint256 tournamentId,
        address winner
    ) external onlyOwner nonReentrant {
        Tournament storage tournament = tournaments[tournamentId];
        require(tournament.status == TournamentStatus.Active, "Not active");
        require(isRegistered[tournamentId][winner], "Invalid winner");
        
        tournament.status = TournamentStatus.Completed;
        tournament.winner = winner;
        
        uint256 prize = (tournament.prizePool * 80) / 100; // 80% to winner
        uint256 fee = tournament.prizePool - prize;
        
        payable(winner).transfer(prize);
        payable(owner()).transfer(fee);
        
        emit TournamentEnded(tournamentId, winner, prize);
    }
}
```

#### 2.3.4 Randomness Oracle
**Purpose:** Provide verifiable randomness for game mechanics

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RandomnessOracle is Ownable {
    // Chainlink VRF integration would go here
    // For now, using commit-reveal scheme
    
    struct RandomRequest {
        address requester;
        bytes32 commitment;
        uint256 blockNumber;
        bool revealed;
        uint256 randomNumber;
    }
    
    mapping(bytes32 => RandomRequest) public requests;
    
    event RandomnessRequested(bytes32 indexed requestId, address requester);
    event RandomnessRevealed(bytes32 indexed requestId, uint256 randomNumber);
    
    function requestRandomness(
        bytes32 commitment
    ) external returns (bytes32 requestId) {
        requestId = keccak256(
            abi.encodePacked(msg.sender, commitment, block.timestamp)
        );
        
        requests[requestId] = RandomRequest({
            requester: msg.sender,
            commitment: commitment,
            blockNumber: block.number,
            revealed: false,
            randomNumber: 0
        });
        
        emit RandomnessRequested(requestId, msg.sender);
        return requestId;
    }
    
    function revealRandomness(
        bytes32 requestId,
        uint256 secret
    ) external returns (uint256) {
        RandomRequest storage request = requests[requestId];
        require(request.requester == msg.sender, "Not requester");
        require(!request.revealed, "Already revealed");
        require(
            block.number > request.blockNumber + 1,
            "Too early to reveal"
        );
        
        bytes32 commitment = keccak256(abi.encodePacked(secret));
        require(commitment == request.commitment, "Invalid secret");
        
        // Combine secret with future blockhash for randomness
        uint256 randomNumber = uint256(
            keccak256(
                abi.encodePacked(
                    secret,
                    blockhash(request.blockNumber + 1)
                )
            )
        );
        
        request.revealed = true;
        request.randomNumber = randomNumber;
        
        emit RandomnessRevealed(requestId, randomNumber);
        return randomNumber;
    }
    
    function getRandomness(bytes32 requestId) external view returns (uint256) {
        RandomRequest memory request = requests[requestId];
        require(request.revealed, "Not revealed yet");
        return request.randomNumber;
    }
}
```

---

## 3. ZKsync-Specific Features

### 3.1 Account Abstraction Integration

```typescript
// Custom account for gasless transactions
interface GameAccount {
  // Execute game moves without requiring ETH for gas
  executeGameMove(
    gameContract: string,
    moveData: bytes
  ): Promise<void>;
  
  // Allow game tokens to pay for gas
  payWithGameToken(
    tokenAddress: string,
    amount: BigNumber
  ): Promise<void>;
}
```

**Implementation with Paymasters:**
```solidity
contract GamePaymaster is IPaymaster {
    function validateAndPayForPaymasterTransaction(
        bytes32,
        bytes32,
        Transaction calldata _transaction
    ) external payable returns (bytes4 magic, bytes memory context) {
        // Allow users to pay gas with game tokens
        magic = PAYMASTER_VALIDATION_SUCCESS_MAGIC;
        
        // Sponsor gas for approved game operations
        if (isApprovedGameOperation(_transaction)) {
            // Paymaster covers the gas
            return (magic, context);
        }
        
        // Otherwise, require payment in game tokens
        require(
            hasGameTokens(msg.sender),
            "Insufficient game tokens"
        );
        
        return (magic, context);
    }
    
    function postTransaction(
        bytes calldata _context,
        Transaction calldata _transaction,
        bytes32,
        bytes32,
        ExecutionResult _txResult,
        uint256 _maxRefundedGas
    ) external payable override {
        // Handle post-transaction logic
    }
}
```

### 3.2 Native ETH Support

```typescript
// Direct ETH transfers without wrapping
const gameContract = new Contract(
  gameAddress,
  gameAbi,
  wallet
);

// Make a bet with native ETH
await gameContract.createGame({
  value: ethers.utils.parseEther("0.1")
});
```

### 3.3 Optimized Data Availability

**State Compression:**
```solidity
contract CompressedGameState {
    // Store only state diffs, not full state
    mapping(uint256 => bytes32) public stateDiffs;
    
    function compressState(
        GameState memory state
    ) internal pure returns (bytes32) {
        // Merkle root of game state
        return keccak256(abi.encode(state));
    }
    
    function updateState(
        uint256 gameId,
        GameState memory newState
    ) external {
        bytes32 newStateHash = compressState(newState);
        stateDiffs[gameId] = newStateHash;
    }
}
```

### 3.4 L1→L2 and L2→L1 Messaging

**Bridge Game Assets:**
```solidity
interface IL1Messenger {
    function sendToL1(bytes memory _message) external returns (bytes32);
}

contract GameAssetBridge {
    IL1Messenger public messenger;
    
    function withdrawAssetToL1(
        uint256 tokenId,
        address l1Recipient
    ) external {
        // Burn L2 asset
        _burn(tokenId);
        
        // Send message to L1
        bytes memory message = abi.encode(
            l1Recipient,
            tokenId,
            assetMetadata[tokenId]
        );
        
        messenger.sendToL1(message);
    }
}
```

---

## 4. Data Flow & State Management

### 4.1 Game State Flow

```
┌─────────────┐
│   Player    │
│   Action    │
└──────┬──────┘
       │
       ↓
┌─────────────────────┐
│  Frontend Validation│
│  (Optimistic UI)    │
└─────────┬───────────┘
          │
          ↓
┌─────────────────────┐
│  Web3 Provider      │
│  (Sign Transaction) │
└─────────┬───────────┘
          │
          ↓
┌─────────────────────────┐
│  Smart Contract         │
│  - Validate inputs      │
│  - Update state         │
│  - Emit events          │
└─────────┬───────────────┘
          │
          ↓
┌─────────────────────────┐
│  ZKsync Sequencer       │
│  - Execute transaction  │
│  - Generate ZK proof    │
└─────────┬───────────────┘
          │
          ↓
┌─────────────────────────┐
│  L1 Settlement          │
│  - Verify proof         │
│  - Finalize state       │
└─────────┬───────────────┘
          │
          ↓
┌─────────────────────────┐
│  Event Indexer          │
│  - Index new state      │
│  - Update cache         │
│  - Notify clients       │
└─────────┬───────────────┘
          │
          ↓
┌─────────────────────────┐
│  Frontend Update        │
│  - Render new state     │
│  - Update UI            │
└─────────────────────────┘
```

### 4.2 State Synchronization

**WebSocket Connection for Real-time Updates:**
```typescript
class GameStateSync {
  private ws: WebSocket;
  private provider: Provider;
  private gameContract: Contract;
  
  constructor(gameAddress: string) {
    this.provider = new Provider('https://mainnet.era.zksync.io');
    this.gameContract = new Contract(
      gameAddress,
      gameAbi,
      this.provider
    );
    
    this.initWebSocket();
    this.listenToEvents();
  }
  
  private initWebSocket() {
    this.ws = new WebSocket('wss://api.yourgame.com/ws');
    
    this.ws.on('message', (data) => {
      const update = JSON.parse(data);
      this.handleStateUpdate(update);
    });
  }
  
  private listenToEvents() {
    // Listen to contract events
    this.gameContract.on('MoveMade', (gameId, player, move) => {
      this.handleMoveEvent(gameId, player, move);
    });
    
    this.gameContract.on('GameEnded', (gameId, winner, reward) => {
      this.handleGameEndEvent(gameId, winner, reward);
    });
  }
  
  private async handleStateUpdate(update: StateUpdate) {
    // Update local state
    // Verify against on-chain state if needed
    const onChainState = await this.gameContract.getGameState(
      update.gameId
    );
    
    if (this.verifyState(update, onChainState)) {
      // Emit to UI
      this.emit('stateUpdate', update);
    }
  }
}
```

---

## 5. Security Architecture

### 5.1 Threat Model

**Identified Threats:**
1. **Front-running attacks** - Players observing pending moves
2. **Replay attacks** - Reusing signed messages
3. **Sybil attacks** - Single entity creating multiple accounts
4. **Smart contract vulnerabilities** - Reentrancy, overflow, etc.
5. **Oracle manipulation** - Manipulating randomness source
6. **State manipulation** - Invalid state transitions

### 5.2 Security Measures

#### 5.2.1 Commit-Reveal Scheme for Moves
```solidity
contract SecureGameMoves {
    struct MoveCommitment {
        bytes32 commitHash;
        uint256 revealDeadline;
        bool revealed;
    }
    
    mapping(uint256 => mapping(address => MoveCommitment)) 
        public moveCommitments;
    
    // Phase 1: Commit
    function commitMove(
        uint256 gameId,
        bytes32 moveHash
    ) external {
        moveCommitments[gameId][msg.sender] = MoveCommitment({
            commitHash: moveHash,
            revealDeadline: block.timestamp + 5 minutes,
            revealed: false
        });
    }
    
    // Phase 2: Reveal
    function revealMove(
        uint256 gameId,
        bytes memory move,
        bytes32 salt
    ) external {
        MoveCommitment storage commitment = 
            moveCommitments[gameId][msg.sender];
        
        require(
            block.timestamp <= commitment.revealDeadline,
            "Reveal deadline passed"
        );
        
        bytes32 computedHash = keccak256(abi.encodePacked(move, salt));
        require(
            computedHash == commitment.commitHash,
            "Invalid reveal"
        );
        
        commitment.revealed = true;
        _processMove(gameId, msg.sender, move);
    }
}
```

#### 5.2.2 Reentrancy Protection
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract SecureGame is ReentrancyGuard {
    function claimReward(uint256 gameId) 
        external 
        nonReentrant 
    {
        // Checks
        require(isWinner(gameId, msg.sender), "Not winner");
        require(!rewardClaimed[gameId], "Already claimed");
        
        // Effects
        rewardClaimed[gameId] = true;
        
        // Interactions
        payable(msg.sender).transfer(rewardAmount);
    }
}
```

#### 5.2.3 Access Control
```solidity
import "@openzeppelin/contracts/access/AccessControl.sol";

contract RoleBasedGame is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GAME_MASTER_ROLE = keccak256("GAME_MASTER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    function updateGameParameters(/* params */) 
        external 
        onlyRole(ADMIN_ROLE) 
    {
        // Admin only functions
    }
    
    function providRandomness(uint256 seed) 
        external 
        onlyRole(ORACLE_ROLE) 
    {
        // Oracle only functions
    }
}
```

#### 5.2.4 Rate Limiting & Anti-Spam
```solidity
contract RateLimitedGame {
    mapping(address => uint256) public lastActionTime;
    uint256 public constant ACTION_COOLDOWN = 1 seconds;
    
    modifier rateLimit() {
        require(
            block.timestamp >= lastActionTime[msg.sender] + ACTION_COOLDOWN,
            "Action too frequent"
        );
        lastActionTime[msg.sender] = block.timestamp;
        _;
    }
    
    function makeMove(/* params */) external rateLimit {
        // Move logic
    }
}
```

#### 5.2.5 Signature Verification
```typescript
import { verifyMessage } from 'ethers/lib/utils';

async function verifyPlayerAction(
  action: GameAction,
  signature: string,
  expectedSigner: string
): Promise<boolean> {
  const message = JSON.stringify({
    gameId: action.gameId,
    moveData: action.moveData,
    nonce: action.nonce,
    timestamp: action.timestamp
  });
  
  const recoveredAddress = verifyMessage(message, signature);
  
  return (
    recoveredAddress.toLowerCase() === expectedSigner.toLowerCase() &&
    Date.now() - action.timestamp < 60000 // 1 minute validity
  );
}
```

---

## 6. Deployment Architecture

### 6.1 Smart Contract Deployment

**Deployment Script (Hardhat):**
```typescript
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { Wallet } from 'zksync-ethers';
import * as ethers from 'ethers';

async function main() {
  // Initialize deployer
  const wallet = new Wallet(process.env.PRIVATE_KEY!);
  const deployer = new Deployer(hre, wallet);
  
  // Deploy contracts in order
  console.log('Deploying RandomnessOracle...');
  const oracleArtifact = await deployer.loadArtifact('RandomnessOracle');
  const oracle = await deployer.deploy(oracleArtifact);
  await oracle.deployed();
  console.log(`Oracle deployed to: ${oracle.address}`);
  
  console.log('Deploying GameAssetNFT...');
  const nftArtifact = await deployer.loadArtifact('GameAssetNFT');
  const nft = await deployer.deploy(nftArtifact);
  await nft.deployed();
  console.log(`NFT deployed to: ${nft.address}`);
  
  console.log('Deploying ZKGame...');
  const gameArtifact = await deployer.loadArtifact('ZKGame');
  const game = await deployer.deploy(gameArtifact);
  await game.deployed();
  console.log(`Game deployed to: ${game.address}`);
  
  console.log('Deploying TournamentManager...');
  const tournamentArtifact = await deployer.loadArtifact('TournamentManager');
  const tournament = await deployer.deploy(tournamentArtifact);
  await tournament.deployed();
  console.log(`Tournament deployed to: ${tournament.address}`);
  
  // Setup permissions
  console.log('Setting up permissions...');
  await nft.grantRole(
    await nft.GAME_ROLE(),
    game.address
  );
  
  // Verify contracts
  console.log('Verifying contracts...');
  await hre.run('verify:verify', {
    address: oracle.address,
    constructorArguments: []
  });
  
  // Save deployment addresses
  const deployments = {
    oracle: oracle.address,
    nft: nft.address,
    game: game.address,
    tournament: tournament.address,
    network: 'zksync-era-mainnet',
    timestamp: Date.now()
  };
  
  fs.writeFileSync(
    './deployments.json',
    JSON.stringify(deployments, null, 2)
  );
  
  console.log('Deployment complete!');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

**hardhat.config.ts:**
```typescript
import { HardhatUserConfig } from 'hardhat/config';
import '@matterlabs/hardhat-zksync-deploy';
import '@matterlabs/hardhat-zksync-solc';
import '@matterlabs/hardhat-zksync-verify';

const config: HardhatUserConfig = {
  zksolc: {
    version: '1.3.14',
    compilerSource: 'binary',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  defaultNetwork: 'zkSyncTestnet',
  networks: {
    zkSyncTestnet: {
      url: 'https://testnet.era.zksync.dev',
      ethNetwork: 'goerli',
      zksync: true,
      verifyURL: 'https://zksync2-testnet-explorer.zksync.dev/contract_verification'
    },
    zkSyncMainnet: {
      url: 'https://mainnet.era.zksync.io',
      ethNetwork: 'mainnet',
      zksync: true,
      verifyURL: 'https://zksync2-mainnet-explorer.zksync.io/contract_verification'
    }
  },
  solidity: {
    version: '0.8.20'
  }
};

export default config;
```

### 6.2 Infrastructure Deployment

**Docker Compose for Backend Services:**
```yaml
version: '3.8'

services:
  api:
    build: ./api
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - ZKSYNC_RPC_URL=https://mainnet.era.zksync.io
      - REDIS_URL=redis://redis:6379
      - POSTGRES_URL=postgresql://user:pass@postgres:5432/zkgame
    depends_on:
      - redis
      - postgres
    restart: unless-stopped
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
  
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=zkgame
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped
  
  indexer:
    build: ./indexer
    environment:
      - ZKSYNC_RPC_URL=https://mainnet.era.zksync.io
      - START_BLOCK=0
      - POSTGRES_URL=postgresql://user:pass@postgres:5432/zkgame
    depends_on:
      - postgres
    restart: unless-stopped
  
  frontend:
    build: ./frontend
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api
    restart: unless-stopped

volumes:
  redis-data:
  postgres-data:
```

### 6.3 CI/CD Pipeline

**GitHub Actions Workflow:**
```yaml
name: Deploy ZK Game

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: |
          npm ci
          cd contracts && npm ci
      
      - name: Run tests
        run: |
          npm test
          cd contracts && npm test
      
      - name: Run linter
        run: npm run lint
  
  deploy-contracts:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: cd contracts && npm ci
      
      - name: Compile contracts
        run: cd contracts && npm run compile
      
      - name: Deploy to ZKsync
        env:
          PRIVATE_KEY: ${{ secrets.DEPLOYER_PRIVATE_KEY }}
        run: cd contracts && npm run deploy:mainnet
      
      - name: Verify contracts
        run: cd contracts && npm run verify
  
  deploy-backend:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Docker images
        run: |
          docker-compose build
      
      - name: Push to registry
        run: |
          docker-compose push
      
      - name: Deploy to production
        run: |
          # Deploy to your cloud provider
          kubectl apply -f k8s/
```

---

## 7. Monitoring & Analytics

### 7.1 Metrics Collection

**Key Metrics to Track:**
```typescript
interface GameMetrics {
  // Performance Metrics
  transactionLatency: number;
  blockConfirmationTime: number;
  apiResponseTime: number;
  
  // Business Metrics
  activeUsers: number;
  gamesCreated: number;
  gamesCompleted: number;
  totalValueLocked: BigNumber;
  
  // User Engagement
  averageGameDuration: number;
  playerRetentionRate: number;
  dailyActiveUsers: number;
  
  // Economic Metrics
  totalFeesCollected: BigNumber;
  averageBetSize: BigNumber;
  totalRewardsDistributed: BigNumber;
}

class MetricsCollector {
  async collectMetrics(): Promise<GameMetrics> {
    const [
      txLatency,
      activeUsers,
      tvl
    ] = await Promise.all([
      this.getTransactionLatency(),
      this.getActiveUsers(),
      this.getTotalValueLocked()
    ]);
    
    return {
      transactionLatency: txLatency,
      activeUsers: activeUsers,
      totalValueLocked: tvl,
      // ... other metrics
    };
  }
  
  async reportMetrics(metrics: GameMetrics) {
    // Send to analytics platform
    await this.sendToDatadog(metrics);
    await this.sendToAmplitude(metrics);
  }
}
```

### 7.2 Logging Strategy

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'zk-game' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Log important events
logger.info('Game created', {
  gameId: game.id,
  creator: game.creator,
  betAmount: game.betAmount.toString()
});

logger.error('Transaction failed', {
  txHash: tx.hash,
  error: error.message,
  gameId: game.id
});
```

### 7.3 Alerting System

```typescript
interface Alert {
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  metadata: Record<string, any>;
}

class AlertingSystem {
  async checkSystemHealth() {
    // Check transaction success rate
    const successRate = await this.getTransactionSuccessRate();
    if (successRate < 0.95) {
      this.sendAlert({
        severity: 'high',
        message: 'Transaction success rate below threshold',
        metadata: { successRate }
      });
    }
    
    // Check contract balance
    const balance = await this.getContractBalance();
    if (balance.lt(ethers.utils.parseEther('1'))) {
      this.sendAlert({
        severity: 'critical',
        message: 'Contract balance critically low',
        metadata: { balance: balance.toString() }
      });
    }
    
    // Check API response time
    const avgResponseTime = await this.getAvgResponseTime();
    if (avgResponseTime > 1000) {
      this.sendAlert({
        severity: 'medium',
        message: 'API response time degraded',
        metadata: { avgResponseTime }
      });
    }
  }
  
  private async sendAlert(alert: Alert) {
    // Send to Slack, PagerDuty, etc.
    await this.notifySlack(alert);
    if (alert.severity === 'critical') {
      await this.notifyPagerDuty(alert);
    }
  }
}
```

---

## 8. Scalability Considerations

### 8.1 Horizontal Scaling

**Load Balancing Strategy:**
```
                    ┌──────────────┐
                    │ Load Balancer│
                    │   (Nginx)    │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          ↓                ↓                ↓
    ┌─────────┐      ┌─────────┐      ┌─────────┐
    │ API     │      │ API     │      │ API     │
    │ Server 1│      │ Server 2│      │ Server 3│
    └─────────┘      └─────────┘      └─────────┘
          │                │                │
          └────────────────┼────────────────┘
                           ↓
                    ┌─────────────┐
                    │   Redis     │
                    │  Cluster    │
                    └─────────────┘
```

### 8.2 Database Optimization

**Read Replicas:**
```typescript
class DatabaseManager {
  private writeDb: Pool;
  private readReplicas: Pool[];
  
  async query(sql: string, params: any[]): Promise<any> {
    // Read from replica
    const replica = this.selectReadReplica();
    return replica.query(sql, params);
  }
  
  async write(sql: string, params: any[]): Promise<any> {
    // Write to primary
    return this.writeDb.query(sql, params);
  }
  
  private selectReadReplica(): Pool {
    // Round-robin or least-connections
    return this.readReplicas[
      Math.floor(Math.random() * this.readReplicas.length)
    ];
  }
}
```

**Indexing Strategy:**
```sql
-- Index on frequently queried columns
CREATE INDEX idx_games_player1 ON games(player1);
CREATE INDEX idx_games_player2 ON games(player2);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_created_at ON games(created_at);

-- Composite indexes for complex queries
CREATE INDEX idx_games_player_status 
  ON games(player1, status)
  INCLUDE (bet_amount, created_at);

-- Partial indexes for active games
CREATE INDEX idx_active_games 
  ON games(created_at) 
  WHERE status = 'Active';
```

### 8.3 Caching Strategy

```typescript
class CacheManager {
  private redis: Redis;
  
  async getGameState(gameId: string): Promise<GameState | null> {
    // Try cache first
    const cached = await this.redis.get(`game:${gameId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Fetch from blockchain
    const state = await this.fetchFromBlockchain(gameId);
    
    // Cache with TTL
    await this.redis.setex(
      `game:${gameId}`,
      300, // 5 minutes
      JSON.stringify(state)
    );
    
    return state;
  }
  
  async invalidateCache(gameId: string) {
    await this.redis.del(`game:${gameId}`);
  }
  
  // Cache leaderboard with shorter TTL
  async getLeaderboard(): Promise<Player[]> {
    const cached = await this.redis.get('leaderboard');
    if (cached) {
      return JSON.parse(cached);
    }
    
    const leaderboard = await this.computeLeaderboard();
    await this.redis.setex(
      'leaderboard',
      60, // 1 minute
      JSON.stringify(leaderboard)
    );
    
    return leaderboard;
  }
}
```

### 8.4 ZKsync-Specific Optimizations

**Batch Transactions:**
```typescript
async function batchGameMoves(
  moves: Move[]
): Promise<TransactionReceipt> {
  const provider = new Provider('https://mainnet.era.zksync.io');
  const wallet = new Wallet(privateKey, provider);
  
  // Batch multiple moves in single transaction
  const gameContract = new Contract(gameAddress, gameAbi, wallet);
  
  const tx = await gameContract.batchMoves(
    moves.map(m => ({
      gameId: m.gameId,
      moveData: m.data,
      signature: m.signature
    }))
  );
  
  return tx.wait();
}
```

---

## 9. Testing Strategy

### 9.1 Smart Contract Testing

```typescript
import { expect } from 'chai';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { Wallet, Provider } from 'zksync-ethers';

describe('ZKGame Contract', () => {
  let game: Contract;
  let player1: Wallet;
  let player2: Wallet;
  
  beforeEach(async () => {
    // Deploy fresh contract
    const deployer = new Deployer(hre, player1);
    const artifact = await deployer.loadArtifact('ZKGame');
    game = await deployer.deploy(artifact);
  });
  
  describe('Game Creation', () => {
    it('should create a game with bet amount', async () => {
      const betAmount = ethers.utils.parseEther('0.1');
      
      const tx = await game.createGame({ value: betAmount });
      await tx.wait();
      
      const gameState = await game.games(0);
      expect(gameState.player1).to.equal(player1.address);
      expect(gameState.betAmount).to.equal(betAmount);
      expect(gameState.status).to.equal(0); // WaitingForPlayer
    });
    
    it('should reject game creation without bet', async () => {
      await expect(
        game.createGame({ value: 0 })
      ).to.be.revertedWith('Bet amount required');
    });
  });
  
  describe('Game Play', () => {
    it('should allow second player to join', async () => {
      const betAmount = ethers.utils.parseEther('0.1');
      await game.connect(player1).createGame({ value: betAmount });
      
      await game.connect(player2).joinGame(0, { value: betAmount });
      
      const gameState = await game.games(0);
      expect(gameState.player2).to.equal(player2.address);
      expect(gameState.status).to.equal(1); // Active
    });
    
    it('should process valid moves', async () => {
      // Setup game
      const betAmount = ethers.utils.parseEther('0.1');
      await game.connect(player1).createGame({ value: betAmount });
      await game.connect(player2).joinGame(0, { value: betAmount });
      
      // Make move
      const moveHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes('move1')
      );
      const newStateHash = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes('state1')
      );
      
      await expect(
        game.connect(player1).makeMove(0, moveHash, newStateHash)
      ).to.emit(game, 'MoveMade');
    });
  });
  
  describe('Game Completion', () => {
    it('should distribute rewards to winner', async () => {
      // Setup and play game
      const betAmount = ethers.utils.parseEther('0.1');
      await game.connect(player1).createGame({ value: betAmount });
      await game.connect(player2).joinGame(0, { value: betAmount });
      
      // Record initial balance
      const initialBalance = await player1.getBalance();
      
      // End game
      const proof = ethers.utils.toUtf8Bytes('proof');
      await game.endGame(0, player1.address, proof);
      
      // Check balance increased
      const finalBalance = await player1.getBalance();
      const expectedReward = betAmount.mul(2).mul(95).div(100); // 95% after fees
      
      expect(finalBalance.sub(initialBalance)).to.be.closeTo(
        expectedReward,
        ethers.utils.parseEther('0.001') // Gas tolerance
      );
    });
  });
});
```

### 9.2 Integration Testing

```typescript
describe('Full Game Flow Integration', () => {
  it('should complete full game lifecycle', async () => {
    // 1. Create game via API
    const createResponse = await axios.post(
      'http://localhost:3000/api/v1/games/create',
      {
        betAmount: '0.1',
        signature: signedMessage
      }
    );
    const gameId = createResponse.data.gameId;
    
    // 2. Join game
    const joinResponse = await axios.post(
      `http://localhost:3000/api/v1/games/${gameId}/join`,
      {
        betAmount: '0.1',
        signature: signedMessage2
      }
    );
    expect(joinResponse.status).to.equal(200);
    
    // 3. Make moves
    await axios.post(
      `http://localhost:3000/api/v1/games/${gameId}/move`,
      {
        moveData: 'move1',
        signature: signedMove1
      }
    );
    
    // 4. Check game state
    const stateResponse = await axios.get(
      `http://localhost:3000/api/v1/games/${gameId}/state`
    );
    expect(stateResponse.data.status).to.equal('Active');
    
    // 5. Complete game
    // ... additional moves
    
    // 6. Verify final state
    const finalState = await axios.get(
      `http://localhost:3000/api/v1/games/${gameId}`
    );
    expect(finalState.data.status).to.equal('Completed');
  });
});
```

### 9.3 Load Testing

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up
    { duration: '5m', target: 100 }, // Steady state
    { duration: '2m', target: 200 }, // Spike
    { duration: '5m', target: 200 }, // Steady spike
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% under 500ms
    http_req_failed: ['rate<0.01'],   // <1% failures
  },
};

export default function () {
  // Test game state retrieval
  const gameId = Math.floor(Math.random() * 1000);
  const res = http.get(`http://localhost:3000/api/v1/games/${gameId}`);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  sleep(1);
}
```

---

## 10. Cost Analysis

### 10.1 Gas Cost Estimation

**Typical Operations:**
```
Operation                  | Gas Cost (L2) | Est. Cost ($)
--------------------------------------------------------
Create Game               | ~200,000      | $0.02
Join Game                 | ~150,000      | $0.015
Make Move                 | ~100,000      | $0.01
End Game                  | ~180,000      | $0.018
Mint NFT                  | ~250,000      | $0.025
Transfer NFT              | ~80,000       | $0.008
Tournament Registration   | ~120,000      | $0.012
Claim Reward              | ~140,000      | $0.014

Note: Costs assume ETH @ $2000 and ZKsync L2 gas price
```

### 10.2 Infrastructure Costs (Monthly)

```
Component              | Provider    | Specs              | Cost
---------------------------------------------------------------
API Servers (3x)      | AWS EC2     | t3.medium         | $100
Load Balancer         | AWS ALB     | -                 | $25
Database (Primary)    | AWS RDS     | db.t3.medium      | $80
Read Replicas (2x)    | AWS RDS     | db.t3.small       | $60
Redis Cluster         | ElastiCache | cache.t3.micro    | $40
Block Storage         | AWS EBS     | 500 GB            | $50
CDN                   | CloudFlare  | Pro plan          | $20
Monitoring            | Datadog     | Infrastructure    | $75
Domain & SSL          | -           | -                 | $15
---------------------------------------------------------------
Total Monthly Cost                                        ~$465
```

### 10.3 Development Costs

```
Phase                    | Duration  | Resources
-------------------------------------------------
Smart Contract Dev       | 4 weeks   | 1 Blockchain Dev
Frontend Development     | 6 weeks   | 1 Frontend Dev
Backend Development      | 6 weeks   | 1 Backend Dev
Testing & QA            | 3 weeks   | 1 QA Engineer
Security Audit          | 2 weeks   | External Firm
Deployment & Setup      | 1 week    | DevOps Engineer
```

---

## 11. Future Enhancements

### 11.1 Advanced ZK Features

**Private Game States:**
```solidity
// Use ZK proofs to hide game state from opponent
contract PrivateGame {
    function submitMoveWithProof(
        uint256 gameId,
        bytes32 moveCommitment,
        bytes memory zkProof
    ) external {
        // Verify ZK proof that move is valid
        // without revealing actual move
        require(verifyZKProof(zkProof), "Invalid proof");
        
        // Store commitment
        moveCommitments[gameId].push(moveCommitment);
    }
}
```

### 11.2 Cross-Chain Interoperability

**Bridge to Other Chains:**
```typescript
interface CrossChainBridge {
  // Bridge assets from ZKsync to other L2s
  bridgeToArbitrum(tokenId: number): Promise<void>;
  bridgeToOptimism(tokenId: number): Promise<void>;
  
  // Sync game state across chains
  syncGameState(gameId: string, targetChain: string): Promise<void>;
}
```

### 11.3 Social Features

- **Guilds & Clans**: Form teams and compete
- **Friend System**: Add friends, spectate games
- **Chat Integration**: In-game messaging
- **Replay System**: Watch previous games
- **Leaderboards**: Global and regional rankings

### 11.4 Monetization Strategies

1. **Platform Fees**: 2-5% on game bets
2. **NFT Marketplace**: Trading fees on assets
3. **Premium Subscriptions**: Ad-free, extra features
4. **Tournament Entry Fees**: Competitive events
5. **Cosmetic Items**: Purchasable skins/themes

---

## 12. Conclusion

This system design provides a comprehensive architecture for building a scalable, secure ZK game on ZKsync Era. The design leverages:

✅ **ZKsync's zkEVM** for low-cost, fast transactions  
✅ **Smart contract architecture** for trustless game logic  
✅ **Account abstraction** for improved UX  
✅ **Layered architecture** for scalability  
✅ **Security best practices** to protect users  
✅ **Modern DevOps** for reliable operations  

### Key Takeaways

1. **Start Simple**: Begin with core game mechanics
2. **Iterate Based on Usage**: Add features as needed
3. **Prioritize Security**: Audit contracts early
4. **Optimize Costs**: Use L2 advantages fully
5. **Monitor Everything**: Set up observability from day one

### Next Steps

1. ✅ Review and validate architecture
2. 🔄 Set up development environment
3. 🔄 Implement core smart contracts
4. 🔄 Build MVP frontend
5. 🔄 Deploy to testnet
6. 🔄 Conduct security audit
7. 🔄 Launch on mainnet

---

## Appendix

### A. Technology Stack Summary

**Frontend:**
- React 18, TypeScript, Vite
- TailwindCSS, Phaser.js
- zksync-ethers, wagmi

**Backend:**
- Node.js, Express/Fastify
- PostgreSQL, Redis
- The Graph (indexing)

**Smart Contracts:**
- Solidity 0.8.20
- OpenZeppelin Contracts
- Hardhat with ZKsync plugins

**Infrastructure:**
- Docker, Kubernetes
- AWS/GCP
- GitHub Actions (CI/CD)

**Monitoring:**
- Datadog/Prometheus
- Winston (logging)
- Sentry (error tracking)

### B. Resources

- [ZKsync Documentation](https://era.zksync.io/docs/)
- [ZKsync Contract Examples](https://github.com/matter-labs/zksync-contract-templates)
- [Hardhat ZKsync Plugins](https://era.zksync.io/docs/tools/hardhat/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)

### C. Contact & Support

- GitHub: [Your Repository]
- Discord: [Community Server]
- Email: support@yourgame.com
- Documentation: docs.yourgame.com

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-04  
**Author:** System Architecture Team
