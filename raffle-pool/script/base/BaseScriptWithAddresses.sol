// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IPermit2} from "permit2/src/interfaces/IPermit2.sol";

import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";
import {SenderRelayRouter} from "../../src/router/SenderRelayRouter.sol";

/// @notice Base script that can reuse existing deployed contracts via environment variables
/// @dev Use this when you want to reuse V4 infrastructure deployed by deploy-v4 script
contract BaseScriptWithAddresses is Script {
    address immutable deployerAddress;

    /////////////////////////////////////
    // --- Configure These ---
    /////////////////////////////////////
    // Token addresses - can be set via TOKEN0_ADDRESS and TOKEN1_ADDRESS env vars
    IERC20 immutable token0;
    IERC20 immutable token1;
    // Hook contract address - can be set via HOOK_ADDRESS env var
    IHooks immutable hookContract;
    /////////////////////////////////////

    // V4 Infrastructure - can be set via env vars or will use defaults
    IPermit2 immutable permit2;
    IPoolManager immutable poolManager;
    IPositionManager immutable positionManager;
    IUniswapV4Router04 immutable swapRouter;
    IUniswapV4Router04 immutable baseRouter;

    Currency immutable currency0;
    Currency immutable currency1;

    constructor() {
        deployerAddress = getDeployer();

        // Get token addresses from environment variables, or use defaults
        address token0Address = vm.envOr("TOKEN0_ADDRESS", address(0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512));
        address token1Address = vm.envOr("TOKEN1_ADDRESS", address(0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0));
        token0 = IERC20(token0Address);
        token1 = IERC20(token1Address);

        // Get hook address from environment variable
        address hookAddress = vm.envOr("HOOK_ADDRESS", address(0));
        hookContract = IHooks(hookAddress);

        // Get V4 infrastructure addresses from environment, or deploy new ones
        address permit2Address = vm.envOr("PERMIT2_ADDRESS", AddressConstants.getPermit2Address());
        permit2 = IPermit2(permit2Address);

        address poolManagerAddress = vm.envOr("POOL_MANAGER_ADDRESS", address(0));
        if (poolManagerAddress != address(0)) {
            poolManager = IPoolManager(poolManagerAddress);
        } else {
            revert("POOL_MANAGER_ADDRESS must be set. Run 'just deploy-v4' first.");
        }

        address positionManagerAddress = vm.envOr("POSITION_MANAGER_ADDRESS", address(0));
        if (positionManagerAddress != address(0)) {
            positionManager = IPositionManager(positionManagerAddress);
        } else {
            revert("POSITION_MANAGER_ADDRESS must be set. Run 'just deploy-v4' first.");
        }

        address routerAddress = vm.envOr("ROUTER_ADDRESS", address(0));
        if (routerAddress != address(0)) {
            baseRouter = IUniswapV4Router04(payable(routerAddress));
        } else {
            revert("ROUTER_ADDRESS must be set. Run 'just deploy-v4' first.");
        }

        // Wrap the base router with SenderRelayRouter
        SenderRelayRouter relayRouter = new SenderRelayRouter(baseRouter);
        swapRouter = IUniswapV4Router04(payable(address(relayRouter)));

        (currency0, currency1) = getCurrencies();

        vm.label(address(permit2), "Permit2");
        vm.label(address(poolManager), "V4PoolManager");
        vm.label(address(positionManager), "V4PositionManager");
        vm.label(address(swapRouter), "V4SwapRouter");
        vm.label(address(token0), "Currency0");
        vm.label(address(token1), "Currency1");
        vm.label(address(hookContract), "HookContract");
    }

    function getCurrencies() internal view returns (Currency, Currency) {
        require(address(token0) != address(token1));

        if (token0 < token1) {
            return (Currency.wrap(address(token0)), Currency.wrap(address(token1)));
        } else {
            return (Currency.wrap(address(token1)), Currency.wrap(address(token0)));
        }
    }

    function getDeployer() internal returns (address) {
        address[] memory wallets = vm.getWallets();

        if (wallets.length > 0) {
            return wallets[0];
        } else {
            return msg.sender;
        }
    }
}
