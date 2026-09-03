# Hushpool

Confidential no-loss prize savings. Deposit a stablecoin, keep the right to withdraw every unit of
it, and periodically one depositor is awarded the accumulated prize — with odds proportional to how
much they held and for how long.

Balances, deposits and winnings are encrypted end to end on the Zama Protocol. So is the outcome:
**the winner is never revealed to anyone.** Not to other depositors, not to an operator, not to the
contract. You find out you won by decrypting your own balance and seeing that it grew.

## Why the winner staying secret is the hard part

Encrypting balances is the easy half. A prize pool leaks its winner in two places that have nothing
to do with the draw:

**At the credit.** If a prize arrives through a claim, the one address that claims is the winner.
Hushpool never credits a prize separately. During the draw every participant is credited
`select(hit, prize, 0)` — the prize for one, an encrypted zero for everyone else — over the same
code path, the same storage writes, the same gas, and the same events. There is nothing to claim
and nothing to observe.

**At the exit.** This is the one nobody solves. `ERC7984ERC20Wrapper.unwrap` makes the amount
publicly decryptable and `finalizeUnwrap` takes the cleartext as public calldata. A winner who
unwraps back to public USDT on their own publishes a number containing the prize, a block later,
however private the draw was. `ExitQueue` removes the lone unwrap: exit requests accumulate with
encrypted amounts, a batch settles only once it holds enough requests and has aged, and the wrapper
is called exactly once for the aggregate. Its event log names this contract and one total, never a
participant.

What that does not fix is written down rather than glossed over. See
[THREAT_MODEL.md](./THREAT_MODEL.md), which enumerates everything public, including the residual.

## Live on Sepolia

