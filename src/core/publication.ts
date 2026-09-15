import { z } from "zod";
import { type ApprovalRequest, validateApproval } from "./approvals";
import { AuthorizationKindSchema, canonicalJson, decision, type Decision, hashText, LIVE_EVIDENCE_MAX_AGE_MS, PlatformSchema, PurposeSchema, type SourceMode } from "./domain";
import { type EligibilityDecision, hasSupportClaim, type PersonaPolicy, universalDraftReasons, validatePolicyActivity } from "./persona";
import { parseSocialTarget } from "./signals";

export const PublishPayloadSchema = z.object({
  platform: PlatformSchema, accountId: z.string().min(1), targetId: z.string().min(1), targetUrl: z.string().url(),
  text: z.string().min(1), textHash: z.string().min(1), contextHash: z.string().min(1), purpose: PurposeSchema,
  authorizationKind: AuthorizationKindSchema, authorizationRef: z.string().min(1), authorizationVersion: z.string().min(1),
  authorizationBinding: z.string().min(1), personaVersion: z.string().min(1),
  policyEvaluationRef: z.string().nullable(), budgetReservationId: z.string().min(1),
  deploymentId: z.string().nullable(), evidenceId: z.string().nullable(),
}).strict();
export type PublishPayload = z.infer<typeof PublishPayloadSchema>;
export interface ApplicabilityEvidence {
  id: string; success: boolean; fictional: boolean; completedAt: number;
  deploymentId: string; treeDigest: string; testRevision: string;
  purpose: "resolution" | "known_fix" | "workaround" | "instructions";
}
export interface PublicationContext {
  workspaceId: string; now: number; payload: PublishPayload; sourceMode: SourceMode; publicationMode: "live" | "fixture";
  workspacePaused: boolean; accountPaused: boolean; optedOut: boolean; blockedAuthor: boolean;
  targetExists: boolean; contactIntent: boolean; currentContextHash: string;
  connectedAccountId: string; connectionReady: boolean; platformPermitted: boolean; platformEligible: boolean;
  platformLengthValid: boolean; budgetReservationValid: boolean;
  reservationMatches: boolean; earlierSendUnresolvedOrConfirmed: boolean;
  currentPersonaVersion: string;
  approval: ApprovalRequest | null; policy: PersonaPolicy | null; eligibility: EligibilityDecision | null;
  draftValidation: { allowed: boolean; textHash: string; contextHash: string };
  evidence: ApplicabilityEvidence | null;
  liveIdentity: { deploymentId: string; treeDigest: string; testRevision: string; checkedAt: number } | null;
}

