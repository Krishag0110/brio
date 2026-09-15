import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { advanceDemoRun, DEMO_STEPS, DEMO_STEP_INTERVAL_MS } from "../../src/control/demo-run";
import { applyCommand, snapshot } from "../../src/control/reducer";
import { initialState } from "../../src/control/seed";
import { withLocalState } from "../../src/server/persistence";
import type { Actor, ControlState, RuntimeConfig } from "../../src/control/types";

const NOW = 1_800_000_000_000;
const config: RuntimeConfig = { mode: "demo", repository: "owned/weather", baseSha: "base-v1", openaiConfigured: false, accessConfigured: false, convexConfigured: false, slackConfigured: false, linearConfigured: false, githubConfigured: false, vercelConfigured: false, workerConfigured: false, redditConfigured: false };
const operator: Actor = { id: "demo-marketer", name: "Demo marketer", roles: ["marketer"] };
const command = (state: ControlState, action: string, now = NOW, payload = {}) => applyCommand(state, { action, ...payload }, operator, config, now);
const start = () => command(initialState(config), "demo_start");
const tick = (state: ControlState) => advanceDemoRun(state, config, state.demoRun!.nextAt!);
const toStep = (target: number) => { let state = start(); while (state.demoRun!.stepIndex < target && state.demoRun!.status === "running") state = tick(state); return state; };

