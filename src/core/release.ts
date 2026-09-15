import { approvalBinding, type ApprovalRequest, type CandidateBinding, validateApproval } from "./approvals";
import { decision, type Decision } from "./domain";

export type ReleaseSubstage = "prepared" | "merged" | "promoted" | "live_verified";
export interface ReleaseRecord {
  caseId: string; candidate: CandidateBinding; substage: ReleaseSubstage;
  mergeSha?: string; mergeTree?: string; previousDeploymentId?: string;
  promotionOutcome?: "confirmed" | "definitely_not_promoted" | "unknown";
  promotedDeploymentId?: string;
}
export interface ReleaseContext {
  workspaceId: string; now: number; release: ReleaseRecord; approval: ApprovalRequest | null;
  currentMainSha: string; currentMainTree: string; currentPrHeadSha: string;
  trustedTestRevision: string; buildConfigRevision: string; checkEvidenceDigest: string;
  checksPassed: boolean; accountReady: boolean; workspacePaused: boolean;
  releaseLockOwner: string | null; currentStagedDeploymentId: string; stagedProductionBuild: boolean;
  autoProductionAssignmentDisabled: boolean;
}
export function releaseGuard(input: ReleaseContext): Decision {
  const r = input.release, c = r.candidate;
  const reasons = validateApproval(input.approval, { workspaceId: input.workspaceId, kind: "candidate_go", binding: approvalBinding("candidate_go", c) }, input.now).reasons;
  if (input.workspacePaused) reasons.push("workspace_paused");
  if (input.releaseLockOwner !== r.caseId) reasons.push("release_lock_required");
  if (!input.accountReady) reasons.push("account_not_ready");
  if (!input.checksPassed || input.checkEvidenceDigest !== c.checkEvidenceDigest || input.trustedTestRevision !== c.testRevision || input.buildConfigRevision !== c.buildConfigRevision) reasons.push("candidate_checks_or_configuration_changed");
  if (input.currentPrHeadSha !== c.headSha) reasons.push("pr_head_changed");
  if (!input.stagedProductionBuild || !input.autoProductionAssignmentDisabled || input.currentStagedDeploymentId !== c.deploymentId) reasons.push("exact_staged_production_deployment_required");
  if (r.substage === "prepared") {
    if (input.currentMainSha !== c.baseSha) reasons.push("base_revision_drift");
  } else {
    // A merge advancing main is expected; resume exactly that recorded merge without merging again.
    if (!r.mergeSha || input.currentMainSha !== r.mergeSha || r.mergeTree !== c.treeDigest || input.currentMainTree !== c.treeDigest) reasons.push("merged_tree_or_main_drift");
  }
  if (r.substage === "promoted" || r.substage === "live_verified") {
    if (r.promotedDeploymentId !== c.deploymentId || r.promotionOutcome !== "confirmed") reasons.push("promotion_receipt_required");
  }
  return decision(reasons);
}
export function resumeRelease(input: ReleaseContext): { action: "merge_expected_head" | "promote_exact_deployment" | "reconcile_promotion" | "verify_live" | "complete" | "blocked"; reasons: string[] } {
  const guard = releaseGuard(input);
  if (!guard.allowed) return { action: "blocked", reasons: guard.reasons };
  const release = input.release;
  if (release.substage === "prepared") return { action: "merge_expected_head", reasons: [] };
  if (release.substage === "merged") return { action: release.promotionOutcome === "unknown" ? "reconcile_promotion" : "promote_exact_deployment", reasons: [] };
  return { action: release.substage === "promoted" ? "verify_live" : "complete", reasons: [] };
}
export function recordMerge(release: ReleaseRecord, receipt: { expectedHeadSha: string; mergeSha: string; treeDigest: string }): ReleaseRecord {
  if (release.substage !== "prepared" || receipt.expectedHeadSha !== release.candidate.headSha || receipt.treeDigest !== release.candidate.treeDigest || !receipt.mergeSha) throw new Error("merge_head_or_tree_mismatch");
  return { ...release, substage: "merged", mergeSha: receipt.mergeSha, mergeTree: receipt.treeDigest };
}
export function recordPromotion(release: ReleaseRecord, receipt: { deploymentId: string; previousDeploymentId: string; rebuilt: boolean }): ReleaseRecord {
  if (release.substage !== "merged" || receipt.deploymentId !== release.candidate.deploymentId || receipt.rebuilt) throw new Error("promotion_must_use_exact_staged_deployment_without_rebuild");
  return { ...release, substage: "promoted", promotionOutcome: "confirmed", promotedDeploymentId: receipt.deploymentId, previousDeploymentId: receipt.previousDeploymentId };
}

export function isAllowedPatchPath(path: string, allowedPaths: string[]): boolean {
  if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "." || !part)) return false;
  if (/(^|\/)(?:node_modules|\.git|\.github|tests?|__tests__|fixtures?|scripts?|protected|credentials?)(\/|$)/i.test(path)) return false;
  if (/(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|[^/]*\.config\.[^/]+|Dockerfile|[^/]*\.(?:test|spec)\.[^/]+|\.env(?:\.[^/]*)?|[^/]*(?:version|identity|approval|secret|fixture)[^/]*)$/i.test(path)) return false;
  return allowedPaths.some((allowed) => allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed);
}
export function validatePatchPaths(paths: { path: string; isSymlink?: boolean; resolvedInsideRepository?: boolean }[], allowedPaths: string[]): Decision {
  const reasons: string[] = [];
  for (const file of paths) {
    if (!isAllowedPatchPath(file.path, allowedPaths)) reasons.push(`prohibited_patch_path:${file.path}`);
    if (file.isSymlink || file.resolvedInsideRepository === false) reasons.push(`symlink_or_repository_escape:${file.path}`);
  }
  return decision(reasons);
}
