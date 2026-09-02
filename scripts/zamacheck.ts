import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

/** Decrypts a balance on Zama's own Confidential USDT, to separate our contracts from the protocol. */
const CUSDT = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";

async function main() {
  await fhevm.initializeCLIApi();
  const [signer] = await ethers.getSigners();
  const token = await ethers.getContractAt(
    ["function confidentialBalanceOf(address) view returns (bytes32)"],
    CUSDT,
    signer,
  );
  const handle = await token.confidentialBalanceOf(signer.address);
  console.log("cUSDT handle for", signer.address, "=", handle);
  if (handle === ethers.ZeroHash) {
    console.log("uninitialised handle, nothing to decrypt");
    return;
  }
  const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, CUSDT, signer);
  console.log("cUSDT clear:", clear.toString());
}
main().catch((e) => console.error("FAILED:", String(e).slice(0, 200)));
