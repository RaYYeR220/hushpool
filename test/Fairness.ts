import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import {
  HushPool,
  HushPool__factory,
  TestUnderlying,
  TestUnderlying__factory,
  TestWrappedToken,
  TestWrappedToken__factory,
} from "../types";

const TRANSFER_AND_CALL = "confidentialTransferAndCall(address,bytes32,bytes,bytes)";
const WITHDRAW = "withdraw(bytes32,bytes)";

const MIN_PARTICIPANTS = 2;

/// Mirrors the deployed cap. No case here has more than six participants, so a scan always clamps to
/// the participant count; `test/Benchmarks.ts` measures why a batch above eleven would not fit.
const MAX_SCAN_BATCH = 16;

/// One deposit unit, and the time a deposit is held before the first draw. The hold is long enough
/// that the one-second gaps between the deposit transactions themselves are ~1e-7 of a weight and
/// cannot show up in any of the tests below.
const UNIT = 1_000_000;
const HOLD = 10_000_000;

/// Kept small next to a deposit so that winning barely perturbs the winner's future weight in the
/// interval between the draw settling and the winner handing the prize back.
const PRIZE = 1_000;

/// `FAIRNESS_FULL=1` runs the full sample. The default is a shorter run that still computes and
/// asserts the same statistics, so a plain `npm test` stays quick without going decorative.
/// `FAIRNESS_DRAWS` overrides the count outright, which is how the runtime below was calibrated.
const FULL = process.env.FAIRNESS_FULL !== undefined && process.env.FAIRNESS_FULL !== "";
const DRAWS = Number(process.env.FAIRNESS_DRAWS ?? (FULL ? 800 : 60));

/// Upper-tail critical values of the chi-square distribution at p = 0.001, by degrees of freedom.
/// A statistic above the entry for its df rejects "these counts came from the expected
/// distribution" at the 0.1% level. Values: df=1 10.828, df=2 13.816, df=3 16.266, df=4 18.467,
/// df=5 20.515, df=6 22.458, df=7 24.322.
const CHI2_CRITICAL_P001: Record<number, number> = {
  1: 10.828,
  2: 13.816,
  3: 16.266,
  4: 18.467,
  5: 20.515,
  6: 22.458,
  7: 24.322,
};

type Fixture = {
  underlying: TestUnderlying;
  token: TestWrappedToken;
  tokenAddress: string;
  pool: HushPool;
  poolAddress: string;
};

async function deployFixture(): Promise<Fixture> {
  const underlying = await ((await ethers.getContractFactory("TestUnderlying")) as TestUnderlying__factory).deploy();
  const token = await ((await ethers.getContractFactory("TestWrappedToken")) as TestWrappedToken__factory).deploy(
    await underlying.getAddress(),
  );
  const tokenAddress = await token.getAddress();

  const pool = await ((await ethers.getContractFactory("HushPool")) as HushPool__factory).deploy(
    tokenAddress,
    MIN_PARTICIPANTS,
    MAX_SCAN_BATCH,
  );

  return { underlying, token, tokenAddress, pool, poolAddress: await pool.getAddress() };
}

/// Mint the public token and shield it, which is how a real depositor arrives.
async function fund(fx: Fixture, signer: HardhatEthersSigner, amount: number) {
  await (await fx.underlying.mint(signer.address, amount)).wait();
  await (await fx.underlying.connect(signer).approve(fx.tokenAddress, amount)).wait();
  await (await fx.token.connect(signer).wrap(signer.address, amount)).wait();
}

async function deposit(fx: Fixture, signer: HardhatEthersSigner, amount: number) {
  await fund(fx, signer, amount);
  // Deposit inputs are bound to the token, because the token is the contract that verifies them.
  const enc = await fhevm.createEncryptedInput(fx.tokenAddress, signer.address).add64(amount).encrypt();
  await (
    await fx.token.connect(signer)[TRANSFER_AND_CALL](fx.poolAddress, enc.handles[0], enc.inputProof, "0x")
  ).wait();
}

/// Prizes are funded in the public token and shielded by the pool, so a run needs an up-front
/// allowance large enough to cover every draw it is about to make.
async function approvePrizes(fx: Fixture, sponsorSigner: HardhatEthersSigner, total: number) {
  await (await fx.underlying.mint(sponsorSigner.address, total)).wait();
  await (await fx.underlying.connect(sponsorSigner).approve(fx.poolAddress, total)).wait();
}

