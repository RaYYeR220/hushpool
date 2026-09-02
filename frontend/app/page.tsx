"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

import {
  DECIMALS,
  fromUnits,
  toUnits,
  useDrawActions,
  useExitQueue,
  useMyBalance,
  usePoolActions,
  usePoolStats,
} from "~/hooks/useHushpool";
import { sepolia } from "~/lib/contracts";

const DRAW_STATE = ["none", "scanning", "settled"] as const;

function Connect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <button onClick={() => disconnect()}>
        {address?.slice(0, 6)}…{address?.slice(-4)} · disconnect
      </button>
    );
  }
  return (
    <button onClick={() => connect({ connector: connectors[0]! })} disabled={isPending || !connectors[0]}>
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

export default function Home() {
  const stats = usePoolStats();
  const balance = useMyBalance();
  const actions = usePoolActions();
  const draw = useDrawActions();
  const exit = useExitQueue();

  const [amount, setAmount] = useState("25");

  const units = (() => {
    try {
      return toUnits(amount);
    } catch {
      return 0n;
    }
  })();

  return (
    <main className="wrap">
      <header>
        <h1>Hushpool</h1>
        <p>Nobody knows who won.</p>
        <Connect />
      </header>

      <section>
        <h2>Pool</h2>
        <dl>
          <dt>Prize pot</dt>
          <dd>{fromUnits(stats.pot)} tUSDT</dd>
          <dt>Depositors</dt>
          <dd>{stats.participants?.toString() ?? "—"}</dd>
          <dt>Total value locked</dt>
          <dd>encrypted</dd>
          <dt>Draw</dt>
          <dd>
            #{stats.drawId?.toString() ?? "—"} {stats.draw ? DRAW_STATE[stats.draw.state] : ""}
            {stats.draw && stats.draw.state === 1
              ? ` — ${stats.draw.scanned}/${stats.draw.participantCount} scanned`
              : ""}
          </dd>
        </dl>
      </section>

      <section>
        <h2>Your position</h2>
        {!balance.isConnected ? (
          <p>Connect a wallet to see it.</p>
        ) : balance.revealed ? (
          <>
            <p className="figure">{fromUnits(balance.value)} tUSDT</p>
            <button onClick={balance.hide}>Hide</button>
          </>
        ) : (
          <>
            <p className="figure masked">{balance.handle?.slice(2, 26) ?? "—"}</p>
            <button onClick={balance.reveal} disabled={balance.working || balance.isEmpty}>
              {balance.working ? "Decrypting…" : "Decrypt"}
            </button>
            {balance.isEmpty ? <p>No deposit yet.</p> : null}
          </>
        )}
        {balance.error ? <p className="error">{balance.error}</p> : null}
      </section>

      <section>
        <h2>Deposit and withdraw</h2>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        <div>
          <button onClick={() => actions.faucet(units)} disabled={actions.busy}>
            Get test USDT
          </button>
          <button onClick={() => actions.deposit(units)} disabled={actions.busy}>
            Deposit
          </button>
          <button onClick={() => actions.withdraw(units)} disabled={actions.busy}>
            Withdraw
          </button>
          <button onClick={() => actions.sponsor(units)} disabled={actions.busy}>
            Add to prize
          </button>
        </div>
        {actions.status ? <p className="status">{actions.status}</p> : null}
      </section>

      <section>
        <h2>The draw</h2>
        <p>
          Anyone can run it. The winner is credited during the scan and never announced — every
          participant is written to identically.
        </p>
        <button onClick={draw.startDraw} disabled={draw.busy || stats.scanning}>
          Start draw
        </button>
        <button onClick={() => draw.advanceDraw(stats.maxScanBatch ?? 8)} disabled={draw.busy || !stats.scanning}>
          Advance scan
        </button>
      </section>

      <section>
        <h2>Exit queue</h2>
        <p>
          Batch #{exit.batchId?.toString() ?? "—"}: {exit.batch?.participants ?? 0} of{" "}
          {exit.minParticipants ?? "—"} needed, settles after {exit.minBatchAge?.toString() ?? "—"}s.
        </p>
        <p>{exit.settleable ? "Ready to settle." : "Holding — a lone exit is never settled alone."}</p>
      </section>

      <footer>
        <a href={`https://sepolia.etherscan.io/address/${sepolia.pool}`}>Pool</a>{" "}
        <a href={`https://sepolia.etherscan.io/address/${sepolia.exitQueue}`}>Exit queue</a> · {DECIMALS} decimals ·
        Sepolia
      </footer>
    </main>
  );
}
