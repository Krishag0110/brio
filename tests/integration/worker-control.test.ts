import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { initialState } from "../../src/control/seed";
import { applyCommand, createTask } from "../../src/control/reducer";
import type { ControlState, RuntimeConfig } from "../../src/control/types";
import type { WorkerGrant } from "../../workers/shared/contracts";
import { hashText } from "../../src/core/domain";
import { writeState } from "../../convex/state";

const modules = { "../../convex/workerControl.ts": () => import("../../convex/workerControl"), "../../convex/_generated/server.js": () => import("../../convex/_generated/server.js") };
const ref = (name: string) => makeFunctionReference<"mutation", Record<string, unknown>, unknown>(`workerControl:${name}`);
const config: RuntimeConfig = { mode: "demo", repository: "owned/weather", baseSha: "a".repeat(40), openaiConfigured: false, accessConfigured: false, convexConfigured: false, slackConfigured: false, linearConfigured: false, githubConfigured: false, vercelConfigured: false, workerConfigured: false, redditConfigured: false };
const marketer = { id: "marketer", name: "Marketer", roles: ["marketer" as const] };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function fixture(kind = "publish_reply") {
  const now = Date.now() - 1000;
  let state = initialState(config);
  state.connections[0] = { ...state.connections[0], account: "brand", status: "ready", permission: "granted" };
  if (kind !== "ingest_social") {
    state = applyCommand(state, { action: "intake", mode: "fixture", platform: "x", sourceUrl: "https://x.com/customer/status/123", text: "Love the weather app" }, marketer, config, now);
    state = applyCommand(state, { action: "request_reply_approval", caseId: state.cases[0].id, publicationId: state.cases[0].publications[0].id }, marketer, config, now + 1);
    state = applyCommand(state, { action: "demo_decide", approvalId: state.authorities.at(-1)!.request.requestId, decision: "approved" }, marketer, config, now + 2);
  }
  const task = createTask(state, kind, kind === "ingest_social" ? undefined : state.cases[0].id, kind === "ingest_social" ? { connectionId: "x" } : { publicationId: state.cases[0].publications[0].id }, now + 3);
  const saved = state.tasks.find(t => t.id === task.id)!; saved.status = "running"; saved.dispatchedAt = now + 3;
  const t = convexTest(schema, modules);
  await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state: JSON.parse(JSON.stringify(state)) }));
  const mutate = async (change: (state: ControlState) => void) => t.run(async ctx => { const row = (await ctx.db.query("controlStates").collect())[0], current = row.state as ControlState; change(current); await ctx.db.patch(row._id, { state: JSON.parse(JSON.stringify(current)) }); });
  const read = () => t.run(async ctx => (await ctx.db.query("controlStates").first())!.state as ControlState);
  const grant = await t.mutation(ref("createSocial"), { taskId: task.id, attemptId: task.attemptId }) as WorkerGrant;
  const claim = () => t.mutation(ref("callback"), { path: "claim", data: { grant, jobId: task.id, attemptId: task.attemptId } }) as Promise<{ leaseId: string }>;
  return { t, task, state, grant, claim, mutate, read };
}
function confirmed(f: Awaited<ReturnType<typeof fixture>>, textHash: string) {
  return { schemaVersion: 1, jobId: f.task.id, attemptId: f.task.attemptId, inputRevision: f.task.inputRevision, status: "succeeded", completedAt: Date.now(), output: { status: "confirmed", mode: "fixture", completedAt: Date.now(), providerReceipt: { id: "fixture:confirmed", url: "fixture://publication/confirmed", accountId: "brand", targetId: "123", textHash } } };
}
describe("Convex social authority and atomic dispatch", () => {
  it("rejects forged/unissued grants, wrong lease and duplicate claims", async () => {
    const f = await fixture();
    await expect(f.t.mutation(ref("callback"), { path: "claim", data: { grant: { ...f.grant, accountId: "other" }, jobId: f.task.id, attemptId: f.task.attemptId } })).rejects.toThrow("grant_not_issued");
    const { leaseId } = await f.claim(); expect(leaseId).toBeTruthy(); await expect(f.claim()).rejects.toThrow("claim_denied");
    await expect(f.t.mutation(ref("callback"), { path: "heartbeat", data: { grant: f.grant, leaseId: "wrong" } })).rejects.toThrow("lease_mismatch");
  });
  it("rechecks opt-out immediately before dispatch and never consumes send authority on denial", async () => {
    const f = await fixture(), { leaseId } = await f.claim();
    await f.mutate(s => { s.suppressions.push({ id: "optout", platform: "x", author: "customer", reason: "Customer opted out" }); });
    await expect(f.t.mutation(ref("callback"), { path: "authorize-send", data: { grant: f.grant, leaseId, publicationId: f.state.cases[0].publications[0].id } })).rejects.toThrow("opt_out");
    const lease = await f.t.run(ctx => ctx.db.query("workerLeases").first()); expect(lease!.sendAuthorized).toBe(false);
  });
  it("uses 60-second leases bounded by a120-second job grant", async () => {
    const f = await fixture(), before = Date.now(); await f.claim();
    const lease = await f.t.run(ctx => ctx.db.query("workerLeases").first()); expect(lease!.expiresAt - before).toBeLessThanOrEqual(60_100); expect(f.grant.exp - before).toBeLessThanOrEqual(120_100);
  });
  it("serializes read and send jobs on the same account until the first lease completes", async () => {
    const f = await fixture(); await f.claim(); let secondId = "", secondAttempt = "";
    await f.mutate(state => { const task = createTask(state, "ingest_social", undefined, { connectionId: "x" }, Date.now()); const saved = state.tasks.find(item => item.id === task.id)!; saved.status = "running"; secondId = task.id; secondAttempt = task.attemptId; });
    const grant = await f.t.mutation(ref("createSocial"), { taskId: secondId, attemptId: secondAttempt }) as WorkerGrant;
    await expect(f.t.mutation(ref("callback"), { path: "claim", data: { grant, jobId: secondId, attemptId: secondAttempt } })).rejects.toThrow("account_job_already_running");
    vi.advanceTimersByTime(60_001);
    expect(await f.t.mutation(ref("callback"), { path: "claim", data: { grant, jobId: secondId, attemptId: secondAttempt } })).toHaveProperty("leaseId");
  });
  it("requires dispatch authority before accepting a receipt and acknowledges exact callback duplicates", async () => {
    const f = await fixture(), { leaseId } = await f.claim(), pub = f.state.cases[0].publications[0], result = confirmed(f, pub.textHash);
    await expect(f.t.mutation(ref("callback"), { path: "result", data: { grant: f.grant, leaseId, result } })).rejects.toThrow("send_was_not_authorized");
    await f.t.mutation(ref("callback"), { path: "authorize-send", data: { grant: f.grant, leaseId, publicationId: pub.id } });
    await f.t.mutation(ref("callback"), { path: "result", data: { grant: f.grant, leaseId, result } });
    expect((await f.read()).cases[0].publications[0].status).toBe("confirmed");
    expect(await f.t.mutation(ref("callback"), { path: "result", data: { grant: f.grant, leaseId, result } })).toEqual({ duplicate: true });
  });
  it("retains uncertain send, then accepts a later exact confirmed receipt without a second send", async () => {
    const f = await fixture(), { leaseId } = await f.claim(), pub = f.state.cases[0].publications[0];
    await f.t.mutation(ref("callback"), { path: "authorize-send", data: { grant: f.grant, leaseId, publicationId: pub.id } });
    await f.t.mutation(ref("callback"), { path: "result", data: { grant: f.grant, leaseId, result: { schemaVersion: 1, jobId: f.task.id, attemptId: f.task.attemptId, inputRevision: f.task.inputRevision, status: "unknown", completedAt: Date.now() } } });
    expect((await f.read()).cases[0].publications[0].status).toBe("unknown");
    await f.t.mutation(ref("callback"), { path: "result", data: { grant: f.grant, leaseId, result: confirmed(f, pub.textHash) } });
    expect((await f.read()).cases[0].publications[0].status).toBe("confirmed");
  });
});
describe("account-scoped intake cursor and encrypted reconnect safety", () => {
  it("persists immutable audit events independently of the trimmed workspace view", async () => {
    const f = await fixture(), state = await f.read(), event = { id: "durable-event", at: new Date().toISOString(), actor: "Engineer", role: "engineer", action: "recovery", detail: "Recorded operator investigation" };
    state.audit.push(event); await f.t.run(ctx => writeState(ctx, state));
    state.audit = []; await f.t.run(ctx => writeState(ctx, state));
    const saved = await f.t.run(ctx => ctx.db.query("auditEvents").withIndex("by_workspace_event", q => q.eq("workspaceId", "fde").eq("eventId", event.id)).unique()); expect(saved?.detail).toBe(event.detail);
    state.audit = [{ ...event, detail: "Altered history" }]; await expect(f.t.run(ctx => writeState(ctx, state))).rejects.toThrow("audit_event_immutable");
  });
  it("commits the cursor only after normalized live signals persist and replay is idempotent", async () => {
    const f = await fixture("ingest_social"), { leaseId } = await f.claim();
    const result = { schemaVersion: 1, jobId: f.task.id, attemptId: f.task.attemptId, inputRevision: f.task.inputRevision, status: "succeeded", completedAt: Date.now(), output: { mode: "live", cursorCommitRequired: true, nextCursor: "123", items: [{ platform: "x", sourceMode: "live", externalId: "123", originalUrl: "https://x.com/customer/status/123", author: "customer", text: "@brand love the weather", observedAt: Date.now() }] } };
    await f.t.mutation(ref("callback"), { path: "result", data: { grant: f.grant, leaseId, result } });
    const state = await f.read(); expect(state.cases).toHaveLength(1); expect(state.cases[0].sourceMode).toBe("live"); expect(state.connections[0].cursor).toBe("123");
    await f.t.mutation(ref("callback"), { path: "result", data: { grant: f.grant, leaseId, result } }); expect((await f.read()).cases).toHaveLength(1);
  });
  it("a rejected replacement session never downgrades the working session", async () => {
    const f = await fixture(); const grant: WorkerGrant = { ...f.grant, jti: "replacement-session-grant", operation: "session_import", jobId: undefined, attemptId: undefined };
    delete grant.jobId; delete grant.attemptId;
    const enc = { algorithm: "AES-256-GCM" as const, keyVersion: "1", nonce: "nonce", ciphertext: "ciphertext", tag: "tag", workspaceId: grant.workspaceId, accountId: grant.accountId, connectionId: grant.connectionId, connectionVersion: grant.connectionVersion };
    await f.t.run(async ctx => { await ctx.db.insert("workerGrants", { jti: grant.jti, grant, consumed: false }); await ctx.db.insert("socialSessions", { connectionId: "x", connectionVersion: 1, status: "active", grantJti: "old", encrypted: enc, createdAt: Date.now() }); });
    const pending = await f.t.mutation(ref("callback"), { path: "session/quarantine", data: { grant, encryptedSession: enc } }) as { pendingId: string };
    expect(await f.t.mutation(ref("callback"), { path: "session/activate", data: { grant, pendingId: pending.pendingId, verifiedAccountId: "wrong-account" } })).toMatchObject({ activated: false, rejected: true });
    expect((await f.read()).connections[0].status).toBe("ready"); const sessions = await f.t.run(ctx => ctx.db.query("socialSessions").collect()); expect(sessions).toHaveLength(1); expect(sessions[0].status).toBe("active");
    expect(hashText("private credentials")).toHaveLength(64);
  });
});
