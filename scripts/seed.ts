import { ethers, fhevm, deployments } from "hardhat";

/**
 * Prepares a live pool so a reviewer can open it and immediately do something meaningful: funds a
 * handful of demo participants, deposits for each, and tops up the prize pot.
 *
 * Usage: npx hardhat run scripts/seed.ts --network sepolia
 */

const DEMO_ACCOUNTS = Number(process.env.DEMO_ACCOUNTS ?? 5);
const DEPOSIT = Number(process.env.DEPOSIT ?? 25_000_000); // 25 tUSDT at six decimals
const PRIZE = Number(process.env.PRIZE ?? 5_000_000); // 5 tUSDT
const GAS_PER_ACCOUNT = ethers.parseEther(process.env.GAS_PER_ACCOUNT ?? "0.02");

const TRANSFER_AND_CALL = "confidentialTransferAndCall(address,bytes32,bytes,bytes)";

const ERC20_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address) external view returns (uint256)",
];

const WRAPPER_ABI = [
  "function wrap(address to, uint256 amount) external returns (bytes32)",
  "function underlying() external view returns (address)",
  `function ${TRANSFER_AND_CALL} external returns (bytes32)`,
];

/// Deterministic demo signers, so a rerun tops up the same accounts instead of stranding funds.
function demoWallets(count: number) {
  const base = process.env.DEMO_MNEMONIC ?? "hushpool demo participants seed phrase for public testnet only";
  return Array.from(
    { length: count },
    (_, i) => new ethers.Wallet(ethers.id(`${base}/${i}`).slice(0, 66), ethers.provider),
  );
}

async function main() {
  await fhevm.initializeCLIApi();

  const [deployer] = await ethers.getSigners();
  const poolAddress = (await deployments.get("HushPool")).address;
  const pool = await ethers.getContractAt("HushPool", poolAddress, deployer);
  const assetAddress = await pool.asset();
  const underlyingAddress = await pool.underlying();

  const asset = new ethers.Contract(assetAddress, WRAPPER_ABI, deployer);
  const underlying = new ethers.Contract(underlyingAddress, ERC20_ABI, deployer);

  console.log(`pool        ${poolAddress}`);
  console.log(`asset       ${assetAddress}`);
  console.log(`underlying  ${underlyingAddress}\n`);

  const wallets = demoWallets(DEMO_ACCOUNTS);

  for (const [i, wallet] of wallets.entries()) {
    const label = `demo ${i} ${wallet.address}`;

    const balance = await ethers.provider.getBalance(wallet.address);
    if (balance < GAS_PER_ACCOUNT / 2n) {
      await (await deployer.sendTransaction({ to: wallet.address, value: GAS_PER_ACCOUNT })).wait();
      console.log(`${label}: funded gas`);
    }

    await (await underlying.connect(wallet).mint(wallet.address, DEPOSIT)).wait();

    // The USDT mock inherits the real USDT quirk: a non-zero allowance must be cleared first.
    const current = await underlying.allowance(wallet.address, assetAddress);
    if (current > 0n) await (await underlying.connect(wallet).approve(assetAddress, 0)).wait();
    await (await underlying.connect(wallet).approve(assetAddress, DEPOSIT)).wait();
    await (await asset.connect(wallet).wrap(wallet.address, DEPOSIT)).wait();

    const enc = await fhevm.createEncryptedInput(assetAddress, wallet.address).add64(DEPOSIT).encrypt();
    await (await asset.connect(wallet)[TRANSFER_AND_CALL](poolAddress, enc.handles[0], enc.inputProof, "0x")).wait();

    console.log(`${label}: deposited ${DEPOSIT / 1e6} tUSDT`);
  }

  await (await underlying.mint(deployer.address, PRIZE)).wait();
  if ((await underlying.allowance(deployer.address, poolAddress)) > 0n) {
    await (await underlying.approve(poolAddress, 0)).wait();
  }
  await (await underlying.approve(poolAddress, PRIZE)).wait();
  await (await pool.sponsorPrize(PRIZE)).wait();

  console.log(`\nparticipants ${await pool.participantCount()}`);
  console.log(`prize pot    ${Number(await pool.prizePot()) / 1e6} tUSDT`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
