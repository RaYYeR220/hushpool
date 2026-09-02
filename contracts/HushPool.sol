// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {IERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/interfaces/IERC7984ERC20Wrapper.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";

/**
 * @title HushPool
 * @notice No-loss prize savings where deposits, balances and winnings stay encrypted, and the
 *         winner of a draw is never revealed to anyone -- including to this contract.
 *
 * @dev Odds are proportional to a time-weighted average balance (TWAB), so depositing moments
 *      before a draw does not buy full odds.
 *
 *      A draw picks a target uniformly at random from the encrypted total TWAB, then walks the
 *      participant list accumulating an encrypted prefix sum. The single participant whose slice
 *      contains the target is credited the prize; every other participant is credited an encrypted
 *      zero. Both branches always execute, so the state diff, event shape and cost of a winning
 *      participant are indistinguishable from a losing one. The winner's index is never decrypted.
 *
 *      The walk is chunked across transactions because a single transaction is capped at 20M HCU
 *      globally and 5M along any dependency chain, and the prefix sum is inherently sequential.
 */
contract HushPool is ZamaEthereumConfig, IERC7984Receiver {
    /// @dev Randomness is drawn from [0, 2**RAND_BITS) and rescaled onto the encrypted total TWAB.
    ///      32 bits keeps the rescaling product inside euint128 for any total TWAB below 2**96,
    ///      while leaving a selection bias below 2**-32.
    uint8 private constant RAND_BITS = 32;
    uint64 private constant RAND_BOUND = uint64(1) << RAND_BITS;

    enum DrawState {
        None,
        Scanning,
        Settled
    }

    struct Draw {
        uint64 at;
        uint64 prize;
        uint32 participantCount;
        uint32 scanned;
        DrawState state;
    }

    using SafeERC20 for IERC20;

    /// @notice The confidential token participants hold. It is a wrapper so that the prize pot can be
    ///         funded in the public underlying and shielded here, which keeps every credited prize
    ///         backed by tokens this contract actually holds.
    IERC7984ERC20Wrapper public immutable asset;

    /// @notice The public token behind `asset`, used only to fund prizes.
    IERC20 public immutable underlying;

    /// @notice A draw is refused below this many participants: with too few depositors, "the winner
    ///         is never revealed" would be an empty promise.
    uint32 public immutable minParticipants;

    /// @notice Upper bound on participants processed in one `advanceDraw` call, to stay inside the
    ///         per-transaction HCU limits.
    uint32 public immutable maxScanBatch;

    address[] private _participants;
    mapping(address => uint256) private _participantIndex; // 1-based; 0 means "not a participant"

    mapping(address => euint64) private _balance;
    mapping(address => euint128) private _twabCum;
    mapping(address => uint64) private _lastTouch;

    euint64 private _totalBalance;
    euint128 private _totalTwabCum;
    uint64 private _lastGlobalTouch;

    uint64 public prizePot;
    uint64 public currentDrawId;

    mapping(uint64 => Draw) private _draws;
    mapping(uint64 => euint128) private _drawTarget;
    mapping(uint64 => euint128) private _drawCursor;
    mapping(uint64 => ebool) private _drawFound;

    /// @dev TWAB frozen at draw time for a participant who moved funds mid-scan.
    mapping(uint64 => mapping(address => euint128)) private _twabSnapshot;
    mapping(uint64 => mapping(address => bool)) private _hasSnapshot;

    event Deposited(address indexed account);
    event Withdrawn(address indexed account);
    event PrizeSponsored(address indexed sponsor, uint64 amount);
    event DrawStarted(uint64 indexed drawId, uint64 prize, uint32 participantCount);
    event DrawAdvanced(uint64 indexed drawId, uint32 scanned, uint32 participantCount);
    event DrawSettled(uint64 indexed drawId);

    error NotTheAsset();
    error AmountNotOwnedBySender();
    error DrawInProgress();
    error NoDrawInProgress();
    error TooFewParticipants(uint32 have, uint32 need);
    error NoPrize();
    error InvalidConfiguration();

    constructor(IERC7984ERC20Wrapper asset_, uint32 minParticipants_, uint32 maxScanBatch_) {
        if (address(asset_) == address(0) || minParticipants_ == 0 || maxScanBatch_ == 0) {
            revert InvalidConfiguration();
        }
        asset = asset_;
        underlying = IERC20(asset_.underlying());
        minParticipants = minParticipants_;
        maxScanBatch = maxScanBatch_;
        _lastGlobalTouch = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------- views

    function participantCount() external view returns (uint256) {
        return _participants.length;
    }

    function participantAt(uint256 index) external view returns (address) {
        return _participants[index];
    }

    function isParticipant(address account) external view returns (bool) {
        return _participantIndex[account] != 0;
    }

    /// @notice Encrypted balance handle. Only `account` (and this contract) can decrypt it.
    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _balance[account];
    }

    /// @notice Encrypted time-weighted balance handle, which is what determines a participant's odds.
    function confidentialTwabOf(address account) external view returns (euint128) {
        return _twabCum[account];
    }

    function drawInfo(uint64 drawId) external view returns (Draw memory) {
        return _draws[drawId];
    }

    function drawInProgress() public view returns (bool) {
        return _draws[currentDrawId].state == DrawState.Scanning;
    }

    // ---------------------------------------------------------------- deposits

    /**
     * @notice Deposit entry point. The caller transfers on the token itself with
     *         `confidentialTransferAndCall(pool, handle, proof, "")`, which lands here.
     * @dev Using the transfer callback avoids `setOperator` entirely. An ERC-7984 operator grant is
     *      bounded by time but not by amount, so a standing grant would let this contract move any
     *      amount a depositor holds -- an authority the pool has no reason to hold.
     */
    function onConfidentialTransferReceived(
        address,
        address from,
        euint64 amount,
        bytes calldata
    ) external override returns (ebool) {
        if (msg.sender != address(asset)) revert NotTheAsset();

        _snapshotForActiveDraw(from);
        _accrue(from);

        _balance[from] = FHE.allowThis(FHE.add(_balance[from], amount));
        FHE.allow(_balance[from], from);
        _totalBalance = FHE.allowThis(FHE.add(_totalBalance, amount));

        _join(from);
        emit Deposited(from);

        ebool accepted = FHE.asEbool(true);
        FHE.allowTransient(accepted, msg.sender);
        return accepted;
    }

    // ---------------------------------------------------------------- withdrawals

    /**
     * @notice Withdraw principal and winnings as confidential tokens. Always available, including
     *         while a draw is being scanned -- the no-loss guarantee does not pause.
     * @dev Over-withdrawing transfers an encrypted zero rather than reverting. Reverting on an
     *      encrypted predicate would turn this function into a plaintext oracle on the caller's
     *      balance, which is exactly the binary-search inference attack the ACL guard below blocks.
     */
    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64) {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        return _withdraw(requested);
    }

    /// @notice Withdraw using a handle this contract is already allowed to read.
    function withdraw(euint64 amount) external returns (euint64) {
        return _withdraw(amount);
    }

    function _withdraw(euint64 requested) private returns (euint64) {
        if (!FHE.isSenderAllowed(requested)) revert AmountNotOwnedBySender();

        _snapshotForActiveDraw(msg.sender);
        _accrue(msg.sender);

        (ebool ok, euint64 remaining) = FHESafeMath.tryDecrease(_balance[msg.sender], requested);
        euint64 sent = FHE.select(ok, requested, FHE.asEuint64(0));

        _balance[msg.sender] = FHE.allowThis(remaining);
        FHE.allow(_balance[msg.sender], msg.sender);

        (, euint64 newTotal) = FHESafeMath.tryDecrease(_totalBalance, sent);
        _totalBalance = FHE.allowThis(newTotal);

        FHE.allowTransient(sent, address(asset));
        euint64 transferred = asset.confidentialTransfer(msg.sender, sent);

        emit Withdrawn(msg.sender);
        return transferred;
    }

    // ---------------------------------------------------------------- prize funding

    /**
     * @notice Fund the prize pot with the public underlying token, which this contract shields.
     * @dev The pot is deliberately public: a visible jackpot is the point of a prize pool, and it
     *      says nothing about who will win it. Funding it in the public token is what makes every
     *      credited prize solvent -- the tokens are held here before any draw can award them, and a
     *      yield source delivers its harvest through exactly this path.
     */
    function sponsorPrize(uint64 amount) external {
        if (amount == 0) revert NoPrize();

        uint256 gross = uint256(amount) * asset.rate();
        underlying.safeTransferFrom(msg.sender, address(this), gross);
        underlying.forceApprove(address(asset), gross);
        asset.wrap(address(this), gross);

        prizePot += amount;
        emit PrizeSponsored(msg.sender, amount);
    }

    // ---------------------------------------------------------------- draws

    /**
     * @notice Open a draw. Permissionless: anyone may start one, and nobody can influence the
     *         outcome by choosing when.
     * @dev The random target is drawn and committed in this same transaction, so the caller cannot
     *      observe it and decide whether to proceed. There is no way to abandon a draw once started.
     */
    function startDraw() external returns (uint64 drawId) {
        if (drawInProgress()) revert DrawInProgress();

        uint32 count = uint32(_participants.length);
        if (count < minParticipants) revert TooFewParticipants(count, minParticipants);

        uint64 prize = prizePot;
        if (prize == 0) revert NoPrize();

        uint64 at = uint64(block.timestamp);
        euint128 total = _globalTwabAt(at);

        // Uniform on [0, total): rescale a RAND_BITS-wide draw onto the encrypted total.
        euint128 scaled = FHE.mul(FHE.asEuint128(FHE.randEuint64(RAND_BOUND)), total);
        euint128 target = FHE.shr(scaled, RAND_BITS);

        drawId = ++currentDrawId;
        prizePot = 0;

        _draws[drawId] = Draw({at: at, prize: prize, participantCount: count, scanned: 0, state: DrawState.Scanning});
        _drawTarget[drawId] = FHE.allowThis(target);
        _drawCursor[drawId] = FHE.allowThis(FHE.asEuint128(0));
        _drawFound[drawId] = FHE.allowThis(FHE.asEbool(false));

        emit DrawStarted(drawId, prize, count);
    }

    /**
     * @notice Advance the oblivious scan by up to `batchSize` participants. Permissionless, so the
     *         draw cannot be stalled by an absent operator.
     */
    function advanceDraw(uint32 batchSize) external {
        uint64 drawId = currentDrawId;
        Draw storage draw = _draws[drawId];
        if (draw.state != DrawState.Scanning) revert NoDrawInProgress();

        uint32 from = draw.scanned;
        uint32 to = from + (batchSize < maxScanBatch ? batchSize : maxScanBatch);
        if (to > draw.participantCount) to = draw.participantCount;

        euint128 cursor = _drawCursor[drawId];
        ebool found = _drawFound[drawId];
        euint128 target = _drawTarget[drawId];
        euint64 prize = FHE.asEuint64(draw.prize);

        for (uint32 i = from; i < to; ++i) {
            address account = _participants[i];

            cursor = FHE.add(cursor, _twabAtDraw(drawId, account, draw.at));

            // The first participant whose slice contains the target wins, and only that one:
            // `found` latches so later participants cannot match again.
            ebool hit = FHE.and(FHE.not(found), FHE.lt(target, cursor));
            found = FHE.or(found, hit);

            euint64 award = FHE.select(hit, prize, FHE.asEuint64(0));
            _balance[account] = FHE.allowThis(FHE.add(_balance[account], award));
            FHE.allow(_balance[account], account);
        }

        _drawCursor[drawId] = FHE.allowThis(cursor);
        _drawFound[drawId] = FHE.allowThis(found);
        draw.scanned = to;

        if (to == draw.participantCount) {
            draw.state = DrawState.Settled;
            _totalBalance = FHE.allowThis(FHE.add(_totalBalance, FHE.asEuint64(draw.prize)));
            emit DrawSettled(drawId);
        }

        emit DrawAdvanced(drawId, to, draw.participantCount);
    }

    // ---------------------------------------------------------------- internals

    function _join(address account) private {
        if (_participantIndex[account] == 0) {
            _participants.push(account);
            _participantIndex[account] = _participants.length;
        }
    }

    /// @dev Fold elapsed time into a participant's time-weighted balance, then restart their clock.
    function _accrue(address account) private {
        uint64 nowTs = uint64(block.timestamp);

        uint64 last = _lastTouch[account];
        if (last != 0 && nowTs > last) {
            _twabCum[account] = FHE.add(
                _twabCum[account],
                FHE.mul(FHE.asEuint128(_balance[account]), uint128(nowTs - last))
            );
        }
        _twabCum[account] = FHE.allowThis(_twabCum[account]);
        FHE.allow(_twabCum[account], account);
        _lastTouch[account] = nowTs;

        if (nowTs > _lastGlobalTouch) {
            _totalTwabCum = FHE.allowThis(
                FHE.add(_totalTwabCum, FHE.mul(FHE.asEuint128(_totalBalance), uint128(nowTs - _lastGlobalTouch)))
            );
            _lastGlobalTouch = nowTs;
        }
    }

    /// @dev Total TWAB at `at`, maintained in O(1). Equal to the sum of every participant's TWAB at
    ///      the same instant, because both are integrals of the same balances over the same window.
    function _globalTwabAt(uint64 at) private returns (euint128) {
        euint128 total = _totalTwabCum;
        if (at > _lastGlobalTouch) {
            total = FHE.add(total, FHE.mul(FHE.asEuint128(_totalBalance), uint128(at - _lastGlobalTouch)));
        }
        return total;
    }

    /// @dev A participant's TWAB as of the draw instant, reading the frozen value if they have moved
    ///      funds since the draw opened.
    function _twabAtDraw(uint64 drawId, address account, uint64 at) private returns (euint128) {
        if (_hasSnapshot[drawId][account]) return _twabSnapshot[drawId][account];

        euint128 twab = _twabCum[account];
        uint64 last = _lastTouch[account];
        if (last != 0 && at > last) {
            twab = FHE.add(twab, FHE.mul(FHE.asEuint128(_balance[account]), uint128(at - last)));
        }
        return twab;
    }

    /// @dev Freeze a participant's draw-time TWAB before their balance moves, so that depositing or
    ///      withdrawing mid-scan cannot change odds that were already fixed when the draw opened.
    function _snapshotForActiveDraw(address account) private {
        uint64 drawId = currentDrawId;
        if (_draws[drawId].state != DrawState.Scanning) return;
        if (_hasSnapshot[drawId][account]) return;

        _twabSnapshot[drawId][account] = FHE.allowThis(_twabAtDraw(drawId, account, _draws[drawId].at));
        _hasSnapshot[drawId][account] = true;
    }
}
