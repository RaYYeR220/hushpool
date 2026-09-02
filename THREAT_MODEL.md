# Threat model

What Hushpool hides, what it does not, and why. Every claim below is either enforced by a contract
in this repository or listed as a limit.

The short version: a prize pool can encrypt balances perfectly and still name its winner, because
the winner eventually moves money. Encrypting the middle is the easy part. This document is mostly
about the edges.

## What the system promises

1. A participant's balance is never readable by anyone but that participant.
2. A draw reveals nothing about who won — not to observers, not to the operator, not to the
   contract. A winner learns of their win by decrypting their own balance.
3. Odds are proportional to a time-weighted balance, and the draw is verifiable on-chain.
4. Principal is always withdrawable in full, including while a draw is running.

## What is encrypted

| Value | Type | Who can read it |
|---|---|---|
| Participant balance | `euint64` | that participant only |
| Participant time-weighted balance | `euint128` | that participant only |
| Pool total balance and total TWAB | `euint64` / `euint128` | nobody |
| The draw's random target | `euint128` | nobody, ever |
| The scan cursor and the "winner found" latch | `euint128` / `ebool` | nobody, ever |
| The prize credited to each participant | `euint64` | that participant only |
| Exit-queue share per participant | `euint64` | that participant, until they claim |
| Exit-queue batch total | `euint64` | nobody, until the batch settles |

## What is public

Stated in full, because a partial list is worse than none.

| Value | Why it is public |
|---|---|
| Every participant's address | Deposits are ordinary transactions. Membership is not hidden and is not claimed to be. |
| That an address deposited, withdrew, or joined an exit batch, and when | Same. Only amounts are hidden. |
| The number of participants | Read from the participant array. |
| The prize pot | Deliberate. A jackpot nobody can see is not a prize pool, and the pot says nothing about who wins it. |
| Draw timing, the participant count of a draw, and scan progress | Needed to drive and audit the draw. |
| Amounts shielded via `wrap` | `ERC7984ERC20Wrapper.wrap` takes a cleartext amount. See "The entry boundary". |
| An exit batch's total, once settled | One number per batch, never per participant. |
| A participant's own claim amount, once they claim | See "The exit boundary". This is the residual leak. |

## The draw reveals nothing

`startDraw` samples an encrypted target uniformly from the encrypted total time-weighted balance:

```
target = (randEuint64(2**32) * totalTwab) >> 32
```

The multiplication happens in `euint128`, so the rescaling is exact for any total below `2**96`, and
the selection bias is under `2**-32`. The target is never decrypted.

`advanceDraw` then walks participants accumulating an encrypted prefix sum, and credits each one:

```
hit    = not(found) and (target < cursor)
found  = found or hit
credit = select(hit, prize, 0)
```

Both branches always execute. The winner and the losers take the same code path, write the same
storage slots, cost the same gas, and produce the same events — the only per-batch event is
`DrawAdvanced`, which names no participant. The index of the winner exists only as an encrypted
latch that is never decrypted and never needs to be.

There is no claim step for a prize. The prize is already in the winner's encrypted balance when the
scan passes them, which is what removes the usual "only the winner claims" tell.

**Minimum anonymity set.** `startDraw` reverts below `minParticipants`. Hiding a winner among two
people is not hiding them, and a contract that silently offers a guarantee it cannot keep at small
sizes is worse than one that refuses. Zama's own Confidential Vault documents the equivalent
exposure for a lone depositor in a batch and accepts it by design; Hushpool refuses instead.

## The entry boundary

To hold the confidential token at all, a user first calls `wrap` on the ERC-7984 wrapper, and
`wrap` takes a **cleartext** amount. An observer who sees an address shield 5,000 units and then
deposit minutes later learns an upper bound on that deposit.

This is a property of the wrapper, not of this pool, and it is not fully fixable here. What the pool
does do is keep the deposit itself encrypted and never publish a per-deposit amount, so the bound is
only ever an upper bound, and it decays as the participant deposits, withdraws and accrues over
time. Shielding more than you intend to deposit, or shielding well before depositing, breaks the
correlation entirely.

## The exit boundary

**This is the leak that every comparable pool leaves open, and the reason `ExitQueue` exists.**

