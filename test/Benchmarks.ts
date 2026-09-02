import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import type { HDNodeWallet, TransactionReceipt } from "ethers";
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

const UNIT = 1_000_000;
const PRIZE = 10_000;
const HOLD = 3_600;

/// The batch sizes `deploy/01_pool.ts` implies are usable.
const SCAN_BATCHES = [1, 4, 8, 16];

/// The value the deploy script passes as `maxScanBatch`.
const DEPLOYED_SCAN_BATCH = 8;

/// The scan pool holds more participants than any measured batch, so no measured call is also the
/// one that settles the draw and picks up the settlement cost.
const SCAN_PARTICIPANTS = 24;

/// `advanceDraw` clamps to `maxScanBatch`, so the scan pool's own cap has to sit above every probe.
const SCAN_CAP = 32;

/// A generated wallet is a full signer, which is what lets the scan pool go past the twenty accounts
/// the local network is configured with.
type Player = HardhatEthersSigner | HDNodeWallet;

type Fixture = {
  underlying: TestUnderlying;
  token: TestWrappedToken;
  tokenAddress: string;
  pool: HushPool;
  poolAddress: string;
};

type Row = { label: string; gas: bigint; globalHCU: number; depthHCU: number };
type ScanRow = { batch: number; row?: Row; reason?: string };

const operations: Row[] = [];
const scans: ScanRow[] = [];
const notes: string[] = [];

async function deployFixture(minParticipants: number, maxScanBatch: number): Promise<Fixture> {
  const underlying = await ((await ethers.getContractFactory("TestUnderlying")) as TestUnderlying__factory).deploy();
  const token = await ((await ethers.getContractFactory("TestWrappedToken")) as TestWrappedToken__factory).deploy(
    await underlying.getAddress(),
  );
  const tokenAddress = await token.getAddress();

  const pool = await ((await ethers.getContractFactory("HushPool")) as HushPool__factory).deploy(
    tokenAddress,
    minParticipants,
    maxScanBatch,
  );

  return { underlying, token, tokenAddress, pool, poolAddress: await pool.getAddress() };
}

async function fund(fx: Fixture, player: Player, amount: number) {
  await (await fx.underlying.mint(player.address, amount)).wait();
  await (await fx.underlying.connect(player).approve(fx.tokenAddress, amount)).wait();
  await (await fx.token.connect(player).wrap(player.address, amount)).wait();
}

async function deposit(fx: Fixture, player: Player, amount: number): Promise<TransactionReceipt> {
  const enc = await fhevm.createEncryptedInput(fx.tokenAddress, player.address).add64(amount).encrypt();
  const tx = await fx.token.connect(player)[TRANSFER_AND_CALL](fx.poolAddress, enc.handles[0], enc.inputProof, "0x");
  return (await tx.wait())!;
}

async function withdraw(fx: Fixture, player: Player, amount: number): Promise<TransactionReceipt> {
  const enc = await fhevm.createEncryptedInput(fx.poolAddress, player.address).add64(amount).encrypt();
  const tx = await fx.pool.connect(player)[WITHDRAW](enc.handles[0], enc.inputProof);
  return (await tx.wait())!;
}

async function approvePrizes(fx: Fixture, sponsorSigner: HardhatEthersSigner, total: number) {
  await (await fx.underlying.mint(sponsorSigner.address, total)).wait();
  await (await fx.underlying.connect(sponsorSigner).approve(fx.poolAddress, total)).wait();
}

function measure(label: string, receipt: TransactionReceipt): Row {
  const hcu = fhevm.computeTransactionHCU(receipt);
  return { label, gas: receipt.gasUsed, globalHCU: hcu.globalHCU, depthHCU: hcu.maxHCUDepth };
}

function fmt(n: bigint | number): string {
  return n.toLocaleString("en-US");
}

/// Pull the custom error name out of a Hardhat revert message, falling back to the whole first line.
function revertName(message: string): string {
  return /custom error '([^']+)'/.exec(message)?.[1] ?? message.split("\n")[0].trim();
}

/// Least-squares fit of cost against the number of participants scanned. The slope is the marginal
/// cost of one more participant, the intercept the fixed cost of an `advanceDraw` call.
function fitLine(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = num / den;
  return { slope, intercept: meanY - slope * meanX };
}

/// Seed a pool with `count` depositors, drawing on the configured accounts first and then on
/// generated wallets, which are funded on demand.
async function seedScanPool(fx: Fixture, signers: HardhatEthersSigner[], count: number): Promise<Player[]> {
  const players: Player[] = signers.slice(1, Math.min(count + 1, signers.length));

  while (players.length < count) {
    const wallet = ethers.Wallet.createRandom(ethers.provider);
    await (await signers[0].sendTransaction({ to: wallet.address, value: ethers.parseEther("1") })).wait();
    players.push(wallet);
  }

  for (const p of players) {
    await fund(fx, p, UNIT);
    await deposit(fx, p, UNIT);
  }
  return players;
}

