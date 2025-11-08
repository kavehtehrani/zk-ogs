// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {BaseScript} from "./base/BaseScript.sol";
import {BaseScriptWithAddresses} from "./base/BaseScriptWithAddresses.sol";
import {SenderRelayRouter} from "../src/router/SenderRelayRouter.sol";

contract SwapScript is BaseScriptWithAddresses {
    /////////////////////////////////////
    // --- Configure These ---
    /////////////////////////////////////
    uint256 public amountIn = 1e18;
    bool public zeroForOne = true;
    // Optional: Set COMMITMENT_HASH env var to include a commitment hash for RPS game
    // Example: export COMMITMENT_HASH=0x1234...
    bytes32 public commitmentHash = bytes32(0);
    /////////////////////////////////////

    function run() external {
        require(address(hookContract) != address(0), "Hook contract not set. Set HOOK_ADDRESS env var.");

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: hookContract // This must match the pool
        });

        // Get commitment hash from environment if set
        commitmentHash = vm.envOr("COMMITMENT_HASH", bytes32(0));
        bytes memory hookData = new bytes(0);

        vm.startBroadcast();

        // We'll approve both, just for testing.
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(swapRouter), type(uint256).max);

        // Cast swapRouter to SenderRelayRouter to access commitment hash functionality
        SenderRelayRouter relayRouter = SenderRelayRouter(payable(address(swapRouter)));

        // Get the deployer address for receiver
        address receiver = deployerAddress;

        // Execute swap with or without commitment hash
        if (commitmentHash != bytes32(0)) {
            // Swap with commitment hash for RPS game
            relayRouter.swapExactTokensForTokensWithCommitment({
                amountIn: amountIn,
                amountOutMin: 0, // Very bad, but we want to allow for unlimited price impact
                zeroForOne: zeroForOne,
                poolKey: poolKey,
                commitmentHash: commitmentHash,
                hookData: hookData,
                receiver: receiver,
                deadline: block.timestamp + 30
            });
        } else {
            // Regular swap without commitment hash
            swapRouter.swapExactTokensForTokens({
                amountIn: amountIn,
                amountOutMin: 0, // Very bad, but we want to allow for unlimited price impact
                zeroForOne: zeroForOne,
                poolKey: poolKey,
                hookData: hookData,
                receiver: receiver,
                deadline: block.timestamp + 30
            });
        }

        vm.stopBroadcast();
    }
}
