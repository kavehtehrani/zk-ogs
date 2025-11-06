// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";

// RPS Positions: Rock = 1 (binary: 100), Paper = 2 (binary: 010), Scissors = 3 (binary: 001)
enum RPSPosition {
    None, // 0
    Rock, // 1 (binary: 100)
    Paper, // 2 (binary: 010)
    Scissors // 3 (binary: 001)
}

struct PendingOrder {
    address swapper;
    uint256 amountIn;
    Currency currencyIn;
    Currency currencyOut;
    RPSPosition rpsPosition;
    uint256 claimTokenId; // ERC6909-like token ID for claiming
    bool matched;
}

contract RPSHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // Constants
    uint256 private constant FEE_BASIS_POINTS = 500; // 5% = 500 basis points
    uint256 private constant BASIS_POINTS = 10000;
    uint256 private constant SWAP_PERCENTAGE = 9500; // 95% = 9500 basis points

    // Pool-specific state
    mapping(PoolId => mapping(bytes32 => PendingOrder)) public pendingOrders;
    mapping(PoolId => bytes32[]) public orderKeys;
    
    // Claim token system (ERC6909-like)
    mapping(PoolId => mapping(uint256 => mapping(address => uint256))) public claimBalances; // poolId => tokenId => owner => balance
    mapping(PoolId => uint256) public nextClaimTokenId;
    mapping(PoolId => mapping(uint256 => Currency)) public claimTokenCurrency; // poolId => tokenId => currency
    mapping(PoolId => mapping(uint256 => uint256)) public claimTokenAmount; // poolId => tokenId => amount
    
    // Track hook's token balances (for custody)
    mapping(PoolId => mapping(Currency => uint256)) public hookBalances; // poolId => currency => balance

    // Events
    event OrderCreated(
        PoolId indexed poolId,
        bytes32 indexed orderKey,
        address indexed swapper,
        uint256 amountIn,
        RPSPosition rpsPosition,
        uint256 claimTokenId
    );
    
    event OrderMatched(
        PoolId indexed poolId,
        bytes32 indexed orderKey1,
        bytes32 indexed orderKey2,
        address winner,
        uint256 prizeAmount
    );
    
    event ClaimRedeemed(
        PoolId indexed poolId,
        uint256 indexed claimTokenId,
        address indexed owner,
        uint256 amount
    );

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true, // Need to return delta to modify swap behavior
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /**
     * @notice Decode RPS position from hookData
     * @dev hookData format: abi.encode(uint8 rpsPosition) where 1=Rock, 2=Paper, 3=Scissors
     */
    function _decodeRPSPosition(bytes calldata hookData) internal pure returns (RPSPosition) {
        if (hookData.length == 0) {
            return RPSPosition.None;
        }
        uint8 position = abi.decode(hookData, (uint8));
        require(position >= 1 && position <= 3, "Invalid RPS position");
        return RPSPosition(position);
    }

    /**
     * @notice Generate order key from swap parameters
     */
    function _generateOrderKey(
        PoolId poolId,
        Currency currencyIn,
        Currency currencyOut,
        uint256 amountIn,
        bool zeroForOne
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(poolId, currencyIn, currencyOut, amountIn, zeroForOne));
    }

    /**
     * @notice Determine RPS winner
     * @return winner 0 = tie, 1 = player1 wins, 2 = player2 wins
     */
    function _determineWinner(RPSPosition player1, RPSPosition player2) internal pure returns (uint8) {
        if (player1 == player2) return 0; // Tie
        
        // Rock beats Scissors, Paper beats Rock, Scissors beats Paper
        if (
            (player1 == RPSPosition.Rock && player2 == RPSPosition.Scissors) ||
            (player1 == RPSPosition.Paper && player2 == RPSPosition.Rock) ||
            (player1 == RPSPosition.Scissors && player2 == RPSPosition.Paper)
        ) {
            return 1; // Player 1 wins
        }
        return 2; // Player 2 wins
    }

    /**
     * @notice Find matching order for CoW
     */
    function _findMatchingOrder(
        PoolId poolId,
        Currency currencyIn,
        Currency currencyOut,
        uint256 amountIn,
        bool zeroForOne
    ) internal view returns (bytes32) {
        // Create reverse order key (opposite direction)
        bytes32 reverseKey = _generateOrderKey(poolId, currencyOut, currencyIn, amountIn, !zeroForOne);
        
        PendingOrder memory order = pendingOrders[poolId][reverseKey];
        if (order.swapper != address(0) && !order.matched) {
            return reverseKey;
        }
        return bytes32(0);
    }

    function _beforeSwap(
        address swapper,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        RPSPosition rpsPosition = _decodeRPSPosition(hookData);
        
        require(rpsPosition != RPSPosition.None, "RPS position required");
        
        Currency currencyIn = params.zeroForOne ? key.currency0 : key.currency1;
        Currency currencyOut = params.zeroForOne ? key.currency1 : key.currency0;
        
        // Check for matching order (CoW)
        bytes32 matchingKey = _findMatchingOrder(poolId, currencyIn, currencyOut, params.amountSpecified, params.zeroForOne);
        
        if (matchingKey != bytes32(0)) {
            // Order will be matched in afterSwap
            // Allow the swap to proceed normally
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        
        // No matching order - create new pending order
        // The swap will be intercepted in afterSwapReturnDelta
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(
        address swapper,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        PoolId poolId = key.toId();
        RPSPosition rpsPosition = _decodeRPSPosition(hookData);
        
        Currency currencyIn = params.zeroForOne ? key.currency0 : key.currency1;
        Currency currencyOut = params.zeroForOne ? key.currency1 : key.currency0;
        
        uint256 amountIn = params.amountSpecified > 0 ? uint256(params.amountSpecified) : 0;
        
        // Check for matching order
        bytes32 matchingKey = _findMatchingOrder(poolId, currencyIn, currencyOut, amountIn, params.zeroForOne);
        
        if (matchingKey != bytes32(0)) {
            // Match orders - CoW
            PendingOrder storage order1 = pendingOrders[poolId][matchingKey];
            require(!order1.matched, "Order already matched");
            
            // Create order for player 2
            bytes32 orderKey2 = _generateOrderKey(poolId, currencyIn, currencyOut, amountIn, params.zeroForOne);
            
            // Determine winner
            uint8 winner = _determineWinner(order1.rpsPosition, rpsPosition);
            
            // Calculate amounts
            uint256 swapAmount = (amountIn * SWAP_PERCENTAGE) / BASIS_POINTS; // 95% of input
            uint256 feeAmount = (amountIn * FEE_BASIS_POINTS) / BASIS_POINTS; // 5% of input
            uint256 totalPrize = feeAmount * 2; // 5% + 5% = 10%
            
            // Mark orders as matched
            order1.matched = true;
            pendingOrders[poolId][orderKey2] = PendingOrder({
                swapper: swapper,
                amountIn: amountIn,
                currencyIn: currencyIn,
                currencyOut: currencyOut,
                rpsPosition: rpsPosition,
                claimTokenId: 0,
                matched: true
            });
            
            // Determine winner and distribute prize
            address winnerAddress;
            if (winner == 1) {
                winnerAddress = order1.swapper;
            } else if (winner == 2) {
                winnerAddress = swapper;
            } else {
                // Tie - split prize between both players
                winnerAddress = address(this); // Hook holds tie prize
            }
            
            // Emit event
            emit OrderMatched(poolId, matchingKey, orderKey2, winnerAddress, totalPrize);
            
            // Store claim tokens for both players
            uint256 claimTokenId1 = order1.claimTokenId;
            uint256 claimTokenId2 = nextClaimTokenId[poolId];
            nextClaimTokenId[poolId]++;
            
            // Store claim for player 1 (95% swap amount in output currency)
            claimTokenCurrency[poolId][claimTokenId1] = currencyOut;
            claimTokenAmount[poolId][claimTokenId1] = swapAmount;
            claimBalances[poolId][claimTokenId1][order1.swapper] = swapAmount;
            
            // Store claim for player 2 (95% swap amount in output currency)
            claimTokenCurrency[poolId][claimTokenId2] = currencyOut;
            claimTokenAmount[poolId][claimTokenId2] = swapAmount;
            claimBalances[poolId][claimTokenId2][swapper] = swapAmount;
            
            // Store prize (will be distributed to winner)
            if (winnerAddress != address(this)) {
                uint256 prizeTokenId = nextClaimTokenId[poolId];
                nextClaimTokenId[poolId]++;
                claimTokenCurrency[poolId][prizeTokenId] = currencyIn;
                claimTokenAmount[poolId][prizeTokenId] = totalPrize;
                claimBalances[poolId][prizeTokenId][winnerAddress] = totalPrize;
            }
        } else {
            // No matching order - create pending order
            bytes32 orderKey = _generateOrderKey(poolId, currencyIn, currencyOut, amountIn, params.zeroForOne);
            
            require(pendingOrders[poolId][orderKey].swapper == address(0), "Order already exists");
            
            uint256 claimTokenId = nextClaimTokenId[poolId];
            nextClaimTokenId[poolId]++;
            
            uint256 swapAmount = (amountIn * SWAP_PERCENTAGE) / BASIS_POINTS; // 95%
            
            // Store pending order
            pendingOrders[poolId][orderKey] = PendingOrder({
                swapper: swapper,
                amountIn: amountIn,
                currencyIn: currencyIn,
                currencyOut: currencyOut,
                rpsPosition: rpsPosition,
                claimTokenId: claimTokenId,
                matched: false
            });
            orderKeys[poolId].push(orderKey);
            
            // Store claim token (95% of input, will be output currency when matched)
            claimTokenCurrency[poolId][claimTokenId] = currencyOut;
            claimTokenAmount[poolId][claimTokenId] = swapAmount;
            claimBalances[poolId][claimTokenId][swapper] = swapAmount;
            
            emit OrderCreated(poolId, orderKey, swapper, amountIn, rpsPosition, claimTokenId);
        }
        
        return (BaseHook.afterSwap.selector, 0);
    }

    function _afterSwapReturnDelta(
        address swapper,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, BalanceDelta) {
        PoolId poolId = key.toId();
        RPSPosition rpsPosition = _decodeRPSPosition(hookData);
        
        Currency currencyIn = params.zeroForOne ? key.currency0 : key.currency1;
        Currency currencyOut = params.zeroForOne ? key.currency1 : key.currency0;
        
        uint256 amountIn = params.amountSpecified > 0 ? uint256(params.amountSpecified) : 0;
        
        // Check for matching order
        bytes32 matchingKey = _findMatchingOrder(poolId, currencyIn, currencyOut, amountIn, params.zeroForOne);
        
        if (matchingKey != bytes32(0)) {
            // Orders matched - CoW swap
            // Calculate amounts
            uint256 swapAmount = (amountIn * SWAP_PERCENTAGE) / BASIS_POINTS; // 95%
            uint256 feeAmount = (amountIn * FEE_BASIS_POINTS) / BASIS_POINTS; // 5%
            uint256 totalPrize = feeAmount * 2; // 10%
            
            // For matched orders, we want:
            // - Take input from swapper 2 (already in delta)
            // - Give output to hook (so hook can hold for claims)
            // The hook will distribute via claim tokens
            
            // Modify delta: hook receives the output tokens
            // Positive delta for hook means hook receives tokens from pool manager
            int256 inputAmount = params.zeroForOne ? delta.amount0() : delta.amount1();
            int256 outputAmount = params.zeroForOne ? delta.amount1() : delta.amount0();
            
            // We want hook to receive: swapAmount * 2 (for both players) + totalPrize (for winner)
            uint256 totalOutput = swapAmount * 2 + totalPrize;
            
            BalanceDelta newDelta;
            if (params.zeroForOne) {
                // amount0 is input (negative), amount1 is output (positive)
                // Modify to send output to hook
                newDelta = BalanceDelta({
                    amount0: inputAmount, // Negative (taken from swapper)
                    amount1: int128(int256(totalOutput)) // Positive (to hook)
                });
            } else {
                newDelta = BalanceDelta({
                    amount0: int128(int256(totalOutput)), // Positive (to hook)
                    amount1: inputAmount // Negative (taken from swapper)
                });
            }
            
            // Track hook's balance
            hookBalances[poolId][currencyOut] += totalOutput;
            
            return (BaseHook.afterSwapReturnDelta.selector, newDelta);
        } else {
            // No match - first player: take input, don't give output yet
            // Modify delta to prevent output (hook will hold input tokens)
            int256 inputAmount = params.zeroForOne ? delta.amount0() : delta.amount1();
            
            // Calculate amounts
            uint256 swapAmount = (amountIn * SWAP_PERCENTAGE) / BASIS_POINTS; // 95%
            uint256 feeAmount = amountIn - swapAmount; // 5%
            
            // Hook receives the input tokens (for custody)
            // But we need to prevent the swap from executing
            // So we return delta with 0 output
            BalanceDelta newDelta;
            if (params.zeroForOne) {
                newDelta = BalanceDelta({
                    amount0: inputAmount, // Negative (taken from swapper)
                    amount1: 0 // No output yet - swap doesn't execute
                });
            } else {
                newDelta = BalanceDelta({
                    amount0: 0, // No output yet - swap doesn't execute
                    amount1: inputAmount // Negative (taken from swapper)
                });
            }
            
            // Track hook's balance (input tokens are held)
            hookBalances[poolId][currencyIn] += amountIn;
            
            return (BaseHook.afterSwapReturnDelta.selector, newDelta);
        }
    }

    /**
     * @notice Redeem claim token for underlying currency
     * @dev The hook must have received tokens from the pool manager (via positive delta)
     *      and settled them to its own balance before users can redeem
     */
    function redeemClaim(PoolKey calldata key, uint256 claimTokenId) external {
        PoolId poolId = key.toId();
        
        require(claimBalances[poolId][claimTokenId][msg.sender] > 0, "No claim balance");
        
        uint256 amount = claimBalances[poolId][claimTokenId][msg.sender];
        Currency currency = claimTokenCurrency[poolId][claimTokenId];
        
        // Clear balance
        claimBalances[poolId][claimTokenId][msg.sender] = 0;
        
        // Update hook balance tracking
        require(hookBalances[poolId][currency] >= amount, "Insufficient hook balance");
        hookBalances[poolId][currency] -= amount;
        
        // Transfer tokens from hook to user
        // The hook should have received these tokens from the pool manager
        // via the positive delta in afterSwapReturnDelta
        if (Currency.unwrap(currency) == 0) {
            // Native ETH - hook must have ETH balance
            require(address(this).balance >= amount, "Insufficient ETH balance");
            (bool success,) = msg.sender.call{value: amount}("");
            require(success, "Transfer failed");
        } else {
            // ERC20 token - hook must have token balance
            IERC20 token = IERC20(Currency.unwrap(currency));
            require(token.balanceOf(address(this)) >= amount, "Insufficient token balance");
            require(token.transfer(msg.sender, amount), "Transfer failed");
        }
        
        emit ClaimRedeemed(poolId, claimTokenId, msg.sender, amount);
    }

    /**
     * @notice Get claim balance for a user
     */
    function getClaimBalance(PoolKey calldata key, uint256 claimTokenId, address owner) external view returns (uint256) {
        PoolId poolId = key.toId();
        return claimBalances[poolId][claimTokenId][owner];
    }
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// Hook needs to receive tokens from pool manager
// When hook has positive delta, it receives tokens via settlement
// The hook should implement a function to settle and receive tokens
// For now, we assume tokens are received through the normal settlement process
