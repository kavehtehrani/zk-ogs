import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { ethers } from "ethers";

// Circuit will be loaded dynamically
let circuit = null;

// Game state
let gameState = {
  gameId: null, // Game ID from DegenRPS contract
  role: null, // "maker" or "taker"
  move: null,
  salt: null,
  commitment: null,
};

// Current view: "maker" or "taker"
let currentView = "maker";

// Interval for real-time timeout updates
let activeGamesUpdateInterval = null;
let activeGamesData = []; // Store game data for real-time updates
let selectedMovesByGame = {}; // Track which games have moves selected: { gameId: move }
let autoRefreshInterval = null; // Auto-refresh games list interval

let noir = null;
let backend = null;
let provider = null;
let signer = null;

// Contract instances
let rpsContract = null; // DegenRPS contract
let token0Contract = null;
let token1Contract = null;

// Contract addresses and ABIs - will be loaded from deployments.json
let RPS_ADDRESS = null; // DegenRPS contract address
let TOKEN0_ADDRESS = null;
let TOKEN1_ADDRESS = null;

// Network configuration
let DEPLOYED_CHAIN_ID = null;
let DEPLOYED_RPC_URL = null;

// Deployments data (loaded from deployments.json)
let deployments = null;

// ERC20 ABI (will be loaded from deployments or use fallback)
let erc20ABI = null;

// Helper function to format time ago
function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return `${seconds} second${seconds !== 1 ? "s" : ""} ago`;
}

