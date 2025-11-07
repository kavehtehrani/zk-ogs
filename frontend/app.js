import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { ethers } from "ethers";

// Circuit will be loaded dynamically
let circuit = null;

// Game state
let gameState = {
  gameId: null,
  playerNumber: null,
  move: null,
  salt: null,
  commitment: null,
  isCommitted: false,
  isRevealed: false,
  isResolving: false, // Flag to prevent multiple simultaneous resolves
};

let noir = null;
let backend = null;
let provider = null;
let signer = null;
let contract = null;

// Contract ABI and address - will be loaded from artifacts
let CONTRACT_ABI = null;
let CONTRACT_ADDRESS = null;

// Load contract artifact
async function loadContractArtifact() {
  try {
    const artifactResponse = await fetch("/contract-artifact.json");
    const artifact = await artifactResponse.json();
    CONTRACT_ABI = artifact.abi;
    log("✅ Contract ABI loaded");
  } catch (error) {
    log(`❌ Error loading contract artifact: ${error.message}`);
    throw error;
  }
}

// Initialize Noir
async function initNoir() {
  try {
    log("Loading circuit...");
    const circuitResponse = await fetch("/target/circuit.json");
    if (!circuitResponse.ok) {
      throw new Error(`Failed to load circuit: ${circuitResponse.statusText}`);
    }
    circuit = await circuitResponse.json();

    log("Initializing Noir and Barretenberg...");
    noir = new Noir(circuit);
    backend = new UltraHonkBackend(circuit.bytecode);
    log("✅ Noir initialized successfully");
  } catch (error) {
    log(`❌ Error initializing Noir: ${error.message}`);
    log("💡 Make sure circuit.json exists in frontend/target/");
    console.error("Noir initialization error:", error);
    throw error;
  }
}

// Logging utility
function log(message) {
  const logsDiv = document.getElementById("logs");
  const entry = document.createElement("div");
  entry.className = "log-entry rounded-lg";

  // Add emoji based on message type
  let emoji = "📝";
  if (message.includes("✅")) emoji = "✅";
  else if (message.includes("❌")) emoji = "❌";
  else if (message.includes("⚠️")) emoji = "⚠️";
  else if (message.includes("💡")) emoji = "💡";
  else if (message.includes("🎉")) emoji = "🎉";
  else if (message.includes("⏳")) emoji = "⏳";
  else if (message.includes("🚀")) emoji = "🚀";

  entry.innerHTML = `
    <span class="text-gray-500 text-sm">[${new Date().toLocaleTimeString()}]</span>
    <span class="ml-2">${emoji} ${message}</span>
  `;
  logsDiv.appendChild(entry);
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

// Set contract address manually
function setContractAddress() {
  const address = document.getElementById("contractAddressInput").value.trim();
  if (!ethers.isAddress(address)) {
    log("❌ Invalid contract address");
    return;
  }

  CONTRACT_ADDRESS = address;
  log(`✅ Contract address set: ${address}`);

  // Connect contract if wallet is connected
  if (signer && CONTRACT_ABI) {
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    log("✅ Contract connected");
  } else {
    log(
      "⚠️ Connect wallet first, then contract will be connected automatically"
    );
  }
}

// Connect wallet
async function connectWallet() {
  if (typeof window.ethereum === "undefined") {
    log("❌ MetaMask not found. Please install MetaMask.");
    log(
      "💡 Tip: Make sure MetaMask is installed and configured for Sepolia testnet (Chain ID: 11155111)"
    );
    return;
  }

  try {
    // Request network switch to Sepolia if needed
    // Sepolia testnet uses chain ID 11155111
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xAA36A7" }], // 11155111 in hex
      });
    } catch (switchError) {
      // Chain doesn't exist, add it
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0xAA36A7", // 11155111 in hex (Sepolia)
              chainName: "Sepolia",
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://sepolia.infura.io/v3/"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
      }
    }

    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    const address = await signer.getAddress();

    document.getElementById("walletInfo").innerHTML = `
      <div class="px-4 py-2 bg-gradient-to-r from-green-100 to-emerald-100 rounded-xl border-2 border-green-300">
        <p class="text-green-800 font-semibold">
          ✅ Connected: <span class="font-mono">${address.slice(
            0,
            6
          )}...${address.slice(-4)}</span>
        </p>
      </div>
    `;

    log(`✅ Connected to wallet: ${address}`);

    // Load contract if address is available
    if (CONTRACT_ADDRESS && CONTRACT_ABI) {
      contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      log("✅ Contract connected");
    } else {
      log("⚠️ Enter contract address above and click 'Set Contract'");
    }
  } catch (error) {
    log(`❌ Error connecting wallet: ${error.message}`);
    if (error.message.includes("JSON")) {
      log("💡 Make sure Hardhat node is running: npx hardhat node");
    }
  }
}

