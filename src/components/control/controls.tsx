"use client";

import Link from "next/link";
import type { Action, Snapshot } from "./types";
import { DateText, Empty, humanize, Status } from "./common";

export function ControlsView({
  snapshot,
  act,
  busy,
}: {
  snapshot: Snapshot;
  act: Action;
  busy: boolean;
}) {
  const admin = snapshot.actor.roles.includes("admin");
  const blocked = snapshot.cases.filter((item) => item.blockingReason);
  return (
    <>
      <div className="section-header">
        <div>
          <h1>Controls & audit</h1>
          <p className="muted">
            Pause dispatch, review failures, and inspect recorded authority.
          </p>
        </div>
      </div>
      <div className="two-column">
        <section className="panel">
          <h2>Workspace dispatch</h2>
          <p>
            Current state:{" "}
            <Status value={snapshot.workspace.paused ? "paused" : "active"} />
          </p>
          <p className="muted">
            A committed pause blocks new dispatch. Already dispatched work must
            still be reconciled.
          </p>
          {admin ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void act(
                  "pause",
                  {
                    paused: !snapshot.workspace.paused,
                    reason: data.get("reason"),
                  },
                  snapshot.workspace.paused
                    ? "Workspace resumed. Every action still requires current authority."
                    : "Workspace paused. New dispatch is blocked.",
                );
              }}
            >
              <label>
                Operator reason
                <input name="reason" required minLength={8} maxLength={2000} />
              </label>
              <button type="submit" disabled={busy}>
                {snapshot.workspace.paused
                  ? "Resume workspace"
                  : "Pause workspace"}
              </button>
            </form>
          ) : (
            <p className="notice">
              Only an admin can pause or resume the workspace.
            </p>
          )}
        </section>
        <section className="panel">
          <h2>Project budget</h2>
          <dl className="facts">
            <div>
              <dt>Spent</dt>
              <dd>${snapshot.workspace.spendUsd.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Reserved / unresolved</dt>
              <dd>${snapshot.workspace.reservedUsd.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Infrastructure commitments</dt>
              <dd>
                $
                {(snapshot.workspace.infrastructureCommittedUsd ?? 0).toFixed(
                  2,
                )}{" "}
                · included in reserved
              </dd>
            </div>
            <div>
              <dt>Hard project ceiling</dt>
              <dd>${snapshot.workspace.capUsd.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{snapshot.workspace.model}</dd>
            </div>
          </dl>
          <progress
            aria-label="Budget used and reserved"
            value={Math.min(
              snapshot.workspace.capUsd,
              snapshot.workspace.spendUsd + snapshot.workspace.reservedUsd,
            )}
            max={snapshot.workspace.capUsd}
          />
          <p className="small muted">
            Unknown charges retain their reservation. Hosting, model calls, and
            paid integrations share this ceiling; no automatic budget increase
            or model upgrade.
          </p>
          {admin && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void act(
                  "budget_commit",
                  { usd: Number(data.get("usd")), reason: data.get("reason") },
                  "Infrastructure commitment recorded in the shared budget.",
                );
              }}
            >
              <label>
                Total infrastructure commitment (USD)
                <input
                  key={snapshot.workspace.infrastructureCommittedUsd}
                  name="usd"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  defaultValue={
                    snapshot.workspace.infrastructureCommittedUsd ?? 0
                  }
                />
              </label>
              <label>
                Budget change reason
                <textarea
                  name="reason"
                  rows={2}
                  minLength={8}
                  maxLength={2000}
                  required
                  placeholder="Include hosting, build costs, renewal exposure, and evidence for any reduction."
                />
              </label>
              <p className="small muted">
                Enter the current total commitment. This records costs; it does
                not purchase a service or cancel a subscription.
              </p>
              <button disabled={busy}>Save infrastructure commitment</button>
            </form>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>Pending failures ({blocked.length})</h2>
        {blocked.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Phase</th>
                  <th>Blocker</th>
                  <th>Communication</th>
                </tr>
              </thead>
              <tbody>
                {blocked.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/cases/${encodeURIComponent(item.id)}`}>
                        {item.title}
                      </Link>
                    </td>
                    <td>{humanize(item.phase)}</td>
                    <td>
                      <Status value={item.blockingReason!} />
                    </td>
                    <td>{humanize(item.communicationStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No blocked cases.</Empty>
        )}
      </section>
      {admin && (
        <section className="panel">
          <h2>Account dispatch</h2>
          {snapshot.connections.map((connection) => (
            <form
              key={connection.id}
              className="subpanel"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void act(
                  "account_pause",
                  {
                    connectionId: connection.id,
                    paused: !connection.paused,
                    reason: data.get("reason"),
                  },
                  "Account dispatch setting saved.",
                );
              }}
            >
              <h3>
                {connection.platform.toUpperCase()} ·{" "}
                {connection.account || "No account configured"}{" "}
                <Status value={connection.paused ? "paused" : "active"} />
              </h3>
              <label>
                Account pause reason
                <input name="reason" required minLength={8} maxLength={2000} />
              </label>
              <button className="secondary" disabled={busy}>
                {connection.paused ? "Resume account" : "Pause account"}
              </button>
            </form>
          ))}
        </section>
      )}
      <section className="panel">
        <h2>Suppression management</h2>
        <p className="muted">
          Opted-out or blocked authors must not receive autonomous engagement.
        </p>
        {admin && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void act(
                "suppression_add",
                {
                  platform: data.get("platform"),
                  author: data.get("author"),
                  reason: data.get("reason"),
                },
                "Author suppression recorded.",
              );
            }}
          >
            <div className="form-grid three-columns">
              <label>
                Suppression platform
                <select name="platform">
                  <option value="x">X</option>
                  <option value="reddit">Reddit</option>
                </select>
              </label>
              <label>
                Author identifier
                <input name="author" required maxLength={200} />
              </label>
              <label>
                Suppression reason
                <input name="reason" required minLength={8} maxLength={2000} />
              </label>
            </div>
            <button disabled={busy}>Add suppression</button>
          </form>
        )}
        {snapshot.suppressions?.length ? (
          snapshot.suppressions.map((item) => (
            <article key={item.id} className="subpanel">
              <h3>
                {item.platform.toUpperCase()} · {item.author}
              </h3>
              <p>{item.reason}</p>
              {admin && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void act(
                      "suppression_remove",
                      { id: item.id, reason: data.get("reason") },
                      "Suppression removal recorded.",
                    );
                  }}
                >
                  <label>
                    Evidence and reason for removal
                    <input
                      name="reason"
                      required
                      minLength={8}
                      maxLength={2000}
                    />
                  </label>
                  <button className="secondary" disabled={busy}>
                    Remove suppression
                  </button>
                </form>
              )}
            </article>
          ))
        ) : (
          <Empty>No author suppressions recorded.</Empty>
        )}
      </section>
      <section className="panel">
        <h2>Audit history</h2>
        <p className="muted">
          Actor, role, reason, and outcome are retained for approval and
          recovery actions.
        </p>
        {snapshot.audit.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor / role</th>
                  <th>Action</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.audit.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <DateText value={item.at} />
                    </td>
                    <td>
                      {item.actor === "Mend · sample data"
                        ? "brio · sample data"
                        : item.actor}
                      <div className="small muted">{item.role}</div>
                    </td>
                    <td>{humanize(item.action)}</td>
                    <td>{item.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No audit events recorded yet.</Empty>
        )}
      </section>
    </>
  );
}