// Load contract ABIs and addresses from deployments.json
async function loadDeployments() {
  try {
    log("Loading deployments.json...");
    const deploymentsResponse = await fetch("/deployments.json");
    if (!deploymentsResponse.ok) {
      throw new Error(
        `Failed to load deployments: ${deploymentsResponse.statusText}`
      );
    }
    // Check if response is actually JSON (not HTML error page)
    const contentType = deploymentsResponse.headers.get("content-type");
    const text = await deploymentsResponse.text();
    if (!contentType || !contentType.includes("application/json")) {
      if (
        text.trim().startsWith("<!DOCTYPE") ||
        text.trim().startsWith("<html")
      ) {
        throw new Error(
          "Received HTML instead of JSON. deployments.json may not exist or Vercel routing is misconfigured."
        );
      }
      throw new Error(`Expected JSON but got ${contentType}`);
    }
    deployments = JSON.parse(text);

    DEPLOYED_CHAIN_ID = deployments.chainId?.toString();
    DEPLOYED_RPC_URL = deployments.rpcUrl;

    if (deployments.contracts) {
      if (deployments.contracts.token0) {
        TOKEN0_ADDRESS = deployments.contracts.token0.address;
        log(`✅ Token0 address: ${TOKEN0_ADDRESS}`);
        // Update dropdown option
        const token0Option = document.getElementById("token0Option");
        if (token0Option) {
          token0Option.value = TOKEN0_ADDRESS;
          token0Option.textContent = `Token0 (${TOKEN0_ADDRESS.slice(
            0,
            6
          )}...${TOKEN0_ADDRESS.slice(-4)})`;
        }
      }
      if (deployments.contracts.token1) {
        TOKEN1_ADDRESS = deployments.contracts.token1.address;
        log(`✅ Token1 address: ${TOKEN1_ADDRESS}`);
        // Update dropdown option
        const token1Option = document.getElementById("token1Option");
        if (token1Option) {
          token1Option.value = TOKEN1_ADDRESS;
          token1Option.textContent = `Token1 (${TOKEN1_ADDRESS.slice(
            0,
            6
          )}...${TOKEN1_ADDRESS.slice(-4)})`;
        }
      }
      if (deployments.contracts.rockPaperScissors) {
        RPS_ADDRESS = deployments.contracts.rockPaperScissors.address;
        log(`✅ RockPaperScissors address: ${RPS_ADDRESS}`);
      }
      if (deployments.contracts.degenRPS) {
        log(`✅ DegenRPS address: ${deployments.contracts.degenRPS.address}`);
      }
    } else {
      log("⚠️ No contracts found in deployments.json");
    }

    log("✅ Deployments loaded");
    await updateContractAddressDisplay();
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
    // Check if response is actually JSON (not HTML error page)
    const contentType = circuitResponse.headers.get("content-type");
    const text = await circuitResponse.text();
    if (!contentType || !contentType.includes("application/json")) {
      if (
        text.trim().startsWith("<!DOCTYPE") ||
        text.trim().startsWith("<html")
      ) {
        throw new Error(
          "Received HTML instead of JSON. /target/circuit.json may not exist or Vercel routing is misconfigured."
        );
      }
      throw new Error(`Expected JSON but got ${contentType}`);
    }
    circuit = JSON.parse(text);

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
  const chainIdNum =
    typeof chainId === "string"
      ? chainId.startsWith("0x")
        ? parseInt(chainId, 16)
        : parseInt(chainId)
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

// Update contract address display
async function updateContractAddressDisplay() {
  const displayDiv = document.getElementById("contractAddressDisplay");
  if (!displayDiv) return;

  // Try to get address from contract instance first, then from deployments
  let contractAddress = rpsContract?.target || rpsContract?.address;

  // If contract not initialized yet, try to get from deployments
  if (!contractAddress && deployments?.contracts) {
    contractAddress =
      deployments.contracts.degenRPS?.address ||
      deployments.contracts.rockPaperScissors?.address ||
      RPS_ADDRESS;
  }

  if (contractAddress) {
    let networkName = "Unknown";

    // Try to get network from MetaMask first
    if (provider) {
      try {
        const network = await provider.getNetwork();
        networkName = getNetworkName(network.chainId.toString());
      } catch {
        // Fall back to deployments.json chainId
        if (DEPLOYED_CHAIN_ID) {
          networkName = getNetworkName(DEPLOYED_CHAIN_ID);
        }
      }
    } else if (DEPLOYED_CHAIN_ID) {
      // Use chainId from deployments.json if MetaMask not connected
      networkName = getNetworkName(DEPLOYED_CHAIN_ID);
    }

    displayDiv.innerHTML = `
      <p class="text-gray-600 text-xs flex flex-wrap items-center gap-2">
        <span class="font-semibold">Contract Address (${networkName}):</span>
        <span class="font-mono text-purple-600 break-all">${contractAddress}</span>
      </p>
    `;
  } else {
    displayDiv.innerHTML = `
      <p class="text-gray-500 text-xs">Contract address will be loaded automatically...</p>
    `;
  }
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
    const currentChainIdHex = await window.ethereum.request({
      method: "eth_chainId",
    });
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
      await new Promise((resolve) => setTimeout(resolve, 500));
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

  // Ensure deployments are loaded
  if (!deployments) {
    log("⚠️ Deployments not loaded, loading now...");
    await loadDeployments();
  }

  try {
    // Load DegenRPS address and ABI from deployments
    let DEGEN_RPS_ADDRESS = null;
    let degenRPSABI = null;

    if (
      deployments &&
      deployments.contracts &&
      deployments.contracts.degenRPS
    ) {
      DEGEN_RPS_ADDRESS = deployments.contracts.degenRPS.address;
      degenRPSABI = deployments.contracts.degenRPS.abi;
      log(`✅ DegenRPS address: ${DEGEN_RPS_ADDRESS}`);
      if (degenRPSABI && degenRPSABI.length > 0) {
        log(`✅ DegenRPS ABI loaded (${degenRPSABI.length} entries)`);
      } else {
        log(`⚠️ DegenRPS ABI not found in deployments.json, using fallback`);
        // Fallback to hardcoded ABI if not in deployments
        degenRPSABI = [
          "function createGame(address tokenAddress, uint256 betAmount, bytes32 commitment, bytes calldata proof) external returns (uint256)",
          "function joinGame(uint256 gameId, uint8 move) external",
          "function revealAndSettle(uint256 gameId, uint8 move, bytes32 salt, bytes calldata proof) external",
          "function withdraw(uint256 gameId) external",
          "function refund(uint256 gameId) external",
          "function getGame(uint256 gameId) external view returns (tuple(address player1, address player2, address token, uint256 betAmount, bytes32 commitment, bytes proof, uint8 player2Move, uint8 player1Move, uint8 state, uint256 createdAt, uint256 revealDeadline, address winner))",
          "function getGamesWaitingForPlayer2() external view returns (uint256[])",
          "function getGamesWaitingForReveal() external view returns (uint256[])",
          "function getGamesByPlayer(address player) external view returns (uint256[])",
          "function revealTimeout() external view returns (uint256)",
          "event GameCreated(uint256 indexed gameId, address indexed player1, address indexed token, uint256 betAmount, bytes32 commitment)",
          "event Player2Joined(uint256 indexed gameId, address indexed player2, uint8 move)",
          "event MoveRevealed(uint256 indexed gameId, address indexed player1, uint8 move)",
          "event GameSettled(uint256 indexed gameId, address indexed winner, uint256 amount)",
          "event PrizeWithdrawn(uint256 indexed gameId, address indexed winner, uint256 amount)",
          "event GameRefunded(uint256 indexed gameId, address indexed player, uint256 amount)",
        ];
      }
    } else if (RPS_ADDRESS) {
      // Fallback to old RPS_ADDRESS if degenRPS not in deployments
      DEGEN_RPS_ADDRESS = RPS_ADDRESS;
      log(`⚠️ Using RPS_ADDRESS as DegenRPS: ${DEGEN_RPS_ADDRESS}`);
      // Use fallback ABI
      degenRPSABI = [
        "function createGame(address tokenAddress, uint256 betAmount, bytes32 commitment, bytes calldata proof) external returns (uint256)",
        "function joinGame(uint256 gameId, uint8 move) external",
        "function revealAndSettle(uint256 gameId, uint8 move, bytes32 salt, bytes calldata proof) external",
        "function withdraw(uint256 gameId) external",
        "function refund(uint256 gameId) external",
        "function getGame(uint256 gameId) external view returns (tuple(address player1, address player2, address token, uint256 betAmount, bytes32 commitment, bytes proof, uint8 player2Move, uint8 player1Move, uint8 state, uint256 createdAt, uint256 revealDeadline, address winner))",
        "function getGamesWaitingForPlayer2() external view returns (uint256[])",
        "function getGamesWaitingForReveal() external view returns (uint256[])",
        "function getGamesByPlayer(address player) external view returns (uint256[])",
        "function revealTimeout() external view returns (uint256)",
        "event GameCreated(uint256 indexed gameId, address indexed player1, address indexed token, uint256 betAmount, bytes32 commitment)",
        "event Player2Joined(uint256 indexed gameId, address indexed player2, uint8 move)",
        "event MoveRevealed(uint256 indexed gameId, address indexed player1, uint8 move)",
        "event GameSettled(uint256 indexed gameId, address indexed winner, uint256 amount)",
        "event PrizeWithdrawn(uint256 indexed gameId, address indexed winner, uint256 amount)",
        "event GameRefunded(uint256 indexed gameId, address indexed player, uint256 amount)",
      ];
    }

    if (DEGEN_RPS_ADDRESS && degenRPSABI) {
      rpsContract = new ethers.Contract(DEGEN_RPS_ADDRESS, degenRPSABI, signer);
    }

    // ERC20 ABI - try to get from deployments, fallback to minimal ABI
    if (
      deployments &&
      deployments.contracts &&
      deployments.contracts.token0 &&
      deployments.contracts.token0.abi &&
      deployments.contracts.token0.abi.length > 0
    ) {
      erc20ABI = deployments.contracts.token0.abi;
      log(`✅ Token0 ABI loaded from deployments (${erc20ABI.length} entries)`);
    } else {
      // Fallback to minimal ABI
      erc20ABI = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function balanceOf(address account) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
        "function symbol() external view returns (string)",
      ];
    }

    if (TOKEN0_ADDRESS) {
      token0Contract = new ethers.Contract(TOKEN0_ADDRESS, erc20ABI, signer);
    }
    if (TOKEN1_ADDRESS) {
      token1Contract = new ethers.Contract(TOKEN1_ADDRESS, erc20ABI, signer);
    }

    log("✅ Contracts initialized");
    await updateContractAddressDisplay();
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
          <span class="font-mono sm:hidden">${address.slice(
            0,
            6
          )}...${address.slice(-4)}</span>
        </p>
      </div>
    `;

    log(`✅ Connected to wallet: ${address}`);
    await initializeContracts();
    await updateMakerTokenBalance();
    // Auto-load games based on current view
    if (currentView === "maker") {
      await loadMakerGames();
    } else if (rpsContract) {
      await loadAllTakerGames();
      // Start auto-refresh if on taker view
      const takerView = document.getElementById("takerView");
      if (takerView && !takerView.classList.contains("hidden")) {
        startAutoRefresh();
      }
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
async function safeTokenCallWithParam(
  contract,
  functionName,
  param,
  defaultValue = null
) {
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
    // Get token address from dropdown
    const tokenSelect = document.getElementById("makerTokenSelect");
    const tokenAddress =
      tokenSelect?.value || document.getElementById("makerTokenAddress")?.value;

    if (!tokenAddress) {
      document.getElementById("makerTokenBalance").textContent =
        "Please select a token";
      return;
    }

    let tokenContract, tokenSymbol;
    if (tokenAddress.toLowerCase() === TOKEN0_ADDRESS?.toLowerCase()) {
      tokenContract = token0Contract;
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token0");
    } else if (tokenAddress.toLowerCase() === TOKEN1_ADDRESS?.toLowerCase()) {
      tokenContract = token1Contract;
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token1");
    } else {
      // Custom token address - create contract on the fly
      const erc20ABI = [
        "function balanceOf(address account) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
        "function symbol() external view returns (string)",
      ];
      tokenContract = new ethers.Contract(tokenAddress, erc20ABI, signer);
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token");
    }

    const balance = await safeTokenCallWithParam(
      tokenContract,
      "balanceOf",
      address,
      0n
    );
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
  if (!signer || !rpsContract) {
    console.warn(
      "checkMakerApproval() early return: contracts not initialized"
    );
    return;
  }

  try {
    const address = await signer.getAddress();
    // Get token address from dropdown
    const tokenSelect = document.getElementById("makerTokenSelect");
    const tokenAddress =
      tokenSelect?.value || document.getElementById("makerTokenAddress")?.value;
    const amountInput = document.getElementById("makerSwapAmount")?.value;
    console.log(
      "checkMakerApproval() - tokenAddress:",
      tokenAddress,
      "amountInput:",
      amountInput
    );

    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      console.log(
        "checkMakerApproval() - no token selected, clearing approval status"
      );
      const approvalDiv = document.getElementById("makerApprovalStatus");
      if (approvalDiv) {
        approvalDiv.innerHTML = "";
      }
      return;
    }

    if (!amountInput || parseFloat(amountInput) <= 0) {
      console.log(
        "checkMakerApproval() - no amount input, clearing approval status"
      );
      const approvalDiv = document.getElementById("makerApprovalStatus");
      if (approvalDiv) {
        approvalDiv.innerHTML = "";
      }
      return;
    }

    // Get token contract
    let tokenContract;
    if (tokenAddress.toLowerCase() === TOKEN0_ADDRESS?.toLowerCase()) {
      tokenContract = token0Contract;
    } else if (tokenAddress.toLowerCase() === TOKEN1_ADDRESS?.toLowerCase()) {
      tokenContract = token1Contract;
    } else {
      // Custom token - create contract on the fly
      const erc20ABI = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
      ];
      tokenContract = new ethers.Contract(tokenAddress, erc20ABI, signer);
    }

    if (!tokenContract) {
      return;
    }

    // Get DegenRPS address for approval check
    const DEGEN_RPS_ADDRESS = rpsContract.target || rpsContract.address;

    const decimals = await safeTokenCall(tokenContract, "decimals", 18);
    const amount = ethers.parseUnits(amountInput, decimals);
    const allowance = await safeTokenCallWithParam(
      tokenContract,
      "allowance",
      [address, DEGEN_RPS_ADDRESS],
      0n
    );

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

    // Note: We don't disable the button based on approval here
    // The button state is managed by updateMakerButtonStates()
    // Approval check happens when creating the game
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
  if (!rpsContract) {
    log("⚠️ DegenRPS contract not found, loading deployments...");
    try {
      await loadDeployments();
      await initializeContracts();
    } catch (error) {
      log(`❌ Error loading deployments: ${error.message}`);
      console.error("Deployments loading error:", error);
    }
  }

  if (!rpsContract) {
    log("❌ DegenRPS contract not found. Please check deployments.json");
    console.error("No rpsContract:", rpsContract);
    return;
  }

  const networkOk = await ensureCorrectNetwork();
  if (!networkOk) {
    log("❌ Please switch to the correct network");
    return;
  }

  // Get token address from dropdown
  const tokenSelect = document.getElementById("makerTokenSelect");
  const tokenAddress =
    tokenSelect?.value || document.getElementById("makerTokenAddress")?.value;
  const amountInput = document.getElementById("makerSwapAmount")?.value;

  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    log("❌ Please select a token from the dropdown");
    return;
  }

  log(`📋 Approval details:`);
  log(`   Token: ${tokenAddress}`);
  log(`   Amount: ${amountInput || "Not specified"}`);

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
    await initializeContracts();

    if (!rpsContract) {
      throw new Error("DegenRPS contract not available");
    }

    // Get token contract
    let tokenContract, tokenSymbol;
    if (tokenAddress.toLowerCase() === TOKEN0_ADDRESS?.toLowerCase()) {
      tokenContract = token0Contract;
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token0");
    } else if (tokenAddress.toLowerCase() === TOKEN1_ADDRESS?.toLowerCase()) {
      tokenContract = token1Contract;
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token1");
    } else {
      // Custom token - create contract on the fly
      const erc20ABI = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function symbol() external view returns (string)",
      ];
      tokenContract = new ethers.Contract(tokenAddress, erc20ABI, signer);
      tokenSymbol = await safeTokenCall(tokenContract, "symbol", "Token");
    }

    if (!tokenContract) {
      throw new Error("Token contract not available");
    }

    // Get DegenRPS address for approval
    const DEGEN_RPS_ADDRESS = rpsContract.target || rpsContract.address;
    const maxApproval = ethers.MaxUint256;

    log(`🔓 Approving ${tokenSymbol} for DegenRPS...`);
    log(`   Token: ${tokenSymbol} (${tokenAddress})`);
    log(`   DegenRPS: ${DEGEN_RPS_ADDRESS}`);
    log(`   Amount: Maximum (${maxApproval.toString()})`);
    console.log(
      `Approving ${tokenSymbol} for DegenRPS at ${DEGEN_RPS_ADDRESS}`
    );

    const tx = await tokenContract.approve(DEGEN_RPS_ADDRESS, maxApproval);
    log(`📤 Transaction sent: ${tx.hash}`);
    console.log(`Transaction hash: ${tx.hash}`);

    log("⏳ Waiting for confirmation...");
    const receipt = await tx.wait();
    log(
      `✅ ${tokenSymbol} approved for DegenRPS! Confirmed in block ${receipt.blockNumber}`
    );
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
  log(
    `✅ Move selected: ${
      move === 0 ? "Rock" : move === 1 ? "Paper" : "Scissors"
    }`
  );
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

    // Check if token is selected
    const tokenSelect = document.getElementById("makerTokenSelect");
    const tokenAddress =
      tokenSelect?.value || document.getElementById("makerTokenAddress")?.value;
    const hasToken = tokenAddress && ethers.isAddress(tokenAddress);

    const shouldEnable = hasMove && hasAmount && hasToken;

    createBtn.disabled = !shouldEnable;

    // Update button styling based on state
    if (shouldEnable) {
      createBtn.classList.remove(
        "disabled:bg-gray-400",
        "disabled:cursor-not-allowed"
      );
      createBtn.classList.add(
        "hover:from-green-700",
        "hover:to-emerald-700",
        "transform",
        "hover:scale-105"
      );
    } else {
      createBtn.classList.add(
        "disabled:bg-gray-400",
        "disabled:cursor-not-allowed"
      );
    }

    console.log(
      `Button state updated: move=${hasMove}, amount=${hasAmount}, token=${hasToken}, enabled=${shouldEnable}`
    );
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
  const createBtn = document.getElementById("makerCreateGameBtn");
  if (createBtn) {
    const hasMove = gameState.move !== null;
    const hasAmount = document.getElementById("makerSwapAmount")?.value;
    createBtn.disabled = !hasMove || !hasAmount;
  }
}

// Create game with DegenRPS (Maker)
async function createMakerGame() {
  console.log("createMakerGame called");
  log("🎮 Create Game button clicked!");

  if (!signer) {
    log("❌ Please connect your wallet first");
    console.error("No signer available");
    return;
  }

  log("✅ Wallet connected");

  if (!rpsContract) {
    log("❌ DegenRPS contract not initialized. Initializing now...");
    console.log("Initializing contracts...");
    try {
      await initializeContracts();
      if (!rpsContract) {
        throw new Error(
          "DegenRPS contract still not initialized after initialization attempt"
        );
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

  // Get token address from dropdown selector
  const tokenSelect = document.getElementById("makerTokenSelect");
  const tokenAddressInput =
    tokenSelect?.value ||
    document.getElementById("makerTokenAddress")?.value ||
    TOKEN0_ADDRESS;
  const amountInput = document.getElementById("makerSwapAmount")?.value;

  if (!tokenAddressInput || !ethers.isAddress(tokenAddressInput)) {
    log("❌ Please select a token from the dropdown");
    return;
  }

  if (!amountInput || parseFloat(amountInput) <= 0) {
    log("❌ Please enter a bet amount");
    return;
  }

  const btn = document.getElementById("makerCreateGameBtn");
  if (!btn) {
    log("❌ Create game button not found");
    return;
  }

  const originalText = btn.innerHTML;
  const originalDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = "⏳ Creating...";

  log("🚀 Starting game creation process...");

  try {
    // Initialize Noir if not already done
    if (!noir || !backend) {
      log("🔧 Initializing Noir...");
      await initNoir();
    }

    // Generate salt and commitment
    const salt = ethers.randomBytes(32);
    const saltField = ethers.hexlify(salt);
    const moveValue = gameState.move; // 0=Rock, 1=Paper, 2=Scissors (frontend format)
    // IMPORTANT: The contract's revealAndSettle verifies commitment using enum format (1,2,3)
    // So we need to create the commitment with enum format to match
    const moveEnum = moveValue + 1; // Convert to DegenRPS enum: 1=Rock, 2=Paper, 3=Scissors
    const commitment = ethers.keccak256(
      ethers.solidityPacked(["uint8", "bytes32"], [moveEnum, saltField])
    );

    gameState.salt = saltField;
    gameState.commitment = commitment;
    gameState.role = "maker";

    log(`📋 Game details:`);
    log(
      `   Move: ${
        moveValue === 0 ? "Rock" : moveValue === 1 ? "Paper" : "Scissors"
      }`
    );
    log(`   Token: ${tokenAddressInput}`);
    log(`   Bet Amount: ${amountInput}`);
    log(`   Commitment: ${commitment.slice(0, 10)}...`);

    // Get token contract and decimals
    // Ensure erc20ABI is available (use fallback if not initialized)
    if (!erc20ABI) {
      erc20ABI = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function balanceOf(address account) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
        "function symbol() external view returns (string)",
      ];
    }
    const tokenContract = new ethers.Contract(
      tokenAddressInput,
      erc20ABI,
      signer
    );
    const decimals = await safeTokenCall(tokenContract, "decimals", 18);
    const betAmount = ethers.parseUnits(amountInput, decimals);
    const receiver = await signer.getAddress();

    // Check balance
    log("💰 Checking balance...");
    const balance = await safeTokenCallWithParam(
      tokenContract,
      "balanceOf",
      receiver,
      0n
    );
    if (balance < betAmount) {
      throw new Error(
        `Insufficient balance. You need ${ethers.formatUnits(
          betAmount,
          decimals
        )}, but you have ${ethers.formatUnits(balance, decimals)}`
      );
    }
    log(`✅ Balance: ${ethers.formatUnits(balance, decimals)} tokens`);

    // Check allowance for DegenRPS contract
    const DEGEN_RPS_ADDRESS = rpsContract.target;
    log("🔓 Checking token approval...");
    const allowance = await safeTokenCallWithParam(
      tokenContract,
      "allowance",
      [receiver, DEGEN_RPS_ADDRESS],
      0n
    );
    if (allowance < betAmount) {
      throw new Error(
        `Insufficient allowance. Please approve the token first.`
      );
    }
    log(`✅ Approval: ${ethers.formatUnits(allowance, decimals)} tokens`);

    // Generate ZK proof
    // Note: The proof needs to be generated with the commitment. Since we don't know player2's move yet,
    // we'll generate a proof with a placeholder move2. The proof will be verified at reveal time.
    // However, the contract stores the proof from createGame, so we need a valid proof structure.
    log("🔐 Generating ZK proof...");

    let proofBytes = "0x";
    try {
      // Generate proof using Noir - the proof should prove the commitment matches the move and salt
      // We'll use a placeholder player2 move (0/Rock) since we don't know it yet
      const placeholderPlayer2Move = 0;
      // Calculate winner with placeholder (will be recalculated at reveal with actual moves)
      // 0=Rock, 1=Paper, 2=Scissors
      // Rock beats Scissors (0 beats 2), Paper beats Rock (1 beats 0), Scissors beats Paper (2 beats 1)
      let placeholderWinner = 0; // Default to tie
      if (moveValue === 0 && placeholderPlayer2Move === 2)
        placeholderWinner = 1; // Rock beats Scissors
      else if (moveValue === 1 && placeholderPlayer2Move === 0)
        placeholderWinner = 1; // Paper beats Rock
      else if (moveValue === 2 && placeholderPlayer2Move === 1)
        placeholderWinner = 1; // Scissors beats Paper
      else if (placeholderPlayer2Move === 0 && moveValue === 2)
        placeholderWinner = 2; // Rock beats Scissors
      else if (placeholderPlayer2Move === 1 && moveValue === 0)
        placeholderWinner = 2; // Paper beats Rock
      else if (placeholderPlayer2Move === 2 && moveValue === 1)
        placeholderWinner = 2; // Scissors beats Paper

      // The circuit expects: player1_move, player2_move, winner
      // (salt and commitment are used for the commitment hash, but not needed in the proof inputs)
      const inputs = {
        player1_move: moveValue,
        player2_move: placeholderPlayer2Move,
        winner: placeholderWinner,
      };

      log(
        `Generating proof with inputs: player1_move=${moveValue}, player2_move=${placeholderPlayer2Move}, winner=${placeholderWinner}`
      );

      // Step 1: Execute circuit to get witness
      let witness;
      try {
        const result = await noir.execute(inputs);
        witness = result.witness;
        log("✅ Witness computed successfully");
      } catch (witnessError) {
        log(`❌ Witness computation failed: ${witnessError.message}`);
        throw new Error(`Witness computation failed: ${witnessError.message}`);
      }

      // Step 2: Generate proof from witness
      let proof;
      try {
        proof = await backend.generateProof(witness, { keccak: true });
        log("✅ Proof generated successfully with Keccak256 hash");
      } catch (proofError) {
        log(`❌ Proof generation failed: ${proofError.message}`);
        throw new Error(`Proof generation failed: ${proofError.message}`);
      }

      // Step 3: Serialize proof
      try {
        if (proof.proof && proof.proof instanceof Uint8Array) {
          proofBytes = ethers.hexlify(proof.proof);
          log("✅ Proof serialized from proof.proof (Uint8Array)");
        } else if (backend.serializeProof) {
          proofBytes = await backend.serializeProof(proof);
          log("✅ Proof serialized using backend.serializeProof()");
        } else {
          // Try to serialize manually
          proofBytes = ethers.hexlify(new Uint8Array(proof));
          log("✅ Proof serialized manually");
        }

        const proofLength =
          typeof proofBytes === "string"
            ? (proofBytes.length - 2) / 2
            : proofBytes.length;
        log(`📏 Proof length: ${proofLength} bytes`);
      } catch (serializeError) {
        log(`❌ Proof serialization failed: ${serializeError.message}`);
        throw serializeError;
      }

      log("✅ ZK proof generated (with placeholder move2)");
    } catch (error) {
      log(`❌ Proof generation failed: ${error.message}`);
      log(`   Error details: ${error.stack || error}`);
      console.error("Full proof generation error:", error);
      throw new Error(`Proof generation failed: ${error.message}`);
    }

    // Create game in DegenRPS contract
    log("🎮 Creating game in DegenRPS contract...");
    log("⏳ Waiting for MetaMask confirmation...");

    let createGameTx;
    try {
      createGameTx = await rpsContract.createGame(
        tokenAddressInput,
        betAmount,
        commitment,
        proofBytes
      );
      log(`📤 Transaction sent! Hash: ${createGameTx.hash}`);
      log(`⏳ Waiting for transaction confirmation...`);
    } catch (error) {
      if (
        error.code === 4001 ||
        error.message?.includes("user rejected") ||
        error.message?.includes("User denied")
      ) {
        log("❌ Transaction rejected by user in MetaMask");
        throw new Error("Transaction was rejected. Please try again.");
      }
      throw error;
    }

    // Wait for transaction to be mined
    let createGameReceipt;
    try {
      createGameReceipt = await createGameTx.wait();
      log(`✅ Transaction confirmed in block ${createGameReceipt.blockNumber}`);
      log(`🎉 SUCCESS! Your game has been created!`);
    } catch (error) {
      log(`❌ Transaction failed: ${error.message}`);
      if (error.receipt) {
        log(`   Block: ${error.receipt.blockNumber}`);
      }
      throw error;
    }

    // Extract gameId from event
    const gameCreatedEvent = createGameReceipt.logs.find((log) => {
      try {
        return (
          log.topics &&
          log.topics[0] ===
            ethers.id("GameCreated(uint256,address,address,uint256,bytes32)")
        );
      } catch {
        return false;
      }
    });

    if (gameCreatedEvent) {
      const parsed = rpsContract.interface.parseLog(gameCreatedEvent);
      gameState.gameId = parsed.args.gameId.toString();
      log(`✅ Game created! Game ID: ${gameState.gameId}`);
      log(`   Player1: ${parsed.args.player1}`);
      log(`   Token: ${parsed.args.token}`);
      log(
        `   Bet Amount: ${ethers.formatUnits(parsed.args.betAmount, decimals)}`
      );

      // Show prominent success message
      const successMsg = `🎉 Game #${gameState.gameId} created successfully!`;
      log(successMsg);
      log(`   Transaction: ${createGameTx.hash}`);
      log(`   Block: ${createGameReceipt.blockNumber}`);
    } else {
      log("⚠️ Could not extract gameId from event, but transaction succeeded");
      // Try to get gameId from the contract
      try {
        const nextGameId = await rpsContract.nextGameId();
        gameState.gameId = (nextGameId - 1n).toString();
        log(`✅ Game ID (from nextGameId): ${gameState.gameId}`);
        log(`🎉 Game #${gameState.gameId} created successfully!`);
        log(`   Transaction: ${createGameTx.hash}`);
        log(`   Block: ${createGameReceipt.blockNumber}`);
      } catch (e) {
        log("⚠️ Could not determine game ID");
        log(`   Transaction: ${createGameTx.hash}`);
        log(`   Block: ${createGameReceipt.blockNumber}`);
      }
    }

    // Save to localStorage for tracking (needed for reveal - stores salt and move)
    if (gameState.gameId && gameState.commitment) {
      saveMakerGame(
        gameState.commitment,
        gameState.gameId,
        amountInput,
        gameState.salt,
        moveValue
      );
    }

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
        btn.classList.remove(
          "border-4",
          "border-green-400",
          "ring-4",
          "ring-green-200"
        );
      }
    });
    updateMakerMoveStatus();
    updateMakerButtonStates();

    // Show success notification
    btn.innerHTML = "✅ Game Created!";
    btn.classList.add("bg-green-600");
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove("bg-green-600");
      btn.disabled = originalDisabled;
    }, 3000);
  } catch (error) {
    log(`❌ Error creating game: ${error.message}`);
    console.error("Full error:", error);
    console.error("Error stack:", error.stack);

    // Provide more specific error messages
    if (
      error.code === 4001 ||
      error.message?.includes("user rejected") ||
      error.message?.includes("User denied")
    ) {
      log(
        `❌ Transaction was rejected in MetaMask. Please approve the transaction to create the game.`
      );
    } else if (error.reason) {
      log(`❌ Error reason: ${error.reason}`);
    } else if (error.message) {
      log(`❌ Error: ${error.message}`);
    }

    if (error.data) {
      log(`   Error data: ${JSON.stringify(error.data)}`);
    }
    if (error.code) {
      log(`   Error code: ${error.code}`);
    }
    if (error.transaction) {
      log(`   Transaction: ${JSON.stringify(error.transaction)}`);
    }
    if (error.transactionHash) {
      log(`   Transaction hash: ${error.transactionHash}`);
    }

    // Restore button state on error
    btn.disabled = originalDisabled;
    btn.innerHTML = originalText;
  }
}