`ERC7984ERC20Wrapper.unwrap` marks the amount publicly decryptable, and `finalizeUnwrap` takes the
cleartext as public calldata and emits it. A participant who wins and then unwraps on their own
publishes a number that contains the prize. The draw can be perfectly private and the winner is
still identifiable a block later.

`ExitQueue` removes the lone unwrap:

- Exit requests carry encrypted amounts and accumulate into a batch.
- A batch settles only once it holds at least `minParticipants` requests **and** has aged past
  `minBatchAge`.
- The wrapper is then called **once**, for the batch aggregate. Its `UnwrapRequested` and
  `UnwrapFinalized` events name this contract and one total — never a participant.

This mirrors the redeem batcher in Zama's production Confidential Vault, whose seven-day minimum
batch age exists for exactly this reason.

**The residual leak, stated plainly.** Paying out a public ERC-20 requires a plaintext amount, so a
participant's own claim amount becomes public at the moment they claim. Batching does not eliminate
that; it removes the link between the amount and any particular draw, because the amount is chosen
by the participant, revealed on a delay, and never settled alone. There is no shielded-exit-to-public
primitive in the FHEVM stack today. If one appears, this is the contract that changes.

A participant who never needs the public token never crosses this boundary at all: withdrawing from
the pool to hold the confidential token leaks nothing.

## Randomness

Randomness comes from `FHE.randEuint64`, evaluated by the coprocessors. The seed is derived on-chain
from a domain separator, a global counter, the ACL address, the chain id, the previous block hash
and the block timestamp — all public, and a proposer can nudge the timestamp and transaction order.

What a proposer cannot do is predict the result. The seed feeds an oblivious pseudo-random function
under the threshold FHE key; recovering a plaintext requires a KMS decryption that takes seconds and
spans blocks. Grinding is therefore blind: an adversary can force a different draw but cannot see
what they are choosing between, which makes the choice worthless.

Two structural defences back this up:

- The target is sampled and committed in the same transaction that opens the draw, and there is no
  way to abandon a draw once opened. Nobody can observe an outcome and decide whether to keep it.
- `startDraw` is permissionless, so no privileged party controls when a draw happens.

Note for reviewers: Zama's roadmap page still carries a line calling encrypted randomness "a mockup
using a PRNG in the plain, not for use in production". That line contradicts the shipped
implementation, which is a real TFHE oblivious PRF, and contradicts the randomness guide. We flag it
rather than hide it. If it is accurate rather than stale, the analysis above does not hold, and this
is the one dependency assumption worth confirming with Zama.

## The balance inference attack

Zama's own documentation describes it: a function that reverts on an encrypted predicate is a
plaintext oracle. Repeatedly transferring against a victim's balance and observing success or
failure binary-searches that balance without ever decrypting anything.

Two defences, both in the code:

- No function reverts on an encrypted condition. Over-withdrawing moves an encrypted zero and
  succeeds, using OpenZeppelin's `FHESafeMath.tryDecrease`.
- Every entry point taking an encrypted amount checks `FHE.isSenderAllowed` on it, so a caller
  cannot submit a handle belonging to someone else.

## Operational assumptions

- **Coprocessors and the KMS are trusted for confidentiality.** A threshold of KMS signers (7 of 13
  on Sepolia) could decrypt anything. This is inherited from the Zama protocol.
- **`finalizeUnwrap` has no expiry.** The wrapper burns on request and releases the underlying only
  on finalisation, so an unfinalised batch would strand funds. `ExitQueue.finalizeBatch` is
  permissionless so that anyone can complete it; a keeper should still run.
- **Reorgs.** An ACL grant is consumed off-chain optimistically, so a deep reorg can undo contract
  state without undoing a disclosure. Relevant only to values deliberately published.
- **The contracts are not audited.** OpenZeppelin's confidential-contracts library is itself
  pre-1.0 and its own documentation describes it as not formally audited.

## Not claimed

- Membership privacy. Who participates is public.
- Amount privacy against an adversary who controls the KMS threshold.
- Hiding the exit amount from an observer once a participant takes public tokens out.
- Resistance to a proposer who is willing to censor draws entirely rather than bias them.
