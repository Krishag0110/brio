"use client";

import { useState } from "react";
import type { Action, Connection, Snapshot } from "./types";
import { DateText, Status } from "./common";

function ConnectionCard({
  connection,
  snapshot,
  act,
  busy,
}: {
  connection: Connection;
  snapshot: Snapshot;
  act: Action;
  busy: boolean;
}) {
  const admin = snapshot.actor.roles.includes("admin");
  return (
    <article className="panel">
      <div className="section-header compact">
        <h2>{connection.platform.toUpperCase()}</h2>
        <Status value={connection.status} />
      </div>
      <p>{connection.detail}</p>
      <dl className="facts">
        <div>
          <dt>Account</dt>
          <dd>{connection.account || "Not configured"}</dd>
        </div>
        <div>
          <dt>Last checked</dt>
          <dd>
            <DateText value={connection.lastCheckedAt} />
          </dd>
        </div>
      </dl>
      {connection.platform === "x" && (
        <p className="small muted">
          Experimental Chromium adapter. Login challenges and throttling require
          reconnect. Manual intake remains available.
        </p>
      )}
      {connection.platform === "reddit" && (
        <p className="small muted">
          Official OAuth/API access and community authorization are
          prerequisites for live activity.
        </p>
      )}
      {admin && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void act(
                "connection_configure",
                { connectionId: connection.id, account: data.get("account") },
                "Account identifier saved. Readiness still requires verification.",
              );
            }}
          >
            <label>
              Account identifier
              <input
                name="account"
                required
                maxLength={200}
                defaultValue={connection.account}
              />
            </label>
            <button className="secondary" type="submit" disabled={busy}>
              Save account identifier
            </button>
          </form>
          <p className="small muted">Reset invalidates this connection and any prior session authority.</p>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  "reconnect",
                  { connectionId: connection.id },
                  connection.platform === "x"
                    ? "Connection invalidated. Import a new authorized session before live activity."
                    : "Connection invalidated. Restore and verify its OAuth/API configuration before live activity.",
                )
              }
            >
              {connection.platform === "x" ? "Reset connection for reimport" : "Reset connection"}
            </button>
            <button
              className="secondary"
              disabled={busy || connection.status === "disabled"}
              onClick={() =>
                void act(
                  "connection_disable",
                  { connectionId: connection.id },
                  "Connector disabled.",
                )
              }
            >
              Disable connector
            </button>
          </div>
        </>
      )}
    </article>
  );
}

