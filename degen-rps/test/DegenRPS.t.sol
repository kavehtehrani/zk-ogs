// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {DegenRPS} from "../src/DegenRPS.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";
import {MockVerifier} from "./MockVerifier.sol";

contract DegenRPSTest is Test {
    DegenRPS public degenRPS;
    MockERC20 public token;
    MockVerifier public verifier;
    
    address public player1 = address(0x1);
    address public player2 = address(0x2);
    
    uint256 public constant BET_AMOUNT = 1000e18;

    function setUp() public {
        verifier = new MockVerifier();
        degenRPS = new DegenRPS(address(verifier));
        token = new MockERC20("Test Token", "TEST", 18);
        
        // Mint tokens to players
        token.mint(player1, 10000e18);
        token.mint(player2, 10000e18);
        
        // Approve contract
        vm.prank(player1);
        token.approve(address(degenRPS), type(uint256).max);
        
        vm.prank(player2);
        token.approve(address(degenRPS), type(uint256).max);
    }

    function testCreateGame() public {
        bytes32 commitment = keccak256(abi.encodePacked(uint8(DegenRPS.Move.Rock), bytes32(uint256(123))));
        bytes memory proof = "mock_proof";
        
        vm.prank(player1);
        uint256 gameId = degenRPS.createGame(address(token), BET_AMOUNT, commitment, proof);
        
        assertEq(gameId, 0);
        DegenRPS.Game memory game = degenRPS.getGame(gameId);
        assertEq(game.player1, player1);
        assertEq(address(game.token), address(token));
        assertEq(game.betAmount, BET_AMOUNT);
        assertEq(game.commitment, commitment);
        assertEq(uint256(game.state), uint256(DegenRPS.GameState.WaitingForPlayer2));
    }

    function testJoinGame() public {
        bytes32 salt = bytes32(uint256(123));
        bytes32 commitment = keccak256(abi.encodePacked(uint8(DegenRPS.Move.Rock), salt));
        bytes memory proof = "mock_proof";
        
        vm.prank(player1);
        uint256 gameId = degenRPS.createGame(address(token), BET_AMOUNT, commitment, proof);
        
        vm.prank(player2);
        degenRPS.joinGame(gameId, DegenRPS.Move.Paper);
        
        DegenRPS.Game memory game = degenRPS.getGame(gameId);
        assertEq(game.player2, player2);
        assertEq(uint256(game.player2Move), uint256(DegenRPS.Move.Paper));
        assertEq(uint256(game.state), uint256(DegenRPS.GameState.WaitingForReveal));
        assertGt(game.revealDeadline, block.timestamp);
    }

    function testRevealAndSettle_Player1Wins() public {
        bytes32 salt = bytes32(uint256(123));
        DegenRPS.Move player1Move = DegenRPS.Move.Rock;
        bytes32 commitment = keccak256(abi.encodePacked(uint8(player1Move), salt));
        bytes memory proof = "mock_proof";
        
        vm.prank(player1);
        uint256 gameId = degenRPS.createGame(address(token), BET_AMOUNT, commitment, proof);
        
        vm.prank(player2);
        degenRPS.joinGame(gameId, DegenRPS.Move.Scissors);
        
        vm.prank(player1);
        degenRPS.revealAndSettle(gameId, player1Move, salt, proof);
        
        DegenRPS.Game memory game = degenRPS.getGame(gameId);
        assertEq(uint256(game.state), uint256(DegenRPS.GameState.Settled));
        assertEq(uint256(game.player1Move), uint256(player1Move));
        assertEq(game.winner, player1); // Player1 should have won (Rock beats Scissors)
        
        // Withdraw as winner
        uint256 player1BalanceBefore = token.balanceOf(player1);
        vm.prank(player1);
        degenRPS.withdraw(gameId);
        uint256 player1BalanceAfter = token.balanceOf(player1);
        assertEq(player1BalanceAfter - player1BalanceBefore, BET_AMOUNT * 2);
    }

    function testRevealAndSettle_Player2Wins() public {
        bytes32 salt = bytes32(uint256(123));
        DegenRPS.Move player1Move = DegenRPS.Move.Rock;
        bytes32 commitment = keccak256(abi.encodePacked(uint8(player1Move), salt));
        bytes memory proof = "mock_proof";
        
        vm.prank(player1);
        uint256 gameId = degenRPS.createGame(address(token), BET_AMOUNT, commitment, proof);
        
        vm.prank(player2);
        degenRPS.joinGame(gameId, DegenRPS.Move.Paper);
        
        vm.prank(player1);
        degenRPS.revealAndSettle(gameId, player1Move, salt, proof);
        
        DegenRPS.Game memory game = degenRPS.getGame(gameId);
        assertEq(game.winner, player2); // Player2 should have won (Paper beats Rock)
        
        // Withdraw as winner
        uint256 player2BalanceBefore = token.balanceOf(player2);
        vm.prank(player2);
        degenRPS.withdraw(gameId);
        uint256 player2BalanceAfter = token.balanceOf(player2);
        assertEq(player2BalanceAfter - player2BalanceBefore, BET_AMOUNT * 2);
    }

    function testRevealAndSettle_Tie() public {
        bytes32 salt = bytes32(uint256(123));
        DegenRPS.Move player1Move = DegenRPS.Move.Rock;
        bytes32 commitment = keccak256(abi.encodePacked(uint8(player1Move), salt));
        bytes memory proof = "mock_proof";
        
        vm.prank(player1);
        uint256 gameId = degenRPS.createGame(address(token), BET_AMOUNT, commitment, proof);
        
        vm.prank(player2);
        degenRPS.joinGame(gameId, DegenRPS.Move.Rock);
        
        vm.prank(player1);
        degenRPS.revealAndSettle(gameId, player1Move, salt, proof);
        
        DegenRPS.Game memory game = degenRPS.getGame(gameId);
        assertEq(game.winner, address(0)); // Tie
        
        // Withdraw - either player can call withdraw to refund both
        uint256 player1BalanceBefore = token.balanceOf(player1);
        uint256 player2BalanceBefore = token.balanceOf(player2);
        
        vm.prank(player1);
        degenRPS.withdraw(gameId);
        
        // Both should get their bets back (tie) - withdraw handles both transfers
        uint256 player1BalanceAfter = token.balanceOf(player1);
        uint256 player2BalanceAfter = token.balanceOf(player2);
        assertEq(player1BalanceAfter - player1BalanceBefore, BET_AMOUNT);
        assertEq(player2BalanceAfter - player2BalanceBefore, BET_AMOUNT);
    }

    function testRefund_NoPlayer2() public {
        bytes32 salt = bytes32(uint256(123));
        bytes32 commitment = keccak256(abi.encodePacked(uint8(DegenRPS.Move.Rock), salt));
        bytes memory proof = "mock_proof";
        
        vm.prank(player1);
        uint256 gameId = degenRPS.createGame(address(token), BET_AMOUNT, commitment, proof);
        
        uint256 player1BalanceBefore = token.balanceOf(player1);
        
        vm.prank(player1);
        degenRPS.refund(gameId);
        
        uint256 player1BalanceAfter = token.balanceOf(player1);
        assertEq(player1BalanceAfter - player1BalanceBefore, BET_AMOUNT);
        
        DegenRPS.Game memory game = degenRPS.getGame(gameId);
        assertEq(uint256(game.state), uint256(DegenRPS.GameState.Settled));
    }

    function testRefund_Timeout() public {
        bytes32 salt = bytes32(uint256(123));
        DegenRPS.Move player1Move = DegenRPS.Move.Rock;
        bytes32 commitment = keccak256(abi.encodePacked(uint8(player1Move), salt));
        bytes memory proof = "mock_proof";
        
        vm.prank(player1);
        uint256 gameId = degenRPS.createGame(address(token), BET_AMOUNT, commitment, proof);
        
        vm.prank(player2);
        degenRPS.joinGame(gameId, DegenRPS.Move.Paper);
        
        // Fast forward past reveal deadline (default is 30 mins)
        vm.warp(block.timestamp + 1 hours);
        
        uint256 player2BalanceBefore = token.balanceOf(player2);
        
        vm.prank(player2);
        degenRPS.refund(gameId);
        
        // Player2 should get both bets (player1 didn't reveal in time)
        uint256 player2BalanceAfter = token.balanceOf(player2);
        assertEq(player2BalanceAfter - player2BalanceBefore, BET_AMOUNT * 2);
    }

    function testGetGamesWaitingForPlayer2() public {
        bytes32 salt1 = bytes32(uint256(123));
        bytes32 salt2 = bytes32(uint256(456));
        bytes32 commitment1 = keccak256(abi.encodePacked(uint8(DegenRPS.Move.Rock), salt1));
        bytes32 commitment2 = keccak256(abi.encodePacked(uint8(DegenRPS.Move.Paper), salt2));
        bytes memory proof = "mock_proof";
        
        vm.prank(player1);
        uint256 gameId1 = degenRPS.createGame(address(token), BET_AMOUNT, commitment1, proof);
        
        vm.prank(player1);
        uint256 gameId2 = degenRPS.createGame(address(token), BET_AMOUNT, commitment2, proof);
        
        uint256[] memory waitingGames = degenRPS.getGamesWaitingForPlayer2();
        assertEq(waitingGames.length, 2);
        assertEq(waitingGames[0], gameId1);
        assertEq(waitingGames[1], gameId2);
        
        // Player2 joins game1
        vm.prank(player2);
        degenRPS.joinGame(gameId1, DegenRPS.Move.Paper);
        
        waitingGames = degenRPS.getGamesWaitingForPlayer2();
        assertEq(waitingGames.length, 1);
        assertEq(waitingGames[0], gameId2);
    }
}
