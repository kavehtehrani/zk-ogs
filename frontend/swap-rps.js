import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { ethers } from "ethers";

// Circuit will be loaded dynamically
let circuit = null;

// Game state
let gameState = {
  commitmentHash: null,
  gameId: null, // Game ID from RockPaperScissors contract
  role: null, // "maker" or "taker"
  move: null,
  salt: null,
  commitment: null,
  isCommitted: false,
  isRevealed: false,
  swapAmount: null,
  swapDirection: null, // "token0ToToken1" or "token1ToToken0"
  poolKey: null,
  timeout: 300, // Default timeout in seconds (5 minutes)
};

// Current view: "maker" or "taker"
let currentView = "maker";

// Interval for real-time timeout updates
let activeGamesUpdateInterval = null;
let activeGamesData = []; // Store game data for real-time updates
let selectedMovesByGame = {}; // Track which games have moves selected: { gameId: move }

let noir = null;
let backend = null;
let provider = null;
let signer = null;

// Contract instances
let routerContract = null;
let hookContract = null;
let rpsContract = null; // RockPaperScissors contract
let token0Contract = null;
let token1Contract = null;

// Contract addresses and ABIs - will be loaded from deployments.json
let ROUTER_ADDRESS = null;
let HOOK_ADDRESS = null;
let RPS_ADDRESS = null; // RockPaperScissors contract address
let TOKEN0_ADDRESS = null;
let TOKEN1_ADDRESS = null;
let POOL_MANAGER_ADDRESS = null;

// Network configuration
let DEPLOYED_CHAIN_ID = null;
let DEPLOYED_RPC_URL = null;

// Pool configuration (from deployments.json or hardcoded)
const POOL_FEE = 3000; // 0.3% (3000 = 0.3% in Uniswap V4)
const TICK_SPACING = 60;

