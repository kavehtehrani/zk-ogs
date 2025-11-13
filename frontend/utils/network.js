import { ethers } from "ethers";
import { log } from "./logger.js";

// Get network name from chain ID
export function getNetworkName(chainId) {
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
export function normalizeChainId(chainId) {
  if (!chainId) return null;
  if (typeof chainId === "string") {
    if (chainId.startsWith("0x")) {
      return parseInt(chainId, 16).toString();
    }
    return chainId;
  }
  return chainId.toString();
}

// Get block explorer URL for a chain ID
export function getBlockExplorerUrl(chainId) {
  if (!chainId) return [];

  const chainIdNum =
    typeof chainId === "string"
      ? chainId.startsWith("0x")
        ? parseInt(chainId, 16)
        : parseInt(chainId)
      : Number(chainId);

  const explorerMap = {
    1: ["https://etherscan.io"],
    11155111: ["https://sepolia.etherscan.io"],
    5: ["https://goerli.etherscan.io"],
  };

  return explorerMap[chainIdNum] || [];
}

// Ensure we're on the correct network
export async function ensureCorrectNetwork(
  DEPLOYED_CHAIN_ID,
  provider,
  signer,
  initializeContracts,
  DEPLOYED_RPC_URL = null,
  updateProviderAndSigner = null
) {
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

    log(`🔍 Network check: Current=${currentChainId}, Target=${targetChainId}`);

    if (currentChainId === targetChainId) {
      log(`✅ Already on correct network (Chain ID: ${targetChainId})`);
      return true;
    }

    const networkName = getNetworkName(targetChainId);
    log(
      `🔄 Switching from Chain ${currentChainId} to ${networkName} (Chain ID: ${targetChainId})...`
    );

    const targetChainIdHex = `0x${BigInt(targetChainId).toString(16)}`;
    log(`🔧 Requesting switch to chain ID: ${targetChainIdHex}`);

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainIdHex }],
      });
      log(`✅ Switched to ${networkName}`);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Update provider and signer if callback provided
      if (updateProviderAndSigner) {
        await updateProviderAndSigner();
      } else if (provider) {
        // Fallback: update provider if provided
        provider = new ethers.BrowserProvider(window.ethereum);
        if (signer) {
          signer = await provider.getSigner();
          if (initializeContracts) {
            await initializeContracts();
          }
        }
      }

      return true;
    } catch (switchError) {
      log(
        `⚠️ Switch error code: ${switchError.code}, message: ${switchError.message}`
      );

      // Chain doesn't exist, try to add it if we have RPC URL
      if (switchError.code === 4902 && DEPLOYED_RPC_URL) {
        log(`➕ Chain not found in MetaMask. Adding ${networkName} network...`);
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: targetChainIdHex,
                chainName: networkName,
                nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                rpcUrls: [DEPLOYED_RPC_URL],
                blockExplorerUrls: getBlockExplorerUrl(targetChainId),
              },
            ],
          });
          log(`✅ Added ${networkName} network to MetaMask`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Update provider and signer if callback provided
          if (updateProviderAndSigner) {
            await updateProviderAndSigner();
          } else if (provider) {
            // Fallback: update provider if provided
            provider = new ethers.BrowserProvider(window.ethereum);
            if (signer) {
              signer = await provider.getSigner();
              if (initializeContracts) {
                await initializeContracts();
              }
            }
          }

          return true;
        } catch (addError) {
          log(`❌ Could not add network: ${addError.message}`);
          log(`💡 Please manually add the network in MetaMask`);
          log(
            `💡 Chain ID: ${targetChainId} (${targetChainIdHex}), RPC: ${DEPLOYED_RPC_URL}`
          );
          return false;
        }
      } else {
        log(`❌ Could not switch network: ${switchError.message}`);
        log(
          `💡 Please manually switch to ${networkName} (Chain ID: ${targetChainId}) in MetaMask`
        );
        return false;
      }
    }
  } catch (error) {
    log(`❌ Error checking network: ${error.message}`);
    console.error("Network check error:", error);
    return false;
  }
}

// Helper function to format time ago
export function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  return `${seconds} second${seconds !== 1 ? "s" : ""} ago`;
}

// Helper function to format time remaining
export function formatTimeRemaining(deadline) {
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
