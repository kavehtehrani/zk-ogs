// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
        bytes32 player2Commitment;
        uint8 player1Move;
        uint8 player2Move;
        uint8 winner; // 0 = tie, 1 = player1, 2 = player2
        uint256 createdAt;
        uint256 committedAt;
    }

    // Storage
    mapping(uint256 => Game) public games;
    uint256 public gameCounter;

    // Events
    event GameCreated(uint256 indexed gameId, address indexed player1);

    event PlayerJoined(uint256 indexed gameId, address indexed player2);

    event MoveCommitted(
        uint256 indexed gameId,
        address indexed player,
        bytes32 commitment
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

    /**
     * @dev Create a new game
     * @return gameId The ID of the newly created game
     */
    function createGame() external returns (uint256) {
        uint256 gameId = gameCounter++;

        games[gameId] = Game({
            gameId: gameId,
            player1: msg.sender,
            player2: address(0),
            status: GameStatus.WaitingForPlayer,
            player1Commitment: bytes32(0),
            player2Commitment: bytes32(0),
            player1Move: 255, // Invalid move (will be set on reveal)
            player2Move: 255, // Invalid move (will be set on reveal)
            winner: 0,
            createdAt: block.timestamp,
            committedAt: 0
        });

        emit GameCreated(gameId, msg.sender);
        return gameId;
    }

    /**
     * @dev Join an existing game
     * @param gameId The ID of the game to join
     */
    function joinGame(uint256 gameId) external {
        Game storage game = games[gameId];

        require(
            game.status == GameStatus.WaitingForPlayer,
            "Game not available"
        );
        require(msg.sender != game.player1, "Cannot play against yourself");
        require(game.player2 == address(0), "Game already has two players");

        game.player2 = msg.sender;
        game.status = GameStatus.Committed; // Ready for commitments

        emit PlayerJoined(gameId, msg.sender);
    }

    /**
     * @dev Commit a move (hash of move + salt)
     * @param gameId The ID of the game
     * @param commitment The hash of (move || salt)
     */
    function commitMove(uint256 gameId, bytes32 commitment) external {
        Game storage game = games[gameId];

        require(
            msg.sender == game.player1 || msg.sender == game.player2,
            "Not a player in this game"
        );
        require(
            game.status == GameStatus.Committed,
            "Game not ready for commitments"
        );
        require(game.player2 != address(0), "Game needs two players");

        if (msg.sender == game.player1) {
            require(game.player1Commitment == bytes32(0), "Already committed");
            game.player1Commitment = commitment;
        } else {
            require(game.player2Commitment == bytes32(0), "Already committed");
            game.player2Commitment = commitment;
        }

        emit MoveCommitted(gameId, msg.sender, commitment);

        // If both players have committed, game is ready for reveals
        if (
            game.player1Commitment != bytes32(0) &&
            game.player2Commitment != bytes32(0)
        ) {
            game.committedAt = block.timestamp;
        }
    }

    /**
     * @dev Reveal a move with salt and ZK proof
     * @param gameId The ID of the game
     * @param move The move (0=rock, 1=paper, 2=scissors)
     * @param salt The salt used in the commitment
     */
    function revealMove(
        uint256 gameId,
        uint8 move,
        bytes32 salt,
        bytes calldata /* proof - placeholder for ZK verifier integration */
    ) external {
        Game storage game = games[gameId];

        require(
            msg.sender == game.player1 || msg.sender == game.player2,
            "Not a player in this game"
        );
        require(
            game.player1Commitment != bytes32(0) &&
                game.player2Commitment != bytes32(0),
            "Both players must commit first"
        );
        require(move < 3, "Invalid move (must be 0, 1, or 2)");

        // Verify commitment matches
        bytes32 commitment = keccak256(abi.encodePacked(move, salt));

        if (msg.sender == game.player1) {
            require(
                game.player1Commitment == commitment,
                "Invalid commitment for player1"
            );
            require(game.player1Move == 255, "Already revealed");
            game.player1Move = move;
        } else {
            require(
                game.player2Commitment == commitment,
                "Invalid commitment for player2"
            );
            require(game.player2Move == 255, "Already revealed");
            game.player2Move = move;
        }

        emit MoveRevealed(gameId, msg.sender, move, salt);

        // Note: ZK proofs are generated client-side and verified locally
        // The proof parameter is passed but not verified on-chain yet.
        // To enable on-chain verification, we need to generate a verifier contract
        // and that will also take care of the reveal phase
        // Then integrate it here to verify the proof and winner calculation.
        // For now, we rely on commitment verification (Keccak256) and
        // the contract's _determineWinner() function for game resolution.

        // If both players have revealed, resolve the game
        if (game.player1Move != 255 && game.player2Move != 255) {
            _resolveGame(gameId);
        }
    }

    /**
     * @dev Internal function to resolve the game and determine winner
     * @param gameId The ID of the game
     */
    function _resolveGame(uint256 gameId) internal {
        Game storage game = games[gameId];

        require(
            game.player1Move != 255 && game.player2Move != 255,
            "Both moves must be revealed"
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
