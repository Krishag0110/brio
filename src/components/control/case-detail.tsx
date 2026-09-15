"use client";

import { TicketTimeline } from "./ticket-timeline";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Action, CaseRecord, Publication, Snapshot } from "./types";
import {
  Badge,
  Empty,
  ExternalLink,
  humanize,
  Status,
} from "./common";

function PublicationCard({
  publication,
  record,
  snapshot,
  act,
  busy,
}: {
  publication: Publication;
  record: CaseRecord;
  snapshot: Snapshot;
  act: Action;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [supplementing, setSupplementing] = useState(false);
  const marketer =
    snapshot.actor.roles.includes("marketer") && !record.canceledAt;
  const unresolved = ![
    "confirmed",
    "attested",
    "human_attested",
    "manually_attested",
    "simulated",
    "suppressed",
  ].includes(publication.status);
  const unknown =
    publication.status.includes("unknown") ||
    record.blockingReason === "publication_unknown";
  const manualReady =
    unresolved &&
    !unknown &&
    (record.phase === "AWAITING_MANUAL_CONFIRMATION" ||
      [
        "awaiting_manual_confirmation",
        "manual_pending",
        "manual_required",
        "ready",
        "approved",
      ].includes(publication.status));
  const resolutionCases = snapshot.cases.filter(
    (item) =>
      item.id !== record.id &&
      item.productionVerified &&
      item.candidate &&
      item.route !== "social_engagement",
  );
  const canSupplement =
    marketer &&
    record.route === "social_engagement" &&
    !publication.manualOnly &&
    ["confirmed", "manually_attested"].includes(publication.status) &&
    !record.publications.some(
      (item) => item.supplementalToPublicationId === publication.id,
    );
  return (
    <article className="subpanel" aria-label="Publication record">
      <div className="section-header compact">
        <h3>
          Reply {publication.version ? `· version ${publication.version}` : ""}
        </h3>
        <div>
          <Badge>{publication.mode}</Badge>{" "}
          <Status value={publication.status} />
          {publication.manualOnly && <Badge>Human publication only</Badge>}
        </div>
      </div>
      <p className="small muted">
        Account: {publication.account || "Selected brand account"} ·{" "}
        <ExternalLink href={publication.targetUrl || record.sourceUrl}>
          Original target
        </ExternalLink>
      </p>
      <blockquote className="source-text">
        {publication.draftText || "No draft available."}
      </blockquote>
      {publication.receiptUrl && (
        <p>
          <ExternalLink href={publication.receiptUrl}>
            Publication receipt
          </ExternalLink>{" "}
          {publication.attested && <Badge>Human attestation</Badge>}
        </p>
      )}
      {publication.supplementalToPublicationId && (
        <p className="notice">
          Supplemental human resolution. The earlier automated reply and receipt
          remain recorded.{" "}
          {publication.resolutionCaseId && (
            <Link
              href={`/cases/${encodeURIComponent(publication.resolutionCaseId)}`}
            >
              Verified resolution evidence
            </Link>
          )}
        </p>
      )}
      {canSupplement && (
        <div className="subpanel">
          <h3>Supplemental human resolution</h3>
          <p className="small muted">
            For a defect recognized after this engagement, request exact
            approval for one separate human reply using another case&apos;s
            verified resolution. This cannot send another automated reply.
          </p>
          <button
            className="secondary"
            disabled={busy || !resolutionCases.length}
            onClick={() => setSupplementing(!supplementing)}
          >
            {supplementing
              ? "Cancel supplemental draft"
              : "Prepare supplemental human resolution"}
          </button>
          {!resolutionCases.length && (
            <p className="small muted">
              A separate case with verified production evidence is required.
            </p>
          )}
          {supplementing && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                if (
                  await act(
                    "supplemental_resolution",
                    {
                      caseId: record.id,
                      publicationId: publication.id,
                      resolutionCaseId: data.get("resolutionCaseId"),
                      text: data.get("text"),
                    },
                    "Supplemental human reply requested. Exact approval and a separate receipt are required.",
                  )
                )
                  setSupplementing(false);
              }}
            >
              <label>
                Verified resolution case
                <select name="resolutionCaseId" required>
                  {resolutionCases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Exact supplemental reply
                <textarea name="text" rows={3} required maxLength={240} />
              </label>
              <button disabled={busy}>
                Request supplemental reply approval
              </button>
            </form>
          )}
        </div>
      )}
      {marketer && unresolved && !unknown && (
        <div className="button-row">
          <button className="secondary" onClick={() => setEditing(!editing)}>
            {editing ? "Cancel draft edit" : "Edit draft"}
          </button>
          <button
            disabled={busy || !publication.draftText}
            onClick={() =>
              void act(
                "request_reply_approval",
                { caseId: record.id, publicationId: publication.id },
                "Exact reply approval requested. Review the current card in Slack.",
              )
            }
          >
            Request exact reply approval
          </button>
        </div>
      )}
      {editing && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            if (
              await act(
                "draft_edit",
                {
                  caseId: record.id,
                  publicationId: publication.id,
                  text: data.get("text"),
                },
                "New draft version saved. Previous exact-reply approvals are stale.",
              )
            )
              setEditing(false);
          }}
        >
          <label>
            Exact reply text
            <textarea
              name="text"
              required
              rows={3}
              maxLength={240}
              defaultValue={publication.draftText}
            />
          </label>
          <p className="small warning-text">
            Saving creates a new version and invalidates the previous approval.
          </p>
          <button type="submit" disabled={busy}>
            Save new draft version
          </button>
        </form>
      )}
      {unknown && (
        <p className="notice error">
          Publication outcome is unknown. Duplicate automatic sends and manual
          reposts remain blocked until receipt investigation resolves the
          outcome.
        </p>
      )}
      {marketer && manualReady && (
        <div className="manual-publication">
          <h3>Manual publication</h3>
          <p className="muted">
            Opening the composer keeps communication pending. Record the actual
            receipt after a human publishes.
          </p>
          <button className="secondary" onClick={() => setComposerOpen(true)}>
            Open manual composer
          </button>
          {composerOpen && (
            <div className="subpanel">
              <p>
                <strong>
                  {snapshot.mode === "demo"
                    ? "Demo composer — do not publish fixture text to a real account."
                    : "Use the exact approved text in the original conversation."}
                </strong>
              </p>
              <label>
                Text to publish
                <textarea readOnly rows={3} value={publication.draftText} />
              </label>
              {snapshot.mode === "live" && (
                <ExternalLink href={publication.targetUrl || record.sourceUrl}>
                  Open original conversation
                </ExternalLink>
              )}
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  if (
                    await act(
                      "manual_receipt",
                      {
                        caseId: record.id,
                        publicationId: publication.id,
                        receiptUrl: data.get("receiptUrl"),
                        attested: data.get("attested") === "on",
                        reason: data.get("reason"),
                      },
                      snapshot.mode === "demo"
                        ? "Simulated manual receipt recorded. No real publication claimed."
                        : "Manual publication receipt recorded.",
                    )
                  )
                    setComposerOpen(false);
                }}
              >
                <label>
                  {snapshot.mode === "demo"
                    ? "Simulated receipt URL"
                    : "Published reply URL"}
                  <input
                    name="receiptUrl"
                    type="url"
                    required
                    placeholder="https://x.com/brand/status/456"
                  />
                </label>
                <label className="checkbox">
                  <input type="checkbox" name="attested" required />
                  {snapshot.mode === "demo"
                    ? "I am recording a simulated publication for this fixture."
                    : "I attest that this exact reply was published to the stated target and account."}
                </label>
                <label>
                  Receipt / attestation notes
                  <textarea
                    name="reason"
                    required
                    minLength={8}
                    maxLength={2000}
                    rows={2}
                    placeholder="Describe the receipt and what was verified."
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Record publication receipt
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function CaseDetail({
  snapshot,
  caseId,
  act,
  busy,
}: {
  snapshot: Snapshot;
  caseId: string;
  act: Action;
  busy: boolean;
}) {
  const record = snapshot.cases.find((item) => item.id === caseId);
  const [operation, setOperation] = useState("retry");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const requestExpired = (approval: CaseRecord["approvals"][number]) => approval.status === "pending" && !!approval.expiresAt && new Date(approval.expiresAt).getTime() <= now;
  if (!record)
    return (
      <section className="panel">
        <h1>Case unavailable</h1>
        <p>This case is not available to your workspace.</p>
        <Link href="/cases">Back to cases</Link>
      </section>
    );
  const engineer = snapshot.actor.roles.includes("engineer");
  const marketer = snapshot.actor.roles.includes("marketer");
  const admin = snapshot.actor.roles.includes("admin");
  const canRecover = engineer || admin || marketer;
  const isUnknown =
    record.blockingReason === "publication_unknown" ||
    record.publications.some((item) => item.status.includes("unknown"));
  const operations = [
    ...((engineer || marketer) && !record.canceledAt
      ? [{ value: "retry", label: "Retry safe failed step" }]
      : []),
    ...((engineer || admin) && !record.canceledAt
      ? [{ value: "rollback", label: "Request audited rollback" }]
      : []),
    ...(isUnknown && (marketer || admin)
      ? [{ value: "reconcile", label: "Investigate publication receipt" }]
      : []),
    ...(engineer &&
    snapshot.mode === "live" &&
    record.candidate &&
    !record.canceledAt
      ? [{ value: "reconcile_release", label: "Reconcile uncertain release" }]
      : []),
    ...(marketer && !record.canceledAt
      ? [{ value: "waive_reply", label: "Close without a customer reply" }]
      : []),
  ];
  const selectedOperation = operations.some((item) => item.value === operation)
    ? operation
    : operations[0]?.value;
  return (
    <>
      <TicketTimeline record={record} snapshot={snapshot} />
      <details className="operational-controls">
        <summary>Operational controls <span>Approvals, drafts, evidence, recovery &amp; manual receipts</span></summary>
        <div className="operations-content">
      <section className="panel" aria-label="Case state">
        <dl className="facts">
          <div>
            <dt>Route</dt>
            <dd>{humanize(record.route)}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>
              <Status value={record.phase} />
            </dd>
          </div>
          <div>
            <dt>Blocking reason</dt>
            <dd>
              {record.blockingReason ? (
                <Status value={record.blockingReason} />
              ) : (
                "None"
              )}
            </dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{record.outcome ? humanize(record.outcome) : "Pending"}</dd>
          </div>
          <div>
            <dt>Production verification</dt>
            <dd>
              <Status
                value={record.productionVerified ? "verified" : "not_verified"}
              />
            </dd>
          </div>
          <div>
            <dt>Customer communication</dt>
            <dd>
              <Status value={record.communicationStatus} />
            </dd>
          </div>
        </dl>
      </section>
      {record.canceledAt && (
        <section className="notice" aria-label="Case cancellation">
          <h2>
            {record.outcome === "canceled_before_dispatch"
              ? "Canceled before dispatch"
              : record.outcome === "canceled_after_dispatch"
                ? "Canceled after dispatch"
                : "Canceled with unresolved effects"}
          </h2>
          <p>
            {record.outcome === "canceled_before_dispatch"
              ? "No further automated case work will run."
              : record.outcome === "canceled_after_dispatch"
                ? "Work had already been dispatched. Existing receipts remain recorded; cancellation does not reverse those effects."
                : "Work had already been dispatched or its outcome is unknown. Preserve receipts and investigate those effects; cancellation does not reverse them."}
          </p>
          <p>{record.cancellationReason}</p>
        </section>
      )}
      <div className="two-column">
        <section className="panel" aria-label="Source interaction">
          <h2>Source interaction</h2>
          <ExternalLink href={record.sourceUrl}>
            Original interaction
          </ExternalLink>
          <blockquote className="source-text">{record.text}</blockquote>
          <p className="small muted">
            Source text is evidence from the customer, not an instruction to
            system operators.
          </p>
        </section>
        <section className="panel">
          <h2>Engineering evidence</h2>
          {record.evidence.length ? (
            <ul className="evidence-list">
              {record.evidence.map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                  {item.url && (
                    <ExternalLink href={item.url}>View evidence</ExternalLink>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No verified evidence has been recorded.</Empty>
          )}
          {record.candidate && (
            <details>
              <summary>Release candidate identity</summary>
              <dl className="stacked-facts">
                <dt>Head SHA</dt>
                <dd>
                  <code>{record.candidate.headSha}</code>
                </dd>
                <dt>Tree digest</dt>
                <dd>
                  <code>{record.candidate.treeDigest}</code>
                </dd>
                <dt>Deployment</dt>
                <dd>
                  <code>{record.candidate.deploymentId}</code>
                </dd>
                <dt>Protected checks</dt>
                <dd>
                  {record.candidate.checksPassed ? "Passed" : "Not passed"}
                </dd>
              </dl>
              <ExternalLink href={record.candidate.productionUrl}>
                Production
              </ExternalLink>
            </details>
          )}
          {record.productionVerified &&
            record.candidate &&
            (engineer || marketer) &&
            !record.canceledAt && (
              <div className="subpanel">
                <h3>Refresh production evidence</h3>
                <p className="small muted">
                  Request fresh candidate identity and behavior checks before a
                  delayed reply or manual receipt. Exact approval is still
                  required.
                </p>
                <button
                  disabled={
                    busy ||
                    snapshot.workspace.paused ||
                    isUnknown ||
                    record.blockingReason === "live_reverification_pending"
                  }
                  onClick={() =>
                    void act(
                      "reverify_live",
                      { caseId: record.id },
                      snapshot.mode === "demo"
                        ? "Simulated evidence refreshed. No live deployment was queried."
                        : "Fresh production verification requested. Publication remains guarded.",
                    )
                  }
                >
                  {snapshot.mode === "demo"
                    ? "Simulate evidence refresh"
                    : "Verify current production again"}
                </button>
              </div>
            )}
        </section>
      </div>
      <section className="panel">
        <h2>Approvals</h2>
        <p className="muted">
          Slack is the canonical approval surface. Approval binds the exact case
          scope, candidate, persona, and reply version.
        </p>
        {engineer &&
          !record.canceledAt &&
          record.phase === "AWAITING_BUILD" && (
            <div className="subpanel">
              <p className="small muted">
                If the Build request expired or was revoked, request a fresh
                decision for the current scope.
              </p>
              <button
                className="secondary"
                disabled={
                  busy ||
                  snapshot.workspace.paused ||
                  record.approvals.some(
                    (approval) =>
                      approval.kind === "build" &&
                      approval.status === "pending" &&
                      !requestExpired(approval),
                  )
                }
                onClick={() =>
                  void act(
                    "request_build",
                    { caseId: record.id },
                    snapshot.mode === "demo"
                      ? "Fresh simulated Build request created. Engineer approval is still required."
                      : "Fresh Build approval requested in Slack. No build is authorized yet.",
                  )
                }
              >
                Request fresh Build approval
              </button>
            </div>
          )}
        {record.approvals.length === 0 && (
          <Empty>No approval requests yet.</Empty>
        )}
        {record.approvals.map((approval) => (
          <article className="subpanel" key={approval.id}>
            <div className="section-header compact">
              <h3>{humanize(approval.kind)}</h3>
              <Status value={approval.status} />
              {requestExpired(approval) && <Badge>Request expired</Badge>}
            </div>
            <p className="small">Required role: {approval.role}</p>
            {approval.candidateHash && (
              <p className="small">
                Binding <code>{approval.candidateHash}</code>
              </p>
            )}
            {approval.replyText && (
              <blockquote className="source-text">
                {approval.replyText}
              </blockquote>
            )}
            <ExternalLink href={approval.slackUrl}>
              Open current Slack approval
            </ExternalLink>
            {snapshot.mode === "demo" &&
              !record.canceledAt &&
              !requestExpired(approval) &&
              ["pending", "requested", "awaiting"].includes(approval.status) &&
              snapshot.actor.roles.includes(
                approval.role as "engineer" | "marketer" | "admin",
              ) && (
                <div className="notice demo">
                  <p>Simulated Slack decision · {snapshot.actor.name}</p>
                  <div className="button-row">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(
                          "demo_decide",
                          {
                            caseId: record.id,
                            approvalId: approval.id,
                            decision: "approved",
                          },
                          "Simulated approval recorded.",
                        )
                      }
                    >
                      Simulate{" "}
                      {approval.kind.toLowerCase().includes("build")
                        ? "Build"
                        : approval.kind.toLowerCase().includes("go")
                          ? "Go"
                          : "approval"}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          "demo_decide",
                          {
                            caseId: record.id,
                            approvalId: approval.id,
                            decision: "declined",
                          },
                          "Simulated rejection recorded.",
                        )
                      }
                    >
                      Simulate rejection
                    </button>
                  </div>
                </div>
              )}
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Drafts & publication</h2>
        {record.publications.length ? (
          record.publications.map((publication) => (
            <PublicationCard
              key={`${publication.id}-${publication.version || 0}`}
              publication={publication}
              record={record}
              snapshot={snapshot}
              act={act}
              busy={busy}
            />
          ))
        ) : (
          <Empty>No customer reply has been drafted or sent.</Empty>
        )}
        {!marketer && (
          <p className="small muted">
            A marketer can edit drafts and record manual publication receipts.
          </p>
        )}
      </section>
      {(engineer || marketer) &&
        !record.canceledAt &&
        record.phase !== "COMPLETED" && (
          <section className="panel">
            <h2>Cancel case</h2>
            <p className="muted">
              Stop future automated work for this case. Work already dispatched
              cannot be reversed by cancellation and must be reconciled.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void act(
                  "cancel_case",
                  { caseId: record.id, reason: data.get("reason") },
                  "Case cancellation recorded. Review the recorded outcome and any unresolved effects.",
                );
              }}
            >
              <label>
                Case cancellation reason
                <textarea
                  name="reason"
                  required
                  rows={2}
                  minLength={8}
                  maxLength={2000}
                />
              </label>
              <button className="secondary" disabled={busy}>
                Cancel future case work
              </button>
            </form>
          </section>
        )}
      {(record.phase !== "COMPLETED" || (record.canceledAt && isUnknown)) &&
        canRecover && (
          <section className="panel">
            <h2>Review & recovery</h2>
            <p className="muted">
              Every recovery requires a reason. An unknown send must be
              reconciled before another send.
            </p>
            {(engineer || marketer) && !record.canceledAt && (
              <form
                className="subpanel"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void act(
                    "review_disposition",
                    {
                      caseId: record.id,
                      disposition: data.get("disposition"),
                      reason: data.get("reason"),
                    },
                    "Review disposition recorded.",
                  );
                }}
              >
                <div className="form-grid">
                  <label>
                    Review disposition
                    <select name="disposition">
                      <option value="needs_evidence">Needs evidence</option>
                      <option value="needs_review">Needs review</option>
                      <option value="resume">
                        Resubmit for current approval
                      </option>
                    </select>
                  </label>
                  <label>
                    Review reason
                    <input
                      name="reason"
                      required
                      minLength={8}
                      maxLength={2000}
                    />
                  </label>
                </div>
                <button type="submit" disabled={busy}>
                  Record review disposition
                </button>
              </form>
            )}
            {operations.length > 0 && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void act(
                    "recover",
                    {
                      caseId: record.id,
                      operation: selectedOperation,
                      reason: data.get("reason"),
                      ...(selectedOperation === "reconcile"
                        ? {
                            investigationOutcome: data.get(
                              "investigationOutcome",
                            ),
                            receiptUrl: data.get("receiptUrl"),
                            attested: data.get("attested") === "on",
                          }
                        : {}),
                    },
                    "Recovery request recorded; current prerequisites remain enforced.",
                  );
                }}
              >
                <div className="form-grid">
                  <label>
                    Recovery action
                    <select
                      value={selectedOperation}
                      onChange={(event) => setOperation(event.target.value)}
                    >
                      {operations.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Recovery reason
                    <input
                      name="reason"
                      required
                      minLength={8}
                      maxLength={2000}
                    />
                  </label>
                </div>
                {selectedOperation === "reconcile" && (
                  <div className="subpanel">
                    <h3>Publication investigation</h3>
                    <p className="muted">
                      Only verified evidence or an explicit human investigation
                      can release this frozen interaction. A missing response
                      does not prove the reply was not sent.
                    </p>
                    <label>
                      Investigation outcome
                      <select name="investigationOutcome">
                        <option value="unknown">
                          Still unknown — keep frozen
                        </option>
                        <option value="confirmed">Confirmed published</option>
                        <option value="definitely_not_sent">
                          Definitely not sent
                        </option>
                      </select>
                    </label>
                    <label>
                      Investigated receipt URL
                      <input type="url" name="receiptUrl" maxLength={2048} />
                    </label>
                    <label className="checkbox">
                      <input type="checkbox" name="attested" required />I attest
                      that the stated outcome follows an investigation of the
                      target account and interaction.
                    </label>
                  </div>
                )}
                {selectedOperation === "reconcile_release" && (
                  <p className="notice">
                    Reconcile the recorded merge and promotion against provider
                    state. A current exact Go remains required. This action is
                    available only for a failed or uncertain release and cannot
                    bypass repository drift.
                  </p>
                )}
                <button
                  type="submit"
                  disabled={
                    busy || (isUnknown && selectedOperation === "retry")
                  }
                >
                  Request recovery
                </button>
              </form>
            )}
            {snapshot.mode === "demo" &&
              !record.canceledAt &&
              ((engineer &&
                ["INVESTIGATING", "BUILDING", "RELEASING"].includes(
                  record.phase,
                )) ||
                (marketer &&
                  ["RELEASING", "READY_TO_PUBLISH"].includes(record.phase))) &&
              !isUnknown && (
                <div className="notice demo">
                  <p>
                    Exercise the next simulated workflow stage using guarded
                    fixture evidence.
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        "demo_advance",
                        { caseId: record.id },
                        "Simulated workflow stage processed.",
                      )
                    }
                  >
                    Advance demo workflow
                  </button>
                </div>
              )}
            {snapshot.mode === "demo" && admin && !record.canceledAt && (
              <form
                className="notice demo"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void act(
                    "demo_fault",
                    { caseId: record.id, fault: data.get("fault") },
                    "Simulated fault injected. No external provider was affected.",
                  );
                }}
              >
                <label>
                  Simulated failure scenario
                  <select name="fault">
                    <option value="checks_failed">Protected checks fail</option>
                    <option value="reconnect_required">
                      Social session requires reconnect
                    </option>
                    <option value="publication_unknown">
                      Publication outcome unknown
                    </option>
                  </select>
                </label>
                <button className="secondary" disabled={busy}>
                  Inject demo failure
                </button>
              </form>
            )}
          </section>
        )}
        </div>
      </details>
    </>
  );
}
