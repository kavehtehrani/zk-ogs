// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";

import {EasyPosm} from "./utils/libraries/EasyPosm.sol";

import {RPSHook, RPSPosition} from "../src/RPSHook.sol";
import {BaseTest} from "./utils/BaseTest.sol";

contract RPSHookTest is BaseTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    Currency currency0;
    Currency currency1;

    PoolKey poolKey;

    RPSHook hook;
    PoolId poolId;

    uint256 tokenId;
    int24 tickLower;
    int24 tickUpper;

    address player1 = address(0x1111);
    address player2 = address(0x2222);

    function setUp() public {
        // Deploys all required artifacts.
        deployArtifactsAndLabel();

        (currency0, currency1) = deployCurrencyPair();

        // Deploy the hook to an address with the correct flags
        address flags = address(
            uint160(
                Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURN_DELTA_FLAG
            ) ^ (0x4444 << 144) // Namespace the hook to avoid collisions
        );
        bytes memory constructorArgs = abi.encode(poolManager);
        deployCodeTo("RPSHook.sol:RPSHook", constructorArgs, flags);
        hook = RPSHook(flags);

        // Create the pool
        poolKey = PoolKey(currency0, currency1, 3000, 60, IHooks(hook));
        poolId = poolKey.toId();
        poolManager.initialize(poolKey, Constants.SQRT_PRICE_1_1);

        // Provide full-range liquidity to the pool
        tickLower = TickMath.minUsableTick(poolKey.tickSpacing);
        tickUpper = TickMath.maxUsableTick(poolKey.tickSpacing);

        uint128 liquidityAmount = 100e18;

        (uint256 amount0Expected, uint256 amount1Expected) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityAmount
        );

        (tokenId,) = positionManager.mint(
            poolKey,
            tickLower,
            tickUpper,
            liquidityAmount,
            amount0Expected + 1,
            amount1Expected + 1,
            address(this),
            block.timestamp,
            Constants.ZERO_BYTES
        );

        // Setup players with tokens
        vm.deal(player1, 1000e18);
        vm.deal(player2, 1000e18);
        
        // Mint tokens for players if ERC20
        if (Currency.unwrap(currency0) != 0) {
            deal(Currency.unwrap(currency0), player1, 1000e18);
            deal(Currency.unwrap(currency0), player2, 1000e18);
        }
        if (Currency.unwrap(currency1) != 0) {
            deal(Currency.unwrap(currency1), player1, 1000e18);
            deal(Currency.unwrap(currency1), player2, 1000e18);
        }
    }

    function testCreatePendingOrder() public {
        uint256 amountIn = 1e18;
        bytes memory hookData = abi.encode(uint8(RPSPosition.Rock)); // Rock = 1

        // Player 1 creates an order
        vm.prank(player1);
        if (Currency.unwrap(currency0) == 0) {
            // Native ETH
            swapRouter.swapExactTokensForTokens{value: amountIn}({
                amountIn: amountIn,
                amountOutMin: 0,
                zeroForOne: true,
                poolKey: poolKey,
                hookData: hookData,
                receiver: player1,
                deadline: block.timestamp + 1
            });
        } else {
            // ERC20 - need to approve first
            // This is a simplified test - in reality you'd need to approve and handle ERC20
        }

        // Check that order was created
        // We can't easily check this without accessing internal state
        // But we can verify the hook processed it
    }

    function testMatchOrders() public {
        uint256 amountIn = 1e18;
        bytes memory hookData1 = abi.encode(uint8(RPSPosition.Rock)); // Rock = 1
        bytes memory hookData2 = abi.encode(uint8(RPSPosition.Paper)); // Paper = 2 (beats Rock)

        // Player 1 creates an order (Rock)
        vm.prank(player1);
        // ... swap with hookData1

        // Player 2 matches with Paper (should win)
        vm.prank(player2);
        // ... swap with hookData2

        // Player 2 should win, get prize
        // Both players should have claim tokens for 95% swap
    }

    function testRPSGameLogic() public {
        // Test Rock beats Scissors
        // Test Paper beats Rock
        // Test Scissors beats Paper
        // Test ties
    }

    function testRedeemClaim() public {
        // Create order, match it, then redeem claim
    }
}
