// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {RockPaperScissors} from "../src/RockPaperScissors.sol";

/// @notice Deploys the RockPaperScissors contract and optionally sets the verifier
contract DeployRockPaperScissorsScript is Script {
    function run() public {
        vm.startBroadcast();
        
        RockPaperScissors rps = new RockPaperScissors();
        
        // Get verifier address from environment variable (optional)
        // If VERIFIER_ADDRESS is set, call setVerifier() to wire them together
        address verifierAddress = vm.envOr("VERIFIER_ADDRESS", address(0));
        if (verifierAddress != address(0)) {
            rps.setVerifier(verifierAddress);
            console2.log("Set verifier address:", verifierAddress);
        } else {
            console2.log("No VERIFIER_ADDRESS set - verifier will remain unset");
            console2.log("You can set it later by calling setVerifier() on the contract");
        }
        
        vm.stopBroadcast();
        
        console2.log("Deployed RockPaperScissors at:", address(rps));
        console2.log("Set ROCK_PAPER_SCISSORS_ADDRESS environment variable to:", address(rps));
    }
}
