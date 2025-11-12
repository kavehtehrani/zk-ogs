// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {DegenRPS} from "../src/DegenRPS.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";

contract DeploySepoliaScript is Script {
    function run() public {
        // Use PRIVATE_KEY env var if set, otherwise use default Anvil account
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        
        // Verifier address must be provided via environment variable
        address verifierAddress = vm.envAddress("VERIFIER_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);
        
        console.log("Deploying contracts to Sepolia...");
        console.log("Deployer address:", vm.addr(deployerPrivateKey));
        console.log("Using existing Verifier at:", verifierAddress);
        
        // Deploy DegenRPS with existing verifier
        console.log("\n1. Deploying DegenRPS...");
        DegenRPS degenRPS = new DegenRPS(verifierAddress);
        console.log("DegenRPS deployed at:", address(degenRPS));
        
        // Deploy Mock ERC20 tokens for testing
        console.log("\n2. Deploying Mock ERC20 tokens...");
        MockERC20 token0 = new MockERC20("Test Token 0", "TST0", 18);
        MockERC20 token1 = new MockERC20("Test Token 1", "TST1", 18);
        console.log("Token0 deployed at:", address(token0));
        console.log("Token1 deployed at:", address(token1));
        
        // Mint tokens to deployer for testing
        address deployer = vm.addr(deployerPrivateKey);
        token0.mint(deployer, 1000000e18);
        token1.mint(deployer, 1000000e18);
        console.log("\nMinted 1,000,000 tokens to deployer for testing");
        
        vm.stopBroadcast();
        
        // Output deployment info
        console.log("\n=== Deployment Summary ===");
        console.log("Chain ID:", block.chainid);
        console.log("Verifier (existing):", verifierAddress);
        console.log("DegenRPS:", address(degenRPS));
        console.log("Token0:", address(token0));
        console.log("Token1:", address(token1));
    }
}
