import { v } from "convex/values";
import { z } from "zod";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { authenticatedActor } from "./state";
import { snapshotValidator } from "./snapshotValidator";
import { applyCommand, snapshot } from "../src/control/reducer";
import { initialState } from "../src/control/seed";
import { seedWorkspace } from "../src/control/workspace-seed";
import { advanceDemoRun, DEMO_STEP_INTERVAL_MS } from "../src/control/demo-run";
import type { Actor, Command, ControlState, RuntimeConfig } from "../src/control/types";

// Provider readiness and execution are intentionally absent from the fixture workspace.
const demoConfig = (): RuntimeConfig => ({
  mode: "demo", repository: process.env.FDE_WEATHER_REPOSITORY ?? "configure-owner/weather-app",
  baseSha: process.env.FDE_BASE_SHA ?? "unverified-base", infrastructureCommittedUsd: 0,
  accessConfigured: true, convexConfigured: true, openaiConfigured: false,
  slackConfigured: false, linearConfigured: false, githubConfigured: false,
  vercelConfigured: false, workerConfigured: false, redditConfigured: false,
});
const demoActor = (state: ControlState): Actor => ({ id: "demo-" + state.demoRole, name: "Demo " + state.demoRole, roles: [state.demoRole] });
const projection = (state: ControlState) => snapshot(state, demoActor(state), demoConfig());
const readRow = (ctx: Pick<QueryCtx, "db">) => ctx.db.query("demoControlStates").withIndex("by_workspace", q => q.eq("workspaceId", "fde")).unique();

// This boundary accepts existing local state, while excluding live sources and execution jobs.
// The public snapshot has its own complete returns validator; internal fixture fields are retained.
const fixtureBoundary = z.object({
  schemaVersion: z.literal(1), workspaceId: z.literal("fde"), mode: z.literal("demo"), model: z.literal("gpt-5-mini"),
  version: z.number().int().nonnegative(), sequence: z.number().int().nonnegative(), paused: z.boolean(),
  demoRole: z.enum(["engineer", "marketer", "admin"]),
  cases: z.array(z.object({
    sourceMode: z.literal("fixture"),
    signals: z.array(z.object({ sourceMode: z.literal("fixture") }).passthrough()),
    publications: z.array(z.object({ mode: z.literal("fixture") }).passthrough()),
    workflowId: z.never().optional(), activeJobId: z.never().optional(),
  }).passthrough()),
  tasks: z.array(z.never()), personas: z.array(z.unknown()), connections: z.array(z.unknown()),
  authorities: z.array(z.unknown()), audit: z.array(z.unknown()), suppressions: z.array(z.unknown()),
  costs: z.array(z.unknown()), solvedIssues: z.array(z.unknown()), sourceKeys: z.array(z.string()),
  infrastructureCommittedUsd: z.number().finite().min(0).max(100),
}).passthrough();
function fixtureState(input: unknown): ControlState {
  const encoded = JSON.stringify(input);
  if (!encoded || new TextEncoder().encode(encoded).length > 700_000) throw new Error("demo_workspace_capacity_exceeded");
  const clean: unknown = JSON.parse(encoded);
  if (!fixtureBoundary.safeParse(clean).success) throw new Error("demo_fixture_state_required");
  return clean as ControlState;
}

type Tick = { runId: string; stepIndex: number; nextAt: number };
function nextTick(state: ControlState): Tick | undefined {
  const run = state.demoRun;
  if (state.paused || !run || run.status !== "running" || run.nextAt === null) return undefined;
  if (!Number.isFinite(run.nextAt) || !Number.isInteger(run.stepIndex)) throw new Error("invalid_demo_timer");
  return { runId: run.runId, stepIndex: run.stepIndex, nextAt: run.nextAt };
}
const sameTick = (a?: Tick, b?: Tick) => a?.runId === b?.runId && a?.stepIndex === b?.stepIndex && a?.nextAt === b?.nextAt;
async function writeDemo(ctx: MutationCtx, state: ControlState, row: Doc<"demoControlStates"> | null) {
  const clean = fixtureState(state), scheduledTick = nextTick(clean);
  const changed = !sameTick(row?.scheduledTick, scheduledTick);
  const timerVersion = (row?.timerVersion ?? 0) + (changed ? 1 : 0);
  if (changed && scheduledTick) {
    await ctx.scheduler.runAfter(Math.max(0, scheduledTick.nextAt - Date.now()), internal.demoControl.tick, { ...scheduledTick, timerVersion });
  }
  const value = { workspaceId: "fde" as const, state: clean, timerVersion, ...(scheduledTick ? { scheduledTick } : {}) };
  if (row) await ctx.db.replace(row._id, value);
  else await ctx.db.insert("demoControlStates", value);
}

export const getSnapshot = query({
  args: { serviceKey: v.string() }, returns: snapshotValidator,
  handler: async (ctx, { serviceKey }) => {
    await authenticatedActor(ctx, undefined, serviceKey);
    const row = await readRow(ctx);
    return projection(row ? fixtureState(row.state) : initialState(demoConfig()));
  },
});

export const seed = mutation({
  args: { serviceKey: v.string(), state: v.optional(v.any()) }, returns: snapshotValidator,
  handler: async (ctx, { serviceKey, state }) => {
    await authenticatedActor(ctx, undefined, serviceKey);
    const row = await readRow(ctx);
    if (row) return projection(fixtureState(row.state));
    const next = fixtureState(state ?? seedWorkspace(initialState(demoConfig())).state);
    if (next.demoRun?.status === "running") {
      next.demoRun.status = "paused"; next.demoRun.nextAt = null; next.demoRun.updatedAt = Date.now();
      next.demoRun.stopReason = "imported_demo_paused";
    }
    await writeDemo(ctx, next, null);
    return projection(next);
  },
});

export const dispatch = mutation({
  args: { serviceKey: v.string(), command: v.any() }, returns: snapshotValidator,
  handler: async (ctx, { serviceKey, command }) => {
    await authenticatedActor(ctx, undefined, serviceKey);
    if (!command || typeof command.action !== "string" || JSON.stringify(command).length > 24_000) throw new Error("invalid_command");
    const row = await readRow(ctx), state = row ? fixtureState(row.state) : initialState(demoConfig());
    const next = applyCommand(state, command as Command, demoActor(state), demoConfig());
    // Workspace pause also invalidates an already queued timer and grants a fresh interval on resume.
    if (state.paused !== next.paused && next.demoRun?.status === "running") {
      next.demoRun.nextAt = next.paused ? null : Date.now() + DEMO_STEP_INTERVAL_MS;
    }
    await writeDemo(ctx, next, row);
    return projection(next);
  },
});

export const tick = internalMutation({
  args: { runId: v.string(), stepIndex: v.number(), nextAt: v.number(), timerVersion: v.number() }, returns: v.null(),
  handler: async (ctx, expected) => {
    const row = await readRow(ctx);
    if (!row || row.timerVersion !== expected.timerVersion || !sameTick(row.scheduledTick, expected)) return null;
    const state = fixtureState(row.state);
    if (!sameTick(nextTick(state), expected)) return null;
    const next = advanceDemoRun(state, demoConfig(), Date.now(), expected);
    if (next !== state) await writeDemo(ctx, next, row);
    return null;
  },
});
