import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Confidential USDT on Sepolia, published by Zama. It is an ERC-7984 wrapper over a public USDT
 * mock whose `mint` is open to anyone, which is how a reviewer obtains test funds.
 * https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia
 */
const SEPOLIA_CONFIDENTIAL_USDT = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";

/// A draw is refused below this many participants, so no draw ever has a guessable winner.
const MIN_PARTICIPANTS = 3;

/**
 * Participants scanned per `advanceDraw` call.
 *
 * The prefix sum is a sequential dependency chain, so it meets FHEVM's 5M HCU chain limit long
 * before the 20M per-transaction limit matters. The limit is invisible locally -- the Hardhat mock
 * does not meter HCU at all -- so it was measured against the live network instead: 11 participants
 * succeed and 12 revert. Shipping 8 leaves headroom for protocol cost changes.
 */
const MAX_SCAN_BATCH = 8;

/// Exit batches settle five minutes after opening. A production deployment would use days: Zama's
/// own Confidential Vault uses seven, precisely so that a lone withdrawal is never settled alone.
const EXIT_MIN_BATCH_AGE = 300;

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deployer } = await getNamedAccounts();

  let asset: string;

  if (network.name === "sepolia") {
    asset = SEPOLIA_CONFIDENTIAL_USDT;
  } else {
    const underlying = await deployments.deploy("TestUnderlying", { from: deployer, log: true });
    const wrapped = await deployments.deploy("TestWrappedToken", {
      from: deployer,
      args: [underlying.address],
      log: true,
    });
    asset = wrapped.address;
  }

  const pool = await deployments.deploy("HushPool", {
    from: deployer,
    args: [asset, MIN_PARTICIPANTS, MAX_SCAN_BATCH],
    log: true,
  });

  const queue = await deployments.deploy("ExitQueue", {
    from: deployer,
    args: [asset, MIN_PARTICIPANTS, EXIT_MIN_BATCH_AGE],
    log: true,
  });

  console.log(`\nasset      ${asset}`);
  console.log(`HushPool   ${pool.address}`);
  console.log(`ExitQueue  ${queue.address}`);
};

deploy.tags = ["HushPool"];
export default deploy;
