// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVerifier} from "../src/Verifier.sol";

/// @notice Mock verifier for testing - always returns true
contract MockVerifier is IVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure override returns (bool) {
        return true;
    }
}
