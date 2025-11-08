// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {console2} from "forge-std/Script.sol";

/// @notice Deploys test tokens for local development
contract DeployTokensScript is Script {
    function run() public {
        vm.startBroadcast();

        // Deploy two test tokens
        MockERC20 token0 = new MockERC20("Test Token 0", "TST0", 18);
        MockERC20 token1 = new MockERC20("Test Token 1", "TST1", 18);

        // Mint tokens to the deployer
        address deployer = msg.sender;
        token0.mint(deployer, 1_000_000e18);
        token1.mint(deployer, 1_000_000e18);

        vm.stopBroadcast();

        console2.log("Deployed Token0 at:", address(token0));
        console2.log("Deployed Token1 at:", address(token1));
        console2.log("Update BaseScript.sol with these addresses:");
        console2.log("token0 = IERC20(", address(token0), ");");
        console2.log("token1 = IERC20(", address(token1), ");");
    }
}
