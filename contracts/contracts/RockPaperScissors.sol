// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUltraVerifier {
    function verify(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool);
}

/**
 * @title RockPaperScissors
 * @dev Zero-knowledge rock-paper-scissors game contract
 * Players commit moves, reveal with ZK proofs, and resolve the game
 */
contract RockPaperScissors {
    // Move values: Rock = 0, Paper = 1, Scissors = 2
    // Winner: 0 = tie, 1 = player1, 2 = player2

    enum GameStatus {
        WaitingForPlayer,
        Committed,
        Revealed,
        Completed
    }

    struct Game {
        uint256 gameId;
        address player1;
        address player2;
        GameStatus status;
        bytes32 player1Commitment;
        uint8 player1Move;
        uint8 player2Move;
        uint8 winner; // 0 = tie, 1 = player1, 2 = player2
        uint256 createdAt;
        uint256 timeout; // Timeout in seconds for Player 1 to reveal after Player 2 joins
        uint256 revealDeadline; // Timestamp when P1 must reveal by
    }

    // Storage
    mapping(uint256 => Game) public games;
    uint256 public gameCounter;

    // Optional ZK verifier integration
    IUltraVerifier public verifier;
    address public immutable deployer;
    address public authorizedHook; // Hook contract that can create games on behalf of players

    // Events
    event GameCreated(
        uint256 indexed gameId,
        address indexed player1,
        bytes32 commitment,
        uint256 timeout
    );

    event PlayerJoined(
        uint256 indexed gameId,
        address indexed player2,
        uint8 move2,
        uint256 revealDeadline
    );

    event MoveRevealed(
        uint256 indexed gameId,
        address indexed player,
        uint8 move,
        bytes32 salt
    );

    event GameResolved(
        uint256 indexed gameId,
        uint8 winner // 0 = tie, 1 = player1, 2 = player2
    );

    event GameForfeited(uint256 indexed gameId);

    constructor() {
        deployer = msg.sender;
    }

    /**
     * @dev Set the verifier address (one-time, by deployer only)
     */
    function setVerifier(address _verifier) external {
        require(msg.sender == deployer, "Only deployer");
        require(address(verifier) == address(0), "Verifier already set");
        require(_verifier != address(0), "Invalid verifier");
        verifier = IUltraVerifier(_verifier);
    }

    /**
     * @dev Set the authorized hook address (one-time, by deployer only)
     * @param _hook The address of the hook contract
     */
    function setAuthorizedHook(address _hook) external {
        require(msg.sender == deployer, "Only deployer");
        require(authorizedHook == address(0), "Hook already set");
        require(_hook != address(0), "Invalid hook");
        authorizedHook = _hook;
    }

    /**
     * @dev Create a new game with Player 1's commitment
     * @param commitment The hash of (move || salt) for Player 1
     * @param timeout Timeout in seconds for Player 1 to reveal after Player 2 joins
     * @return gameId The ID of the newly created game
     */
    function createGame(
        bytes32 commitment,
        uint256 timeout
    ) external returns (uint256) {
        return _createGameInternal(commitment, timeout, msg.sender);
    }

    /**
     * @dev Create a new game with Player 1's commitment (called by authorized hook)
     * @param commitment The hash of (move || salt) for Player 1
     * @param timeout Timeout in seconds for Player 1 to reveal after Player 2 joins
     * @param player1 The address of Player 1
     * @return gameId The ID of the newly created game
     */
    function createGameForPlayer(
        bytes32 commitment,
        uint256 timeout,
        address player1
    ) external returns (uint256) {
        require(msg.sender == authorizedHook, "Only authorized hook");
        require(player1 != address(0), "Invalid player1");
        return _createGameInternal(commitment, timeout, player1);
    }

    /**
     * @dev Internal function to create a game
     * @param commitment The hash of (move || salt) for Player 1
     * @param timeout Timeout in seconds for Player 1 to reveal after Player 2 joins
     * @param player1Address The address of Player 1
     * @return gameId The ID of the newly created game
     */
    function _createGameInternal(
        bytes32 commitment,
        uint256 timeout,
        address player1Address
    ) internal returns (uint256) {
        uint256 gameId = gameCounter++;

        games[gameId] = Game({
            gameId: gameId,
            player1: player1Address,
            player2: address(0),
            status: GameStatus.Committed,
            player1Commitment: commitment,
            player1Move: 255, // Invalid move (will be set on reveal)
            player2Move: 255, // Invalid move (will be set when P2 joins)
            winner: 0,
            createdAt: block.timestamp,
            timeout: timeout,
            revealDeadline: 0 // Will be set when P2 joins
        });

        emit GameCreated(gameId, player1Address, commitment, timeout);
        return gameId;
    }

    /**
     * @dev Join an existing game and submit Player 2's move
     * @param gameId The ID of the game to join
     * @param move2 Player 2's move (0=rock, 1=paper, 2=scissors)
     */
    function joinGame(uint256 gameId, uint8 move2) external {
        Game storage game = games[gameId];

        require(game.status == GameStatus.Committed, "Game not available");
        require(msg.sender != game.player1, "Cannot play against yourself");
        require(game.player2 == address(0), "Game already has two players");
        require(move2 < 3, "Invalid move (must be 0, 1, or 2)");

        game.player2 = msg.sender;
        game.player2Move = move2;
        game.revealDeadline = block.timestamp + game.timeout;
        game.status = GameStatus.Revealed; // Ready for P1 to reveal

        emit PlayerJoined(gameId, msg.sender, move2, game.revealDeadline);
    }

    /**
     * @dev Resolve game with Player 1's move, salt, and ZK proof
     * Player 2's move is already stored on-chain from joinGame()
     * @param gameId The ID of the game
     * @param move1 Player 1's move (0=rock, 1=paper, 2=scissors)
     * @param salt1 Player 1's salt
     * @param proof ZK proof proving winner calculation
     */
    function resolveGame(
        uint256 gameId,
        uint8 move1,
        bytes32 salt1,
        bytes calldata proof
    ) external {
        Game storage game = games[gameId];

        require(
            game.player1Commitment != bytes32(0),
            "Player 1 must commit first"
        );
        require(game.status != GameStatus.Completed, "Game already resolved");
        require(game.status == GameStatus.Revealed, "Player 2 must join first");
        require(block.timestamp <= game.revealDeadline, "Deadline passed");
        require(move1 < 3, "Invalid move (must be 0, 1, or 2)");
        require(game.player2Move < 3, "Player 2 move not set");

        // Verify Player 1's commitment matches
        bytes32 commitment1 = keccak256(abi.encodePacked(move1, salt1));
        require(
            game.player1Commitment == commitment1,
            "Invalid commitment for player1"
        );

        // Store Player 1's move (Player 2's move already stored)
        game.player1Move = move1;

        emit MoveRevealed(gameId, game.player1, move1, salt1);

        // If verifier is set, validate ZK proof
        if (address(verifier) != address(0)) {
            uint8 computedWinner = _determineWinner(move1, game.player2Move);

            // Build public inputs: [player1_move, player2_move, winner]
            bytes32[] memory publicInputs = new bytes32[](3);
            publicInputs[0] = bytes32(uint256(move1));
            publicInputs[1] = bytes32(uint256(game.player2Move));
            publicInputs[2] = bytes32(uint256(computedWinner));

            require(verifier.verify(proof, publicInputs), "Invalid ZK proof");
        }

        _resolveGame(gameId);
    }

    /**
     * @dev Forfeit game if Player 1 fails to reveal by deadline
     * Can be called by anyone after the deadline has passed
     * @param gameId The ID of the game
     */
    function forfeitGame(uint256 gameId) external {
        Game storage game = games[gameId];

        require(game.status != GameStatus.Completed, "Game already resolved");
        require(game.status == GameStatus.Revealed, "Game not in reveal phase");
        require(game.player2 != address(0), "Player 2 not joined");
        require(block.timestamp > game.revealDeadline, "Deadline not passed");

        // Player 1 forfeits, Player 2 wins
        game.winner = 2;
        game.status = GameStatus.Completed;

        emit GameForfeited(gameId);
        emit GameResolved(gameId, 2);
    }

    /**
     * @dev Internal function to resolve the game and determine winner
     * @param gameId The ID of the game
     */
    function _resolveGame(uint256 gameId) internal {
        Game storage game = games[gameId];

        require(
            game.player1Move != 255 && game.player2Move != 255,
            "Both moves must be set"
        );

        uint8 winner = _determineWinner(game.player1Move, game.player2Move);

        game.winner = winner;
        game.status = GameStatus.Completed;

        emit GameResolved(gameId, winner);
    }

    /**
     * @dev Determine the winner based on moves
     * @param move1 Player 1's move (0=rock, 1=paper, 2=scissors)
     * @param move2 Player 2's move (0=rock, 1=paper, 2=scissors)
     * @return winner 0 = tie, 1 = player1, 2 = player2
     */
    function _determineWinner(
        uint8 move1,
        uint8 move2
    ) internal pure returns (uint8) {
        // Tie case
        if (move1 == move2) {
            return 0;
        }

        // Player 1 wins cases:
        // Rock (0) beats Scissors (2)
        if (move1 == 0 && move2 == 2) {
            return 1;
        }
        // Paper (1) beats Rock (0)
        if (move1 == 1 && move2 == 0) {
            return 1;
        }
        // Scissors (2) beats Paper (1)
        if (move1 == 2 && move2 == 1) {
            return 1;
        }

        // Otherwise player 2 wins
        return 2;
    }

    /**
     * @dev Get game details
     * @param gameId The ID of the game
     * @return game The game struct
     */
    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }
}