// LocalStorage functions to track Maker's games
function saveMakerGame(
  commitment,
  gameId,
  betAmount,
  salt = null,
  move = null
) {
  try {
    const games = getMakerGames();
    const gameKey = commitment || gameId?.toString();
    if (!gameKey) return;

    games[gameKey] = {
      commitment: commitment,
      gameId: gameId?.toString(),
      betAmount: betAmount,
      salt: salt || gameState.salt, // Store salt for later reveal
      move: move !== null ? move : gameState.move, // Store move for later reveal
      timestamp: Date.now(),
    };
    localStorage.setItem("makerGames", JSON.stringify(games));
  } catch (error) {
    console.error("Error saving maker game:", error);
  }
}

function getMakerGames() {
  try {
    const stored = localStorage.getItem("makerGames");
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error("Error getting maker games:", error);
    return {};
  }
}

function clearMakerGames() {
  try {
    localStorage.removeItem("makerGames");
  } catch (error) {
    console.error("Error clearing maker games:", error);
  }
}

// LocalStorage functions to track Taker's games
function saveTakerGame(gameId, betAmount) {
  try {
    const games = getTakerGames();
    const gameKey = gameId?.toString();
    if (!gameKey) return;

    games[gameKey] = {
      gameId: gameId?.toString(),
      betAmount: betAmount,
      timestamp: Date.now(),
    };
    localStorage.setItem("takerGames", JSON.stringify(games));
  } catch (error) {
    console.error("Error saving taker game:", error);
  }
}

function getTakerGames() {
  try {
    const stored = localStorage.getItem("takerGames");
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error("Error getting taker games:", error);
    return {};
  }
}

function clearTakerGames() {
  try {
    localStorage.removeItem("takerGames");
  } catch (error) {
    console.error("Error clearing taker games:", error);
  }
}

// Load active games (for Player 2)
// Wrapper function for loading taker available games
async function loadTakerAvailableGames() {
  await loadActiveGames();
}

