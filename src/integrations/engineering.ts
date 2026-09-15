import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import type { ActionCtx } from "../../convex/_generated/server";
import type { ControlState, Task } from "../control/types";
import { canonicalJson, hashText } from "../core/domain";
import { callbackSignature } from "../../workers/shared/security";
import { provenanceSchema, type Provenance } from "../../workers/shared/weather-contracts";
import type { WeatherEvidence } from "../../workers/engineering/protected-weather";
import { releaseExactCandidate, type ReleaseCandidate, type ReleaseProvider, type ReleaseStore } from "../../workers/engineering/release";
import { GitHubVercelProvider } from "../../workers/engineering/providers";
import { ProviderAdapters, type ProviderConfig } from "./providers";

const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`configuration_required:${key}`); return value; };
const mutationRef = (name: string) => makeFunctionReference<"mutation", Record<string, unknown>, unknown>(`releaseControl:${name}`);
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const evidenceSchema = z.object({ suiteVersion: z.string(), runId: z.string(), url: z.string().url(), mode: z.enum(["fixture", "live"]), timestamp: z.number(), provenance: provenanceSchema, identityPassed: z.boolean(), identityAssurance: z.enum(["expected_matches", "observed_only"]).optional(), checks: z.array(z.object({ name: z.string(), expected: z.string(), actual: z.string(), passed: z.boolean() })), screenshots: z.array(z.string()), status: z.enum(["passed", "failed"]), seededDefectReproduced: z.boolean(), artifacts: z.array(z.object({ name: z.string(), contentType: z.literal("image/png"), base64: z.string().max(1_400_000) })).max(2).optional() });

export function engineeringProviderConfig(): ProviderConfig {
  return {
    github: { dispatchToken: process.env.GITHUB_DISPATCH_TOKEN ?? required("GITHUB_TOKEN"), readToken: process.env.GITHUB_READ_TOKEN, releaseToken: process.env.GITHUB_RELEASE_TOKEN, repository: required("FDE_WEATHER_REPOSITORY"), controllerRepository: process.env.GITHUB_CONTROLLER_REPOSITORY, controllerBranch: process.env.GITHUB_CONTROLLER_BRANCH ?? "main", engineeringGrantSecret: required("ENGINEERING_GRANT_SECRET") },
    vercel: { token: required("VERCEL_TOKEN"), projectId: required("VERCEL_PROJECT_ID"), projectName: required("VERCEL_PROJECT_NAME"), teamId: process.env.VERCEL_TEAM_ID, productionDomain: required("WEATHER_PRODUCTION_DOMAIN") },
  };
}
async function browserVerify(ctx: ActionCtx, input: { requestId: string; mode: "baseline" | "candidate" | "live"; url: string; expectedProvenance: Provenance }): Promise<WeatherEvidence> {
  const worker = new URL(required("ENGINEERING_WORKER_URL"));
  if (worker.protocol !== "https:" || worker.username || worker.password) throw new Error("engineering_worker_https_required");
  const raw = JSON.stringify({ ...input, approvedHost: new URL(input.url).hostname }), timestamp = String(Date.now());
  const response = await fetch(new URL("/v1/weather/verify", worker), { method: "POST", headers: { "content-type": "application/json", "x-worker-timestamp": timestamp, "x-worker-signature": callbackSignature(raw, timestamp, required("ENGINEERING_VERIFY_SECRET")) }, body: raw, redirect: "error", signal: AbortSignal.timeout(125_000) });
  if (!response.ok) throw new Error(`protected_verifier_http_${response.status}`);
  const result = evidenceSchema.parse(await response.json());
  if (result.runId !== input.requestId || result.url !== new URL(input.url).origin || Object.entries(input.expectedProvenance).some(([key, value]) => result.provenance[key as keyof Provenance] !== value)) throw new Error("protected_evidence_binding_mismatch");
  const screenshots = [];
  for (const artifact of result.artifacts ?? []) {
    const id = await ctx.storage.store(new Blob([Uint8Array.from(Buffer.from(artifact.base64, "base64"))], { type: "image/png" }));
    const url = await ctx.storage.getUrl(id); if (url) screenshots.push(url);
  }
  return { suiteVersion: result.suiteVersion, runId: result.runId, url: result.url, mode: result.mode, timestamp: result.timestamp, provenance: result.provenance, identityPassed: result.identityPassed, identityAssurance: result.identityAssurance, checks: result.checks, screenshots, status: result.status, seededDefectReproduced: result.seededDefectReproduced };
}
function expectedFromMetadata(meta: Record<string, string>, override: Partial<Provenance> = {}): Provenance {
  return provenanceSchema.parse({ schemaVersion: 1, runId: meta.runId, candidateId: meta.candidateId, headSha: meta.headSha, treeDigest: meta.treeDigest, trustedTestRevision: meta.trustedTestRevision, buildConfigRevision: meta.buildConfigRevision, mode: "live", ...override });
}
async function waitReady(adapters: ProviderAdapters, deploymentId: string) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const deployment = await adapters.vercelDeployment(deploymentId);
    if (deployment.readyState === "READY") return deployment;
    if (["ERROR", "CANCELED"].includes(deployment.readyState)) throw new Error("candidate_deployment_failed");
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error("candidate_deployment_pending_retry_verification");
}

