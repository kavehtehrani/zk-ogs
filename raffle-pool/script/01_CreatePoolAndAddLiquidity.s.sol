// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {BaseScript} from "./base/BaseScript.sol";
import {BaseScriptWithAddresses} from "./base/BaseScriptWithAddresses.sol";
import {LiquidityHelpers} from "./base/LiquidityHelpers.sol";

contract CreatePoolAndAddLiquidityScript is BaseScriptWithAddresses {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using LiquidityHelpers for *;

    /////////////////////////////////////
    // --- Configure These ---
    /////////////////////////////////////

    uint24 lpFee = 3000; // 0.30%
    int24 tickSpacing = 60;
    uint160 startingPrice = 2 ** 96; // Starting price, sqrtPriceX96; floor(sqrt(1) * 2^96)

    // --- liquidity position configuration --- //
    uint256 public token0Amount = 100e18;
    uint256 public token1Amount = 100e18;

    // range of the position, must be a multiple of tickSpacing
    int24 tickLower;
    int24 tickUpper;
    /////////////////////////////////////

    function run() external {
        // Note: If creating a pool with RPSHook, set HOOK_ADDRESS env var before running
        // If hookContract is address(0), the pool will be created without a hook
        require(
            address(hookContract) != address(0) || vm.envOr("ALLOW_NO_HOOK", false),
            "Hook contract not set. Set HOOK_ADDRESS env var, or set ALLOW_NO_HOOK=true to create pool without hook."
        );

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: lpFee,
            tickSpacing: tickSpacing,
            hooks: hookContract
        });

        bytes memory hookData = new bytes(0);

        int24 currentTick = TickMath.getTickAtSqrtPrice(startingPrice);

        tickLower = LiquidityHelpers.truncateTickSpacing((currentTick - 750 * tickSpacing), tickSpacing);
        tickUpper = LiquidityHelpers.truncateTickSpacing((currentTick + 750 * tickSpacing), tickSpacing);

        // Converts token amounts to liquidity units
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            startingPrice,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            token0Amount,
            token1Amount
        );

        // slippage limits
        uint256 amount0Max = token0Amount + 1;
        uint256 amount1Max = token1Amount + 1;

        (bytes memory actions, bytes[] memory mintParams) = LiquidityHelpers._mintLiquidityParams(
            poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, deployerAddress, hookData
        );

        // If the pool is an ETH pair, native tokens are to be transferred
        uint256 valueToPass = currency0.isAddressZero() ? amount0Max : 0;

        vm.startBroadcast();
        LiquidityHelpers.tokenApprovals(currency0, currency1, token0, token1, permit2, positionManager);

        // Check if pool is already initialized
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        if (sqrtPriceX96 == 0) {
            // Pool not initialized, initialize it
            poolManager.initialize(poolKey, startingPrice);
        } else {
            // Pool already initialized, use existing price
            startingPrice = sqrtPriceX96;
            currentTick = TickMath.getTickAtSqrtPrice(startingPrice);
            tickLower = LiquidityHelpers.truncateTickSpacing((currentTick - 750 * tickSpacing), tickSpacing);
            tickUpper = LiquidityHelpers.truncateTickSpacing((currentTick + 750 * tickSpacing), tickSpacing);
            
            // Recalculate liquidity with the existing price
            liquidity = LiquidityAmounts.getLiquidityForAmounts(
                startingPrice,
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                token0Amount,
                token1Amount
            );
            
            // Recreate the mint params with updated values
            (actions, mintParams) = LiquidityHelpers._mintLiquidityParams(
                poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, deployerAddress, hookData
            );
        }

        // Then add liquidity via multicall
        bytes[] memory params = new bytes[](1);
        params[0] = abi.encodeWithSelector(
            positionManager.modifyLiquidities.selector, abi.encode(actions, mintParams), block.timestamp + 3600
        );

        // Multicall to add liquidity
        positionManager.multicall{value: valueToPass}(params);
        vm.stopBroadcast();
    }
}
