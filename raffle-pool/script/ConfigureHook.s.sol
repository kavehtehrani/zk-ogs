// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {RPSHook} from "../src/RPSHook.sol";
import {RockPaperScissors} from "../src/RockPaperScissors.sol";

/// @notice Configures the RPSHook to use the RockPaperScissors contract
contract ConfigureHookScript is Script {
    function run() public {
        // Get addresses from environment variables
        address hookAddress = vm.envOr("HOOK_ADDRESS", address(0));
        address rpsAddress = vm.envOr("ROCK_PAPER_SCISSORS_ADDRESS", address(0));

        require(hookAddress != address(0), "HOOK_ADDRESS not set");
        require(rpsAddress != address(0), "ROCK_PAPER_SCISSORS_ADDRESS not set");

        RPSHook hook = RPSHook(hookAddress);
        RockPaperScissors rps = RockPaperScissors(rpsAddress);

        // Check if already configured
        address currentRps = address(hook.rockPaperScissors());
        bool hookNeedsConfig = (currentRps == address(0));
        bool hookAlreadyConfigured = (currentRps == rpsAddress);
        
        // Check RPS contract authorization
        address currentHook = rps.authorizedHook();
        bool rpsNeedsAuth = (currentHook == address(0));
        bool rpsAlreadyAuthorized = (currentHook == hookAddress);
        
        if (hookAlreadyConfigured && rpsAlreadyAuthorized) {
            console2.log("Hook is already configured with RockPaperScissors at:", rpsAddress);
            console2.log("  Hook already authorized in RockPaperScissors contract");
            return;
        }
        
        if (hookAlreadyConfigured && currentRps != rpsAddress) {
            revert("Hook is already configured with a different RockPaperScissors address");
        }
        
        if (!hookNeedsConfig && !rpsNeedsAuth) {
            // Both are configured but don't match - this shouldn't happen
            console2.log("WARNING: Configuration mismatch detected");
        }

        vm.startBroadcast();
        
        // Configure hook if needed
        if (hookNeedsConfig) {
            hook.setRockPaperScissors(rpsAddress);
            console2.log("  Set RockPaperScissors address in hook");
        }
        
        // Authorize hook in RPS contract if needed
        if (rpsNeedsAuth) {
            rps.setAuthorizedHook(hookAddress);
            console2.log("  Authorized hook in RockPaperScissors contract");
        } else if (rpsAlreadyAuthorized) {
            console2.log("  Hook already authorized in RockPaperScissors contract");
        } else {
            console2.log("  WARNING: RockPaperScissors already has a different authorized hook:", currentHook);
        }
        
        vm.stopBroadcast();

        console2.log("Successfully configured hook at", hookAddress);
        console2.log("  with RockPaperScissors at", rpsAddress);
    }
}
