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

| | |
|---|---|
| HushPool | [`0x9D53a0A8467EeB5173eCd9b09C862A622bF90f94`](https://sepolia.etherscan.io/address/0x9D53a0A8467EeB5173eCd9b09C862A622bF90f94) |
| ExitQueue | [`0xBafc7876ACb9511b06fd888584B1a1327BE0e203`](https://sepolia.etherscan.io/address/0xBafc7876ACb9511b06fd888584B1a1327BE0e203) |
| Asset — Confidential USDT | [`0x4E7B06D78965594eB5EF5414c357ca21E1554491`](https://sepolia.etherscan.io/address/0x4E7B06D78965594eB5EF5414c357ca21E1554491) |
| Faucet — public USDT mock | [`0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`](https://sepolia.etherscan.io/address/0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0) |

The pool runs against Zama's own published Confidential USDT rather than a token of our own, so the
faucet is the canonical one: call `mint(yourAddress, 1000000000)` on the public mock for 1,000 USDT.
It is open to anyone, repeatable, and needs no allowlist.

A completed draw over live participants:
[`startDraw`](https://sepolia.etherscan.io/tx/0x80f455a47d110e6132f9a44c86e6949172a0dffc05d384de64ec4a6b480ba48a)
· [`advanceDraw`](https://sepolia.etherscan.io/tx/0x91d659c155667d481c7a05a57f957b89db13d262fbb28fbba42525742c566f80).
Neither transaction reveals a winner, because neither one knows.

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
ebool hit = FHE.and(FHE.not(found), FHE.lt(target, cursor));
found = FHE.or(found, hit);
euint64 award = FHE.select(hit, prize, FHE.asEuint64(0));
```

The walk is chunked across transactions and resumable by anyone. That is not an optimisation: a
prefix sum is a sequential dependency chain, and FHEVM caps a transaction at 5M HCU along any single
chain, well before the 20M global cap becomes the constraint.

## Try it in five minutes

```bash
git clone <this repo> && cd hushpool
npm install
npx hardhat test          # 25+ tests, no keys, no network
```

Against the live deployment, with a funded Sepolia key in `.env`:

```bash
npx hardhat run scripts/seed.ts --network sepolia   # fund demo depositors, top up the pot
npx hardhat run scripts/draw.ts --network sepolia   # run a draw, print the cost of every tx
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
