import { ethers } from "ethers";
import { log } from "./logger.js";

// Connect wallet
export async function connectWallet(
  updateMakerTokenBalance,
  ensureCorrectNetwork,
  initializeContracts,
  loadMakerGames,
  loadAllTakerGames,
  startAutoRefresh,
  currentView,
  providerRef,
  signerRef
) {
  if (typeof window.ethereum === "undefined") {
    log("❌ MetaMask not found. Please install MetaMask.");
    return;
  }

  try {
    providerRef.current = new ethers.BrowserProvider(window.ethereum);
    if (!providerRef.current) {
      log("❌ Failed to create provider");
      return;
    }
    await ensureCorrectNetwork();
    // Re-check provider after network switch (it might have been updated)
    if (!providerRef.current) {
      providerRef.current = new ethers.BrowserProvider(window.ethereum);
    }
    await providerRef.current.send("eth_requestAccounts", []);
    signerRef.current = await providerRef.current.getSigner();
    const address = await signerRef.current.getAddress();

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
    await initializeContracts(signerRef.current);
    await updateMakerTokenBalance();
    // Auto-load games based on current view
    if (currentView === "maker") {
      await loadMakerGames();
    } else if (signerRef.current) {
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
