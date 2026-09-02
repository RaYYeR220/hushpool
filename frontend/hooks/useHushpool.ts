"use client";

import { useDecryptValues, useEncrypt, useGrantPermit, useHasPermit } from "@zama-fhe/react-sdk";
import { useCallback, useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";

import { erc20Abi, exitQueueAbi, poolAbi, sepolia, wrapperAbi } from "~/lib/contracts";

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

  const { mutate: grantPermit, isPending: authorising } = useGrantPermit();
  const { data: permitted } = useHasPermit({ contractAddresses: [sepolia.pool] });
  const decrypt = useDecryptValues(inputs, { enabled: revealRequested && Boolean(permitted) && !isEmpty });

  const value = isEmpty ? 0n : ((handle && decrypt.data?.[handle]) as bigint | undefined);

  const reveal = useCallback(() => {
    setRevealRequested(true);
    if (!permitted) grantPermit([sepolia.pool]);
  }, [permitted, grantPermit]);

  const hide = useCallback(() => setRevealRequested(false), []);

  return {
    isConnected,
    handle,
    isEmpty,
    value,
    revealed: value !== undefined && revealRequested,
    working: authorising || decrypt.isFetching,
    error: decrypt.error?.message,
    reveal,
    hide,
    refetch: handleQuery.refetch,
  };
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

  /** Mint the public test token. The mock's mint is open to anyone and repeatable. */
  const faucet = useCallback(
    (amount: bigint) =>
      run("Minting test USDT", "Minted", async () => {
        if (!address) throw new Error("connect a wallet first");
        await writeContractAsync({
          address: sepolia.underlying,
          abi: erc20Abi,
          functionName: "mint",
          args: [address, amount],
        });
      }),
    [address, run, writeContractAsync],
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

        // The USDT mock keeps the original's quirk: a non-zero allowance must be cleared first.
        await writeContractAsync({
          address: sepolia.underlying,
          abi: erc20Abi,
          functionName: "approve",
          args: [sepolia.asset, 0n],
        });
        await writeContractAsync({
          address: sepolia.underlying,
          abi: erc20Abi,
          functionName: "approve",
          args: [sepolia.asset, amount],
        });
        await writeContractAsync({
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

        await writeContractAsync({
          address: sepolia.asset,
          abi: wrapperAbi,
          functionName: "confidentialTransferAndCall",
          args: [sepolia.pool, enc.encryptedValues[0]!, enc.inputProof, "0x"],
          gas: FHE_GAS,
        });
      }),
    [address, encrypt, run, writeContractAsync],
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
        await writeContractAsync({
          address: sepolia.pool,
          abi: poolAbi,
          functionName: "withdraw",
          args: [enc.encryptedValues[0]!, enc.inputProof],
          gas: FHE_GAS,
        });
      }),
    [address, encrypt, run, writeContractAsync],
  );

  const sponsor = useCallback(
    (amount: bigint) =>
      run("Adding to the prize", "Prize topped up", async () => {
        await writeContractAsync({
          address: sepolia.underlying,
          abi: erc20Abi,
          functionName: "approve",
          args: [sepolia.pool, 0n],
        });
        await writeContractAsync({
          address: sepolia.underlying,
          abi: erc20Abi,
          functionName: "approve",
          args: [sepolia.pool, amount],
        });
        await writeContractAsync({
          address: sepolia.pool,
          abi: poolAbi,
          functionName: "sponsorPrize",
          args: [amount],
          gas: FHE_GAS,
        });
      }),
    [run, writeContractAsync],
  );

  return { faucet, deposit, withdraw, sponsor, busy, status, lastDone };
}

/** Both draw entry points are permissionless, so the UI exposes them to anyone. */
export function useDrawActions() {
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  const startDraw = useCallback(async () => {
    setBusy(true);
    try {
      await writeContractAsync({ address: sepolia.pool, abi: poolAbi, functionName: "startDraw", gas: FHE_GAS });
    } finally {
      setBusy(false);
    }
  }, [writeContractAsync]);

  const advanceDraw = useCallback(
    async (batchSize: number) => {
      setBusy(true);
      try {
        await writeContractAsync({
          address: sepolia.pool,
          abi: poolAbi,
          functionName: "advanceDraw",
          args: [batchSize],
          gas: FHE_GAS,
        });
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
