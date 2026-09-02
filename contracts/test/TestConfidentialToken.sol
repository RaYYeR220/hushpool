// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @dev Minimal ERC-7984 with an open faucet, used by the local test suite. On Sepolia the pool is
///      wired to the canonical Confidential USDT mock instead, which already ships a faucet.
contract TestConfidentialToken is ERC7984, ZamaEthereumConfig {
    constructor() ERC7984("Test Confidential USD", "tcUSD", "") {}

    function mint(address to, uint64 amount) external returns (euint64) {
        euint64 minted = _mint(to, FHE.asEuint64(amount));
        FHE.allowThis(minted);
        FHE.allow(minted, to);
        return minted;
    }
}
