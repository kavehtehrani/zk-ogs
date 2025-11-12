import { ethers } from "ethers";

let provider = null;
let signer = null;
let token0Contract = null;
let token1Contract = null;

// Contract addresses and ABIs - will be loaded from deployments.json
let TOKEN0_ADDRESS = null;
let TOKEN1_ADDRESS = null;
let DEPLOYED_CHAIN_ID = null;
let DEPLOYED_RPC_URL = null;

// ERC20 ABI (minimal - just what we need)
const ERC20_ABI = [
  "function mint(address to, uint256 value) public",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
];

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
    80001: "Mumbai",
    137: "Polygon",
    42161: "Arbitrum",
    10: "Optimism",
  };
  
  return networkMap[chainIdNum] || `Chain ${chainIdNum}`;
}

// Normalize chain ID to string for comparison
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
    log("⚠️ No chain ID configured in deployments.json");
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
      if (switchError.code === 4902 && DEPLOYED_RPC_URL) {
        log(`➕ Adding ${networkName} network...`);
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: targetChainIdHex,
                chainName: networkName,
                nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                rpcUrls: [DEPLOYED_RPC_URL],
                blockExplorerUrls: getNetworkName(targetChainId) === "Sepolia" 
                  ? ["https://sepolia.etherscan.io"]
                  : [],
              },
            ],
          });
          log(`✅ Added ${networkName} network`);
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
          provider = new ethers.BrowserProvider(window.ethereum);
          if (signer) {
            signer = await provider.getSigner();
            await initializeContracts();
          }
          
          return true;
        } catch (addError) {
          log(`❌ Could not add network: ${addError.message}`);
          return false;
        }
      } else {
        log(`❌ Could not switch network: ${switchError.message}`);
        return false;
      }
    }
  } catch (error) {
    log(`❌ Error checking network: ${error.message}`);
    return false;
  }
}

// Load deployments.json
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
      if (deployments.contracts.token0) {
        TOKEN0_ADDRESS = deployments.contracts.token0.address;
        log(`✅ Token0 address: ${TOKEN0_ADDRESS}`);
      }
      if (deployments.contracts.token1) {
        TOKEN1_ADDRESS = deployments.contracts.token1.address;
        log(`✅ Token1 address: ${TOKEN1_ADDRESS}`);
      }
    }
    
    // Update UI
    if (TOKEN0_ADDRESS) {
      document.getElementById("token0Address").textContent = `${TOKEN0_ADDRESS.slice(0, 6)}...${TOKEN0_ADDRESS.slice(-4)}`;
    }
    if (TOKEN1_ADDRESS) {
      document.getElementById("token1Address").textContent = `${TOKEN1_ADDRESS.slice(0, 6)}...${TOKEN1_ADDRESS.slice(-4)}`;
    }
    
    // Update network info
    if (DEPLOYED_CHAIN_ID) {
      const networkName = getNetworkName(DEPLOYED_CHAIN_ID);
      document.getElementById("networkInfo").innerHTML = `
        <p class="text-gray-600 text-xs">
          <span class="font-semibold">Network:</span> ${networkName} (Chain ID: ${DEPLOYED_CHAIN_ID})
        </p>
      `;
    }
    
    log("✅ Deployments loaded");
  } catch (error) {
    log(`❌ Error loading deployments: ${error.message}`);
    throw error;
  }
}

// Initialize contract instances
async function initializeContracts() {
  if (!signer || !TOKEN0_ADDRESS || !TOKEN1_ADDRESS) {
    return;
  }

  try {
    token0Contract = new ethers.Contract(TOKEN0_ADDRESS, ERC20_ABI, signer);
    token1Contract = new ethers.Contract(TOKEN1_ADDRESS, ERC20_ABI, signer);
    log("✅ Contracts initialized");
    await updateBalances();
  } catch (error) {
    log(`❌ Error initializing contracts: ${error.message}`);
  }
}

