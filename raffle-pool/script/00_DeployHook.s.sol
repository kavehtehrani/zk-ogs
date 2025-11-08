// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {BaseScript} from "./base/BaseScript.sol";

import {RPSHook} from "../src/RPSHook.sol";

/// @notice Mines the address and deploys the RPSHook contract
contract DeployHookScript is BaseScript {
    function run() public {
        // Use PoolManager from environment if provided (for reusing deployed V4 infrastructure)
        // Otherwise use the one from BaseScript
        IPoolManager hookPoolManager = poolManager;
        address envPoolManager = vm.envOr("POOL_MANAGER_ADDRESS", address(0));
        if (envPoolManager != address(0)) {
            hookPoolManager = IPoolManager(envPoolManager);
            console2.log("Using PoolManager from environment:", envPoolManager);
        } else {
            console2.log("Using PoolManager from BaseScript:", address(poolManager));
        }

        // hook contracts must have specific flags encoded in the address
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
        );

        // Mine a salt that will produce a hook address with the correct flags
        bytes memory constructorArgs = abi.encode(hookPoolManager);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(RPSHook).creationCode, constructorArgs);

        // Deploy the hook using CREATE2
        vm.startBroadcast();
        RPSHook hook = new RPSHook{salt: salt}(hookPoolManager);
        vm.stopBroadcast();

        require(address(hook) == hookAddress, "DeployHookScript: Hook Address Mismatch");

        // Log the deployed hook address for use in subsequent scripts
        console2.log("Deployed RPSHook at:", address(hook));
        console2.log("Set HOOK_ADDRESS environment variable to:", address(hook));
        console2.log("Example: export HOOK_ADDRESS=", address(hook));
    }
}
