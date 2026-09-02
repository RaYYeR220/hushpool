import { ethers, fhevm, deployments } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

/** Decrypts the caller's own pool balance on a live network, as a user would. */
async function main() {
  await fhevm.initializeCLIApi();
  const [signer] = await ethers.getSigners();
  const poolAddress = (await deployments.get("HushPool")).address;
  const pool = await ethers.getContractAt("HushPool", poolAddress, signer);

  const handle = await pool.confidentialBalanceOf(signer.address);
  console.log("account", signer.address);
  console.log("handle ", handle);
  if (handle === ethers.ZeroHash) {
    console.log("no deposit for this account");
    return;
  }
  const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, signer);
  console.log("clear  ", clear.toString());
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exitCode = 1;
});
