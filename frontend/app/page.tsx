"use client";

import { useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

import {
  fromUnits,
  toUnits,
  useDrawActions,
  useExitQueue,
  useMyBalance,
  usePoolActions,
  usePoolStats,
  useWalletBalance,
} from "~/hooks/useHushpool";
import { sepolia } from "~/lib/contracts";

const SCAN = "https://sepolia.etherscan.io";
const QUICK = ["10", "25", "100", "500"];

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

function Connect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <button className="btn raised-sm mono" onClick={() => disconnect()}>
        {short(address)}
      </button>
    );
  }
  return (
    <button
      className="btn raised-sm primary"
      onClick={() => connect({ connector: connectors[0]! })}
      disabled={isPending || !connectors[0]}
    >
      {isPending ? "Connecting…" : connectors[0] ? "Connect wallet" : "No wallet found"}
    </button>
  );
}

/** A status line that sits above the controls rather than replacing them. */
function Notice({ tone, title, detail }: { tone: "ok" | "busy" | "bad"; title: string; detail?: string }) {
  return (
    <div className={`notice pressed-sm ${tone}`}>
      <span className="dot" />
      <span className="body">
        <strong>{title}</strong>
        {detail ? <p>{detail}</p> : null}
      </span>
    </div>
  );
}

export default function Home() {
  const stats = usePoolStats();
  const balance = useMyBalance();
  const actions = usePoolActions();
  const draw = useDrawActions();
  const exit = useExitQueue();
  const wallet = useWalletBalance();

  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("25");

  const units = useMemo(() => {
    try {
      return toUnits(amount);
    } catch {
      return 0n;
    }
  }, [amount]);

  const scanned = stats.draw ? Number(stats.draw.scanned) : 0;
  const scanTotal = stats.draw ? Number(stats.draw.participantCount) : 0;
  const batchSize = stats.maxScanBatch ?? 8;
  const settled = Boolean(stats.draw && stats.draw.state === 2);

  const exitHave = exit.batch?.participants ?? 0;
  const exitNeed = exit.minParticipants ?? 0;
  const exitPct = exitNeed > 0 ? Math.min(100, (exitHave / exitNeed) * 100) : 0;

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1 className="mark">Hushpool</h1>
          <p className="tagline">Nobody knows who won.</p>
        </div>
        <span className="spacer" />
        <span className="pill pressed-sm">
          <span className="dot" />
          Sepolia
        </span>
        <Connect />
      </header>

      <section className="panel raised">
        <p className="label">The pool</p>
        <div className="hero">
          <div className="dial pressed">
            <div className="inner raised">
              <div>
                <div className="amount">{fromUnits(stats.pot)}</div>
                <div className="unit">tUSDT prize</div>
              </div>
            </div>
          </div>

          <div className="statgrid">
            <div className="stat pressed-sm">
              <div className="k">Depositors</div>
              <div className="v">{stats.participants?.toString() ?? "—"}</div>
              <div className="sub">minimum {stats.minParticipants ?? "—"} to draw</div>
            </div>
            <div className="stat pressed-sm">
              <div className="k">Total deposited</div>
              <div className="v">Sealed</div>
              <div className="sub">never computed in the clear</div>
            </div>
            <div className="stat pressed-sm">
              <div className="k">Draw</div>
              <div className="v">#{stats.drawId?.toString() ?? "—"}</div>
              <div className="sub">
                {stats.scanning ? `scanning ${scanned}/${scanTotal}` : settled ? "settled" : "not started"}
              </div>
            </div>
            <div className="stat pressed-sm">
              <div className="k">Odds</div>
              <div className="v">Time-weighted</div>
              <div className="sub">a late deposit buys less</div>
            </div>
          </div>
        </div>
      </section>

      <div className="cols" style={{ marginTop: 28 }}>
        <section className="panel raised">
          <p className="label">Your position</p>

          {!balance.isConnected ? (
            <>
              <div className="well pressed">
                <div className="cipher">connect a wallet to read your own balance</div>
              </div>
              <p className="small muted" style={{ marginTop: 14 }}>
                Only you can decrypt it. Not the operator, not the contract.
              </p>
            </>
          ) : (
            <>
              <div className="well pressed">
                {balance.revealed ? (
                  <div className="figure">
                    {fromUnits(balance.value)}
                    <span className="unit">tUSDT</span>
                  </div>
                ) : (
                  <div className="cipher">{balance.handle?.slice(2, 42) ?? "no deposit yet"}</div>
                )}
              </div>

              <p className="small muted" style={{ marginTop: 14 }}>
                {balance.revealed
                  ? "Readable by your key alone. Nothing was published to reveal it."
                  : balance.isEmpty
                    ? "Nothing deposited yet. Your balance appears here, sealed."
                    : "Sealed. The number is present on-chain but unreadable."}
              </p>

              <div className="btnrow">
                {balance.revealed ? (
                  <button className="btn raised-sm" onClick={balance.hide}>
                    Seal again
                  </button>
                ) : (
                  <button
                    className="btn raised-sm primary"
                    onClick={balance.reveal}
                    disabled={balance.working || balance.isEmpty}
                  >
                    {balance.working ? "Decrypting…" : "Decrypt for me"}
                  </button>
                )}
              </div>

              {balance.error ? <Notice tone="bad" title="Could not decrypt" detail={balance.error} /> : null}
            </>
          )}

          <div className="rows">
            <div className="row">
              <span className="k">Asset</span>
              <span className="v">cUSDT · ERC-7984</span>
            </div>
            <div className="row">
              <span className="k">Handle</span>
              <span className="v mono small">{balance.handle ? short(balance.handle) : "—"}</span>
            </div>
            <div className="row">
              <span className="k">Withdrawable</span>
              <span className="v">Always, in full</span>
            </div>
          </div>

          <p className="label" style={{ marginTop: 26 }}>
            What an observer sees
          </p>
          <div className="rows" style={{ marginTop: 0 }}>
            <div className="row">
              <span className="k">That you deposited, and when</span>
              <span className="v">Public</span>
            </div>
            <div className="row">
              <span className="k">How much you hold</span>
              <span className="v">Sealed</span>
            </div>
            <div className="row">
              <span className="k">Whether you have won</span>
              <span className="v">Sealed</span>
            </div>
          </div>

          <div className="note pressed-sm">
            <strong>Your odds exist. Nobody can read them.</strong>
            <p>
              Computed on-chain from your encrypted time-weighted balance, and never disclosed — to
              you or anyone else.
            </p>
          </div>
        </section>

        <section className="panel raised">
          <p className="label">Move funds</p>

          <div className="segmented pressed-sm">
            <button aria-pressed={tab === "deposit"} onClick={() => setTab("deposit")}>
              Deposit
            </button>
            <button aria-pressed={tab === "withdraw"} onClick={() => setTab("withdraw")}>
              Withdraw
            </button>
          </div>

          {actions.status ? (
            <Notice
              tone={actions.busy ? "busy" : actions.status.length > 60 ? "bad" : "ok"}
              title={actions.busy ? actions.status : "Something went wrong"}
              detail={actions.busy ? "Confirm in your wallet." : actions.status}
            />
          ) : actions.lastDone ? (
            <Notice
              tone="ok"
              title={`${actions.lastDone}. Nobody saw the amount.`}
              detail="The transfer carried a ciphertext, not a number."
            />
          ) : null}

          <div className="amountwell pressed">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              aria-label="Amount"
            />
            <span className="unit">tUSDT</span>
          </div>

          <div className="quick">
            {QUICK.map((value) => (
              <button key={value} className="btn raised-sm" onClick={() => setAmount(value)}>
                {value}
              </button>
            ))}
          </div>

          <div className="btnrow">
            <button
              className="btn raised-sm lg primary wide"
              onClick={() => (tab === "deposit" ? actions.deposit(units) : actions.withdraw(units))}
              disabled={actions.busy || units === 0n}
            >
              {tab === "deposit" ? "Deposit privately" : "Withdraw"}
            </button>
          </div>

          <div className="rows">
            <div className="row">
              <span className="k">In your wallet</span>
              <span className="v">{fromUnits(wallet.value)} tUSDT public</span>
            </div>
            <div className="row">
              <span className="k">Need test funds?</span>
              <span className="v">
                <button className="btn raised-sm" onClick={() => actions.faucet(units)} disabled={actions.busy}>
                  Mint {amount || "0"} tUSDT
                </button>
              </span>
            </div>
            <div className="row">
              <span className="k">Grow the prize</span>
              <span className="v">
                <button className="btn raised-sm" onClick={() => actions.sponsor(units)} disabled={actions.busy}>
                  Sponsor {amount || "0"} tUSDT
                </button>
              </span>
            </div>
          </div>

          <div className="note pressed-sm">
            <strong>No standing approval is ever granted.</strong>
            <p>
              A deposit is made on the token itself and delivers the funds in the same call, so the
              pool never holds permission to move your balance. An ERC-7984 operator grant is bounded
              by time but not by amount, and this pool never asks for one.
            </p>
          </div>
        </section>
      </div>

      <section className="panel raised" style={{ marginTop: 28 }}>
        <p className="label">The draw</p>

        <p className="small muted" style={{ marginTop: 0, maxWidth: "68ch" }}>
          Participants are scanned in batches of {batchSize}. Each one is written to identically — the
          winner and the losers cost the same gas and emit the same events.
        </p>

        <div className="segbar" aria-label={`${scanned} of ${scanTotal} scanned`}>
          {Array.from({ length: Math.max(scanTotal, 1) }).map((_, index) => (
            <span key={index} className={`seg${index < scanned ? " done" : ""}`} />
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          {stats.scanning
            ? `${scanned} of ${scanTotal} scanned`
            : settled
              ? `Draw #${stats.drawId?.toString()} settled over ${scanTotal} participants`
              : "No draw running"}
        </p>

        <div className="btnrow">
          <button
            className="btn raised-sm primary"
            onClick={draw.startDraw}
            disabled={draw.busy || Boolean(stats.scanning)}
          >
            Start a draw
          </button>
          <button
            className="btn raised-sm"
            onClick={() => draw.advanceDraw(batchSize)}
            disabled={draw.busy || !stats.scanning}
          >
            Advance the scan
          </button>
        </div>

        <div className="chips">
          <div className="chip pressed-sm">
            <span className="k">Randomness</span>
            <span className="v">On-chain FHE</span>
          </div>
          <div className="chip pressed-sm">
            <span className="k">Who can run it</span>
            <span className="v">Anyone</span>
          </div>
          <div className="chip pressed-sm">
            <span className="k">Refused below</span>
            <span className="v">{stats.minParticipants ?? "—"} depositors</span>
          </div>
        </div>

        <div className="note pressed-sm">
          <strong>{settled ? "Settled. No winner was recorded." : "No winner will be recorded."}</strong>
          <p>
            That is not a missing field. The winning index exists only as a ciphertext that is never
            decrypted, so the chain holds no record of who took the prize. A winner finds out by
            decrypting their own balance.
          </p>
        </div>
      </section>

      <section className="panel raised" style={{ marginTop: 28 }}>
        <p className="label">Exit queue</p>

        <p className="small muted" style={{ marginTop: 0, maxWidth: "68ch" }}>
          Leaving for the public token is where a prize pool normally names its winner. Requests
          gather here and the wrapper is called once, for the batch total.
        </p>

        <div className="meter pressed-sm">
          <div className="fill" style={{ width: `${exitPct}%` }} />
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Batch #{exit.batchId?.toString() ?? "—"} · {exitHave} of {exitNeed || "—"} requests needed
        </p>

        <div className="chips">
          <div className="chip pressed-sm">
            <span className="k">Settles after</span>
            <span className="v">{exit.minBatchAge ? `${exit.minBatchAge.toString()}s` : "—"}</span>
          </div>
          <div className="chip pressed-sm">
            <span className="k">Status</span>
            <span className="v">{exit.settleable ? "Ready to settle" : "Holding"}</span>
          </div>
          <div className="chip pressed-sm">
            <span className="k">Calls to the wrapper</span>
            <span className="v">One, per batch</span>
          </div>
        </div>

        <div className="note pressed-sm">
          <strong>A lone exit is never settled alone.</strong>
          <p>
            Claim amounts do become public when claimed — paying an ERC-20 needs a plaintext.
            Batching removes the link to any particular draw. That limit is documented rather than
            hidden.
          </p>
        </div>
      </section>

      <footer className="foot pressed-sm">
        <a href={`${SCAN}/address/${sepolia.pool}`} target="_blank" rel="noreferrer">
          Pool contract
        </a>
        <a href={`${SCAN}/address/${sepolia.exitQueue}`} target="_blank" rel="noreferrer">
          Exit queue
        </a>
        <a href={`${SCAN}/address/${sepolia.underlying}#writeContract`} target="_blank" rel="noreferrer">
          Test token faucet
        </a>
        <span>Verified on Etherscan · Sepolia · six decimals</span>
      </footer>
    </main>
  );
}
