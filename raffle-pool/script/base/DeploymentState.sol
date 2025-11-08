// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Stores deployment addresses for reuse across scripts
/// @dev This allows scripts to reuse the same deployed contracts instead of deploying new ones each time
library DeploymentState {
    // Storage slot for deployment addresses (using CREATE2-like deterministic addresses)
    // For local Anvil, we'll use a simple mapping approach
    struct State {
        address poolManager;
        address positionManager;
        address router;
        address baseRouter;
    }

    // For simplicity, we'll use a file-based approach via environment variables
    // The actual state will be managed by the Justfile
}
