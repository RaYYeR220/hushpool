// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";

/// @dev Public six-decimal stand-in for a dollar stablecoin, with an open faucet. Mirrors the mock
///      that backs Confidential USDT on Sepolia so the local suite exercises the same shape.
contract TestUnderlying is ERC20 {
    constructor() ERC20("Test Dollar", "tUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Confidential wrapper over `TestUnderlying`, used to exercise the batched exit path locally.
contract TestWrappedToken is ERC7984ERC20Wrapper, ZamaEthereumConfig {
    constructor(IERC20 underlying_) ERC7984("Test Confidential Dollar", "tcUSD", "") ERC7984ERC20Wrapper(underlying_) {}
}
