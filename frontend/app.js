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

// Logging utility - track last log entry for collapsing repeated messages
let lastLogEntry = null;
let lastLogMessage = null;
let lastLogEmoji = null;
let logRepeatCount = 0;

function log(message) {
  const logsDiv = document.getElementById("logs");

  // Determine emoji based on message type
  let emoji = "📝";
  if (message.includes("✅")) emoji = "✅";
  else if (message.includes("❌")) emoji = "❌";
  else if (message.includes("⚠️")) emoji = "⚠️";
  else if (message.includes("💡")) emoji = "💡";
  else if (message.includes("🎉")) emoji = "🎉";
  else if (message.includes("⏳")) emoji = "⏳";
  else if (message.includes("🚀")) emoji = "🚀";

  // Check if this is a repeat of the last message
  if (lastLogEntry && lastLogMessage === message && lastLogEmoji === emoji) {
    // Increment repeat count
    logRepeatCount++;

    // Update the last entry with the count badge
    lastLogEntry.innerHTML = `
      <span class="text-gray-500 text-sm">[${new Date().toLocaleTimeString()}]</span>
      <span class="ml-2">${emoji} ${message}</span>
      <span class="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">${
        logRepeatCount + 1
      }</span>
    `;

    logsDiv.scrollTop = logsDiv.scrollHeight;
    return;
  }

  // New message - reset repeat count and create new entry
  logRepeatCount = 0;
  const entry = document.createElement("div");
  entry.className = "log-entry rounded-lg";

  entry.innerHTML = `
    <span class="text-gray-500 text-sm">[${new Date().toLocaleTimeString()}]</span>
    <span class="ml-2">${emoji} ${message}</span>
  `;
  logsDiv.appendChild(entry);
  logsDiv.scrollTop = logsDiv.scrollHeight;

  // Update tracking variables
  lastLogEntry = entry;
  lastLogMessage = message;
  lastLogEmoji = emoji;
}

// Update step checkmarks based on current state
function updateStepCheckmarks() {
  // Step 1: Connect Wallet - check if wallet is connected
  const step1Checkmark = document.getElementById("step1Checkmark");
  if (step1Checkmark) {
    if (signer) {
      step1Checkmark.classList.remove("hidden");
    } else {
      step1Checkmark.classList.add("hidden");
    }
  }

  // Step 2: Make Your Move - check if move is selected
  const step2Checkmark = document.getElementById("step2Checkmark");
  if (step2Checkmark) {
    if (gameState.move !== null && gameState.move !== undefined) {
      step2Checkmark.classList.remove("hidden");
    } else {
      step2Checkmark.classList.add("hidden");
    }
  }

  // Step 2b: Game Actions - check if game is created or joined
  const step2bCheckmark = document.getElementById("step2bCheckmark");
  if (step2bCheckmark) {
    if (gameState.gameId !== null) {
      step2bCheckmark.classList.remove("hidden");
    } else {
      step2bCheckmark.classList.add("hidden");
    }
  }

  // Step 3: Game Resolution - check if game is resolved/completed
  const step3Checkmark = document.getElementById("step3Checkmark");
  if (step3Checkmark) {
    if (gameState.isRevealed) {
      step3Checkmark.classList.remove("hidden");
    } else {
      step3Checkmark.classList.add("hidden");
    }
  }
}