export function ConnectionsView({
  snapshot,
  act,
  busy,
  refresh,
}: {
  snapshot: Snapshot;
  act: Action;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const admin = snapshot.actor.roles.includes("admin");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [method, setMethod] = useState("file");
  const [redditConnecting, setRedditConnecting] = useState(false);
  const [redditError, setRedditError] = useState("");
  const redditAccount = snapshot.connections.find(connection => connection.platform === "reddit")?.account;
  return (
    <>
      <div className="section-header">
        <div>
          <h1>Connections & readiness</h1>
          <p className="muted">
            Configured credentials and verified provider capability are distinct
            states.
          </p>
        </div>
      </div>
      <section className="panel">
        <h2>Environment readiness</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dependency</th>
                <th>Status</th>
                <th>Capability / next step</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.readiness.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>
                    <Status value={item.status} />
                  </td>
                  <td>{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {!admin && (
        <p className="notice">
          Connection changes and session import require the admin role.
        </p>
      )}
      <div className="two-column">
        {snapshot.connections.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            snapshot={snapshot}
            act={act}
            busy={busy}
          />
        ))}
      </div>
      <section className="panel">
        <h2>Connect Reddit</h2>
        <p className="muted">
          Save the dedicated account identifier above, then authorize that same
          Reddit account. Approved API access and an explicitly permitted
          community list are required. Connecting does not approve a reply.
        </p>
        <form onSubmit={async event => {
          event.preventDefault(); setRedditConnecting(true); setRedditError("");
          try {
            const response = await fetch("/api/connections/reddit/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: redditAccount }) });
            if (!response.ok) throw new Error("Reddit authorization is unavailable. Check approved API access, worker setup, and the saved account identifier.");
            const result = await response.json() as { url: string; grant: string };
            const destination = new URL(result.url);
            if (destination.protocol !== "https:" || destination.pathname !== "/v1/oauth/reddit/start" || typeof result.grant !== "string") throw new Error("The Reddit authorization destination is invalid.");
            const form = document.createElement("form"), grant = document.createElement("input");
            form.method = "POST"; form.action = destination.href;
            grant.type = "hidden"; grant.name = "grant"; grant.value = result.grant;
            form.append(grant); document.body.append(form); form.submit(); form.remove();
          } catch (cause) {
            setRedditError(cause instanceof Error ? cause.message : "Reddit authorization failed."); setRedditConnecting(false);
          }
        }}>
          <button type="submit" disabled={!admin || snapshot.mode === "demo" || !redditAccount || busy || redditConnecting}>
            {redditConnecting ? "Opening Reddit…" : "Authorize Reddit account"}
          </button>
        </form>
        {snapshot.mode === "demo" && <p className="notice demo">Reddit authorization is available in a configured live workspace.</p>}
        {redditError && <p role="alert" className="notice error">{redditError}</p>}
      </section>
      <section className="panel">
        <h2>Import X session</h2>
        <p className="muted">
          Use a dedicated, authorized brand account. Session material is sent
          only to the encrypted import endpoint and is never included in case
          evidence or model prompts.
        </p>
        {snapshot.mode === "demo" && (
          <p className="notice demo">
            Session import is disabled in local demo mode. Configure live
            workspace access, the encrypted session worker, and the expected
            account before importing real session material.
          </p>
        )}
        <form
          autoComplete="off"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            setUploading(true);
            setUploadError("");
            setUploadMessage("");
            try {
              let storageState: unknown;
              if (method === "file") {
                const file = data.get("storageState");
                if (!(file instanceof File) || !file.size)
                  throw new Error(
                    "Select the browser storage-state JSON file.",
                  );
                if (file.size > 28000)
                  throw new Error(
                    "Session file must be smaller than 28 KB and contain only the dedicated X session.",
                  );
                try {
                  storageState = JSON.parse(await file.text());
                } catch {
                  throw new Error("The session file must be valid JSON.");
                }
              } else {
                storageState = {
                  cookies: ["auth_token", "ct0"].map((name) => ({
                    name,
                    value: String(data.get(name) || ""),
                    domain: ".x.com",
                    path: "/",
                    expires: -1,
                    httpOnly: name === "auth_token",
                    secure: true,
                    sameSite: "Lax",
                  })),
                  origins: [],
                };
              }
              const response = await fetch("/api/connections/x/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accountId: data.get("accountId"),
                  storageState,
                }),
              });
              storageState = undefined;
              if (!response.ok)
                throw new Error(
                  "Session import was rejected. Verify the account, worker readiness, and current admin authorization.",
                );
              setUploadMessage(
                "Session import accepted. The account capability shown above reflects worker validation.",
              );
              await refresh();
            } catch (cause) {
              setUploadError(
                cause instanceof Error
                  ? cause.message
                  : "Session import failed.",
              );
            } finally {
              form.reset();
              setUploading(false);
            }
          }}
        >
          <fieldset
            disabled={!admin || snapshot.mode === "demo" || uploading || busy}
          >
            <label>
              Expected brand account ID
              <input
                name="accountId"
                required
                maxLength={200}
                autoComplete="off"
              />
            </label>
            <label>
              Import method
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                <option value="file">Browser storage-state JSON</option>
                <option value="cookies">Guided session cookie entry</option>
              </select>
            </label>
            {method === "file" ? (
              <label>
                Browser session file
                <input
                  type="file"
                  name="storageState"
                  accept="application/json,.json"
                  required
                />
              </label>
            ) : (
              <>
                <p className="small muted">
                  Copy only these values from the authorized account&apos;s
                  browser session. Never paste your account password.
                </p>
                <label>
                  auth_token
                  <input
                    name="auth_token"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label>
                  ct0
                  <input
                    name="ct0"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </label>
              </>
            )}
            <button type="submit">
              {uploading ? "Importing…" : "Import encrypted session"}
            </button>
          </fieldset>
        </form>
        {uploadError && (
          <p role="alert" className="notice error">
            {uploadError}
          </p>
        )}
        {uploadMessage && (
          <p role="status" className="notice success">
            {uploadMessage}
          </p>
        )}
      </section>
      {admin && (
        <section className="panel">
          <h2>Slack approval roles</h2>
          <p>
            Live approvals use exact Slack user IDs in the configured Slack
            team. The shared workspace operator can prepare requests; decisions
            remain in Slack.
          </p>
          <p className="small muted">
            Configure SLACK_ENGINEER_USER_IDS, SLACK_MARKETER_USER_IDS, and
            optional SLACK_ADMIN_USER_IDS in the Convex deployment. Use
            comma-separated IDs, not display names. Changing these settings
            requires deployment access and does not approve pending work.
          </p>
        </section>
      )}
    </>
  );
}
