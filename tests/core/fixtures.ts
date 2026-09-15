import { approvalBinding, canonicalJson, createApprovalRequest, decideApproval, hashText, PERSONA_PRESETS, type ApprovalRequest, type CandidateBinding, type Membership, type PersonaPolicy, type PublicationContext, type PublishPayload, type ReplyBinding } from "../../src/core";

export const NOW = 1_800_000_000_000;
export const engineer: Membership = { workspaceId: "ws", userId: "engineer", roles: ["engineer"], active: true, slackTeamId: "T1", slackUserId: "UE" };
export const marketer: Membership = { workspaceId: "ws", userId: "marketer", roles: ["marketer"], active: true, slackTeamId: "T1", slackUserId: "UM" };
export const text = "Fixed: 20°C now correctly shows 68°F. Thanks for catching it.";
export const reply: ReplyBinding = { draftId: "draft-1", textHash: hashText(text), personaVersion: "1", platform: "x", accountId: "brand", targetId: "123", contextHash: "context-1", purpose: "resolution" };
export const candidate: CandidateBinding = {
  repository: "owned/weather", baseSha: "base", headSha: "candidate-head", treeDigest: "tree-approved", deploymentId: "deployment-approved", testRevision: "trusted-tests-v1", buildConfigRevision: "build-v1", checkEvidenceDigest: "protected-checks-1", targetEnvironment: "production", replies: [reply],
};
export function grant(kind: "build" | "candidate_go" | "reply_approval" | "persona_policy", payload: unknown, now = NOW): ApprovalRequest {
  const request = createApprovalRequest({ requestId: `approval-${kind}`, workspaceId: "ws", kind, version: 1, payload, now: now - 1000 });
  return decideApproval(request, { currentRequestId: request.requestId, expectedVersion: 1, expectedBinding: request.binding, actor: kind === "build" ? engineer : marketer, decision: "approved", now }).request;
}
export function policy(): PersonaPolicy {
  const config = { ...structuredClone(PERSONA_PRESETS[2].config), autonomyEnabled: true, accountIds: ["brand"] };
  return { id: "policy-1", workspaceId: "ws", version: "1", configurationHash: hashText(canonicalJson(config)), config, status: "active", approvedBy: "marketer", approvedRole: "marketer", approvalRef: "activation-1", activatedAt: NOW - 1000, expiresAt: NOW + 86_400_000 };
}
export function publication(): PublicationContext {
  const payload: PublishPayload = { platform: "x", accountId: "brand", targetId: "123", targetUrl: "https://x.com/customer/status/123", text, textHash: hashText(text), contextHash: "context-1", purpose: "resolution", authorizationKind: "candidate_go", authorizationRef: "approval-candidate_go", authorizationVersion: "1", authorizationBinding: approvalBinding("candidate_go", candidate), personaVersion: "1", policyEvaluationRef: null, budgetReservationId: "budget-1", deploymentId: candidate.deploymentId, evidenceId: "live-1" };
  return { workspaceId: "ws", now: NOW, payload, sourceMode: "manual", publicationMode: "live", workspacePaused: false, accountPaused: false, optedOut: false, blockedAuthor: false, targetExists: true, contactIntent: true, currentContextHash: "context-1", connectedAccountId: "brand", connectionReady: true, platformPermitted: true, platformEligible: true, platformLengthValid: true, budgetReservationValid: true, reservationMatches: true, earlierSendUnresolvedOrConfirmed: false, currentPersonaVersion: "1", approval: grant("candidate_go", candidate), policy: null, eligibility: null,
    draftValidation: { allowed: true, textHash: hashText(text), contextHash: "context-1" },
    evidence: { id: "live-1", success: true, fictional: false, completedAt: NOW - 1000, deploymentId: candidate.deploymentId, treeDigest: candidate.treeDigest, testRevision: candidate.testRevision, purpose: "resolution" },
    liveIdentity: { deploymentId: candidate.deploymentId, treeDigest: candidate.treeDigest, testRevision: candidate.testRevision, checkedAt: NOW },
  };
}
export function engagementPublication(): PublicationContext {
  const p = publication(), active = policy(), draft = "bruh";
  p.payload = { ...p.payload, text: draft, textHash: hashText(draft), purpose: "engagement", deploymentId: null, evidenceId: null,
    authorizationKind: "persona_policy", authorizationRef: active.id, authorizationVersion: active.version, authorizationBinding: active.configurationHash, policyEvaluationRef: "evaluation-1" };
  p.draftValidation.textHash = hashText(draft); p.policy = active; p.approval = null; p.evidence = null; p.liveIdentity = null;
  p.eligibility = { decision: "eligible", reasons: [], evidence: ["Harmless direct joke"] };
  return p;
}