// Update contract address display at bottom of page
function updateContractAddressDisplay() {
  const displayDiv = document.getElementById("contractAddressDisplay");
  if (!displayDiv) return;

  if (CONTRACT_ADDRESS) {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    const network = isLocalhost ? "localhost" : "Sepolia";

    displayDiv.innerHTML = `
      <p class="text-gray-600 text-xs flex flex-wrap items-center gap-2">
        <span class="font-semibold">Contract Address (${network}):</span>
        <span class="font-mono text-purple-600 break-all">${CONTRACT_ADDRESS}</span>
      </p>
    `;
  } else {
    displayDiv.innerHTML = `
      <p class="text-gray-500 text-xs">Contract address will be loaded automatically...</p>
    `;
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
          ✅ Connected: 
          <span class="font-mono break-all hidden sm:inline">${address}</span>
          <span class="font-mono sm:hidden">${address.slice(
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
      log("⚠️ Contract address will be loaded automatically");
    }

    // Update step checkmarks
    updateStepCheckmarks();
  } catch (error) {
    log(`❌ Error connecting wallet: ${error.message}`);
    if (error.message.includes("JSON")) {
      log("💡 Make sure Hardhat node is running: npx hardhat node");
    }
  }
}

// Convert timeout value and unit to seconds
function convertTimeoutToSeconds(value, unit) {
  const numValue = Number(value);
  if (isNaN(numValue) || numValue <= 0) {
    return 300; // Default to 5 minutes (300 seconds) if invalid
  }

  switch (unit) {
    case "minutes":
      return numValue * 60;
    case "hours":
      return numValue * 60 * 60;
    case "days":
      return numValue * 60 * 60 * 24;
    default:
      return 300; // Default to 5 minutes
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

    // Get timeout from UI inputs
    const timeoutValue = document.getElementById("timeoutValue").value;
    const timeoutUnit = document.getElementById("timeoutUnit").value;
    const timeoutSeconds = convertTimeoutToSeconds(timeoutValue, timeoutUnit);

    // Ensure timeout is a proper integer (Ethereum expects uint256, which is whole seconds)
    // JavaScript numbers are fine for values up to 2^53, but we should ensure it's an integer
    const timeoutUint = Math.floor(timeoutSeconds);

    if (timeoutUint <= 0 || timeoutUint > Number.MAX_SAFE_INTEGER) {
      log(`❌ Invalid timeout value: ${timeoutUint} seconds`);
      throw new Error(
        `Invalid timeout: must be between 1 and ${Number.MAX_SAFE_INTEGER} seconds`
      );
    }

    log(
      `📋 Timeout input: ${timeoutValue} ${timeoutUnit} (${timeoutSeconds} seconds)`
    );
    log(`📋 Sending timeout to contract: ${timeoutUint} seconds (as uint256)`);

    // Pass timeout as a number - ethers.js will handle the conversion to uint256
    const tx = await contract.createGame(commitment, timeoutUint);
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

      // Log timeout from event
      const timeoutFromEvent = parsed.args.timeout;
      const timeoutNum =
        typeof timeoutFromEvent === "bigint"
          ? Number(timeoutFromEvent)
          : Number(timeoutFromEvent.toString());
      log(`✅ Game created! Game ID: ${gameState.gameId}`);
      log(
        `📋 Timeout stored in contract: ${timeoutNum} seconds (${
          timeoutNum / 60
        } minutes)`
      );
      log("⏳ Waiting for Player 2 to join...");

      updateGameStatus();
      // Don't show "Committed" status in Step 2 after game creation - it's already in logs
      // updateMoveStatus();
      updateRevealStatus();
      updateButtonStates(); // Disable create button after game is created
      updateStepCheckmarks(); // Update step checkmarks

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

    // Get deadline from event - handle both old and new event formats
    let event = null;
    let parsed = null;

    for (const log of receipt.logs) {
      try {
        const tempParsed = contract.interface.parseLog(log);
        if (tempParsed && tempParsed.name === "PlayerJoined") {
          event = log;
          parsed = tempParsed;
          break;
        }
      } catch (e) {
        // Continue searching
      }
    }

    if (parsed && parsed.args) {
      // Safely access revealDeadline - it might be at different positions
      let deadlineBigInt = parsed.args.revealDeadline;
      if (deadlineBigInt === undefined || deadlineBigInt === null) {
        // Try accessing by index if named access fails
        deadlineBigInt = parsed.args[3]; // revealDeadline is 4th arg (index 3)
      }

      if (deadlineBigInt !== undefined && deadlineBigInt !== null) {
        const deadline =
          typeof deadlineBigInt === "bigint"
            ? Number(deadlineBigInt)
            : Number(deadlineBigInt.toString());

        // Get game data to log timeout
        // Game struct is an array: timeout is at index 9
        const game = await contract.getGame(gameId);
        const timeoutBigInt = game[9] || game.timeout;
        const timeoutNum =
          typeof timeoutBigInt === "bigint"
            ? Number(timeoutBigInt)
            : timeoutBigInt !== undefined && timeoutBigInt !== null
            ? Number(timeoutBigInt.toString())
            : 0;

        log(`✅ Joined game ${gameId}`);
        log(
          `📋 Timeout from contract: ${timeoutNum} seconds (${
            timeoutNum / 60
          } minutes)`
        );
        log(
          `📋 Reveal deadline calculated: ${deadline} (${new Date(
            deadline * 1000
          ).toLocaleString()})`
        );
        log(
          `⏰ Player 1 has until ${new Date(
            deadline * 1000
          ).toLocaleTimeString()} to reveal`
        );

        // Verify deadline calculation
        const now = Math.floor(Date.now() / 1000);
        const expectedDeadline = now + timeoutNum;
        log(
          `🔍 Verification: Current time: ${now}, Expected deadline: ${expectedDeadline}, Actual deadline: ${deadline}, Difference: ${
            deadline - expectedDeadline
          } seconds`
        );
      } else {
        log(
          `⚠️ Could not extract deadline from event, but join was successful`
        );
      }
    } else {
      log(
        `⚠️ PlayerJoined event not found in receipt, but join transaction succeeded`
      );
    }

    await updateGameStatus();
    updateMoveStatus();
    updateRevealStatus();
    updateButtonStates(); // Update button states after joining
    updateStepCheckmarks(); // Update step checkmarks

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

// Clear borders from all move buttons
function clearMoveButtonBorders() {
  const buttons = [
    document.getElementById("rockBtn"),
    document.getElementById("paperBtn"),
    document.getElementById("scissorsBtn"),
  ];

  buttons.forEach((btn) => {
    if (btn) {
      btn.classList.remove(
        "border-4",
        "border-green-400",
        "ring-4",
        "ring-green-200"
      );
    }
  });
}

// Select move (for both players)
// For Player 1: stores move locally, will be committed when creating game
// For Player 2: stores move locally, will be submitted when joining game
function selectMove(move) {
  gameState.move = move;

  // Update button borders to show selection
  const buttons = [
    document.getElementById("rockBtn"),
    document.getElementById("paperBtn"),
    document.getElementById("scissorsBtn"),
  ];

  buttons.forEach((btn, index) => {
    if (btn) {
      if (index === move) {
        // Add border to selected button
        btn.classList.add(
          "border-4",
          "border-green-400",
          "ring-4",
          "ring-green-200"
        );
      } else {
        // Remove border from other buttons
        btn.classList.remove(
          "border-4",
          "border-green-400",
          "ring-4",
          "ring-green-200"
        );
      }
    }
  });

  updateMoveStatus();
  updateButtonStates();
  updateStepCheckmarks();
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
        "w-full px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold text-sm rounded-lg hover:from-green-700 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl whitespace-nowrap";
      createBtn.innerHTML = "✨ Create Game";
    } else if (!hasMove) {
      // Disable if no move selected
      createBtn.disabled = true;
      createBtn.className =
        "w-full px-4 py-2 bg-gray-400 text-white font-semibold text-sm rounded-lg cursor-not-allowed transition-all duration-200 whitespace-nowrap";
      createBtn.innerHTML = "✨ Create Game";
    }
  }

  if (joinBtn) {
    const gameIdInput = document.getElementById("gameIdInput");
    const hasGameIdInput = gameIdInput && gameIdInput.value.trim() !== "";

    if (hasMove && hasGameIdInput) {
      // Enable join button if move selected and game ID entered
      joinBtn.disabled = false;
      joinBtn.className =
        "w-full px-4 py-2 bg-gradient-to-r from-orange-600 to-red-600 text-white font-semibold text-sm rounded-lg hover:from-orange-700 hover:to-red-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl whitespace-nowrap";
      joinBtn.innerHTML = "🚀 Join";
    } else {
      // Disable if no move or no game ID
      joinBtn.disabled = true;
      joinBtn.className =
        "w-full px-4 py-2 bg-gray-400 text-white font-semibold text-sm rounded-lg cursor-not-allowed transition-all duration-200 whitespace-nowrap";
      joinBtn.innerHTML = "🚀 Join";
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

// Track last rendered status to avoid unnecessary DOM updates
let lastRenderedStatus = null;
let lastRenderedGameId = null;
let lastRenderedPlayerNumber = null;
let lastRenderedResolutionStatus = null;
let lastRenderedResolutionGameId = null;

// Update game resolution status display (always visible)
async function updateGameResolutionStatus() {
  const statusDiv = document.getElementById("gameResolutionStatus");
  if (!statusDiv) return;

  // If no game is active, show default message
  if (!contract || !gameState.gameId) {
    // Only update if status changed (we had a game before, or this is first render)
    if (
      lastRenderedResolutionStatus !== null ||
      lastRenderedResolutionGameId !== null
    ) {
      statusDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">
            No active game. Create or join a game to see status here.
          </p>
        </div>
      `;
      lastRenderedResolutionStatus = null;
      lastRenderedResolutionGameId = null;
      lastRenderedPlayerNumber = null;
    }
    return;
  }

  try {
    const game = await contract.getGame(gameState.gameId);

    // Safely access struct fields - handle both array and object formats
    // Game struct order: [gameId, player1, player2, status, player1Commitment, player1Move, player2Move, winner, createdAt, timeout, revealDeadline]
    // Indices:           0       1        2        3      4                 5           6           7      8          9       10

    // Check if it's an array or object
    const isArray =
      Array.isArray(game) ||
      (typeof game === "object" && game.length !== undefined);

    // Safely get status - try array index first, then named property
    let statusValue;
    if (isArray && game.length > 3) {
      statusValue = game[3];
    } else {
      statusValue = game.status;
    }
    const statusNum = Number(statusValue);

    // Check if status actually changed - only update DOM if it did
    if (
      lastRenderedResolutionStatus === statusNum &&
      lastRenderedResolutionGameId === gameState.gameId &&
      lastRenderedPlayerNumber === gameState.playerNumber
    ) {
      // Status hasn't changed, skip DOM update to avoid unnecessary re-renders
      return;
    }

    // Status changed, update the display
    lastRenderedResolutionStatus = statusNum;
    lastRenderedResolutionGameId = gameState.gameId;
    lastRenderedPlayerNumber = gameState.playerNumber;

    const statusText = ["Waiting", "Committed", "Revealed", "Completed"][
      statusNum
    ];
    const statusClass = `status-${statusText.toLowerCase()}`;

    let statusDetails = "";
    let statusColor = "gray";

    switch (statusNum) {
      case 0: // Waiting
        statusDetails = "Waiting for players to join";
        statusColor = "yellow";
        break;
      case 1: // Committed
        statusDetails = "Player 1 committed move. Waiting for Player 2...";
        statusColor = "blue";
        break;
      case 2: // Revealed
        statusDetails = "Player 2 joined. Player 1 must reveal move.";
        statusColor = "orange";
        // Safely access revealDeadline - try array index first, then named property
        let deadlineBigInt;
        if (isArray && game.length > 10) {
          deadlineBigInt = game[10];
        } else {
          deadlineBigInt = game.revealDeadline;
        }
        if (
          deadlineBigInt &&
          (typeof deadlineBigInt === "bigint"
            ? deadlineBigInt > 0n
            : Number(deadlineBigInt.toString()) > 0)
        ) {
          const deadline =
            typeof deadlineBigInt === "bigint"
              ? Number(deadlineBigInt)
              : Number(deadlineBigInt.toString());

          // Validate it's a timestamp, not a timeout value
          if (deadline < 1000000000) {
            // This is likely a timeout value, not a deadline timestamp
            break;
          }

          // Time remaining is shown in the countdown below, no need to show it here
          // Just check if deadline passed for status color
          const now = Math.floor(Date.now() / 1000);
          const timeRemaining = deadline - now;
          if (timeRemaining <= 0) {
            statusDetails += ` <span class="font-semibold text-red-600">(⏰ Deadline passed!)</span>`;
          }
        }
        break;
      case 3: // Completed
        // Safely access winner - try array index first, then named property
        let winnerValue;
        if (isArray && game.length > 7) {
          winnerValue = game[7];
        } else {
          winnerValue = game.winner;
        }
        const winnerNum = Number(winnerValue);
        if (winnerNum === 0) {
          statusDetails = "Game completed: It's a tie! 🤝";
          statusColor = "gray";
        } else if (winnerNum === gameState.playerNumber) {
          statusDetails = "Game completed: You won! 🎉";
          statusColor = "green";
        } else {
          statusDetails = "Game completed: You lost. 😔";
          statusColor = "red";
        }
        break;
    }

    // Map status colors to Tailwind classes
    const borderColorClass =
      {
        yellow: "border-yellow-200",
        blue: "border-blue-200",
        orange: "border-orange-200",
        green: "border-green-200",
        red: "border-red-200",
        gray: "border-gray-200",
      }[statusColor] || "border-gray-200";

    statusDiv.innerHTML = `
      <div class="bg-white rounded-xl p-4 border-2 ${borderColorClass} slide-up">
        <div class="flex flex-wrap items-center gap-3 mb-2">
          <span class="status-badge ${statusClass}">${statusText}</span>
          <span class="text-gray-600 font-semibold">Game ID: <span class="font-mono text-purple-600">${gameState.gameId}</span></span>
        </div>
        <p class="text-gray-700 font-medium text-sm">
          ${statusDetails}
        </p>
        <p class="text-gray-600 text-xs mt-2">
          👤 You are <span class="font-semibold text-purple-600">Player ${gameState.playerNumber}</span>
        </p>
      </div>
    `;
  } catch (error) {
    statusDiv.innerHTML = `
      <div class="bg-red-50 border-2 border-red-200 rounded-xl p-4">
        <p class="text-sm text-red-600 text-center">
          Error loading game status: ${error.message}
        </p>
      </div>
    `;
  }
}

// Update game status display (now only updates resolution status)
async function updateGameStatus() {
  // Only update resolution status - the single source of truth
  await updateGameResolutionStatus();
}

// Update move status
function updateMoveStatus() {
  const moveStatusDiv = document.getElementById("moveStatus");
  if (!moveStatusDiv) return;

  if (gameState.move === null || gameState.move === undefined) {
    clearMoveButtonBorders();
    moveStatusDiv.innerHTML = `
      <div class="bg-gray-50 rounded-xl p-4 border-2 border-gray-200">
        <p class="text-gray-600 text-center">
          ⚠️ No move selected yet. Please select Rock, Paper, or Scissors above.
        </p>
      </div>
    `;
    return;
  }

  // Don't show "Committed" status - the border on the button shows selection
  // The commit status is already logged, no need to show it in the UI
  // Clear the status div - move selection is indicated by button border
  moveStatusDiv.innerHTML = "";
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

    // Safely access struct fields - handle both array and object formats
    const isArray =
      Array.isArray(game) ||
      (typeof game === "object" && game.length !== undefined);

    // Safely get status
    let statusValue;
    if (isArray && game.length > 3) {
      statusValue = game[3];
    } else {
      statusValue = game.status;
    }
    const statusNum = Number(statusValue);

    // Update game status display (includes deadline info)
    await updateGameStatus();
    updateRevealStatus();

    // If Player 2 just joined and Player 1 is watching, start deadline polling
    // Only start if deadline is actually set and valid
    // Game struct is an array: player2 is at index 2, revealDeadline is at index 10
    const player2 = game[2] || game.player2;
    if (
      statusNum === 2 &&
      player2 !== ethers.ZeroAddress &&
      gameState.playerNumber === 1
    ) {
      // Game struct is an array: revealDeadline is at index 10
      let deadlineBigInt = game[10] || game.revealDeadline;
      const deadlineNum =
        typeof deadlineBigInt === "bigint"
          ? Number(deadlineBigInt)
          : deadlineBigInt !== undefined && deadlineBigInt !== null
          ? Number(deadlineBigInt.toString())
          : 0;

      // Validate it's a timestamp, not a timeout value
      if (deadlineNum > 0 && deadlineNum < 1000000000) {
        log(
          `⚠️ WARNING: Deadline value ${deadlineNum} looks like a timeout, not a timestamp! Skipping deadline polling.`
        );
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      // Only start polling if deadline is in the future
      if (deadlineNum > 0 && deadlineNum > now && !deadlinePollInterval) {
        log(
          `🔍 Starting deadline polling: deadline=${deadlineNum}, now=${now}, remaining=${
            deadlineNum - now
          }s`
        );
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

      // Show result - only show modal when game is actually completed (both moves revealed)
      // Safely access winner field
      let winnerValue;
      if (isArray && game.length > 7) {
        winnerValue = game[7];
      } else {
        winnerValue = game.winner;
      }
      const winnerNum = Number(winnerValue);

      // Only show modal if game is truly completed (winner is set, not just status 3)
      // This prevents showing modal when game is just created
      if (winnerNum !== undefined && winnerNum !== null) {
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

        // Show big announcement (only if not already shown and game is truly completed)
        if (!document.getElementById("gameResult")) {
          showGameResult(announcement, winnerNum, game);
        }

        log(`🎉 Game completed! Winner: ${winnerText}`);
      }
      // Game struct is an array: player1Move is at index 5
      log(`Player 1 played: ${getMoveName(game[5] || game.player1Move)}`);
      // Game struct is an array: player2Move is at index 6
      log(`Player 2 played: ${getMoveName(game[6] || game.player2Move)}`);
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

    // Safely access struct fields - handle both array and object formats
    // Game struct order: [gameId, player1, player2, status, player1Commitment, player1Move, player2Move, winner, createdAt, timeout, revealDeadline]
    // Indices:           0       1        2        3      4                 5           6           7      8          9       10

    // Check if it's an array or object
    const isArray =
      Array.isArray(game) ||
      (typeof game === "object" && game.length !== undefined);

    // Safely access fields - check bounds before accessing array indices
    let player2, player2Move, timeoutBigInt, revealDeadlineBigInt;

    if (isArray && game.length > 10) {
      player2 = game[2];
      player2Move = game[6];
      timeoutBigInt = game[9];
      revealDeadlineBigInt = game[10];
    } else {
      // Fall back to named properties
      player2 = game.player2;
      player2Move = game.player2Move;
      timeoutBigInt = game.timeout;
      revealDeadlineBigInt = game.revealDeadline;
    }

    // Debug logging
    log(
      `🔍 Game struct: player2=${player2}, player2Move=${player2Move}, isArray=${isArray}, length=${
        game.length || "N/A"
      }`
    );
    log(`🔍 timeout=${timeoutBigInt}, revealDeadline=${revealDeadlineBigInt}`);

    // Check that Player 2 has joined
    if (player2 === ethers.ZeroAddress || player2Move === 255) {
      log("⏳ Waiting for Player 2 to join...");
      return;
    }

    // Convert BigNumber to number
    const timeoutNum =
      typeof timeoutBigInt === "bigint"
        ? Number(timeoutBigInt)
        : timeoutBigInt !== undefined && timeoutBigInt !== null
        ? Number(timeoutBigInt.toString())
        : 0;

    const deadline =
      typeof revealDeadlineBigInt === "bigint"
        ? Number(revealDeadlineBigInt)
        : revealDeadlineBigInt !== undefined && revealDeadlineBigInt !== null
        ? Number(revealDeadlineBigInt.toString())
        : 0;

    const now = Math.floor(Date.now() / 1000);

    log(
      `🔍 Deadline check: timeout=${timeoutNum}s, deadline=${deadline}, now=${now}`
    );

    if (deadline === 0 || deadline < 1000000000) {
      log(
        `❌ Invalid deadline value: ${deadline}. This looks like a timeout value, not a timestamp!`
      );
      log(
        `💡 The deadline should be a Unix timestamp (>= 1000000000), but we got: ${deadline}`
      );
      return;
    }

    if (now > deadline) {
      log(
        `❌ Deadline has passed. (deadline: ${deadline}, now: ${now}) Game will be forfeited.`
      );
      return;
    }

    const timeRemaining = deadline - now;
    if (timeRemaining < 60) {
      log(`⚠️ Warning: Only ${timeRemaining} seconds remaining to reveal!`);
    }

    // Get Player 2's move from contract (already stored)
    const move1 = Number(gameState.move);
    // Safely access player2Move
    let move2Value;
    if (isArray && game.length > 6) {
      move2Value = game[6];
    } else {
      move2Value = game.player2Move;
    }
    const move2 = Number(move2Value);

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
      updateStepCheckmarks(); // Update step checkmarks

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
        🔓 Resolve Game
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
    // Game struct is an array: status is at index 3
    const isCompleted = (game[3] || game.status) === 3; // GameStatus.Completed

    if (isCompleted) {
      // Game already resolved, stop polling
      if (deadlinePollInterval) {
        clearInterval(deadlinePollInterval);
        deadlinePollInterval = null;
      }
      return;
    }

    // Only check deadline if Player 2 has joined and deadline is set
    // Game struct is an array: player2 is at index 2
    const player2 = game[2] || game.player2;
    if (player2 === ethers.ZeroAddress) {
      return;
    }

    // Game struct is an array: timeout is at index 9, revealDeadline is at index 10
    const timeoutBigInt = game[9] || game.timeout;
    const revealDeadlineBigInt = game[10] || game.revealDeadline;

    const timeoutNum =
      typeof timeoutBigInt === "bigint"
        ? Number(timeoutBigInt)
        : timeoutBigInt !== undefined && timeoutBigInt !== null
        ? Number(timeoutBigInt.toString())
        : 0;

    const deadlineNum =
      typeof revealDeadlineBigInt === "bigint"
        ? Number(revealDeadlineBigInt)
        : revealDeadlineBigInt !== undefined && revealDeadlineBigInt !== null
        ? Number(revealDeadlineBigInt.toString())
        : 0;

    // Validate deadline is a proper timestamp, not a timeout value
    if (deadlineNum > 0 && deadlineNum < 1000000000) {
      log(
        `⚠️ WARNING: Deadline value ${deadlineNum} looks like a timeout (seconds), not a timestamp!`
      );
      log(
        `⚠️ This suggests the contract may have returned timeout instead of revealDeadline`
      );
      return; // Don't proceed with invalid deadline
    }

    // If deadline is 0 or invalid, don't check
    if (deadlineNum === 0 || isNaN(deadlineNum) || deadlineNum <= 0) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = deadlineNum - now;

    // Log deadline check details
    log(
      `🔍 Deadline check: timeout=${timeoutNum}s, deadline=${deadlineNum}, now=${now}, remaining=${timeRemaining}s`
    );

    // Update deadline display (will show forfeit button for Player 2 if deadline passed)
    // Only update if game is not already completed
    const gameStatus = game[3] || game.status;
    if (gameStatus !== 3) {
      updateDeadlineDisplay(timeRemaining, gameState.playerNumber);
    }

    // Don't auto-forfeit - let Player 2 manually trigger forfeit via button
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
    log(`Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    log(`Transaction confirmed in block ${receipt.blockNumber}`);
    log("✅ Game forfeited! Player 2 wins by default.");

    // Stop polling
    if (deadlinePollInterval) {
      clearInterval(deadlinePollInterval);
      deadlinePollInterval = null;
    }
    if (gameResultPollInterval) {
      clearInterval(gameResultPollInterval);
      gameResultPollInterval = null;
    }

    // Refresh game status to show completion
    await updateGameStatus();
    await checkGameResult();
  } catch (error) {
    log(`❌ Error forfeiting game: ${error.message}`);
    console.error("Forfeit error:", error);
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
function updateDeadlineDisplay(timeRemaining, playerNumber) {
  const deadlineDiv = document.getElementById("deadlineDisplay");
  if (!deadlineDiv) return;

  // Don't show deadline if time remaining is invalid (negative or very large)
  // Only show "Deadline Passed" if it's actually negative (not just 0 or invalid)
  if (timeRemaining < 0) {
    // Show forfeit button for Player 2 when deadline has passed
    if (playerNumber === 2) {
      deadlineDiv.innerHTML = `
        <div class="bg-red-100 border-2 border-red-300 rounded-xl p-4 text-center">
          <p class="text-red-800 font-bold text-lg mb-3">⏰ Deadline Passed!</p>
          <p class="text-red-600 text-sm mb-4">Player 1 failed to reveal in time. You can claim victory!</p>
          <button
            id="forceForfeitBtn"
            class="px-6 py-3 bg-gradient-to-r from-red-600 to-pink-600 text-white font-semibold rounded-xl hover:from-red-700 hover:to-pink-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            🏆 Force Forfeit (Claim Victory)
          </button>
        </div>
      `;

      // Add event listener to the button
      const forceForfeitBtn = document.getElementById("forceForfeitBtn");
      if (forceForfeitBtn) {
        // Remove any existing listeners by cloning the button
        const newBtn = forceForfeitBtn.cloneNode(true);
        forceForfeitBtn.parentNode.replaceChild(newBtn, forceForfeitBtn);
        newBtn.addEventListener("click", async () => {
          newBtn.disabled = true;
          newBtn.innerHTML = "⏳ Processing...";
          await forfeitGame();
          newBtn.disabled = false;
          newBtn.innerHTML = "🏆 Force Forfeit (Claim Victory)";
        });
      }
    } else {
      // For Player 1, just show that deadline passed
      deadlineDiv.innerHTML = `
        <div class="bg-red-100 border-2 border-red-300 rounded-xl p-4 text-center">
          <p class="text-red-800 font-bold text-lg">⏰ Deadline Passed!</p>
          <p class="text-red-600 text-sm">You failed to reveal in time. Player 2 can claim victory.</p>
        </div>
      `;
    }
    return;
  }

  // Don't show if time is invalid (too large) or exactly 0
  if (timeRemaining === 0 || timeRemaining > 86400 * 365) {
    deadlineDiv.innerHTML = "";
    return;
  }

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

  // Game struct is an array: player1Move is at index 5
  const p1Move = getMoveName(game[5] || game.player1Move);
  // Game struct is an array: player2Move is at index 6
  const p2Move = getMoveName(game[6] || game.player2Move);

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
      log(
        `🔍 Loading addresses.json from ${window.location.origin}/addresses.json`
      );
      const addressesResponse = await fetch("/addresses.json");
      log(
        `📡 Response status: ${addressesResponse.status} ${addressesResponse.statusText}`
      );

      if (addressesResponse.ok) {
        const addresses = await addressesResponse.json();
        log(`📋 Loaded addresses.json:`, addresses);
        const isLocalhost =
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1";
        log(
          `🌐 Environment: ${isLocalhost ? "localhost" : "production/sepolia"}`
        );

        // Check localhost first only if we're actually on localhost
        if (isLocalhost && addresses.localhost?.rockPaperScissors) {
          CONTRACT_ADDRESS = addresses.localhost.rockPaperScissors;
          log(`✅ Loaded localhost contract address: ${CONTRACT_ADDRESS}`);
          updateContractAddressDisplay();
        } else if (addresses.sepolia?.rockPaperScissors) {
          CONTRACT_ADDRESS = addresses.sepolia.rockPaperScissors;
          log(`✅ Loaded Sepolia contract address: ${CONTRACT_ADDRESS}`);
          updateContractAddressDisplay();
        } else {
          log(
            `⚠️ No contract address found in addresses.json for ${
              isLocalhost ? "localhost" : "sepolia"
            }`
          );
          log(`📋 Available addresses:`, {
            localhost: addresses.localhost?.rockPaperScissors || "empty",
            sepolia: addresses.sepolia?.rockPaperScissors || "empty",
          });
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
      log(
        "💡 Contract address will be loaded automatically from addresses.json"
      );
    }

    // Update contract address display (even if not loaded yet)
    updateContractAddressDisplay();

    // Initialize button states
    updateButtonStates();

    // Initialize step checkmarks
    updateStepCheckmarks();

    // Initialize game resolution status display
    await updateGameResolutionStatus();
  } catch (error) {
    log(`Failed to initialize: ${error.message}`);
  }
}

init();