// Load contract ABIs and addresses from deployments.json
async function loadDeployments() {
  try {
    log("Loading deployments.json...");
    const deploymentsResponse = await fetch("/deployments.json");
    if (!deploymentsResponse.ok) {
      throw new Error(`Failed to load deployments: ${deploymentsResponse.statusText}`);
    }
    const deployments = await deploymentsResponse.json();
    
    DEPLOYED_CHAIN_ID = deployments.chainId?.toString();
    DEPLOYED_RPC_URL = deployments.rpcUrl;
    
    if (deployments.contracts) {
      if (deployments.contracts.senderRelayRouter) {
        ROUTER_ADDRESS = deployments.contracts.senderRelayRouter.address;
        log(`✅ Router address: ${ROUTER_ADDRESS}`);
      }
      if (deployments.contracts.hook) {
        HOOK_ADDRESS = deployments.contracts.hook.address;
        log(`✅ Hook address: ${HOOK_ADDRESS}`);
      }
      if (deployments.contracts.token0) {
        TOKEN0_ADDRESS = deployments.contracts.token0.address;
        log(`✅ Token0 address: ${TOKEN0_ADDRESS}`);
      }
      if (deployments.contracts.token1) {
        TOKEN1_ADDRESS = deployments.contracts.token1.address;
        log(`✅ Token1 address: ${TOKEN1_ADDRESS}`);
      }
      if (deployments.contracts.poolManager) {
        POOL_MANAGER_ADDRESS = deployments.contracts.poolManager.address;
        log(`✅ PoolManager address: ${POOL_MANAGER_ADDRESS}`);
      }
      if (deployments.contracts.rockPaperScissors) {
        RPS_ADDRESS = deployments.contracts.rockPaperScissors.address;
        log(`✅ RockPaperScissors address: ${RPS_ADDRESS}`);
      }
    } else {
      log("⚠️ No contracts found in deployments.json");
    }
    
    log("✅ Deployments loaded");
  } catch (error) {
    log(`❌ Error loading deployments: ${error.message}`);
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
let lastLogEntry = null;
let lastLogMessage = null;
let lastLogEmoji = null;
let logRepeatCount = 0;

function log(message) {
  const logsDiv = document.getElementById("logs");
  if (!logsDiv) return;

  let emoji = "📝";
  if (message.includes("✅")) emoji = "✅";
  else if (message.includes("❌")) emoji = "❌";
  else if (message.includes("⚠️")) emoji = "⚠️";
  else if (message.includes("💡")) emoji = "💡";
  else if (message.includes("🎉")) emoji = "🎉";
  else if (message.includes("⏳")) emoji = "⏳";
  else if (message.includes("🚀")) emoji = "🚀";

  if (lastLogEntry && lastLogMessage === message && lastLogEmoji === emoji) {
    logRepeatCount++;
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

  logRepeatCount = 0;
  const entry = document.createElement("div");
  entry.className = "log-entry rounded-lg";
  entry.innerHTML = `
    <span class="text-gray-500 text-sm">[${new Date().toLocaleTimeString()}]</span>
    <span class="ml-2">${emoji} ${message}</span>
  `;
  logsDiv.appendChild(entry);
  logsDiv.scrollTop = logsDiv.scrollHeight;

  lastLogEntry = entry;
  lastLogMessage = message;
  lastLogEmoji = emoji;
}

// Get network name from chain ID
function getNetworkName(chainId) {
  if (!chainId) return "Unknown";
  const chainIdNum = typeof chainId === "string" 
    ? (chainId.startsWith("0x") ? parseInt(chainId, 16) : parseInt(chainId))
    : Number(chainId);
  
  const networkMap = {
    1: "Mainnet",
    11155111: "Sepolia",
    31337: "Localhost",
    1337: "Localhost",
    5: "Goerli",
  };
  
  return networkMap[chainIdNum] || `Chain ${chainIdNum}`;
}

// Normalize chain ID
function normalizeChainId(chainId) {
  if (!chainId) return null;
  if (typeof chainId === "string") {
    if (chainId.startsWith("0x")) {
      return parseInt(chainId, 16).toString();
    }
    return chainId;
  }
  return chainId.toString();
}

// Ensure we're on the correct network
async function ensureCorrectNetwork() {
  if (!window.ethereum) {
    log("❌ MetaMask not available");
    return false;
  }

  if (!DEPLOYED_CHAIN_ID) {
    log("⚠️ No chain ID configured");
    return true;
  }

  try {
    const currentChainIdHex = await window.ethereum.request({ method: "eth_chainId" });
    const currentChainId = normalizeChainId(currentChainIdHex);
    const targetChainId = normalizeChainId(DEPLOYED_CHAIN_ID);

    if (currentChainId === targetChainId) {
      return true;
    }

    const networkName = getNetworkName(targetChainId);
    log(`🔄 Switching to ${networkName} (Chain ID: ${targetChainId})...`);

    const targetChainIdHex = `0x${BigInt(targetChainId).toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainIdHex }],
      });
      log(`✅ Switched to ${networkName}`);
      await new Promise(resolve => setTimeout(resolve, 500));
      provider = new ethers.BrowserProvider(window.ethereum);
      if (signer) {
        signer = await provider.getSigner();
        await initializeContracts();
      }
      return true;
    } catch (switchError) {
      log(`❌ Could not switch network: ${switchError.message}`);
      return false;
    }
  } catch (error) {
    log(`❌ Error checking network: ${error.message}`);
    return false;
  }
}

// Initialize contract instances
async function initializeContracts() {
  if (!signer) return;

  try {
    // Router ABI (minimal - just the functions we need)
    const routerABI = [
      "function swapExactTokensForTokensWithCommitment(uint256 amountIn, uint256 amountOutMin, bool zeroForOne, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bytes32 commitmentHash, bytes hookData, address receiver, uint256 deadline) external payable returns (int256 delta)"
    ];
    
    if (ROUTER_ADDRESS) {
      routerContract = new ethers.Contract(ROUTER_ADDRESS, routerABI, signer);
    }

    // Hook ABI (minimal)
    const hookABI = [
      "function getGamesWaitingForPlayer2() external view returns (bytes32[])",
      "function getGamesWaitingForReveal() external view returns (bytes32[])",
      "function getPendingSwap(bytes32 commitmentHash) external view returns (tuple(address player1, uint256 timestamp, bytes32 poolId, address currency, uint256 player1Contribution, bool player2Moved, address player2, uint8 player2Move, uint256 player2Contribution, uint256 player2MoveTimestamp, bool revealed, uint8 player1Move, bytes32 salt, bool resolved))",
      "function player2PostMove(bytes32 commitmentHash, uint8 player2Move, uint256 player2ContributionAmount) external",
      "function getRafflePoolBalance(bytes32 poolId, address currency) external view returns (uint256)",
      "function linkGameId(bytes32 commitmentHash, uint256 gameId) external",
      "function getGameId(bytes32 commitmentHash) external view returns (uint256)",
      "function getContributionByAddress(address account, bytes32 poolId, address currency) external view returns (uint256)",
      "function contributionsByAddress(address, bytes32, address) external view returns (uint256)",
      "function REFUND_TIMEOUT() external view returns (uint256)",
      "event GameCreated(bytes32 indexed commitmentHash, address indexed player1, bytes32 indexed poolId, address currency, uint256 contributionAmount, uint256 timestamp)"
    ];

    if (HOOK_ADDRESS) {
      hookContract = new ethers.Contract(HOOK_ADDRESS, hookABI, signer);
    }

    // RockPaperScissors ABI
    const rpsABI = [
      "function createGame(bytes32 commitment, uint256 timeout) external returns (uint256)",
      "function joinGame(uint256 gameId, uint8 move2) external",
      "function resolveGame(uint256 gameId, uint8 move1, bytes32 salt1, bytes calldata proof) external",
      "function getGame(uint256 gameId) external view returns (tuple(uint256 gameId, address player1, address player2, uint8 status, bytes32 player1Commitment, uint8 player1Move, uint8 player2Move, uint8 winner, uint256 createdAt, uint256 timeout, uint256 revealDeadline))",
      "function forfeitGame(uint256 gameId) external",
      "event GameCreated(uint256 indexed gameId, address indexed player1, bytes32 commitment, uint256 timeout)",
      "event PlayerJoined(uint256 indexed gameId, address indexed player2, uint8 move2, uint256 revealDeadline)",
      "event GameResolved(uint256 indexed gameId, uint8 winner)"
    ];

    if (RPS_ADDRESS) {
      rpsContract = new ethers.Contract(RPS_ADDRESS, rpsABI, signer);
    }

    // ERC20 ABI (minimal)
    const erc20ABI = [
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function allowance(address owner, address spender) external view returns (uint256)",
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
      "function symbol() external view returns (string)"
    ];

    if (TOKEN0_ADDRESS) {
      token0Contract = new ethers.Contract(TOKEN0_ADDRESS, erc20ABI, signer);
    }
    if (TOKEN1_ADDRESS) {
      token1Contract = new ethers.Contract(TOKEN1_ADDRESS, erc20ABI, signer);
    }

    log("✅ Contracts initialized");
  } catch (error) {
    log(`❌ Error initializing contracts: ${error.message}`);
  }
}

// Connect wallet
async function connectWallet() {
  if (typeof window.ethereum === "undefined") {
    log("❌ MetaMask not found. Please install MetaMask.");
    return;
  }

  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await ensureCorrectNetwork();
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    const address = await signer.getAddress();

    document.getElementById("walletInfo").innerHTML = `
      <div class="px-4 py-2 bg-gradient-to-r from-green-100 to-emerald-100 rounded-xl border-2 border-green-300">
        <p class="text-green-800 font-semibold">
          ✅ Connected: 
          <span class="font-mono break-all hidden sm:inline">${address}</span>
          <span class="font-mono sm:hidden">${address.slice(0, 6)}...${address.slice(-4)}</span>
        </p>
      </div>
    `;

    log(`✅ Connected to wallet: ${address}`);
    await initializeContracts();
    await updateMakerTokenBalance();
    // Auto-load games based on current view
    if (currentView === "maker") {
      await loadMakerGames();
    } else if (hookContract) {
      await loadAllTakerGames();
    }
  } catch (error) {
    log(`❌ Error connecting wallet: ${error.message}`);
  }
}

// Helper function to safely call ERC20 functions
async function safeTokenCall(contract, functionName, defaultValue = null) {
  if (!contract) return defaultValue;
  try {
    // Check if contract has code at the address
    const code = await provider.getCode(contract.target || contract.address);
    if (!code || code === "0x" || code === "0x0") {
      return defaultValue;
    }
    return await contract[functionName]();
  } catch (error) {
    // Silently fail and return default value
    return defaultValue;
  }
}

// Helper function to safely call ERC20 functions with parameters
async function safeTokenCallWithParam(contract, functionName, param, defaultValue = null) {
  if (!contract) return defaultValue;
  try {
    // Check if contract has code at the address
    const code = await provider.getCode(contract.target || contract.address);
    if (!code || code === "0x" || code === "0x0") {
      return defaultValue;
    }
    // If param is an array, spread it; otherwise pass it directly
    if (Array.isArray(param)) {
      return await contract[functionName](...param);
    } else {
      return await contract[functionName](param);
    }
  } catch (error) {
    // Silently fail and return default value
    return defaultValue;
  }
}

// Update token balance display for Maker view
async function updateMakerTokenBalance() {
  if (!signer || !token0Contract || !token1Contract || !provider) return;

  try {
    const address = await signer.getAddress();
    const direction = document.getElementById("makerSwapDirection")?.value || "token0ToToken1";
    
    let tokenContract, tokenAddress, tokenSymbol;
    if (direction === "token0ToToken1") {
      tokenContract = token0Contract;
      tokenAddress = TOKEN0_ADDRESS;
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token0");
    } else {
      tokenContract = token1Contract;
      tokenAddress = TOKEN1_ADDRESS;
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token1");
    }

    const balance = await safeTokenCallWithParam(tokenContract, "balanceOf", address, 0n);
    const decimals = await safeTokenCall(tokenContract, "decimals", 18);
    const balanceFormatted = ethers.formatUnits(balance, decimals);

    const balanceDiv = document.getElementById("makerTokenBalance");
    if (balanceDiv) {
      balanceDiv.innerHTML = `
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <span class="text-sm font-semibold">${tokenSymbol} Balance: </span>
          <span class="text-sm font-mono">${balanceFormatted}</span>
        </div>
      `;
    }
  } catch (error) {
    // Silently fail - don't log errors for missing token contracts
    const balanceDiv = document.getElementById("makerTokenBalance");
    if (balanceDiv) {
      balanceDiv.innerHTML = "";
    }
  }
}

// Check and update approval status for Maker view
async function checkMakerApproval() {
  console.log("checkMakerApproval() called");
  if (!signer || !routerContract || !token0Contract || !token1Contract) {
    console.warn("checkMakerApproval() early return: contracts not initialized");
    return;
  }

  try {
    const address = await signer.getAddress();
    const direction = document.getElementById("makerSwapDirection")?.value || "token0ToToken1";
    const amountInput = document.getElementById("makerSwapAmount")?.value;
    console.log("checkMakerApproval() - direction:", direction, "amountInput:", amountInput);
    
    if (!amountInput || parseFloat(amountInput) <= 0) {
      console.log("checkMakerApproval() - no amount input, clearing approval status");
      const approvalDiv = document.getElementById("makerApprovalStatus");
      if (approvalDiv) {
        approvalDiv.innerHTML = "";
      }
      return;
    }

    let tokenContract;
    if (direction === "token0ToToken1") {
      tokenContract = token0Contract;
    } else {
      tokenContract = token1Contract;
    }

    const decimals = await safeTokenCall(tokenContract, "decimals", 18);
    const amount = ethers.parseUnits(amountInput, decimals);
    const allowance = await safeTokenCallWithParam(tokenContract, "allowance", [address, ROUTER_ADDRESS], 0n);

    const approvalDiv = document.getElementById("makerApprovalStatus");
    if (approvalDiv) {
      if (allowance >= amount) {
        approvalDiv.innerHTML = `
          <div class="bg-green-50 border border-green-200 rounded-lg p-2">
            <span class="text-sm text-green-800">✅ Token approved</span>
          </div>
        `;
      } else {
        approvalDiv.innerHTML = `
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-2">
            <span class="text-sm text-yellow-800">⚠️ Token approval needed</span>
          </div>
        `;
      }
    }

    const createBtn = document.getElementById("makerCreateGameBtn");
    if (createBtn) {
      createBtn.disabled = !(allowance >= amount && gameState.move !== null && amountInput);
    }
  } catch (error) {
    log(`⚠️ Error checking approval: ${error.message}`);
  }
}

// Approve token (for Maker view)
async function approveToken(view = "maker") {
  console.log(`approveToken called for ${view}`);
  log("🔓 Approve Token button clicked!");
  
  if (!signer) {
    log("❌ Please connect your wallet first");
    console.error("No signer");
    return;
  }
  
  // Ensure deployments are loaded
  if (!ROUTER_ADDRESS) {
    log("⚠️ Router address not found, loading deployments...");
    try {
      await loadDeployments();
    } catch (error) {
      log(`❌ Error loading deployments: ${error.message}`);
      console.error("Deployments loading error:", error);
    }
  }
  
  if (!ROUTER_ADDRESS) {
    log("❌ Router address not found. Please check deployments.json");
    console.error("No ROUTER_ADDRESS:", ROUTER_ADDRESS);
    return;
  }
  
  log(`✅ Router address found: ${ROUTER_ADDRESS}`);

  const networkOk = await ensureCorrectNetwork();
  if (!networkOk) {
    log("❌ Please switch to the correct network");
    return;
  }

  const direction = document.getElementById("makerSwapDirection")?.value || "token0ToToken1";
  const amountInput = document.getElementById("makerSwapAmount")?.value;

  log(`📋 Approval details:`);
  log(`   Direction: ${direction}`);
  log(`   Amount: ${amountInput || "Not specified"}`);

  // Note: We don't require amount for approval - we approve max amount
  // But we still need to know which token to approve based on direction

  const btn = document.getElementById("makerApproveTokenBtn");
  if (!btn) {
    log("❌ Approve button not found");
    console.error("Approve button element not found");
    return;
  }

  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Approving...";

  try {
    // Initialize contracts if needed
    if (!token0Contract || !token1Contract) {
      log("⚠️ Contracts not initialized, initializing now...");
      await initializeContracts();
    }

    if (!token0Contract || !token1Contract) {
      throw new Error("Failed to initialize token contracts");
    }
    
    log("✅ Token contracts initialized");

    let tokenContract, tokenSymbol, tokenAddress;
    if (direction === "token0ToToken1") {
      tokenContract = token0Contract;
      tokenAddress = TOKEN0_ADDRESS;
      if (!tokenContract) {
        throw new Error("Token0 contract not available");
      }
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token0");
      log(`✅ Selected Token0 (${tokenSymbol}) at ${tokenAddress}`);
    } else {
      tokenContract = token1Contract;
      tokenAddress = TOKEN1_ADDRESS;
      if (!tokenContract) {
        throw new Error("Token1 contract not available");
      }
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token1");
      log(`✅ Selected Token1 (${tokenSymbol}) at ${tokenAddress}`);
    }

    if (!tokenAddress) {
      throw new Error(`Token address not found for direction: ${direction}`);
    }

    const decimals = await safeTokenCall(tokenContract, "decimals", 18);
    // Approve a large amount to avoid repeated approvals
    const maxApproval = ethers.MaxUint256;

    log(`🔓 Approving ${tokenSymbol} for router...`);
    log(`   Token: ${tokenSymbol} (${tokenAddress})`);
    log(`   Router: ${ROUTER_ADDRESS}`);
    log(`   Amount: Maximum (${maxApproval.toString()})`);
    console.log(`Approving ${tokenSymbol} for router at ${ROUTER_ADDRESS}`);
    
    const tx = await tokenContract.approve(ROUTER_ADDRESS, maxApproval);
    log(`📤 Transaction sent: ${tx.hash}`);
    console.log(`Transaction hash: ${tx.hash}`);
    
    log("⏳ Waiting for confirmation...");
    const receipt = await tx.wait();
    log(`✅ ${tokenSymbol} approved! Confirmed in block ${receipt.blockNumber}`);
    console.log(`Approval confirmed in block ${receipt.blockNumber}`);

    // Update approval status display
    await checkMakerApproval();
  } catch (error) {
    log(`❌ Error approving token: ${error.message}`);
    console.error("Full approval error:", error);
    if (error.reason) {
      log(`Error reason: ${error.reason}`);
    }
    if (error.data) {
      log(`Error data: ${JSON.stringify(error.data)}`);
    }
    if (error.code) {
      log(`Error code: ${error.code}`);
    }
  } finally {
    const btn = document.getElementById("makerApproveTokenBtn");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// Approve token for Taker (when joining a game)
async function approveTokenForTaker(tokenContract, tokenSymbol, commitmentHash, oppositeDirection, makerContributionAmount) {
  console.log(`approveTokenForTaker called for ${tokenSymbol}`);
  log(`🔓 Approving ${tokenSymbol} for router...`);
  
  if (!signer) {
    log("❌ Please connect your wallet first");
    console.error("No signer");
    return;
  }
  
  if (!ROUTER_ADDRESS) {
    log("❌ Router address not found. Please check deployments.json");
    console.error("No ROUTER_ADDRESS:", ROUTER_ADDRESS);
    return;
  }

  const networkOk = await ensureCorrectNetwork();
  if (!networkOk) {
    log("❌ Please switch to the correct network");
    return;
  }

  const gameIdForBtn = `game-${commitmentHash.slice(2, 10)}`;
  const approveBtn = document.getElementById(`${gameIdForBtn}-join-btn`);
  const originalText = approveBtn ? approveBtn.innerHTML : "";

  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.innerHTML = "⏳ Approving...";
  }

  try {
    const decimals = await safeTokenCall(tokenContract, "decimals", 18);
    const maxApproval = ethers.MaxUint256;

    log(`🔓 Approving ${tokenSymbol} for router...`);
    log(`   Token: ${tokenSymbol}`);
    log(`   Router: ${ROUTER_ADDRESS}`);
    log(`   Amount: Maximum (${maxApproval.toString()})`);
    console.log(`Approving ${tokenSymbol} for router at ${ROUTER_ADDRESS}`);
    
    const tx = await tokenContract.approve(ROUTER_ADDRESS, maxApproval);
    log(`📤 Transaction sent: ${tx.hash}`);
    console.log(`Transaction hash: ${tx.hash}`);
    
    log("⏳ Waiting for confirmation...");
    const receipt = await tx.wait();
    log(`✅ ${tokenSymbol} approved! Confirmed in block ${receipt.blockNumber}`);
    console.log(`Approval confirmed in block ${receipt.blockNumber}`);

    // Clear approval message
    const gameIdForMsg = `game-${commitmentHash.slice(2, 10)}`;
    const approvalMsgDiv = document.getElementById(`${gameIdForMsg}-approval-msg`);
    if (approvalMsgDiv) {
      approvalMsgDiv.remove();
    }

    // Change button back to "Join This Game" and restore event listener
    if (approveBtn) {
      // Clone to remove old event listeners
      const restoredBtn = approveBtn.cloneNode(true);
      approveBtn.parentNode.replaceChild(restoredBtn, approveBtn);
      
      // Restore button appearance
      restoredBtn.disabled = false;
      restoredBtn.innerHTML = "🎮 Join This Game";
      restoredBtn.classList.remove("bg-gradient-to-r", "from-yellow-600", "to-orange-600");
      restoredBtn.classList.add("bg-gradient-to-r", "from-purple-600", "to-indigo-600", "text-white");
      restoredBtn.classList.remove("opacity-75", "cursor-not-allowed");
      
      // Restore event listener for joining
      restoredBtn.addEventListener('click', function() {
        if (!this.disabled) {
          const commitment = this.getAttribute('data-commitment');
          const direction = this.getAttribute('data-direction');
          const amount = this.getAttribute('data-amount');
          joinGame(commitment, direction, amount);
        }
      });
    }

    // Automatically retry joining the game after approval
    log("🔄 Retrying to join game after approval...");
    await joinGame(commitmentHash, oppositeDirection, makerContributionAmount);
  } catch (error) {
    log(`❌ Error approving token: ${error.message}`);
    console.error("Full approval error:", error);
    if (error.reason) {
      log(`Error reason: ${error.reason}`);
    }
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.innerHTML = originalText;
    }
  }
}

// Select move for Maker
function selectMakerMove(move) {
  gameState.move = move;

  // Update button borders to show selection
  const buttons = [
    document.getElementById("makerRockBtn"),
    document.getElementById("makerPaperBtn"),
    document.getElementById("makerScissorsBtn"),
  ];

  buttons.forEach((btn, index) => {
    if (btn) {
      // First, remove all border/ring classes to ensure clean state
      btn.classList.remove(
        "border-4",
        "border-green-400",
        "ring-4",
        "ring-green-200",
        "border-2",
        "border-blue-400"
      );
      
      if (index === move) {
        // Add border to selected button
        btn.classList.add(
          "border-4",
          "border-green-400",
          "ring-4",
          "ring-green-200"
        );
      }
    }
  });

  updateMakerMoveStatus();
  updateMakerButtonStates();
  log(`✅ Move selected: ${move === 0 ? "Rock" : move === 1 ? "Paper" : "Scissors"}`);
}

// Update maker move status display
function updateMakerMoveStatus() {
  const moveStatusDiv = document.getElementById("makerMoveStatus");
  if (!moveStatusDiv) return;

  if (gameState.move === null || gameState.move === undefined) {
    moveStatusDiv.innerHTML = `
      <p class="text-xs text-gray-500">Select your move above</p>
    `;
    return;
  }

  moveStatusDiv.innerHTML = "";
}

// Update maker button states
function updateMakerButtonStates() {
  const createBtn = document.getElementById("makerCreateGameBtn");
  if (createBtn) {
    const hasMove = gameState.move !== null && gameState.move !== undefined;
    const amountInput = document.getElementById("makerSwapAmount")?.value;
    const hasAmount = amountInput && parseFloat(amountInput) > 0;
    const shouldEnable = hasMove && hasAmount;
    
    createBtn.disabled = !shouldEnable;
    
    // Update button styling based on state
    if (shouldEnable) {
      createBtn.classList.remove("disabled:bg-gray-400", "disabled:cursor-not-allowed");
      createBtn.classList.add("hover:from-green-700", "hover:to-emerald-700", "transform", "hover:scale-105");
    } else {
      createBtn.classList.add("disabled:bg-gray-400", "disabled:cursor-not-allowed");
    }
    
    console.log(`Button state updated: move=${hasMove}, amount=${hasAmount}, enabled=${shouldEnable}`);
  }
}

// Update move status display
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

  moveStatusDiv.innerHTML = "";
}

// Update button states
function updateButtonStates() {
  const createBtn = document.getElementById("createSwapGameBtn");
  if (createBtn) {
    const hasMove = gameState.move !== null;
    const hasAmount = document.getElementById("swapAmount")?.value;
    createBtn.disabled = !hasMove || !hasAmount;
  }
}

// Create game with swap (Maker)
async function createMakerGame() {
  console.log("createMakerGame called");
  log("🎮 Create Game & Swap button clicked!");
  
  if (!signer) {
    log("❌ Please connect your wallet first");
    console.error("No signer available");
    return;
  }
  
  log("✅ Wallet connected");

  if (!routerContract || !hookContract) {
    log("❌ Contracts not initialized. Initializing now...");
    console.log("Initializing contracts...");
    try {
      await initializeContracts();
      if (!routerContract || !hookContract) {
        throw new Error("Contracts still not initialized after initialization attempt");
      }
    } catch (error) {
      log(`❌ Failed to initialize contracts: ${error.message}`);
      console.error("Contract initialization error:", error);
      return;
    }
  }

  if (gameState.move === null || gameState.move === undefined) {
    log("❌ Please select your move first");
    console.error("No move selected. gameState.move:", gameState.move);
    return;
  }

  const networkOk = await ensureCorrectNetwork();
  if (!networkOk) {
    log("❌ Please switch to the correct network");
    return;
  }

  const direction = document.getElementById("makerSwapDirection")?.value || "token0ToToken1";
  const amountInput = document.getElementById("makerSwapAmount")?.value;

  log(`📋 Game creation details:`);
  log(`   Move: ${gameState.move === null ? "Not selected" : gameState.move === 0 ? "Rock" : gameState.move === 1 ? "Paper" : "Scissors"}`);
  log(`   Direction: ${direction}`);
  log(`   Amount: ${amountInput || "Not entered"}`);

  if (!amountInput || parseFloat(amountInput) <= 0) {
    log("❌ Please enter a swap amount");
    return;
  }

  if (gameState.move === null || gameState.move === undefined) {
    log("❌ Please select your move first");
    return;
  }

  const btn = document.getElementById("makerCreateGameBtn");
  if (!btn) {
    log("❌ Create game button not found");
    console.error("Button element not found");
    return;
  }
  
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Creating...";
  
  log("🚀 Starting game creation process...");

  try {
    // Generate salt and commitment
    const salt = ethers.randomBytes(32);
    const saltField = ethers.hexlify(salt);
    const commitment = ethers.keccak256(
      ethers.solidityPacked(["uint8", "bytes32"], [gameState.move, saltField])
    );

    // Validate commitment
    if (!commitment || commitment === "0x" || commitment.length !== 66) {
      throw new Error(`Invalid commitment generated: ${commitment}`);
    }

    gameState.salt = saltField;
    gameState.commitment = commitment;
    gameState.commitmentHash = commitment;
    
    console.log("Generated commitment:", {
      move: gameState.move,
      salt: saltField,
      commitment: commitment,
      commitmentLength: commitment.length
    });
    gameState.isCommitted = true;
    gameState.swapAmount = amountInput;
    gameState.swapDirection = direction;
    gameState.role = "maker";

    // Validate addresses
    if (!TOKEN0_ADDRESS || !TOKEN1_ADDRESS || !HOOK_ADDRESS || !ROUTER_ADDRESS) {
      throw new Error(`Missing contract addresses. TOKEN0: ${TOKEN0_ADDRESS}, TOKEN1: ${TOKEN1_ADDRESS}, HOOK: ${HOOK_ADDRESS}, ROUTER: ${ROUTER_ADDRESS}`);
    }

    // Prepare pool key
    const zeroForOne = direction === "token0ToToken1";
    const poolKey = {
      currency0: TOKEN0_ADDRESS,
      currency1: TOKEN1_ADDRESS,
      fee: POOL_FEE,
      tickSpacing: TICK_SPACING,
      hooks: HOOK_ADDRESS
    };

    gameState.poolKey = poolKey;

    // Get token contract and decimals
    let tokenContract, decimals;
    if (zeroForOne) {
      if (!token0Contract) {
        log("⚠️ Token0 contract not initialized, initializing now...");
        await initializeContracts();
        if (!token0Contract) {
          throw new Error("Token0 contract not available. Please check deployments.json");
        }
      }
      tokenContract = token0Contract;
      decimals = await safeTokenCall(token0Contract, "decimals", 18);
    } else {
      if (!token1Contract) {
        log("⚠️ Token1 contract not initialized, initializing now...");
        await initializeContracts();
        if (!token1Contract) {
          throw new Error("Token1 contract not available. Please check deployments.json");
        }
      }
      tokenContract = token1Contract;
      decimals = await safeTokenCall(token1Contract, "decimals", 18);
    }
    
    log(`✅ Using ${zeroForOne ? "Token0" : "Token1"} with ${decimals} decimals`);

    const amountIn = ethers.parseUnits(amountInput, decimals);
    const amountOutMin = 0; // Accept any output amount
    const receiver = await signer.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    log(`📋 Creating game with swap:`);
    log(`   Amount: ${amountInput} tokens`);
    log(`   Direction: ${direction}`);
    log(`   Commitment: ${commitment.slice(0, 10)}...`);
    log(`   Move: ${gameState.move === 0 ? "Rock" : gameState.move === 1 ? "Paper" : "Scissors"}`);

    // Check balance
    log("💰 Checking balance...");
    const balance = await safeTokenCallWithParam(tokenContract, "balanceOf", receiver, 0n);
    if (balance < amountIn) {
      const balanceFormatted = ethers.formatUnits(balance, decimals);
      const amountFormatted = ethers.formatUnits(amountIn, decimals);
      throw new Error(`Insufficient balance. You need ${amountFormatted}, but you have ${balanceFormatted}`);
    }
    log(`✅ Balance check passed: ${ethers.formatUnits(balance, decimals)} tokens`);

    // Check allowance
    log("🔓 Checking token approval...");
    const allowance = await safeTokenCallWithParam(tokenContract, "allowance", [receiver, ROUTER_ADDRESS], 0n);
    if (allowance < amountIn) {
      const allowanceFormatted = ethers.formatUnits(allowance, decimals);
      const amountFormatted = ethers.formatUnits(amountIn, decimals);
      throw new Error(`Insufficient allowance. You need ${amountFormatted}, but you have ${allowanceFormatted}. Please approve the token first.`);
    }
    log(`✅ Approval check passed: ${ethers.formatUnits(allowance, decimals)} tokens approved`);

    // First, create game in RockPaperScissors contract
    if (rpsContract) {
      log("Creating game in RockPaperScissors contract...");
      // Get timeout from input field (in minutes), default to 5 minutes
      const timeoutMinutes = document.getElementById("makerTimeout")?.value || 5;
      const timeoutSeconds = Number(timeoutMinutes) * 60; // Convert to seconds
      gameState.timeout = timeoutSeconds;
      log(`Using timeout: ${timeoutSeconds} seconds (${timeoutMinutes} minutes)`);
      console.log("Calling createGame with:", { 
        commitment: commitment, 
        timeoutSeconds: timeoutSeconds,
        commitmentType: typeof commitment,
        timeoutType: typeof timeoutSeconds
      });
      
      // Ensure timeout is a number
      const timeoutNumber = Number(timeoutSeconds);
      if (isNaN(timeoutNumber) || timeoutNumber <= 0) {
        throw new Error(`Invalid timeout value: ${timeoutSeconds}`);
      }
      
      const createGameTx = await rpsContract.createGame(commitment, timeoutNumber);
      log(`RPS createGame transaction sent: ${createGameTx.hash}`);
      const createGameReceipt = await createGameTx.wait();
      
      // Extract gameId from event
      const gameCreatedEvent = createGameReceipt.logs.find((log) => {
        try {
          return log.topics && log.topics[0] === ethers.id("GameCreated(uint256,address,bytes32,uint256)");
        } catch {
          return false;
        }
      });

      if (gameCreatedEvent) {
        const parsed = rpsContract.interface.parseLog(gameCreatedEvent);
        gameState.gameId = parsed.args.gameId.toString();
        log(`✅ Game created in RockPaperScissors! Game ID: ${gameState.gameId}`);
      } else {
        log("⚠️ Could not extract gameId from event, but transaction succeeded");
      }
    } else {
      log("⚠️ RockPaperScissors contract not initialized. Game will only be created in hook.");
    }

    // Call router swap with commitment (this will trigger hook)
    log("🚀 Executing swap with commitment...");
    console.log("Swap parameters:", {
      amountIn: amountIn.toString(),
      amountOutMin: amountOutMin.toString(),
      zeroForOne,
      poolKey,
      commitment,
      receiver,
      deadline
    });
    
    if (!routerContract) {
      throw new Error("Router contract not initialized");
    }
    
    const tx = await routerContract.swapExactTokensForTokensWithCommitment(
      amountIn,
      amountOutMin,
      zeroForOne,
      poolKey,
      commitment,
      "0x", // empty hookData
      receiver,
      deadline,
      { value: 0 }
    );

    log(`Swap transaction sent: ${tx.hash}`);
    console.log("Transaction hash:", tx.hash);
    const receipt = await tx.wait();
    log(`✅ Swap completed! Transaction confirmed in block ${receipt.blockNumber}`);
    console.log("Transaction receipt:", receipt);
    console.log("Number of logs:", receipt.logs.length);
    console.log("Continuing with verification...");

    // Check for Hook GameCreated event
    console.log("Checking for GameCreated event...");
    let hookGameCreatedEvent = null;
    try {
      const gameCreatedTopic = hookContract.interface.getEvent("GameCreated").topicHash;
      console.log("GameCreated topic hash:", gameCreatedTopic);
      hookGameCreatedEvent = receipt.logs.find((log) => {
        return log.topics && log.topics[0] === gameCreatedTopic;
      });
    } catch (e) {
      console.error("Error getting event topic, using fallback:", e);
      // Fallback to manual topic hash
      const fallbackTopic = ethers.id("GameCreated(bytes32,address,bytes32,address,uint256,uint256)");
      console.log("Fallback topic hash:", fallbackTopic);
      hookGameCreatedEvent = receipt.logs.find((log) => {
        return log.topics && log.topics[0] === fallbackTopic;
      });
    }
    console.log("GameCreated event found:", !!hookGameCreatedEvent);

    if (hookGameCreatedEvent) {
      log("✅ Hook GameCreated event detected");
      try {
        const parsed = hookContract.interface.parseLog(hookGameCreatedEvent);
        log(`   Commitment: ${parsed.args.commitmentHash}`);
        log(`   Player1: ${parsed.args.player1}`);
        log(`   Contribution: ${ethers.formatUnits(parsed.args.contributionAmount, decimals)} tokens`);
      } catch (e) {
        console.error("Error parsing GameCreated event:", e);
        log(`   Raw event topics: ${hookGameCreatedEvent.topics?.map(t => t.slice(0, 12)).join(", ")}`);
      }
    } else {
      log("⚠️ Hook GameCreated event NOT detected in swap transaction");
      log(`   Total logs in receipt: ${receipt.logs.length}`);
      log(`   Checking if hook address (${HOOK_ADDRESS}) matches any log addresses...`);
      const hookLogs = receipt.logs.filter(log => log.address && log.address.toLowerCase() === HOOK_ADDRESS.toLowerCase());
      log(`   Logs from hook: ${hookLogs.length}`);
    }

    // Verify the game was created in the hook
    console.log("🔍 Verifying game was created in hook...");
    log("🔍 Verifying game was created in hook...");
    console.log("Commitment hash:", commitment);
    console.log("Hook contract address:", HOOK_ADDRESS);
    try {
      console.log("Calling getPendingSwap...");
      const swap = await hookContract.getPendingSwap(commitment);
      console.log("Swap result:", swap);
      if (swap && swap.player1 && swap.player1 !== "0x0000000000000000000000000000000000000000") {
        log(`✅ Game verified in hook! Player1: ${swap.player1}`);
        console.log(`✅ Game verified in hook! Player1: ${swap.player1}`);
        log(`   Contribution: ${ethers.formatUnits(swap.player1Contribution, decimals)} tokens`);
        log(`   Player2 moved: ${swap.player2Moved}`);
        log(`   Resolved: ${swap.resolved}`);
      } else {
        log("❌ Game NOT found in hook! The swap may not have triggered the hook properly.");
        console.log("❌ Game NOT found in hook! Swap result:", swap);
        log("   This could mean:");
        log("   - The commitment hash wasn't passed correctly");
        log("   - The hook didn't process the swap");
        log("   - The contribution amount was too small");
      }
    } catch (error) {
      log(`❌ Error verifying game in hook: ${error.message}`);
      console.error("Verification error:", error);
      console.error("Error stack:", error.stack);
    }

    // Check if game appears in waiting list
    console.log("Checking waiting list...");
    try {
      const waitingGames = await hookContract.getGamesWaitingForPlayer2();
      console.log("Waiting games:", waitingGames);
      console.log("Waiting games count:", waitingGames.length);
      const isInList = waitingGames.some(hash => hash.toLowerCase() === commitment.toLowerCase());
      console.log("Is in list:", isInList);
      if (isInList) {
        log(`✅ Game is in the waiting list (${waitingGames.length} total games waiting)`);
        console.log(`✅ Game is in the waiting list (${waitingGames.length} total games waiting)`);
      } else {
        log(`⚠️ Game is NOT in the waiting list (${waitingGames.length} total games waiting)`);
        console.log(`⚠️ Game is NOT in the waiting list (${waitingGames.length} total games waiting)`);
        log(`   Commitment: ${commitment}`);
        console.log(`   Commitment: ${commitment}`);
        if (waitingGames.length > 0) {
          log(`   Waiting games: ${waitingGames.map(h => h.slice(0, 10)).join(", ")}...`);
          console.log(`   Waiting games:`, waitingGames);
        }
      }
    } catch (error) {
      log(`⚠️ Error checking waiting list: ${error.message}`);
      console.error("Error checking waiting list:", error);
      console.error("Error stack:", error.stack);
    }

    // Check if gameId is already linked in hook (hook may have auto-created it)
    if (hookContract) {
      try {
        const gameIdFromHook = await hookContract.getGameId(commitment);
        if (gameIdFromHook && gameIdFromHook.toString() !== "0") {
          const hookGameId = gameIdFromHook.toString();
          if (gameState.gameId && gameState.gameId !== hookGameId) {
            log(`⚠️ Warning: Frontend gameId (${gameState.gameId}) differs from hook gameId (${hookGameId}). Using hook's gameId.`);
          }
          gameState.gameId = hookGameId;
          log(`✅ GameId ${gameState.gameId} already linked in hook (hook auto-created the game)`);
        } else if (gameState.gameId) {
          // GameId exists from frontend but not linked in hook - try to link it
          try {
            log("Linking gameId to commitmentHash in hook...");
            const linkTx = await hookContract.linkGameId(commitment, gameState.gameId);
            log(`Link transaction sent: ${linkTx.hash}`);
            await linkTx.wait();
            log(`✅ GameId linked to commitmentHash in hook`);
          } catch (error) {
            // If linking fails, it might be because the game doesn't match or already exists
            log(`⚠️ Warning: Could not link gameId: ${error.message}`);
            log(`   The hook may create the game automatically on the next swap.`);
            // Don't fail the whole flow if linking fails
          }
        }
      } catch (error) {
        log(`⚠️ Could not check/get gameId from hook: ${error.message}`);
        // Don't fail the whole flow if this fails
      }
    }

    gameState.role = "maker";
    
    // Save game to localStorage
    saveMakerGame(commitment, gameState.gameId, amountInput, direction, gameState.timeout, gameState.salt, gameState.move);
    
    // Refresh maker's games list
    await loadMakerGames();
    
    // Clear form
    document.getElementById("makerSwapAmount").value = "";
    gameState.move = null;
    // Clear move button highlights
    const buttons = [
      document.getElementById("makerRockBtn"),
      document.getElementById("makerPaperBtn"),
      document.getElementById("makerScissorsBtn"),
    ];
    buttons.forEach((btn) => {
      if (btn) {
        btn.classList.remove("border-4", "border-green-400", "ring-4", "ring-green-200");
      }
    });
    updateMakerMoveStatus();
    updateMakerButtonStates();
  } catch (error) {
    log(`❌ Error creating game: ${error.message}`);
    console.error("Full error:", error);
    console.error("Error stack:", error.stack);
    if (error.reason) {
      log(`Error reason: ${error.reason}`);
    }
    if (error.data) {
      log(`Error data: ${JSON.stringify(error.data)}`);
    }
    if (error.code) {
      log(`Error code: ${error.code}`);
    }
    if (error.transaction) {
      console.error("Error transaction:", error.transaction);
    }
  } finally {
    const btn = document.getElementById("makerCreateGameBtn");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// LocalStorage functions to track Maker's games
function saveMakerGame(commitmentHash, gameId, swapAmount, swapDirection, timeout, salt = null, move = null) {
  try {
    const games = getMakerGames();
    const gameKey = commitmentHash || gameId?.toString();
    if (!gameKey) return;
    
    games[gameKey] = {
      commitmentHash: commitmentHash,
      gameId: gameId?.toString(),
      swapAmount: swapAmount,
      swapDirection: swapDirection,
      timeout: timeout,
      salt: salt || gameState.salt, // Store salt for later reveal
      move: move !== null ? move : gameState.move, // Store move for later reveal
      timestamp: Date.now()
    };
    localStorage.setItem('makerGames', JSON.stringify(games));
  } catch (error) {
    console.error('Error saving maker game:', error);
  }
}

function getMakerGames() {
  try {
    const stored = localStorage.getItem('makerGames');
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error getting maker games:', error);
    return {};
  }
}

function clearMakerGames() {
  try {
    localStorage.removeItem('makerGames');
  } catch (error) {
    console.error('Error clearing maker games:', error);
  }
}

// LocalStorage functions to track Taker's games
function saveTakerGame(commitmentHash, gameId, swapAmount, swapDirection) {
  try {
    const games = getTakerGames();
    const gameKey = commitmentHash || gameId?.toString();
    if (!gameKey) return;
    
    games[gameKey] = {
      commitmentHash: commitmentHash,
      gameId: gameId?.toString(),
      swapAmount: swapAmount,
      swapDirection: swapDirection,
      timestamp: Date.now()
    };
    localStorage.setItem('takerGames', JSON.stringify(games));
  } catch (error) {
    console.error('Error saving taker game:', error);
  }
}

function getTakerGames() {
  try {
    const stored = localStorage.getItem('takerGames');
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error getting taker games:', error);
    return {};
  }
}

function clearTakerGames() {
  try {
    localStorage.removeItem('takerGames');
  } catch (error) {
    console.error('Error clearing taker games:', error);
  }
}

// Load active games (for Player 2)
async function loadActiveGames() {
  if (!signer) {
    log("❌ Please connect your wallet first");
    return;
  }

  if (!hookContract) {
    log("❌ Hook contract not initialized. Initializing now...");
    try {
      await initializeContracts();
    } catch (error) {
      log(`❌ Failed to initialize contracts: ${error.message}`);
      return;
    }
  }

  if (!hookContract) {
    log("❌ Hook contract still not initialized. Please check deployments.json");
    console.error("HOOK_ADDRESS:", HOOK_ADDRESS);
    return;
  }

  try {
    log("Loading active games...");
    console.log("Calling getGamesWaitingForPlayer2 on hook at:", HOOK_ADDRESS);
    const activeGameHashes = await hookContract.getGamesWaitingForPlayer2();
    console.log("Active game hashes received:", activeGameHashes);
    console.log("Number of games:", activeGameHashes.length);
    
    const gamesListDiv = document.getElementById("takerAvailableGamesList");
    if (!gamesListDiv) {
      log("❌ Games list div not found");
      return;
    }

    if (!activeGameHashes || activeGameHashes.length === 0) {
      log("ℹ️ No active games waiting for Player 2");
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No active games waiting for Player 2</p>
          <p class="text-xs text-gray-500 text-center mt-2">Make sure Player 1 has created a game first</p>
        </div>
      `;
      return;
    }

    log(`✅ Found ${activeGameHashes.length} game(s) waiting for Player 2`);

    // Fetch details for each game
    log(`Fetching details for ${activeGameHashes.length} game(s)...`);
    const gamePromises = activeGameHashes.map(async (commitmentHash) => {
      try {
        if (!commitmentHash || commitmentHash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
          log(`⚠️ Skipping invalid commitment hash: ${commitmentHash}`);
          return null;
        }
        console.log(`Fetching swap details for commitment: ${commitmentHash}`);
        const swap = await hookContract.getPendingSwap(commitmentHash);
        console.log(`Swap details for ${commitmentHash.slice(0, 10)}...:`, swap);
        return { commitmentHash, swap };
      } catch (error) {
        log(`⚠️ Error fetching game ${commitmentHash?.slice(0, 10) || "unknown"}...: ${error.message}`);
        console.error("Error fetching swap:", error);
        return null;
      }
    });

    const games = (await Promise.all(gamePromises)).filter(g => g !== null);
    console.log(`Successfully fetched ${games.length} game(s)`);

    if (games.length === 0) {
      log("⚠️ No valid games found after fetching details");
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No valid games found</p>
          <p class="text-xs text-gray-500 text-center mt-2">Games may have been resolved or invalid</p>
        </div>
      `;
      return;
    }

    // Display games - need to get token decimals first
    const gamePromisesWithDecimals = games.map(async ({ commitmentHash, swap }) => {
      // Handle currency - it might be an address string or a Currency type
      let currencyAddress;
      if (typeof swap.currency === 'string') {
        currencyAddress = swap.currency;
      } else if (swap.currency && typeof swap.currency === 'object' && swap.currency.target) {
        // Currency type from Uniswap V4
        currencyAddress = swap.currency.target;
      } else {
        log(`⚠️ Unknown currency format for game ${commitmentHash.slice(0, 10)}...`);
        currencyAddress = swap.currency;
      }
      
      console.log(`Game ${commitmentHash.slice(0, 10)}... currency:`, currencyAddress, "TOKEN0:", TOKEN0_ADDRESS);
      
      const isToken0 = currencyAddress && TOKEN0_ADDRESS && 
                       currencyAddress.toLowerCase() === TOKEN0_ADDRESS.toLowerCase();
      const oppositeDirection = isToken0 ? "token1ToToken0" : "token0ToToken1";
      
      // Get decimals for the currency
      let decimals = 18; // default
      if (isToken0) {
        decimals = await safeTokenCall(token1Contract, "decimals", 18); // Opposite token
      } else {
        decimals = await safeTokenCall(token0Contract, "decimals", 18); // Opposite token
      }
      
      const player1Contribution = ethers.formatUnits(swap.player1Contribution, decimals);
      
      // Calculate timeout - get REFUND_TIMEOUT from hook (defaults to 30 minutes = 1800 seconds)
      let refundTimeout = 1800; // default: 30 minutes
      try {
        if (hookContract) {
          refundTimeout = Number(await hookContract.REFUND_TIMEOUT());
        }
      } catch (error) {
        console.warn("Could not get REFUND_TIMEOUT from hook, using default 30 minutes (1800 seconds)");
      }
      
      // Calculate time remaining
      const now = Math.floor(Date.now() / 1000);
      const gameTimestamp = Number(swap.timestamp);
      const expiryTime = gameTimestamp + refundTimeout;
      const timeRemaining = expiryTime - now;
      const isExpired = timeRemaining <= 0;
      
      // Format time remaining
      let timeRemainingText = "";
      if (isExpired) {
        const expiredSeconds = Math.abs(timeRemaining);
        const expiredMinutes = Math.floor(expiredSeconds / 60);
        const expiredSecs = expiredSeconds % 60;
        timeRemainingText = `Expired ${expiredMinutes}:${expiredSecs.toString().padStart(2, "0")} ago`;
      } else {
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        timeRemainingText = `${minutes}:${seconds.toString().padStart(2, "0")} remaining`;
      }
      
      return {
        commitmentHash,
        swap,
        player1Contribution,
        oppositeDirection,
        contributionAmount: swap.player1Contribution.toString(),
        currencyAddress,
        timeRemaining,
        timeRemainingText,
        isExpired
      };
    });

    const gamesWithDetails = await Promise.all(gamePromisesWithDecimals);
    console.log("Games with details:", gamesWithDetails);

    // Store games data for real-time updates
    activeGamesData = gamesWithDetails.map(({ commitmentHash, swap, timeRemaining, isExpired }) => ({
      commitmentHash,
      timestamp: Number(swap.timestamp),
      timeRemaining,
      isExpired,
      gameId: `game-${commitmentHash.slice(2, 10)}`
    }));

    log(`✅ Displaying ${gamesWithDetails.length} game(s)`);

    // Display games
    gamesListDiv.innerHTML = gamesWithDetails.map(({ commitmentHash, player1Contribution, oppositeDirection, contributionAmount, swap, timeRemainingText, isExpired }) => {
      const requiredToken = oppositeDirection === "token0ToToken1" ? "Token0" : "Token1";
      const gameId = `game-${commitmentHash.slice(2, 10)}`;
      const borderColor = isExpired ? "border-red-300" : "border-purple-200";
      const bgColor = isExpired ? "bg-red-50" : "bg-white";
      return `
        <div class="${bgColor} border-2 ${borderColor} rounded-xl p-4 mb-4" id="${gameId}">
          <div class="flex flex-col gap-3">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Game:</span>
              <span class="text-xs font-mono text-purple-600">${commitmentHash.slice(0, 10)}...${commitmentHash.slice(-8)}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Maker's Contribution:</span>
              <span class="text-sm font-semibold">${player1Contribution}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Required Swap:</span>
              <span class="text-sm font-semibold">${oppositeDirection === "token0ToToken1" ? "Token0 → Token1" : "Token1 → Token0"}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">You Need:</span>
              <span class="text-sm font-semibold text-purple-600">${player1Contribution} ${requiredToken}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm ${isExpired ? 'text-red-600 font-bold' : 'text-orange-600'}">${isExpired ? '⏰ Join Deadline Expired' : '⏳ Join Deadline'}:</span>
              <span class="text-sm font-semibold ${isExpired ? 'text-red-600' : 'text-orange-600'}" id="${gameId}-time-remaining">${timeRemainingText}</span>
            </div>
            
            <!-- Move Selection for this game -->
            <div class="mt-2 pt-3 border-t border-gray-200">
              <p class="text-xs text-gray-600 mb-2">Select your move:</p>
              <div class="flex gap-2 mb-3">
                <button 
                  class="move-btn rock-btn px-3 py-1.5 text-white text-xs font-semibold rounded-lg shadow"
                  onclick="selectMoveForGame('${gameId}', 0, '${commitmentHash}', '${oppositeDirection}', '${contributionAmount}')"
                >
                  🪨 Rock
                </button>
                <button 
                  class="move-btn paper-btn px-3 py-1.5 text-white text-xs font-semibold rounded-lg shadow"
                  onclick="selectMoveForGame('${gameId}', 1, '${commitmentHash}', '${oppositeDirection}', '${contributionAmount}')"
                >
                  📄 Paper
                </button>
                <button 
                  class="move-btn scissors-btn px-3 py-1.5 text-white text-xs font-semibold rounded-lg shadow"
                  onclick="selectMoveForGame('${gameId}', 2, '${commitmentHash}', '${oppositeDirection}', '${contributionAmount}')"
                data-move="2"
                >
                  ✂️ Scissors
                </button>
              </div>
              <div id="${gameId}-move-status" class="text-xs text-gray-500 mb-2"></div>
              <button 
                id="${gameId}-join-btn"
                class="w-full px-4 py-2 ${isExpired ? 'bg-red-300 text-red-700 cursor-not-allowed' : 'bg-gray-300 text-gray-600 cursor-not-allowed'} font-semibold rounded-lg"
                ${isExpired ? 'disabled' : 'disabled'}
                data-commitment="${commitmentHash}"
                data-direction="${oppositeDirection}"
                data-amount="${contributionAmount}"
              >
                ${isExpired ? '⏰ Game Expired' : '🎮 Join This Game'}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    log(`✅ Loaded ${gamesWithDetails.length} active game(s)`);
    
    // Attach event listeners to join buttons
    gamesWithDetails.forEach(({ commitmentHash, isExpired }) => {
      const gameId = `game-${commitmentHash.slice(2, 10)}`;
      const joinBtn = document.getElementById(`${gameId}-join-btn`);
      if (joinBtn && !isExpired) {
        // Remove any existing listeners by cloning the button
        const newBtn = joinBtn.cloneNode(true);
        joinBtn.parentNode.replaceChild(newBtn, joinBtn);
        
        // Add click event listener
        newBtn.addEventListener('click', function() {
          if (!this.disabled) {
            const commitment = this.getAttribute('data-commitment');
            const direction = this.getAttribute('data-direction');
            const amount = this.getAttribute('data-amount');
            joinGame(commitment, direction, amount);
          }
        });
      }
    });
    
    // Start real-time timeout updates
    startActiveGamesTimer();
  } catch (error) {
    log(`❌ Error loading active games: ${error.message}`);
    console.error("Full error loading active games:", error);
    if (error.reason) {
      log(`Error reason: ${error.reason}`);
    }
    const gamesListDiv = document.getElementById("takerAvailableGamesList");
    if (gamesListDiv) {
      gamesListDiv.innerHTML = `
        <div class="bg-red-50 border-2 border-red-200 rounded-xl p-4">
          <p class="text-sm text-red-600 text-center">Error loading games: ${error.message}</p>
          <p class="text-xs text-red-500 text-center mt-2">Check console for details</p>
        </div>
      `;
    }
    // Stop timer on error
    stopActiveGamesTimer();
  }
}

// Real-time timeout update functions
async function startActiveGamesTimer() {
  // Clear existing interval if any
  if (activeGamesUpdateInterval) {
    clearInterval(activeGamesUpdateInterval);
  }
  
  // Get REFUND_TIMEOUT from hook (defaults to 30 minutes = 1800 seconds)
  let refundTimeout = 1800; // default: 30 minutes
  if (hookContract) {
    try {
      const timeout = await hookContract.REFUND_TIMEOUT();
      refundTimeout = Number(timeout);
    } catch (error) {
      console.warn("Could not get REFUND_TIMEOUT from hook, using default 30 minutes (1800 seconds)");
    }
  }
  
  // Update every second
  activeGamesUpdateInterval = setInterval(() => {
    updateActiveGamesTimers(refundTimeout);
  }, 1000);
  
  // Initial update
  updateActiveGamesTimers(refundTimeout);
}

function stopActiveGamesTimer() {
  if (activeGamesUpdateInterval) {
    clearInterval(activeGamesUpdateInterval);
    activeGamesUpdateInterval = null;
  }
  activeGamesData = [];
  selectedMovesByGame = {}; // Clear selected moves when stopping timer
}

function updateActiveGamesTimers(refundTimeout) {
  if (!activeGamesData || activeGamesData.length === 0) {
    return;
  }
  
  const now = Math.floor(Date.now() / 1000);
  
  activeGamesData.forEach(({ commitmentHash, timestamp, gameId }) => {
    const expiryTime = timestamp + refundTimeout;
    const timeRemaining = expiryTime - now;
    const isExpired = timeRemaining <= 0;
    
    // Format time remaining
    let timeRemainingText = "";
    if (isExpired) {
      const expiredSeconds = Math.abs(timeRemaining);
      const expiredMinutes = Math.floor(expiredSeconds / 60);
      const expiredSecs = expiredSeconds % 60;
      timeRemainingText = `Expired ${expiredMinutes}:${expiredSecs.toString().padStart(2, "0")} ago`;
    } else {
      const minutes = Math.floor(timeRemaining / 60);
      const seconds = timeRemaining % 60;
      timeRemainingText = `${minutes}:${seconds.toString().padStart(2, "0")} remaining`;
    }
    
    // Update the display
    const timeElement = document.getElementById(`${gameId}-time-remaining`);
    if (timeElement) {
      timeElement.textContent = timeRemainingText;
      timeElement.className = `text-sm font-semibold ${isExpired ? 'text-red-600' : 'text-orange-600'}`;
      
      // Update parent container styling if expired
      const gameContainer = document.getElementById(gameId);
      if (gameContainer) {
        if (isExpired) {
          gameContainer.className = "bg-red-50 border-2 border-red-300 rounded-xl p-4 mb-4";
        } else {
          gameContainer.className = "bg-white border-2 border-purple-200 rounded-xl p-4 mb-4";
        }
        
        // Update join button - but preserve enabled state if move is selected
        const joinBtn = document.getElementById(`${gameId}-join-btn`);
        if (joinBtn) {
          const hasMoveSelected = selectedMovesByGame[gameId] !== undefined;
          
          if (isExpired) {
            joinBtn.className = "w-full px-4 py-2 bg-red-300 text-red-700 cursor-not-allowed font-semibold rounded-lg";
            joinBtn.disabled = true;
            joinBtn.textContent = "⏰ Game Expired";
          } else if (hasMoveSelected) {
            // Preserve enabled state if move is selected
            joinBtn.className = "w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transform hover:scale-105 transition-all font-semibold rounded-lg";
            joinBtn.disabled = false;
            joinBtn.textContent = "🎮 Join This Game";
          } else {
            // No move selected - keep disabled
            joinBtn.className = "w-full px-4 py-2 bg-gray-300 text-gray-600 cursor-not-allowed font-semibold rounded-lg";
            joinBtn.disabled = true;
            joinBtn.textContent = "🎮 Join This Game";
          }
        }
      }
    }
  });
}

// Helper function to format time remaining
function formatTimeRemaining(deadline) {
  const now = Math.floor(Date.now() / 1000);
  if (deadline <= 0 || deadline < 1000000000) return null;
  
  const timeRemaining = deadline - now;
  if (timeRemaining < 0) {
    const overdue = Math.abs(timeRemaining);
    const minutes = Math.floor(overdue / 60);
    const seconds = overdue % 60;
    return { text: `${minutes}:${seconds.toString().padStart(2, "0")} ago`, overdue: true };
  }
  
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  return { text: `${minutes}:${seconds.toString().padStart(2, "0")}`, overdue: false };
}

// Load games awaiting reveal (where current user is taker)
async function loadAwaitingRevealGames() {
  if (!signer || !hookContract || !rpsContract) {
    return;
  }

  try {
    const userAddress = await signer.getAddress();
    log("Loading games awaiting reveal...");
    
    const awaitingRevealHashes = await hookContract.getGamesWaitingForReveal();
    const gamesListDiv = document.getElementById("takerAwaitingRevealList");
    
    if (!gamesListDiv) return;

    if (!awaitingRevealHashes || awaitingRevealHashes.length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No games awaiting reveal</p>
        </div>
      `;
      return;
    }

    // Filter games where current user is player2
    const userGames = [];
    for (const commitmentHash of awaitingRevealHashes) {
      try {
        const swap = await hookContract.getPendingSwap(commitmentHash);
        if (swap.player2 && swap.player2.toLowerCase() === userAddress.toLowerCase()) {
          const gameId = await hookContract.getGameId(commitmentHash);
          if (gameId && gameId.toString() !== "0") {
            const game = await rpsContract.getGame(gameId);
            const isArray = Array.isArray(game) || (typeof game === "object" && game.length !== undefined);
            const status = isArray ? game[3] : game.status;
            const revealDeadline = isArray ? game[10] : game.revealDeadline;
            
            if (Number(status) === 2) { // Revealed status
              userGames.push({
                commitmentHash,
                gameId: gameId.toString(),
                swap,
                revealDeadline: Number(revealDeadline)
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error processing game ${commitmentHash}:`, error);
      }
    }

    if (userGames.length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No games awaiting reveal</p>
        </div>
      `;
      return;
    }

    // Display games - need to fetch decimals for each game
    const gamesWithDecimals = await Promise.all(userGames.map(async ({ commitmentHash, gameId, swap, revealDeadline }) => {
      let currencyAddress = typeof swap.currency === 'string' ? swap.currency : swap.currency?.target;
      const isToken0 = currencyAddress && TOKEN0_ADDRESS && 
                       currencyAddress.toLowerCase() === TOKEN0_ADDRESS.toLowerCase();
      let decimals = 18;
      if (isToken0 && token1Contract) {
        decimals = await safeTokenCall(token1Contract, "decimals", 18);
      } else if (token0Contract) {
        decimals = await safeTokenCall(token0Contract, "decimals", 18);
      }
      const contribution = ethers.formatUnits(swap.player2Contribution, decimals);
      return { commitmentHash, gameId, swap, revealDeadline, contribution };
    }));

    gamesListDiv.innerHTML = gamesWithDecimals.map(({ commitmentHash, gameId, swap, revealDeadline, contribution }) => {
      const now = Math.floor(Date.now() / 1000);
      const timeRemaining = revealDeadline - now;
      const isOverdue = timeRemaining < 0;
      const minutes = Math.floor(Math.abs(timeRemaining) / 60);
      const seconds = Math.abs(timeRemaining) % 60;
      const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      
      const moveNames = ["Rock 🪨", "Paper 📄", "Scissors ✂️"];
      const player2MoveName = moveNames[swap.player2Move] || "Unknown";
      
      return `
        <div class="bg-orange-50 border-2 border-orange-200 rounded-xl p-4">
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Game ID:</span>
              <span class="text-xs font-mono text-purple-600">${gameId}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Your Move:</span>
              <span class="text-sm font-semibold">${player2MoveName}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Your Contribution:</span>
              <span class="text-sm font-semibold">${contribution}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm ${isOverdue ? 'text-red-600 font-bold' : 'text-orange-600'}">${isOverdue ? '⏰ Deadline Passed' : '⏳ Time Remaining'}:</span>
              <span class="text-sm font-semibold ${isOverdue ? 'text-red-600' : 'text-orange-600'}">${isOverdue ? `${timeStr} ago` : timeStr}</span>
            </div>
            ${isOverdue ? `
              <div class="mt-2 p-2 bg-red-100 border border-red-300 rounded-lg">
                <p class="text-xs text-red-800 text-center">Player 1 failed to reveal. You can claim victory!</p>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join("");

    log(`✅ Loaded ${userGames.length} game(s) awaiting reveal`);
  } catch (error) {
    log(`❌ Error loading games awaiting reveal: ${error.message}`);
    console.error("Error loading awaiting reveal games:", error);
    const gamesListDiv = document.getElementById("takerAwaitingRevealList");
    if (gamesListDiv) {
      gamesListDiv.innerHTML = `
        <div class="bg-red-50 border-2 border-red-200 rounded-xl p-4">
          <p class="text-sm text-red-600 text-center">Error loading games: ${error.message}</p>
        </div>
      `;
    }
  }
}

// Load completed games (from tracked games)
async function loadCompletedGames() {
  if (!signer || !rpsContract) {
    return;
  }

  try {
    const userAddress = await signer.getAddress();
    const trackedGames = getTakerGames();
    const gamesListDiv = document.getElementById("completedGamesList");
    
    if (!gamesListDiv) return;

    if (!trackedGames || Object.keys(trackedGames).length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No completed games yet</p>
        </div>
      `;
      return;
    }

    const completedGames = [];
    
    // Check each tracked game
    for (const [key, gameData] of Object.entries(trackedGames)) {
      try {
        if (!gameData.gameId || gameData.gameId === "0") continue;
        
        const game = await rpsContract.getGame(gameData.gameId);
        const isArray = Array.isArray(game) || (typeof game === "object" && game.length !== undefined);
        const status = isArray ? game[3] : game.status;
        const player2 = isArray ? game[2] : game.player2;
        const statusNum = Number(status);
        
        // Only show games where user is taker (player2) and game is completed
        if (statusNum === 3 && player2 && player2.toLowerCase() === userAddress.toLowerCase()) {
          const winner = isArray ? game[7] : game.winner;
          const player1Move = isArray ? game[5] : game.player1Move;
          const player2Move = isArray ? game[6] : game.player2Move;
          const createdAt = isArray ? game[8] : game.createdAt;
          
          completedGames.push({
            gameId: gameData.gameId,
            commitmentHash: gameData.commitmentHash,
            winner: Number(winner),
            player1Move: Number(player1Move),
            player2Move: Number(player2Move),
            createdAt: Number(createdAt),
            swapAmount: gameData.swapAmount,
            swapDirection: gameData.swapDirection,
            timestamp: gameData.timestamp
          });
        }
      } catch (error) {
        console.error(`Error checking game ${key}:`, error);
      }
    }

    // Sort by creation time (newest first)
    completedGames.sort((a, b) => b.createdAt - a.createdAt);

    if (completedGames.length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No completed games yet</p>
        </div>
      `;
      return;
    }

    // Display completed games
    const moveNames = ["Rock 🪨", "Paper 📄", "Scissors ✂️"];
    gamesListDiv.innerHTML = completedGames.map((game) => {
      const isWin = game.winner === 2;
      const isTie = game.winner === 0;
      const resultText = isTie ? "Tie 🤝" : isWin ? "You Won! 🎉" : "You Lost 😔";
      // Use conditional classes for Tailwind
      const bgClass = isTie ? "bg-yellow-50" : isWin ? "bg-green-50" : "bg-red-50";
      const borderClass = isTie ? "border-yellow-200" : isWin ? "border-green-200" : "border-red-200";
      const textClass = isTie ? "text-yellow-600" : isWin ? "text-green-600" : "text-red-600";
      const date = new Date(game.createdAt * 1000);
      const dateStr = date.toLocaleString();
      
      return `
        <div class="${bgClass} border-2 ${borderClass} rounded-xl p-4">
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Game ID:</span>
              <span class="text-xs font-mono text-purple-600">${game.gameId}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Result:</span>
              <span class="text-sm font-bold ${textClass}">${resultText}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Maker's Move:</span>
              <span class="text-sm font-semibold">${moveNames[game.player1Move] || "Unknown"}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Your Move:</span>
              <span class="text-sm font-semibold">${moveNames[game.player2Move] || "Unknown"}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Amount:</span>
              <span class="text-sm font-semibold">${game.swapAmount || "N/A"}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Completed:</span>
              <span class="text-xs text-gray-500">${dateStr}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    log(`✅ Loaded ${completedGames.length} completed game(s)`);
  } catch (error) {
    log(`❌ Error loading completed games: ${error.message}`);
    console.error("Error loading completed games:", error);
    const gamesListDiv = document.getElementById("takerCompletedGamesList");
    if (gamesListDiv) {
      gamesListDiv.innerHTML = `
        <div class="bg-red-50 border-2 border-red-200 rounded-xl p-4">
          <p class="text-sm text-red-600 text-center">Error loading games: ${error.message}</p>
        </div>
      `;
    }
  }
}

// Load all Taker games (available, awaiting reveal, completed)
async function loadAllTakerGames() {
  // Stop existing timer before reloading
  stopActiveGamesTimer();
  
  const refreshBtn = document.getElementById("takerRefreshBtn");
  const originalText = refreshBtn ? refreshBtn.innerHTML : "";
  const originalDisabled = refreshBtn ? refreshBtn.disabled : false;
  
  // Update button to show loading state
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = "⏳ Refreshing...";
    refreshBtn.classList.add("opacity-75", "cursor-not-allowed");
  }
  
  try {
    await loadActiveGames();
    await loadAwaitingRevealGames();
    await loadCompletedGames();
    
    // Show success feedback briefly
    if (refreshBtn) {
      refreshBtn.innerHTML = "✅ Refreshed!";
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    log(`❌ Error refreshing games: ${error.message}`);
    // Show error feedback briefly
    if (refreshBtn) {
      refreshBtn.innerHTML = "❌ Error";
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally {
    // Restore original button state
    if (refreshBtn) {
      refreshBtn.disabled = originalDisabled;
      refreshBtn.innerHTML = originalText || "🔄 Refresh";
      refreshBtn.classList.remove("opacity-75", "cursor-not-allowed");
    }
  }
}

// Load Maker games
async function loadMakerGames() {
  if (!signer || !hookContract || !rpsContract) {
    const gamesListDiv = document.getElementById("makerGamesList");
    if (gamesListDiv) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">Please connect your wallet first</p>
        </div>
      `;
    }
    return;
  }

  try {
    const userAddress = await signer.getAddress();
    const trackedGames = getMakerGames();
    const gamesListDiv = document.getElementById("makerGamesList");
    
    if (!gamesListDiv) return;

    if (!trackedGames || Object.keys(trackedGames).length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No games created yet. Create your first game above!</p>
        </div>
      `;
      return;
    }

    const makerGames = [];
    
    // Check each tracked game
    for (const [key, gameData] of Object.entries(trackedGames)) {
      try {
        if (!gameData.commitmentHash) continue;
        
        // Get swap info from hook
        let swap = null;
        try {
          swap = await hookContract.getPendingSwap(gameData.commitmentHash);
        } catch (error) {
          console.error(`Error fetching swap for ${gameData.commitmentHash}:`, error);
        }
        
        // Get game info from RPS contract if we have a gameId
        let game = null;
        let gameId = gameData.gameId;
        if (!gameId && rpsContract) {
          try {
            gameId = await hookContract.getGameId(gameData.commitmentHash);
            if (gameId && gameId.toString() !== "0") {
              gameId = gameId.toString();
            }
          } catch (error) {
            console.error(`Error getting gameId:`, error);
          }
        }
        
        if (gameId && gameId !== "0" && rpsContract) {
          try {
            game = await rpsContract.getGame(gameId);
          } catch (error) {
            console.error(`Error fetching game ${gameId}:`, error);
          }
        }
        
        const isArray = game && (Array.isArray(game) || (typeof game === "object" && game !== null && game.length !== undefined));
        const status = game ? (isArray ? game[3] : game.status) : null;
        const player1 = game ? (isArray ? game[1] : game.player1) : null;
        const statusNum = status !== null ? Number(status) : null;
        
        // Check if user is player1 (maker) - either from RPS contract or from hook swap
        const swapPlayer1 = swap && swap.player1 ? swap.player1 : null;
        const isPlayer1 = (player1 && player1.toLowerCase() === userAddress.toLowerCase()) ||
                         (swapPlayer1 && swapPlayer1.toLowerCase() === userAddress.toLowerCase());
        
        // Only show games where user is player1 (maker)
        if (isPlayer1) {
          const player2 = game ? (isArray ? game[2] : game.player2) : null;
          const player2Move = game ? (isArray ? game[6] : game.player2Move) : null;
          const revealDeadline = game ? (isArray ? game[10] : game.revealDeadline) : null;
          const winner = game ? (isArray ? game[7] : game.winner) : null;
          
          makerGames.push({
            commitmentHash: gameData.commitmentHash,
            gameId: gameId || "N/A",
            swapAmount: gameData.swapAmount,
            swapDirection: gameData.swapDirection,
            status: statusNum,
            player2: player2,
            player2Move: player2Move !== null && player2Move !== undefined ? Number(player2Move) : null,
            revealDeadline: revealDeadline ? Number(revealDeadline) : null,
            winner: winner !== null && winner !== undefined ? Number(winner) : null,
            swap: swap,
            timestamp: gameData.timestamp
          });
        }
      } catch (error) {
        console.error(`Error checking game ${key}:`, error);
      }
    }

    // Sort by timestamp (newest first)
    makerGames.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (makerGames.length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No games created yet. Create your first game above!</p>
        </div>
      `;
      return;
    }

    // Display maker games
    const moveNames = ["Rock 🪨", "Paper 📄", "Scissors ✂️"];
    gamesListDiv.innerHTML = makerGames.map((game) => {
      let statusText = "Waiting for Player 2";
      let statusColor = "yellow";
      let actionButton = "";
      
      if (game.status === null) {
        statusText = "Pending";
        statusColor = "gray";
      } else if (game.status === 0 || game.status === 1) {
        statusText = "Waiting for Player 2";
        statusColor = "yellow";
      } else if (game.status === 2) {
        statusText = "Waiting for Reveal";
        statusColor = "orange";
        // Show reveal button
        const player2MoveName = game.player2Move !== null ? moveNames[game.player2Move] : "Unknown";
        actionButton = `
          <div class="mt-3 pt-3 border-t border-gray-200">
            <p class="text-xs text-gray-600 mb-2">Player 2's Move: ${player2MoveName}</p>
            <button
              onclick="revealMakerMove('${game.gameId}', '${game.commitmentHash}')"
              class="w-full px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold rounded-lg hover:from-green-700 hover:to-emerald-700 transform hover:scale-105 transition-all"
            >
              🔓 Reveal Move
            </button>
          </div>
        `;
      } else if (game.status === 3) {
        statusText = "Completed";
        statusColor = "green";
        const winnerText = game.winner === 0 ? "Tie 🤝" : game.winner === 1 ? "You Won! 🎉" : "You Lost 😔";
        actionButton = `
          <div class="mt-3 pt-3 border-t border-gray-200">
            <p class="text-sm font-semibold ${game.winner === 1 ? 'text-green-600' : game.winner === 2 ? 'text-red-600' : 'text-yellow-600'}">${winnerText}</p>
          </div>
        `;
      }
      
      const bgClass = {
        gray: "bg-gray-50",
        yellow: "bg-yellow-50",
        orange: "bg-orange-50",
        green: "bg-green-50"
      }[statusColor] || "bg-gray-50";
      
      const borderClass = {
        gray: "border-gray-200",
        yellow: "border-yellow-200",
        orange: "border-orange-200",
        green: "border-green-200"
      }[statusColor] || "border-gray-200";
      
      const timeInfo = game.revealDeadline ? formatTimeRemaining(game.revealDeadline) : null;
      
      return `
        <div class="${bgClass} border-2 ${borderClass} rounded-xl p-4">
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Game ID:</span>
              <span class="text-xs font-mono text-purple-600">${game.gameId}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Status:</span>
              <span class="text-sm font-semibold text-${statusColor}-600">${statusText}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Swap Amount:</span>
              <span class="text-sm font-semibold">${game.swapAmount} ${game.swapDirection === "token0ToToken1" ? "Token0 → Token1" : "Token1 → Token0"}</span>
            </div>
            ${game.player2 ? `
              <div class="flex justify-between items-center">
                <span class="text-sm text-gray-600">Player 2:</span>
                <span class="text-xs font-mono text-purple-600">${game.player2.slice(0, 6)}...${game.player2.slice(-4)}</span>
              </div>
            ` : ''}
            ${timeInfo ? `
              <div class="flex justify-between items-center">
                <span class="text-sm ${timeInfo.overdue ? 'text-red-600 font-bold' : 'text-orange-600'}">${timeInfo.overdue ? '⏰ Deadline Passed' : '⏳ Time Remaining'}:</span>
                <span class="text-sm font-semibold ${timeInfo.overdue ? 'text-red-600' : 'text-orange-600'}">${timeInfo.text}</span>
              </div>
            ` : ''}
            ${actionButton}
          </div>
        </div>
      `;
    }).join("");

    log(`✅ Loaded ${makerGames.length} maker game(s)`);
  } catch (error) {
    log(`❌ Error loading maker games: ${error.message}`);
    console.error("Error loading maker games:", error);
    const gamesListDiv = document.getElementById("makerGamesList");
    if (gamesListDiv) {
      gamesListDiv.innerHTML = `
        <div class="bg-red-50 border-2 border-red-200 rounded-xl p-4">
          <p class="text-sm text-red-600 text-center">Error loading games: ${error.message}</p>
        </div>
      `;
    }
  }
}

// Load Maker games with refresh button feedback
async function loadMakerGamesWithFeedback() {
  const refreshBtn = document.getElementById("makerRefreshBtn");
  const originalText = refreshBtn ? refreshBtn.innerHTML : "";
  const originalDisabled = refreshBtn ? refreshBtn.disabled : false;
  
  // Update button to show loading state
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = "⏳ Refreshing...";
    refreshBtn.classList.add("opacity-75", "cursor-not-allowed");
  }
  
  try {
    await loadMakerGames();
    
    // Show success feedback briefly
    if (refreshBtn) {
      refreshBtn.innerHTML = "✅ Refreshed!";
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    log(`❌ Error refreshing games: ${error.message}`);
    // Show error feedback briefly
    if (refreshBtn) {
      refreshBtn.innerHTML = "❌ Error";
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally {
    // Restore original button state
    if (refreshBtn) {
      refreshBtn.disabled = originalDisabled;
      refreshBtn.innerHTML = originalText || "🔄 Refresh";
      refreshBtn.classList.remove("opacity-75", "cursor-not-allowed");
    }
  }
}

// Select move for a specific game (Taker)
window.selectMoveForGame = function(gameId, move, commitmentHash, oppositeDirection, contributionAmount) {
  const moveNames = ["Rock 🪨", "Paper 📄", "Scissors ✂️"];
  
  // Update global move state
  gameState.move = move;
  updateMoveStatus();
  updateStepCheckmarks();
  
  // Track that this game has a move selected
  selectedMovesByGame[gameId] = move;
  
  // Update the specific game card UI
  const moveStatusDiv = document.getElementById(`${gameId}-move-status`);
  const joinBtn = document.getElementById(`${gameId}-join-btn`);
  
  if (moveStatusDiv) {
    moveStatusDiv.innerHTML = `<span class="text-green-600 font-semibold">✓ Selected: ${moveNames[move]}</span>`;
  }
  
  if (joinBtn) {
    // Check if game is expired first
    const gameContainer = document.getElementById(gameId);
    const isExpired = gameContainer && gameContainer.classList.contains("bg-red-50");
    
    if (!isExpired) {
      joinBtn.disabled = false;
      joinBtn.classList.remove("bg-gray-300", "text-gray-600", "cursor-not-allowed");
      joinBtn.classList.add("bg-gradient-to-r", "from-purple-600", "to-indigo-600", "text-white", "hover:from-purple-700", "hover:to-indigo-700", "transform", "hover:scale-105", "transition-all");
    }
  }
  
  // Highlight selected move button
  const gameCard = document.getElementById(gameId);
  if (gameCard) {
    const moveButtons = gameCard.querySelectorAll('.move-btn');
    moveButtons.forEach((btn, index) => {
      if (index === move) {
        btn.classList.add("border-4", "border-green-400", "ring-4", "ring-green-200");
      } else {
        btn.classList.remove("border-4", "border-green-400", "ring-4", "ring-green-200");
      }
    });
  }
  
  log(`✅ Move selected: ${moveNames[move]}`);
};

// Join game (Taker)
window.joinGame = async function(commitmentHash, oppositeDirection, makerContributionAmount) {
  console.log("joinGame called with:", { commitmentHash, oppositeDirection, makerContributionAmount });
  log("🎮 Join game button clicked!");
  
  if (!signer) {
    log("❌ Please connect your wallet first");
    console.error("No signer available");
    return;
  }

  if (!routerContract || !hookContract) {
    log("❌ Contracts not initialized. Initializing now...");
    console.log("Initializing contracts...");
    try {
      await initializeContracts();
      if (!routerContract || !hookContract) {
        throw new Error("Contracts still not initialized after initialization attempt");
      }
    } catch (error) {
      log(`❌ Failed to initialize contracts: ${error.message}`);
      console.error("Contract initialization error:", error);
      return;
    }
  }

  if (gameState.move === null || gameState.move === undefined) {
    log("❌ Please select your move first");
    console.error("No move selected. gameState.move:", gameState.move);
    return;
  }

  console.log("Move selected:", gameState.move);
  console.log("Router contract:", routerContract ? "initialized" : "not initialized");
  console.log("Hook contract:", hookContract ? "initialized" : "not initialized");

  const networkOk = await ensureCorrectNetwork();
  if (!networkOk) {
    log("❌ Please switch to the correct network");
    return;
  }

  // Store button reference for error handling
  const gameIdForBtn = `game-${commitmentHash.slice(2, 10)}`;
  let joinBtn = document.getElementById(`${gameIdForBtn}-join-btn`);
  const originalJoinBtnText = joinBtn ? joinBtn.innerHTML : "";

  // Wrap everything in try-catch to ensure errors are caught
  try {
    log("📋 Preparing to join game...");
    console.log("Setting game state...");
    console.log("Full gameState before update:", JSON.stringify(gameState, null, 2));
    
    gameState.commitmentHash = commitmentHash;
    gameState.role = "taker";
    gameState.swapDirection = oppositeDirection;

    // Validate addresses
    if (!TOKEN0_ADDRESS || !TOKEN1_ADDRESS || !HOOK_ADDRESS || !ROUTER_ADDRESS) {
      throw new Error(`Missing contract addresses. TOKEN0: ${TOKEN0_ADDRESS}, TOKEN1: ${TOKEN1_ADDRESS}, HOOK: ${HOOK_ADDRESS}, ROUTER: ${ROUTER_ADDRESS}`);
    }

    // Prepare pool key
    const zeroForOne = oppositeDirection === "token0ToToken1";
    const poolKey = {
      currency0: TOKEN0_ADDRESS,
      currency1: TOKEN1_ADDRESS,
      fee: POOL_FEE,
      tickSpacing: TICK_SPACING,
      hooks: HOOK_ADDRESS
    };
    
    console.log("Pool key:", poolKey);

    // Get token contract and decimals for the token Player 2 needs to swap
    log("🔍 Getting token contract information...");
    console.log("zeroForOne:", zeroForOne);
    console.log("token0Contract:", token0Contract ? "initialized" : "not initialized");
    console.log("token1Contract:", token1Contract ? "initialized" : "not initialized");
    
    let tokenContract, tokenSymbol, decimals;
    try {
      if (zeroForOne) {
        if (!token0Contract) {
          log("⚠️ Token0 contract not initialized, initializing now...");
          await initializeContracts();
          if (!token0Contract) {
            throw new Error("Token0 contract not available. Please check deployments.json");
          }
        }
        tokenContract = token0Contract;
        console.log("Getting Token0 decimals and symbol...");
        decimals = await safeTokenCall(token0Contract, "decimals", 18);
        tokenSymbol = await safeTokenCall(token0Contract, "symbol", "Token0");
        log(`✅ Using Token0 (${tokenSymbol}) with ${decimals} decimals`);
        console.log(`Token0: ${tokenSymbol}, decimals: ${decimals}`);
      } else {
        if (!token1Contract) {
          log("⚠️ Token1 contract not initialized, initializing now...");
          await initializeContracts();
          if (!token1Contract) {
            throw new Error("Token1 contract not available. Please check deployments.json");
          }
        }
        tokenContract = token1Contract;
        console.log("Getting Token1 decimals and symbol...");
        decimals = await safeTokenCall(token1Contract, "decimals", 18);
        tokenSymbol = await safeTokenCall(token1Contract, "symbol", "Token1");
        log(`✅ Using Token1 (${tokenSymbol}) with ${decimals} decimals`);
        console.log(`Token1: ${tokenSymbol}, decimals: ${decimals}`);
      }
    } catch (tokenError) {
      log(`❌ Error getting token contract: ${tokenError.message}`);
      console.error("Token contract error:", tokenError);
      throw tokenError;
    }

    // Convert makerContributionAmount (which is a string in wei) to BigInt
    console.log("Converting amount:", makerContributionAmount, "to BigInt");
    const amountIn = BigInt(makerContributionAmount);
    const amountInFormatted = ethers.formatUnits(amountIn, decimals);
    gameState.swapAmount = amountInFormatted;
    
    log(`📊 Joining game details:`);
    log(`   Required amount: ${amountInFormatted} ${tokenSymbol}`);
    log(`   Direction: ${oppositeDirection}`);
    log(`   Your move: ${gameState.move === 0 ? "Rock" : gameState.move === 1 ? "Paper" : "Scissors"}`);
    console.log("Amount details:", {
      raw: makerContributionAmount,
      bigInt: amountIn.toString(),
      formatted: amountInFormatted,
      decimals
    });
    
    // Check balance
    log("💰 Checking balance...");
    const userAddress = await signer.getAddress();
    console.log("User address:", userAddress);
    console.log("Token contract address:", tokenContract.target || tokenContract.address);
    
    try {
      const balance = await tokenContract.balanceOf(userAddress);
      console.log("Balance (raw):", balance.toString());
      const balanceFormatted = ethers.formatUnits(balance, decimals);
      console.log("Balance (formatted):", balanceFormatted);
      
      if (balance < amountIn) {
        const errorMsg = `❌ Insufficient balance. You need ${amountInFormatted} ${tokenSymbol}, but you have ${balanceFormatted}`;
        log(errorMsg);
        console.error(errorMsg);
        
        // Show error message in the game card
        const gameIdForMsg = `game-${commitmentHash.slice(2, 10)}`;
        const gameCard = document.getElementById(gameIdForMsg);
        if (gameCard) {
          let errorMsgDiv = document.getElementById(`${gameIdForMsg}-error-msg`);
          if (!errorMsgDiv) {
            errorMsgDiv = document.createElement("div");
            errorMsgDiv.id = `${gameIdForMsg}-error-msg`;
            errorMsgDiv.className = "mt-3";
            if (joinBtn && joinBtn.parentNode) {
              joinBtn.parentNode.insertBefore(errorMsgDiv, joinBtn);
            } else {
              gameCard.appendChild(errorMsgDiv);
            }
          }
          errorMsgDiv.innerHTML = `
            <div class="bg-red-50 border-2 border-red-400 rounded-lg p-3">
              <div class="flex items-start gap-2">
                <span class="text-xl">❌</span>
                <div class="flex-1">
                  <p class="font-semibold text-red-900 text-xs mb-1">Insufficient Balance</p>
                  <p class="text-xs text-red-800">
                    You need <strong>${amountInFormatted} ${tokenSymbol}</strong>, but you only have <strong>${balanceFormatted} ${tokenSymbol}</strong>.
                  </p>
                  <p class="text-xs text-red-800 mt-1">
                    Please get more ${tokenSymbol} tokens to join this game.
                  </p>
                </div>
              </div>
            </div>
          `;
        }
        
        if (joinBtn) {
          joinBtn.disabled = false;
          joinBtn.innerHTML = "❌ Insufficient Balance";
          joinBtn.classList.remove("bg-gradient-to-r", "from-purple-600", "to-indigo-600", "text-white");
          joinBtn.classList.add("bg-red-300", "text-red-700", "cursor-not-allowed");
        }
        return;
      }
      log(`✅ Balance check passed: ${balanceFormatted} ${tokenSymbol}`);
    } catch (balanceError) {
      log(`❌ Error checking balance: ${balanceError.message}`);
      console.error("Balance check error:", balanceError);
      if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.innerHTML = originalJoinBtnText || "🎮 Join This Game";
      }
      throw balanceError;
    }
    
    // Check allowance
    log("🔓 Checking token approval...");
    console.log("ROUTER_ADDRESS:", ROUTER_ADDRESS);
    try {
      const allowance = await safeTokenCallWithParam(tokenContract, "allowance", [userAddress, ROUTER_ADDRESS], 0n);
      console.log("Allowance (raw):", allowance.toString());
      const allowanceFormatted = ethers.formatUnits(allowance, decimals);
      console.log("Allowance (formatted):", allowanceFormatted);
      
      // Convert both to BigInt for proper comparison
      const allowanceBigInt = BigInt(allowance.toString());
      const amountInBigInt = BigInt(amountIn.toString());
      console.log("Comparison:", {
        allowance: allowanceBigInt.toString(),
        amountIn: amountInBigInt.toString(),
        allowanceLessThan: allowanceBigInt < amountInBigInt
      });
      
      if (allowanceBigInt < amountInBigInt) {
        log(`⚠️ Token approval needed for ${tokenSymbol}`);
        log(`   Required: ${amountInFormatted} ${tokenSymbol}`);
        log(`   Current allowance: ${allowanceFormatted} ${tokenSymbol}`);
        log(`   Please approve ${tokenSymbol} for the router, then try again.`);
        console.log("Approval needed - showing approval message");
        
        // Show a clear message to Player 2 about needing approval
        // Add message to the specific game card
        const gameIdForMsg = `game-${commitmentHash.slice(2, 10)}`;
        const gameCard = document.getElementById(gameIdForMsg);
        if (gameCard) {
          // Find or create a message div within this game card
          let approvalMsgDiv = document.getElementById(`${gameIdForMsg}-approval-msg`);
          if (!approvalMsgDiv) {
            approvalMsgDiv = document.createElement("div");
            approvalMsgDiv.id = `${gameIdForMsg}-approval-msg`;
            approvalMsgDiv.className = "mt-3";
            // Insert before the join button
            if (joinBtn && joinBtn.parentNode) {
              joinBtn.parentNode.insertBefore(approvalMsgDiv, joinBtn);
            } else {
              gameCard.appendChild(approvalMsgDiv);
            }
          }
          approvalMsgDiv.innerHTML = `
            <div class="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-3">
              <div class="flex items-start gap-2">
                <span class="text-xl">⚠️</span>
                <div class="flex-1">
                  <p class="font-semibold text-yellow-900 text-xs mb-1">Token Approval Required</p>
                  <p class="text-xs text-yellow-800 mb-1">
                    Approve <strong>${tokenSymbol}</strong> first. Amount needed: ${amountInFormatted} ${tokenSymbol}
                  </p>
                  <p class="text-xs text-yellow-800">
                    Click the <strong>"🔓 Approve Token"</strong> button below to approve.
                  </p>
                </div>
              </div>
            </div>
          `;
        }
        
        // Change button to "Approve" button
        if (joinBtn) {
          // Update the button's click handler to call approve function
          // Remove existing listeners by cloning
          const newBtn = joinBtn.cloneNode(true);
          joinBtn.parentNode.replaceChild(newBtn, joinBtn);
          
          // Update button appearance and functionality
          newBtn.disabled = false;
          newBtn.innerHTML = "🔓 Approve Token";
          newBtn.classList.remove("bg-gradient-to-r", "from-purple-600", "to-indigo-600", "text-white");
          newBtn.classList.add("bg-gradient-to-r", "from-yellow-600", "to-orange-600", "text-white");
          newBtn.classList.remove("opacity-75", "cursor-not-allowed");
          
          // Add click event listener for approval
          newBtn.addEventListener('click', async function() {
            if (!this.disabled) {
              await approveTokenForTaker(tokenContract, tokenSymbol, commitmentHash, oppositeDirection, makerContributionAmount);
            }
          });
        }
        log(`⏸️ Please approve ${tokenSymbol} by clicking the "Approve Token" button.`);
        return;
      }
      log(`✅ Approval check passed: ${allowanceFormatted} ${tokenSymbol} approved`);
      
      // Clear any approval messages since we have approval now
      const gameIdForMsg = `game-${commitmentHash.slice(2, 10)}`;
      const approvalMsgDiv = document.getElementById(`${gameIdForMsg}-approval-msg`);
      if (approvalMsgDiv) {
        approvalMsgDiv.remove();
      }
    } catch (allowanceError) {
      log(`❌ Error checking allowance: ${allowanceError.message}`);
      console.error("Allowance check error:", allowanceError);
      if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.innerHTML = originalJoinBtnText || "🎮 Join This Game";
      }
      throw allowanceError;
    }

    const amountOutMin = 0;
    const receiver = await signer.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    log(`🚀 Starting join process for game ${commitmentHash.slice(0, 10)}...`);
    log(`   Swap: ${amountInFormatted} ${tokenSymbol}`);
    log(`   Direction: ${oppositeDirection}`);
    log(`   Move: ${gameState.move === 0 ? "Rock" : gameState.move === 1 ? "Paper" : "Scissors"}`);

    // Disable the join button to prevent double-clicking
    if (joinBtn) {
      joinBtn.disabled = true;
      joinBtn.innerHTML = "⏳ Joining...";
      joinBtn.classList.remove("opacity-75", "cursor-not-allowed");
    }

    // First, make the swap (this will add contribution to the pool)
    log("Executing swap to add contribution...");
    console.log("Swap parameters:", {
      amountIn: amountIn.toString(),
      amountOutMin: amountOutMin.toString(),
      zeroForOne,
      poolKey,
      commitmentHash: ethers.ZeroHash,
      receiver,
      deadline
    });
    
    if (!routerContract) {
      throw new Error("Router contract not initialized");
    }
    
    const swapTx = await routerContract.swapExactTokensForTokensWithCommitment(
      amountIn,
      amountOutMin,
      zeroForOne,
      poolKey,
      ethers.ZeroHash, // No commitment for player 2
      "0x",
      receiver,
      deadline,
      { value: 0 }
    );

    log(`Swap transaction sent: ${swapTx.hash}`);
    const swapReceipt = await swapTx.wait();
    log(`✅ Swap confirmed in block ${swapReceipt.blockNumber}`);

    // Get the actual contribution amount after fees
    log("Querying actual contribution amount from hook...");
    if (!hookContract) {
      throw new Error("Hook contract not initialized");
    }
    
    // Get pending swap details to get poolId and currency
    const pendingSwap = await hookContract.getPendingSwap(commitmentHash);
    console.log("Pending swap details:", pendingSwap);
    
    // Player 2's contribution currency is determined by the swap direction
    // When swapping token0->token1 (zeroForOne=true), contribution is in token1 (output currency)
    // When swapping token1->token0 (zeroForOne=false), contribution is in token0 (output currency)
    // So Player 2's contribution currency is the output currency of their swap
    const player2ContributionCurrency = zeroForOne ? TOKEN1_ADDRESS : TOKEN0_ADDRESS;
    
    // Handle poolId - it might be a string or bytes32
    let poolIdValue;
    if (typeof pendingSwap.poolId === 'string') {
      poolIdValue = pendingSwap.poolId;
    } else if (pendingSwap.poolId && typeof pendingSwap.poolId === 'object') {
      poolIdValue = pendingSwap.poolId;
    } else {
      poolIdValue = pendingSwap.poolId;
    }
    
    console.log("Player 2 contribution currency:", player2ContributionCurrency);
    console.log("PoolId:", poolIdValue);
    console.log("User address:", userAddress);
    
    // Poll for the contribution with retries (it might take a moment to be recorded)
    let actualContribution = 0n;
    const maxRetries = 10;
    const retryDelay = 500; // 500ms between retries
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Try using the public mapping first (contributionsByAddress is a public mapping)
        try {
          actualContribution = await hookContract.contributionsByAddress(
            userAddress,
            poolIdValue,
            player2ContributionCurrency
          );
        } catch (mappingError) {
          // Fall back to getter function if mapping access doesn't work
          actualContribution = await hookContract.getContributionByAddress(
            userAddress,
            poolIdValue,
            player2ContributionCurrency
          );
        }
        
        console.log(`Attempt ${i + 1}: Contribution amount:`, actualContribution.toString());
        
        if (actualContribution > 0n) {
          log(`✅ Actual contribution found: ${ethers.formatUnits(actualContribution, decimals)} ${tokenSymbol}`);
          break;
        }
        
        if (i < maxRetries - 1) {
          log(`⏳ Contribution not yet recorded, waiting ${retryDelay}ms... (attempt ${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      } catch (contributionError) {
        log(`⚠️ Error querying contribution (attempt ${i + 1}): ${contributionError.message}`);
        console.error("Contribution query error:", contributionError);
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    if (actualContribution === 0n) {
      log(`❌ Could not find contribution after ${maxRetries} attempts`);
      log(`⚠️ Using swap amountIn as fallback: ${amountInFormatted} ${tokenSymbol}`);
      log(`⚠️ This may fail if the actual contribution is less than amountIn due to fees`);
      actualContribution = amountIn;
    }

    // Then call player2PostMove to register the move and link to the game
    log("Registering move with hook...");
    console.log("Calling player2PostMove with:", {
      commitmentHash,
      move: gameState.move,
      actualContribution: actualContribution.toString(),
      originalAmountIn: amountIn.toString()
    });
    
    const postMoveTx = await hookContract.player2PostMove(
      commitmentHash,
      gameState.move,
      actualContribution
    );
    log(`PostMove transaction sent: ${postMoveTx.hash}`);
    const postMoveReceipt = await postMoveTx.wait();
    log(`✅ Move registered in block ${postMoveReceipt.blockNumber}`);

    // The hook should automatically call joinGame() when player2PostMove() is called
    // Get the gameId from the hook and set it in gameState
    if (rpsContract && hookContract) {
      try {
        const gameId = await hookContract.getGameId(commitmentHash);
        if (gameId && gameId.toString() !== "0") {
          gameState.gameId = gameId.toString();
          log(`✅ Found gameId ${gameId} for commitment, hook should have already called joinGame()`);
          
          // Save to localStorage for tracking
          saveTakerGame(commitmentHash, gameId, gameState.swapAmount, gameState.swapDirection);
          
          // Verify the game status to confirm joinGame was called
          try {
            const game = await rpsContract.getGame(gameId);
            const isArray = Array.isArray(game) || (typeof game === "object" && game.length !== undefined);
            const status = isArray ? game[3] : game.status;
            const player2 = isArray ? game[2] : game.player2;
            const statusNum = Number(status);
            
            if (statusNum === 2 && player2 !== ethers.ZeroAddress) {
              log(`✅ Verified: Game ${gameId} status is 'Revealed' - Player 2 successfully joined!`);
            } else {
              log(`⚠️ Game ${gameId} status is ${statusNum}, player2: ${player2}`);
            }
          } catch (verifyError) {
            log(`⚠️ Could not verify game status: ${verifyError.message}`);
          }
        } else {
          log("⚠️ GameId not linked in hook - hook may not be configured with RockPaperScissors");
          log("💡 The swap was successful, but the game may not be linked to RockPaperScissors contract");
          // Still save to localStorage even without gameId
          saveTakerGame(commitmentHash, null, gameState.swapAmount, gameState.swapDirection);
        }
      } catch (error) {
        log(`⚠️ Could not get gameId from hook: ${error.message}`);
      }
    }

    log(`🎉 Successfully joined game!`);

    // Re-enable button with success state
    if (joinBtn) {
      joinBtn.disabled = true;
      joinBtn.innerHTML = "✅ Joined!";
      joinBtn.classList.remove("bg-gradient-to-r", "from-purple-600", "to-indigo-600");
      joinBtn.classList.add("bg-green-500");
    }

    // Refresh all taker game lists
    await loadAllTakerGames();
  } catch (error) {
    log(`❌ Error joining game: ${error.message}`);
    console.error("=== FULL ERROR DETAILS ===");
    console.error("Error message:", error.message);
    console.error("Error name:", error.name);
    console.error("Error stack:", error.stack);
    console.error("Full error object:", error);
    
    if (error.data) {
      log(`Error data: ${error.data}`);
      console.error("Error data:", error.data);
    }
    if (error.reason) {
      log(`Error reason: ${error.reason}`);
      console.error("Error reason:", error.reason);
    }
    if (error.code) {
      log(`Error code: ${error.code}`);
      console.error("Error code:", error.code);
    }
    if (error.transaction) {
      console.error("Error transaction:", error.transaction);
    }
    if (error.transactionHash) {
      console.error("Error transaction hash:", error.transactionHash);
    }
    
    // Re-enable button on error
    const errorGameId = `game-${commitmentHash.slice(2, 10)}`;
    const errorJoinBtn = document.getElementById(`${errorGameId}-join-btn`);
    if (errorJoinBtn) {
      errorJoinBtn.disabled = false;
      errorJoinBtn.innerHTML = originalJoinBtnText || "🎮 Join This Game";
    }
  }
};

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

    console.log("Proof structure:", proof);
    console.log("Proof type:", typeof proof);
    console.log("Proof keys:", Object.keys(proof || {}));
    throw new Error("Could not serialize proof - unknown format");
  } catch (error) {
    console.error("Error serializing proof:", error);
    throw error;
  }
}

// Reveal move (Maker) with ZK proof
async function revealMakerMove(gameId, commitmentHash) {
  if (!signer || !rpsContract || !noir || !backend) {
    log("❌ Contracts or Noir not initialized");
    return;
  }

  // Set game state for this specific game
  const originalGameId = gameState.gameId;
  const originalCommitmentHash = gameState.commitmentHash;
  const originalRole = gameState.role;
  
  try {
    gameState.gameId = gameId;
    gameState.commitmentHash = commitmentHash;
    gameState.role = "maker";
    
    // Get the game data to find the salt and move
    const trackedGames = getMakerGames();
    const gameData = trackedGames[commitmentHash] || trackedGames[gameId];
    
    if (!gameData) {
      log("❌ Game data not found. Cannot reveal without salt.");
      return;
    }
    
    // Get salt and move from localStorage (stored when game was created)
    const salt = gameData.salt || gameState.salt;
    const move = gameData.move !== null && gameData.move !== undefined ? gameData.move : gameState.move;
    
    if (!salt) {
      log("❌ Salt not found. Cannot reveal this game.");
      log("💡 Salt should have been stored when the game was created.");
      return;
    }
    
    if (move === null || move === undefined) {
      log("❌ Move not found. Cannot reveal this game.");
      return;
    }

    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) {
      log("❌ Please switch to the correct network");
      return;
    }

    log("Getting game state from RockPaperScissors contract...");
    const game = await rpsContract.getGame(gameId);

    // Check if it's an array or object
    const isArray = Array.isArray(game) || (typeof game === "object" && game.length !== undefined);

    // Safely access fields
    let taker, takerMove, revealDeadlineBigInt;
    if (isArray && game.length > 10) {
      taker = game[2]; // player2
      takerMove = game[6]; // player2Move
      revealDeadlineBigInt = game[10];
    } else {
      taker = game.player2;
      takerMove = game.player2Move;
      revealDeadlineBigInt = game.revealDeadline;
    }

    // Check that Taker has joined
    if (taker === ethers.ZeroAddress || takerMove === 255) {
      log("⏳ Waiting for taker to join...");
      return;
    }

    const deadline = typeof revealDeadlineBigInt === "bigint"
      ? Number(revealDeadlineBigInt)
      : Number(revealDeadlineBigInt.toString());

    const now = Math.floor(Date.now() / 1000);
    if (deadline > 0 && now > deadline) {
      log(`❌ Deadline has passed. (deadline: ${deadline}, now: ${now})`);
      return;
    }

    const makerMove = Number(move);
    const takerMoveNum = Number(takerMove);

    // Validate moves
    if (makerMove < 0 || makerMove > 2 || takerMoveNum < 0 || takerMoveNum > 2) {
      log(`❌ Invalid moves: makerMove=${makerMove}, takerMove=${takerMoveNum}`);
      throw new Error(`Invalid moves: makerMove=${makerMove}, takerMove=${takerMoveNum}`);
    }

    log(`✅ Maker's move: ${makerMove === 0 ? "Rock" : makerMove === 1 ? "Paper" : "Scissors"}`);
    log(`✅ Taker's move: ${takerMoveNum === 0 ? "Rock" : takerMoveNum === 1 ? "Paper" : "Scissors"}`);
    log("Generating ZK proof... ⏳");

    const winner = determineWinnerLocal(makerMove, takerMoveNum);
    log(`Expected winner: ${winner === 0 ? "Tie" : winner === 1 ? "Maker" : "Taker"}`);

    // Generate proof - Noir expects Field values
    const inputs = {
      player1_move: makerMove,
      player2_move: takerMoveNum,
      winner: winner,
    };

    log(`Calling noir.execute with inputs: player1_move=${makerMove}, player2_move=${takerMoveNum}, winner=${winner}`);

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
      // Use keccak hash function to match the verifier
      proof = await backend.generateProof(witness, { keccak: true });
      log("✅ Proof generated successfully with Keccak256 hash");
    } catch (proofError) {
      log(`❌ Proof generation failed: ${proofError.message}`);
      throw new Error(`Proof generation failed: ${proofError.message}`);
    }

    // Verify proof locally
    const isValid = await backend.verifyProof(proof, { keccak: true });
    if (!isValid) {
      throw new Error("Proof verification failed locally");
    }

    log("✅ Proof generated and verified!");

    // Serialize proof
    let proofBytes;
    try {
      if (proof.proof && proof.proof instanceof Uint8Array) {
        proofBytes = ethers.hexlify(proof.proof);
        log("✅ Proof serialized from proof.proof (Uint8Array)");
      } else if (backend.serializeProof) {
        proofBytes = await backend.serializeProof(proof);
        log("✅ Proof serialized using backend.serializeProof()");
      } else {
        proofBytes = await serializeProof(proof);
        log("✅ Proof serialized using custom method");
      }

      const proofLength = typeof proofBytes === "string"
        ? (proofBytes.length - 2) / 2
        : proofBytes.length;
      log(`📏 Proof length: ${proofLength} bytes`);
    } catch (serializeError) {
      log(`❌ Proof serialization failed: ${serializeError.message}`);
      throw serializeError;
    }

    // Resolve game on RockPaperScissors contract with ZK proof
    log(`Resolving game ${gameId} on RockPaperScissors contract...`);

    try {
      const gasEstimate = await rpsContract.resolveGame.estimateGas(
        gameId,
        makerMove,
        salt,
        proofBytes
      );
      log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

      const tx = await rpsContract.resolveGame(
        gameId,
        makerMove,
        salt,
        proofBytes,
        { gasLimit: gasEstimate * BigInt(2) }
      );

      log(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();
      log(`✅ Game resolved! Transaction confirmed in block ${receipt.blockNumber}`);
      log(`🎉 Winner: ${winner === 0 ? "Tie" : winner === 1 ? "Maker" : "Taker"}`);

      // Refresh maker's games list
      await loadMakerGames();
    } catch (txError) {
      log(`❌ Transaction failed: ${txError.message}`);
      if (txError.data) {
        log(`📋 Error data: ${txError.data}`);
      }
      if (txError.reason) {
        log(`📋 Error reason: ${txError.reason}`);
      }
      throw txError;
    }
  } catch (error) {
    log(`❌ Error revealing move: ${error.message}`);
    console.error("Full error:", error);
  } finally {
      // Restore original game state
      gameState.gameId = originalGameId;
      gameState.commitmentHash = originalCommitmentHash;
      gameState.role = originalRole;
    }
  }

// Make revealMakerMove available globally for onclick handlers
window.revealMakerMove = revealMakerMove;

// Update game status display
async function updateGameStatus() {
  const statusDiv = document.getElementById("gameResolutionStatus");
  if (!statusDiv) {
    return;
  }

  // If no game, show default message
  if (!gameState.gameId && !gameState.commitmentHash) {
    statusDiv.innerHTML = `
      <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
        <p class="text-sm text-gray-600 text-center">
          No active game. Create or join a game to see status here.
        </p>
      </div>
    `;
    return;
  }

  try {
    let statusText = "Waiting";
    let statusColor = "yellow";
    let details = "";
    let game = null;

    // Try to get gameId from hook if we don't have it but have commitmentHash
    if (!gameState.gameId && hookContract && gameState.commitmentHash) {
      try {
        const gameId = await hookContract.getGameId(gameState.commitmentHash);
        if (gameId && gameId.toString() !== "0") {
          gameState.gameId = gameId.toString();
          log(`✅ Retrieved gameId ${gameId} from hook for commitment ${gameState.commitmentHash.slice(0, 10)}...`);
        }
      } catch (error) {
        // Silently fail - we'll fall back to hook status
      }
    }

    // Try to get status from RockPaperScissors contract if we have gameId
    if (gameState.gameId && rpsContract) {
      try {
        game = await rpsContract.getGame(gameState.gameId);
        const isArray = Array.isArray(game) || (typeof game === "object" && game.length !== undefined);
        const status = isArray ? game[3] : game.status;
        const statusNum = Number(status);

        switch (statusNum) {
          case 0: // WaitingForPlayer
            statusText = "Waiting for Player 2";
            statusColor = "yellow";
            details = "Waiting for Player 2 to join with opposite swap.";
            break;
          case 1: // Committed
            statusText = "Committed";
            statusColor = "blue";
            details = "Player 1 committed move. Waiting for Player 2...";
            break;
          case 2: // Revealed (Player 2 joined, waiting for reveal)
            statusText = "Waiting for Reveal";
            statusColor = "orange";
            details = "Player 2 has joined. Player 1 must reveal their move.";
            break;
          case 3: // Completed
            statusText = "Completed";
            statusColor = "green";
            const winner = isArray ? game[7] : game.winner;
            const winnerNum = Number(winner);
            if (winnerNum === 0) {
              details = "Game completed: It's a tie! 🤝";
            } else if (winnerNum === gameState.playerNumber) {
              details = "Game completed: You won! 🎉";
            } else {
              details = "Game completed: You lost. 😔";
            }
            break;
        }
      } catch (rpsError) {
        log(`⚠️ Error reading from RPS contract: ${rpsError.message}`);
      }
    }

    // Fallback to hook status if RPS contract read failed
    if (!game && hookContract && gameState.commitmentHash) {
      try {
        const swap = await hookContract.getPendingSwap(gameState.commitmentHash);
        if (swap.resolved) {
          statusText = "Resolved";
          statusColor = "green";
          details = "Game has been resolved.";
        } else if (swap.revealed) {
          statusText = "Revealed";
          statusColor = "blue";
          details = "Player 1 has revealed their move.";
        } else if (swap.player2Moved) {
          statusText = "Waiting for Reveal";
          statusColor = "orange";
          details = "Player 2 has joined. Player 1 must reveal their move.";
        } else {
          statusText = "Waiting for Player 2";
          statusColor = "yellow";
          details = "Waiting for Player 2 to join with opposite swap.";
        }
      } catch (hookError) {
        log(`⚠️ Error reading from hook: ${hookError.message}`);
      }
    }

    const borderColorClass = {
      yellow: "border-yellow-200",
      blue: "border-blue-200",
      orange: "border-orange-200",
      green: "border-green-200",
    }[statusColor] || "border-gray-200";

    const gameIdDisplay = gameState.gameId 
      ? `Game ID: <span class="font-mono text-purple-600">${gameState.gameId}</span>`
      : `Commitment: <span class="font-mono text-purple-600 text-xs">${gameState.commitmentHash?.slice(0, 10)}...${gameState.commitmentHash?.slice(-8)}</span>`;

    statusDiv.innerHTML = `
      <div class="bg-white rounded-xl p-4 border-2 ${borderColorClass} slide-up">
        <div class="flex flex-wrap items-center gap-3 mb-2">
          <span class="status-badge status-${statusText.toLowerCase().replace(" ", "-")}">${statusText}</span>
          <span class="text-gray-600 font-semibold text-sm">${gameIdDisplay}</span>
        </div>
        <p class="text-gray-700 font-medium text-sm">${details}</p>
        <p class="text-gray-600 text-xs mt-2">
          👤 You are <span class="font-semibold text-purple-600">Player ${gameState.playerNumber}</span>
        </p>
      </div>
    `;

    // Show reveal button if Player 1 and Player 2 has joined
    if (gameState.playerNumber === 1 && game && rpsContract) {
      const isArray = Array.isArray(game) || (typeof game === "object" && game.length !== undefined);
      const status = isArray ? game[3] : game.status;
      const player2 = isArray ? game[2] : game.player2;
      const statusNum = Number(status);
      
      if (statusNum === 2 && player2 !== ethers.ZeroAddress && !gameState.isRevealed) {
        const revealStatusDiv = document.getElementById("revealStatus");
        if (revealStatusDiv) {
          revealStatusDiv.innerHTML = `
            <button
              id="revealBtn"
              class="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold rounded-xl hover:from-green-700 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              🔓 Reveal Move
            </button>
          `;
          // Remove old listener and add new one
          const oldBtn = document.getElementById("revealBtn");
          if (oldBtn) {
            const newBtn = oldBtn.cloneNode(true);
            oldBtn.parentNode.replaceChild(newBtn, oldBtn);
            newBtn.addEventListener("click", revealMove);
          }
        }
      }
    }
  } catch (error) {
    log(`⚠️ Error updating game status: ${error.message}`);
  }
}

// Update step checkmarks
function updateStepCheckmarks() {
  const step1Checkmark = document.getElementById("step1Checkmark");
  if (step1Checkmark) {
    step1Checkmark.classList.toggle("hidden", !signer);
  }

  const step2Checkmark = document.getElementById("step2Checkmark");
  if (step2Checkmark) {
    step2Checkmark.classList.toggle("hidden", gameState.move === null);
  }

  const step3Checkmark = document.getElementById("step3Checkmark");
  if (step3Checkmark) {
    step3Checkmark.classList.toggle("hidden", !gameState.isCommitted || gameState.playerNumber !== 1);
  }

  const step4Checkmark = document.getElementById("step4Checkmark");
  if (step4Checkmark) {
    step4Checkmark.classList.toggle("hidden", gameState.playerNumber !== 2);
  }

  const step5Checkmark = document.getElementById("step5Checkmark");
  if (step5Checkmark) {
    step5Checkmark.classList.toggle("hidden", !gameState.isRevealed);
  }
}

// Switch between Maker and Taker views
function switchView(view) {
  currentView = view;
  const makerView = document.getElementById("makerView");
  const takerView = document.getElementById("takerView");
  const makerTabBtn = document.getElementById("makerTabBtn");
  const takerTabBtn = document.getElementById("takerTabBtn");

  if (view === "maker") {
    // Stop timer when switching away from taker view
    stopActiveGamesTimer();
    makerView?.classList.remove("hidden");
    takerView?.classList.add("hidden");
    makerTabBtn?.classList.remove("bg-gray-200", "text-gray-700");
    makerTabBtn?.classList.add("bg-gradient-to-r", "from-blue-600", "to-indigo-600", "text-white", "shadow-lg");
    takerTabBtn?.classList.remove("bg-gradient-to-r", "from-blue-600", "to-indigo-600", "text-white", "shadow-lg");
    takerTabBtn?.classList.add("bg-gray-200", "text-gray-700");
    // Load maker's games when switching to maker view
    if (signer) {
      loadMakerGamesWithFeedback();
    }
  } else {
    makerView?.classList.add("hidden");
    takerView?.classList.remove("hidden");
    takerTabBtn?.classList.remove("bg-gray-200", "text-gray-700");
    takerTabBtn?.classList.add("bg-gradient-to-r", "from-blue-600", "to-indigo-600", "text-white", "shadow-lg");
    makerTabBtn?.classList.remove("bg-gradient-to-r", "from-blue-600", "to-indigo-600", "text-white", "shadow-lg");
    makerTabBtn?.classList.add("bg-gray-200", "text-gray-700");
    // Load taker's games when switching to taker view
    // Timer will be started by loadActiveGames()
    if (signer) {
      loadAllTakerGames();
    }
  }
}

// Setup event listeners when DOM is ready
function setupEventListeners() {
  console.log("Setting up event listeners...");
  
  // Tab switching
  const makerTabBtn = document.getElementById("makerTabBtn");
  const takerTabBtn = document.getElementById("takerTabBtn");
  if (makerTabBtn) {
    makerTabBtn.addEventListener("click", () => switchView("maker"));
  }
  if (takerTabBtn) {
    takerTabBtn.addEventListener("click", () => switchView("taker"));
  }
  
  const connectBtn = document.getElementById("connectBtn");
  if (connectBtn) {
    connectBtn.addEventListener("click", connectWallet);
    console.log("✅ Connect button listener added");
  } else {
    console.error("❌ Connect button not found");
  }

  // Maker view buttons
  const makerApproveBtn = document.getElementById("makerApproveTokenBtn");
  if (makerApproveBtn) {
    makerApproveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Maker approve button clicked!");
      approveToken("maker").catch(error => {
        console.error("Error in approveToken:", error);
        log(`❌ Unexpected error: ${error.message}`);
      });
    });
    console.log("✅ Maker approve button listener added");
  } else {
    console.error("❌ Maker approve button not found in DOM");
  }

  const makerCreateBtn = document.getElementById("makerCreateGameBtn");
  if (makerCreateBtn) {
    makerCreateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Maker create game button clicked!");
      console.log("Button disabled state:", makerCreateBtn.disabled);
      
      // Check if button is disabled
      if (makerCreateBtn.disabled) {
        console.warn("Button is disabled, cannot create game");
        log("⚠️ Button is disabled. Please select a move and enter an amount first.");
        return;
      }
      
      createMakerGame().catch(error => {
        console.error("Error in createMakerGame:", error);
        log(`❌ Unexpected error: ${error.message}`);
      });
    });
    console.log("✅ Maker create button listener added");
  } else {
    console.error("❌ Maker create button not found in DOM");
  }

  const makerRefreshBtn = document.getElementById("makerRefreshBtn");
  if (makerRefreshBtn) {
    makerRefreshBtn.addEventListener("click", loadMakerGames);
    console.log("✅ Maker refresh button listener added");
  }

  const makerRockBtn = document.getElementById("makerRockBtn");
  if (makerRockBtn) {
    makerRockBtn.addEventListener("click", () => {
      console.log("Maker rock button clicked!");
      selectMakerMove(0);
    });
  }

  const makerPaperBtn = document.getElementById("makerPaperBtn");
  if (makerPaperBtn) {
    makerPaperBtn.addEventListener("click", () => {
      console.log("Maker paper button clicked!");
      selectMakerMove(1);
    });
  }

  const makerScissorsBtn = document.getElementById("makerScissorsBtn");
  if (makerScissorsBtn) {
    makerScissorsBtn.addEventListener("click", () => {
      console.log("Maker scissors button clicked!");
      selectMakerMove(2);
    });
  }

  // Taker view buttons
  const takerRefreshBtn = document.getElementById("takerRefreshBtn");
  if (takerRefreshBtn) {
    takerRefreshBtn.addEventListener("click", loadAllTakerGames);
    console.log("✅ Taker refresh button listener added");
  }

  // Update on swap direction/amount change (maker view)
  const makerSwapDirection = document.getElementById("makerSwapDirection");
  if (makerSwapDirection) {
    makerSwapDirection.addEventListener("change", async () => {
      await updateMakerTokenBalance();
      await checkMakerApproval();
      updateMakerButtonStates();
    });
    console.log("✅ Maker swap direction listener added");
  } else {
    console.error("❌ Maker swap direction element not found");
  }

  const makerSwapAmount = document.getElementById("makerSwapAmount");
  if (makerSwapAmount) {
    makerSwapAmount.addEventListener("input", async () => {
      await checkMakerApproval();
      updateMakerButtonStates();
    });
    makerSwapAmount.addEventListener("change", async () => {
      updateMakerButtonStates();
    });
    console.log("✅ Maker swap amount listener added");
  } else {
    console.error("❌ Maker swap amount element not found");
  }
  
  // Initial button state update
  updateMakerButtonStates();
}

// Listen for network changes
if (typeof window.ethereum !== "undefined") {
  window.ethereum.on("chainChanged", async (chainId) => {
    log(`🔄 Network changed to Chain ID: ${parseInt(chainId, 16)}`);
    if (provider) {
      provider = new ethers.BrowserProvider(window.ethereum);
      if (signer) {
        signer = await provider.getSigner();
        await initializeContracts();
      }
    }
  });
}

// Initialize on load
async function init() {
  try {
    // Setup event listeners first
    setupEventListeners();
    
    await loadDeployments();
    await initNoir();
    log("🚀 Swap RPS application ready!");
  } catch (error) {
    log(`Failed to initialize: ${error.message}`);
    console.error("Initialization error:", error);
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