// Update token balances
async function updateBalances() {
  if (!signer || !token0Contract || !token1Contract) {
    return;
  }

  try {
    const address = await signer.getAddress();
    
    // Get Token0 balance
    try {
      const balance0 = await token0Contract.balanceOf(address);
      const decimals0 = await token0Contract.decimals();
      const symbol0 = await token0Contract.symbol();
      const formattedBalance0 = ethers.formatUnits(balance0, decimals0);
      document.getElementById("token0Balance").textContent = `Balance: ${formattedBalance0} ${symbol0}`;
    } catch (error) {
      document.getElementById("token0Balance").textContent = "Balance: Error loading";
    }
    
    // Get Token1 balance
    try {
      const balance1 = await token1Contract.balanceOf(address);
      const decimals1 = await token1Contract.decimals();
      const symbol1 = await token1Contract.symbol();
      const formattedBalance1 = ethers.formatUnits(balance1, decimals1);
      document.getElementById("token1Balance").textContent = `Balance: ${formattedBalance1} ${symbol1}`;
    } catch (error) {
      document.getElementById("token1Balance").textContent = "Balance: Error loading";
    }
  } catch (error) {
    log(`⚠️ Error updating balances: ${error.message}`);
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
    
    // Enable buttons
    document.getElementById("mintToken0Btn").disabled = false;
    document.getElementById("mintToken1Btn").disabled = false;
    document.getElementById("mintToken0CustomBtn").disabled = false;
    document.getElementById("mintToken1CustomBtn").disabled = false;
    document.getElementById("mintBothBtn").disabled = false;
    document.getElementById("refreshBalancesBtn").disabled = false;
  } catch (error) {
    log(`❌ Error connecting wallet: ${error.message}`);
  }
}

// Mint tokens
async function mintToken(tokenContract, tokenName, amount, decimals = 18) {
  if (!signer || !tokenContract) {
    log("❌ Wallet not connected or contract not initialized");
    return;
  }

  try {
    const address = await signer.getAddress();
    const amountWei = ethers.parseUnits(amount.toString(), decimals);
    
    log(`⏳ Minting ${amount} ${tokenName} to ${address.slice(0, 6)}...${address.slice(-4)}...`);
    
    const tx = await tokenContract.mint(address, amountWei);
    log(`📤 Transaction sent: ${tx.hash}`);
    
    const receipt = await tx.wait();
    log(`✅ ${tokenName} minted! Confirmed in block ${receipt.blockNumber}`);
    
    await updateBalances();
  } catch (error) {
    log(`❌ Error minting ${tokenName}: ${error.message}`);
    console.error("Mint error:", error);
  }
}

