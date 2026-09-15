import { applyCommand, audit } from "./reducer";
import { SIMULATED_DEMO_ACTOR, stopDemoRun } from "./demo-run-state";
import type { ControlState, RuntimeConfig } from "./types";

export { DEMO_STEP_INTERVAL_MS, DEMO_STEPS } from "./demo-run-state";

/** Call against the latest persisted state while holding its write lock. Never catches up multiple steps. */
export function advanceDemoRun(state: ControlState, config: RuntimeConfig, now: number, expected?: { runId: string; stepIndex: number }): ControlState {
  if (config.mode !== "demo" || state.mode !== "demo") return state;
  const run = state.demoRun;
  if (!run || run.status !== "running") return state;
  if (expected && (expected.runId !== run.runId || expected.stepIndex !== run.stepIndex)) return state;
  const c = state.cases.find(c => c.id === run.caseId);
  if (!c || c.canceledAt) {
    const next = structuredClone(state); stopDemoRun(next, now, c ? "case_canceled" : "case_missing", c?.phase ?? "COMPLETED");
    next.version++; audit(next, SIMULATED_DEMO_ACTOR, "demo:run_stopped", next.demoRun!.stopReason!, now); return next;
  }
  if (state.paused || run.nextAt === null || now < run.nextAt) return state;
  try {
    return applyCommand(state, { action: "internal_demo_step", caseId: run.caseId, runId: run.runId, stepIndex: run.stepIndex }, SIMULATED_DEMO_ACTOR, config, now, true);
  } catch (error) {
    // A manual edit, expired approval, or revoked authority pauses the demo instead of bypassing a guard.
    const next = structuredClone(state), paused = next.demoRun!;
    const reason = error instanceof Error && /^[a-z_0-9: -]{1,150}$/i.test(error.message) ? error.message : "demo_step_blocked";
    paused.status = "paused"; paused.nextAt = null; paused.updatedAt = now; paused.stopReason = reason;
    paused.events.push({ id: `${paused.runId}:blocked:${now}`, at: now, title: "Demo paused", detail: reason, phase: c.phase });
    next.version++; audit(next, SIMULATED_DEMO_ACTOR, "demo:run_paused", reason, now); return next;
  }
}
