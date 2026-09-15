import type { DemoRun } from "../shared/control-contract";
import type { Actor, ControlState } from "./types";

export const DEMO_STEP_INTERVAL_MS = 2000;
export const DEMO_STEPS = [
  { title: "Report received", detail: "20°C displays as 20°F instead of 68°F.", phase: "RECEIVED" },
  { title: "Report triaged", detail: "The conversion defect is routed to engineering.", phase: "TRIAGING" },
  { title: "Defect reproduced", detail: "Unit conversion returns 20°F; the expected result is 68°F.", phase: "INVESTIGATING" },
  { title: "Build approval requested", detail: "The engineer reviews the repository, base revision, and allowed change scope.", phase: "AWAITING_BUILD" },
  { title: "Build approved", detail: "The engineer's decision authorizes the scoped change.", phase: "BUILDING" },
  { title: "Candidate built", detail: "The patch corrects the Celsius-to-Fahrenheit formula; candidate identity is recorded.", phase: "VERIFYING_CANDIDATE" },
  { title: "Candidate verified", detail: "Checks cover 20°C, 0°C, −40°C, 100°C, repeated toggles, and default units.", phase: "VERIFYING_CANDIDATE" },
  { title: "Go approval requested", detail: "The marketer reviews the candidate, check evidence, and exact customer reply.", phase: "AWAITING_GO" },
  { title: "Go approved", detail: "The marketer's decision authorizes this candidate and reply.", phase: "RELEASING" },
  { title: "Release promoted", detail: "The approved candidate advances to production verification.", phase: "VERIFYING_LIVE" },
  { title: "Live behavior verified", detail: "Deployment identity and 20°C → 68°F behavior match the approved candidate.", phase: "READY_TO_PUBLISH" },
  { title: "Approved reply sending", detail: "Publication checks pass for the exact reply, current approval, and fresh verification.", phase: "PUBLISHING" },
  { title: "Reply confirmed", detail: "Reply receipt recorded. The report-to-resolution loop is closed.", phase: "COMPLETED" },
] as const;

export const SIMULATED_DEMO_ACTOR: Actor = { id: "simulated-demo-run", name: "Simulated demo runner", roles: ["engineer", "marketer"] };

export function recordDemoStep(run: DemoRun, now: number): void {
  const step = DEMO_STEPS[run.stepIndex];
  run.events.push({ id: `${run.runId}:step:${run.stepIndex + 1}`, at: now, ...step });
  run.stepIndex++;
  run.stepLabel = step.title;
  run.updatedAt = now;
  run.status = run.stepIndex === run.totalSteps ? "completed" : "running";
  run.nextAt = run.status === "running" ? now + DEMO_STEP_INTERVAL_MS : null;
  if (run.status === "completed") run.completedAt = now;
}

export function stopDemoRun(state: ControlState, now: number, reason: string, phase: string): void {
  const run = state.demoRun;
  if (!run || run.status === "completed") return;
  run.status = "completed"; run.stopReason = reason; run.nextAt = null; run.updatedAt = now; run.completedAt = now;
  run.stepLabel = reason === "case_canceled" ? "Demo case canceled" : "Demo run stopped";
  run.events.push({ id: `${run.runId}:stop:${now}`, at: now, title: run.stepLabel, detail: reason, phase });
}
