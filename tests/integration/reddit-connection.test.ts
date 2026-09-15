import { randomBytes } from "node:crypto";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { initialState } from "../../src/control/seed";
import { createTask } from "../../src/control/reducer";
import type { ControlState, RuntimeConfig } from "../../src/control/types";
import type { WorkerGrant } from "../../workers/shared/contracts";
import { encryptRedditCredential } from "../../workers/social/reddit-credentials";

const modules = {
  "../../convex/redditControl.ts": () => import("../../convex/redditControl"),
  "../../convex/workerControl.ts": () => import("../../convex/workerControl"),
  "../../convex/control.ts": () => import("../../convex/control"),
  "../../convex/_generated/server.js": () => import("../../convex/_generated/server.js"),
};
const reference = (name: string) => makeFunctionReference<"mutation", Record<string, unknown>, unknown>(name);
const config: RuntimeConfig = { mode: "live", repository: "owned/weather", baseSha: "a".repeat(40), openaiConfigured: false, accessConfigured: true, convexConfigured: true, slackConfigured: false, linearConfigured: false, githubConfigured: false, vercelConfigured: false, workerConfigured: true, redditConfigured: true };
const serviceKey = "test-only-control-service-secret-with-32-bytes", browserHash = "a".repeat(64);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); vi.stubEnv("CONTROL_SERVICE_SECRET", serviceKey); vi.stubEnv("REDDIT_API_APPROVED", "true"); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function fixture() {
  const t = convexTest(schema, modules), state = initialState(config);
  const reddit = state.connections.find(item => item.platform === "reddit")!;
  reddit.account = "drizzle-123"; reddit.status = "reconnect_required"; reddit.permission = "unverified";
  await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state: JSON.parse(JSON.stringify(state)) }));
  const read = () => t.run(async ctx => (await ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique())!.state as ControlState);
  const mutate = (change: (state: ControlState) => void) => t.run(async ctx => { const row = (await ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique())!; change(row.state); await ctx.db.patch(row._id, { state: JSON.parse(JSON.stringify(row.state)) }); });
  const create = (accountId = "drizzle-123", key = serviceKey) => t.mutation(reference("redditControl:create"), { accountId, serviceKey: key }) as Promise<WorkerGrant>;
  const call = (path: string, data: Record<string, unknown>) => t.mutation(reference("redditControl:callback"), { path, data });
  const grant = await create();
  const encrypted = encryptRedditCredential({ refreshToken: "test-only-private-refresh", clientId: "test-client", allowedSubreddits: ["weatherdemo"] }, grant, randomBytes(32).toString("base64"), "v1");
  const start = () => call("start", { state: grant.jti, grant, browserHash });
  const claim = (hash = browserHash) => call("claim", { state: grant.jti, browserHash: hash });
  const activate = (extra: Record<string, unknown> = {}) => call("activate", { state: grant.jti, verifiedAccountId: grant.accountId, encrypted, allowedSubreddits: ["weatherdemo"], ...extra });
  return { t, grant, encrypted, read, mutate, create, call, start, claim, activate };
}
describe("Reddit account/version OAuth readiness", () => {
  it("requires operator authorization, explicit API approval, and the configured account", async () => {
    const f = await fixture();
    await expect(f.create("drizzle-123", "wrong-service-key-long-enough-to-check")).rejects.toThrow("unauthorized");
    await expect(f.create("other-account")).rejects.toThrow("configure_account_first");
    vi.stubEnv("REDDIT_API_APPROVED", "false"); await expect(f.create()).rejects.toThrow("reddit_access_pending");
    expect((await f.read()).connections.find(item => item.platform === "reddit")!.permission).toBe("unverified");
  });
  it("requires one-use state and the correct browser proof before accepting verified credentials", async () => {
    const f = await fixture();
    await expect(f.activate()).rejects.toThrow("reddit_state_consumed");
    await f.start(); await expect(f.start()).rejects.toThrow("reddit_state_consumed");
    await expect(f.claim("b".repeat(64))).rejects.toThrow("reddit_state_or_browser_mismatch");
    expect(await f.claim()).toMatchObject({ grant: f.grant });
    await expect(f.claim()).rejects.toThrow("reddit_state_or_browser_mismatch");
    expect(await f.activate()).toEqual({ activated: true }); await expect(f.activate()).rejects.toThrow("reddit_state_consumed");
    const state = await f.read(), connection = state.connections.find(item => item.platform === "reddit")!;
    expect(connection).toMatchObject({ account: "drizzle-123", status: "ready", permission: "granted", version: f.grant.connectionVersion, cursor: String(Date.now()) });
    expect(JSON.stringify(state)).not.toMatch(/test-only-private-refresh|ciphertext|browserHash/);
    const credential = await f.t.run(ctx => ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", "reddit")).unique());
    expect(credential?.encrypted).toEqual(f.encrypted); expect(JSON.stringify(credential)).not.toContain("test-only-private-refresh");
  });
  it.each(["account", "version", "disabled", "expired", "approval"])("rejects activation when %s changes after OAuth begins", async field => {
    const f = await fixture(); await f.start(); await f.claim();
    if (field === "account") await f.mutate(state => { state.connections.find(item => item.platform === "reddit")!.account = "other-account"; });
    if (field === "version") await f.mutate(state => { state.connections.find(item => item.platform === "reddit")!.version++; });
    if (field === "disabled") await f.mutate(state => { state.connections.find(item => item.platform === "reddit")!.status = "disabled"; });
    if (field === "expired") vi.advanceTimersByTime(300_001);
    if (field === "approval") vi.stubEnv("REDDIT_API_APPROVED", "false");
    await expect(f.activate()).rejects.toThrow();
    expect(await f.t.run(ctx => ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", "reddit")).unique())).toBeNull();
  });
  it("rejects verified-account mismatch, credential substitution, and an empty allowlist", async () => {
    const f = await fixture(); await f.start(); await f.claim();
    await expect(f.activate({ verifiedAccountId: "wrong-account" })).rejects.toThrow("reddit_account_mismatch");
    await expect(f.activate({ encrypted: { ...f.encrypted, connectionVersion: f.grant.connectionVersion + 1 } })).rejects.toThrow("reddit_credential_binding_mismatch");
    await expect(f.activate({ allowedSubreddits: [] })).rejects.toThrow();
    expect((await f.read()).connections.find(item => item.platform === "reddit")!.status).not.toBe("ready");
  });
  it("a new authorization invalidates old state and removes the old credential", async () => {
    const f = await fixture(); await f.start(); await f.claim(); await f.activate();
    const next = await f.create("u/Drizzle-123"); expect(next.connectionVersion).toBe(f.grant.connectionVersion + 1);
    await expect(f.activate()).rejects.toThrow("reddit_state_invalid");
    expect(await f.t.run(ctx => ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", "reddit")).unique())).toBeNull();
  });
  it("reset/disable removes private credentials and pending authorization state", async () => {
    const f = await fixture(); await f.start(); await f.claim(); await f.activate();
    await f.t.mutation(reference("control:dispatch"), { command: { action: "connection_disable", connectionId: "reddit" }, serviceKey });
    expect(await f.t.run(ctx => ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", "reddit")).unique())).toBeNull();
    expect(await f.t.run(ctx => ctx.db.query("redditOAuthStates").withIndex("by_connection", q => q.eq("connectionId", "reddit")).unique())).toBeNull();
  });
});

async function ingestionFixture() {
  const f = await fixture(); await f.start(); await f.claim(); await f.activate();
  const previous = Date.now(); vi.advanceTimersByTime(5 * 60_000);
  let taskId = "", attemptId = "", inputRevision = 0;
  await f.mutate(state => { const task = createTask(state, "ingest_social", undefined, { connectionId: "reddit" }, Date.now()); const saved = state.tasks.find(item => item.id === task.id)!; saved.status = "running"; saved.dispatchedAt = Date.now(); taskId = task.id; attemptId = task.attemptId; inputRevision = task.inputRevision; });
  const grant = await f.t.mutation(reference("workerControl:createSocial"), { taskId, attemptId }) as WorkerGrant;
  const claim = await f.t.mutation(reference("workerControl:callback"), { path: "claim", data: { grant, jobId: taskId, attemptId } }) as { leaseId: string; redditCredential: unknown };
  const result = { schemaVersion: 1, jobId: taskId, attemptId, inputRevision, status: "succeeded", completedAt: Date.now(), output: { mode: "live", cursorCommitRequired: true, nextCursor: String(Date.now() - 5000), items: [{ platform: "reddit", sourceMode: "live", externalId: "t1_reply", originalUrl: "https://www.reddit.com/r/weatherdemo/comments/post/title/reply/", author: "customer", text: "u/drizzle-123 love the weather", subreddit: "weatherdemo", observedAt: Date.now() - 10_000 }] } };
  const complete = (value: unknown = result) => f.t.mutation(reference("workerControl:callback"), { path: "result", data: { grant, leaseId: claim.leaseId, result: value } });
  return { ...f, previous, jobGrant: grant, jobClaim: claim, result, complete };
}
describe("Reddit ingestion commits", () => {
  it("claims only current account-bound ciphertext and atomically stores signals before advancing the cursor", async () => {
    const f = await ingestionFixture(); expect(f.jobClaim.redditCredential).toEqual(f.encrypted);
    await f.complete(); const state = await f.read();
    expect(state.cases).toHaveLength(1); expect(state.cases[0]).toMatchObject({ sourcePlatform: "reddit", sourceMode: "live" });
    expect(state.connections.find(item => item.platform === "reddit")!.cursor).toBe(f.result.output.nextCursor);
    await f.complete(); expect((await f.read()).cases).toHaveLength(1);
  });
  it.each(["community", "cursor", "source", "time", "approval", "version"])("does not advance or persist when %s validation fails", async mismatch => {
    const f = await ingestionFixture(), value = structuredClone(f.result);
    if (mismatch === "community") { value.output.items[0].subreddit = "unapproved"; value.output.items[0].originalUrl = "https://www.reddit.com/r/unapproved/comments/post/title/reply/"; }
    if (mismatch === "cursor") value.output.nextCursor = String(f.previous - 1);
    if (mismatch === "source") value.output.items[0].externalId = "t1_other";
    if (mismatch === "time") value.output.items[0].observedAt = f.previous - 1;
    if (mismatch === "approval") vi.stubEnv("REDDIT_API_APPROVED", "false");
    if (mismatch === "version") await f.mutate(state => { state.connections.find(item => item.platform === "reddit")!.version++; });
    if (mismatch === "version") expect(await f.complete(value)).toEqual({ received: true });
    else await expect(f.complete(value)).rejects.toThrow();
    const state = await f.read(); expect(state.cases).toHaveLength(0); expect(state.connections.find(item => item.platform === "reddit")!.cursor).toBe(String(f.previous));
  });
});
