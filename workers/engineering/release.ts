import { z } from "zod";
import type { Provenance, WeatherEvidence } from "./protected-weather";

export const candidateSchema = z.object({
  candidateId: z.string(), repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/), pullNumber: z.number().int().positive(),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/), headSha: z.string().regex(/^[a-f0-9]{40}$/), treeDigest: z.string().regex(/^[a-f0-9]{40}$/),
  trustedTestRevision: z.string(), buildConfigRevision: z.string(), deploymentId: z.string().startsWith("dpl_"), deploymentUrl: z.string().url(),
  productionDomain: z.string(), projectId: z.string(), goRef: z.string(), goExpiresAt: z.number(), replyBatchHash: z.string(),
}).strict();
export type ReleaseCandidate = z.infer<typeof candidateSchema>;
export type ReleaseState = {
  candidateId: string; stage: "prepared" | "merged" | "promoted" | "live_verified";
  previousDeploymentId: string; mergeSha?: string; promotionIntentAt?: number; promotedAt?: number; liveEvidenceRef?: string;
};
export interface ReleaseStore {
  /** Must atomically acquire the single repository/project lock in the durable controller. */
  acquire(candidate: ReleaseCandidate): Promise<{ lockId: string; state?: ReleaseState }>;
  authorize(candidate: ReleaseCandidate, lockId: string, effect: "merge" | "promote" | "verify"): Promise<void>;
  save(lockId: string, state: ReleaseState): Promise<void>;
  release(lockId: string): Promise<void>;
  block(lockId: string, reason: string): Promise<void>;
}
export interface ReleaseProvider {
  currentMain(repository: string): Promise<{ sha: string; tree: string }>;
  pullHead(repository: string, pull: number): Promise<{ headSha: string; merged: boolean; mergeSha?: string }>;
  verifyChecks(candidate: ReleaseCandidate): Promise<void>;
  mergeExpectedHead(candidate: ReleaseCandidate): Promise<{ mergeSha: string }>;
  commitTree(repository: string, sha: string): Promise<string>;
  deployment(id: string): Promise<{ id: string; projectId: string; target: string; state: string; metadata: Record<string, string> }>;
  currentProduction(projectId: string, domain: string): Promise<string>;
  promote(projectId: string, deploymentId: string): Promise<void>;
  verifyLive(candidate: ReleaseCandidate): Promise<{ passed: boolean; evidenceRef: string }>;
}
export function assertDeploymentBinding(candidate: ReleaseCandidate, deployment: Awaited<ReturnType<ReleaseProvider["deployment"]>>) {
  if (deployment.id !== candidate.deploymentId || deployment.projectId !== candidate.projectId || deployment.target !== "production" || deployment.state !== "READY" || deployment.metadata.candidateId !== candidate.candidateId || deployment.metadata.headSha !== candidate.headSha || deployment.metadata.treeDigest !== candidate.treeDigest || deployment.metadata.trustedTestRevision !== candidate.trustedTestRevision || deployment.metadata.buildConfigRevision !== candidate.buildConfigRevision) throw new Error("deployment_provenance_mismatch");
}
export async function releaseExactCandidate(input: ReleaseCandidate, store: ReleaseStore, provider: ReleaseProvider): Promise<ReleaseState> {
  const candidate = candidateSchema.parse(input);
  const { lockId, state: existing } = await store.acquire(candidate);
  let state = existing;
  try {
    if (state && state.candidateId !== candidate.candidateId) throw new Error("release_lock_candidate_mismatch");
    assertDeploymentBinding(candidate, await provider.deployment(candidate.deploymentId));
    if (!state) {
      state = { candidateId: candidate.candidateId, stage: "prepared", previousDeploymentId: await provider.currentProduction(candidate.projectId, candidate.productionDomain) };
      await store.save(lockId, state);
    }
    const main = await provider.currentMain(candidate.repository);
    if (state.stage === "prepared") {
      const pull = await provider.pullHead(candidate.repository, candidate.pullNumber);
      if (pull.headSha !== candidate.headSha) throw new Error("candidate_head_drift");
      if (pull.merged) {
        // Reconcile a crash after the merge API succeeded but before its receipt was persisted.
        if (!pull.mergeSha || pull.mergeSha !== main.sha || await provider.commitTree(candidate.repository, pull.mergeSha) !== candidate.treeDigest) throw new Error("unreconciled_merge_drift");
        state = { ...state, stage: "merged", mergeSha: pull.mergeSha };
      } else {
        if (main.sha !== candidate.baseSha) throw new Error("repository_base_drift");
        await provider.verifyChecks(candidate);
        await authorize("merge");
        const receipt = await provider.mergeExpectedHead(candidate);
        state = { ...state, stage: "merged", mergeSha: receipt.mergeSha };
      }
      // Persist that main advanced even when the subsequent tree comparison fails.
      await store.save(lockId, state);
      if (await provider.commitTree(candidate.repository, state.mergeSha!) !== candidate.treeDigest) throw new Error("merged_tree_mismatch");
    } else if (!state.mergeSha || main.sha !== state.mergeSha || main.tree !== candidate.treeDigest) throw new Error("repository_drift_after_merge");
    if (state.stage === "merged") {
      const currentProduction = await provider.currentProduction(candidate.projectId, candidate.productionDomain);
      if (currentProduction !== candidate.deploymentId) {
        if (currentProduction !== state.previousDeploymentId) throw new Error("production_drift");
        await provider.verifyChecks(candidate);
        await authorize("promote");
        state = { ...state, promotionIntentAt: Date.now() };
        await store.save(lockId, state);
        await provider.promote(candidate.projectId, candidate.deploymentId);
        if (await provider.currentProduction(candidate.projectId, candidate.productionDomain) !== candidate.deploymentId) throw new Error("promotion_pending_reconcile_required");
      } else if (!state.promotionIntentAt) throw new Error("unrecorded_production_change");
      state = { ...state, stage: "promoted", promotedAt: Date.now() };
      await store.save(lockId, state);
    }
    await authorize("verify");
    if (await provider.currentProduction(candidate.projectId, candidate.productionDomain) !== candidate.deploymentId) throw new Error("production_identity_mismatch");
    const verified = await provider.verifyLive(candidate);
    if (!verified.passed) throw new Error("live_verification_failed");
    state = { ...state, stage: "live_verified", liveEvidenceRef: verified.evidenceRef };
    await store.save(lockId, state);
    return state;
    async function authorize(effect: "merge" | "promote" | "verify") {
      if (effect !== "verify" && candidate.goExpiresAt <= Date.now()) throw new Error("go_expired");
      await store.authorize(candidate, lockId, effect);
    }
  } catch (error) {
    await store.block(lockId, error instanceof Error ? error.message : "release_failed");
    throw error;
  } finally { await store.release(lockId); }
}

/** For the last publication guard: identity and behavior must both still be fresh. */
export async function assertFreshLiveEvidence(candidate: ReleaseCandidate, evidence: WeatherEvidence, provider: ReleaseProvider, now = Date.now()) {
  const provenance: Provenance | undefined = evidence.provenance;
  if (evidence.status !== "passed" || !evidence.identityPassed || evidence.mode !== "live" || now - evidence.timestamp > 300_000 || evidence.timestamp > now || provenance?.headSha !== candidate.headSha || provenance.treeDigest !== candidate.treeDigest || provenance.candidateId !== candidate.candidateId || provenance.trustedTestRevision !== candidate.trustedTestRevision || provenance.buildConfigRevision !== candidate.buildConfigRevision) throw new Error("fresh_live_evidence_required");
  if (await provider.currentProduction(candidate.projectId, candidate.productionDomain) !== candidate.deploymentId) throw new Error("production_identity_mismatch");
}
