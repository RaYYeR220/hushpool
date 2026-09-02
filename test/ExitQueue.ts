import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import {
  ExitQueue,
  ExitQueue__factory,
  TestUnderlying,
  TestUnderlying__factory,
  TestWrappedToken,
  TestWrappedToken__factory,
} from "../types";

const TRANSFER_AND_CALL = "confidentialTransferAndCall(address,bytes32,bytes,bytes)";

const MIN_PARTICIPANTS = 3;
const MIN_BATCH_AGE = 600;
const WRAP_AMOUNT = 5_000_000;

describe("ExitQueue", function () {
  let underlying: TestUnderlying;
  let wrapper: TestWrappedToken;
  let wrapperAddress: string;
  let queue: ExitQueue;
  let queueAddress: string;
  let signers: HardhatEthersSigner[];

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    signers = await ethers.getSigners();

    underlying = await ((await ethers.getContractFactory("TestUnderlying")) as TestUnderlying__factory).deploy();
    wrapper = await ((await ethers.getContractFactory("TestWrappedToken")) as TestWrappedToken__factory).deploy(
      await underlying.getAddress(),
    );
    wrapperAddress = await wrapper.getAddress();

    queue = await ((await ethers.getContractFactory("ExitQueue")) as ExitQueue__factory).deploy(
      wrapperAddress,
      MIN_PARTICIPANTS,
      MIN_BATCH_AGE,
    );
    queueAddress = await queue.getAddress();
  });

  /// Give a signer confidential tokens by minting the public token and wrapping it.
  async function shield(signer: HardhatEthersSigner, amount = WRAP_AMOUNT) {
    await (await underlying.mint(signer.address, amount)).wait();
    await (await underlying.connect(signer).approve(wrapperAddress, amount)).wait();
    await (await wrapper.connect(signer).wrap(signer.address, amount)).wait();
  }

  async function requestExit(signer: HardhatEthersSigner, amount: number) {
    const enc = await fhevm.createEncryptedInput(wrapperAddress, signer.address).add64(amount).encrypt();
    const tx = await wrapper.connect(signer)[TRANSFER_AND_CALL](queueAddress, enc.handles[0], enc.inputProof, "0x");
    return tx.wait();
  }

  async function joinAll(count: number, amount: number): Promise<HardhatEthersSigner[]> {
    const players = signers.slice(1, 1 + count);
    for (const p of players) {
      await shield(p);
      await requestExit(p, amount);
    }
    return players;
  }

  /// settle -> decrypt the aggregate off-chain -> finalize, which is the whole point: the wrapper is
  /// called once, for the batch total.
  async function settleAndFinalize(batchId: number) {
    const receipt = await (await queue.settleBatch()).wait();
    const requestId = (await queue.batchInfo(batchId)).unwrapRequestId;

    const amountHandle = await wrapper.unwrapAmount(requestId);
    const decrypted = await fhevm.publicDecrypt([amountHandle]);
    const total = decrypted.clearValues[amountHandle as keyof typeof decrypted.clearValues] as bigint;

    await (await queue.finalizeBatch(batchId, total, decrypted.decryptionProof)).wait();
    return { receipt, total };
  }

  async function claimFor(signer: HardhatEthersSigner, batchId: number) {
    await (await queue.connect(signer).openClaim(batchId)).wait();
    const shareHandle = await queue.confidentialShareOf(batchId, signer.address);
    const decrypted = await fhevm.publicDecrypt([shareHandle]);
    const share = decrypted.clearValues[shareHandle as keyof typeof decrypted.clearValues] as bigint;
    await (await queue.connect(signer).claim(batchId, share, decrypted.decryptionProof)).wait();
    return share;
  }

  describe("joining", function () {
    it("accumulates encrypted shares and counts each participant once", async function () {
      const [, alice] = signers;
      await shield(alice);
      await requestExit(alice, 1_000_000);
      await requestExit(alice, 500_000);

      const batch = await queue.batchInfo(0);
      expect(batch.participants).to.eq(1);
      expect((await queue.batchParticipants(0)).length).to.eq(1);
    });

    it("refuses confidential tokens from anything other than the wrapper", async function () {
      const [, alice] = signers;
      const enc = await fhevm.createEncryptedInput(queueAddress, alice.address).add64(1).encrypt();
      await expect(
        queue.connect(alice).onConfidentialTransferReceived(alice.address, alice.address, enc.handles[0], "0x"),
      ).to.be.revertedWithCustomError(queue, "NotTheWrapper");
    });
  });

  describe("settlement conditions", function () {
    it("never settles a batch that would expose a lone exit", async function () {
      await joinAll(MIN_PARTICIPANTS - 1, 1_000_000);
      await time.increase(MIN_BATCH_AGE + 1);

      expect(await queue.settleable()).to.eq(false);
      await expect(queue.settleBatch())
        .to.be.revertedWithCustomError(queue, "BatchTooSmall")
        .withArgs(MIN_PARTICIPANTS - 1, MIN_PARTICIPANTS);
    });

    it("holds a full batch until it has aged, decoupling the exit in time", async function () {
      await joinAll(MIN_PARTICIPANTS, 1_000_000);

      expect(await queue.settleable()).to.eq(false);
      await expect(queue.settleBatch()).to.be.revertedWithCustomError(queue, "BatchTooYoung");

      await time.increase(MIN_BATCH_AGE + 1);
      expect(await queue.settleable()).to.eq(true);
    });
  });

  describe("aggregate unwrap", function () {
    it("calls the wrapper once, for the batch total, naming no participant", async function () {
      const players = await joinAll(3, 1_000_000);
      await time.increase(MIN_BATCH_AGE + 1);

      const { receipt, total } = await settleAndFinalize(0);

      expect(total).to.eq(3_000_000n);

      // The wrapper's own log is what an observer watches. It must mention the queue and the
      // aggregate, and never an individual participant.
      const wrapperLogs = receipt!.logs.filter((l) => l.address === wrapperAddress);
      const unwrapRequests = wrapperLogs
        .map((l) => wrapper.interface.parseLog(l))
        .filter((p) => p?.name === "UnwrapRequested");

      expect(unwrapRequests.length, "exactly one unwrap for the whole batch").to.eq(1);
      expect(unwrapRequests[0]!.args[0]).to.eq(queueAddress);
      for (const p of players) {
        expect(unwrapRequests[0]!.args[0]).to.not.eq(p.address);
      }
    });

    it("opens a fresh batch as soon as one settles", async function () {
      await joinAll(3, 1_000_000);
      await time.increase(MIN_BATCH_AGE + 1);
      await (await queue.settleBatch()).wait();

      expect(await queue.currentBatchId()).to.eq(1n);
      expect((await queue.batchInfo(1)).participants).to.eq(0);
    });
  });

  describe("claiming", function () {
    it("pays each participant their own share in the public token", async function () {
      const players = await joinAll(3, 1_000_000);
      await time.increase(MIN_BATCH_AGE + 1);
      await settleAndFinalize(0);

      for (const p of players) {
        const before = await underlying.balanceOf(p.address);
        const share = await claimFor(p, 0);
        const after = await underlying.balanceOf(p.address);

        expect(share).to.eq(1_000_000n);
        expect(after - before).to.eq(1_000_000n);
        expect(await queue.hasClaimed(0, p.address)).to.eq(true);
      }

      expect(await underlying.balanceOf(queueAddress)).to.eq(0n);
    });

    it("pays uneven shares correctly", async function () {
      const players = signers.slice(1, 4);
      const amounts = [500_000, 1_500_000, 3_000_000];
      for (let i = 0; i < players.length; i++) {
        await shield(players[i]);
        await requestExit(players[i], amounts[i]);
      }
      await time.increase(MIN_BATCH_AGE + 1);
      const { total } = await settleAndFinalize(0);
      expect(total).to.eq(5_000_000n);

      for (let i = 0; i < players.length; i++) {
        const before = await underlying.balanceOf(players[i].address);
        await claimFor(players[i], 0);
        expect((await underlying.balanceOf(players[i].address)) - before).to.eq(BigInt(amounts[i]));
      }
    });

    it("refuses a second claim on the same batch", async function () {
      const players = await joinAll(3, 1_000_000);
      await time.increase(MIN_BATCH_AGE + 1);
      await settleAndFinalize(0);
      await claimFor(players[0], 0);

      await expect(queue.connect(players[0]).openClaim(0)).to.be.revertedWithCustomError(queue, "AlreadyClaimed");
    });

    it("refuses a claim from someone who never joined the batch", async function () {
      await joinAll(3, 1_000_000);
      await time.increase(MIN_BATCH_AGE + 1);
      await settleAndFinalize(0);

      const outsider = signers[9];
      await expect(queue.connect(outsider).openClaim(0)).to.be.revertedWithCustomError(queue, "NothingToClaim");
    });

    it("refuses a claim before the batch is payable", async function () {
      const players = await joinAll(3, 1_000_000);
      await expect(queue.connect(players[0]).openClaim(0)).to.be.revertedWithCustomError(queue, "BatchNotPayable");
    });
  });
});