describe("persistent simulated demo run", () => {
  it("exposes every ordered phase on one case, with protected approvals before build/release and verification before receipt", () => {
    let state = start(); const id = state.demoRun!.caseId, phases = [state.cases[0].phase];
    expect(state.demoRun).toMatchObject({ stepIndex: 1, totalSteps: 13, nextAt: NOW + 2000 });
    expect(state.cases[0]).toMatchObject({ title: "[SIMULATED DEMO] Weather conversion: 20°C → 20°F", sourceMode: "fixture", route: "engineering_resolution", phase: "RECEIVED", productionVerified: false });
    for (let step = 2; step <= DEMO_STEPS.length; step++) {
      state = tick(state); const c = state.cases[0];
      expect(state.demoRun!.status, state.demoRun!.stopReason).toBe(step === DEMO_STEPS.length ? "completed" : "running");
      expect(state.demoRun!.stepIndex).toBe(step); expect(state.cases).toHaveLength(1); expect(c.id).toBe(id);
      phases.push(c.phase);
      if (step === 4) expect(state.authorities[0].request).toMatchObject({ kind: "build", status: "pending" });
      if (step === 5) expect(state.authorities[0].request.decisionActor?.userId).toBe("simulated-demo-engineer");
      if (step === 6) expect(c.candidate?.checksPassed).toBe(false);
      if (step === 7) expect(c.candidate?.checksPassed).toBe(true);
      if (step === 8) expect(state.authorities[1].request).toMatchObject({ kind: "candidate_go", status: "pending" });
      if (step === 9) expect(state.authorities[1].request.decisionActor?.userId).toBe("simulated-demo-marketer");
      expect(c.productionVerified).toBe(step >= 11);
      if (step < 13) expect(c.publications.every(p => !p.receiptUrl)).toBe(true);
    }
    expect(phases).toEqual(DEMO_STEPS.map(step => step.phase));
    expect(state.authorities).toHaveLength(2); expect(state.tasks).toEqual([]); expect(state.costs).toEqual([]);
    expect(state.cases[0].publications).toHaveLength(1);
    expect(state.cases[0].publications[0]).toMatchObject({ mode: "fixture", status: "confirmed" });
    expect(state.cases[0].publications[0].receiptUrl).toMatch(/^https:\/\/example\.invalid\/simulated\//);
    expect(state.cases[0].communicationStatus).toBe("simulated_confirmed");
    expect(state.demoRun!.events.map(e => e.at)).toEqual(DEMO_STEPS.map((_, i) => NOW + i * DEMO_STEP_INTERVAL_MS));
    expect(new Set(state.demoRun!.events.map(e => e.id)).size).toBe(13);
    expect(state.audit.filter(e => e.action === "demo:internal_demo_step")).toHaveLength(12);
    expect(state.audit.filter(e => e.action === "demo:internal_demo_step").every(e => e.actor.includes("Simulated"))).toBe(true);
    const view = snapshot(state, operator, config);
    expect(view.revision).toBe(state.version); expect(view.demoRun).toEqual(state.demoRun);
    expect(view.cases[0].approvals.every(a => a.simulated)).toBe(true);
    expect(advanceDemoRun(state, config, NOW + 999_999)).toBe(state);
  });

  it("only advances once after a long gap and ignores repeated observer reads or stale expected steps", () => {
    const state = start(), expected = { runId: state.demoRun!.runId, stepIndex: 1 }, before = structuredClone(state);
    expect(advanceDemoRun(state, config, NOW + 1999)).toBe(state);
    const next = advanceDemoRun(state, config, NOW + 100_000, expected);
    expect(next.demoRun).toMatchObject({ stepIndex: 2, nextAt: NOW + 102_000 }); expect(state).toEqual(before);
    expect(advanceDemoRun(next, config, NOW + 100_000)).toBe(next);
    expect(advanceDemoRun(next, config, NOW + 200_000, expected)).toBe(next);
    expect(advanceDemoRun(next, config, NOW + 200_000, { ...expected, runId: "old-run", stepIndex: 2 })).toBe(next);
  });

  it("pauses across reload and resumes with a full interval without duplicating approvals", () => {
    let state = toStep(4); const pausedAt = state.demoRun!.updatedAt + 500;
    state = command(state, "demo_pause", pausedAt); expect(state.demoRun!.nextAt).toBeNull();
    state = JSON.parse(JSON.stringify(state)); expect(advanceDemoRun(state, config, NOW + 60_000)).toBe(state);
    state = command(state, "demo_resume", NOW + 60_000); expect(state.demoRun!.nextAt).toBe(NOW + 62_000);
    expect(advanceDemoRun(state, config, NOW + 61_999)).toBe(state);
    state = tick(state); expect(state.demoRun!.stepIndex).toBe(5); expect(state.authorities).toHaveLength(1);
    expect(state.authorities[0].request.status).toBe("approved");
  });

  it("start is idempotent while active and restart creates an isolated fresh case while preserving evidence", () => {
    const state = toStep(6), oldCase = structuredClone(state.cases[0]), oldId = state.demoRun!.runId;
    expect(command(state, "demo_start", NOW + 30_000)).toEqual(state);
    const next = command(state, "demo_restart", NOW + 30_000, { runId: oldId });
    expect(next.demoRun!.runId).not.toBe(oldId); expect(next.demoRun!.stepIndex).toBe(1); expect(next.cases).toHaveLength(2);
    expect(next.cases.find(c => c.id === oldCase.id)).toEqual(oldCase);
    expect(next.demoRunHistory?.[0]).toMatchObject({ runId: oldId, status: "completed", stopReason: "restarted", stepIndex: 6 });
    expect(next.cases[0].signals[0].sourceKey).not.toBe(oldCase.signals[0].sourceKey);
    expect(() => command(next, "demo_pause", NOW + 31_000, { runId: oldId })).toThrow("stale_demo_run");
    expect(() => command(next, "demo_restart", NOW + 31_000, { runId: oldId })).toThrow("stale_demo_run");
  });

  it("restarting a completed run does not reuse the previous verified candidate or reply", () => {
    const old = toStep(13), next = command(old, "demo_restart", NOW + 60_000);
    expect(next.cases).toHaveLength(2); expect(next.cases[0].route).toBe("engineering_resolution");
    expect(next.cases[0].candidate).toBeUndefined(); expect(next.cases[0].publications).toEqual([]);
    expect(next.cases[1].publications[0].status).toBe("confirmed");
  });

  it("manual cancellation stops playback and preserves the cancellation authority guard", () => {
    let state = toStep(5); const caseId = state.demoRun!.caseId;
    state = command(state, "cancel_case", NOW + 30_000, { caseId, reason: "Stop the demo" });
    expect(state.demoRun).toMatchObject({ status: "completed", nextAt: null, stopReason: "case_canceled" });
    expect(state.authorities[0].request.status).toBe("revoked"); expect(state.cases[0].canceledAt).toBe(NOW + 30_000);
    expect(advanceDemoRun(state, config, NOW + 60_000)).toBe(state);
    expect(command(state, "demo_resume", NOW + 60_000).demoRun!.status).toBe("completed");
  });

  it("workspace pause stops progression and a manually changed or revoked case pauses without bypassing guards", () => {
    const paused = start(); paused.paused = true; expect(advanceDemoRun(paused, config, NOW + 5000)).toBe(paused);
    expect(() => command(paused, "demo_start")).toThrow("workspace_paused");
    const changed = toStep(5); changed.authorities[0].request.status = "revoked";
    const blocked = tick(changed); expect(blocked.demoRun).toMatchObject({ status: "paused", stepIndex: 5, stopReason: "missing_build_approval" });
    expect(blocked.cases[0].candidate).toBeUndefined(); expect(blocked.tasks).toEqual([]);
    const drift = start(); drift.cases[0].phase = "COMPLETED";
    expect(tick(drift).demoRun!.stopReason).toBe("demo_case_changed");
  });

  it("rejects all demo writes in live configuration and never advances a live or mismatched state", () => {
    const demo = start(), liveConfig = { ...config, mode: "live" as const }, live = initialState(liveConfig);
    for (const action of ["demo_start", "demo_pause", "demo_resume", "demo_restart", "demo_advance", "demo_role", "demo_decide", "demo_fault"]) {
      expect(() => applyCommand(live, { action }, operator, liveConfig, NOW)).toThrow("demo_only");
      expect(() => applyCommand(demo, { action }, operator, liveConfig, NOW)).toThrow("demo_only");
      expect(() => applyCommand(live, { action }, operator, config, NOW)).toThrow("demo_only");
    }
    expect(advanceDemoRun(demo, liveConfig, NOW + 5000)).toBe(demo); expect(advanceDemoRun(live, config, NOW + 5000)).toBe(live);
    expect(() => applyCommand(demo, { action: "internal_demo_step" }, operator, config, NOW)).toThrow("forbidden");
    expect(() => applyCommand(demo, { action: "internal_demo_step" }, operator, config, NOW, true)).toThrow("forbidden");
  });
});

describe("demo run persistence with concurrent observers", () => {
  const priorPath = process.env.FDE_DEMO_DATA_PATH;
  let directory: string | undefined;
  afterEach(async () => { if (priorPath === undefined) delete process.env.FDE_DEMO_DATA_PATH; else process.env.FDE_DEMO_DATA_PATH = priorPath; if (directory) await rm(directory, { recursive: true, force: true }); });
  it("serializes two due reads into a single persisted transition across reload", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "mend-demo-run-")); const file = path.join(directory, "state.json"); process.env.FDE_DEMO_DATA_PATH = file;
    await withLocalState(config, () => ({ state: start(), value: null }));
    const observe = () => withLocalState(config, state => { const next = advanceDemoRun(state, config, NOW + 2000); return { state: next, value: snapshot(next, operator, config) }; });
    const [first, second] = await Promise.all([observe(), observe()]);
    expect(first.revision).toBe(second.revision); expect(first.demoRun!.stepIndex).toBe(2); expect(second.demoRun!.stepIndex).toBe(2);
    const saved = JSON.parse(await readFile(file, "utf8")) as ControlState;
    expect(saved.cases).toHaveLength(1); expect(saved.demoRun!.events).toHaveLength(2);
    const later = await withLocalState(config, state => { const next = advanceDemoRun(state, config, NOW + 4000); return { state: next, value: next }; });
    expect(later.demoRun!.stepIndex).toBe(3); expect(later.cases[0].evidence.filter(e => e.label === "Simulated reproduction")).toHaveLength(1);
  });
});
