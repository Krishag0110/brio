import { v } from "convex/values";
import { start } from "@convex-dev/workflow";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticatedActor, configuredSlackActor, config, readState, writeState } from "./state";
import { applyCommand, createTask, publicationEvidenceCase, reserveModelCost, settleModelCost, snapshot } from "../src/control/reducer";
import type { Command, Task } from "../src/control/types";
import { hashText } from "../src/core/domain";
import { applyTaskResult } from "../src/control/events";
import { snapshotValidator } from "./snapshotValidator";
export const getSnapshot = query({ args: { serviceKey: v.string() }, returns: snapshotValidator, handler: async (ctx, a) => { const s = await readState(ctx); return snapshot(s, await authenticatedActor(ctx, s, a.serviceKey), config()); } });
export const dispatch = mutation({ args: { command: v.any(), serviceKey: v.string() }, returns: snapshotValidator, handler: async (ctx, { command, serviceKey }) => {
  if (!command || typeof command.action !== "string" || JSON.stringify(command).length > 24_000) throw new Error("invalid_command");
  const s = await readState(ctx), actor = await authenticatedActor(ctx, s, serviceKey);
  const next = applyCommand(s, command as Command, actor, config());
  if (["connection_disable", "connection_configure"].includes(command.action)) {
    for (const session of await ctx.db.query("socialSessions").withIndex("by_connection", q => q.eq("connectionId", String(command.connectionId))).collect()) await ctx.db.delete(session._id);
  }
  if (["connection_disable", "connection_configure", "reconnect"].includes(command.action)) {
    for (const credential of await ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", String(command.connectionId))).take(10)) await ctx.db.delete(credential._id);
    for (const pending of await ctx.db.query("redditOAuthStates").withIndex("by_connection", q => q.eq("connectionId", String(command.connectionId))).take(10)) await ctx.db.delete(pending._id);
  }
  await writeState(ctx, next); await ctx.scheduler.runAfter(0, internal.control.pump, {});
  return snapshot(next, actor, config());
} });
export const stateForAction = internalQuery({ args: {}, handler: ctx => readState(ctx) });
export const actorForAction = internalQuery({ args: { serviceKey: v.string() }, handler: (ctx, a) => authenticatedActor(ctx, undefined, a.serviceKey) });
export const pump = internalMutation({ args: {}, handler: async ctx => {
  const s = await readState(ctx);
  for (const task of s.tasks.filter(t => t.status === "pending" && !t.workflowId).slice(0, 10)) {
    task.workflowId = await start(ctx, internal.workflows.runTask, { taskId: task.id });
  }
  await writeState(ctx, s);
} });
export const claimTask = internalMutation({ args: { taskId: v.string() }, handler: async (ctx, { taskId }): Promise<Task | null> => {
  const s = await readState(ctx), task = s.tasks.find(t => t.id === taskId);
  if (!task || task.status !== "pending") return null;
  if (task.caseId && s.cases.find(c => c.id === task.caseId)?.canceledAt) { task.status = "failed"; task.error = "case_canceled"; await writeState(ctx, s); return null; }
  if (s.paused && !["slack_approval", "rollback_deployment"].includes(task.kind)) { task.status = "failed"; task.error = "workspace_paused"; await writeState(ctx, s); return null; }
  task.status = "running"; task.dispatchedAt = Date.now(); await writeState(ctx, s); return task;
} });
export const taskResult = internalMutation({ args: { taskId: v.string(), attemptId: v.string(), result: v.any() }, handler: async (ctx, args) => {
  const s = await readState(ctx), task = s.tasks.find(t => t.id === args.taskId);
  if (!task || task.attemptId !== args.attemptId) throw new Error("stale_attempt");
  if (task.status === "completed") return null;
  applyTaskResult(s, task, args.result, Date.now());
  await writeState(ctx, s); await ctx.scheduler.runAfter(0, internal.control.pump, {}); return null;
} });
export const reserve = internalMutation({ args: { caseId: v.string(), maximumUsd: v.number() }, handler: async (ctx, a) => { const s = await readState(ctx); const id = reserveModelCost(s, a.caseId, a.maximumUsd, Date.now()); await writeState(ctx, s); return id; } });
export const settle = internalMutation({ args: { id: v.string(), status: v.union(v.literal("settled"), v.literal("unknown")), actualUsd: v.optional(v.number()) }, handler: async (ctx, a) => { const s = await readState(ctx); settleModelCost(s, a.id, a.status, a.actualUsd); await writeState(ctx, s); } });
export const slackDecision = internalMutation({ args: { teamId: v.string(), userId: v.string(), authorityId: v.string(), bindingHash: v.string(), decision: v.union(v.literal("approved"), v.literal("declined")) }, handler: async (ctx, a) => {
  const s = await readState(ctx); const actor = configuredSlackActor(a.teamId, a.userId);
  const authority = s.authorities.find(x => x.request.requestId === a.authorityId); if (!authority || hashText(authority.request.binding) !== a.bindingHash) throw new Error("slack_binding_mismatch");
  const next = applyCommand(s, { action: "internal_decide", approvalId: a.authorityId, decision: a.decision }, actor, config(), Date.now(), true);
  await writeState(ctx, next); await ctx.scheduler.runAfter(0, internal.control.pump, {}); return null;
} });
export const expireLeases = internalMutation({ args: {}, handler: async ctx => {
  const s = await readState(ctx), now = Date.now();
  const leases = await ctx.db.query("workerLeases").collect();
  for (const lease of leases.filter(l => !l.completed && l.expiresAt <= now)) {
    const task = s.tasks.find(t => t.id === lease.jobId); if (!task) continue;
    applyTaskResult(s, task, { status: "unknown", error: "worker_lease_expired" }, now);
    await ctx.db.patch(lease._id, { completed: true });
  }
  for (const task of s.tasks.filter(t => t.status === "running" && t.dispatchedAt && now - t.dispatchedAt > 20 * 60_000)) applyTaskResult(s, task, { status: "unknown", error: "execution_timeout" }, now);

  await writeState(ctx, s);
} });

export const maintain = internalMutation({ args: {}, handler: async ctx => {
  const s = await readState(ctx), now = Date.now(); let changed = false;
  for (const a of s.authorities.filter(a => a.request.status === "pending")) {
    if (a.request.expiresAt <= now) { const c = s.cases.find(c => c.id === a.caseId); if (c && c.blockingReason !== "approval_expired") { c.blockingReason = "approval_expired"; changed = true; } }
    else if (now - a.request.createdAt >= 15 * 60_000 && !s.tasks.some(t => t.kind === "slack_reminder" && t.payload.authorityId === a.request.requestId)) { createTask(s, "slack_reminder", a.caseId, { authorityId: a.request.requestId }, now); changed = true; }
  }
  for (const pending of await ctx.db.query("redditOAuthStates").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(100)) await ctx.db.delete(pending._id);
  if (!s.paused && process.env.FDE_SOCIAL_POLLING_ENABLED === "true" && s.cases.length < 95) for (const connection of s.connections.filter(c => (c.platform === "x" || c.platform === "reddit" && process.env.REDDIT_API_APPROVED === "true") && c.status === "ready" && c.permission === "granted" && !c.paused)) {
    if (!connection.lastPolledAt || now - connection.lastPolledAt >= 5 * 60_000) { createTask(s, "ingest_social", undefined, { connectionId: connection.id }, now); changed = true; }
  }
  if (changed) { await writeState(ctx, s); await ctx.scheduler.runAfter(0, internal.control.pump, {}); }
} });
export const manualReceipt = internalMutation({ args: { command: v.any(), identity: v.optional(v.any()), serviceKey: v.string() }, handler: async (ctx, a) => {
  const s = await readState(ctx), actor = await authenticatedActor(ctx, s, a.serviceKey);
  if (a.command?.action !== "manual_receipt") throw new Error("invalid_manual_command");
  const c = s.cases.find(c => c.id === a.command.caseId); if (!c) throw new Error("case_missing");
  const p = c.publications.find(p => p.id === a.command.publicationId); if (!p) throw new Error("publication_missing");
  const proof = publicationEvidenceCase(s, c, p);
  if (a.identity) {
    if (!proof.candidate || a.identity.deploymentId !== proof.candidate.deploymentId || a.identity.treeDigest !== proof.candidate.treeDigest || !Number.isFinite(a.identity.checkedAt) || a.identity.checkedAt > Date.now() || Date.now() - a.identity.checkedAt > 10_000) throw new Error("production_identity_mismatch");
    proof.productionDeploymentId = a.identity.deploymentId; proof.productionTreeDigest = a.identity.treeDigest; proof.productionIdentityCheckedAt = a.identity.checkedAt;
  }
  const next = applyCommand(s, a.command, actor, config()); await writeState(ctx, next); return snapshot(next, actor, config());
} });
/** Explicit local integration harness; disabled unless the deployment owner opts in. */
export const localWorkflowSmoke = internalMutation({ args: { runId: v.string() }, handler: async (ctx, a) => {
  if (process.env.FDE_ENABLE_INTEGRATION_SMOKE !== "true" || !/^smoke-[a-z0-9-]{1,50}$/.test(a.runId)) throw new Error("smoke_harness_disabled");
  const s = await readState(ctx);
  const prior = s.cases.find(c => c.title.includes(a.runId)); if (prior) return { caseId: prior.id, duplicate: true };
  const next = applyCommand(s, { action: "intake", platform: "x", mode: "manual", text: a.runId + ": 20°C becomes 20°F. The conversion is broken.", sourceUrl: "" }, { id: "local-smoke", name: "Local integration smoke", roles: [] }, config(), Date.now(), true);
  const c = next.cases[0]; await writeState(ctx, next); await ctx.scheduler.runAfter(0, internal.control.pump, {}); return { caseId: c.id };
} });
export const smokeStatus = internalQuery({ args: { caseId: v.string() }, handler: async (ctx, a) => {
  const s = await readState(ctx), c = s.cases.find(c => c.id === a.caseId);
  if (!c || !c.text.startsWith("smoke-")) throw new Error("not_smoke_case");
  return { caseId: c.id, phase: c.phase, blockingReason: c.blockingReason ?? null, classification: c.classification.category, tasks: s.tasks.filter(t => t.caseId === c.id).map(t => ({ id: t.id, kind: t.kind, status: t.status, error: t.error ?? null, workflowId: t.workflowId ?? null })), costs: s.costs.filter(r => r.caseId === c.id), publications: c.publications.length };
} });
