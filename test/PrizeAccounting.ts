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

/**
 * A draw must always credit someone.
 *
 * The target is drawn uniformly from the pool's running total of time-weighted balances, and the
 * scan credits whoever's slice contains it. If that running total ever exceeds the sum of the
 * slices actually walked, the target can land past the last participant and the prize is credited
 * to nobody — it stays in the contract, owned by no one, unwithdrawable. Last season's winners in
 * this programme were criticised for exactly that class of bug, so it is worth a test of its own.
 *
 * The gap opens when the pool's own total is credited a prize that then gets integrated over a
 * window predating it. This suite forces that window to be long and the prize large relative to
 * deposits, which is the worst case rather than a typical one.
 */
describe("prize accounting", function () {
  let underlying: TestUnderlying;
  let token: TestWrappedToken;
  let tokenAddress: string;
  let pool: HushPool;
  let poolAddress: string;
  let signers: HardhatEthersSigner[];

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    signers = await ethers.getSigners();

    underlying = await ((await ethers.getContractFactory("TestUnderlying")) as TestUnderlying__factory).deploy();
    token = await ((await ethers.getContractFactory("TestWrappedToken")) as TestWrappedToken__factory).deploy(
      await underlying.getAddress(),
    );
    tokenAddress = await token.getAddress();

    pool = await ((await ethers.getContractFactory("HushPool")) as HushPool__factory).deploy(tokenAddress, 3, 16);
    poolAddress = await pool.getAddress();
  });

  async function fund(signer: HardhatEthersSigner, amount: number) {
    await (await underlying.mint(signer.address, amount)).wait();
    await (await underlying.connect(signer).approve(tokenAddress, amount)).wait();
    await (await token.connect(signer).wrap(signer.address, amount)).wait();
  }

  async function deposit(signer: HardhatEthersSigner, amount: number) {
    const enc = await fhevm.createEncryptedInput(tokenAddress, signer.address).add64(amount).encrypt();
    await (await token.connect(signer)[TRANSFER_AND_CALL](poolAddress, enc.handles[0], enc.inputProof, "0x")).wait();
  }

  async function sponsor(amount: number) {
    const s = signers[0];
    await (await underlying.mint(s.address, amount)).wait();
    await (await underlying.connect(s).approve(poolAddress, amount)).wait();
    await (await pool.connect(s).sponsorPrize(amount)).wait();
  }

  async function balanceOf(signer: HardhatEthersSigner): Promise<bigint> {
    const handle = await pool.confidentialBalanceOf(signer.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, signer);
  }

  async function balances(players: HardhatEthersSigner[]): Promise<bigint[]> {
    const out: bigint[] = [];
    for (const p of players) out.push(await balanceOf(p));
    return out;
  }

  async function runDraw() {
    await (await pool.startDraw()).wait();
    while (await pool.drawInProgress()) await (await pool.advanceDraw(16)).wait();
  }

  it("always credits exactly one participant, draw after draw", async function () {
    const players = signers.slice(1, 6);
    for (const p of players) {
      await fund(p, 1_000_000);
      await deposit(p, 1_000_000);
    }

    // A long quiet stretch before each draw is the worst case: it is the window over which a
    // mis-timed prize would be integrated.
    for (let round = 1; round <= 4; round++) {
      const prize = 400_000;
      await sponsor(prize);
      await time.increase(400_000);

      const before = await balances(players);
      await runDraw();
      const after = await balances(players);

      const deltas = after.map((v, i) => v - before[i]);
      const credited = deltas.filter((d) => d !== 0n);

      expect(credited.length, `round ${round}: exactly one participant credited`).to.eq(1);
      expect(credited[0], `round ${round}: the whole prize`).to.eq(BigInt(prize));
    }
  });

  it("never holds a prize that belongs to nobody", async function () {
    const players = signers.slice(1, 5);
    for (const p of players) {
      await fund(p, 500_000);
      await deposit(p, 500_000);
    }

    let expected = 4n * 500_000n;
    for (let round = 1; round <= 12; round++) {
      const prize = 2_000_000; // deliberately as large as the whole pool
      await sponsor(prize);
      await time.increase(900_000);
      await runDraw();
      expected += BigInt(prize);

      const held = (await balances(players)).reduce((a, b) => a + b, 0n);
      expect(held, `round ${round}: every unit in the pool is owned by someone`).to.eq(expected);
    }
  });
});