async function withdraw(fx: Fixture, signer: HardhatEthersSigner, amount: number) {
  // Withdrawal inputs are bound to the pool, which is the contract that verifies these.
  const enc = await fhevm.createEncryptedInput(fx.poolAddress, signer.address).add64(amount).encrypt();
  await (await fx.pool.connect(signer)[WITHDRAW](enc.handles[0], enc.inputProof)).wait();
}

/// Reads a balance through the mock's debug decryptor, which skips the EIP-712 round trip and is
/// about ten times faster than `userDecryptEuint` -- worth having across the thousands of reads
/// this suite does. `assertOwnerCanRead` below checks the two paths agree, so the shortcut is not
/// quietly reading something the owner could not.
async function balanceOf(fx: Fixture, signer: HardhatEthersSigner): Promise<bigint> {
  const handle = await fx.pool.confidentialBalanceOf(signer.address);
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.debugger.decryptEuint(FhevmType.euint64, handle);
}

async function assertOwnerCanRead(fx: Fixture, signer: HardhatEthersSigner, expected: bigint) {
  const handle = await fx.pool.confidentialBalanceOf(signer.address);
  const asOwner = await fhevm.userDecryptEuint(FhevmType.euint64, handle, fx.poolAddress, signer);
  expect(asOwner, "the owner's own decryption disagrees with the debug decryptor").to.eq(expected);
}

async function runDrawToCompletion(fx: Fixture) {
  await (await fx.pool.startDraw()).wait();
  while (await fx.pool.drawInProgress()) {
    await (await fx.pool.advanceDraw(MAX_SCAN_BATCH)).wait();
  }
}

/**
 * Run `draws` draws over a fixed set of participants and return how often each one won.
 *
 * After every draw the winner withdraws exactly the prize. That serves two purposes: it is the
 * conservation check (the prize has to be there to be taken back), and it restores the weights to
 * what they were, so each draw is an independent sample from the same distribution rather than a
 * step in a rich-get-richer process.
 */
async function collectWins(
  fx: Fixture,
  players: HardhatEthersSigner[],
  baseline: bigint[],
  draws: number,
): Promise<number[]> {
  const wins = new Array<number>(players.length).fill(0);

  for (let d = 0; d < draws; d++) {
    await (await fx.pool.sponsorPrize(PRIZE)).wait();
    await runDrawToCompletion(fx);

    // The mock coprocessor walks its event log with a forward-only cursor, so these decryptions
    // must not be run concurrently.
    let winner = -1;
    for (let i = 0; i < players.length; i++) {
      const delta = (await balanceOf(fx, players[i])) - baseline[i];
      if (delta === 0n) continue;
      expect(delta, `draw ${d}: participant ${i} moved by something other than the prize`).to.eq(BigInt(PRIZE));
      expect(winner, `draw ${d}: participant ${i} was credited as well as participant ${winner}`).to.eq(-1);
      winner = i;
    }
    expect(winner, `draw ${d}: the prize was credited to nobody`).to.not.eq(-1);

    // Once per case, confirm the winner really can read the credited balance themselves.
    if (d === 0) await assertOwnerCanRead(fx, players[winner], baseline[winner] + BigInt(PRIZE));

    wins[winner]++;
    await withdraw(fx, players[winner], PRIZE);
  }

  return wins;
}

function chiSquare(observed: number[], expected: number[]): number {
  let chi = 0;
  for (let i = 0; i < observed.length; i++) {
    chi += (observed[i] - expected[i]) ** 2 / expected[i];
  }
  return chi;
}

/// Print the observed-versus-expected table, and return the statistic alongside its critical value.
function report(
  title: string,
  labels: string[],
  observed: number[],
  expected: number[],
  seconds: number,
): { chi: number; critical: number } {
  const df = observed.length - 1;
  const chi = chiSquare(observed, expected);
  const critical = CHI2_CRITICAL_P001[df];
  const total = observed.reduce((a, b) => a + b, 0);

  const rows = labels.map((label, i) =>
    [
      label.padEnd(22),
      String(observed[i]).padStart(9),
      expected[i].toFixed(2).padStart(10),
      `${((100 * observed[i]) / total).toFixed(2)}%`.padStart(9),
      `${((100 * expected[i]) / total).toFixed(2)}%`.padStart(10),
    ].join(""),
  );

  console.log(`\n  ${title} -- ${total} draws in ${seconds.toFixed(1)}s`);
  console.log(
    `  ${"participant".padEnd(22)}${"observed".padStart(9)}${"expected".padStart(10)}${"share".padStart(9)}${"target".padStart(10)}`,
  );
  console.log(`  ${"-".repeat(60)}`);
  for (const row of rows) console.log(`  ${row}`);
  console.log(
    `  chi-square ${chi.toFixed(3)} vs critical ${critical} (df=${df}, p=0.001) -- ` +
      `${chi < critical ? "PASS: consistent with the expected distribution" : "FAIL: distribution rejected"}`,
  );

  return { chi, critical };
}

