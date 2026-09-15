import { v } from "convex/values";
import { z } from "zod";
import { internalMutation } from "./_generated/server";
import { readState, writeState, systemActor } from "./state";
import { approvalBinding, validateApproval } from "../src/core/approvals";
import { audit, bindingPayload, nextId } from "../src/control/reducer";
import { candidateSchema, type ReleaseCandidate } from "../workers/engineering/release";
import type { ControlState } from "../src/control/types";

const stateSchema = z.object({ candidateId: z.string(), stage: z.enum(["prepared", "merged", "promoted", "live_verified"]), previousDeploymentId: z.string(), mergeSha: z.string().optional(), promotionIntentAt: z.number().optional(), promotedAt: z.number().optional(), liveEvidenceRef: z.string().optional() }).strict();
function rollbackOperatorAuthorized(payload: Record<string, unknown>): boolean {
  // This fixed operator is issued only by the controller after validating its server-side service secret.
  return payload.operatorId === "hackathon-operator" && ["engineer", "admin"].includes(String(payload.operatorRole));
}
function current(state: ControlState, taskId: string, attemptId: string) {
  const task = state.tasks.find(item => item.id === taskId && item.attemptId === attemptId && item.status === "running");
  const c = state.cases.find(item => item.id === task?.caseId);
  if (!task || !c || task.inputRevision !== c.version || state.mode !== "live") throw new Error("stale_engineering_attempt");
  return { task, c };
}
function authorizeGo(state: ControlState, taskId: string, attemptId: string, candidate: ReleaseCandidate) {
  const { task, c } = current(state, taskId, attemptId);
  if (state.paused) throw new Error("workspace_paused");
  if (c.sourceMode === "fixture" || c.publications.some(publication => publication.mode === "fixture")) throw new Error("fixture_live_mismatch");
  if (task.kind !== "release_candidate" || c.candidate?.deploymentId !== candidate.deploymentId || c.candidate.headSha !== candidate.headSha || c.candidate.treeDigest !== candidate.treeDigest || !c.candidate.checksPassed || c.repository !== candidate.repository || c.baseSha !== candidate.baseSha || c.testRevision !== candidate.trustedTestRevision || c.buildConfigRevision !== candidate.buildConfigRevision) throw new Error("candidate_binding_changed");
  const authority = state.authorities.find(item => item.request.requestId === task.payload.authorityId && item.request.requestId === candidate.goRef && item.caseId === c.id);
  if (!authority || authority.request.kind !== "candidate_go") throw new Error("candidate_go_required");
  const check = validateApproval(authority.request, { workspaceId: state.workspaceId, kind: "candidate_go", binding: approvalBinding("candidate_go", bindingPayload(state, authority)) }, Date.now());
  if (!check.allowed) throw new Error(check.reasons[0]);
  const connection = state.connections.find(item => item.platform === c.sourcePlatform);
  if (!connection || connection.paused || connection.account !== c.publications.find(item => item.authorityId === candidate.goRef)?.account) throw new Error("approved_account_unavailable");
  return { task, c };
}
export const authorizeTask = internalMutation({ args: { taskId: v.string(), attemptId: v.string() }, handler: async (ctx, args) => {
  const state = await readState(ctx), { task, c } = current(state, args.taskId, args.attemptId);
  if (state.paused && task.kind !== "rollback_deployment") throw new Error("workspace_paused");
  if (["stage_candidate", "verify_candidate"].includes(task.kind)) {
    const build = state.authorities.findLast(item => item.caseId === c.id && item.request.kind === "build" && item.request.status === "approved");
    if (!build) throw new Error("build_approval_required");
    const check = validateApproval(build.request, { workspaceId: state.workspaceId, kind: "build", binding: approvalBinding("build", bindingPayload(state, build)) }, Date.now());
    if (!check.allowed) throw new Error(check.reasons[0]);
  }
  if (task.kind === "rollback_deployment") {
    const p = task.payload;
    if (!p.operatorAuthorizationRef || !rollbackOperatorAuthorized(p) || !c.previousDeploymentId || p.previousDeploymentId !== c.previousDeploymentId || typeof p.requestedAt !== "number" || p.requestedAt > Date.now() || Date.now() - p.requestedAt > 3_600_000) throw new Error("current_rollback_operator_authorization_required");
  }
  return { allowed: true };
} });
export const acquire = internalMutation({ args: { taskId: v.string(), attemptId: v.string(), candidate: v.any() }, handler: async (ctx, args) => {
  const candidate = candidateSchema.parse(args.candidate), state = await readState(ctx);
  const { c } = authorizeGo(state, args.taskId, args.attemptId, candidate);
  const resource = `${state.workspaceId}:${candidate.repository}:${candidate.projectId}`, row = await ctx.db.query("releaseLocks").withIndex("by_resource", q => q.eq("resource", resource)).unique(), now = Date.now();
  if (row?.held && row.expiresAt > now) throw new Error("release_busy");
  if (row && row.candidateId !== candidate.candidateId && row.state?.stage !== "live_verified" && !(row.state?.operation === "rollback" && row.state?.completed === true)) throw new Error("previous_release_requires_recovery");
  const lockId = nextId(state, "release-lock", now);
  const prior = row?.candidateId === candidate.candidateId ? row.state : undefined;
  const value = { resource, caseId: c.id, candidateId: candidate.candidateId, taskId: args.taskId, attemptId: args.attemptId, lockId, expiresAt: now + 600_000, held: true, ...(prior ? { state: prior } : {}) };
  if (row) await ctx.db.replace(row._id, value); else await ctx.db.insert("releaseLocks", value);
  audit(state, systemActor, "release_lock_acquired", `${c.id}: ${candidate.candidateId}`, now); await writeState(ctx, state);
  return { lockId, ...(prior ? { state: prior } : {}) };
} });
export const authorize = internalMutation({ args: { taskId: v.string(), attemptId: v.string(), lockId: v.string(), candidate: v.any(), effect: v.union(v.literal("merge"), v.literal("promote"), v.literal("verify")) }, handler: async (ctx, args) => {
  const state = await readState(ctx), candidate = candidateSchema.parse(args.candidate);
  authorizeGo(state, args.taskId, args.attemptId, candidate);
  const lock = await ctx.db.query("releaseLocks").withIndex("by_lock", q => q.eq("lockId", args.lockId)).unique();
  if (!lock?.held || lock.taskId !== args.taskId || lock.attemptId !== args.attemptId || lock.candidateId !== candidate.candidateId || lock.expiresAt <= Date.now()) throw new Error("release_lock_lost");
  await ctx.db.patch(lock._id, { expiresAt: Date.now() + 600_000 });
  audit(state, systemActor, `release_${args.effect}_authorized`, candidate.candidateId, Date.now()); await writeState(ctx, state); return { allowed: true };
} });
export const save = internalMutation({ args: { lockId: v.string(), state: v.any() }, handler: async (ctx, args) => {
  const incoming = stateSchema.parse(args.state), lock = await ctx.db.query("releaseLocks").withIndex("by_lock", q => q.eq("lockId", args.lockId)).unique();
  if (!lock?.held || lock.expiresAt <= Date.now() || incoming.candidateId !== lock.candidateId) throw new Error("release_lock_lost");
  const stages = ["prepared", "merged", "promoted", "live_verified"];
  if (lock.state && stages.indexOf(incoming.stage) < stages.indexOf(lock.state.stage)) throw new Error("release_stage_regression");
  await ctx.db.patch(lock._id, { state: incoming });
  const state = await readState(ctx), c = state.cases.find(item => item.id === lock.caseId);
  if (c) { c.releaseSubstage = incoming.stage; c.previousDeploymentId = incoming.previousDeploymentId; if (incoming.mergeSha) c.mergeSha = incoming.mergeSha; }
  audit(state, systemActor, "release_substage_saved", `${lock.caseId}: ${incoming.stage}`, Date.now()); await writeState(ctx, state);
} });
export const release = internalMutation({ args: { lockId: v.string(), blockedReason: v.optional(v.string()) }, handler: async (ctx, args) => {
  const lock = await ctx.db.query("releaseLocks").withIndex("by_lock", q => q.eq("lockId", args.lockId)).unique();
  if (!lock) throw new Error("release_lock_missing");
  await ctx.db.patch(lock._id, { held: false, ...(args.blockedReason ? { blockedReason: args.blockedReason.slice(0, 180) } : {}) });
  if (args.blockedReason) {
    const state = await readState(ctx), c = state.cases.find(item => item.id === lock.caseId); if (c) c.blockingReason = args.blockedReason.slice(0, 180);
    if (args.blockedReason === "live_verification_failed") state.paused = true;
    audit(state, systemActor, "release_blocked", args.blockedReason.slice(0, 180), Date.now()); await writeState(ctx, state);
  }
} });
export const acquireRollback = internalMutation({ args: { taskId: v.string(), attemptId: v.string(), projectId: v.string() }, handler: async (ctx, args) => {
  const state = await readState(ctx), { task, c } = current(state, args.taskId, args.attemptId), p = task.payload;
  if (task.kind !== "rollback_deployment" || !rollbackOperatorAuthorized(p) || !p.operatorAuthorizationRef || p.previousDeploymentId !== c.previousDeploymentId || !c.previousDeploymentId || typeof p.requestedAt !== "number" || p.requestedAt > Date.now() || Date.now() - p.requestedAt > 3_600_000) throw new Error("current_rollback_operator_authorization_required");
  const resource = `${state.workspaceId}:${c.repository}:${args.projectId}`, row = await ctx.db.query("releaseLocks").withIndex("by_resource", q => q.eq("resource", resource)).unique();
  if (row?.held && row.expiresAt > Date.now()) throw new Error("release_busy");
  const lockId = nextId(state, "rollback-lock", Date.now()), value = { resource, caseId: c.id, candidateId: `rollback:${p.operatorAuthorizationRef}`, taskId: task.id, attemptId: task.attemptId, lockId, expiresAt: Date.now() + 600_000, held: true, state: { operation: "rollback", completed: false, deploymentId: c.previousDeploymentId, operatorAuthorizationRef: p.operatorAuthorizationRef } };
  if (row) await ctx.db.replace(row._id, value); else await ctx.db.insert("releaseLocks", value);
  audit(state, systemActor, "rollback_lock_acquired", c.id, Date.now()); await writeState(ctx, state); return { lockId };
} });
export const finishRollback = internalMutation({ args: { lockId: v.string(), taskId: v.string(), attemptId: v.string(), deploymentId: v.string() }, handler: async (ctx, args) => {
  const state = await readState(ctx), { task, c } = current(state, args.taskId, args.attemptId), lock = await ctx.db.query("releaseLocks").withIndex("by_lock", q => q.eq("lockId", args.lockId)).unique();
  if (!lock?.held || lock.taskId !== task.id || lock.attemptId !== task.attemptId || args.deploymentId !== c.previousDeploymentId || lock.state?.deploymentId !== args.deploymentId) throw new Error("rollback_binding_changed");
  await ctx.db.patch(lock._id, { held: false, state: { ...lock.state, completed: true } });
  audit(state, systemActor, "rollback_verified", c.id, Date.now()); await writeState(ctx, state);
} });
