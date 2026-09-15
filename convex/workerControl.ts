import { v } from "convex/values";
import { z } from "zod";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticatedActor, config, readState, writeState } from "./state";
import { applyCommand, assertCanPublish, audit, bindingPayload, costTotals, reserveModelCost, settleModelCost } from "../src/control/reducer";
import { approvalBinding, validateApproval } from "../src/core/approvals";
import { canonicalJson, hashText } from "../src/core/domain";
import { parseSocialTarget } from "../src/core/signals";
import { grantSchema, encryptedSessionSchema, socialJobSchema } from "../workers/shared/contracts";
import { redditIngestionSchema } from "../workers/shared/reddit-contracts";
import { applyTaskResult } from "../src/control/events";
import type { ControlState } from "../src/control/types";
const bounded = (data: unknown, bytes = 80_000) => { if (new TextEncoder().encode(JSON.stringify(data)).length > bytes) throw new Error("payload_too_large"); };
function currentBuild(s: ControlState, raw: unknown) {
  const build = z.object({ jobId: z.string(), attemptId: z.string(), authorizationRef: z.string(), authorizationExpiresAt: z.number(), workspaceId: z.string(), caseId: z.string(), repository: z.string(), baseSha: z.string(), allowedPaths: z.array(z.string()), acceptanceCriteria: z.array(z.string()), scopeHash: z.string() }).passthrough().parse(raw);
  const task = s.tasks.find(t => t.id === build.jobId && t.attemptId === build.attemptId && t.kind === "build_candidate");
  const c = s.cases.find(c => c.id === build.caseId);
  const a = s.authorities.find(a => a.request.requestId === build.authorizationRef);
  if (c?.canceledAt) throw new Error("case_canceled");
  if (!task || task.status !== "running" || !c || task.caseId !== c.id || build.workspaceId !== s.workspaceId || s.paused || task.inputRevision !== c.version || !a || a.caseId !== c.id || a.request.kind !== "build" || canonicalJson(task.payload.buildRequest) !== canonicalJson(raw)) throw new Error("engineering_scope_denied");
  const payload = bindingPayload(s, a), binding = approvalBinding("build", payload);
  const decision = validateApproval(a.request, { workspaceId: s.workspaceId, kind: "build", binding }, Date.now());
  if (!decision.allowed || build.authorizationExpiresAt !== a.request.grantExpiresAt) throw new Error("build_authority_invalid");
  if (build.repository !== payload.repository || build.baseSha !== payload.baseSha || canonicalJson(build.allowedPaths) !== canonicalJson(payload.allowedPaths) || canonicalJson(build.acceptanceCriteria) !== canonicalJson(payload.acceptanceCriteria) || build.scopeHash !== hashText(binding)) throw new Error("engineering_scope_denied");
  return { task, c, a };
}
export const bindBuild = internalMutation({ args: { taskId: v.string(), attemptId: v.string(), build: v.any() }, handler: async (ctx, a) => {
  const s = await readState(ctx), task = s.tasks.find(t => t.id === a.taskId && t.attemptId === a.attemptId);
  if (!task || task.kind !== "build_candidate" || task.status !== "running") throw new Error("stale_build_job");
  if (task.payload.buildRequest && canonicalJson(task.payload.buildRequest) !== canonicalJson(a.build)) throw new Error("build_already_bound");
  task.payload.buildRequest = a.build; currentBuild(s, a.build); await writeState(ctx, s); return null;
} });
export const engineeringAuthorize = internalMutation({ args: { build: v.any(), effect: v.string() }, handler: async (ctx, a) => { const s = await readState(ctx); currentBuild(s, a.build); if (!["model", "verify", "write_pr"].includes(a.effect)) throw new Error("effect_denied"); return { allowed: true }; } });
export const reserveProposal = internalMutation({ args: { build: v.any(), attempt: v.number(), inputHash: v.string(), maximumUsd: v.number() }, handler: async (ctx, a) => {
  const s = await readState(ctx), { task, c } = currentBuild(s, a.build);
  if (!Number.isInteger(a.attempt) || a.attempt < 0 || a.attempt >= 3) throw new Error("attempt_limit");
  const attempts = (task.payload.modelAttempts ?? {}) as Record<string, { inputHash: string; reservationId: string; result?: unknown }>;
  const prior = attempts[String(a.attempt)];
  if (prior) { if (prior.inputHash !== a.inputHash) throw new Error("model_attempt_input_drift"); if (prior.result) return { ...prior, cached: true }; throw new Error("model_attempt_inflight_or_unknown"); }
  if (a.attempt > 0 && !attempts[String(a.attempt - 1)]?.result) throw new Error("model_attempt_out_of_order");
  const reservationId = reserveModelCost(s, c.id, a.maximumUsd, Date.now());
  attempts[String(a.attempt)] = { inputHash: a.inputHash, reservationId }; task.payload.modelAttempts = attempts;
  await writeState(ctx, s); return { reservationId, cached: false };
} });
export const proposalResult = internalMutation({ args: { taskId: v.string(), attempt: v.number(), reservationId: v.string(), result: v.optional(v.any()), actualUsd: v.optional(v.number()) }, handler: async (ctx, a) => {
  const s = await readState(ctx), task = s.tasks.find(t => t.id === a.taskId);
  const attempt = (task?.payload.modelAttempts as Record<string, { reservationId: string; result?: unknown }> | undefined)?.[String(a.attempt)];
  if (!attempt || attempt.reservationId !== a.reservationId) throw new Error("model_reservation_mismatch");
  if (a.result) { attempt.result = a.result; settleModelCost(s, a.reservationId, "settled", a.actualUsd); }
  else settleModelCost(s, a.reservationId, "unknown");
  await writeState(ctx, s); return null;
} });
export const engineeringResult = internalMutation({ args: { jobId: v.string(), attemptId: v.string(), result: v.any() }, handler: async (ctx, a) => {
  bounded(a.result, 150_000); const s = await readState(ctx), task = s.tasks.find(t => t.id === a.jobId);
  if (!task || task.kind !== "build_candidate" || task.attemptId !== a.attemptId) throw new Error("stale_engineering_result");
  if (!["running", "unknown", "failed", "completed"].includes(task.status) || !task.payload.buildRequest) throw new Error("attempt_not_dispatched");
  const out = z.object({ status: z.enum(["pr_created", "verified_patch", "checks_failed"]) }).passthrough().parse(a.result);
  if (out.status === "verified_patch") { if (task.status === "running") task.receipt = { status: "verified_patch", waitingFor: "trusted_pr_receipt" }; await writeState(ctx, s); return { received: true }; }
  applyTaskResult(s, task, out.status === "checks_failed" ? { status: "failed", error: "checks_failed" } : { status: "succeeded", output: out }, Date.now());
  await writeState(ctx, s); await ctx.scheduler.runAfter(0, internal.control.pump, {}); return { received: true };
} });
export const createImport = internalMutation({ args: { accountId: v.string(), serviceKey: v.string() }, handler: async (ctx, a) => {
  const s = await readState(ctx), actor = await authenticatedActor(ctx, s, a.serviceKey); if (!actor.roles.includes("admin")) throw new Error("forbidden");
  const c = s.connections.find(c => c.platform === "x" && c.account === a.accountId); if (!c || c.status === "disabled") throw new Error("configure_account_first");
  const grant = { schemaVersion: 1 as const, jti: crypto.randomUUID(), workspaceId: s.workspaceId, connectionId: c.id, connectionVersion: c.version, accountId: a.accountId, operation: "session_import" as const, exp: Date.now() + 300_000 };
  await ctx.db.insert("workerGrants", { jti: grant.jti, grant, consumed: false }); return grant;
} });
export const createSocial = internalMutation({ args: { taskId: v.string(), attemptId: v.string() }, handler: async (ctx, a) => {
  const s = await readState(ctx), task = s.tasks.find(t => t.id === a.taskId && t.attemptId === a.attemptId);
  if (!task || task.status !== "running" || !["publish_reply", "reconcile_publication", "ingest_social"].includes(task.kind)) throw new Error("stale_job");
  if (task.kind === "ingest_social") {
    const connection = s.connections.find(connection => connection.id === task.payload.connectionId && ["x", "reddit"].includes(connection.platform));
    if (!connection?.account || connection.status !== "ready" || connection.permission !== "granted" || connection.paused || s.paused) throw new Error("ingestion_connection_not_ready");
    if (connection.platform === "reddit" && process.env.REDDIT_API_APPROVED !== "true") throw new Error("reddit_access_pending");
    if (task.payload.grantJti) throw new Error("social_dispatch_already_bound");
    const grant = { schemaVersion: 1 as const, jti: crypto.randomUUID(), workspaceId: s.workspaceId, connectionId: connection.id, connectionVersion: connection.version, accountId: connection.account, operation: "ingest_social" as const, jobId: task.id, attemptId: task.attemptId, exp: Date.now() + 120_000 };
    const payload = { platform: connection.platform, ...(connection.cursor ? { cursor: connection.cursor } : {}) };
    task.payload.socialJob = socialJobSchema.parse({ schemaVersion: 1, jobId: task.id, workspaceId: s.workspaceId, operation: "ingest_social", attemptId: task.attemptId, inputRevision: task.inputRevision, idempotencyKey: task.id, createdAt: Date.now(), expiresAt: grant.exp, connectionId: connection.id, accountId: connection.account, connectionVersion: connection.version, payload });
    task.payload.grantJti = grant.jti;
    await ctx.db.insert("workerGrants", { jti: grant.jti, grant, consumed: false }); await writeState(ctx, s); return grant;
  }
  const c = s.cases.find(c => c.id === task.caseId), p = c?.publications.find(p => p.id === task.payload.publicationId);
  if (!c || !p) throw new Error("publication_missing");
  if (c.canceledAt) throw new Error("case_canceled");
  if (p.manualOnly) throw new Error("supplemental_manual_only");
  const connection = s.connections.find(x => x.platform === c.sourcePlatform && x.account === p.account);
  if (!connection || !["x", "reddit"].includes(c.sourcePlatform)) throw new Error("adapter_unavailable");
  if (task.kind === "publish_reply") assertCanPublish(s, c, p, Date.now(), { requireImmediateIdentity: false });
  else if (p.status !== "unknown") throw new Error("reconciliation_not_required");
  if (costTotals(s).committed >= 90) throw new Error("budget_exhausted");
  const auth = s.authorities.find(a => a.request.requestId === p.authorityId); if (!auth) throw new Error("authority_missing");
  if (task.payload.grantJti) throw new Error("social_dispatch_already_bound");
  const grant = { schemaVersion: 1 as const, jti: crypto.randomUUID(), workspaceId: s.workspaceId, connectionId: connection.id, connectionVersion: connection.version, accountId: p.account!, operation: task.kind as "publish_reply" | "reconcile_publication", jobId: task.id, attemptId: task.attemptId, exp: Date.now() + 120_000 };
  const job = socialJobSchema.parse({ schemaVersion: 1, jobId: task.id, workspaceId: s.workspaceId, operation: task.kind, attemptId: task.attemptId, inputRevision: task.inputRevision, idempotencyKey: hashText(p.sourceKey + ":" + p.account), createdAt: Date.now(), expiresAt: grant.exp, connectionId: connection.id, accountId: p.account, connectionVersion: connection.version,
    payload: { platform: p.mode === "fixture" ? "simulator" : c.sourcePlatform, mode: p.mode, accountId: p.account, targetId: p.targetId, targetUrl: p.targetUrl ?? "", text: p.draftText, textHash: p.textHash, sourceContextHash: p.contextHash, ...(p.attemptedAt ? { publicationAttemptedAt: p.attemptedAt } : {}), authorizationKind: p.authorityKind, authorizationRef: p.authorityId, authorizationVersion: auth.request.version, personaVersion: String(p.personaVersion), budgetReservation: "project-envelope-" + s.version, contactIntent: true, publicationId: p.id, ...(c.candidate ? { deploymentId: c.candidate.deploymentId, evidenceRef: hashText(canonicalJson(c.evidence)) } : {}) } });
  task.payload.socialJob = job; task.payload.grantJti = grant.jti;
  await ctx.db.insert("workerGrants", { jti: grant.jti, grant, consumed: false }); await writeState(ctx, s); return grant;
} });
export const callback = internalMutation({ args: { path: v.string(), data: v.any(), verifiedIdentity: v.optional(v.any()) }, handler: async (ctx, { path, data, verifiedIdentity }) => {
  bounded(data, 180_000); const raw = z.record(z.string(), z.unknown()).parse(data), grant = grantSchema.parse(raw.grant);
  const saved = await ctx.db.query("workerGrants").withIndex("by_jti", q => q.eq("jti", grant.jti)).unique();
  if (!saved || canonicalJson(saved.grant) !== canonicalJson(grant)) throw new Error("grant_not_issued");
  const s = await readState(ctx), connection = s.connections.find(c => c.id === grant.connectionId);
  const connectionCurrent = connection && grant.workspaceId === s.workspaceId && connection.version === grant.connectionVersion && connection.account === grant.accountId && connection.status !== "disabled";
  if (path.startsWith("session/")) {
    if (grant.operation !== "session_import") throw new Error("session_grant_invalid");
    if (!connectionCurrent || grant.exp <= Date.now()) {
      const id = raw.pendingId ? ctx.db.normalizeId("socialSessions", String(raw.pendingId)) : null;
      const stale = id ? await ctx.db.get(id) : null;
      if (stale?.grantJti === grant.jti && stale.status === "quarantined") await ctx.db.delete(stale._id);
      return { activated: false, rejected: true, reason: "session_grant_expired_or_connection_changed" };
    }
    if (path === "session/quarantine") {
      if (saved.consumed) throw new Error("session_grant_consumed");
      const enc = encryptedSessionSchema.parse(raw.encryptedSession);
      if (enc.workspaceId !== grant.workspaceId || enc.accountId !== grant.accountId || enc.connectionId !== grant.connectionId || enc.connectionVersion !== grant.connectionVersion) throw new Error("session_binding_mismatch");
      const id = await ctx.db.insert("socialSessions", { connectionId: grant.connectionId, connectionVersion: grant.connectionVersion, status: "quarantined", grantJti: grant.jti, encrypted: enc, createdAt: Date.now() });
      await ctx.db.patch(saved._id, { consumed: true }); return { pendingId: id };
    }
    const pendingId = ctx.db.normalizeId("socialSessions", String(raw.pendingId));
    const pending = pendingId ? await ctx.db.get(pendingId) : null;
    if (!pending || pending.grantJti !== grant.jti || pending.status !== "quarantined") throw new Error("pending_session_invalid");
    if (path === "session/reject") { await ctx.db.delete(pending._id); return { rejected: true }; }
    if (path !== "session/activate") throw new Error("session_operation_invalid");
    if (raw.verifiedAccountId !== grant.accountId) { await ctx.db.delete(pending._id); return { activated: false, rejected: true, reason: "verified_account_mismatch" }; }
    for (const old of await ctx.db.query("socialSessions").withIndex("by_connection", q => q.eq("connectionId", grant.connectionId)).collect()) if (old._id !== pending._id) await ctx.db.delete(old._id);
    await ctx.db.patch(pending._id, { status: "active" });
    connection!.permission = process.env.X_AUTOMATION_PERMISSION_CONFIRMED === "true" ? "granted" : "unverified";
    connection!.status = connection!.permission === "granted" ? "ready" : "access_pending";
    connection!.lastCheckedAt = new Date().toISOString(); connection!.detail = connection!.permission === "granted" ? "Identity verified; owner configured platform permission." : "Identity verified; platform automation permission remains pending. Manual fallback available.";
    await writeState(ctx, s); return { activated: true };
  }
  const task = s.tasks.find(t => t.id === grant.jobId && t.attemptId === grant.attemptId);
  if (!task || task.payload.grantJti !== grant.jti || task.kind !== grant.operation) throw new Error("grant_task_mismatch");
  const c = s.cases.find(c => c.id === task.caseId), p = c?.publications.find(p => p.id === task.payload.publicationId);
  if (task.kind !== "ingest_social" && (!c || !p)) throw new Error("publication_missing");
  if (c?.canceledAt && path !== "result") throw new Error("case_canceled");
  if (path === "claim") {
    if (!connectionCurrent || saved.consumed || grant.exp <= Date.now() || raw.jobId !== task.id || raw.attemptId !== task.attemptId || task.status !== "running") throw new Error("claim_denied");
    if (task.kind === "publish_reply") assertCanPublish(s, c!, p!, Date.now(), { requireImmediateIdentity: false });
    if (task.kind === "ingest_social" && (s.paused || connection!.paused || connection!.permission !== "granted" || connection!.status !== "ready")) throw new Error("ingestion_connection_not_ready");
    const redditCredential = connection!.platform === "reddit" ? await ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", grant.connectionId)).unique() : null;
    if (connection!.platform === "reddit" && (process.env.REDDIT_API_APPROVED !== "true" || !redditCredential || redditCredential.connectionVersion !== grant.connectionVersion)) throw new Error("reddit_connection_not_ready");
    const previous = await ctx.db.query("workerLeases").withIndex("by_job", q => q.eq("jobId", task.id)).unique(); if (previous) throw new Error("job_already_claimed");
    const activeAccount = (await ctx.db.query("workerLeases").withIndex("by_connection", q => q.eq("connectionId", grant.connectionId)).collect()).find(lease => !lease.completed && lease.expiresAt > Date.now());
    if (activeAccount) throw new Error("account_job_already_running");
    const leaseId = crypto.randomUUID();
    await ctx.db.insert("workerLeases", { jobId: task.id, attemptId: task.attemptId, grantJti: grant.jti, leaseId, expiresAt: Math.min(Date.now() + 60_000, grant.exp), sendAuthorized: false, completed: false, connectionId: grant.connectionId, accountId: grant.accountId, workspaceId: grant.workspaceId });
    await ctx.db.patch(saved._id, { consumed: true });
    const session = (await ctx.db.query("socialSessions").withIndex("by_connection", q => q.eq("connectionId", grant.connectionId)).collect()).find(x => x.status === "active" && x.connectionVersion === grant.connectionVersion);
    return { job: task.payload.socialJob, leaseId, ...(session ? { session: session.encrypted } : {}), ...(redditCredential ? { redditCredential: redditCredential.encrypted } : {}) };
  }
  const lease = await ctx.db.query("workerLeases").withIndex("by_lease", q => q.eq("leaseId", String(raw.leaseId))).unique();
  if (!lease || lease.jobId !== task.id || lease.attemptId !== task.attemptId || lease.grantJti !== grant.jti) throw new Error("lease_mismatch");
  if (path === "result") {
    const r = z.object({ schemaVersion: z.literal(1), jobId: z.string(), attemptId: z.string(), inputRevision: z.number(), status: z.enum(["succeeded", "failed", "unknown"]), output: z.unknown().optional(), completedAt: z.number() }).passthrough().parse(raw.result);
    if (r.jobId !== task.id || r.attemptId !== task.attemptId || r.inputRevision !== task.inputRevision || r.completedAt > Date.now() || r.completedAt < task.createdAt) throw new Error("result_binding_mismatch");
    const resultHash = hashText(canonicalJson(r));
    if (lease.resultHash) {
      if (lease.resultHash === resultHash) return { duplicate: true };
      const laterConfirmation = task.status === "unknown" && z.object({ status: z.literal("confirmed") }).safeParse(r.output).success;
      if (!laterConfirmation) {
        task.lateResults = [...(task.lateResults ?? []), { receivedAt: Date.now(), digest: resultHash, status: r.status, sideEffectPossible: task.kind === "publish_reply" }];
        audit(s, { id: "social-worker", name: "Social worker", roles: [] }, "conflicting_callback", "Preserved conflicting callback digest without repeating a transition.", Date.now());
        await writeState(ctx, s); return { received: true, conflict: true };
      }
    }
    if (task.kind === "ingest_social") {
      if (!connectionCurrent || task.status !== "running") {
        task.status = "failed"; task.error = "stale_ingestion_result";
      } else if (r.status !== "succeeded") {
        task.status = "failed"; task.error = "ingestion_requires_connection_review"; connection!.status = "reconnect_required";
        if (connection!.platform === "reddit") {
          const reason = z.object({ message: z.enum(["reddit_rate_limited", "reddit_cursor_gap", "reddit_intake_batch_limit"]) }).safeParse(r.error);
          connection!.detail = reason.success && reason.data.message === "reddit_rate_limited" ? "Reddit rate-limited intake. Automatic polling stopped; the cursor was preserved. Review before reconnecting." : "Reddit intake stopped without advancing its cursor. Review access and any backlog before reconnecting; manual intake remains available.";
        }
      } else {
        const batch = connection!.platform === "reddit" ? redditIngestionSchema.parse(r.output) : z.object({ mode: z.literal("live"), cursorCommitRequired: z.literal(true), nextCursor: z.string().regex(/^\d*$/), items: z.array(z.object({ platform: z.literal("x"), sourceMode: z.literal("live"), externalId: z.string().regex(/^\d+$/), originalUrl: z.string().url(), author: z.string().regex(/^[A-Za-z0-9_]{1,15}$/), text: z.string().min(1).max(20_000), observedAt: z.number().finite() }).strict()).max(20) }).strict().parse(r.output);
        const priorCursor = connection!.cursor ?? "";
        const credential = connection!.platform === "reddit" ? await ctx.db.query("redditCredentials").withIndex("by_connection", q => q.eq("connectionId", grant.connectionId)).unique() : null;
        if (connection!.platform === "reddit") {
          if (process.env.REDDIT_API_APPROVED !== "true" || !credential || credential.connectionVersion !== grant.connectionVersion || s.paused || connection!.paused || connection!.permission !== "granted") throw new Error("reddit_connection_not_ready");
          if (!priorCursor || !Number.isSafeInteger(Number(batch.nextCursor)) || Number(batch.nextCursor) < Number(priorCursor) || Number(batch.nextCursor) > Date.now() || new Set(batch.items.map(item => item.externalId)).size !== batch.items.length) throw new Error("ingestion_cursor_mismatch");
        } else {
          const latest = batch.items.reduce((current, item) => !current || BigInt(item.externalId) > BigInt(current) ? item.externalId : current, priorCursor);
          if (batch.nextCursor !== latest) throw new Error("ingestion_cursor_mismatch");
        }
        let next = s;
        for (const item of batch.items) {
          const target = parseSocialTarget(item.platform, item.originalUrl), path = new URL(item.originalUrl).pathname.split("/");
          if (!target || item.platform !== connection!.platform || target.interactionId !== item.externalId || item.observedAt > Date.now()) throw new Error("ingestion_source_mismatch");
          if (item.platform === "x" ? path[1].toLowerCase() !== item.author.toLowerCase() : path[1] !== "r" || path[2].toLowerCase() !== item.subreddit.toLowerCase() || !credential!.allowedSubreddits.includes(item.subreddit.toLowerCase()) || item.observedAt <= Number(priorCursor) || item.observedAt > Number(batch.nextCursor)) throw new Error("ingestion_source_mismatch");
          next = applyCommand(next, { action: "intake", platform: item.platform, mode: "live", sourceUrl: item.originalUrl, text: item.text, authorId: item.author, observedAt: item.observedAt }, { id: "social-ingestion", name: "Social ingestion worker", roles: [] }, config(), Date.now(), true);
        }
        Object.assign(s, next);
        const updated = s.connections.find(item => item.id === grant.connectionId)!; updated.cursor = batch.nextCursor; updated.lastPolledAt = Date.now(); updated.lastCheckedAt = new Date().toISOString();
        const savedTask = s.tasks.find(item => item.id === task.id)!; savedTask.status = "completed"; savedTask.completedAt = Date.now(); savedTask.resultDigest = resultHash; savedTask.receipt = { count: batch.items.length, nextCursor: batch.nextCursor, mode: "live" };
      }
      audit(s, { id: "social-ingestion", name: "Social ingestion worker", roles: [] }, "ingestion_result", "Account-scoped read result stored; cursor advances only after signals persist.", Date.now());
      await ctx.db.patch(lease._id, { completed: true, resultHash }); await writeState(ctx, s); await ctx.scheduler.runAfter(0, internal.control.pump, {}); return { received: true };
    }
    // Late effect receipts reconcile the old attempt; they never authorize a new send.
    if (task.kind === "publish_reply" && !lease.sendAuthorized && z.object({ status: z.literal("confirmed") }).safeParse(r.output).success) throw new Error("send_was_not_authorized");
    applyTaskResult(s, task, { status: r.status, output: r.output, ...(r.status !== "succeeded" ? { error: "worker_execution_" + r.status } : {}) }, Date.now());
    await ctx.db.patch(lease._id, { completed: true, resultHash }); await writeState(ctx, s); await ctx.scheduler.runAfter(0, internal.control.pump, {}); return { received: true };
  }
  if (!connectionCurrent || lease.completed || lease.expiresAt <= Date.now() || grant.exp <= Date.now() || task.status !== "running") throw new Error("lease_expired_or_revoked");
  if (connection!.platform === "reddit" && process.env.REDDIT_API_APPROVED !== "true") throw new Error("reddit_access_pending");
  if (path === "heartbeat") { await ctx.db.patch(lease._id, { expiresAt: Math.min(Date.now() + 60_000, grant.exp) }); return { alive: true }; }
  if (path !== "authorize-send" || task.kind !== "publish_reply" || raw.publicationId !== p!.id || lease.sendAuthorized) throw new Error("send_authorization_denied");
  if (verifiedIdentity && c!.candidate) {
    const i = z.object({ deploymentId: z.string(), treeDigest: z.string(), checkedAt: z.number() }).parse(verifiedIdentity);
    if (i.deploymentId !== c!.candidate.deploymentId || i.treeDigest !== c!.candidate.treeDigest || Date.now() - i.checkedAt > 10_000 || i.checkedAt > Date.now()) throw new Error("identity_mismatch");
    c!.productionIdentityCheckedAt = i.checkedAt; c!.productionDeploymentId = i.deploymentId; c!.productionTreeDigest = i.treeDigest;
  }
  assertCanPublish(s, c!, p!, Date.now());
  p!.status = "publishing"; p!.attemptedAt = Date.now(); await ctx.db.patch(lease._id, { sendAuthorized: true }); await writeState(ctx, s); return { authorized: true };
} });