**[hushpool.vercel.app](https://hushpool.vercel.app)** — connect a wallet and use every part of it.

| | |
|---|---|
| App | [hushpool.vercel.app](https://hushpool.vercel.app) |
| HushPool | [`0xaD044339Fd6235561aCC6cDc5727ab64eE26F304`](https://sepolia.etherscan.io/address/0xaD044339Fd6235561aCC6cDc5727ab64eE26F304) |
| ExitQueue | [`0x4d0fBa42FFa6aD710D751f50a3941893A362969B`](https://sepolia.etherscan.io/address/0x4d0fBa42FFa6aD710D751f50a3941893A362969B) |
| Asset — Confidential USDT | [`0x4E7B06D78965594eB5EF5414c357ca21E1554491`](https://sepolia.etherscan.io/address/0x4E7B06D78965594eB5EF5414c357ca21E1554491) |
| Faucet — public USDT mock | [`0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`](https://sepolia.etherscan.io/address/0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0) |

The pool runs against Zama's own published Confidential USDT rather than a token of our own, so the
faucet is the canonical one: call `mint(yourAddress, 1000000000)` on the public mock for 1,000 USDT.
It is open to anyone, repeatable, and needs no allowlist.

A complete draw over twelve live participants, chunked into two scans:
[`startDraw`](https://sepolia.etherscan.io/tx/0xab09ac1e66fc3fd5974ed43f908629aa4ff89f40f338e87c9f2073efae912b50)
· [`advanceDraw`](https://sepolia.etherscan.io/tx/0x78352c9a8d75e15aa35edca7a1f18137d1feee1fbbd48a11e2f2b699463ffc98)
· [`advanceDraw`](https://sepolia.etherscan.io/tx/0x9d9cbda7ad85a9831a2792a052014876dcaafcd7b69c900a2ba7e780f22c055b).

Read them. There is no winner in any of them, because none of them knows: the only per-scan event is
`DrawAdvanced`, carrying a count. Twelve balances were written and one of them changed, and which
one is not recoverable from the chain.

## How a draw works

Odds follow a time-weighted average balance, so depositing moments before a draw does not buy full
odds. Each participant accumulates `balance x elapsed` as an `euint128`; the pool maintains the same
integral globally in O(1), and the two agree by linearity.

`startDraw` samples a target uniformly from the encrypted total:

```
target = (randEuint64(2**32) * totalTwab) >> 32
```

`randEuint*` needs a plaintext, power-of-two bound, and `FHE.rem` only accepts plaintext divisors,
so there is no way to take a modulus against an encrypted total. Rescaling a 32-bit draw sidesteps
both: the product stays inside `euint128` for any total below `2**96`, and the bias is under
`2**-32`. The target is never decrypted.

`advanceDraw` then walks participants accumulating an encrypted prefix sum, latching the first one
whose slice contains the target:

```solidity
ebool hit = i + 1 == draw.participantCount
    ? FHE.not(found)                                  // the last one absorbs any residual
    : FHE.and(FHE.not(found), FHE.lt(target, cursor));
found = FHE.or(found, hit);
euint64 award = FHE.select(hit, prize, FHE.asEuint64(0));
```

The walk is chunked across transactions and resumable by anyone. That is not an optimisation but a
hard limit: a scanned participant costs about 1.70M HCU against FHEVM's 20M per-transaction budget,
so eleven fit in one transaction and a twelfth reverts.

## Measured cost

Not estimates. Gas and HCU are read from the local FHEVM mock, and the ceiling was confirmed against
the live network, where `advanceDraw(11)` succeeds and `advanceDraw(12)` reverts with
`HCUTransactionLimitExceeded`.

| operation | gas | HCU (global) | HCU (depth) |
| --- | ---: | ---: | ---: |
| deposit, first time | 1,106,799 | 2,668,352 | 955,064 |
| deposit, already a participant | 957,269 | 3,623,192 | 955,032 |
| withdraw | 754,457 | 3,289,128 | 955,032 |
| sponsorPrize | 297,428 | 586,064 | 531,032 |
| startDraw | 313,617 | 2,702,128 | 2,678,032 |

| participants scanned | gas | gas each | HCU (global) | HCU (depth) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 372,855 | 372,855 | 1,695,098 | 1,671,032 |
| 4 | 1,115,569 | 278,892 | 6,780,296 | 2,448,032 |
| 8 | 2,103,194 | 262,899 | 13,560,560 | 3,484,032 |
| 16 | reverts | — | — | — |

Marginal cost per scanned participant: **247,176 gas**, **1,695,066 HCU**, and **259,000 HCU of
dependency depth**, on a fixed 126,111 gas per call. The global budget is exhausted at 11
participants and the dependency chain only at 13, so the global budget binds first. Deployments
configure a scan batch of 8, leaving headroom.

Reproduce with `npx hardhat test test/Benchmarks.ts`.

## The draw is provably unbiased

`test/Fairness.ts` runs 800 draws per case and tests the winner distribution with a chi-square
goodness-of-fit test at p = 0.001. Every draw also asserts that exactly one balance moved and that it
moved by exactly the prize.

| case | df | chi-square | critical value | result |
| --- | ---: | ---: | ---: | --- |
| six equal deposits, equal holding time | 5 | 3.880 | 20.515 | pass |
| deposits in a 1:2:3:4 ratio | 3 | 1.129 | 16.266 | pass |
| equal deposits, holding times 2:1 | 1 | 0.181 | 10.828 | pass |

In the time-weighting case the longer holder won 67.4% of 800 draws against the 66.7% its
time-weighted share predicts.

Reproduce with `FAIRNESS_FULL=1 npx hardhat test test/Fairness.ts`.

## Try it in five minutes

Open [hushpool.vercel.app](https://hushpool.vercel.app) with any injected wallet on Sepolia. There
are already depositors in the pool, so every step below works immediately.

1. **Mint test funds.** Press *Mint tUSDT*. The faucet is Zama's own public USDT mock, open to
   anyone, so no allowlist and nobody to ask.
2. **Deposit.** Press *Deposit privately*. Your wallet signs a shield, then a transfer that carries
   a ciphertext rather than a number. Look at the transaction afterwards: the amount is not in it.
3. **Read your own balance.** Press *Decrypt for me*. You sign once, and the number resolves out of
   the surface. Nothing was published to reveal it — the same handle stays unreadable to everyone
   else, including us.
4. **Run a draw.** Press *Start a draw*, then *Advance the scan* until it settles. Open either
   transaction on Etherscan. There is no winner in it. The prize has already been credited, to an
   encrypted balance, and the winning index was never decrypted.
5. **Check whether it was you.** Decrypt your balance again. If it grew, you won, and you are the
   only person who knows.

Everything else runs locally with no keys and no network:

```bash
git clone <this repo> && cd hushpool
npm install
npx hardhat test                                     # 36 tests
FAIRNESS_FULL=1 npx hardhat test test/Fairness.ts     # 2,400 draws, chi-square
npx hardhat test test/Benchmarks.ts                   # the cost tables above
```

## Repository

```
contracts/HushPool.sol       the pool: deposits, TWAB, the oblivious draw, withdrawals
contracts/ExitQueue.sol      batched unshielding back to the public token
contracts/test/              a public token and its confidential wrapper, for local tests
test/                        deposits, withdrawals, draws, solvency, the exit round trip
scripts/                     seed and drive a live deployment
deploy/                      deployment, wired to the canonical Confidential USDT on Sepolia
```

## Engineering notes

Things that are not in the "wrap an ERC-20" starter and cost real time to get right:

- **You cannot branch on a ciphertext, and you must not revert on one.** A function that reverts on
  an encrypted predicate is a plaintext oracle: repeated calls binary-search a victim's balance
  without decrypting anything. Over-withdrawing here moves an encrypted zero and succeeds. Every
  entry point taking an encrypted amount also checks `FHE.isSenderAllowed`.
- **A draw must always credit somebody.** The target is drawn from the pool's running total of
  time-weighted balances, and the scan credits whoever's slice contains it. An earlier revision
  added a prize to that total without settling the pool's clock first, so the prize was integrated
  over a window predating it; the total drifted above the sum of the slices, and a target landing in
  that gap belonged to nobody — the prize stayed in the contract, owned by no one and
  unwithdrawable. It is fixed in two independent ways: the clock is settled at the draw instant
  before the prize joins the total, and the last participant scanned absorbs any residual. A stress
  test with prizes as large as the pool and long quiet gaps reproduces the original failure and
  passes now.
- **Prizes have to be solvent before they are credited.** An earlier revision incremented the pot
  without taking tokens, which would have made the final withdrawal silently pay zero. Prizes are
  now funded in the public underlying and shielded by the pool, so the tokens are in hand before a
  draw can award them. A test drains the pool after a draw, winner included.
- **Withdrawals stay open during a draw.** Freezing them would be far simpler, but "principal
  withdrawable at any time" is the whole point of no-loss. A participant who moves funds mid-scan
  has their draw-time weight frozen first, so odds fixed when the draw opened cannot be changed.
- **ACL discipline.** Every persisted handle is re-allowed to the contract, and every
  user-readable handle to its owner. A stored handle that misses `allowThis` is bricked
  permanently, with no error at the time of the mistake.
- **`euint128` for the time integral.** `balance x seconds` overflows 64 bits for realistic
  balances and periods.
- **Verification needs the network the contract was deployed against.** The Hardhat plugin rewrites
  `ZamaConfig.sol` with protocol addresses for the target network, so the coprocessor addresses are
  baked into the bytecode at compile time. Compiling for the local mock and then verifying produces
  a bytecode mismatch that looks like a compiler-settings problem and is not. Run
  `npx hardhat compile --force --network sepolia` before verifying.

## Known limits

Stated here rather than left for a reviewer to find.

- **The participant list never shrinks.** A depositor who withdraws everything stays in the array and
  is still scanned on every draw, at 247k gas a time. A pool that has ever seen a thousand addresses
  would need 91 transactions per draw, permanently. Removing an entry safely means also removing that
  participant's contribution to the encrypted global time-weighted total, and a clamped subtraction
  there could silently zero the total and hand every draw to the first participant. Doing it properly
  needs a signed accumulator or a tombstone-and-rebuild pass, which is more than this deadline
  allowed. Nothing is at risk of being lost — the cost is gas, and it is bounded and measurable.
- **A participant who moves funds mid-scan keeps a slightly stale clock.** Their draw-time weight is
  frozen correctly, so their odds are right, but the prize credited to them is not folded into their
  time-weighted balance until they next touch their position. The error is bounded by the duration of
  the scan.
- **Nothing here is audited.** OpenZeppelin's confidential-contracts library is itself pre-1.0 and its
  own documentation describes it as not formally audited.

## Bounty requirements

| Requirement | Where |
|---|---|
| Deposits, balances and winnings encrypted end to end | `HushPool.sol`, and the table in [THREAT_MODEL.md](./THREAT_MODEL.md) |
| Winner selection on-chain over encrypted balances, deposit-weighted | `HushPool.startDraw` / `advanceDraw` |
| On-chain FHE randomness, no off-chain RNG | `FHE.randEuint64`, no oracle and no VRF anywhere |
| Only winners learn their prize | Credited into an encrypted balance; nothing is ever revealed |
| The draw is publicly verifiable | Every step on-chain and permissionless; `startDraw` and `advanceDraw` are callable by anyone |
| Design and information leakage documented | [THREAT_MODEL.md](./THREAT_MODEL.md) |
| No-loss guarantee, principal withdrawable at any time | `withdraw`, available during a draw; solvency test drains the pool |
| Automated draws or a documented keeper flow | `scripts/draw.ts`; both draw entry points are permissionless |
| Faucet and instructions for the test token | Canonical public USDT mock, open `mint`, linked above |

## Licence

MIT.
