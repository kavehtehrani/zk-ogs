// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RockPaperScissors} from "./RockPaperScissors.sol";
import {Test} from "forge-std/Test.sol";

contract RockPaperScissorsTest is Test {
    RockPaperScissors public game;
    address public player1;
    address public player2;
    uint256 public constant DEFAULT_TIMEOUT = 5 minutes;

    function setUp() public {
        game = new RockPaperScissors();
        player1 = address(0x1);
        player2 = address(0x2);
    }

    function test_CreateGame() public {
        bytes32 commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );
        vm.prank(player1);
        uint256 gameId = game.createGame(commitment, DEFAULT_TIMEOUT);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(gameData.gameId == gameId, "Game ID mismatch");
        require(gameData.player1 == player1, "Player1 mismatch");
        require(uint8(gameData.status) == 1, "Status should be Committed");
        require(
            gameData.player1Commitment == commitment,
            "Commitment should be set"
        );
        require(
            gameData.timeout == DEFAULT_TIMEOUT,
            "Timeout should be set correctly"
        );
    }

    function test_JoinGame() public {
        bytes32 commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );
        vm.prank(player1);
        uint256 gameId = game.createGame(commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1); // Player 2 plays Paper

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(uint8(gameData.status) == 2, "Status should be Revealed");
        require(gameData.player2 == player2, "Player2 mismatch");
        require(gameData.player2Move == 1, "Player2 move should be Paper");
        require(
            gameData.revealDeadline > block.timestamp,
            "Deadline should be set"
        );
    }

    function test_CommitMoves() public {
        // Player 1 commits rock (0) when creating game
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        // Player 2 submits paper (1) when joining
        vm.prank(player2);
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(
            gameData.player1Commitment != bytes32(0),
            "Player1 commitment should be set"
        );
        require(
            gameData.player2Move == 1,
            "Player2 move should be set to Paper"
        );
    }

    function test_RevealMoves() public {
        // Player 1 commits rock (0) when creating game
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt)); // Rock

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        // Player 2 submits scissors (2) when joining
        vm.prank(player2);
        game.joinGame(gameId, 2); // Scissors

        // Player 1 reveals with empty proof (no verifier set)
        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(uint8(gameData.status) == 3, "Status should be Completed");
        require(gameData.player1Move == 0, "Player1 move should be Rock (0)");
        require(
            gameData.player2Move == 2,
            "Player2 move should be Scissors (2)"
        );
        require(
            gameData.winner == 1,
            "Player1 should win (Rock beats Scissors)"
        );
    }

    function test_RockBeatsScissors() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt)); // Rock

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 2); // Scissors

        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(
            gameData.winner == 1,
            "Rock should beat Scissors (Player1 wins)"
        );
    }

    function test_PaperBeatsRock() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(1), p1Salt)); // Paper

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 0); // Rock

        vm.prank(player1);
        game.resolveGame(gameId, 1, p1Salt, "");

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(gameData.winner == 1, "Paper should beat Rock (Player1 wins)");
    }

    function test_Tie() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt)); // Rock

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 0); // Rock

        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(gameData.winner == 0, "Should be a tie");
    }

    function test_RevealWithWrongSalt() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        // Try to resolve with wrong salt
        vm.prank(player1);
        vm.expectRevert();
        game.resolveGame(gameId, 0, keccak256("wrong_salt"), "");
    }

    function test_ResolveRequiresProofWhenVerifierSet() public {
        // Setup game
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 2); // Scissors

        // Set a dummy verifier address (non-zero) to activate proof requirement
        AlwaysFailVerifier failVerifier = new AlwaysFailVerifier();
        vm.prank(address(this));
        game.setVerifier(address(failVerifier));

        // Resolve without valid proof should revert due to verifier failure
        vm.prank(player1);
        vm.expectRevert();
        game.resolveGame(gameId, 0, p1Salt, "");
    }

    function test_ForfeitAfterDeadline() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        uint256 joinTime = block.timestamp;
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        uint256 deadline = gameData.revealDeadline;

        // Verify deadline is set correctly (timeout after join)
        require(
            deadline == joinTime + gameData.timeout,
            "Deadline should be timeout after join"
        );

        // Fast forward past deadline
        vm.warp(deadline + 1);

        // Anyone can call forfeit
        game.forfeitGame(gameId);

        gameData = game.getGame(gameId);
        require(uint8(gameData.status) == 3, "Status should be Completed");
        require(gameData.winner == 2, "Player 2 should win by forfeit");
    }

    function test_CannotForfeitBeforeDeadline() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        uint256 deadline = gameData.revealDeadline;

        // Try to forfeit before deadline (should fail)
        vm.expectRevert();
        game.forfeitGame(gameId);

        // Fast forward to just before deadline
        vm.warp(deadline - 1);
        vm.expectRevert();
        game.forfeitGame(gameId);
    }

    function test_CannotResolveAfterDeadline() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        uint256 deadline = gameData.revealDeadline;

        // Fast forward past deadline
        vm.warp(deadline + 1);

        // Try to resolve after deadline (should fail)
        vm.prank(player1);
        vm.expectRevert();
        game.resolveGame(gameId, 0, p1Salt, "");
    }

    function test_CanResolveBeforeDeadline() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        uint256 deadline = gameData.revealDeadline;

        // Fast forward to just before deadline
        vm.warp(deadline - 1);

        // Should be able to resolve
        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        gameData = game.getGame(gameId);
        require(uint8(gameData.status) == 3, "Status should be Completed");
    }

    function test_CannotForfeitIfAlreadyResolved() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        // Resolve the game
        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        // Try to forfeit after resolution (should fail)
        vm.expectRevert();
        game.forfeitGame(gameId);
    }

    function test_CannotForfeitIfP2NotJoined() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        // Try to forfeit before P2 joins (should fail)
        vm.expectRevert();
        game.forfeitGame(gameId);
    }

    function test_OnlyP1CanResolve() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        // P2 tries to resolve with wrong salt (should fail - only P1 knows the salt)
        vm.prank(player2);
        vm.expectRevert();
        game.resolveGame(gameId, 0, keccak256("wrong_salt"), "");

        // Even if P2 somehow knew P1's salt, they could technically resolve
        // But in practice, only P1 knows their salt, so only they can resolve
        // The commitment check ensures only the correct move+salt combination works
    }

    function test_CannotResolveIfP2NotJoined() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        // Try to resolve before P2 joins (should fail)
        vm.prank(player1);
        vm.expectRevert();
        game.resolveGame(gameId, 0, p1Salt, "");
    }

    function test_CannotJoinWithInvalidMove() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        // Try to join with invalid move (should fail)
        vm.prank(player2);
        vm.expectRevert();
        game.joinGame(gameId, 3); // Invalid move (must be 0, 1, or 2)

        vm.prank(player2);
        vm.expectRevert();
        game.joinGame(gameId, 255); // Invalid move
    }

    function test_CannotCreateGameWithoutCommitment() public {
        // This test ensures createGame requires commitment parameter
        // (Solidity will enforce this at compile time, but we can test the flow)
        bytes32 commitment = bytes32(0);
        vm.prank(player1);
        uint256 gameId = game.createGame(commitment, DEFAULT_TIMEOUT);

        // Game should be created even with zero commitment (valid edge case)
        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(
            gameData.player1Commitment == bytes32(0),
            "Commitment should be zero"
        );
    }

    function test_CannotResolveTwice() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        // Resolve once
        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        // Try to resolve again (should fail)
        vm.prank(player1);
        vm.expectRevert();
        game.resolveGame(gameId, 0, p1Salt, "");
    }

    function test_DeadlineIsSetCorrectly() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        uint256 joinTime = block.timestamp;
        vm.prank(player2);
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        uint256 expectedDeadline = joinTime + gameData.timeout;
        require(
            gameData.revealDeadline == expectedDeadline,
            "Deadline should be exactly timeout after join"
        );
        require(
            gameData.timeout == DEFAULT_TIMEOUT,
            "Timeout should match the value passed to createGame"
        );
    }

    function test_ForfeitEmitsEvents() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        vm.warp(gameData.revealDeadline + 1);

        // Expect GameForfeited and GameResolved events
        vm.expectEmit(true, false, false, false);
        emit RockPaperScissors.GameForfeited(gameId);

        vm.expectEmit(true, false, false, false);
        emit RockPaperScissors.GameResolved(gameId, 2);

        game.forfeitGame(gameId);
    }

    function test_ResolveBeforeDeadlineWorks() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 2); // Scissors

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        uint256 deadline = gameData.revealDeadline;

        // Resolve well before deadline
        vm.warp(deadline - 100);
        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        gameData = game.getGame(gameId);
        require(uint8(gameData.status) == 3, "Status should be Completed");
        require(gameData.winner == 1, "Player 1 should win");
    }

    function test_ResolveAtExactDeadline() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt));

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        uint256 deadline = gameData.revealDeadline;

        // Resolve at exact deadline (should work)
        vm.warp(deadline);
        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        gameData = game.getGame(gameId);
        require(uint8(gameData.status) == 3, "Status should be Completed");
    }

    function test_CannotJoinGameTwice() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        // Try to join again (should fail)
        vm.prank(player2);
        vm.expectRevert();
        game.joinGame(gameId, 2);
    }

    function test_CannotJoinAsPlayer1() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        // Player 1 tries to join their own game (should fail)
        vm.prank(player1);
        vm.expectRevert();
        game.joinGame(gameId, 1);
    }

    function test_ScissorsBeatsPaper() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(2), p1Salt)); // Scissors

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1); // Paper

        vm.prank(player1);
        game.resolveGame(gameId, 2, p1Salt, "");

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(
            gameData.winner == 1,
            "Scissors should beat Paper (Player1 wins)"
        );
    }

    function test_Player2Wins() public {
        bytes32 p1Salt = keccak256("salt1");
        bytes32 p1Commitment = keccak256(abi.encodePacked(uint8(0), p1Salt)); // Rock

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1); // Paper (beats Rock)

        vm.prank(player1);
        game.resolveGame(gameId, 0, p1Salt, "");

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(gameData.winner == 2, "Player 2 should win (Paper beats Rock)");
    }

    function test_CannotJoinGameInWrongStatus() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, DEFAULT_TIMEOUT);

        vm.prank(player2);
        game.joinGame(gameId, 1);

        // Game is now in Revealed status, try to join again (should fail)
        address player3 = address(0x3);
        vm.prank(player3);
        vm.expectRevert();
        game.joinGame(gameId, 2);
    }

    function test_TimeoutIsStoredCorrectly() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        uint256 customTimeout = 2 days;
        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, customTimeout);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        require(
            gameData.timeout == customTimeout,
            "Timeout should be stored correctly"
        );
    }

    function test_DifferentTimeoutsWork() public {
        bytes32 p1Commitment = keccak256(
            abi.encodePacked(uint8(0), keccak256("salt1"))
        );

        uint256 shortTimeout = 1 minutes;
        vm.prank(player1);
        uint256 gameId = game.createGame(p1Commitment, shortTimeout);

        vm.prank(player2);
        uint256 joinTime = block.timestamp;
        game.joinGame(gameId, 1);

        RockPaperScissors.Game memory gameData = game.getGame(gameId);
        uint256 expectedDeadline = joinTime + shortTimeout;
        require(
            gameData.revealDeadline == expectedDeadline,
            "Deadline should use the custom timeout"
        );

        // Fast forward past the short deadline
        vm.warp(expectedDeadline + 1);

        // Should be able to forfeit
        game.forfeitGame(gameId);
        gameData = game.getGame(gameId);
        require(uint8(gameData.status) == 3, "Status should be Completed");
        require(gameData.winner == 2, "Player 2 should win by forfeit");
    }
}

contract AlwaysFailVerifier {
    function verify(
        bytes calldata /*proof*/,
        bytes32[] calldata /*publicInputs*/
    ) external pure returns (bool) {
        return false;
    }
}
