// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";

/// @dev `IERC7984ERC20Wrapper` only declares the unwrap overload that takes an external handle plus
///      an input proof. The wrapper implementation also exposes one that takes a handle the caller
///      already holds, which is what a contract unwrapping its own aggregate needs.
interface IERC7984ERC20WrapperDirect {
    function unwrap(address from, address to, euint64 amount) external returns (bytes32);
}

/**
 * @title ExitQueue
 * @notice Batched unshielding: the route from a confidential balance back to a public ERC-20.
 *
 * @dev Unshielding is where confidential prize pools leak. `ERC7984ERC20Wrapper.unwrap` makes the
 *      amount publicly decryptable and `finalizeUnwrap` takes the cleartext as public calldata, so a
 *      participant who wins and then unwraps alone publishes a number that contains the prize. Every
 *      comparable pool leaves that route as the only one.
 *
 *      This queue removes the lone unwrap. Requests accumulate with encrypted amounts; a batch only
 *      settles once it holds at least `minParticipants` requests and has aged past `minBatchAge`;
 *      and the wrapper is then called exactly once, for the batch aggregate. The wrapper's own event
 *      log therefore never names an individual participant. This mirrors the redeem batcher in
 *      Zama's production Confidential Vault, whose seven-day minimum batch age exists so that a lone
 *      withdrawal is never settled on its own.
 *
 *      Honest limit, stated here and in the threat model rather than buried: paying a public ERC-20
 *      requires a plaintext amount, so a participant's own claim amount does become public when they
 *      claim. What batching removes is the link between that amount and a particular draw -- the
 *      amount is chosen by the participant, revealed on a delay, and never settled alone. Fully
 *      hiding it is not possible with the primitives that exist today.
 */
