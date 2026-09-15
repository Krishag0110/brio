"use node";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { ProviderAdapters, type ProviderConfig } from "../src/integrations/providers";
import { signGrant, requireSecret } from "../workers/shared/security";
import { buildRequestSchema } from "../workers/engineering/coding-runner";
import { bindingPayload } from "../src/control/reducer";
import { approvalBinding } from "../src/core/approvals";
import { hashText } from "../src/core/domain";
import type { ControlState, Task } from "../src/control/types";
import { executeEngineering } from "../src/integrations/engineering";
export function providerConfig(): ProviderConfig {
  return {
    slack: { token: process.env.SLACK_BOT_TOKEN ?? "", channel: process.env.SLACK_CHANNEL_ID ?? "", teamId: process.env.SLACK_TEAM_ID ?? "" },
    linear: { apiKey: process.env.LINEAR_API_KEY ?? "", teamId: process.env.LINEAR_TEAM_ID ?? "" },
    github: { dispatchToken: process.env.GITHUB_DISPATCH_TOKEN ?? process.env.GITHUB_TOKEN ?? "", readToken: process.env.GITHUB_READ_TOKEN ?? process.env.GITHUB_TOKEN, releaseToken: process.env.GITHUB_RELEASE_TOKEN, repository: process.env.FDE_WEATHER_REPOSITORY ?? "", controllerRepository: process.env.GITHUB_CONTROLLER_REPOSITORY, controllerBranch: process.env.GITHUB_CONTROLLER_BRANCH ?? "main", engineeringGrantSecret: process.env.ENGINEERING_GRANT_SECRET ?? "" },
    vercel: { token: process.env.VERCEL_TOKEN ?? "", projectId: process.env.VERCEL_PROJECT_ID ?? "", projectName: process.env.VERCEL_PROJECT_NAME ?? "", teamId: process.env.VERCEL_TEAM_ID, productionDomain: process.env.WEATHER_PRODUCTION_DOMAIN ?? process.env.VERCEL_PRODUCTION_DOMAIN ?? "" },
  };
}
async function executeTask(ctx: ActionCtx, task: Task, state: ControlState): Promise<{ status: "succeeded" | "dispatched"; output: unknown }> {
  const providers = new ProviderAdapters(providerConfig());
  const c = state.cases.find(c => c.id === task.caseId);
  if (c?.canceledAt) throw new Error("case_canceled");
  if (["triage", "draft_reply", "evaluate_persona"].includes(task.kind)) return { status: "succeeded", output: await ctx.runAction(internal.agents.runTask, { taskId: task.id, attemptId: task.attemptId }) };
  if (["reproduce", "stage_candidate", "verify_candidate", "verify_live", "verify_remedy", "release_candidate", "rollback_deployment"].includes(task.kind)) return { status: "succeeded", output: await executeEngineering(ctx, task, state) };
  if (task.kind === "slack_approval") {
    const a = state.authorities.find(a => a.request.requestId === task.payload.authorityId); if (!a || a.request.status !== "pending") throw new Error("approval_not_pending");
    const receipt = await providers.slackPostApproval({ caseId: c?.id ?? "policy:" + a.personaId, authorityId: a.request.requestId, kind: a.request.kind, bindingHash: hashText(a.request.binding), title: `${a.request.kind}: ${c?.title ?? a.personaId}`, summary: JSON.stringify(a.payload), appUrl: new URL(c ? "/cases/" + c.id : "/persona", process.env.CONTROL_APP_ORIGIN).href, expiresAt: a.request.expiresAt, threadTs: c?.slackThreadTs });
    return { status: "succeeded", output: { ...receipt, url: `https://app.slack.com/archives/${receipt.channel}/p${receipt.ts.replace(".", "")}` } };
  }
  if (["publish_reply", "reconcile_publication", "ingest_social"].includes(task.kind)) {
    const url = new URL(process.env.SOCIAL_WORKER_URL ?? ""); if (url.protocol !== "https:" || url.username || url.password) throw new Error("configuration_required:SOCIAL_WORKER_URL");
    const secret = requireSecret(process.env.SOCIAL_GRANT_SECRET, "SOCIAL_GRANT_SECRET");
    const grant = await ctx.runMutation(internal.workerControl.createSocial, { taskId: task.id, attemptId: task.attemptId });
    const response = await fetch(new URL("/v1/jobs", url), { method: "POST", headers: { authorization: "Bearer " + signGrant(grant, secret), "content-type": "application/json" }, body: JSON.stringify({ jobId: task.id, attemptId: task.attemptId }), signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new Error("worker_dispatch_uncertain");
    return { status: "dispatched", output: { accepted: true, jobId: task.id } };
  }
  if (task.kind === "slack_reminder") {
    const authority = state.authorities.find(a => a.request.requestId === task.payload.authorityId);
    const initial = state.tasks.find(t => t.kind === "slack_approval" && t.payload.authorityId === task.payload.authorityId && t.status === "completed");
    const receipt = initial?.receipt as { ts?: string } | undefined;
    if (!authority || authority.request.status !== "pending" || !receipt?.ts || authority.request.expiresAt <= Date.now()) return { status: "succeeded", output: { skipped: true } };
    return { status: "succeeded", output: await providers.slackPostStatus({ caseId: c?.id ?? "policy:" + authority.personaId, threadTs: receipt.ts, text: "Approval is waiting for the designated role. Review the original card before its expiry; no action runs without a current decision." }) };
  }
  if (!c) throw new Error("case_missing");
  if (task.kind === "linear_create") return { status: "succeeded", output: await providers.linearCreateIssue({ caseId: c.id, title: c.title, description: `Untrusted feedback:\n${c.text}\n\nEvidence:\n${JSON.stringify(c.evidence)}\n\nControl case: ${process.env.CONTROL_APP_ORIGIN}/cases/${c.id}` }) };
  if (task.kind === "linear_update") {
    if (!c.linearId || !process.env.LINEAR_RELEASED_STATE_ID) throw new Error("configuration_required:LINEAR_RELEASED_STATE_ID");
    return { status: "succeeded", output: await providers.linearUpdateIssue({ issueId: c.linearId, stateId: process.env.LINEAR_RELEASED_STATE_ID }) };
  }
  if (task.kind === "build_candidate") {
    const a = state.authorities.find(a => a.request.requestId === task.payload.authorityId); if (!a || a.request.kind !== "build") throw new Error("build_missing");
    const binding = bindingPayload(state, a);
    const build = buildRequestSchema.parse({ jobId: task.id, attemptId: task.attemptId, workspaceId: state.workspaceId, caseId: c.id, authorizationRef: a.request.requestId, authorizationExpiresAt: a.request.grantExpiresAt ?? 0, scopeHash: hashText(approvalBinding("build", binding)), repository: c.repository, baseSha: c.baseSha, trustedControllerSha: process.env.GITHUB_CONTROLLER_SHA, allowedPaths: c.scope, approvedPlan: "Repair the reproduced temperature conversion defect within the allowlisted arithmetic helper.", acceptanceCriteria: binding.acceptanceCriteria, linearUrl: c.evidence.find(e => e.label === "Linear engineering issue")?.url, buildConfigRevision: process.env.WEATHER_BUILD_CONFIG_REVISION ?? "weather-build-v1" });
    await ctx.runMutation(internal.workerControl.bindBuild, { taskId: task.id, attemptId: task.attemptId, build });
    return { status: "dispatched", output: await providers.githubDispatchCoding({ build }) };
  }

  throw new Error("unsupported_task_kind");
}
export const execute = internalAction({ args: { taskId: v.string(), attemptId: v.string() }, handler: async (ctx, a): Promise<null> => {
  const state: ControlState = await ctx.runQuery(internal.control.stateForAction, {}), task = state.tasks.find(t => t.id === a.taskId && t.attemptId === a.attemptId && t.status === "running");
  if (!task) return null;
  try { await ctx.runMutation(internal.control.taskResult, { ...a, result: await executeTask(ctx, task, state) }); }
  catch (error) {
    const message = error instanceof Error && /^[a-zA-Z0-9_:.-]{1,150}$/.test(error.message) ? error.message : "execution_failed";
    const beforeEffect = message.startsWith("configuration_required") || message.startsWith("stale_") || message.endsWith("_missing") || ["build_authority_invalid", "engineering_scope_denied", "workspace_paused", "case_canceled"].includes(message);
    await ctx.runMutation(internal.control.taskResult, { ...a, result: { status: beforeEffect || ["triage", "draft_reply", "reproduce", "verify_candidate", "verify_live", "verify_remedy", "evaluate_persona"].includes(task.kind) ? "failed" : "unknown", error: message } });
  }
  return null;
} });
export const authorizeSocialSend = internalAction({ args: { data: v.any() }, handler: async (ctx, a): Promise<unknown> => {
  const s: ControlState = await ctx.runQuery(internal.control.stateForAction, {});
  const task = s.tasks.find(t => t.id === a.data.grant?.jobId); const c = s.cases.find(c => c.id === task?.caseId), p = c?.publications.find(p => p.id === a.data.publicationId);
  let verifiedIdentity: { deploymentId: string; treeDigest: string; checkedAt: number } | undefined;
  if (p?.purpose !== "engagement" && p?.mode === "live") {
    if (!c?.candidate) throw new Error("candidate_missing");
    const provider = new ProviderAdapters(providerConfig()); const identity = await provider.vercelProductionIdentity(); const deployment = await provider.vercelDeployment(identity.deploymentId);
    if (identity.deploymentId !== c.candidate.deploymentId || deployment.meta.treeDigest !== c.candidate.treeDigest || deployment.meta.headSha !== c.candidate.headSha || deployment.meta.trustedTestRevision !== c.testRevision || deployment.meta.buildConfigRevision !== c.buildConfigRevision || deployment.readyState !== "READY") throw new Error("production_identity_mismatch");
    verifiedIdentity = { deploymentId: identity.deploymentId, treeDigest: c.candidate.treeDigest, checkedAt: Date.now() };
  }
  return ctx.runMutation(internal.workerControl.callback, { path: "authorize-send", data: a.data, ...(verifiedIdentity ? { verifiedIdentity } : {}) });
} });