// Create game - Player 1 must select move first
async function createGame() {
  if (!contract) {
    log("❌ Contract not loaded. Please deploy contract first.");
    return;
  }

  // Check if move is already selected
  if (gameState.move === null || gameState.move === undefined) {
    log("❌ Please select your move first (Rock, Paper, or Scissors)");
    return;
  }

  const btn = document.getElementById("createGameBtn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Creating...";

  try {
    // Generate random salt
    const salt = ethers.randomBytes(32);
    const saltField = ethers.hexlify(salt);

    // Create Keccak256 commitment (for contract verification)
    const commitment = ethers.keccak256(
      ethers.solidityPacked(["uint8", "bytes32"], [gameState.move, saltField])
    );

    log(
      `Move: ${
        gameState.move === 0
          ? "Rock"
          : gameState.move === 1
          ? "Paper"
          : "Scissors"
      }`
    );
    log(`Commitment: ${commitment.slice(0, 10)}...`);
    log("Creating game with committed move (Player 1)...");

    // Store move and salt locally for later reveal
    gameState.salt = saltField;
    gameState.commitment = commitment;
    gameState.isCommitted = true;

    const tx = await contract.createGame(commitment);
    log(`Transaction sent: ${tx.hash}`);

    const receipt = await tx.wait();
    log(`Transaction confirmed in block ${receipt.blockNumber}`);

    // Get game ID from event
    const event = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed && parsed.name === "GameCreated";
      } catch {
        return false;
      }
    });

    if (event) {
      const parsed = contract.interface.parseLog(event);
      gameState.gameId = parsed.args.gameId.toString();
      gameState.playerNumber = 1;
      updateGameStatus();
      updateMoveStatus();
      updateRevealStatus();
      updateButtonStates(); // Disable create button after game is created
      log(`✅ Game created! Game ID: ${gameState.gameId}`);
      log("⏳ Waiting for Player 2 to join...");

      // Start polling for game updates
      startGameResultPolling();
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  } catch (error) {
    log(`❌ Error creating game: ${error.message}`);
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Join game - Player 2 must select move first
async function joinGame() {
  if (!contract) {
    log("❌ Contract not loaded.");
    return;
  }

  const gameId = document.getElementById("gameIdInput").value;
  if (!gameId) {
    log("❌ Please enter a game ID");
    return;
  }

  // Check if move is already selected
  if (gameState.move === null || gameState.move === undefined) {
    log("❌ Please select your move first (Rock, Paper, or Scissors)");
    return;
  }

  const btn = document.getElementById("joinGameBtn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Joining...";

  try {
    log(
      `Joining game ${gameId} as Player 2 with move: ${
        gameState.move === 0
          ? "Rock"
          : gameState.move === 1
          ? "Paper"
          : "Scissors"
      }...`
    );
    log(
      "💡 Note: Player 2's move is submitted directly (no commit/reveal needed)"
    );
    const tx = await contract.joinGame(gameId, gameState.move);
    const receipt = await tx.wait();

    gameState.gameId = gameId;
    gameState.playerNumber = 2;

    // Get deadline from event
    const event = receipt.logs.find((log) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed && parsed.name === "PlayerJoined";
      } catch {
        return false;
      }
    });

    if (event) {
      const parsed = contract.interface.parseLog(event);
      const deadline = Number(parsed.args.revealDeadline);
      log(`✅ Joined game ${gameId}`);
      log(
        `⏰ Player 1 has until ${new Date(
          deadline * 1000
        ).toLocaleTimeString()} to reveal`
      );
    }

    await updateGameStatus();
    updateMoveStatus();
    updateRevealStatus();
    updateButtonStates(); // Update button states after joining

    // Start polling for game updates and deadline checking
    startGameResultPolling();
    startDeadlinePolling();
    btn.disabled = false;
    btn.innerHTML = originalText;
  } catch (error) {
    log(`❌ Error joining game: ${error.message}`);
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Select move (for both players)
// For Player 1: stores move locally, will be committed when creating game
// For Player 2: stores move locally, will be submitted when joining game
function selectMove(move) {
  gameState.move = move;
  updateMoveStatus();
  updateButtonStates();
  log(
    `✅ Move selected: ${
      move === 0 ? "Rock" : move === 1 ? "Paper" : "Scissors"
    }`
  );

  if (!gameState.gameId) {
    log("💡 Now you can click 'Create Game' to create a game with this move");
  } else if (gameState.playerNumber === 2) {
    log("💡 Now you can click 'Join Game' to join with this move");
  }
}

// Update button states based on move selection
function updateButtonStates() {
  const createBtn = document.getElementById("createGameBtn");
  const joinBtn = document.getElementById("joinGameBtn");

  const hasMove = gameState.move !== null && gameState.move !== undefined;
  const hasGameId = gameState.gameId !== null;

  if (createBtn) {
    if (hasMove && !hasGameId) {
      // Enable create button if move selected and no game yet
      createBtn.disabled = false;
      createBtn.className =
        "px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold rounded-xl hover:from-green-700 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl";
      createBtn.innerHTML = "✨ Create Game";
    } else if (!hasMove) {
      // Disable if no move selected
      createBtn.disabled = true;
      createBtn.className =
        "px-6 py-3 bg-gray-400 text-white font-semibold rounded-xl cursor-not-allowed transition-all duration-200";
      createBtn.innerHTML = "✨ Create Game (Select move first)";
    }
  }

  if (joinBtn) {
    const gameIdInput = document.getElementById("gameIdInput");
    const hasGameIdInput = gameIdInput && gameIdInput.value.trim() !== "";

    if (hasMove && hasGameIdInput) {
      // Enable join button if move selected and game ID entered
      joinBtn.disabled = false;
      joinBtn.className =
        "px-6 py-3 bg-gradient-to-r from-orange-600 to-red-600 text-white font-semibold rounded-xl hover:from-orange-700 hover:to-red-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl";
      joinBtn.innerHTML = "🚀 Join Game";
    } else {
      // Disable if no move or no game ID
      joinBtn.disabled = true;
      joinBtn.className =
        "px-6 py-3 bg-gray-400 text-white font-semibold rounded-xl cursor-not-allowed transition-all duration-200";
      if (!hasMove) {
        joinBtn.innerHTML = "🚀 Join Game (Select move first)";
      } else {
        joinBtn.innerHTML = "🚀 Join Game";
      }
    }
  }
}

// Helper function to determine winner locally
function determineWinnerLocal(move1, move2) {
  if (move1 === move2) return 0;
  // Rock beats Scissors, Paper beats Rock, Scissors beats Paper
  if (move1 === 0 && move2 === 2) return 1; // Rock beats Scissors
  if (move1 === 1 && move2 === 0) return 1; // Paper beats Rock
  if (move1 === 2 && move2 === 1) return 1; // Scissors beats Paper
  return 2; // Player 2 wins
}

// Serialize proof for contract
async function serializeProof(proof) {
  // Barretenberg proof format: proof is a Uint8Array or similar
  // The backend.generateProof returns a proof that needs to be serialized
  try {
    // Check if proof is already bytes/hex
    if (typeof proof === "string" && proof.startsWith("0x")) {
      return proof;
    }

    // Check if it's a Uint8Array
    if (proof instanceof Uint8Array) {
      return ethers.hexlify(proof);
    }

    // Barretenberg bb.js proof format: check for proof.proof (raw bytes)
    if (proof.proof) {
      if (proof.proof instanceof Uint8Array) {
        return ethers.hexlify(proof.proof);
      }
      // If proof.proof is an object, try to get its bytes
      if (proof.proof.bytes && proof.proof.bytes instanceof Uint8Array) {
        return ethers.hexlify(proof.proof.bytes);
      }
    }

    // Check if it has a serialized property
    if (proof.serialized) {
      if (proof.serialized instanceof Uint8Array) {
        return ethers.hexlify(proof.serialized);
      }
      if (typeof proof.serialized === "string") {
        return proof.serialized;
      }
    }

    // Try to get bytes from the proof object
    // Barretenberg proofs are typically Uint8Array
    if (proof.bytes) {
      if (proof.bytes instanceof Uint8Array) {
        return ethers.hexlify(proof.bytes);
      }
      if (typeof proof.bytes === "string") {
        return proof.bytes;
      }
    }

    // Check for ArrayBuffer
    if (proof instanceof ArrayBuffer) {
      return ethers.hexlify(new Uint8Array(proof));
    }

    // Last resort: log the proof structure for debugging
    console.log("Proof structure:", proof);
    console.log("Proof type:", typeof proof);
    console.log("Proof keys:", Object.keys(proof || {}));
    if (proof.proof) {
      console.log("proof.proof type:", typeof proof.proof);
      console.log("proof.proof keys:", Object.keys(proof.proof || {}));
    }

    throw new Error("Could not serialize proof - unknown format");
  } catch (error) {
    console.error("Error serializing proof:", error);
    throw error; // Don't return empty proof, throw so caller knows it failed
  }
}

// Update game status display
async function updateGameStatus() {
  if (!contract || !gameState.gameId) return;

  try {
    const game = await contract.getGame(gameState.gameId);
    const statusText = ["Waiting", "Committed", "Revealed", "Completed"][
      game.status
    ];
    const statusClass = `status-${statusText.toLowerCase()}`;

    let deadlineHtml = "";
    if (game.revealDeadline > 0 && game.status !== 3) {
      const deadline = Number(game.revealDeadline);
      const now = Math.floor(Date.now() / 1000);
      const timeRemaining = deadline - now;
      const minutes = Math.floor(timeRemaining / 60);
      const seconds = timeRemaining % 60;
      const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      const isUrgent = timeRemaining < 60;

      deadlineHtml = `
        <div class="mt-3 p-3 bg-${
          isUrgent ? "red" : "yellow"
        }-50 border border-${isUrgent ? "red" : "yellow"}-200 rounded-lg">
          <p class="text-${
            isUrgent ? "red" : "yellow"
          }-800 font-semibold text-sm">
            ⏰ Deadline: ${timeStr} remaining
          </p>
        </div>
      `;
    }

    document.getElementById("gameStatus").innerHTML = `
      <div class="bg-white rounded-xl p-4 border-2 border-gray-200 slide-up">
        <div class="flex flex-wrap items-center gap-3 mb-2">
          <span class="status-badge ${statusClass}">${statusText}</span>
          <span class="text-gray-600 font-semibold">Game ID: <span class="font-mono text-purple-600">${gameState.gameId}</span></span>
        </div>
        <p class="text-gray-700 font-medium">
          👤 You are <span class="text-purple-600 font-bold">Player ${gameState.playerNumber}</span>
        </p>
        ${deadlineHtml}
      </div>
    `;
  } catch (error) {
    log(`Error updating game status: ${error.message}`);
  }
}

// Update move status
function updateMoveStatus() {
  const moveStatusDiv = document.getElementById("moveStatus");
  if (!moveStatusDiv) return;

  if (gameState.move === null || gameState.move === undefined) {
    moveStatusDiv.innerHTML = `
      <div class="bg-gray-50 rounded-xl p-4 border-2 border-gray-200">
        <p class="text-gray-600 text-center">
          ⚠️ No move selected yet. Please select Rock, Paper, or Scissors above.
        </p>
      </div>
    `;
    return;
  }

  const moveNames = ["🪨 Rock", "📄 Paper", "✂️ Scissors"];
  const moveEmojis = ["🪨", "📄", "✂️"];
  moveStatusDiv.innerHTML = `
    <div class="bg-white rounded-xl p-4 border-2 border-gray-200 slide-up">
      <div class="flex items-center justify-center gap-3">
        <span class="text-4xl">${moveEmojis[gameState.move]}</span>
        <div class="text-left">
          <p class="text-lg font-bold text-gray-800">${
            moveNames[gameState.move]
          }</p>
          <p class="text-sm ${
            gameState.isCommitted
              ? "text-green-600 font-semibold"
              : "text-gray-500"
          }">
            ${gameState.isCommitted ? "✅ Committed" : "⏳ Ready to use"}
          </p>
        </div>
      </div>
    </div>
  `;
}

// Update reveal status
function updateRevealStatus() {
  addRevealButton();
}

// Polling interval for checking game result
let gameResultPollInterval = null;
let deadlinePollInterval = null;

// Check game result
async function checkGameResult() {
  if (!contract || !gameState.gameId) return;

  try {
    const game = await contract.getGame(gameState.gameId);
    const statusNum = Number(game.status);

    // Update game status display (includes deadline info)
    await updateGameStatus();
    updateRevealStatus();

    // If Player 2 just joined and Player 1 is watching, start deadline polling
    if (
      statusNum === 2 &&
      game.player2 !== ethers.ZeroAddress &&
      gameState.playerNumber === 1
    ) {
      if (!deadlinePollInterval) {
        startDeadlinePolling();
      }
    }

    if (statusNum === 3) {
      // Completed - stop polling
      if (gameResultPollInterval) {
        clearInterval(gameResultPollInterval);
        gameResultPollInterval = null;
      }
      if (deadlinePollInterval) {
        clearInterval(deadlinePollInterval);
        deadlinePollInterval = null;
      }

      // Show result
      const winnerNum = Number(game.winner);
      let winnerText = "";
      let announcement = "";

      if (winnerNum === 0) {
        winnerText = "Tie";
        announcement = "🤝 It's a TIE!";
      } else if (winnerNum === gameState.playerNumber) {
        winnerText = "You";
        announcement = "🎉 YOU WIN! 🎉";
      } else {
        winnerText = `Player ${winnerNum}`;
        announcement = "😔 You lost. Better luck next time!";
      }

      // Show big announcement (only if not already shown)
      if (!document.getElementById("gameResult")) {
        showGameResult(announcement, winnerNum, game);
      }

      log(`🎉 Game completed! Winner: ${winnerText}`);
      log(`Player 1 played: ${getMoveName(game.player1Move)}`);
      log(`Player 2 played: ${getMoveName(game.player2Move)}`);
    } else if (statusNum === 2) {
      // Status is "Revealed" - Player 2 joined, waiting for Player 1 to reveal
      if (gameState.playerNumber === 1) {
        log("⏳ Player 2 has joined. Reveal your move before the deadline!");
      } else {
        log("⏳ Waiting for Player 1 to reveal...");
      }
    } else if (statusNum === 1) {
      // Status is "Committed" - Player 1 created game, waiting for Player 2
      if (gameState.playerNumber === 1) {
        log("⏳ Waiting for Player 2 to join...");
      }
    }
  } catch (error) {
    log(`Error checking game result: ${error.message}`);
  }
}

// Start polling for game result
function startGameResultPolling() {
  // Clear any existing interval
  if (gameResultPollInterval) {
    clearInterval(gameResultPollInterval);
  }

  // Check immediately
  checkGameResult();

  // Then poll every 2 seconds
  gameResultPollInterval = setInterval(() => {
    checkGameResult();
  }, 2000);
}

// Resolve game - Player 1 reveals their move with ZK proof
// Player 2's move is already stored on-chain from joinGame()
async function resolveGame() {
  if (!contract || !noir || !backend) {
    log("❌ Noir or contract not initialized");
    return;
  }

  if (gameState.playerNumber !== 1) {
    log("❌ Only Player 1 can reveal their move");
    log("💡 Player 2's move was already submitted when they joined");
    return;
  }

  if (!gameState.isCommitted) {
    log("❌ Move not committed yet");
    return;
  }

  if (gameState.isRevealed) {
    log("❌ Game already resolved");
    return;
  }

  try {
    log("Getting game state from contract...");
    const game = await contract.getGame(gameState.gameId);

    // Check that Player 2 has joined
    if (game.player2 === ethers.ZeroAddress || game.player2Move === 255) {
      log("⏳ Waiting for Player 2 to join...");
      return;
    }

    // Check deadline
    const deadline = Number(game.revealDeadline);
    const now = Math.floor(Date.now() / 1000);
    if (now > deadline) {
      log("❌ Deadline has passed. Game will be forfeited.");
      return;
    }

    const timeRemaining = deadline - now;
    if (timeRemaining < 60) {
      log(`⚠️ Warning: Only ${timeRemaining} seconds remaining to reveal!`);
    }

    // Get Player 2's move from contract (already stored)
    const move1 = Number(gameState.move);
    const move2 = Number(game.player2Move);

    // Validate moves
    if (move1 < 0 || move1 > 2 || move2 < 0 || move2 > 2) {
      log(`❌ Invalid moves: move1=${move1}, move2=${move2}`);
      throw new Error(`Invalid moves: move1=${move1}, move2=${move2}`);
    }

    log(
      `✅ Player 1's move: ${
        move1 === 0 ? "Rock" : move1 === 1 ? "Paper" : "Scissors"
      }`
    );
    log(
      `✅ Player 2's move: ${
        move2 === 0 ? "Rock" : move2 === 1 ? "Paper" : "Scissors"
      }`
    );
    log("Generating ZK proof... ⏳");

    const winner = determineWinnerLocal(move1, move2);
    log(`Expected winner: ${winner === 0 ? "Tie" : `Player ${winner}`}`);

    // Validate winner
    if (winner < 0 || winner > 2) {
      log(`❌ Invalid winner calculation: ${winner}`);
      throw new Error(`Invalid winner: ${winner}`);
    }

    // Double-check: verify the winner calculation is correct
    // This should match the circuit's determine_winner function exactly
    let expectedWinner;
    if (move1 === move2) {
      expectedWinner = 0; // Tie
    } else if (move1 === 0 && move2 === 2) {
      expectedWinner = 1; // Rock beats Scissors
    } else if (move1 === 1 && move2 === 0) {
      expectedWinner = 1; // Paper beats Rock
    } else if (move1 === 2 && move2 === 1) {
      expectedWinner = 1; // Scissors beats Paper
    } else {
      expectedWinner = 2; // Player 2 wins
    }

    if (winner !== expectedWinner) {
      log(
        `❌ Winner mismatch! Computed: ${winner}, Expected: ${expectedWinner}`
      );
      throw new Error(
        `Winner calculation error: ${winner} !== ${expectedWinner}`
      );
    }

    // Generate proof - Noir expects Field values
    // Based on Noir.js API, inputs should be plain numbers or BigInt
    const inputs = {
      player1_move: move1,
      player2_move: move2,
      winner: winner,
    };

    // Log inputs (convert BigInt to string for logging)
    log(
      `Calling noir.execute with inputs: player1_move=${move1}, player2_move=${move2}, winner=${winner}`
    );

    let witness;
    try {
      const result = await noir.execute(inputs);
      witness = result.witness;
      log("✅ Witness computed successfully");
    } catch (witnessError) {
      log(`❌ Witness computation failed: ${witnessError.message}`);
      throw new Error(`Witness computation failed: ${witnessError.message}`);
    }

    let proof;
    try {
      // Use keccak hash function to match the verifier (generated with --oracle_hash keccak)
      proof = await backend.generateProof(witness, { keccak: true });
      log("✅ Proof generated successfully with Keccak256 hash");
    } catch (proofError) {
      log(`❌ Proof generation failed: ${proofError.message}`);
      throw new Error(`Proof generation failed: ${proofError.message}`);
    }

    // Verify proof locally (also use keccak to match)
    const isValid = await backend.verifyProof(proof, { keccak: true });
    if (!isValid) {
      throw new Error("Proof verification failed locally");
    }

    log("✅ Proof generated and verified!");

    // Debug: Log proof structure
    console.log("Proof object:", proof);
    console.log("Proof keys:", Object.keys(proof || {}));
    if (proof.proof) {
      console.log("proof.proof type:", typeof proof.proof);
      console.log(
        "proof.proof is Uint8Array:",
        proof.proof instanceof Uint8Array
      );
      console.log("proof.proof length:", proof.proof?.length);
    }

    // Serialize proof - bb.js proofs need to be serialized for the verifier
    // Check if proof has a serialize method or specific format
    let proofBytes;
    try {
      // bb.js UltraHonkBackend returns proof with .proof property containing raw bytes
      if (proof.proof && proof.proof instanceof Uint8Array) {
        proofBytes = ethers.hexlify(proof.proof);
        log("✅ Proof serialized from proof.proof (Uint8Array)");
      } else if (backend.serializeProof) {
        proofBytes = await backend.serializeProof(proof);
        log("✅ Proof serialized using backend.serializeProof()");
      } else if (proof.serialize) {
        proofBytes = await proof.serialize();
        log("✅ Proof serialized using proof.serialize()");
      } else {
        // Fall back to our serialization
        proofBytes = await serializeProof(proof);
        log("✅ Proof serialized using custom method");
      }

      // Log proof length for debugging
      const proofLength =
        typeof proofBytes === "string"
          ? (proofBytes.length - 2) / 2 // hex string: subtract '0x' and divide by 2
          : proofBytes.length;
      log(`📏 Proof length: ${proofLength} bytes`);
    } catch (serializeError) {
      log(`❌ Proof serialization failed: ${serializeError.message}`);
      console.error("Proof object:", proof);
      console.error("Backend methods:", Object.keys(backend || {}));
      throw serializeError;
    }

    // Resolve game on contract with Player 1's move, salt, and proof
    log("Resolving game on contract...");

    try {
      // Estimate gas first to catch errors early
      const gasEstimate = await contract.resolveGame.estimateGas(
        gameState.gameId,
        move1,
        gameState.salt,
        proofBytes
      );
      log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

      const tx = await contract.resolveGame(
        gameState.gameId,
        move1,
        gameState.salt,
        proofBytes,
        { gasLimit: gasEstimate * BigInt(2) } // Add buffer
      );
      const receipt = await tx.wait();

      log(`✅ Game resolved! Transaction: ${receipt.hash}`);
      log(`🎉 Winner: ${winner === 0 ? "Tie" : `Player ${winner}`}`);

      gameState.isRevealed = true;

      // Start polling for final result
      setTimeout(() => {
        startGameResultPolling();
      }, 1000);
    } catch (txError) {
      // Enhanced error logging
      log(`❌ Transaction failed: ${txError.message}`);
      if (txError.data) {
        log(`📋 Error data: ${txError.data}`);
        console.error("Full error data:", txError.data);
      }
      if (txError.reason) {
        log(`📋 Error reason: ${txError.reason}`);
      }
      console.error("Full transaction error:", txError);

      // Check if it's a verifier error
      if (txError.data && txError.data.length > 4) {
        const errorSelector = txError.data.slice(0, 10);
        log(`🔍 Error selector: ${errorSelector}`);
        log(
          `💡 This might be a proof format mismatch with the Verifier contract`
        );
        log(`💡 The Verifier was generated from a specific circuit version`);
        log(
          `💡 If the circuit was recompiled, the proof format might not match`
        );
      }

      throw txError;
    }
  } catch (error) {
    log(`❌ Error resolving game: ${error.message}`);
    console.error(error);
    throw error;
  }
}

// Add reveal button handler for Player 1
function addRevealButton() {
  const revealStatusDiv = document.getElementById("revealStatus");
  if (!revealStatusDiv) return;

  if (
    gameState.playerNumber === 1 &&
    gameState.isCommitted &&
    !gameState.isRevealed
  ) {
    revealStatusDiv.innerHTML = `
      <button
        id="revealBtn"
        class="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold rounded-xl hover:from-green-700 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
      >
        🔓 Reveal Move
      </button>
    `;
    document.getElementById("revealBtn").addEventListener("click", resolveGame);
  } else {
    revealStatusDiv.innerHTML = "";
  }
}

// Check deadline and auto-forfeit if passed
async function checkDeadline() {
  if (!contract || !gameState.gameId) return;

  try {
    const game = await contract.getGame(gameState.gameId);
    const isCompleted = game.status === 3; // GameStatus.Completed

    if (isCompleted) {
      // Game already resolved, stop polling
      if (deadlinePollInterval) {
        clearInterval(deadlinePollInterval);
        deadlinePollInterval = null;
      }
      return;
    }

    // Only check deadline if Player 2 has joined
    if (game.player2 === ethers.ZeroAddress || game.revealDeadline === 0) {
      return;
    }

    const deadline = Number(game.revealDeadline);
    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = deadline - now;

    // Update deadline display
    updateDeadlineDisplay(timeRemaining);

    // If deadline passed and game not resolved, forfeit
    if (timeRemaining <= 0 && game.status !== 3) {
      log("⏰ Deadline passed! Forfeiting game...");
      await forfeitGame();
    }
  } catch (error) {
    console.error("Deadline check error:", error);
  }
}

// Forfeit game (anyone can call after deadline)
async function forfeitGame() {
  if (!contract || !gameState.gameId) return;

  try {
    log("Calling forfeitGame()...");
    const tx = await contract.forfeitGame(gameState.gameId);
    await tx.wait();
    log("✅ Game forfeited! Player 2 wins by default.");

    // Stop polling
    if (deadlinePollInterval) {
      clearInterval(deadlinePollInterval);
      deadlinePollInterval = null;
    }

    // Refresh game status
    await checkGameResult();
  } catch (error) {
    log(`❌ Error forfeiting game: ${error.message}`);
  }
}

// Start deadline polling
function startDeadlinePolling() {
  if (deadlinePollInterval) {
    clearInterval(deadlinePollInterval);
  }
  checkDeadline();
  deadlinePollInterval = setInterval(() => {
    checkDeadline();
  }, 2000);
}

// Update deadline display in UI
function updateDeadlineDisplay(timeRemaining) {
  const deadlineDiv = document.getElementById("deadlineDisplay");
  if (!deadlineDiv) return;

  if (timeRemaining <= 0) {
    deadlineDiv.innerHTML = `
      <div class="bg-red-100 border-2 border-red-300 rounded-xl p-4 text-center">
        <p class="text-red-800 font-bold text-lg">⏰ Deadline Passed!</p>
        <p class="text-red-600 text-sm">Player 1 forfeits - Player 2 wins</p>
      </div>
    `;
  } else {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    const isUrgent = timeRemaining < 60;

    deadlineDiv.innerHTML = `
      <div class="bg-${isUrgent ? "red" : "yellow"}-100 border-2 border-${
      isUrgent ? "red" : "yellow"
    }-300 rounded-xl p-4 text-center">
        <p class="text-${
          isUrgent ? "red" : "yellow"
        }-800 font-bold text-lg">⏰ Time Remaining: ${timeStr}</p>
        <p class="text-${
          isUrgent ? "red" : "yellow"
        }-600 text-sm">Player 1 must reveal before deadline</p>
      </div>
    `;
  }
}

// Helper function to get move name
function getMoveName(move) {
  const moves = ["Rock 🪨", "Paper 📄", "Scissors ✂️"];
  return moves[move] || "Unknown";
}

// Show game result announcement
function showGameResult(announcement, winner, game) {
  // Create or update result display
  let resultDiv = document.getElementById("gameResult");
  if (!resultDiv) {
    resultDiv = document.createElement("div");
    resultDiv.id = "gameResult";
    resultDiv.className =
      "fixed inset-0 z-50 flex items-center justify-center p-4";
    resultDiv.style.cssText =
      "background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px);";
    document.body.appendChild(resultDiv);
  }

  const p1Move = getMoveName(game.player1Move);
  const p2Move = getMoveName(game.player2Move);

  const isWin = winner === gameState.playerNumber;
  const isTie = winner === 0;
  const bgGradient = isTie
    ? "from-yellow-400 to-orange-500"
    : isWin
    ? "from-green-400 to-emerald-500"
    : "from-red-400 to-pink-500";

  resultDiv.innerHTML = `
    <div class="game-result-modal bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl border-4 ${
      isTie
        ? "border-yellow-400"
        : isWin
        ? "border-green-400"
        : "border-red-400"
    }">
      <div class="text-center">
        <div class="text-6xl mb-4">${isTie ? "🤝" : isWin ? "🎉" : "😔"}</div>
        <h2 class="game-font text-4xl font-black mb-6 ${
          isTie ? "text-yellow-600" : isWin ? "text-green-600" : "text-red-600"
        }">
          ${announcement}
        </h2>
        <div class="bg-gradient-to-r ${bgGradient} rounded-xl p-4 mb-6 text-white">
          <div class="flex justify-between items-center mb-2">
            <span class="text-xl font-bold">Player 1</span>
            <span class="text-3xl">${p1Move}</span>
          </div>
          <div class="h-px bg-white opacity-30 my-2"></div>
          <div class="flex justify-between items-center">
            <span class="text-xl font-bold">Player 2</span>
            <span class="text-3xl">${p2Move}</span>
          </div>
        </div>
        <button 
          onclick="document.getElementById('gameResult')?.remove()" 
          class="px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-lg rounded-xl hover:from-purple-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          Close
        </button>
      </div>
    </div>
  `;

  // Close on background click
  resultDiv.addEventListener("click", (e) => {
    if (e.target === resultDiv) {
      resultDiv.remove();
    }
  });
}

// Event listeners
document.getElementById("connectBtn").addEventListener("click", connectWallet);
document
  .getElementById("setContractBtn")
  .addEventListener("click", setContractAddress);
document.getElementById("createGameBtn").addEventListener("click", createGame);
document.getElementById("joinGameBtn").addEventListener("click", joinGame);
document
  .getElementById("rockBtn")
  .addEventListener("click", () => selectMove(0));
document
  .getElementById("paperBtn")
  .addEventListener("click", () => selectMove(1));
document
  .getElementById("scissorsBtn")
  .addEventListener("click", () => selectMove(2));

// Update join button state when game ID is entered
document.getElementById("gameIdInput").addEventListener("input", () => {
  updateButtonStates();
});

// Initialize on load
async function init() {
  try {
    await loadContractArtifact();
    await initNoir();

    // Load contract address from addresses.json
    // Detect environment: use localhost only if we're on localhost, otherwise use sepolia
    try {
      const addressesResponse = await fetch("/addresses.json");
      if (addressesResponse.ok) {
        const addresses = await addressesResponse.json();
        const isLocalhost =
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1";

        // Check localhost first only if we're actually on localhost
        if (isLocalhost && addresses.localhost?.rockPaperScissors) {
          CONTRACT_ADDRESS = addresses.localhost.rockPaperScissors;
          document.getElementById("contractAddressInput").value =
            CONTRACT_ADDRESS;
          log(`✅ Loaded localhost contract address: ${CONTRACT_ADDRESS}`);
        } else if (addresses.sepolia?.rockPaperScissors) {
          CONTRACT_ADDRESS = addresses.sepolia.rockPaperScissors;
          document.getElementById("contractAddressInput").value =
            CONTRACT_ADDRESS;
          log(`✅ Loaded Sepolia contract address: ${CONTRACT_ADDRESS}`);
        } else {
          log(
            `⚠️ No contract address found in addresses.json for ${
              isLocalhost ? "localhost" : "sepolia"
            }`
          );
        }
      } else {
        log(
          `⚠️ Failed to load addresses.json: ${addressesResponse.status} ${addressesResponse.statusText}`
        );
      }
    } catch (error) {
      log(`⚠️ Could not load addresses.json: ${error.message}`);
      console.error("Addresses loading error:", error);
    }

    log("🚀 Application ready!");
    if (CONTRACT_ADDRESS) {
      log("💡 Connect your wallet and switch to the correct network");
    } else {
      log("💡 Enter contract address above or update addresses.json");
    }

    // Initialize button states
    updateButtonStates();
  } catch (error) {
    log(`Failed to initialize: ${error.message}`);
  }
}

init();