// Mint Token0 (default 1000)
async function mintToken0() {
  if (!token0Contract) {
    log("❌ Token0 contract not initialized");
    return;
  }
  
  const btn = document.getElementById("mintToken0Btn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Minting...";
  
  try {
    const decimals = await token0Contract.decimals();
    await mintToken(token0Contract, "Token0", "1000", decimals);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Mint Token1 (default 1000)
async function mintToken1() {
  if (!token1Contract) {
    log("❌ Token1 contract not initialized");
    return;
  }
  
  const btn = document.getElementById("mintToken1Btn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Minting...";
  
  try {
    const decimals = await token1Contract.decimals();
    await mintToken(token1Contract, "Token1", "1000", decimals);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Mint Token0 (custom amount)
async function mintToken0Custom() {
  if (!token0Contract) {
    log("❌ Token0 contract not initialized");
    return;
  }
  
  const amountInput = document.getElementById("token0Amount");
  const amount = parseFloat(amountInput.value);
  
  if (isNaN(amount) || amount <= 0) {
    log("❌ Please enter a valid amount");
    return;
  }
  
  const btn = document.getElementById("mintToken0CustomBtn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Minting...";
  
  try {
    const decimals = await token0Contract.decimals();
    await mintToken(token0Contract, "Token0", amount.toString(), decimals);
    amountInput.value = "";
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Mint Token1 (custom amount)
async function mintToken1Custom() {
  if (!token1Contract) {
    log("❌ Token1 contract not initialized");
    return;
  }
  
  const amountInput = document.getElementById("token1Amount");
  const amount = parseFloat(amountInput.value);
  
  if (isNaN(amount) || amount <= 0) {
    log("❌ Please enter a valid amount");
    return;
  }
  
  const btn = document.getElementById("mintToken1CustomBtn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Minting...";
  
  try {
    const decimals = await token1Contract.decimals();
    await mintToken(token1Contract, "Token1", amount.toString(), decimals);
    amountInput.value = "";
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Mint both tokens
async function mintBoth() {
  if (!token0Contract || !token1Contract) {
    log("❌ Contracts not initialized");
    return;
  }
  
  const btn = document.getElementById("mintBothBtn");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "⏳ Minting...";
  
  try {
    const decimals0 = await token0Contract.decimals();
    const decimals1 = await token1Contract.decimals();
    
    await mintToken(token0Contract, "Token0", "1000", decimals0);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay between mints
    await mintToken(token1Contract, "Token1", "1000", decimals1);
    
    log("🎉 Both tokens minted successfully!");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Setup event listeners
function setupEventListeners() {
  console.log("Setting up fund.js event listeners...");
  
  // Add global error handler
  window.addEventListener('error', (event) => {
    console.error('Global error caught:', event.error);
    if (typeof log === 'function') {
      log(`❌ JavaScript error: ${event.error?.message || event.message}`);
    }
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    if (typeof log === 'function') {
      log(`❌ Unhandled promise rejection: ${event.reason?.message || event.reason}`);
    }
  });
  
  const connectBtn = document.getElementById("connectBtn");
  if (connectBtn) {
    connectBtn.addEventListener("click", connectWallet);
    console.log("✅ Connect button listener added");
  } else {
    console.error("❌ Connect button not found");
  }
  
  const mintToken0Btn = document.getElementById("mintToken0Btn");
  if (mintToken0Btn) {
    mintToken0Btn.addEventListener("click", mintToken0);
    console.log("✅ Mint Token0 button listener added");
  } else {
    console.error("❌ Mint Token0 button not found");
  }
  
  const mintToken1Btn = document.getElementById("mintToken1Btn");
  if (mintToken1Btn) {
    mintToken1Btn.addEventListener("click", mintToken1);
    console.log("✅ Mint Token1 button listener added");
  } else {
    console.error("❌ Mint Token1 button not found");
  }
  
  const mintToken0CustomBtn = document.getElementById("mintToken0CustomBtn");
  if (mintToken0CustomBtn) {
    mintToken0CustomBtn.addEventListener("click", mintToken0Custom);
    console.log("✅ Mint Token0 Custom button listener added");
  } else {
    console.error("❌ Mint Token0 Custom button not found");
  }
  
  const mintToken1CustomBtn = document.getElementById("mintToken1CustomBtn");
  if (mintToken1CustomBtn) {
    mintToken1CustomBtn.addEventListener("click", mintToken1Custom);
    console.log("✅ Mint Token1 Custom button listener added");
  } else {
    console.error("❌ Mint Token1 Custom button not found");
  }
  
  const mintBothBtn = document.getElementById("mintBothBtn");
  if (mintBothBtn) {
    mintBothBtn.addEventListener("click", mintBoth);
    console.log("✅ Mint Both button listener added");
  } else {
    console.error("❌ Mint Both button not found");
  }
  
  const refreshBalancesBtn = document.getElementById("refreshBalancesBtn");
  if (refreshBalancesBtn) {
    refreshBalancesBtn.addEventListener("click", updateBalances);
    console.log("✅ Refresh Balances button listener added");
  } else {
    console.error("❌ Refresh Balances button not found");
  }
  
  // Allow Enter key to trigger custom mint
  const token0Amount = document.getElementById("token0Amount");
  if (token0Amount) {
    token0Amount.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        mintToken0Custom();
      }
    });
    console.log("✅ Token0 amount Enter key listener added");
  } else {
    console.error("❌ Token0 amount input not found");
  }
  
  const token1Amount = document.getElementById("token1Amount");
  if (token1Amount) {
    token1Amount.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        mintToken1Custom();
      }
    });
    console.log("✅ Token1 amount Enter key listener added");
  } else {
    console.error("❌ Token1 amount input not found");
  }
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
  
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (accounts.length === 0) {
      log("⚠️ Wallet disconnected");
      document.getElementById("walletInfo").innerHTML = "";
      signer = null;
    } else {
      await connectWallet();
    }
  });
}

// Initialize on load
async function init() {
  try {
    // Setup event listeners FIRST, before any async operations
    setupEventListeners();
    
    await loadDeployments();
    log("🚀 Application ready!");
    log("💡 Connect your wallet to start minting tokens");
  } catch (error) {
    log(`Failed to initialize: ${error.message}`);
    console.error("Initialization error:", error);
    // Even if initialization fails, event listeners should still work
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  // DOM is already ready, run immediately
  init();
}
