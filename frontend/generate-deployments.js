// Generate deployments.json from environment variables at build time
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get environment variables (Vite exposes VITE_* prefixed vars at build time)
const chainId = process.env.VITE_CHAIN_ID;
const rpcUrl = process.env.VITE_RPC_URL;
const degenRPSAddress = process.env.VITE_DEGEN_RPS_ADDRESS;
const token0Address = process.env.VITE_TOKEN0_ADDRESS;
const token1Address = process.env.VITE_TOKEN1_ADDRESS;

// If no env vars are set, keep existing deployments.json (for local dev)
if (!chainId && !rpcUrl && !degenRPSAddress) {
  console.log('⚠️  No environment variables found. Keeping existing deployments.json');
  process.exit(0);
}

// Load existing deployments.json to preserve ABIs and other contracts
let existingDeployments = {};
const deploymentsPath = join(__dirname, 'deployments.json');
try {
  if (existsSync(deploymentsPath)) {
    const existingContent = readFileSync(deploymentsPath, 'utf-8');
    existingDeployments = JSON.parse(existingContent);
  } else {
    console.log('📝 No existing deployments.json found, creating new one');
  }
} catch (error) {
  console.log('⚠️  Error reading existing deployments.json:', error.message);
}

// Build deployments object
const deployments = {
  chainId: chainId || existingDeployments.chainId || '11155111',
  rpcUrl: rpcUrl || existingDeployments.rpcUrl || 'https://sepolia.infura.io/v3/4656866d4b76456fb395cd6c1b744830',
  contracts: {
    ...existingDeployments.contracts,
  }
};

// Update contract addresses from env vars if provided
if (degenRPSAddress) {
  deployments.contracts.degenRPS = {
    ...existingDeployments.contracts?.degenRPS,
    address: degenRPSAddress
  };
}

if (token0Address) {
  deployments.contracts.token0 = {
    ...existingDeployments.contracts?.token0,
    address: token0Address
  };
}

if (token1Address) {
  deployments.contracts.token1 = {
    ...existingDeployments.contracts?.token1,
    address: token1Address
  };
}

// Write deployments.json to both root (for git) and public (for Vite build)
const rootPath = join(__dirname, 'deployments.json');
const publicDir = join(__dirname, 'public');
const publicPath = join(publicDir, 'deployments.json');

// Ensure public directory exists
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}

// Write to root (for development and git)
writeFileSync(rootPath, JSON.stringify(deployments, null, 2));

// Write to public (for Vite build output - files in public/ are copied to dist/)
writeFileSync(publicPath, JSON.stringify(deployments, null, 2));

console.log('✅ Generated deployments.json from environment variables');
console.log(`   Chain ID: ${deployments.chainId}`);
console.log(`   RPC URL: ${deployments.rpcUrl}`);
if (degenRPSAddress) console.log(`   DegenRPS: ${degenRPSAddress}`);
if (token0Address) console.log(`   Token0: ${token0Address}`);
if (token1Address) console.log(`   Token1: ${token1Address}`);
