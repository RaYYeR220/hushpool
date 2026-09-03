"use client";

import { useDecryptValues, useEncrypt, useGrantPermit, useHasPermit } from "@zama-fhe/react-sdk";
import { useCallback, useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { readContract, waitForTransactionReceipt } from "wagmi/actions";

import { erc20Abi, exitQueueAbi, poolAbi, sepolia, wrapperAbi } from "~/lib/contracts";
import { wagmiConfig } from "~/lib/wagmi";

const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

/// FHE transactions are heavy and estimation is unreliable against a relayer, so calls that touch
/// ciphertext carry an explicit cap below Sepolia's block gas limit.
const FHE_GAS = 15_000_000n;

export const DECIMALS = 6;

export function toUnits(amount: string): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  return BigInt(whole || "0") * 10n ** BigInt(DECIMALS) + BigInt((frac + "000000").slice(0, DECIMALS));
}

export function fromUnits(value: bigint | undefined): string {
  if (value === undefined) return "—";
  const whole = value / 10n ** BigInt(DECIMALS);
  const frac = (value % 10n ** BigInt(DECIMALS)).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Public state of the pool. None of this is secret, and the prize pot is public on purpose. */
export function usePoolStats() {
  const participants = useReadContract({ address: sepolia.pool, abi: poolAbi, functionName: "participantCount" });
  const pot = useReadContract({ address: sepolia.pool, abi: poolAbi, functionName: "prizePot" });
  const drawId = useReadContract({ address: sepolia.pool, abi: poolAbi, functionName: "currentDrawId" });
  const scanning = useReadContract({ address: sepolia.pool, abi: poolAbi, functionName: "drawInProgress" });
  const minParticipants = useReadContract({ address: sepolia.pool, abi: poolAbi, functionName: "minParticipants" });
  const maxScanBatch = useReadContract({ address: sepolia.pool, abi: poolAbi, functionName: "maxScanBatch" });

  const draw = useReadContract({
    address: sepolia.pool,
    abi: poolAbi,
    functionName: "drawInfo",
    args: drawId.data !== undefined ? [drawId.data] : undefined,
    query: { enabled: drawId.data !== undefined },
  });

  const refetch = useCallback(() => {
    participants.refetch();
    pot.refetch();
    drawId.refetch();
    scanning.refetch();
    draw.refetch();
  }, [participants, pot, drawId, scanning, draw]);

  return {
    participants: participants.data as bigint | undefined,
    pot: pot.data as bigint | undefined,
    drawId: drawId.data as bigint | undefined,
    scanning: scanning.data as boolean | undefined,
    minParticipants: minParticipants.data as number | undefined,
    maxScanBatch: maxScanBatch.data as number | undefined,
    draw: draw.data as
      | { at: bigint; prize: bigint; participantCount: number; scanned: number; state: number }
      | undefined,
    refetch,
  };
}

/**
 * The encrypted balance, and the action that reveals it to its owner alone.
 *
 * Reading it takes an FHE keypair and an EIP-712 signature, both cached in IndexedDB, so a reviewer
 * signs once rather than on every reveal.
 */
export function useMyBalance() {
  const { address, isConnected } = useAccount();
  const [revealRequested, setRevealRequested] = useState(false);

  const handleQuery = useReadContract({
    address: sepolia.pool,
    abi: poolAbi,
    functionName: "confidentialBalanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const handle = handleQuery.data as `0x${string}` | undefined;
  const isEmpty = !handle || handle === ZERO_HANDLE;

  const inputs = useMemo(
    () => (isEmpty ? [] : [{ encryptedValue: handle as `0x${string}`, contractAddress: sepolia.pool }]),
    [handle, isEmpty],
  );

  const { mutateAsync: grantPermit, isPending: authorising } = useGrantPermit();
  const { data: permitted, refetch: refetchPermit } = useHasPermit({ contractAddresses: [sepolia.pool] });

  // Granting a permit does not invalidate the query that reports whether one exists, so waiting on
  // `permitted` to flip leaves the decryption disabled forever. Drive it from the grant instead.
  const [authorised, setAuthorised] = useState(false);
  const [failure, setFailure] = useState<string>();

  /**
   * Reading a balance goes through the protocol's threshold key service, which reconstructs the
   * plaintext from shares held by separate signers. That reconstruction fails intermittently
   * upstream — measured at roughly one attempt in three succeeding during a bad spell, identically
   * across two SDK versions and outside the browser, so it is not something this app can fix. It is
   * also transient, and a handful of attempts turns a coin flip into a near certainty.
   */
  const decrypt = useDecryptValues(inputs, {
    enabled: revealRequested && authorised && !isEmpty,
    retry: 7,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 12000),
  });

  const value = isEmpty ? 0n : ((handle && decrypt.data?.[handle]) as bigint | undefined);

  const reveal = useCallback(async () => {
    setFailure(undefined);
    setRevealRequested(true);
    try {
      if (!permitted && !authorised) {
        await grantPermit([sepolia.pool]);
        await refetchPermit();
      }
      setAuthorised(true);
    } catch (error) {
      setRevealRequested(false);
      setFailure(error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error));
    }
  }, [permitted, authorised, grantPermit, refetchPermit]);

  const hide = useCallback(() => setRevealRequested(false), []);

  const raw = failure ?? decrypt.error?.message;

  return {
    isConnected,
    handle,
    isEmpty,
    value,
    revealed: value !== undefined && revealRequested,
    working: authorising || decrypt.isFetching,
    error: raw ? describeDecryptFailure(raw) : undefined,
    reveal,
    hide,
    refetch: handleQuery.refetch,
  };
}

/**
 * Reading an encrypted balance needs the protocol's threshold key-management service to return
 * enough valid shares. When it cannot, the failure is upstream and no amount of retrying by the
 * user will help, so say that rather than implying the pool is broken.
 */
function describeDecryptFailure(message: string): string {
  if (/failed to decrypt|reconstruct|decoding failure|kms/i.test(message)) {
    return "The network's key service did not return a usable result after several attempts. Your balance is safe and unchanged — reconstruction happens off-chain and is retried automatically, so this usually clears on its own.";
  }
  if (/rejected|denied|user refused/i.test(message)) return "Signature rejected.";
  return message;
}

/** The public token balance in the connected wallet, which is what a deposit is drawn from. */
export function useWalletBalance() {
  const { address } = useAccount();
  const query = useReadContract({
    address: sepolia.underlying,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  return { value: query.data as bigint | undefined, refetch: query.refetch };
}

/** Deposit, withdraw, and the faucet path a reviewer needs before either. */
export function usePoolActions() {
  const { address } = useAccount();
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<string>();
  const [lastDone, setLastDone] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (label: string, done: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setLastDone(undefined);
    setStatus(label);
    try {
      await fn();
      setStatus(undefined);
      setLastDone(done);
    } catch (error) {
      // Wallet errors arrive as long multi-line dumps; the first line is the part worth showing.
      setStatus(error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Send a transaction and wait for it to be mined.
   *
   * `writeContractAsync` resolves once a transaction is *sent*, not once it lands. Firing a
   * dependent call straight after means the wallet estimates it against pre-transaction state, and
   * anything that depends on the first one reverts before it is even submitted.
   */
  const send = useCallback(
    async (request: Parameters<typeof writeContractAsync>[0]) => {
      const hash = await writeContractAsync(request);
      await waitForTransactionReceipt(wagmiConfig, { hash });
      return hash;
    },
    [writeContractAsync],
  );

  /**
   * Set an ERC-20 allowance, resetting it first only when it has to be.
   *
   * The USDT mock keeps the original's quirk: raising a non-zero allowance reverts. Reading the
   * current value first avoids a pointless transaction in the common case.
   */
  const approve = useCallback(
    async (spender: `0x${string}`, amount: bigint) => {
      if (!address) throw new Error("connect a wallet first");
      const current = (await readContract(wagmiConfig, {
        address: sepolia.underlying,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spender],
      })) as bigint;

      if (current >= amount) return;
      if (current > 0n) {
        await send({ address: sepolia.underlying, abi: erc20Abi, functionName: "approve", args: [spender, 0n] });
      }
      await send({ address: sepolia.underlying, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    },
    [address, send],
  );

  /** Mint the public test token. The mock's mint is open to anyone and repeatable. */
  const faucet = useCallback(
    (amount: bigint) =>
      run("Minting test USDT", "Minted", async () => {
        if (!address) throw new Error("connect a wallet first");
        await send({
          address: sepolia.underlying,
          abi: erc20Abi,
          functionName: "mint",
          args: [address, amount],
        });
      }),
    [address, run, send],
  );

  /**
   * Shield public tokens, then deposit them.
   *
   * The deposit call is made on the token, not the pool: `confidentialTransferAndCall` delivers the
   * funds and notifies the pool in one transaction, so the pool never needs a standing operator
   * grant over the depositor's balance.
   */
  const deposit = useCallback(
    (amount: bigint) =>
      run("Depositing", "Deposited", async () => {
        if (!address) throw new Error("connect a wallet first");

        await approve(sepolia.asset, amount);
        await send({
          address: sepolia.asset,
          abi: wrapperAbi,
          functionName: "wrap",
          args: [address, amount],
        });

        const enc = await encrypt.mutateAsync({
          values: [{ value: amount, type: "euint64" }],
          contractAddress: sepolia.asset,
          userAddress: address,
        });

        await send({
          address: sepolia.asset,
          abi: wrapperAbi,
          functionName: "confidentialTransferAndCall",
          args: [sepolia.pool, enc.encryptedValues[0]!, enc.inputProof, "0x"],
          gas: FHE_GAS,
        });
      }),
    [address, approve, encrypt, run, send],
  );

  const withdraw = useCallback(
    (amount: bigint) =>
      run("Withdrawing", "Withdrawn", async () => {
        if (!address) throw new Error("connect a wallet first");
        const enc = await encrypt.mutateAsync({
          values: [{ value: amount, type: "euint64" }],
          contractAddress: sepolia.pool,
          userAddress: address,
        });
        await send({
          address: sepolia.pool,
          abi: poolAbi,
          functionName: "withdraw",
          args: [enc.encryptedValues[0]!, enc.inputProof],
          gas: FHE_GAS,
        });
      }),
    [address, encrypt, run, send],
  );

  const sponsor = useCallback(
    (amount: bigint) =>
      run("Adding to the prize", "Prize topped up", async () => {
        await approve(sepolia.pool, amount);
        await send({
          address: sepolia.pool,
          abi: poolAbi,
          functionName: "sponsorPrize",
          args: [amount],
          gas: FHE_GAS,
        });
      }),
    [approve, run, send],
  );

  return { faucet, deposit, withdraw, sponsor, busy, status, lastDone };
}

/** Both draw entry points are permissionless, so the UI exposes them to anyone. */
export function useDrawActions() {
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  // Advancing a scan depends on the draw it advances having landed, so both wait for a receipt
  // rather than resolving the moment the transaction is sent.
  const startDraw = useCallback(async () => {
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: sepolia.pool,
        abi: poolAbi,
        functionName: "startDraw",
        gas: FHE_GAS,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
    } finally {
      setBusy(false);
    }
  }, [writeContractAsync]);

  const advanceDraw = useCallback(
    async (batchSize: number) => {
      setBusy(true);
      try {
        const hash = await writeContractAsync({
          address: sepolia.pool,
          abi: poolAbi,
          functionName: "advanceDraw",
          args: [batchSize],
          gas: FHE_GAS,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash });
      } finally {
        setBusy(false);
      }
    },
    [writeContractAsync],
  );

  return { startDraw, advanceDraw, busy };
}

/** The batched exit: a request joins a batch, and the batch settles only when it is safe to. */
export function useExitQueue() {
  const batchId = useReadContract({
    address: sepolia.exitQueue,
    abi: exitQueueAbi,
    functionName: "currentBatchId",
  });

  const batch = useReadContract({
    address: sepolia.exitQueue,
    abi: exitQueueAbi,
    functionName: "batchInfo",
    args: batchId.data !== undefined ? [batchId.data] : undefined,
    query: { enabled: batchId.data !== undefined },
  });

  const settleable = useReadContract({
    address: sepolia.exitQueue,
    abi: exitQueueAbi,
    functionName: "settleable",
  });

  const minParticipants = useReadContract({
    address: sepolia.exitQueue,
    abi: exitQueueAbi,
    functionName: "minParticipants",
  });

  const minBatchAge = useReadContract({
    address: sepolia.exitQueue,
    abi: exitQueueAbi,
    functionName: "minBatchAge",
  });

  return {
    batchId: batchId.data as bigint | undefined,
    batch: batch.data as
      | { openedAt: bigint; participants: number; state: number; unwrapRequestId: `0x${string}`; total: bigint }
      | undefined,
    settleable: settleable.data as boolean | undefined,
    minParticipants: minParticipants.data as number | undefined,
    minBatchAge: minBatchAge.data as bigint | undefined,
    refetch: () => {
      batchId.refetch();
      batch.refetch();
      settleable.refetch();
    },
  };
}
