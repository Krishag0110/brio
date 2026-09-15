import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import { initialState } from "../../src/control/seed";
import { seedWorkspace } from "../../src/control/workspace-seed";
import { applyCommand } from "../../src/control/reducer";
import { DEMO_STEPS } from "../../src/control/demo-run";
import type { ControlState, RuntimeConfig } from "../../src/control/types";
import type { Snapshot } from "../../src/shared/control-contract";

const modules = {
  "../../convex/demoControl.ts": () => import("../../convex/demoControl"),
  "../../convex/_generated/server.js": () => import("../../convex/_generated/server.js"),
};
const serviceKey = "test-hosted-demo-control-service-secret-32-bytes";
const config: RuntimeConfig = { mode: "demo", repository: "owned/weather", baseSha: "base-v1", openaiConfigured: false, accessConfigured: true, convexConfigured: true, slackConfigured: false, linearConfigured: false, githubConfigured: false, vercelConfigured: false, workerConfigured: false, redditConfigured: false };
const query = makeFunctionReference<"query", { serviceKey: string }, Snapshot>("demoControl:getSnapshot");
const seed = makeFunctionReference<"mutation", { serviceKey: string; state?: ControlState }, Snapshot>("demoControl:seed");
const dispatch = makeFunctionReference<"mutation", { serviceKey: string; command: { action: string } & Record<string, unknown> }, Snapshot>("demoControl:dispatch");
const tick = makeFunctionReference<"mutation", { runId: string; stepIndex: number; nextAt: number; timerVersion: number }, null>("demoControl:tick");
const setup = () => convexTest(schema, modules);
type Test = ReturnType<typeof setup>;
const row = (t: Test) => t.run(ctx => ctx.db.query("demoControlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique());
const command = (t: Test, action: string, fields: Record<string, unknown> = {}) => t.mutation(dispatch, { serviceKey, command: { action, ...fields } });
const importedState = () => seedWorkspace(initialState(config), Date.now()).state;
const expectedTick = async (t: Test) => { const saved = (await row(t))!; return { ...saved.scheduledTick!, timerVersion: saved.timerVersion }; };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); vi.stubEnv("CONTROL_SERVICE_SECRET", serviceKey); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("isolated hosted demo controller", () => {
  it("authenticates all public entry points before accessing or creating state", async () => {
    const t = convexTest(schema, modules), wrong = "wrong-hosted-demo-service-key-with-32-bytes";
    await expect(t.query(query, { serviceKey: wrong })).rejects.toThrow("unauthorized");
    await expect(t.mutation(seed, { serviceKey: wrong })).rejects.toThrow("unauthorized");
    await expect(t.mutation(dispatch, { serviceKey: wrong, command: { action: "demo_start" } })).rejects.toThrow("unauthorized");
    vi.stubEnv("CONTROL_SERVICE_SECRET", "");
    await expect(t.query(query, { serviceKey })).rejects.toThrow("unauthorized");
    expect(await row(t)).toBeNull();
  });

  it("keeps reads side-effect free, including when an existing run is due", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(query, { serviceKey })).toMatchObject({ mode: "demo", cases: [] });
    expect(await row(t)).toBeNull();
    const started = await command(t, "demo_start"), before = await row(t);
    vi.setSystemTime(started.demoRun!.nextAt! + 10_000);
    expect((await t.query(query, { serviceKey })).demoRun!.stepIndex).toBe(1);
    expect(await row(t)).toEqual(before);
  });

  it("seeds the default fixture workspace once and preserves the live aggregate exactly", async () => {
    const t = convexTest(schema, modules), live = initialState({ ...config, mode: "live" });
    await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state: live }));
    const before = await t.run(ctx => ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique());
    const first = await t.mutation(seed, { serviceKey }), saved = await row(t);
    expect(first.cases.length).toBe(importedState().cases.length);
    expect(first.cases.every(c => c.sourceMode === "fixture")).toBe(true);
    expect(await t.mutation(seed, { serviceKey, state: initialState(config) })).toEqual(first);
    expect(await row(t)).toEqual(saved);
    expect(await t.run(ctx => ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique())).toEqual(before);
    expect(await t.run(ctx => ctx.db.query("auditEvents").collect())).toEqual([]);
  });

  it("imports existing cases and history exactly, pausing active playback without overwriting on repeat", async () => {
    const t = convexTest(schema, modules);
    const local = applyCommand(importedState(), { action: "demo_start" }, { id: "demo-marketer", name: "Demo marketer", roles: ["marketer"] }, config);
    local.demoRole = "engineer";
    const result = await t.mutation(seed, { serviceKey, state: local }), saved = (await row(t))!;
    expect(saved.state).toEqual({ ...local, demoRun: { ...local.demoRun, status: "paused", nextAt: null, updatedAt: Date.now(), stopReason: "imported_demo_paused" } });
    expect(result.actor).toEqual({ id: "demo-engineer", name: "Demo engineer", roles: ["engineer"] });
    expect(result.cases.map(c => c.id)).toEqual(local.cases.map(c => c.id));
    expect(saved.scheduledTick).toBeUndefined();
    expect(await t.mutation(seed, { serviceKey, state: importedState() })).toEqual(result);
    expect(await row(t)).toEqual(saved);
  });

  it.each(["mode", "case", "signal", "publication", "task", "workflow", "role"])("rejects imports with a nonfixture %s boundary", async field => {
    const t = convexTest(schema, modules), input = importedState();
    if (field === "mode") input.mode = "live";
    if (field === "case") input.cases[0].sourceMode = "manual";
    if (field === "signal") input.cases[0].signals[0].sourceMode = "live";
    if (field === "publication") input.cases.find(c => c.publications.length)!.publications[0].mode = "live";
    if (field === "task") input.tasks.push({ id: "job", kind: "publish_reply", status: "pending", payload: {}, attemptId: "attempt", inputRevision: 1, createdAt: Date.now() });
    if (field === "workflow") input.cases[0].workflowId = "live-workflow";
    if (field === "role") Object.assign(input, { demoRole: "operator" });
    await expect(t.mutation(seed, { serviceKey, state: input })).rejects.toThrow("demo_fixture_state_required");
    expect(await row(t)).toBeNull();
  });

  it("rejects oversize imports without persisting a partial row", async () => {
    const t = convexTest(schema, modules), input = importedState();
    input.cases[0].text = "x".repeat(700_001);
    await expect(t.mutation(seed, { serviceKey, state: input })).rejects.toThrow("demo_workspace_capacity_exceeded");
    expect(await row(t)).toBeNull();
  });

  it("derives role from stored demo state and refuses nonfixture intake and forged internal commands", async () => {
    const t = convexTest(schema, modules);
    const changed = await command(t, "demo_role", { role: "engineer", actor: { id: "forged", roles: ["admin"] } });
    expect(changed.actor).toMatchObject({ id: "demo-engineer", roles: ["engineer"] });
    const saved = await row(t);
    await expect(command(t, "pause", { paused: true, reason: "Forged admin role", actor: { roles: ["admin"] } })).rejects.toThrow("forbidden");
    await expect(command(t, "internal_demo_step")).rejects.toThrow("forbidden");
    await expect(command(t, "intake", { mode: "manual", platform: "x", text: "The weather conversion is broken" })).rejects.toThrow("demo_fixture_state_required");
    expect(await row(t)).toEqual(saved);
  });

  it("runs every scheduled phase through a fixture receipt without live jobs, grants, sessions, or provider calls", async () => {
    const t = convexTest(schema, modules), fetch = vi.fn(() => { throw new Error("unexpected_provider_call"); });
    vi.stubGlobal("fetch", fetch);
    const live = initialState({ ...config, mode: "live" });
    await t.run(ctx => ctx.db.insert("controlStates", { workspaceId: "fde", state: live }));
    const liveBefore = await t.run(ctx => ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique());
    const start = await command(t, "demo_start"), phases = [start.cases[0].phase];
    for (let step = 2; step <= DEMO_STEPS.length; step++) {
      vi.advanceTimersByTime(2000); await t.finishInProgressScheduledFunctions();
      const current = await t.query(query, { serviceKey });
      expect(current.demoRun!.stepIndex).toBe(step); phases.push(current.cases[0].phase);
    }
    const finished = await t.query(query, { serviceKey });
    expect(phases).toEqual(DEMO_STEPS.map(step => step.phase));
    expect(finished.demoRun!.status).toBe("completed");
    expect(finished.cases[0].communicationStatus).toBe("simulated_confirmed");
    expect(finished.cases[0].publications[0]).toMatchObject({ mode: "fixture", status: "confirmed" });
    expect(finished.cases[0].publications[0].receiptUrl).toMatch(/^https:\/\/example\.invalid\/simulated\//);
    expect(finished.cases[0].approvals.every(a => a.simulated)).toBe(true);
    expect((await row(t))!.state.tasks).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("controlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique())).toEqual(liveBefore);
    for (const table of ["auditEvents", "workerGrants", "workerLeases", "socialSessions", "redditOAuthStates", "redditCredentials", "releaseLocks"] as const) {
      expect(await t.run(ctx => ctx.db.query(table).collect())).toEqual([]);
    }
    const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.length).toBe(DEMO_STEPS.length - 1);
    expect(scheduled.every(job => job.name === "demoControl:tick")).toBe(true);
    expect(JSON.stringify(scheduled)).not.toContain(serviceKey);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects stale and duplicate timers across same-millisecond pause/resume and restart", async () => {
    const t = convexTest(schema, modules);
    await command(t, "demo_start"); const old = await expectedTick(t);
    await command(t, "demo_pause"); await command(t, "demo_resume"); const resumed = await expectedTick(t);
    expect(resumed.nextAt).toBe(old.nextAt); expect(resumed.timerVersion).not.toBe(old.timerVersion);
    vi.setSystemTime(old.nextAt);
    await t.mutation(tick, old); expect((await row(t))!.state.demoRun.stepIndex).toBe(1);
    await t.mutation(tick, resumed); expect((await row(t))!.state.demoRun.stepIndex).toBe(2);
    await t.mutation(tick, resumed); expect((await row(t))!.state.demoRun.stepIndex).toBe(2);
    const previousRun = await expectedTick(t);
    await command(t, "demo_restart", { runId: previousRun.runId });
    vi.setSystemTime(previousRun.nextAt + 10_000);
    await t.mutation(tick, previousRun); expect((await row(t))!.state.demoRun.stepIndex).toBe(1);
    expect((await row(t))!.state.demoRun.runId).not.toBe(previousRun.runId);
  });

  it("invalidates timers on workspace pause and resumes only after a fresh interval", async () => {
    const t = convexTest(schema, modules);
    await command(t, "demo_start"); const old = await expectedTick(t);
    await command(t, "pause", { paused: true, reason: "Pause hosted demo" });
    vi.setSystemTime(old.nextAt + 10_000); await t.mutation(tick, old);
    expect((await row(t))!.state.demoRun.stepIndex).toBe(1);
    const resumedAt = Date.now(); await command(t, "pause", { paused: false, reason: "Resume hosted demo" });
    const resumed = await expectedTick(t); expect(resumed.nextAt).toBe(resumedAt + 2000);
    await t.mutation(tick, old); expect((await row(t))!.state.demoRun.stepIndex).toBe(1);
    await t.mutation(tick, resumed); expect((await row(t))!.state.demoRun.stepIndex).toBe(1);
    vi.setSystemTime(resumed.nextAt); await t.mutation(tick, resumed);
    expect((await row(t))!.state.demoRun.stepIndex).toBe(2);
  });
});