contract ExitQueue is ZamaEthereumConfig, IERC7984Receiver {
    using SafeERC20 for IERC20;

    enum BatchState {
        Open,
        Unwrapping,
        Payable
    }

    struct Batch {
        uint64 openedAt;
        uint32 participants;
        BatchState state;
        bytes32 unwrapRequestId;
        uint64 total;
    }

    IERC7984ERC20Wrapper public immutable wrapper;
    IERC20 public immutable underlying;

    /// @notice A batch below this many requests is never settled, so no exit is ever settled alone.
    uint32 public immutable minParticipants;

    /// @notice Minimum age before a batch may settle, decoupling an exit in time from any draw.
    uint64 public immutable minBatchAge;

    uint64 public currentBatchId;

    mapping(uint64 => Batch) private _batches;
    mapping(uint64 => euint64) private _batchTotal;
    mapping(uint64 => address[]) private _batchParticipants;
    mapping(uint64 => mapping(address => euint64)) private _share;
    mapping(uint64 => mapping(address => bool)) private _joined;
    mapping(uint64 => mapping(address => bool)) private _claimed;

    event ExitRequested(uint64 indexed batchId, address indexed account);
    event BatchSettling(uint64 indexed batchId, uint32 participants, bytes32 unwrapRequestId);
    event BatchPayable(uint64 indexed batchId, uint64 total);
    event ClaimOpened(uint64 indexed batchId, address indexed account);
    event Claimed(uint64 indexed batchId, address indexed account, uint64 amount);

    error NotTheWrapper();
    error BatchNotOpen();
    error BatchTooSmall(uint32 have, uint32 need);
    error BatchTooYoung(uint64 age, uint64 need);
    error BatchNotUnwrapping();
    error BatchNotPayable();
    error NothingToClaim();
    error AlreadyClaimed();
    error InvalidConfiguration();

    constructor(IERC7984ERC20Wrapper wrapper_, uint32 minParticipants_, uint64 minBatchAge_) {
        if (address(wrapper_) == address(0) || minParticipants_ == 0) revert InvalidConfiguration();
        wrapper = wrapper_;
        underlying = IERC20(wrapper_.underlying());
        minParticipants = minParticipants_;
        minBatchAge = minBatchAge_;
        _batches[0].openedAt = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------- views

    function batchInfo(uint64 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function batchParticipants(uint64 batchId) external view returns (address[] memory) {
        return _batchParticipants[batchId];
    }

    function confidentialShareOf(uint64 batchId, address account) external view returns (euint64) {
        return _share[batchId][account];
    }

    function hasClaimed(uint64 batchId, address account) external view returns (bool) {
        return _claimed[batchId][account];
    }

    /// @notice Whether the open batch currently satisfies both settlement conditions.
    function settleable() public view returns (bool) {
        Batch storage batch = _batches[currentBatchId];
        return
            batch.state == BatchState.Open &&
            batch.participants >= minParticipants &&
            block.timestamp >= batch.openedAt + minBatchAge;
    }

    // ---------------------------------------------------------------- joining

    /// @dev Entered by sending confidential tokens here with `confidentialTransferAndCall`.
    function onConfidentialTransferReceived(
        address,
        address from,
        euint64 amount,
        bytes calldata
    ) external override returns (ebool) {
        if (msg.sender != address(wrapper)) revert NotTheWrapper();

        uint64 batchId = currentBatchId;
        Batch storage batch = _batches[batchId];
        if (batch.state != BatchState.Open) revert BatchNotOpen();

        if (!_joined[batchId][from]) {
            _joined[batchId][from] = true;
            _batchParticipants[batchId].push(from);
            batch.participants += 1;
        }

        _share[batchId][from] = FHE.allowThis(FHE.add(_share[batchId][from], amount));
        FHE.allow(_share[batchId][from], from);
        _batchTotal[batchId] = FHE.allowThis(FHE.add(_batchTotal[batchId], amount));

        emit ExitRequested(batchId, from);

        ebool accepted = FHE.asEbool(true);
        FHE.allowTransient(accepted, msg.sender);
        return accepted;
    }

    // ---------------------------------------------------------------- settlement

    /**
     * @notice Unwrap the batch aggregate. Permissionless, so a batch cannot be held hostage.
     * @dev One `unwrap` call for the whole batch is the point: the wrapper's `UnwrapRequested` and
     *      `UnwrapFinalized` events name this contract and the batch total, never a participant.
     */
    function settleBatch() external returns (uint64 batchId, bytes32 unwrapRequestId) {
        batchId = currentBatchId;
        Batch storage batch = _batches[batchId];

        if (batch.state != BatchState.Open) revert BatchNotOpen();
        if (batch.participants < minParticipants) revert BatchTooSmall(batch.participants, minParticipants);

        uint64 age = uint64(block.timestamp) - batch.openedAt;
        if (age < minBatchAge) revert BatchTooYoung(age, minBatchAge);

        euint64 total = _batchTotal[batchId];
        FHE.allowTransient(total, address(wrapper));
        unwrapRequestId = IERC7984ERC20WrapperDirect(address(wrapper)).unwrap(address(this), address(this), total);

        batch.state = BatchState.Unwrapping;
        batch.unwrapRequestId = unwrapRequestId;

        currentBatchId = batchId + 1;
        _batches[batchId + 1].openedAt = uint64(block.timestamp);

        emit BatchSettling(batchId, batch.participants, unwrapRequestId);
    }

    /**
     * @notice Complete the aggregate unwrap once the batch total has been decrypted off-chain.
     * @dev Permissionless by design. The wrapper burns on request and only releases the underlying
     *      here, so an unfinalised batch would strand funds; anyone being able to finish it removes
     *      that liveness risk.
     */
    function finalizeBatch(uint64 batchId, uint64 clearTotal, bytes calldata decryptionProof) external {
        Batch storage batch = _batches[batchId];
        if (batch.state != BatchState.Unwrapping) revert BatchNotUnwrapping();

        wrapper.finalizeUnwrap(batch.unwrapRequestId, clearTotal, decryptionProof);

        batch.state = BatchState.Payable;
        batch.total = clearTotal;

        emit BatchPayable(batchId, clearTotal);
    }

    // ---------------------------------------------------------------- claiming

    /**
     * @notice Open your own share for decryption so you can claim it.
     * @dev Deliberately per-participant and self-service. Publishing every share at settlement would
     *      reveal the whole batch at once to everyone, including participants who never claim.
     */
    function openClaim(uint64 batchId) external {
        Batch storage batch = _batches[batchId];
        if (batch.state != BatchState.Payable) revert BatchNotPayable();
        if (!_joined[batchId][msg.sender]) revert NothingToClaim();
        if (_claimed[batchId][msg.sender]) revert AlreadyClaimed();

        FHE.makePubliclyDecryptable(_share[batchId][msg.sender]);
        emit ClaimOpened(batchId, msg.sender);
    }

    /**
     * @notice Claim your share of a settled batch as the public underlying token.
     * @param clearAmount the decrypted share, obtained off-chain after `openClaim`
     * @param decryptionProof the KMS threshold signature over that value
     */
    function claim(uint64 batchId, uint64 clearAmount, bytes calldata decryptionProof) external {
        Batch storage batch = _batches[batchId];
        if (batch.state != BatchState.Payable) revert BatchNotPayable();
        if (!_joined[batchId][msg.sender]) revert NothingToClaim();
        if (_claimed[batchId][msg.sender]) revert AlreadyClaimed();

        // Latch before verifying, so a replayed proof cannot pay twice.
        _claimed[batchId][msg.sender] = true;

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(_share[batchId][msg.sender]);
        FHE.checkSignatures(handles, abi.encode(clearAmount), decryptionProof);

        underlying.safeTransfer(msg.sender, uint256(clearAmount) * wrapper.rate());

        emit Claimed(batchId, msg.sender, clearAmount);
    }
}