async function loadActiveGames() {
  if (!signer) {
    log("❌ Please connect your wallet first");
    return;
  }

  if (!rpsContract) {
    log("❌ DegenRPS contract not initialized. Initializing now...");
    try {
      await initializeContracts();
    } catch (error) {
      log(`❌ Failed to initialize contracts: ${error.message}`);
      return;
    }
  }

  if (!rpsContract) {
    log(
      "❌ DegenRPS contract still not initialized. Please check deployments.json"
    );
    return;
  }

  try {
    log("Loading active games...");
    console.log(
      "Calling getGamesWaitingForPlayer2 on DegenRPS at:",
      rpsContract.target
    );
    const activeGameIds = await rpsContract.getGamesWaitingForPlayer2();
    console.log("Active game IDs received:", activeGameIds);
    console.log("Number of games:", activeGameIds.length);

    const gamesListDiv = document.getElementById("takerAvailableGamesList");
    if (!gamesListDiv) {
      log("❌ Games list div not found");
      return;
    }

    if (!activeGameIds || activeGameIds.length === 0) {
      log("ℹ️ No active games waiting for Player 2");
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No active games waiting for Player 2</p>
          <p class="text-xs text-gray-500 text-center mt-2">Make sure Player 1 has created a game first</p>
        </div>
      `;
      return;
    }

    log(`✅ Found ${activeGameIds.length} game(s) waiting for Player 2`);

    // Fetch details for each game
    log(`Fetching details for ${activeGameIds.length} game(s)...`);
    const gamePromises = activeGameIds.map(async (gameId) => {
      try {
        // Convert gameId to BigInt for contract call (ethers.js handles this, but be explicit)
        const gameIdBigInt =
          typeof gameId === "bigint" ? gameId : BigInt(gameId.toString());
        const gameIdNum = gameIdBigInt.toString();
        console.log(
          `Fetching game details for gameId: ${gameIdNum} (type: ${typeof gameId})`
        );
        const game = await rpsContract.getGame(gameIdBigInt);
        console.log(`Game details for ${gameIdNum}:`, game);

        // Verify game state is WaitingForPlayer2
        const isArray =
          Array.isArray(game) ||
          (typeof game === "object" &&
            game !== null &&
            game.length !== undefined);
        const gameState = isArray ? Number(game[8]) : Number(game.state);
        console.log(
          `Game ${gameIdNum} state: ${gameState} (0=WaitingForPlayer2, 1=WaitingForReveal, 2=Settled)`
        );

        if (gameState !== 0) {
          console.warn(
            `⚠️ Game ${gameIdNum} is not in WaitingForPlayer2 state (state=${gameState}), skipping`
          );
          return null;
        }

        return { gameId: gameIdNum, game };
      } catch (error) {
        log(`⚠️ Error fetching game ${gameId}: ${error.message}`);
        console.error("Error fetching game:", error);
        return null;
      }
    });

    const games = (await Promise.all(gamePromises)).filter((g) => g !== null);
    console.log(
      `Successfully fetched ${games.length} game(s) in WaitingForPlayer2 state`
    );

    // Filter out games where current user is player1 (can't join your own game)
    // Also filter out games with zero balance and games created by zero address
    const userAddress = await signer.getAddress();
    console.log(`Current user address: ${userAddress}`);
    const zeroAddress = ethers.ZeroAddress.toLowerCase();
    const availableGames = games.filter(({ game, gameId }) => {
      const isArray =
        Array.isArray(game) ||
        (typeof game === "object" &&
          game !== null &&
          game.length !== undefined);
      const player1 = isArray ? game[0] : game.player1;
      const betAmount = isArray ? game[3] : game.betAmount;
      const player1Lower = player1 ? player1.toLowerCase() : "";
      const userLower = userAddress.toLowerCase();
      const isOwnGame = player1Lower === userLower;

      // Filter out games with zero balance
      const betAmountBigInt =
        typeof betAmount === "bigint"
          ? betAmount
          : BigInt(betAmount?.toString() || "0");
      const hasZeroBalance = betAmountBigInt === 0n;

      // Filter out games created by zero address (glitchy games)
      const isZeroAddress =
        !player1 || player1Lower === zeroAddress || player1Lower === "0x0";

      if (isOwnGame) {
        console.log(
          `Filtering out game ${gameId} - user is player1 (${player1Lower})`
        );
      }
      if (hasZeroBalance) {
        console.log(
          `Filtering out game ${gameId} - zero balance (betAmount: ${betAmountBigInt.toString()})`
        );
      }
      if (isZeroAddress) {
        console.log(
          `Filtering out game ${gameId} - invalid player1 address (${player1Lower})`
        );
      }

      // Only show games where user is NOT player1, has non-zero balance, and has valid player1 address
      return player1 && !isOwnGame && !hasZeroBalance && !isZeroAddress;
    });

    console.log(
      `Filtered to ${availableGames.length} game(s) available to join (excluding own games)`
    );

    if (availableGames.length === 0) {
      log("ℹ️ No games available to join");
      const totalGamesFound = games.length;
      const ownGamesCount = games.length - availableGames.length;
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No games available to join</p>
          <p class="text-xs text-gray-500 text-center mt-2">
            ${
              totalGamesFound > 0
                ? `Found ${totalGamesFound} game(s), but ${ownGamesCount} are your own games.`
                : activeGameIds.length > 0
                ? `Found ${activeGameIds.length} game ID(s) from contract, but could not load game details.`
                : "No active games found. Make sure Player 1 has created a game and the transaction has been confirmed."
            }
          </p>
          <p class="text-xs text-blue-600 text-center mt-2 font-semibold">💡 Tip: Click "Refresh" to check for new games</p>
        </div>
      `;
      return;
    }

    // Display games - get token decimals and symbol for each
    const gamePromisesWithDecimals = availableGames.map(
      async ({ gameId, game }) => {
        // Handle both array and object responses
        const isArray =
          Array.isArray(game) ||
          (typeof game === "object" &&
            game !== null &&
            game.length !== undefined);
        const tokenAddress = isArray ? game[2] : game.token;
        const betAmount = isArray ? game[3] : game.betAmount;
        const player1 = isArray ? game[0] : game.player1;
        const createdAt = isArray ? game[9] : game.createdAt;

        // Get token contract and decimals
        // Ensure erc20ABI is available
        if (!erc20ABI) {
          erc20ABI = [
            "function balanceOf(address account) external view returns (uint256)",
            "function decimals() external view returns (uint8)",
            "function symbol() external view returns (string)",
          ];
        }
        const tokenContract = new ethers.Contract(
          tokenAddress,
          erc20ABI,
          signer
        );
        const decimals = await safeTokenCall(tokenContract, "decimals", 18);
        const tokenSymbol = await safeTokenCall(
          tokenContract,
          "symbol",
          "TOKEN"
        );
        const betAmountFormatted = ethers.formatUnits(betAmount, decimals);

        return {
          gameId,
          tokenAddress,
          betAmount,
          betAmountFormatted,
          tokenSymbol,
          player1,
          createdAt: Number(createdAt),
          decimals,
        };
      }
    );

    const gamesWithDetails = await Promise.all(gamePromisesWithDecimals);
    console.log("Games with details:", gamesWithDetails);

    log(`✅ Displaying ${gamesWithDetails.length} game(s)`);

    // Display games in a two-column grid
    gamesListDiv.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${gamesWithDetails
          .map(
            ({
              gameId,
              tokenAddress,
              betAmountFormatted,
              tokenSymbol,
              player1,
              createdAt,
            }) => {
              const gameIdDisplay = `game-${gameId}`;
              const timeAgo = createdAt
                ? getTimeAgo(createdAt * 1000)
                : "Unknown";
              return `
        <div class="bg-white border-2 border-purple-200 rounded-xl p-4 hover:border-purple-300 transition-colors" id="${gameIdDisplay}">
          <div class="flex flex-col gap-3">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Game ID:</span>
              <span class="text-xs font-mono text-purple-600 font-bold">#${gameId}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Created by:</span>
              <span class="text-xs font-mono text-gray-700" title="${player1}">${player1.slice(
                0,
                6
              )}...${player1.slice(-4)}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Bet Amount:</span>
              <span class="text-sm font-semibold text-purple-600">${betAmountFormatted} ${tokenSymbol}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Token:</span>
              <span class="text-xs font-mono text-gray-700" title="${tokenAddress}">${
                tokenSymbol ||
                tokenAddress.slice(0, 6) + "..." + tokenAddress.slice(-4)
              }</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Created:</span>
              <span class="text-xs text-gray-500">${timeAgo}</span>
            </div>
            
            <!-- Move Selection for this game -->
            <div class="mt-2 pt-3 border-t border-gray-200">
              <p class="text-xs text-gray-600 mb-2">Select your move:</p>
              <div class="flex gap-2 mb-3">
                <button 
                  class="move-btn rock-btn px-3 py-1.5 text-white text-xs font-semibold rounded-lg shadow"
                  onclick="selectMoveForGame('${gameIdDisplay}', 0, '${gameId}')"
                >
                  🪨 Rock
                </button>
                <button 
                  class="move-btn paper-btn px-3 py-1.5 text-white text-xs font-semibold rounded-lg shadow"
                  onclick="selectMoveForGame('${gameIdDisplay}', 1, '${gameId}')"
                >
                  📄 Paper
                </button>
                <button 
                  class="move-btn scissors-btn px-3 py-1.5 text-white text-xs font-semibold rounded-lg shadow"
                  onclick="selectMoveForGame('${gameIdDisplay}', 2, '${gameId}')"
                >
                  ✂️ Scissors
                </button>
              </div>
              <div id="${gameIdDisplay}-move-status" class="text-xs text-gray-500 mb-2"></div>
              <button 
                id="${gameIdDisplay}-join-btn"
                class="w-full px-4 py-2 bg-gray-300 text-gray-600 cursor-not-allowed font-semibold rounded-lg"
                disabled
                data-game-id="${gameId}"
              >
                🎮 Join This Game
              </button>
            </div>
          </div>
        </div>
      `;
            }
          )
          .join("")}
      </div>
    `;

    log(`✅ Loaded ${gamesWithDetails.length} active game(s)`);

    // Attach event listeners to join buttons
    gamesWithDetails.forEach(({ gameId }) => {
      const gameIdDisplay = `game-${gameId}`;
      const joinBtn = document.getElementById(`${gameIdDisplay}-join-btn`);
      if (joinBtn) {
        // Remove any existing listeners by cloning the button
        const newBtn = joinBtn.cloneNode(true);
        joinBtn.parentNode.replaceChild(newBtn, joinBtn);

        // Add click event listener
        newBtn.addEventListener("click", function () {
          if (!this.disabled) {
            const gameIdNum = this.getAttribute("data-game-id");
            const selectedMove = selectedMovesByGame[gameIdDisplay];
            if (selectedMove !== undefined) {
              joinGame(gameIdNum, selectedMove);
            } else {
              log("❌ Please select a move first");
            }
          }
        });
      }
    });

    // Start real-time timeout updates
    startActiveGamesTimer();

    // Ensure auto-refresh is running (if on taker view)
    const takerView = document.getElementById("takerView");
    if (takerView && !takerView.classList.contains("hidden")) {
      startAutoRefresh();
    }
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

  // Get REFUND_TIMEOUT from DegenRPS contract (defaults to 30 minutes = 1800 seconds)
  let refundTimeout = 1800; // default: 30 minutes
  if (rpsContract) {
    try {
      const timeout = await rpsContract.revealTimeout();
      refundTimeout = Number(timeout);
    } catch (error) {
      console.warn(
        "Could not get revealTimeout from DegenRPS contract, using default 30 minutes (1800 seconds)"
      );
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

// Auto-refresh games list periodically when on taker view
function startAutoRefresh() {
  // Clear existing interval if any
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }

  // Refresh every 15 seconds
  autoRefreshInterval = setInterval(() => {
    const takerView = document.getElementById("takerView");
    if (takerView && !takerView.classList.contains("hidden") && signer) {
      console.log("🔄 Auto-refreshing games list...");
      loadAllTakerGames();
    }
  }, 15000); // 15 seconds
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
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
      timeRemainingText = `Expired ${expiredMinutes}:${expiredSecs
        .toString()
        .padStart(2, "0")} ago`;
    } else {
      const minutes = Math.floor(timeRemaining / 60);
      const seconds = timeRemaining % 60;
      timeRemainingText = `${minutes}:${seconds
        .toString()
        .padStart(2, "0")} remaining`;
    }

    // Update the display
    const timeElement = document.getElementById(`${gameId}-time-remaining`);
    if (timeElement) {
      timeElement.textContent = timeRemainingText;
      timeElement.className = `text-sm font-semibold ${
        isExpired ? "text-red-600" : "text-orange-600"
      }`;

      // Update parent container styling if expired
      const gameContainer = document.getElementById(gameId);
      if (gameContainer) {
        if (isExpired) {
          gameContainer.className =
            "bg-red-50 border-2 border-red-300 rounded-xl p-4 mb-4";
        } else {
          gameContainer.className =
            "bg-white border-2 border-purple-200 rounded-xl p-4 mb-4";
        }

        // Update join button - but preserve enabled state if move is selected
        const joinBtn = document.getElementById(`${gameId}-join-btn`);
        if (joinBtn) {
          const hasMoveSelected = selectedMovesByGame[gameId] !== undefined;

          if (isExpired) {
            joinBtn.className =
              "w-full px-4 py-2 bg-red-300 text-red-700 cursor-not-allowed font-semibold rounded-lg";
            joinBtn.disabled = true;
            joinBtn.textContent = "⏰ Game Expired";
          } else if (hasMoveSelected) {
            // Preserve enabled state if move is selected
            joinBtn.className =
              "w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transform hover:scale-105 transition-all font-semibold rounded-lg";
            joinBtn.disabled = false;
            joinBtn.textContent = "🎮 Join This Game";
          } else {
            // No move selected - keep disabled
            joinBtn.className =
              "w-full px-4 py-2 bg-gray-300 text-gray-600 cursor-not-allowed font-semibold rounded-lg";
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
    return {
      text: `${minutes}:${seconds.toString().padStart(2, "0")} ago`,
      overdue: true,
    };
  }

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  return {
    text: `${minutes}:${seconds.toString().padStart(2, "0")}`,
    overdue: false,
  };
}

// Load games awaiting reveal (where current user is taker)
async function loadAwaitingRevealGames() {
  if (!signer || !rpsContract) {
    const gamesListDiv = document.getElementById("takerAwaitingRevealList");
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
    log("Loading games awaiting reveal...");

    // Get all games waiting for reveal from DegenRPS contract
    const awaitingRevealGameIds = await rpsContract.getGamesWaitingForReveal();
    const gamesListDiv = document.getElementById("takerAwaitingRevealList");

    if (!gamesListDiv) return;

    if (!awaitingRevealGameIds || awaitingRevealGameIds.length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No games awaiting reveal</p>
        </div>
      `;
      return;
    }

    log(`Found ${awaitingRevealGameIds.length} game(s) waiting for reveal`);

    // Filter games where current user is player2
    const userGames = [];
    for (const gameIdBigInt of awaitingRevealGameIds) {
      const gameId =
        typeof gameIdBigInt === "bigint"
          ? gameIdBigInt.toString()
          : gameIdBigInt.toString();
      try {
        const game = await rpsContract.getGame(gameId);
        const isArray =
          Array.isArray(game) ||
          (typeof game === "object" &&
            game !== null &&
            game.length !== undefined);
        const player2 = isArray ? game[1] : game.player2;

        // Only show games where user is player2
        if (player2 && player2.toLowerCase() === userAddress.toLowerCase()) {
          const player2Move = isArray ? game[6] : game.player2Move;
          const tokenAddress = isArray ? game[2] : game.token;
          const betAmount = isArray ? game[3] : game.betAmount;
          const revealDeadline = isArray ? game[10] : game.revealDeadline;

          userGames.push({
            gameId: gameId,
            player2Move: Number(player2Move),
            tokenAddress: tokenAddress,
            betAmount: betAmount,
            revealDeadline: revealDeadline ? Number(revealDeadline) : null,
          });
        }
      } catch (error) {
        console.error(`Error processing game ${gameId}:`, error);
      }
    }

    if (userGames.length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No games awaiting reveal where you are Player 2</p>
        </div>
      `;
      return;
    }

    // Display games - fetch token decimals and symbols
    const gamesWithDetails = await Promise.all(
      userGames.map(
        async ({
          gameId,
          player2Move,
          tokenAddress,
          betAmount,
          revealDeadline,
        }) => {
          // Get token contract and decimals
          if (!erc20ABI) {
            erc20ABI = [
              "function balanceOf(address account) external view returns (uint256)",
              "function decimals() external view returns (uint8)",
              "function symbol() external view returns (string)",
            ];
          }
          const tokenContract = new ethers.Contract(
            tokenAddress,
            erc20ABI,
            signer
          );
          const decimals = await safeTokenCall(tokenContract, "decimals", 18);
          const tokenSymbol = await safeTokenCall(
            tokenContract,
            "symbol",
            "TOKEN"
          );
          const betAmountFormatted = ethers.formatUnits(betAmount, decimals);

          return {
            gameId,
            player2Move,
            tokenAddress,
            betAmountFormatted,
            tokenSymbol,
            revealDeadline,
          };
        }
      )
    );

    gamesListDiv.innerHTML = gamesWithDetails
      .map(
        ({
          gameId,
          player2Move,
          betAmountFormatted,
          tokenSymbol,
          revealDeadline,
        }) => {
          const now = Math.floor(Date.now() / 1000);
          const timeRemaining = revealDeadline ? revealDeadline - now : null;
          const isOverdue = timeRemaining !== null && timeRemaining < 0;
          const minutes =
            timeRemaining !== null
              ? Math.floor(Math.abs(timeRemaining) / 60)
              : 0;
          const seconds =
            timeRemaining !== null ? Math.abs(timeRemaining) % 60 : 0;
          const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

          const moveNames = ["Rock 🪨", "Paper 📄", "Scissors ✂️"];
          // Convert DegenRPS enum (1,2,3) to frontend (0,1,2)
          const player2MoveFrontend = player2Move - 1;
          const player2MoveName = moveNames[player2MoveFrontend] || "Unknown";

          return `
        <div class="bg-orange-50 border-2 border-orange-200 rounded-xl p-4 mb-4">
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Game ID:</span>
              <span class="text-xs font-mono text-purple-600 font-bold">#${gameId}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Your Move:</span>
              <span class="text-sm font-semibold">${player2MoveName}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Bet Amount:</span>
              <span class="text-sm font-semibold text-orange-600">${betAmountFormatted} ${tokenSymbol}</span>
            </div>
            ${
              revealDeadline
                ? `
              <div class="flex justify-between items-center">
                <span class="text-sm ${
                  isOverdue ? "text-red-600 font-bold" : "text-orange-600"
                }">${
                    isOverdue ? "⏰ Deadline Passed" : "⏳ Time Remaining"
                  }:</span>
                <span class="text-sm font-semibold ${
                  isOverdue ? "text-red-600" : "text-orange-600"
                }">${isOverdue ? `${timeStr} ago` : timeStr}</span>
              </div>
              ${
                isOverdue
                  ? `
                <div class="mt-2 p-2 bg-red-100 border border-red-300 rounded-lg">
                  <p class="text-xs text-red-800 text-center">Player 1 failed to reveal. You can claim a refund!</p>
                </div>
              `
                  : ""
              }
            `
                : ""
            }
          </div>
        </div>
      `;
        }
      )
      .join("");

    log(`✅ Loaded ${gamesWithDetails.length} game(s) awaiting reveal`);
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

// Load completed games (query contract for all games where user is player2 and game is settled)
async function loadCompletedGames() {
  if (!signer || !rpsContract) {
    return;
  }

  try {
    const userAddress = await signer.getAddress();
    const gamesListDiv = document.getElementById("takerCompletedGamesList");

    if (!gamesListDiv) {
      console.warn("takerCompletedGamesList div not found");
      return;
    }

    log("🔍 Loading completed games from contract...");

    // Get the total number of games
    const nextGameId = await rpsContract.nextGameId();
    const totalGames = Number(nextGameId);

    if (totalGames === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No completed games yet</p>
        </div>
      `;
      return;
    }

    log(
      `📊 Checking ${totalGames} game(s) for completed games where you are player2...`
    );

    const completedGames = [];
    const trackedGames = getTakerGames(); // For additional metadata

    // Check all games to find ones where user is player2 and game is settled
    // Limit to last 100 games for performance (most recent games)
    const startGameId = Math.max(0, totalGames - 100);

    for (let i = startGameId; i < totalGames; i++) {
      try {
        const game = await rpsContract.getGame(i);
        const isArray =
          Array.isArray(game) ||
          (typeof game === "object" && game.length !== undefined);
        const state = isArray ? game[8] : game.state;
        const player2 = isArray ? game[1] : game.player2;
        const stateNum = Number(state);

        // DegenRPS GameState: 0=WaitingForPlayer2, 1=WaitingForReveal, 2=Settled
        // Only show games where user is taker (player2) and game is settled (state 2)
        if (
          stateNum === 2 &&
          player2 &&
          player2.toLowerCase() === userAddress.toLowerCase()
        ) {
          const winner = isArray ? game[11] : game.winner;
          const player1MoveRaw = isArray ? game[7] : game.player1Move;
          const player2MoveRaw = isArray ? game[6] : game.player2Move;
          const createdAt = isArray ? game[9] : game.createdAt;
          const tokenAddress = isArray ? game[2] : game.token;
          const betAmount = isArray ? game[3] : game.betAmount;

          // Convert DegenRPS enum (1,2,3) to frontend (0,1,2)
          const player1Move = Number(player1MoveRaw) - 1;
          const player2Move = Number(player2MoveRaw) - 1;

          // Get additional metadata from tracked games if available
          const gameKey = i.toString();
          const trackedData = trackedGames[gameKey] || {};

          completedGames.push({
            gameId: i.toString(),
            commitment: trackedData.commitment || null,
            winner:
              winner && winner !== ethers.ZeroAddress
                ? winner.toLowerCase() === userAddress.toLowerCase()
                  ? 2
                  : 1
                : 0, // 0=tie, 1=player1, 2=player2
            player1Move: player1Move,
            player2Move: player2Move,
            createdAt: Number(createdAt),
            tokenAddress: tokenAddress,
            betAmount: betAmount,
            timestamp: trackedData.timestamp || Number(createdAt),
          });
        }
      } catch (error) {
        // Game might not exist (deleted after withdrawal), skip it
        if (
          !error.message.includes("revert") &&
          !error.message.includes("Game does not exist")
        ) {
          console.error(`Error checking game ${i}:`, error);
        }
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

    // Display completed games - fetch token decimals and symbols
    const gamesWithDetails = await Promise.all(
      completedGames.map(async (game) => {
        // Get token contract and decimals
        if (!erc20ABI) {
          erc20ABI = [
            "function balanceOf(address account) external view returns (uint256)",
            "function decimals() external view returns (uint8)",
            "function symbol() external view returns (string)",
          ];
        }
        const tokenContract = new ethers.Contract(
          game.tokenAddress,
          erc20ABI,
          signer
        );
        const decimals = await safeTokenCall(tokenContract, "decimals", 18);
        const tokenSymbol = await safeTokenCall(
          tokenContract,
          "symbol",
          "TOKEN"
        );
        const betAmountFormatted = ethers.formatUnits(game.betAmount, decimals);

        return {
          ...game,
          betAmountFormatted,
          tokenSymbol,
        };
      })
    );

    // Display completed games
    const moveNames = ["Rock 🪨", "Paper 📄", "Scissors ✂️"];
    gamesListDiv.innerHTML = gamesWithDetails
      .map((game) => {
        const isWin = game.winner === 2;
        const isTie = game.winner === 0;
        const resultText = isTie
          ? "Tie 🤝"
          : isWin
          ? "You Won! 🎉"
          : "You Lost 😔";
        // Use conditional classes for Tailwind
        const bgClass = isTie
          ? "bg-yellow-50"
          : isWin
          ? "bg-green-50"
          : "bg-red-50";
        const borderClass = isTie
          ? "border-yellow-200"
          : isWin
          ? "border-green-200"
          : "border-red-200";
        const textClass = isTie
          ? "text-yellow-600"
          : isWin
          ? "text-green-600"
          : "text-red-600";
        const date = new Date(game.createdAt * 1000);
        const dateStr = date.toLocaleString();

        // Add withdraw button if taker won or it's a tie
        const withdrawButton =
          isWin || isTie
            ? `
        <div class="mt-3 pt-3 border-t ${borderClass}">
          <button
            onclick="withdrawPrize('${game.gameId}')"
            class="w-full px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all"
          >
            💰 Withdraw Prize
          </button>
        </div>
      `
            : "";

        return `
        <div class="${bgClass} border-2 ${borderClass} rounded-xl p-4 mb-4">
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Game ID:</span>
              <span class="text-xs font-mono text-purple-600 font-bold">#${
                game.gameId
              }</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Result:</span>
              <span class="text-sm font-bold ${textClass}">${resultText}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Maker's Move:</span>
              <span class="text-sm font-semibold">${
                moveNames[game.player1Move] || "Unknown"
              }</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Your Move:</span>
              <span class="text-sm font-semibold">${
                moveNames[game.player2Move] || "Unknown"
              }</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Bet Amount:</span>
              <span class="text-sm font-semibold">${game.betAmountFormatted} ${
          game.tokenSymbol
        }</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Completed:</span>
              <span class="text-xs text-gray-500">${dateStr}</span>
            </div>
            ${withdrawButton}
          </div>
        </div>
      `;
      })
      .join("");

    log(`✅ Loaded ${gamesWithDetails.length} completed game(s)`);
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
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    log(`❌ Error refreshing games: ${error.message}`);
    // Show error feedback briefly
    if (refreshBtn) {
      refreshBtn.innerHTML = "❌ Error";
      await new Promise((resolve) => setTimeout(resolve, 2000));
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
  if (!signer || !rpsContract) {
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
    const gamesListDiv = document.getElementById("makerGamesList");

    if (!gamesListDiv) return;

    log("📋 Loading maker games from contract...");

    // Use the new getGamesByPlayer function to get only games where user is player1
    const gameIds = await rpsContract.getGamesByPlayer(userAddress);

    if (!gameIds || gameIds.length === 0) {
      gamesListDiv.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
          <p class="text-sm text-gray-600 text-center">No games created yet. Create your first game above!</p>
        </div>
      `;
      return;
    }

    log(`Found ${gameIds.length} game(s) created by ${userAddress}...`);

    const makerGames = [];

    // Query each game by ID
    for (const gameIdBigInt of gameIds) {
      const gameId =
        typeof gameIdBigInt === "bigint"
          ? gameIdBigInt.toString()
          : gameIdBigInt.toString();
      try {
        const game = await rpsContract.getGame(gameId);

        // Handle both array and object responses
        const isArray =
          Array.isArray(game) ||
          (typeof game === "object" &&
            game !== null &&
            game.length !== undefined);
        const state = isArray ? game[8] : game.state;
        const player2 = isArray ? game[1] : game.player2;
        const tokenAddress = isArray ? game[2] : game.token;
        const betAmount = isArray ? game[3] : game.betAmount;
        const player2Move = isArray ? game[6] : game.player2Move;
        const revealDeadline = isArray ? game[10] : game.revealDeadline;
        const winner = isArray ? game[11] : game.winner;
        const createdAt = isArray ? game[9] : game.createdAt;
        const commitment = isArray ? game[4] : game.commitment;

        makerGames.push({
          gameId: gameId,
          betAmount: betAmount,
          tokenAddress: tokenAddress,
          state: Number(state),
          player2: player2,
          player2Move:
            player2Move !== null && player2Move !== undefined
              ? Number(player2Move)
              : null,
          revealDeadline: revealDeadline ? Number(revealDeadline) : null,
          winner: winner,
          timestamp: createdAt ? Number(createdAt) : null,
          commitment: commitment,
        });
      } catch (error) {
        // Game might not exist (deleted or invalid ID), skip it
        console.log(`Game ${gameId} not found or error:`, error.message);
        continue;
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
    const gameHTMLs = await Promise.all(
      makerGames.map(async (game) => {
        let statusText = "Waiting for Player 2";
        let statusColor = "yellow";
        let actionButton = "";

        // Get token decimals for display
        let betAmountFormatted = "0";
        if (game.tokenAddress && game.betAmount) {
          try {
            // Ensure erc20ABI is available
            if (!erc20ABI) {
              erc20ABI = [
                "function balanceOf(address account) external view returns (uint256)",
                "function decimals() external view returns (uint8)",
                "function symbol() external view returns (string)",
              ];
            }
            const tokenContract = new ethers.Contract(
              game.tokenAddress,
              erc20ABI,
              signer
            );
            const decimals = await safeTokenCall(tokenContract, "decimals", 18);
            betAmountFormatted = ethers.formatUnits(game.betAmount, decimals);
          } catch (e) {
            betAmountFormatted = game.betAmount.toString();
          }
        }

        // DegenRPS GameState: 0=WaitingForPlayer2, 1=WaitingForReveal, 2=Settled
        if (game.state === null || game.state === undefined) {
          statusText = "Unknown";
          statusColor = "gray";
        } else if (game.state === 0) {
          statusText = "Waiting for Player 2";
          statusColor = "yellow";
        } else if (game.state === 1) {
          statusText = "Waiting for Reveal";
          statusColor = "orange";
          // Convert player2Move from DegenRPS enum (1,2,3) to frontend (0,1,2)
          const player2MoveFrontend =
            game.player2Move !== null && game.player2Move !== undefined
              ? game.player2Move - 1
              : null;
          const player2MoveName =
            player2MoveFrontend !== null
              ? moveNames[player2MoveFrontend]
              : "Unknown";
          // Get commitment hash from game data or use gameId as fallback
          const commitmentHash =
            game.commitment || game.commitmentHash || game.gameId;
          actionButton = `
          <div class="mt-3 pt-3 border-t border-gray-200">
            <p class="text-xs text-gray-600 mb-2">Player 2's Move: ${player2MoveName}</p>
            <button
              id="reveal-btn-${game.gameId}"
              onclick="window.revealMakerMove('${game.gameId}', '${commitmentHash}')"
              class="w-full px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold rounded-lg hover:from-green-700 hover:to-emerald-700 transform hover:scale-105 transition-all"
            >
              🔓 Reveal Move
            </button>
          </div>
        `;
        } else if (game.state === 2) {
          statusText = "Settled";
          statusColor = "green";
          const userAddress = await signer.getAddress();
          const isWinner =
            game.winner &&
            game.winner.toLowerCase() === userAddress.toLowerCase();
          const isTie = !game.winner || game.winner === ethers.ZeroAddress;
          const winnerText = isTie
            ? "Tie 🤝"
            : isWinner
            ? "You Won! 🎉"
            : "You Lost 😔";
          actionButton = `
          <div class="mt-3 pt-3 border-t border-gray-200">
            <p class="text-sm font-semibold ${
              isWinner
                ? "text-green-600"
                : isTie
                ? "text-yellow-600"
                : "text-red-600"
            } mb-2">${winnerText}</p>
            ${
              isWinner || isTie
                ? `
              <button
                onclick="withdrawPrize('${game.gameId}')"
                class="w-full px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105 transition-all"
              >
                💰 Withdraw Prize
              </button>
            `
                : ""
            }
          </div>
        `;
        }

        const bgClass =
          {
            gray: "bg-gray-50",
            yellow: "bg-yellow-50",
            orange: "bg-orange-50",
            green: "bg-green-50",
          }[statusColor] || "bg-gray-50";

        const borderClass =
          {
            gray: "border-gray-200",
            yellow: "border-yellow-200",
            orange: "border-orange-200",
            green: "border-green-200",
          }[statusColor] || "border-gray-200";

        const timeInfo = game.revealDeadline
          ? formatTimeRemaining(game.revealDeadline)
          : null;

        return `
        <div class="${bgClass} border-2 ${borderClass} rounded-xl p-4">
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Game ID:</span>
              <span class="text-xs font-mono text-purple-600">${
                game.gameId
              }</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm font-semibold text-gray-700">Status:</span>
              <span class="text-sm font-semibold text-${statusColor}-600">${statusText}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600">Bet Amount:</span>
              <span class="text-sm font-semibold">${betAmountFormatted} tokens</span>
            </div>
            ${
              game.player2
                ? `
              <div class="flex justify-between items-center">
                <span class="text-sm text-gray-600">Player 2:</span>
                <span class="text-xs font-mono text-purple-600">${game.player2.slice(
                  0,
                  6
                )}...${game.player2.slice(-4)}</span>
              </div>
            `
                : ""
            }
            ${
              timeInfo
                ? `
              <div class="flex justify-between items-center">
                <span class="text-sm ${
                  timeInfo.overdue
                    ? "text-red-600 font-bold"
                    : "text-orange-600"
                }">${
                    timeInfo.overdue
                      ? "⏰ Deadline Passed"
                      : "⏳ Time Remaining"
                  }:</span>
                <span class="text-sm font-semibold ${
                  timeInfo.overdue ? "text-red-600" : "text-orange-600"
                }">${timeInfo.text}</span>
              </div>
            `
                : ""
            }
            ${actionButton}
          </div>
        </div>
      `;
      })
    );

    gamesListDiv.innerHTML = gameHTMLs.join("");

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
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    log(`❌ Error refreshing games: ${error.message}`);
    // Show error feedback briefly
    if (refreshBtn) {
      refreshBtn.innerHTML = "❌ Error";
      await new Promise((resolve) => setTimeout(resolve, 2000));
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
window.selectMoveForGame = function (gameIdDisplay, move, gameId) {
  const moveNames = ["Rock 🪨", "Paper 📄", "Scissors ✂️"];

  // Update global move state
  gameState.move = move;

  // Track that this game has a move selected
  selectedMovesByGame[gameIdDisplay] = move;

  // Update the specific game card UI
  const moveStatusDiv = document.getElementById(`${gameIdDisplay}-move-status`);
  const joinBtn = document.getElementById(`${gameIdDisplay}-join-btn`);

  if (moveStatusDiv) {
    moveStatusDiv.innerHTML = `<span class="text-green-600 font-semibold">✓ Selected: ${moveNames[move]}</span>`;
  }

  if (joinBtn) {
    // Enable the join button
    const gameContainer = document.getElementById(gameId);
    const isExpired =
      gameContainer && gameContainer.classList.contains("bg-red-50");

    if (!isExpired) {
      joinBtn.disabled = false;
      joinBtn.classList.remove(
        "bg-gray-300",
        "text-gray-600",
        "cursor-not-allowed"
      );
      joinBtn.classList.add(
        "bg-gradient-to-r",
        "from-purple-600",
        "to-indigo-600",
        "text-white",
        "hover:from-purple-700",
        "hover:to-indigo-700",
        "transform",
        "hover:scale-105",
        "transition-all"
      );
    }
  }

  // Highlight selected move button
  const gameCard = document.getElementById(gameId);
  if (gameCard) {
    const moveButtons = gameCard.querySelectorAll(".move-btn");
    moveButtons.forEach((btn, index) => {
      if (index === move) {
        btn.classList.add(
          "border-4",
          "border-green-400",
          "ring-4",
          "ring-green-200"
        );
      } else {
        btn.classList.remove(
          "border-4",
          "border-green-400",
          "ring-4",
          "ring-green-200"
        );
      }
    });
  }

  log(`✅ Move selected: ${moveNames[move]}`);
};

// Join game (Taker/Player2)
window.joinGame = async function (gameId, move) {
  console.log("joinGame called with:", {
    gameId,
    move,
    type: typeof gameId,
    typeMove: typeof move,
  });
  log("🎮 Join game button clicked!");

  const gameIdDisplay = `game-${gameId}`;
  const joinBtn = document.getElementById(`${gameIdDisplay}-join-btn`);
  const originalBtnText = joinBtn ? joinBtn.innerHTML : "";
  const originalBtnDisabled = joinBtn ? joinBtn.disabled : false;

  // Disable button and show loading state
  if (joinBtn) {
    joinBtn.disabled = true;
    joinBtn.innerHTML = "⏳ Joining...";
  }

  try {
    log("🔍 Step 1: Checking signer...");
    if (!signer) {
      log("❌ Please connect your wallet first");
      if (joinBtn) {
        joinBtn.disabled = originalBtnDisabled;
        joinBtn.innerHTML = originalBtnText;
      }
      return;
    }
    log("✅ Signer found");

    log("🔍 Step 2: Checking contract...");
    if (!rpsContract) {
      log("❌ DegenRPS contract not initialized. Initializing now...");
      try {
        await initializeContracts();
        if (!rpsContract) {
          throw new Error("DegenRPS contract still not initialized");
        }
        log("✅ Contract initialized");
      } catch (error) {
        log(`❌ Failed to initialize contracts: ${error.message}`);
        console.error("Contract initialization error:", error);
        if (joinBtn) {
          joinBtn.disabled = originalBtnDisabled;
          joinBtn.innerHTML = originalBtnText;
        }
        return;
      }
    }
    log("✅ Contract found");

    // Move can be passed as parameter or from gameState
    log("🔍 Step 3: Validating move...");
    const player2Move =
      move !== null && move !== undefined ? move : gameState.move;
    console.log("Player2 move:", {
      move,
      gameStateMove: gameState.move,
      player2Move,
    });
    if (player2Move === null || player2Move === undefined) {
      log("❌ Please select your move first");
      if (joinBtn) {
        joinBtn.disabled = originalBtnDisabled;
        joinBtn.innerHTML = originalBtnText;
      }
      return;
    }
    log(`✅ Move validated: ${player2Move}`);

    // Convert move to DegenRPS Move enum (Rock=1, Paper=2, Scissors=3)
    // Our frontend uses 0=Rock, 1=Paper, 2=Scissors, but DegenRPS uses 1=Rock, 2=Paper, 3=Scissors
    const moveEnum = Number(player2Move) + 1; // Convert 0,1,2 to 1,2,3
    log(
      `✅ Move enum: ${moveEnum} (${
        player2Move === 0 ? "Rock" : player2Move === 1 ? "Paper" : "Scissors"
      })`
    );

    log("🔍 Step 4: Checking network...");
    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) {
      log("❌ Please switch to the correct network");
      if (joinBtn) {
        joinBtn.disabled = originalBtnDisabled;
        joinBtn.innerHTML = originalBtnText;
      }
      return;
    }
    log("✅ Network OK");

    // Convert gameId to BigInt for contract calls
    log("🔍 Step 5: Getting game details...");
    const gameIdBigInt =
      typeof gameId === "bigint" ? gameId : BigInt(gameId.toString());
    log(`📋 Getting game details for gameId: ${gameIdBigInt}...`);

    // Get game details to check bet amount and token
    let game;
    try {
      game = await rpsContract.getGame(gameIdBigInt);
      console.log("Game details:", game);
      log("✅ Game details retrieved");
    } catch (gameError) {
      log(`❌ Error getting game details: ${gameError.message}`);
      console.error("Game details error:", gameError);
      if (joinBtn) {
        joinBtn.disabled = originalBtnDisabled;
        joinBtn.innerHTML = originalBtnText;
      }
      throw gameError;
    }

    // Handle both array and object responses
    const isArray =
      Array.isArray(game) ||
      (typeof game === "object" && game !== null && game.length !== undefined);
    const tokenAddress = isArray ? game[2] : game.token;
    const betAmount = isArray ? game[3] : game.betAmount;
    const gameState_enum = isArray ? Number(game[8]) : Number(game.state);

    log(
      `Game state: ${gameState_enum} (0=WaitingForPlayer2, 1=WaitingForReveal, 2=Settled)`
    );

    // Check game state
    if (gameState_enum !== 0) {
      // 0 = WaitingForPlayer2
      log(`❌ Game is not available to join (state: ${gameState_enum})`);
      if (joinBtn) {
        joinBtn.disabled = originalBtnDisabled;
        joinBtn.innerHTML = originalBtnText;
      }
      return;
    }

    // Get token contract
    // Ensure erc20ABI is available
    if (!erc20ABI) {
      erc20ABI = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function balanceOf(address account) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
        "function symbol() external view returns (string)",
      ];
    }
    const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, signer);
    const decimals = await safeTokenCall(tokenContract, "decimals", 18);
    const tokenSymbol = await safeTokenCall(tokenContract, "symbol", "TOKEN");
    const userAddress = await signer.getAddress();
    const DEGEN_RPS_ADDRESS = rpsContract.target;

    // Check balance
    log("🔍 Step 6: Checking balance...");
    try {
      const balance = await safeTokenCallWithParam(
        tokenContract,
        "balanceOf",
        userAddress,
        0n
      );
      log(
        `💰 Balance: ${ethers.formatUnits(balance, decimals)} ${tokenSymbol}`
      );
      if (balance < betAmount) {
        const errorMsg = `Insufficient balance. You need ${ethers.formatUnits(
          betAmount,
          decimals
        )} ${tokenSymbol}, but you have ${ethers.formatUnits(
          balance,
          decimals
        )} ${tokenSymbol}`;
        log(`❌ ${errorMsg}`);
        if (joinBtn) {
          joinBtn.disabled = originalBtnDisabled;
          joinBtn.innerHTML = originalBtnText;
        }
        throw new Error(errorMsg);
      }
      log(
        `✅ Balance sufficient: ${ethers.formatUnits(
          balance,
          decimals
        )} ${tokenSymbol}`
      );
    } catch (balanceError) {
      log(`❌ Error checking balance: ${balanceError.message}`);
      console.error("Balance check error:", balanceError);
      if (joinBtn) {
        joinBtn.disabled = originalBtnDisabled;
        joinBtn.innerHTML = originalBtnText;
      }
      throw balanceError;
    }

    // Check allowance
    log("🔍 Step 7: Checking token approval...");
    try {
      const allowance = await safeTokenCallWithParam(
        tokenContract,
        "allowance",
        [userAddress, DEGEN_RPS_ADDRESS],
        0n
      );
      log(
        `🔓 Allowance: ${ethers.formatUnits(
          allowance,
          decimals
        )} ${tokenSymbol}`
      );
      if (allowance < betAmount) {
        const errorMsg = `Insufficient allowance. Please approve ${tokenSymbol} for DegenRPS contract first.`;
        log(`❌ ${errorMsg}`);

        // Show approval button in the game card
        const moveStatusDiv = document.getElementById(
          `${gameIdDisplay}-move-status`
        );
        if (moveStatusDiv) {
          moveStatusDiv.innerHTML = `
            <div class="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-3 mb-2">
              <p class="text-sm text-yellow-800 font-semibold mb-2">⚠️ Token approval required</p>
              <p class="text-xs text-yellow-700 mb-2">You need to approve ${tokenSymbol} before joining this game.</p>
              <button 
                id="${gameIdDisplay}-approve-btn"
                class="w-full px-4 py-2 bg-gradient-to-r from-yellow-600 to-orange-600 text-white font-semibold rounded-lg hover:from-yellow-700 hover:to-orange-700 transform hover:scale-105 transition-all duration-200 shadow-md hover:shadow-lg text-sm"
              >
                🔓 Approve ${tokenSymbol}
              </button>
            </div>
          `;

          // Add click handler for approve button
          const approveBtn = document.getElementById(
            `${gameIdDisplay}-approve-btn`
          );
          if (approveBtn) {
            // Remove any existing listeners by cloning
            const newApproveBtn = approveBtn.cloneNode(true);
            approveBtn.parentNode.replaceChild(newApproveBtn, approveBtn);

            newApproveBtn.addEventListener("click", async () => {
              await approveTokenForTakerGame(
                tokenContract,
                tokenSymbol,
                DEGEN_RPS_ADDRESS,
                betAmount,
                gameIdDisplay,
                gameIdBigInt.toString(),
                player2Move
              );
            });
          }
        }

        if (joinBtn) {
          joinBtn.disabled = true;
          joinBtn.innerHTML = "⚠️ Approval Required";
          joinBtn.classList.remove(
            "bg-gradient-to-r",
            "from-purple-600",
            "to-indigo-600",
            "text-white"
          );
          joinBtn.classList.add(
            "bg-gray-400",
            "text-gray-700",
            "cursor-not-allowed"
          );
        }
        throw new Error(errorMsg);
      }
      log(
        `✅ Approval sufficient: ${ethers.formatUnits(
          allowance,
          decimals
        )} ${tokenSymbol}`
      );
    } catch (allowanceError) {
      if (allowanceError.message?.includes("Insufficient allowance")) {
        // Already handled above, just rethrow
        throw allowanceError;
      }
      log(`❌ Error checking allowance: ${allowanceError.message}`);
      console.error("Allowance check error:", allowanceError);
      if (joinBtn) {
        joinBtn.disabled = originalBtnDisabled;
        joinBtn.innerHTML = originalBtnText;
      }
      throw allowanceError;
    }

    // Join the game
    log("🔍 Step 8: Preparing to join game...");
    log(`   Game ID: ${gameIdBigInt}`);
    log(
      `   Move: ${
        player2Move === 0
          ? "Rock 🪨"
          : player2Move === 1
          ? "Paper 📄"
          : "Scissors ✂️"
      } (enum: ${moveEnum})`
    );
    log(
      `   Bet Amount: ${ethers.formatUnits(betAmount, decimals)} ${tokenSymbol}`
    );
    log(`   Contract: ${rpsContract.target}`);
    log(`⏳ Sending transaction to join game...`);
    console.log("Calling joinGame with:", {
      gameIdBigInt,
      moveEnum,
      gameIdType: typeof gameIdBigInt,
      moveEnumType: typeof moveEnum,
    });

    let joinTx;
    try {
      log("📤 Calling rpsContract.joinGame()...");
      joinTx = await rpsContract.joinGame(gameIdBigInt, moveEnum);
      log(`✅ Transaction sent! Hash: ${joinTx.hash}`);
      console.log("Transaction object:", joinTx);
    } catch (txError) {
      if (
        txError.code === 4001 ||
        txError.message?.includes("user rejected") ||
        txError.message?.includes("User denied")
      ) {
        log("❌ Transaction rejected by user in MetaMask");
        if (joinBtn) {
          joinBtn.disabled = originalBtnDisabled;
          joinBtn.innerHTML = originalBtnText;
        }
        return;
      }
      log(`❌ Error sending transaction: ${txError.message}`);
      console.error("Transaction error:", txError);
      throw txError;
    }

    log(`⏳ Waiting for transaction confirmation...`);

    let joinReceipt;
    try {
      joinReceipt = await joinTx.wait();
      log(`✅ Transaction confirmed in block ${joinReceipt.blockNumber}`);
      log(`🎉 Successfully joined game ${gameIdBigInt}!`);
    } catch (waitError) {
      log(`❌ Transaction failed: ${waitError.message}`);
      if (waitError.receipt) {
        log(`   Block: ${waitError.receipt.blockNumber}`);
      }
      if (joinBtn) {
        joinBtn.disabled = originalBtnDisabled;
        joinBtn.innerHTML = originalBtnText;
      }
      throw waitError;
    }

    // Update game state
    gameState.gameId = gameIdBigInt.toString();
    gameState.role = "taker";
    gameState.move = player2Move;

    // Refresh games list (but don't wait for it to complete)
    loadActiveGames().catch((err) => {
      console.error("Error refreshing games after join:", err);
    });

    // Show success feedback
    if (joinBtn) {
      joinBtn.innerHTML = "✅ Joined!";
      joinBtn.classList.add("bg-green-600");
      setTimeout(() => {
        joinBtn.innerHTML = originalBtnText;
        joinBtn.classList.remove("bg-green-600");
        joinBtn.disabled = originalBtnDisabled;
      }, 2000);
    }
  } catch (error) {
    log(`❌ Error joining game: ${error.message}`);
    console.error("Full error:", error);
    if (error.reason) {
      log(`   Error reason: ${error.reason}`);
    }
    if (error.code === 4001 || error.message?.includes("user rejected")) {
      log(`   Transaction was rejected in MetaMask`);
    }

    // Restore button state
    if (joinBtn) {
      joinBtn.disabled = originalBtnDisabled;
      joinBtn.innerHTML = originalBtnText;
    }
  }
};

// Approve token for Taker when joining a game
async function approveTokenForTakerGame(
  tokenContract,
  tokenSymbol,
  degenRpsAddress,
  betAmount,
  gameIdDisplay,
  gameId,
  player2Move
) {
  log(`🔓 Approving ${tokenSymbol} for DegenRPS contract...`);

  const approveBtn = document.getElementById(`${gameIdDisplay}-approve-btn`);
  const originalApproveText = approveBtn ? approveBtn.innerHTML : "";

  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.innerHTML = "⏳ Approving...";
  }

  try {
    if (!signer) {
      log("❌ Please connect your wallet first");
      if (approveBtn) {
        approveBtn.disabled = false;
        approveBtn.innerHTML = originalApproveText;
      }
      return;
    }

    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) {
      log("❌ Please switch to the correct network");
      if (approveBtn) {
        approveBtn.disabled = false;
        approveBtn.innerHTML = originalApproveText;
      }
      return;
    }

    // Use max approval for convenience (user can join multiple games)
    const maxApproval = ethers.MaxUint256;

    log(`🔓 Approving ${tokenSymbol} for DegenRPS...`);
    log(`   Token: ${tokenSymbol}`);
    log(`   DegenRPS: ${degenRpsAddress}`);
    log(`   Amount: Maximum (${maxApproval.toString()})`);

    const tx = await tokenContract.approve(degenRpsAddress, maxApproval);
    log(`📤 Approval transaction sent: ${tx.hash}`);
    log(`⏳ Waiting for confirmation...`);

    const receipt = await tx.wait();
    log(
      `✅ ${tokenSymbol} approved! Confirmed in block ${receipt.blockNumber}`
    );

    // Update UI
    const moveStatusDiv = document.getElementById(
      `${gameIdDisplay}-move-status`
    );
    if (moveStatusDiv) {
      moveStatusDiv.innerHTML = `
        <div class="bg-green-50 border-2 border-green-300 rounded-lg p-2 mb-2">
          <p class="text-sm text-green-800 font-semibold">✅ Token approved! You can now join the game.</p>
        </div>
      `;
    }

    // Re-enable join button
    const joinBtn = document.getElementById(`${gameIdDisplay}-join-btn`);
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.innerHTML = "🎮 Join This Game";
      joinBtn.classList.remove(
        "bg-gray-400",
        "text-gray-700",
        "cursor-not-allowed"
      );
      joinBtn.classList.add(
        "bg-gradient-to-r",
        "from-purple-600",
        "to-indigo-600",
        "text-white",
        "hover:from-purple-700",
        "hover:to-indigo-700",
        "transform",
        "hover:scale-105",
        "transition-all"
      );
    }

    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.innerHTML = "✅ Approved";
      approveBtn.classList.add("bg-green-600");
      setTimeout(() => {
        if (approveBtn) {
          approveBtn.style.display = "none";
        }
      }, 2000);
    }

    // Auto-retry joining the game after approval
    log("🔄 Retrying to join game after approval...");
    setTimeout(() => {
      joinGame(gameId, player2Move);
    }, 1000);
  } catch (error) {
    log(`❌ Error approving token: ${error.message}`);
    console.error("Approval error:", error);

    if (error.code === 4001 || error.message?.includes("user rejected")) {
      log("❌ Transaction rejected by user in MetaMask");
    }

    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.innerHTML = originalApproveText;
    }

    const moveStatusDiv = document.getElementById(
      `${gameIdDisplay}-move-status`
    );
    if (moveStatusDiv) {
      moveStatusDiv.innerHTML = `
        <div class="bg-red-50 border-2 border-red-300 rounded-lg p-2 mb-2">
          <p class="text-sm text-red-800 font-semibold">❌ Approval failed: ${error.message}</p>
          <button 
            id="${gameIdDisplay}-approve-btn-retry"
            class="mt-2 w-full px-4 py-2 bg-gradient-to-r from-yellow-600 to-orange-600 text-white font-semibold rounded-lg hover:from-yellow-700 hover:to-orange-700 transform hover:scale-105 transition-all duration-200 shadow-md hover:shadow-lg text-sm"
          >
            🔄 Retry Approval
          </button>
        </div>
      `;

      const retryBtn = document.getElementById(
        `${gameIdDisplay}-approve-btn-retry`
      );
      if (retryBtn) {
        retryBtn.addEventListener("click", async () => {
          await approveTokenForTakerGame(
            tokenContract,
            tokenSymbol,
            degenRpsAddress,
            betAmount,
            gameIdDisplay,
            gameId,
            player2Move
          );
        });
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
  console.log("revealMakerMove called with:", {
    gameId,
    commitmentHash,
    typeGameId: typeof gameId,
    typeCommitmentHash: typeof commitmentHash,
  });
  log("🔓 Reveal Move button clicked!");

  if (!signer || !rpsContract || !noir || !backend) {
    log("❌ Contracts or Noir not initialized");
    console.error("Missing:", {
      signer: !!signer,
      rpsContract: !!rpsContract,
      noir: !!noir,
      backend: !!backend,
    });
    return;
  }

  log("🔍 Step 1: Initial checks passed");

  // Set game state for this specific game
  const originalGameId = gameState.gameId;
  const originalCommitment = gameState.commitment;
  const originalRole = gameState.role;

  try {
    gameState.gameId = gameId;
    gameState.commitment = commitmentHash; // commitmentHash parameter is the commitment
    gameState.role = "maker";

    // Get the game data to find the salt and move
    log("🔍 Step 2: Getting game data from localStorage...");
    const trackedGames = getMakerGames();
    console.log("Tracked games:", trackedGames);
    console.log(
      "Looking for commitmentHash:",
      commitmentHash,
      "or gameId:",
      gameId
    );
    const gameData = trackedGames[commitmentHash] || trackedGames[gameId];
    console.log("Found game data:", gameData);

    if (!gameData) {
      log("❌ Game data not found. Cannot reveal without salt.");
      log(`   Searched for commitmentHash: ${commitmentHash}`);
      log(`   Searched for gameId: ${gameId}`);
      log(`   Available keys: ${Object.keys(trackedGames).join(", ")}`);
      return;
    }

    // Get salt and move from localStorage (stored when game was created)
    log("🔍 Step 3: Extracting salt and move...");
    const salt = gameData.salt || gameState.salt;
    const move =
      gameData.move !== null && gameData.move !== undefined
        ? gameData.move
        : gameState.move;
    console.log("Salt:", salt, "Move:", move);

    if (!salt) {
      log("❌ Salt not found. Cannot reveal this game.");
      log(`   Game data: ${JSON.stringify(gameData)}`);
      return;
    }

    if (move === null || move === undefined) {
      log("❌ Move not found. Cannot reveal this game.");
      log(`   Game data: ${JSON.stringify(gameData)}`);
      return;
    }

    log(`✅ Salt and move found: move=${move}, salt=${salt.slice(0, 10)}...`);

    // Convert gameId to BigInt for contract calls
    const gameIdBigInt =
      typeof gameId === "bigint" ? gameId : BigInt(gameId.toString());

    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) {
      log("❌ Please switch to the correct network");
      return;
    }

    log("Getting game state from DegenRPS contract...");
    const game = await rpsContract.getGame(gameIdBigInt);

    // Check if it's an array or object
    const isArray =
      Array.isArray(game) ||
      (typeof game === "object" && game.length !== undefined);

    // Safely access fields
    let taker, takerMove, revealDeadlineBigInt;
    if (isArray && game.length > 10) {
      taker = game[1]; // player2 (index 1 in the struct)
      takerMove = game[6]; // player2Move (index 6 in the struct)
      revealDeadlineBigInt = game[10];
    } else {
      taker = game.player2;
      takerMove = game.player2Move;
      revealDeadlineBigInt = game.revealDeadline;
    }

    log(`🔍 Step 6: Checking game state...`);
    log(`   Taker: ${taker}`);
    log(`   Taker move (from contract): ${takerMove}`);

    // Check that Taker has joined
    if (taker === ethers.ZeroAddress || takerMove === 0 || takerMove === 255) {
      log("⏳ Waiting for taker to join...");
      return;
    }

    const deadline =
      typeof revealDeadlineBigInt === "bigint"
        ? Number(revealDeadlineBigInt)
        : Number(revealDeadlineBigInt.toString());

    const now = Math.floor(Date.now() / 1000);
    if (deadline > 0 && now > deadline) {
      log(`❌ Deadline has passed. (deadline: ${deadline}, now: ${now})`);
      return;
    }

    log("🔍 Step 7: Converting moves...");
    const makerMove = Number(move); // Frontend format: 0=Rock, 1=Paper, 2=Scissors
    const takerMoveContract = Number(takerMove); // DegenRPS enum: 1=Rock, 2=Paper, 3=Scissors

    // Convert taker's move from DegenRPS enum (1,2,3) to frontend format (0,1,2)
    const takerMoveNum = takerMoveContract - 1;

    log(
      `   Maker move (frontend): ${makerMove} (${
        makerMove === 0 ? "Rock" : makerMove === 1 ? "Paper" : "Scissors"
      })`
    );
    log(
      `   Taker move (contract enum): ${takerMoveContract} (${
        takerMoveContract === 1
          ? "Rock"
          : takerMoveContract === 2
          ? "Paper"
          : "Scissors"
      })`
    );
    log(
      `   Taker move (frontend): ${takerMoveNum} (${
        takerMoveNum === 0 ? "Rock" : takerMoveNum === 1 ? "Paper" : "Scissors"
      })`
    );

    // Validate moves (frontend format: 0-2)
    if (
      makerMove < 0 ||
      makerMove > 2 ||
      takerMoveNum < 0 ||
      takerMoveNum > 2
    ) {
      log(
        `❌ Invalid moves: makerMove=${makerMove}, takerMove=${takerMoveNum} (from contract enum ${takerMoveContract})`
      );
      throw new Error(
        `Invalid moves: makerMove=${makerMove}, takerMove=${takerMoveNum}`
      );
    }

    log("🔍 Step 8: Generating ZK proof...");
    log(
      `✅ Maker's move: ${
        makerMove === 0 ? "Rock" : makerMove === 1 ? "Paper" : "Scissors"
      } (${makerMove})`
    );
    log(
      `✅ Taker's move: ${
        takerMoveNum === 0 ? "Rock" : takerMoveNum === 1 ? "Paper" : "Scissors"
      } (${takerMoveNum})`
    );

    const winner = determineWinnerLocal(makerMove, takerMoveNum);
    log(
      `Expected winner: ${
        winner === 0 ? "Tie" : winner === 1 ? "Maker" : "Taker"
      } (${winner})`
    );

    // Generate proof - Noir expects Field values (frontend format: 0,1,2)
    const inputs = {
      player1_move: makerMove, // Frontend format: 0=Rock, 1=Paper, 2=Scissors
      player2_move: takerMoveNum, // Frontend format: 0=Rock, 1=Paper, 2=Scissors
      winner: winner, // 0=Tie, 1=Player1, 2=Player2
    };

    log(
      `Proof inputs: player1_move=${inputs.player1_move}, player2_move=${inputs.player2_move}, winner=${inputs.winner}`
    );

    log(
      `Calling noir.execute with inputs: player1_move=${makerMove}, player2_move=${takerMoveNum}, winner=${winner}`
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

      const proofLength =
        typeof proofBytes === "string"
          ? (proofBytes.length - 2) / 2
          : proofBytes.length;
      log(`📏 Proof length: ${proofLength} bytes`);
    } catch (serializeError) {
      log(`❌ Proof serialization failed: ${serializeError.message}`);
      throw serializeError;
    }

    // Convert move to DegenRPS enum (1=Rock, 2=Paper, 3=Scissors) for the contract call
    const moveEnum = makerMove + 1;

    // Verify commitment matches before sending transaction
    log("🔍 Step 9: Verifying commitment...");
    // IMPORTANT: The contract verifies commitment using the enum move (1,2,3), not frontend format (0,1,2)
    // But when we created the game, we used frontend format. Let's check both to see which one matches.
    const commitmentCheckFrontend = ethers.keccak256(
      ethers.solidityPacked(["uint8", "bytes32"], [makerMove, salt])
    );
    const commitmentCheckEnum = ethers.keccak256(
      ethers.solidityPacked(["uint8", "bytes32"], [moveEnum, salt])
    );
    const storedCommitment = isArray ? game[4] : game.commitment;
    log(
      `   Calculated commitment (frontend move ${makerMove}): ${commitmentCheckFrontend}`
    );
    log(
      `   Calculated commitment (enum move ${moveEnum}): ${commitmentCheckEnum}`
    );
    log(`   Stored commitment: ${storedCommitment}`);

    // Check which format matches - the contract expects enum format
    let commitmentMatches = false;
    if (commitmentCheckEnum.toLowerCase() === storedCommitment.toLowerCase()) {
      commitmentMatches = true;
      log(`✅ Commitment verified with enum format!`);
    } else if (
      commitmentCheckFrontend.toLowerCase() === storedCommitment.toLowerCase()
    ) {
      // This means the game was created with frontend format, but contract expects enum format
      log(
        `⚠️ Commitment matches frontend format, but contract expects enum format!`
      );
      log(`   This suggests the game was created incorrectly.`);
      throw new Error(
        "Commitment format mismatch - game was created with wrong move format"
      );
    } else {
      log(`❌ Commitment mismatch!`);
      log(`   Expected: ${storedCommitment}`);
      log(`   Got (frontend): ${commitmentCheckFrontend}`);
      log(`   Got (enum): ${commitmentCheckEnum}`);
      log(`   Move (frontend): ${makerMove}, Move (enum): ${moveEnum}`);
      log(`   Salt: ${salt.slice(0, 10)}...`);
      throw new Error(
        "Commitment verification failed - move or salt is incorrect"
      );
    }

    try {
      log("🔍 Step 10: Estimating gas...");
      const gasEstimate = await rpsContract.revealAndSettle.estimateGas(
        gameIdBigInt,
        moveEnum,
        salt,
        proofBytes
      );
      log(`⛽ Gas estimate: ${gasEstimate.toString()}`);

      log("🔍 Step 11: Sending reveal transaction...");
      log(`   gameId: ${gameIdBigInt}`);
      log(`   moveEnum: ${moveEnum} (frontend move: ${makerMove})`);
      log(`   salt: ${salt.slice(0, 10)}...`);
      log(`   proofBytes length: ${proofBytes.length} chars`);

      const tx = await rpsContract.revealAndSettle(
        gameIdBigInt,
        moveEnum,
        salt,
        proofBytes,
        { gasLimit: gasEstimate * BigInt(2) }
      );

      log(`📤 Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();
      log(
        `✅ Game settled! Transaction confirmed in block ${receipt.blockNumber}`
      );

      // Get updated game state to see winner
      const updatedGame = await rpsContract.getGame(gameId);
      const gameWinner = Array.isArray(updatedGame)
        ? updatedGame[11]
        : updatedGame.winner;
      const winnerAddress = gameWinner;

      if (winnerAddress === ethers.ZeroAddress) {
        log(`🎉 Result: Tie! Both players can withdraw their bet.`);
      } else {
        const userAddress = await signer.getAddress();
        if (winnerAddress.toLowerCase() === userAddress.toLowerCase()) {
          log(`🎉 You won! You can withdraw the prize pool.`);
        } else {
          log(`😔 You lost. The winner can withdraw the prize pool.`);
        }
      }

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
    gameState.commitment = originalCommitment;
    gameState.role = originalRole;
  }
}

// Make revealMakerMove available globally for onclick handlers
window.revealMakerMove = revealMakerMove;

// Withdraw prize (for winners or ties)
window.withdrawPrize = async function (gameId) {
  if (!signer || !rpsContract) {
    log("❌ Contracts not initialized");
    return;
  }

  try {
    log(`💰 Withdrawing prize for game ${gameId}...`);
    const withdrawTx = await rpsContract.withdraw(gameId);
    log(`📤 Transaction sent: ${withdrawTx.hash}`);
    const receipt = await withdrawTx.wait();
    log(
      `✅ Prize withdrawn! Transaction confirmed in block ${receipt.blockNumber}`
    );

    // Refresh games list - check which view is active
    const makerView = document.getElementById("makerView");
    const takerView = document.getElementById("takerView");

    if (makerView && !makerView.classList.contains("hidden")) {
      await loadMakerGames();
    }
    if (takerView && !takerView.classList.contains("hidden")) {
      await loadAllTakerGames();
    }
  } catch (error) {
    log(`❌ Error withdrawing prize: ${error.message}`);
    console.error("Withdraw error:", error);
  }
};

// Update game status display
async function updateGameStatus() {
  const statusDiv = document.getElementById("gameResolutionStatus");
  if (!statusDiv) {
    return;
  }

  // If no game, show default message
  if (!gameState.gameId && !gameState.commitment) {
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

    // Try to get status from DegenRPS contract if we have gameId
    if (gameState.gameId && rpsContract) {
      try {
        game = await rpsContract.getGame(gameState.gameId);
        const isArray =
          Array.isArray(game) ||
          (typeof game === "object" && game.length !== undefined);
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
        log(`⚠️ Error reading from DegenRPS contract: ${rpsError.message}`);
      }
    }

    const borderColorClass =
      {
        yellow: "border-yellow-200",
        blue: "border-blue-200",
        orange: "border-orange-200",
        green: "border-green-200",
      }[statusColor] || "border-gray-200";

    const gameIdDisplay = gameState.gameId
      ? `Game ID: <span class="font-mono text-purple-600">${gameState.gameId}</span>`
      : `Commitment: <span class="font-mono text-purple-600 text-xs">${gameState.commitment?.slice(
          0,
          10
        )}...${gameState.commitment?.slice(-8)}</span>`;

    statusDiv.innerHTML = `
      <div class="bg-white rounded-xl p-4 border-2 ${borderColorClass} slide-up">
        <div class="flex flex-wrap items-center gap-3 mb-2">
          <span class="status-badge status-${statusText
            .toLowerCase()
            .replace(" ", "-")}">${statusText}</span>
          <span class="text-gray-600 font-semibold text-sm">${gameIdDisplay}</span>
        </div>
        <p class="text-gray-700 font-medium text-sm">${details}</p>
        <p class="text-gray-600 text-xs mt-2">
          👤 You are <span class="font-semibold text-purple-600">Player ${
            gameState.playerNumber
          }</span>
        </p>
      </div>
    `;

    // Show reveal button if Player 1 and Player 2 has joined
    if (gameState.playerNumber === 1 && game && rpsContract) {
      const isArray =
        Array.isArray(game) ||
        (typeof game === "object" && game.length !== undefined);
      const status = isArray ? game[3] : game.status;
      const player2 = isArray ? game[2] : game.player2;
      const statusNum = Number(status);

      if (
        statusNum === 2 &&
        player2 !== ethers.ZeroAddress &&
        !gameState.isRevealed
      ) {
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
    step3Checkmark.classList.toggle(
      "hidden",
      !gameState.isCommitted || gameState.playerNumber !== 1
    );
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
    makerTabBtn?.classList.add(
      "bg-gradient-to-r",
      "from-blue-600",
      "to-indigo-600",
      "text-white",
      "shadow-lg"
    );
    takerTabBtn?.classList.remove(
      "bg-gradient-to-r",
      "from-blue-600",
      "to-indigo-600",
      "text-white",
      "shadow-lg"
    );
    takerTabBtn?.classList.add("bg-gray-200", "text-gray-700");
    // Load maker's games when switching to maker view
    if (signer) {
      loadMakerGamesWithFeedback();
    }
  } else {
    makerView?.classList.add("hidden");
    takerView?.classList.remove("hidden");
    takerTabBtn?.classList.remove("bg-gray-200", "text-gray-700");
    takerTabBtn?.classList.add(
      "bg-gradient-to-r",
      "from-blue-600",
      "to-indigo-600",
      "text-white",
      "shadow-lg"
    );
    makerTabBtn?.classList.remove(
      "bg-gradient-to-r",
      "from-blue-600",
      "to-indigo-600",
      "text-white",
      "shadow-lg"
    );
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

  // Add global error handler to catch any unhandled errors
  window.addEventListener("error", (event) => {
    console.error("Global error caught:", event.error);
    if (typeof log === "function") {
      log(`❌ JavaScript error: ${event.error?.message || event.message}`);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", event.reason);
    if (typeof log === "function") {
      log(
        `❌ Unhandled promise rejection: ${
          event.reason?.message || event.reason
        }`
      );
    }
  });

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
    makerApproveBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Maker approve button clicked!");
      try {
        await approveToken("maker");
      } catch (error) {
        console.error("Error in approveToken:", error);
        log(`❌ Unexpected error: ${error.message}`);
        // Re-throw to ensure error is visible
        throw error;
      }
    });
    console.log("✅ Maker approve button listener added");
  } else {
    console.error("❌ Maker approve button not found in DOM");
    // Log all button IDs to help debug
    console.error(
      "Available button IDs:",
      Array.from(document.querySelectorAll("button[id]")).map((b) => b.id)
    );
  }

  const makerCreateBtn = document.getElementById("makerCreateGameBtn");
  if (makerCreateBtn) {
    makerCreateBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Maker create game button clicked!");
      console.log("Button disabled state:", makerCreateBtn.disabled);

      // Check if button is disabled
      if (makerCreateBtn.disabled) {
        console.warn("Button is disabled, cannot create game");
        const hasMove = gameState.move !== null && gameState.move !== undefined;
        const amountInput = document.getElementById("makerSwapAmount")?.value;
        const hasAmount = amountInput && parseFloat(amountInput) > 0;
        const tokenSelect = document.getElementById("makerTokenSelect");
        const tokenAddress =
          tokenSelect?.value ||
          document.getElementById("makerTokenAddress")?.value;
        const hasToken = tokenAddress && ethers.isAddress(tokenAddress);

        if (!hasMove) {
          log("⚠️ Please select a move first (Rock, Paper, or Scissors)");
        } else if (!hasToken) {
          log("⚠️ Please select a token from the dropdown");
        } else if (!hasAmount) {
          log("⚠️ Please enter a bet amount");
        } else {
          log("⚠️ Button is disabled. Please check all requirements.");
        }
        return;
      }

      try {
        await createMakerGame();
      } catch (error) {
        console.error("Error in createMakerGame:", error);
        log(`❌ Unexpected error: ${error.message}`);
        console.error("Full error:", error);
        // Re-throw to ensure error is visible in console
        throw error;
      }
    });
    console.log("✅ Maker create button listener added");
  } else {
    console.error("❌ Maker create button not found in DOM");
    // Log all button IDs to help debug
    console.error(
      "Available button IDs:",
      Array.from(document.querySelectorAll("button[id]")).map((b) => b.id)
    );
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

  // Token selection is handled via dropdown

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

  // Token dropdown selection
  const makerTokenSelect = document.getElementById("makerTokenSelect");
  if (makerTokenSelect) {
    makerTokenSelect.addEventListener("change", async (e) => {
      const selectedAddress = e.target.value;
      // Update hidden input field
      const hiddenInput = document.getElementById("makerTokenAddress");
      if (hiddenInput) {
        hiddenInput.value = selectedAddress;
      }
      // Update balance and approval status
      await updateMakerTokenBalance();
      await checkMakerApproval();
      updateMakerButtonStates();
    });
    console.log("✅ Maker token select listener added");
  } else {
    console.error("❌ Maker token select element not found");
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
    // Setup event listeners FIRST, before any async operations
    // This ensures buttons work even if deployment loading fails
    setupEventListeners();

    await loadDeployments();
    await initNoir();
    log("🚀 Swap RPS application ready!");
  } catch (error) {
    log(`Failed to initialize: ${error.message}`);
    console.error("Initialization error:", error);
    // Even if initialization fails, event listeners should still work
    // They'll just show errors when clicked
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  // DOM is already ready, run immediately
  init();
}
