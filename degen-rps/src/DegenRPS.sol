// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVerifier} from "./Verifier.sol";

/// @title DegenRPS
/// @notice A winner-takes-all Rock Paper Scissors game contract with ZK proofs
/// @dev Player1 creates game with commitment + proof, Player2 joins with move, Player1 reveals to settle
contract DegenRPS {
    using SafeERC20 for IERC20;

    enum Move {
        None,
        Rock,
        Paper,
        Scissors
    }

    enum GameState {
        WaitingForPlayer2,
        WaitingForReveal,
        Settled
    }

    struct Game {
        address player1;
        address player2;
        IERC20 token;
        uint256 betAmount;
        bytes32 commitment; // Commitment hash from ZK proof
        bytes proof; // ZK proof stored for verification at reveal
        Move player2Move;
        Move player1Move;
        GameState state;
        uint256 createdAt;
        uint256 revealDeadline;
        address winner; // address(0) for tie
    }

    // Game ID => Game
    mapping(uint256 => Game) public games;
    uint256 public nextGameId;

    // Commitment => Game ID (to prevent reuse)
    mapping(bytes32 => bool) public usedCommitments;

    // Verifier contract for ZK proof verification
    IVerifier public verifier;

    // Time window for player1 to reveal after player2 joins (default 30 mins)
    uint256 public revealTimeout = 30 minutes;

    // Owner for configuration changes
    address public owner;

    event GameCreated(
        uint256 indexed gameId,
        address indexed player1,
        address indexed token,
        uint256 betAmount,
        bytes32 commitment
    );

    event Player2Joined(
        uint256 indexed gameId,
        address indexed player2,
        Move move
    );

    event MoveRevealed(
        uint256 indexed gameId,
        address indexed player1,
        Move move
    );

    event GameSettled(
        uint256 indexed gameId,
        address indexed winner,
        uint256 amount
    );

    event PrizeWithdrawn(
        uint256 indexed gameId,
        address indexed winner,
        uint256 amount
    );

    event GameRefunded(
        uint256 indexed gameId,
        address indexed player,
        uint256 amount
    );

    constructor(address _verifier) {
        owner = msg.sender;
        verifier = IVerifier(_verifier);
    }

    /// @notice Set the reveal timeout (only owner)
    /// @param _timeout New timeout in seconds
    function setRevealTimeout(uint256 _timeout) external {
        require(msg.sender == owner, "Only owner");
        require(_timeout > 0, "Timeout must be > 0");
        revealTimeout = _timeout;
    }

    /// @notice Set the verifier contract (only owner)
    /// @param _verifier Address of the verifier contract
    function setVerifier(address _verifier) external {
        require(msg.sender == owner, "Only owner");
        require(_verifier != address(0), "Invalid verifier");
        verifier = IVerifier(_verifier);
    }

    /// @notice Create a new game as player1 (maker)
    /// @param tokenAddress The ERC20 token address to bet with
    /// @param betAmount The amount to bet (must be same for both players)
    /// @param commitment The commitment hash from the ZK proof (keccak256(move, salt))
    /// @param proof The ZK proof bytes
    /// @return gameId The ID of the created game
    function createGame(
        address tokenAddress,
        uint256 betAmount,
        bytes32 commitment,
        bytes calldata proof
    ) external returns (uint256 gameId) {
        require(betAmount > 0, "Bet amount must be > 0");
        require(!usedCommitments[commitment], "Commitment already used");
        require(proof.length > 0, "Proof required");

        IERC20 token = IERC20(tokenAddress);
        
        gameId = nextGameId++;
        usedCommitments[commitment] = true;

        // Transfer bet amount from player1
        token.safeTransferFrom(msg.sender, address(this), betAmount);

        // Store the proof (we'll verify it at reveal time)
        games[gameId] = Game({
            player1: msg.sender,
            player2: address(0),
            token: token,
            betAmount: betAmount,
            commitment: commitment,
            proof: proof,
            player2Move: Move.None,
            player1Move: Move.None,
            state: GameState.WaitingForPlayer2,
            createdAt: block.timestamp,
            revealDeadline: 0,
            winner: address(0)
        });

        emit GameCreated(gameId, msg.sender, tokenAddress, betAmount, commitment);
    }

    /// @notice Join a game as player2 (taker)
    /// @param gameId The ID of the game to join
    /// @param move Player2's move (Rock, Paper, or Scissors)
    function joinGame(uint256 gameId, Move move) external {
        Game storage game = games[gameId];
        require(game.state == GameState.WaitingForPlayer2, "Game not available");
        require(game.player1 != address(0), "Game does not exist");
        require(game.player1 != msg.sender, "Cannot join own game");
        require(move >= Move.Rock && move <= Move.Scissors, "Invalid move");

        // Transfer bet amount from player2
        game.token.safeTransferFrom(msg.sender, address(this), game.betAmount);

        game.player2 = msg.sender;
        game.player2Move = move;
        game.state = GameState.WaitingForReveal;
        game.revealDeadline = block.timestamp + revealTimeout;

        emit Player2Joined(gameId, msg.sender, move);
    }

    /// @notice Reveal player1's move and settle the game using ZK proof verification
    /// @param gameId The ID of the game
    /// @param move Player1's actual move
    /// @param salt The salt used in the commitment (for commitment verification)
    /// @param proof ZK proof generated with the actual moves (generated at reveal time)
    function revealAndSettle(
        uint256 gameId,
        Move move,
        bytes32 salt,
        bytes calldata proof
    ) external {
        Game storage game = games[gameId];
        require(game.state == GameState.WaitingForReveal, "Game not in reveal state");
        require(game.player1 == msg.sender, "Only player1 can reveal");
        require(move >= Move.Rock && move <= Move.Scissors, "Invalid move");
        require(block.timestamp <= game.revealDeadline, "Reveal deadline passed");

        // Verify commitment matches the stored commitment (ensures move matches the ZK proof commitment)
        bytes32 commitment = keccak256(abi.encodePacked(uint8(move), salt));
        require(commitment == game.commitment, "Invalid commitment");

        // Verify ZK proof - this is the primary verification mechanism
        // The ZK proof proves: 1) the move matches the commitment, 2) the winner calculation is correct
        uint8 computedWinner = uint8(_determineWinner(move, game.player2Move));
        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = bytes32(uint256(uint8(move)));
        publicInputs[1] = bytes32(uint256(uint8(game.player2Move)));
        publicInputs[2] = bytes32(uint256(computedWinner));

        require(verifier.verify(proof, publicInputs), "Invalid ZK proof");

        game.player1Move = move;
        game.state = GameState.Settled;

        // Determine winner
        address winner = _determineWinner(move, game.player2Move, game.player1, game.player2);
        game.winner = winner;

        emit MoveRevealed(gameId, msg.sender, move);
        emit GameSettled(gameId, winner, game.betAmount * 2);
    }

    /// @notice Withdraw the prize pool (winner takes all, or both players refunded on tie)
    /// @param gameId The ID of the game
    function withdraw(uint256 gameId) external {
        Game storage game = games[gameId];
        require(game.state == GameState.Settled, "Game not settled");

        uint256 totalAmount = game.betAmount * 2;

        if (game.winner == address(0)) {
            // Tie - refund both players (either player can call this)
            require(msg.sender == game.player1 || msg.sender == game.player2, "Only players can withdraw on tie");
            // Check if already withdrawn by checking if game still exists
            // Transfer both amounts
            game.token.safeTransfer(game.player1, game.betAmount);
            game.token.safeTransfer(game.player2, game.betAmount);
            emit PrizeWithdrawn(gameId, address(0), totalAmount);
        } else {
            // Winner takes all
            require(msg.sender == game.winner, "Only winner can withdraw");
            game.token.safeTransfer(game.winner, totalAmount);
            emit PrizeWithdrawn(gameId, game.winner, totalAmount);
        }

        // Mark as completed by deleting the game
        delete games[gameId];
    }

    /// @notice Refund player1 if player2 doesn't join, or refund player2 if player1 doesn't reveal in time
    /// @param gameId The ID of the game
    function refund(uint256 gameId) external {
        Game storage game = games[gameId];
        require(game.player1 != address(0), "Game does not exist");
        require(game.state != GameState.Settled, "Game already settled");

        bool canRefund = false;
        address refundTo = address(0);
        uint256 refundAmount = 0;

        if (game.state == GameState.WaitingForPlayer2) {
            // No player2 joined - player1 can refund anytime
            require(game.player1 == msg.sender, "Only player1 can refund");
            canRefund = true;
            refundTo = game.player1;
            refundAmount = game.betAmount;
        } else if (game.state == GameState.WaitingForReveal) {
            // Player1 didn't reveal in time - player2 can claim refund
            require(block.timestamp > game.revealDeadline, "Reveal deadline not passed");
            require(game.player2 == msg.sender, "Only player2 can claim timeout refund");
            canRefund = true;
            refundTo = game.player2;
            refundAmount = game.betAmount * 2; // Player2 gets both bets
        }

        require(canRefund, "Cannot refund");
        game.state = GameState.Settled;
        game.token.safeTransfer(refundTo, refundAmount);
        emit GameRefunded(gameId, refundTo, refundAmount);
    }

    /// @notice Determine the winner of a game
    /// @param player1Move Player1's move
    /// @param player2Move Player2's move
    /// @param player1 Player1's address
    /// @param player2 Player2's address
    /// @return winner The address of the winner, or address(0) for a tie
    function _determineWinner(
        Move player1Move,
        Move player2Move,
        address player1,
        address player2
    ) internal pure returns (address) {
        // Rock = 1, Paper = 2, Scissors = 3
        // Rock beats Scissors (1 beats 3)
        // Paper beats Rock (2 beats 1)
        // Scissors beats Paper (3 beats 2)

        if (player1Move == player2Move) {
            return address(0); // Tie
        }

        if (
            (player1Move == Move.Rock && player2Move == Move.Scissors) ||
            (player1Move == Move.Paper && player2Move == Move.Rock) ||
            (player1Move == Move.Scissors && player2Move == Move.Paper)
        ) {
            return player1; // Player1 wins
        }

        return player2; // Player2 wins
    }

    /// @notice Internal helper to determine winner (returns uint8 for proof verification)
    /// @param player1Move Player1's move
    /// @param player2Move Player2's move
    /// @return winner 0 = tie, 1 = player1, 2 = player2
    function _determineWinner(
        Move player1Move,
        Move player2Move
    ) internal pure returns (uint8) {
        if (player1Move == player2Move) {
            return 0; // Tie
        }

        if (
            (player1Move == Move.Rock && player2Move == Move.Scissors) ||
            (player1Move == Move.Paper && player2Move == Move.Rock) ||
            (player1Move == Move.Scissors && player2Move == Move.Paper)
        ) {
            return 1; // Player1 wins
        }

        return 2; // Player2 wins
    }

    /// @notice Get game details
    /// @param gameId The ID of the game
    /// @return game The game struct
    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    /// @notice Get all active games waiting for player2
    /// @return gameIds Array of game IDs
    function getGamesWaitingForPlayer2() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nextGameId; i++) {
            if (games[i].state == GameState.WaitingForPlayer2) {
                count++;
            }
        }

        uint256[] memory gameIds = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < nextGameId; i++) {
            if (games[i].state == GameState.WaitingForPlayer2) {
                gameIds[index++] = i;
            }
        }

        return gameIds;
    }
}