/** Called only after Convex Workflow persists/claims this exact task. Every effect rechecks authoritative state. */
export async function executeEngineering(ctx: ActionCtx, task: Task, state: ControlState): Promise<Record<string, unknown>> {
  const c = state.cases.find(item => item.id === task.caseId);
  if (!c || state.mode !== "live" || task.status !== "running") throw new Error("current_live_engineering_task_required");
  const config = engineeringProviderConfig(), adapters = new ProviderAdapters(config), authorize = () => ctx.runMutation(mutationRef("authorizeTask"), { taskId: task.id, attemptId: task.attemptId });
  const releaseProvider = (verify: ReleaseProvider["verifyLive"]) => new GitHubVercelProvider({ githubReleaseToken: required("GITHUB_RELEASE_TOKEN"), vercelReleaseToken: process.env.VERCEL_RELEASE_TOKEN ?? required("VERCEL_TOKEN"), vercelTeamId: process.env.VERCEL_TEAM_ID, defaultBranch: process.env.GITHUB_DEFAULT_BRANCH ?? "main", requiredChecks: (process.env.GITHUB_REQUIRED_CHECKS ?? "Protected weather").split(",").map(value => value.trim()), verify });

  if (task.kind === "reproduce" || task.kind === "verify_remedy") {
    await authorize();
    const production = await adapters.vercelProductionIdentity(), deployment = await adapters.vercelDeployment(production.deploymentId);
    if (task.kind === "verify_remedy" && (!c.candidate || production.deploymentId !== c.candidate.deploymentId)) throw new Error("current_remedy_deployment_mismatch");
    const expected = expectedFromMetadata(deployment.meta);
    if (task.kind === "reproduce" && expected.headSha !== c.baseSha) throw new Error("baseline_revision_drift");
    const verified = await browserVerify(ctx, { requestId: task.id, mode: "baseline", url: `https://${production.domain}`, expectedProvenance: expected });
    return { ...verified, verificationPurpose: "baseline", deploymentId: production.deploymentId, productionIdentityCheckedAt: Date.now() };
  }
  if (task.kind === "stage_candidate") {
    await authorize();
    const payload = z.object({ headSha: z.string(), treeDigest: z.string(), pullNumber: z.number().int(), pullUrl: z.string().url() }).parse(task.payload);
    const checks = await adapters.githubInspectCandidate({ repository: c.repository, pullNumber: payload.pullNumber, expectedBaseSha: c.baseSha, expectedHeadSha: payload.headSha, requiredChecks: (process.env.GITHUB_REQUIRED_CHECKS ?? "Protected weather").split(",").map(value => value.trim()) });
    if (checks.treeDigest !== payload.treeDigest) throw new Error("candidate_tree_mismatch");
    const metadata = { runId: task.id, candidateId: `${c.id}-${payload.headSha.slice(0, 12)}`, headSha: payload.headSha, treeDigest: payload.treeDigest, trustedTestRevision: process.env.WEATHER_TRUSTED_TEST_REVISION ?? "weather-protected-v1", buildConfigRevision: process.env.WEATHER_BUILD_CONFIG_REVISION ?? "weather-build-v1" };
    let deployment = await adapters.vercelFindCandidate(metadata.candidateId);
    if (!deployment) {
      const files = await adapters.githubCommittedWeatherFiles(payload.headSha, payload.treeDigest);
      await authorize();
      const created = await adapters.vercelCreateStaged({ files, metadata });
      deployment = await adapters.vercelDeployment(created.id);
    }
    if (deployment.meta.headSha !== metadata.headSha || deployment.meta.treeDigest !== metadata.treeDigest || deployment.meta.candidateId !== metadata.candidateId || deployment.target !== "production") throw new Error("staged_candidate_binding_mismatch");
    return { ...payload, candidateId: metadata.candidateId, runId: deployment.meta.runId, deploymentId: deployment.id, deploymentUrl: `https://${deployment.url}`, testRevision: metadata.trustedTestRevision, buildConfigRevision: metadata.buildConfigRevision, status: "staging", provenance: expectedFromMetadata(deployment.meta) };
  }
  if (task.kind === "verify_candidate" || task.kind === "verify_live") {
    await authorize();
    if (!c.candidate) throw new Error("candidate_missing");
    const deployment = await waitReady(adapters, c.candidate.deploymentId), expected = expectedFromMetadata(deployment.meta, { headSha: c.candidate.headSha, treeDigest: c.candidate.treeDigest, trustedTestRevision: c.testRevision, buildConfigRevision: c.buildConfigRevision });
    if (task.kind === "verify_live") { const production = await adapters.vercelProductionIdentity(); if (production.deploymentId !== c.candidate.deploymentId) throw new Error("production_identity_mismatch"); }
    return { ...await browserVerify(ctx, { requestId: task.id, mode: task.kind === "verify_live" ? "live" : "candidate", url: task.kind === "verify_live" ? `https://${config.vercel!.productionDomain}` : `https://${deployment.url}`, expectedProvenance: expected }) };
  }
  if (task.kind === "release_candidate") {
    if (!c.candidate) throw new Error("candidate_missing");
    const authority = state.authorities.find(item => item.request.requestId === task.payload.authorityId && item.caseId === c.id && item.request.kind === "candidate_go");
    if (!authority) throw new Error("candidate_go_required");
    const stageTask = state.tasks.findLast(item => item.caseId === c.id && item.kind === "stage_candidate" && item.status === "completed" && z.object({ deploymentId: z.literal(c.candidate!.deploymentId) }).safeParse(item.receipt).success);
    const stage = z.object({ pullNumber: z.number(), candidateId: z.string(), provenance: provenanceSchema }).parse(stageTask?.receipt);
    const candidate: ReleaseCandidate = { candidateId: stage.candidateId, repository: c.repository, pullNumber: stage.pullNumber, baseSha: c.baseSha, headSha: c.candidate.headSha, treeDigest: c.candidate.treeDigest, trustedTestRevision: c.testRevision!, buildConfigRevision: c.buildConfigRevision!, deploymentId: c.candidate.deploymentId, deploymentUrl: c.candidate.productionUrl!, productionDomain: config.vercel!.productionDomain, projectId: config.vercel!.projectId, goRef: authority.request.requestId, goExpiresAt: authority.request.grantExpiresAt ?? 0, replyBatchHash: hashText(canonicalJson(authority.payload.replies)) };
    let verification: WeatherEvidence | undefined;
    const provider = releaseProvider(async () => {
      verification = await browserVerify(ctx, { requestId: task.id, mode: "live", url: `https://${candidate.productionDomain}`, expectedProvenance: stage.provenance });
      return { passed: verification.status === "passed" && verification.identityPassed, evidenceRef: task.id };
    });
    const store: ReleaseStore = {
      acquire: async input => z.object({ lockId: z.string(), state: z.unknown().optional() }).parse(await ctx.runMutation(mutationRef("acquire"), { taskId: task.id, attemptId: task.attemptId, candidate: clean(input) })) as Awaited<ReturnType<ReleaseStore["acquire"]>>,
      authorize: async (input, lockId, effect) => { await ctx.runMutation(mutationRef("authorize"), { taskId: task.id, attemptId: task.attemptId, lockId, candidate: clean(input), effect }); },
      save: async (lockId, releaseState) => { await ctx.runMutation(mutationRef("save"), { lockId, state: clean(releaseState) }); },
      release: async lockId => { await ctx.runMutation(mutationRef("release"), { lockId }); },
      block: async (lockId, reason) => { await ctx.runMutation(mutationRef("release"), { lockId, blockedReason: reason }); },
    };
    const result = await releaseExactCandidate(candidate, store, provider);
    if (await provider.currentProduction(candidate.projectId, candidate.productionDomain) !== candidate.deploymentId) throw new Error("production_identity_changed_after_verification");
    return clean({ ...result, deploymentId: candidate.deploymentId, treeDigest: candidate.treeDigest, productionUrl: `https://${candidate.productionDomain}`, verification, productionIdentityCheckedAt: Date.now() });
  }
  if (task.kind === "rollback_deployment") {
    await authorize();
    const rollback = z.object({ operatorAuthorizationRef: z.string(), operatorId: z.string(), operatorRole: z.enum(["engineer", "admin"]), previousDeploymentId: z.string().startsWith("dpl_") }).parse(task.payload);
    const { lockId } = z.object({ lockId: z.string() }).parse(await ctx.runMutation(mutationRef("acquireRollback"), { taskId: task.id, attemptId: task.attemptId, projectId: config.vercel!.projectId }));
    try {
      const deployment = await adapters.vercelDeployment(rollback.previousDeploymentId), expected = expectedFromMetadata(deployment.meta);
      const provider = releaseProvider(async () => { throw new Error("not_used_for_rollback"); });
      if (await provider.currentProduction(config.vercel!.projectId, config.vercel!.productionDomain) !== rollback.previousDeploymentId) {
        await authorize(); await provider.promote(config.vercel!.projectId, rollback.previousDeploymentId);
      }
      if (await provider.currentProduction(config.vercel!.projectId, config.vercel!.productionDomain) !== rollback.previousDeploymentId) throw new Error("rollback_promotion_pending_reconciliation");
      const verification = await browserVerify(ctx, { requestId: task.id, mode: "live", url: `https://${config.vercel!.productionDomain}`, expectedProvenance: expected });
      if (!verification.identityPassed || await provider.currentProduction(config.vercel!.projectId, config.vercel!.productionDomain) !== rollback.previousDeploymentId) throw new Error("rollback_identity_verification_failed");
      await ctx.runMutation(mutationRef("finishRollback"), { lockId, taskId: task.id, attemptId: task.attemptId, deploymentId: rollback.previousDeploymentId });
      return { status: "rolled_back", ...rollback, deploymentId: rollback.previousDeploymentId, verification, productionIdentityCheckedAt: Date.now() };
    } finally { await ctx.runMutation(mutationRef("release"), { lockId }); }
  }
  throw new Error("unsupported_engineering_operation");
}