/** Run inside the same authoritative dispatch transaction as pause/opt-out/reservation checks. */
export function publicationGuard(input: PublicationContext): Decision {
  const parsed = PublishPayloadSchema.safeParse(input.payload);
  if (!parsed.success) return decision(["invalid_publish_payload"]);
  const p = parsed.data;
  const reasons = universalDraftReasons(p.text);
  if (hashText(p.text) !== p.textHash) reasons.push("text_hash_mismatch");
  if (input.sourceMode === "fixture" && input.publicationMode !== "fixture") reasons.push("fixture_live_mismatch");
  if (input.workspacePaused) reasons.push("workspace_paused");
  if (input.accountPaused) reasons.push("account_paused");
  if (input.optedOut) reasons.push("opt_out");
  if (input.blockedAuthor) reasons.push("blocked_author");
  if (!input.targetExists) reasons.push("target_deleted");
  if (!input.contactIntent) reasons.push("missing_contact_intent");
  const target = parseSocialTarget(p.platform, p.targetUrl);
  if (input.publicationMode === "live" && (!target || target.interactionId !== p.targetId)) reasons.push("invalid_target");
  if (input.connectedAccountId !== p.accountId) reasons.push("account_mismatch");
  if (!input.connectionReady) reasons.push("reconnect_required");
  if (!input.platformPermitted) reasons.push("access_pending");
  if (!input.platformEligible) reasons.push("platform_ineligible");
  if (!input.platformLengthValid) reasons.push("platform_text_length");
  if (!input.budgetReservationValid) reasons.push("budget_exhausted");
  if (!input.reservationMatches) reasons.push("reservation_mismatch");
  if (input.earlierSendUnresolvedOrConfirmed) reasons.push("interaction_already_sent_or_unknown");
  if (input.currentContextHash !== p.contextHash) reasons.push("context_changed");
  if (input.currentPersonaVersion !== p.personaVersion) reasons.push("persona_changed");
  if (!input.draftValidation.allowed || input.draftValidation.textHash !== p.textHash || input.draftValidation.contextHash !== p.contextHash) reasons.push("draft_validation_missing_or_stale");

  if (p.authorizationKind === "persona_policy") {
    reasons.push(...validatePolicyActivity(input.policy, { workspaceId: input.workspaceId, version: p.personaVersion, platform: p.platform, accountId: p.accountId }, input.now).reasons);
    if (input.policy?.id !== p.authorizationRef || input.policy?.version !== p.authorizationVersion || input.policy?.configurationHash !== p.authorizationBinding) reasons.push("policy_authorization_mismatch");
    if (p.purpose !== "engagement" || hasSupportClaim(p.text)) reasons.push("support_claim_requires_exact_approval");
    if (!p.policyEvaluationRef || input.eligibility?.decision !== "eligible") reasons.push("current_eligibility_required");
  } else {
    reasons.push(...validateApproval(input.approval, { workspaceId: input.workspaceId, kind: p.authorizationKind,
      binding: p.authorizationBinding, requestId: p.authorizationRef }, input.now).reasons);
    if (String(input.approval?.version) !== p.authorizationVersion) reasons.push("approval_version_mismatch");
    if (p.authorizationKind === "candidate_go" && p.purpose !== "resolution") reasons.push("candidate_go_wrong_purpose");
    // Checking a grant's stored binding alone is insufficient: this exact outgoing reply must be inside it.
    try {
      const bound = JSON.parse(p.authorizationBinding) as { payload: Record<string, unknown> };
      const payload = bound.payload;
      const replies = p.authorizationKind === "candidate_go" ? payload.replies as Record<string, unknown>[] : [payload];
      const matchingReply = replies.find((reply) => reply.textHash === p.textHash && reply.personaVersion === p.personaVersion &&
        reply.platform === p.platform && reply.accountId === p.accountId && reply.targetId === p.targetId && reply.contextHash === p.contextHash && reply.purpose === p.purpose);
      if (!matchingReply) reasons.push("reply_not_in_approved_binding");
      if (p.purpose !== "engagement" && payload.deploymentId !== p.deploymentId) reasons.push("deployment_not_in_approved_binding");
      if (p.authorizationKind === "candidate_go" && (payload.treeDigest !== input.evidence?.treeDigest || payload.testRevision !== input.evidence?.testRevision)) reasons.push("candidate_evidence_binding_mismatch");
      if (p.authorizationKind === "reply_approval" && p.purpose !== "engagement" && payload.evidenceContext !== p.evidenceId) reasons.push("remedy_evidence_binding_mismatch");
    } catch { reasons.push("malformed_approval_binding"); }
  }

  // Purpose governs evidence, including a fresh reply-only grant after a candidate Go expired.
  if (p.purpose === "engagement" && hasSupportClaim(p.text)) reasons.push("engagement_contains_support_claim");
  if (p.purpose !== "engagement") {
    const e = input.evidence, live = input.liveIdentity;
    if (!e || !e.success || e.id !== p.evidenceId || e.purpose !== p.purpose || e.deploymentId !== p.deploymentId) reasons.push("current_applicability_evidence_required");
    if (e?.fictional && input.publicationMode === "live") reasons.push("fictional_evidence_cannot_establish_live_fact");
    if (!e || e.completedAt > input.now || input.now - e.completedAt > LIVE_EVIDENCE_MAX_AGE_MS) reasons.push("live_evidence_stale");
    if (!live || live.checkedAt > input.now || input.now - live.checkedAt > 10_000) reasons.push("immediate_production_identity_required");
    if (!e || !live || live.deploymentId !== e.deploymentId || live.treeDigest !== e.treeDigest || live.testRevision !== e.testRevision) reasons.push("production_identity_changed");
    if (p.purpose === "workaround" && /\b(?:fixed|shipped|deployed|resolved)\b/i.test(p.text)) reasons.push("workaround_mislabeled_as_fix");
  }
  return decision(reasons);
}