describe("HushPool fairness", function () {
  let signers: HardhatEthersSigner[];

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    // Each case runs hundreds of draws, well past the shared mocha timeout.
    this.timeout(0);
    signers = await ethers.getSigners();
  });

  it("Case A: equal deposits held for equal time win with equal frequency", async function () {
    const fx = await deployFixture();
    const players = signers.slice(1, 7);

    for (const p of players) await deposit(fx, p, UNIT);
    await approvePrizes(fx, signers[0], DRAWS * PRIZE);
    await time.increase(HOLD);

    const baseline = new Array<bigint>(players.length).fill(BigInt(UNIT));

    const started = Date.now();
    const wins = await collectWins(fx, players, baseline, DRAWS);
    const seconds = (Date.now() - started) / 1000;

    const expected = new Array<number>(players.length).fill(DRAWS / players.length);
    const { chi, critical } = report(
      "Case A: equal weights, 6 participants",
      players.map((_, i) => `P${i} (1 unit)`),
      wins,
      expected,
      seconds,
    );

    expect(chi, "the winner distribution is not uniform").to.be.lessThan(critical);
    // A shut-out is only evidence of a stuck selector once it has become vanishingly unlikely, which
    // takes an expected count of about ten wins each. Below that, a fair sampler misses a cell often.
    if (expected[0] >= 10) {
      expect(Math.min(...wins), "some participant never won at all").to.be.greaterThan(0);
    }
  });

  it("Case B: deposits in a 1:2:3:4 ratio win in that ratio", async function () {
    const fx = await deployFixture();
    const players = signers.slice(1, 5);
    const weights = [1, 2, 3, 4];

    for (let i = 0; i < players.length; i++) await deposit(fx, players[i], weights[i] * UNIT);
    await approvePrizes(fx, signers[0], DRAWS * PRIZE);
    await time.increase(HOLD);

    const baseline = weights.map((w) => BigInt(w * UNIT));

    const started = Date.now();
    const wins = await collectWins(fx, players, baseline, DRAWS);
    const seconds = (Date.now() - started) / 1000;

    const weightTotal = weights.reduce((a, b) => a + b, 0);
    const expected = weights.map((w) => (DRAWS * w) / weightTotal);
    const { chi, critical } = report(
      "Case B: weights 1:2:3:4, equal holding time",
      players.map((_, i) => `P${i} (${weights[i]} units)`),
      wins,
      expected,
      seconds,
    );

    expect(chi, "win frequencies do not track the deposit ratio").to.be.lessThan(critical);
    // Only the extremes are asserted pairwise. Neighbouring weights (3 units against 4) are close
    // enough that an honest sampler swaps them often at these sample sizes; the chi-square above is
    // what tests the shape of the distribution.
    expect(wins[3], "the largest depositor did not out-win the smallest").to.be.greaterThan(wins[0]);
  });

  it("Case C: the same deposit held twice as long wins twice as often", async function () {
    const fx = await deployFixture();
    const [, early, late] = signers;

    await deposit(fx, early, UNIT);
    await time.increase(HOLD);
    await deposit(fx, late, UNIT);
    await approvePrizes(fx, signers[0], DRAWS * PRIZE);
    await time.increase(HOLD);

    // The early depositor has held one unit for 2 * HOLD, the late one for HOLD, so the
    // time-weighted balances stand at 2:1 and the odds should follow.
    const baseline = [BigInt(UNIT), BigInt(UNIT)];

    const started = Date.now();
    const wins = await collectWins(fx, [early, late], baseline, DRAWS);
    const seconds = (Date.now() - started) / 1000;

    const expected = [(DRAWS * 2) / 3, DRAWS / 3];
    const { chi, critical } = report(
      "Case C: equal deposits, holding times 2:1",
      ["P0 (held 2x)", "P1 (held 1x)"],
      wins,
      expected,
      seconds,
    );

    expect(chi, "win frequencies do not track the time-weighted balances").to.be.lessThan(critical);
    expect(wins[0], "the longer holder did not win more often").to.be.greaterThan(wins[1]);
  });
});
