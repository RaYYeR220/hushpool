import { ethers, fhevm, deployments } from "hardhat";

/**
 * Runs a draw to completion against a live pool and reports what each transaction cost.
 *
 * Usage: npx hardhat run scripts/draw.ts --network sepolia
 */

const BATCH = Number(process.env.BATCH ?? 16);

async function main() {
  await fhevm.initializeCLIApi();

  const [deployer] = await ethers.getSigners();
  const poolAddress = (await deployments.get("HushPool")).address;
  const pool = await ethers.getContractAt("HushPool", poolAddress, deployer);

  const participants = await pool.participantCount();
  const pot = await pool.prizePot();
  console.log(`pool ${poolAddress}`);
  console.log(`participants ${participants}, pot ${Number(pot) / 1e6} tUSDT\n`);

  if (await pool.drawInProgress()) {
    console.log("a draw is already scanning, continuing it");
  } else {
    const receipt = await (await pool.startDraw()).wait();
    console.log(`startDraw          ${receipt!.gasUsed} gas   ${receipt!.hash}`);
  }

  const drawId = await pool.currentDrawId();
  let calls = 0;

  // Load-balanced public RPCs happily serve a read from a node that has not seen the block the
  // previous transaction landed in, so poll until the state actually moves rather than trusting the
  // first answer.
  async function scannedAtLeast(target: number): Promise<number> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const scanned = Number((await pool.drawInfo(drawId)).scanned);
      if (scanned >= target) return scanned;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`draw ${drawId} did not reach ${target} scanned participants`);
  }

  const total = Number((await pool.drawInfo(drawId)).participantCount);
  let done = await scannedAtLeast(0);

  while (done < total) {
    const before = done;
    const receipt = await (await pool.advanceDraw(BATCH)).wait();
    done = await scannedAtLeast(before + 1);
    const scanned = done - before;

    calls += 1;
    console.log(
      `advanceDraw(${BATCH})   ${receipt!.gasUsed} gas   ${scanned} scanned   ` +
        `${Math.round(Number(receipt!.gasUsed) / Math.max(scanned, 1))} gas/participant   ${receipt!.hash}`,
    );
  }

  const info = await pool.drawInfo(drawId);
  console.log(`\ndraw ${drawId} settled over ${calls} call(s), ${info.scanned} participants scanned`);
  console.log("no winner was revealed; each participant learns the outcome by decrypting their own balance");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