export type PublicationStatus = "reserved" | "dispatched" | "confirmed" | "definitely_not_sent" | "unknown" | "manually_attested";
export interface LedgerReservation {
  id: string; key: string; textHash: string; authorizationRef: string; status: PublicationStatus;
  attemptId: string; mode: "live" | "fixture"; reservedAt: number; dispatchedAt?: number;
  receipt?: PublicationReceipt; notSentAttestation?: { operatorId: string; at: number; reason: string; residualUncertainty: true };
}
export interface PublicationReceipt {
  replyId: string; replyUrl: string; accountId: string; targetId: string; actualText: string;
  postedAt: number; mode: "live" | "fixture"; verified: boolean; operatorId?: string; attested?: boolean;
}
export function interactionLedgerKey(workspaceId: string, platform: string, accountId: string, interactionId: string, fixtureNamespace?: string): string {
  return canonicalJson([workspaceId, platform, accountId, fixtureNamespace ? `fixture:${fixtureNamespace}` : "real", interactionId]);
}
export function decideReservation(existing: LedgerReservation | null, request: LedgerReservation): { allowed: boolean; duplicate: boolean; reason?: string } {
  if (request.status !== "reserved" || !request.id || !request.key || !request.attemptId || !request.textHash || !request.authorizationRef || !Number.isFinite(request.reservedAt)) return { allowed: false, duplicate: false, reason: "invalid_reservation_request" };
  if (!existing) return { allowed: true, duplicate: false };
  if (existing.key !== request.key) return { allowed: false, duplicate: false, reason: "ledger_key_mismatch" };
  if (existing.id === request.id && existing.attemptId === request.attemptId && existing.textHash === request.textHash && existing.authorizationRef === request.authorizationRef) return { allowed: false, duplicate: true, reason: "existing_reservation" };
  if (existing.status !== "definitely_not_sent") return { allowed: false, duplicate: false, reason: existing.status === "unknown" ? "publication_unknown" : "interaction_reserved_or_sent" };
  return { allowed: true, duplicate: false };
}
export function recordPublicationResult(record: LedgerReservation, input: {
  attemptId: string; outcome: "confirmed" | "definitely_not_sent" | "unknown"; receipt?: PublicationReceipt;
  expectedAccountId: string; expectedTargetId: string;
}): LedgerReservation {
  if (record.attemptId !== input.attemptId) throw new Error("stale_effect_result_reconcile");
  if (record.status === "confirmed" || record.status === "manually_attested") return record;
  if (input.outcome === "confirmed") {
    const receipt = input.receipt;
    if (!receipt || !receipt.replyId || !receipt.replyUrl || !receipt.verified || receipt.accountId !== input.expectedAccountId || receipt.targetId !== input.expectedTargetId || hashText(receipt.actualText) !== record.textHash || receipt.mode !== record.mode) throw new Error("receipt_mismatch");
    if (receipt.mode === "live" && !parseSocialTarget("x", receipt.replyUrl) && !parseSocialTarget("reddit", receipt.replyUrl)) throw new Error("invalid_receipt_url");
  }
  if (record.status === "unknown" && input.outcome === "definitely_not_sent") throw new Error("explicit_reconciliation_required");
  return { ...record, status: input.outcome, ...(input.receipt ? { receipt: input.receipt } : {}) };
}
export function attestNotSent(record: LedgerReservation, input: { operatorId: string; role: "marketer" | "admin"; reason: string; now: number }): LedgerReservation {
  if (record.status !== "unknown" || !input.reason.trim() || !input.operatorId || !["marketer", "admin"].includes(input.role)) throw new Error("invalid_not_sent_attestation");
  return { ...record, status: "definitely_not_sent", notSentAttestation: { operatorId: input.operatorId, at: input.now, reason: input.reason, residualUncertainty: true } };
}
export function validateManualReceipt(input: {
  receipt: PublicationReceipt; approvedTextHash: string; accountId: string; targetId: string;
  earlierAutomatic: LedgerReservation | null; supplemental: boolean; exactApprovalValid: boolean; policyAuthorityValid?: boolean;
}): Decision {
  const reasons: string[] = [], r = input.receipt;
  if (input.earlierAutomatic?.status === "unknown" || input.earlierAutomatic?.status === "dispatched") reasons.push("publication_unknown");
  if (!r.replyUrl || !r.replyId || !Number.isFinite(r.postedAt) || !r.operatorId) reasons.push("receipt_fields_required");
  if (r.mode === "live" && !parseSocialTarget("x", r.replyUrl) && !parseSocialTarget("reddit", r.replyUrl)) reasons.push("invalid_receipt_url");
  if (!r.verified && !r.attested) reasons.push("verification_or_explicit_attestation_required");
  if (!input.exactApprovalValid && !input.policyAuthorityValid) reasons.push("current_manual_authority_required");
  if (r.accountId !== input.accountId || r.targetId !== input.targetId) reasons.push("receipt_target_mismatch");
  if (hashText(r.actualText) !== input.approvedTextHash) reasons.push("external_text_deviation_requires_recording");
  if (input.supplemental && (!input.exactApprovalValid || !["confirmed", "manually_attested"].includes(input.earlierAutomatic?.status ?? ""))) reasons.push("supplemental_reply_requires_exact_approval_and_prior_receipt");
  if (!input.supplemental && ["confirmed", "manually_attested", "reserved"].includes(input.earlierAutomatic?.status ?? "")) reasons.push("interaction_reserved_or_sent");
  return decision(reasons);
}
