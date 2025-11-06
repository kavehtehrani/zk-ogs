// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import {BaseScript} from "./base/BaseScript.sol";

import {RPSHook} from "../src/RPSHook.sol";

/// @notice Mines the address and deploys the RPSHook.sol Hook contract
contract DeployHookScript is BaseScript {
    function run() public {
        // hook contracts must have specific flags encoded in the address
        // RPSHook needs: beforeSwap, afterSwap, afterSwapReturnDelta
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURN_DELTA_FLAG
        );

        // Mine a salt that will produce a hook address with the correct flags
        bytes memory constructorArgs = abi.encode(poolManager);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(RPSHook).creationCode, constructorArgs);

        // Deploy the hook using CREATE2
        vm.startBroadcast();
        RPSHook rpsHook = new RPSHook{salt: salt}(poolManager);
        vm.stopBroadcast();

        require(address(rpsHook) == hookAddress, "DeployHookScript: Hook Address Mismatch");
    }
}