describe("HushPool benchmarks", function () {
  let signers: HardhatEthersSigner[];

  // Seeding two dozen depositors is the slow part of this file, so the scan measurements share a pool.
  let scanPool: { fx: Fixture; players: Player[] } | undefined;

  async function sharedScanPool() {
    if (scanPool === undefined) {
      const fx = await deployFixture(3, SCAN_CAP);
      const players = await seedScanPool(fx, signers, SCAN_PARTICIPANTS);
      await approvePrizes(fx, signers[0], PRIZE * 64);
      scanPool = { fx, players };
    }
    return scanPool;
  }

  /// Open a draw, make one `advanceDraw` call of `batch`, then leave the pool with no draw open.
  async function probeBatch(fx: Fixture, batch: number) {
    await (await fx.pool.sponsorPrize(PRIZE)).wait();
    await time.increase(HOLD);
    await (await fx.pool.startDraw()).wait();
    const drawId = await fx.pool.currentDrawId();

    let receipt: TransactionReceipt | undefined;
    let reason = "";
    try {
      receipt = (await (await fx.pool.advanceDraw(batch)).wait())!;
    } catch (error) {
      reason = revertName((error as Error).message);
    }
    const scannedAfter = Number((await fx.pool.drawInfo(drawId)).scanned);

    while (await fx.pool.drawInProgress()) await (await fx.pool.advanceDraw(8)).wait();
    return { receipt, reason, scannedAfter };
  }

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    this.timeout(0);
    signers = await ethers.getSigners();
  });

  it("measures the gas of every user-facing operation", async function () {
    const fx = await deployFixture(3, 16);
    const [, alice, bob, carol] = signers;

    for (const p of [alice, bob, carol]) await fund(fx, p, 4 * UNIT);

    operations.push(measure("deposit (first, joins the participant list)", await deposit(fx, alice, UNIT)));
    operations.push(measure("deposit (repeat, already a participant)", await deposit(fx, alice, UNIT)));
    await deposit(fx, bob, UNIT);
    await deposit(fx, carol, UNIT);

    operations.push(measure("withdraw", await withdraw(fx, alice, UNIT)));

    await approvePrizes(fx, signers[0], PRIZE);
    const sponsored = (await (await fx.pool.sponsorPrize(PRIZE)).wait())!;
    operations.push(measure("sponsorPrize (takes the funds and shields them)", sponsored));

    await time.increase(HOLD);
    operations.push(measure("startDraw", (await (await fx.pool.startDraw()).wait())!));
    const settled = (await (await fx.pool.advanceDraw(16)).wait())!;
    operations.push(measure("advanceDraw (3 participants, settles the draw)", settled));

    expect(await fx.pool.drawInProgress()).to.eq(false);
    for (const row of operations) expect(row.gas, `${row.label} used no gas`).to.be.greaterThan(0n);
  });

  it("measures the marginal cost of scanning one more participant", async function () {
    const { fx, players } = await sharedScanPool();
    expect(await fx.pool.participantCount()).to.eq(BigInt(players.length));

    for (const batch of SCAN_BATCHES) {
      // Measure the first call of a fresh draw, so every point covers the same work: no settlement,
      // and the same cold-to-warm storage transitions.
      const { receipt, reason } = await probeBatch(fx, batch);
      scans.push(receipt === undefined ? { batch, reason } : { batch, row: measure(`advanceDraw(${batch})`, receipt) });
    }

    const measured = scans.filter((s) => s.row !== undefined);
    expect(measured.length, "no scan batch could be measured at all").to.be.greaterThan(2);

    const xs = measured.map((s) => s.batch);
    const gasFit = fitLine(
      xs,
      measured.map((s) => Number(s.row!.gas)),
    );
    const hcuFit = fitLine(
      xs,
      measured.map((s) => s.row!.globalHCU),
    );
    const depthFit = fitLine(
      xs,
      measured.map((s) => s.row!.depthHCU),
    );
    notes.push(
      `Marginal scan cost: **${fmt(Math.round(gasFit.slope))} gas**, **${fmt(Math.round(hcuFit.slope))} HCU** and ` +
        `**${fmt(Math.round(depthFit.slope))} HCU of dependency depth** per participant, on top of a fixed ` +
        `${fmt(Math.round(gasFit.intercept))} gas per \`advanceDraw\` call.`,
    );
    notes.push(
      `Extrapolating the fits, the 20M per-transaction HCU budget is spent at ` +
        `${Math.floor((20_000_000 - hcuFit.intercept) / hcuFit.slope)} participants and the 5M dependency-chain ` +
        `budget at ${Math.floor((5_000_000 - depthFit.intercept) / depthFit.slope)}, so the global budget binds ` +
        `first -- the opposite of what \`deploy/01_pool.ts\` assumes.`,
    );

    expect(gasFit.slope, "scanning a participant should cost gas").to.be.greaterThan(0);
    // If the per-participant term did not dominate a full batch, the scan would not be doing
    // per-participant work, which is the whole point of the oblivious walk.
    expect(gasFit.slope * 16, "the per-participant term should dominate a full batch").to.be.greaterThan(
      gasFit.intercept,
    );
  });

  it("reverts cleanly above the largest scan batch that fits in one transaction", async function () {
    const { fx, players } = await sharedScanPool();

    // Binary search the boundary. Cost is monotone in the batch size, so there is one crossing.
    let good = 1;
    let bad = SCAN_PARTICIPANTS + 1;
    let firstFailure = "";

    while (bad - good > 1) {
      const mid = Math.floor((good + bad) / 2);
      const result = await probeBatch(fx, mid);
      if (result.receipt !== undefined) {
        good = mid;
      } else {
        bad = mid;
        firstFailure = result.reason;
        // A rejected batch must leave the draw exactly as it was: nothing scanned, still open.
        expect(result.scannedAfter, `a failed advanceDraw(${mid}) moved the scan cursor`).to.eq(0);
      }
    }

    expect(good, "not even a single participant could be scanned").to.be.greaterThan(0);
    expect(bad, `no batch up to ${SCAN_PARTICIPANTS} failed, so the ceiling is above what was probed`).to.be.lessThan(
      SCAN_PARTICIPANTS + 1,
    );

    // Re-run the first failing size to pin the failure mode: a revert that moves nothing, after
    // which smaller batches still carry the same draw to a correct settlement.
    const failed = await probeBatch(fx, bad);
    expect(failed.receipt, `advanceDraw(${bad}) unexpectedly went through`).to.eq(undefined);
    expect(failed.scannedAfter, "the failed call left the scan cursor moved").to.eq(0);
    expect(await fx.pool.drawInProgress(), "the pool was left mid-draw").to.eq(false);

    const settled = await fx.pool.drawInfo(await fx.pool.currentDrawId());
    expect(settled.scanned, "the recovery scan did not cover every participant").to.eq(players.length);
    expect(settled.state, "the draw did not reach the settled state").to.eq(2);

    notes.push(
      `Largest batch that fits in one transaction: **${good} participants**. \`advanceDraw(${bad})\` is rejected ` +
        `with \`${firstFailure}\`, leaving \`scanned\` at 0 and the draw still open, so a smaller batch finishes ` +
        `it unharmed -- the failure is a clean revert, not a partial scan.`,
    );
    notes.push(
      good < DEPLOYED_SCAN_BATCH
        ? `\`deploy/01_pool.ts\` configures \`maxScanBatch = ${DEPLOYED_SCAN_BATCH}\`, ` +
            `${DEPLOYED_SCAN_BATCH - good} above that ceiling. On a pool with ${good + 1} or more participants, ` +
            `\`advanceDraw(maxScanBatch)\` always reverts.`
        : `\`deploy/01_pool.ts\` configures \`maxScanBatch = ${DEPLOYED_SCAN_BATCH}\`, ` +
            `${good - DEPLOYED_SCAN_BATCH} below that ceiling.`,
    );
  });

  it("completes a batch at the maxScanBatch the deploy script configures", async function () {
    // `deploy/01_pool.ts` ships maxScanBatch = 8 and the reference flow calls
    // `advanceDraw(maxScanBatch)`. That has to be executable on a pool large enough to use it.
    const fx = await deployFixture(3, DEPLOYED_SCAN_BATCH);
    await seedScanPool(fx, signers, DEPLOYED_SCAN_BATCH + 2);
    await approvePrizes(fx, signers[0], PRIZE);

    await (await fx.pool.sponsorPrize(PRIZE)).wait();
    await time.increase(HOLD);
    await (await fx.pool.startDraw()).wait();

    await expect(fx.pool.advanceDraw(DEPLOYED_SCAN_BATCH), "the configured scan batch does not fit in a transaction").to
      .not.be.reverted;
  });

  after(function () {
    if (operations.length === 0 && scans.length === 0) return;

    const lines: string[] = [""];
    lines.push("### HushPool measured cost (local FHEVM mock, solc 0.8.27, optimizer runs=800)");
    lines.push("");
    lines.push("| operation | gas | HCU (global) | HCU (depth) |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const r of operations) {
      lines.push(`| ${r.label} | ${fmt(r.gas)} | ${fmt(r.globalHCU)} | ${fmt(r.depthHCU)} |`);
    }
    lines.push("");
    lines.push("| participants scanned | gas | gas per participant | HCU (global) | HCU (depth) |");
    lines.push("| ---: | ---: | ---: | ---: | ---: |");
    for (const s of scans) {
      if (s.row === undefined) {
        lines.push(`| ${s.batch} | reverted: \`${s.reason}\` | - | - | - |`);
        continue;
      }
      const perParticipant = Math.round(Number(s.row.gas) / s.batch);
      lines.push(
        `| ${s.batch} | ${fmt(s.row.gas)} | ${fmt(perParticipant)} | ${fmt(s.row.globalHCU)} | ${fmt(s.row.depthHCU)} |`,
      );
    }
    lines.push("");
    for (const n of notes) lines.push(`- ${n}`);
    lines.push("");

    console.log(lines.join("\n"));
  });
});
