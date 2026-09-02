import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { HushPool, HushPool__factory, TestConfidentialToken, TestConfidentialToken__factory } from "../types";

const TRANSFER_AND_CALL = "confidentialTransferAndCall(address,bytes32,bytes,bytes)";

const MIN_PARTICIPANTS = 3;
const MAX_SCAN_BATCH = 16;

describe("HushPool", function () {
  let token: TestConfidentialToken;
  let tokenAddress: string;
  let pool: HushPool;
  let poolAddress: string;
  let signers: HardhatEthersSigner[];

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    signers = await ethers.getSigners();

    token = await (
      (await ethers.getContractFactory("TestConfidentialToken")) as TestConfidentialToken__factory
    ).deploy();
    tokenAddress = await token.getAddress();

    pool = await ((await ethers.getContractFactory("HushPool")) as HushPool__factory).deploy(
      tokenAddress,
      MIN_PARTICIPANTS,
      MAX_SCAN_BATCH,
    );
    poolAddress = await pool.getAddress();
  });

  async function fund(signer: HardhatEthersSigner, amount: number) {
    await (await token.mint(signer.address, amount)).wait();
  }

  async function deposit(signer: HardhatEthersSigner, amount: number) {
    const enc = await fhevm.createEncryptedInput(tokenAddress, signer.address).add64(amount).encrypt();
    const tx = await token.connect(signer)[TRANSFER_AND_CALL](poolAddress, enc.handles[0], enc.inputProof, "0x");
    return tx.wait();
  }

  async function balanceOf(signer: HardhatEthersSigner): Promise<bigint> {
    const handle = await pool.confidentialBalanceOf(signer.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, signer);
  }

  /// The mock coprocessor walks its event log with a forward-only cursor, so concurrent decryptions
  /// make it fail with "Parse event ... in backward order". Decrypt one at a time.
  async function balancesOf(players: HardhatEthersSigner[]): Promise<bigint[]> {
    const out: bigint[] = [];
    for (const p of players) out.push(await balanceOf(p));
    return out;
  }

  async function seed(count: number, amount = 1_000_000): Promise<HardhatEthersSigner[]> {
    const players = signers.slice(1, 1 + count);
    for (const p of players) {
      await fund(p, amount);
      await deposit(p, amount);
    }
    return players;
  }

  async function runDrawToCompletion() {
    await (await pool.startDraw()).wait();
    while (await pool.drawInProgress()) {
      await (await pool.advanceDraw(MAX_SCAN_BATCH)).wait();
    }
  }

  describe("deposits", function () {
    it("credits an encrypted balance readable only by its owner", async function () {
      const [, alice, bob] = signers;
      await fund(alice, 5_000_000);
      await deposit(alice, 5_000_000);

      expect(await balanceOf(alice)).to.eq(5_000_000n);

      const handle = await pool.confidentialBalanceOf(alice.address);
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, bob)).to.be.rejected;
    });

    it("registers a depositor exactly once", async function () {
      const [, alice] = signers;
      await fund(alice, 4_000_000);
      await deposit(alice, 2_000_000);
      await deposit(alice, 2_000_000);

      expect(await pool.participantCount()).to.eq(1n);
      expect(await balanceOf(alice)).to.eq(4_000_000n);
    });

    it("rejects a direct callback from anything other than the asset", async function () {
      const [, alice] = signers;
      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1).encrypt();
      await expect(
        pool.connect(alice).onConfidentialTransferReceived(alice.address, alice.address, enc.handles[0], "0x"),
      ).to.be.revertedWithCustomError(pool, "NotTheAsset");
    });
  });

  describe("withdrawals", function () {
    it("returns principal on request", async function () {
      const [, alice] = signers;
      await fund(alice, 3_000_000);
      await deposit(alice, 3_000_000);

      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
      await (await pool.connect(alice)["withdraw(bytes32,bytes)"](enc.handles[0], enc.inputProof)).wait();

      expect(await balanceOf(alice)).to.eq(2_000_000n);
    });

    it("moves nothing when asked for more than the balance, and does not revert", async function () {
      const [, alice] = signers;
      await fund(alice, 1_000_000);
      await deposit(alice, 1_000_000);

      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(9_999_999).encrypt();
      await (await pool.connect(alice)["withdraw(bytes32,bytes)"](enc.handles[0], enc.inputProof)).wait();

      expect(await balanceOf(alice)).to.eq(1_000_000n);
    });

    it("stays available while a draw is being scanned, so the no-loss guarantee never pauses", async function () {
      const players = await seed(4);
      await (await pool.sponsorPrize(500_000)).wait();
      await time.increase(3_600);
      await (await pool.startDraw()).wait();

      expect(await pool.drawInProgress()).to.eq(true);

      const alice = players[0];
      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
      await expect(pool.connect(alice)["withdraw(bytes32,bytes)"](enc.handles[0], enc.inputProof)).to.not.be.reverted;
    });
  });

  describe("draw preconditions", function () {
    it("refuses to draw below the minimum anonymity set", async function () {
      await seed(MIN_PARTICIPANTS - 1);
      await (await pool.sponsorPrize(100_000)).wait();
      await time.increase(3_600);

      await expect(pool.startDraw())
        .to.be.revertedWithCustomError(pool, "TooFewParticipants")
        .withArgs(MIN_PARTICIPANTS - 1, MIN_PARTICIPANTS);
    });

    it("refuses to draw with an empty pot", async function () {
      await seed(MIN_PARTICIPANTS);
      await time.increase(3_600);
      await expect(pool.startDraw()).to.be.revertedWithCustomError(pool, "NoPrize");
    });

    it("refuses to open a second draw while one is scanning", async function () {
      await seed(4);
      await (await pool.sponsorPrize(100_000)).wait();
      await time.increase(3_600);
      await (await pool.startDraw()).wait();

      await expect(pool.startDraw()).to.be.revertedWithCustomError(pool, "DrawInProgress");
    });
  });

  describe("the draw", function () {
    it("awards the whole prize to exactly one participant", async function () {
      const players = await seed(5);
      const prize = 700_000;
      await (await pool.sponsorPrize(prize)).wait();
      await time.increase(3_600);

      const before = await balancesOf(players);
      await runDrawToCompletion();
      const after = await balancesOf(players);

      const deltas = after.map((v, i) => v - before[i]);
      const winners = deltas.filter((d) => d !== 0n);

      expect(winners.length, "exactly one participant is credited").to.eq(1);
      expect(winners[0], "the winner receives the whole prize").to.eq(BigInt(prize));
      expect(deltas.reduce((a, b) => a + b, 0n)).to.eq(BigInt(prize));
    });

    it("resumes a scan across several transactions", async function () {
      const players = await seed(6);
      await (await pool.sponsorPrize(300_000)).wait();
      await time.increase(3_600);

      await (await pool.startDraw()).wait();
      const drawId = await pool.currentDrawId();

      await (await pool.advanceDraw(2)).wait();
      expect((await pool.drawInfo(drawId)).scanned).to.eq(2);
      expect(await pool.drawInProgress()).to.eq(true);

      await (await pool.advanceDraw(2)).wait();
      expect((await pool.drawInfo(drawId)).scanned).to.eq(4);
      expect(await pool.drawInProgress()).to.eq(true);

      await (await pool.advanceDraw(2)).wait();
      expect(await pool.drawInProgress()).to.eq(false);

      const after = await balancesOf(players);
      expect(after.filter((v) => v > 1_000_000n).length).to.eq(1);
    });

    it("emits the same event shape for every participant, winner or not", async function () {
      await seed(4);
      await (await pool.sponsorPrize(200_000)).wait();
      await time.increase(3_600);
      await (await pool.startDraw()).wait();

      const receipt = await (await pool.advanceDraw(MAX_SCAN_BATCH)).wait();
      const logs = receipt!.logs.filter((l) => l.address === poolAddress);
      const decoded = logs.map((l) => pool.interface.parseLog(l)!.name);

      // Nothing per-participant is emitted: the only trace of a scan batch is the batch itself.
      expect(decoded).to.deep.eq(["DrawSettled", "DrawAdvanced"]);
    });

    it("clears the pot when a draw opens so a prize cannot be paid twice", async function () {
      await seed(4);
      await (await pool.sponsorPrize(200_000)).wait();
      await time.increase(3_600);
      await (await pool.startDraw()).wait();

      expect(await pool.prizePot()).to.eq(0n);
    });
  });

  describe("time weighting", function () {
    it("gives a late depositor less weight than an early one for the same amount", async function () {
      const [, alice, bob] = signers;

      await fund(alice, 1_000_000);
      await deposit(alice, 1_000_000);
      await time.increase(10_000);

      await fund(bob, 1_000_000);
      await deposit(bob, 1_000_000);
      await time.increase(100);

      // Force both accumulators to fold in elapsed time.
      const encZero = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(0).encrypt();
      await (await pool.connect(alice)["withdraw(bytes32,bytes)"](encZero.handles[0], encZero.inputProof)).wait();
      const encZeroB = await fhevm.createEncryptedInput(poolAddress, bob.address).add64(0).encrypt();
      await (await pool.connect(bob)["withdraw(bytes32,bytes)"](encZeroB.handles[0], encZeroB.inputProof)).wait();

      const aliceTwab = await fhevm.userDecryptEuint(
        FhevmType.euint128,
        await pool.confidentialTwabOf(alice.address),
        poolAddress,
        alice,
      );
      const bobTwab = await fhevm.userDecryptEuint(
        FhevmType.euint128,
        await pool.confidentialTwabOf(bob.address),
        poolAddress,
        bob,
      );

      expect(aliceTwab).to.be.greaterThan(bobTwab);
    });
  });
});
