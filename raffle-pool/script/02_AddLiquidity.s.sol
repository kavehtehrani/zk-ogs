// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {BaseScript} from "./base/BaseScript.sol";
import {BaseScriptWithAddresses} from "./base/BaseScriptWithAddresses.sol";
import {LiquidityHelpers} from "./base/LiquidityHelpers.sol";

contract AddLiquidityScript is BaseScriptWithAddresses {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using LiquidityHelpers for *;

    /////////////////////////////////////
    // --- Configure These ---
    /////////////////////////////////////

    uint24 lpFee = 3000; // 0.30%
    int24 tickSpacing = 60;

    // --- liquidity position configuration --- //
    uint256 public token0Amount = 1e18;
    uint256 public token1Amount = 1e18;

    /////////////////////////////////////

    int24 tickLower;
    int24 tickUpper;

    function run() external {
        // Note: hookContract must match the hook used when the pool was created
        // Set HOOK_ADDRESS env var to match the existing pool's hook
        // If the pool was created without a hook, set HOOK_ADDRESS=0x0000000000000000000000000000000000000000
        require(
            address(hookContract) != address(0) || vm.envOr("ALLOW_NO_HOOK", false),
            "Hook contract not set. Set HOOK_ADDRESS env var to match the pool's hook (or 0x0 if pool has no hook)."
        );

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: lpFee,
            tickSpacing: tickSpacing,
            hooks: hookContract
        });
        bytes memory hookData = new bytes(0);

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());

        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);

        tickLower = LiquidityHelpers.truncateTickSpacing((currentTick - 1000 * tickSpacing), tickSpacing);
        tickUpper = LiquidityHelpers.truncateTickSpacing((currentTick + 1000 * tickSpacing), tickSpacing);

        // Converts token amounts to liquidity units
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            token0Amount,
            token1Amount
        );

        // slippage limits
        uint256 amount0Max = token0Amount + 1 wei;
        uint256 amount1Max = token1Amount + 1 wei;

        (bytes memory actions, bytes[] memory mintParams) = LiquidityHelpers._mintLiquidityParams(
            poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, deployerAddress, hookData
        );

        // multicall parameters
        bytes[] memory params = new bytes[](1);

        // Mint Liquidity
        params[0] = abi.encodeWithSelector(
            positionManager.modifyLiquidities.selector, abi.encode(actions, mintParams), block.timestamp + 60
        );

        // If the pool is an ETH pair, native tokens are to be transferred
        uint256 valueToPass = currency0.isAddressZero() ? amount0Max : 0;

        vm.startBroadcast();
        LiquidityHelpers.tokenApprovals(currency0, currency1, token0, token1, permit2, positionManager);

        // Add liquidity to existing pool
        positionManager.multicall{value: valueToPass}(params);
        vm.stopBroadcast();
    }
}
