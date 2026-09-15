import { describe, expect, it } from "vitest";
import { approvalBinding, attestNotSent, decideReservation, hashText, interactionLedgerKey, publicationGuard, recordPublicationResult, validateManualReceipt, type LedgerReservation, type PublicationContext, type PublicationReceipt } from "../../src/core";
import { engagementPublication, grant, NOW, publication, reply } from "./fixtures";

describe("A05/A08/A09 shared publication guard", () => {
  it("admits an exact approved fix only with fresh live verification and current identity", () => expect(publicationGuard(publication())).toEqual({ allowed: true, reasons: [] }));
  it.each([
    ["workspace_paused", { workspacePaused: true }], ["account_paused", { accountPaused: true }], ["opt_out", { optedOut: true }],
    ["blocked_author", { blockedAuthor: true }], ["target_deleted", { targetExists: false }], ["missing_contact_intent", { contactIntent: false }],
    ["context_changed", { currentContextHash: "edited" }], ["account_mismatch", { connectedAccountId: "wrong" }], ["reconnect_required", { connectionReady: false }],
    ["access_pending", { platformPermitted: false }], ["platform_ineligible", { platformEligible: false }], ["platform_text_length", { platformLengthValid: false }],
    ["budget_exhausted", { budgetReservationValid: false }], ["reservation_mismatch", { reservationMatches: false }],
    ["interaction_already_sent_or_unknown", { earlierSendUnresolvedOrConfirmed: true }], ["persona_changed", { currentPersonaVersion: "2" }],
    ["missing_approval", { approval: null }], ["current_applicability_evidence_required", { evidence: null }],
    ["immediate_production_identity_required", { liveIdentity: null }], ["fixture_live_mismatch", { sourceMode: "fixture" }],
  ] as [string, Partial<PublicationContext>][])("independently enforces %s", (reason, changes) => {
    const result = publicationGuard({ ...publication(), ...changes });
    expect(result.allowed).toBe(false); expect(result.reasons).toContain(reason);
  });
  it("cannot change wording while retaining an old approval binding", () => {
    const p = publication(); p.payload.text = "A different approved-looking fix statement."; p.payload.textHash = hashText(p.payload.text); p.draftValidation.textHash = p.payload.textHash;
    expect(publicationGuard(p).reasons).toContain("reply_not_in_approved_binding");
  });
  it("does not truncate or normalize approved text at dispatch", () => {
    const p = publication(); p.payload.text += " "; expect(publicationGuard(p).reasons).toContain("text_hash_mismatch");
  });
  it("rejects candidate-only evidence, stale live tests, and later production drift", () => {
    const p = publication(); p.evidence!.success = false; expect(publicationGuard(p).allowed).toBe(false);
    p.evidence!.success = true; p.evidence!.completedAt = NOW - 300_001;
    expect(publicationGuard(p).reasons).toContain("live_evidence_stale");
    p.evidence!.completedAt = NOW; p.liveIdentity!.deploymentId = "manual-release";
    expect(publicationGuard(p).reasons).toContain("production_identity_changed");
  });
  it("renewed reply-only approval after Go expiry still requires the approved deployment live", () => {
    const p = publication(); const binding = { ...reply, evidenceContext: "live-1", deploymentId: p.payload.deploymentId };
    p.approval = grant("reply_approval", binding); p.payload.authorizationKind = "reply_approval"; p.payload.authorizationRef = p.approval.requestId;
    p.payload.authorizationBinding = approvalBinding("reply_approval", binding);
    expect(publicationGuard(p).allowed).toBe(true);
    p.evidence!.completedAt = NOW - 300_001; expect(publicationGuard(p).allowed).toBe(false);
    p.evidence!.completedAt = NOW; p.liveIdentity!.treeDigest = "other-tree"; expect(publicationGuard(p).allowed).toBe(false);
  });
  it("fictional remedy seeds cannot establish live facts; wrong-purpose evidence cannot substitute", () => {
    const p = publication(); p.evidence!.fictional = true;
    expect(publicationGuard(p).reasons).toContain("fictional_evidence_cannot_establish_live_fact");
    p.evidence!.fictional = false; p.evidence!.purpose = "workaround";
    expect(publicationGuard(p).reasons).toContain("current_applicability_evidence_required");
  });
});
describe("A13/A16/A17 standing persona vs exact human authority", () => {
  it("lets the approved playful persona say bruh with no per-reply grant", () => expect(publicationGuard(engagementPublication())).toEqual({ allowed: true, reasons: [] }));
  it.each(["draft", "pending", "paused", "revoked", "expired"] as const)("rejects policy state %s", (status) => { const p = engagementPublication(); p.policy!.status = status; expect(publicationGuard(p).allowed).toBe(false); });
  it("rechecks revocation, expiry, changed version, account, and disagreement at send", () => {
    const p = engagementPublication(); p.policy!.expiresAt = NOW; expect(publicationGuard(p).reasons).toContain("policy_expired");
    p.policy!.expiresAt = NOW + 1000; p.policy!.version = "2"; expect(publicationGuard(p).reasons).toContain("policy_version_mismatch");
    p.policy!.version = "1"; p.eligibility!.decision = "review_required"; expect(publicationGuard(p).reasons).toContain("current_eligibility_required");
  });
  it("cannot silently change policy configuration while keeping a matching version/hash field", () => {
    const p = engagementPublication(); p.policy!.config.hourlyCap += 1;
    expect(publicationGuard(p).reasons).toContain("policy_configuration_changed");
  });
  it("an exact human-approved benign reply can publish with autonomy disabled", () => {
    const p = engagementPublication(); p.policy!.config.autonomyEnabled = false;
    const binding = { ...reply, purpose: "engagement", textHash: p.payload.textHash, evidenceContext: null, deploymentId: null };
    p.approval = grant("reply_approval", binding); p.payload.authorizationKind = "reply_approval"; p.payload.authorizationRef = p.approval.requestId;
    p.payload.authorizationBinding = p.approval.binding;
    expect(publicationGuard(p).allowed).toBe(true);
    p.optedOut = true; expect(publicationGuard(p).allowed).toBe(false);
  });
  it("cannot disguise a fix claim by labeling its purpose engagement", () => {
    const p = engagementPublication(); p.payload.text = "We fixed it!"; p.payload.textHash = hashText(p.payload.text); p.draftValidation.textHash = p.payload.textHash;
    expect(publicationGuard(p).reasons).toContain("engagement_contains_support_claim");
  });
});
describe("A19/A20/A22/A27 interaction ledger, unknown effects and truthful manual receipts", () => {
  const record = (): LedgerReservation => ({ id: "r1", key: interactionLedgerKey("ws", "x", "brand", "123"), textHash: hashText("bruh"), authorizationRef: "policy-1", status: "reserved", attemptId: "a1", mode: "live", reservedAt: NOW });
  const receipt = (): PublicationReceipt => ({ replyId: "r2", replyUrl: "https://x.com/brand/status/456", accountId: "brand", targetId: "123", actualText: "bruh", postedAt: NOW, mode: "live", verified: true });
  it("two routes compete for the same unique interaction reservation", () => {
    const first = record(); expect(decideReservation(null, first).allowed).toBe(true);
    expect(decideReservation(first, first)).toMatchObject({ allowed: false, duplicate: true });
    expect(decideReservation(first, { ...first, id: "resolution", attemptId: "a2" }).allowed).toBe(false);
  });
  it("unknown freezes automatic retry and manual duplicate until an audited investigation", () => {
    const unknown = recordPublicationResult({ ...record(), status: "dispatched" }, { attemptId: "a1", outcome: "unknown", expectedAccountId: "brand", expectedTargetId: "123" });
    expect(unknown.status).toBe("unknown");
    expect(decideReservation(unknown, { ...record(), id: "r2", attemptId: "a2" }).reason).toBe("publication_unknown");
    expect(validateManualReceipt({ receipt: { ...receipt(), operatorId: "marketer" }, approvedTextHash: record().textHash, accountId: "brand", targetId: "123", earlierAutomatic: unknown, supplemental: false, exactApprovalValid: true }).reasons).toContain("publication_unknown");
    expect(() => recordPublicationResult(unknown, { attemptId: "a1", outcome: "definitely_not_sent", expectedAccountId: "brand", expectedTargetId: "123" })).toThrow("explicit_reconciliation_required");
    const investigated = attestNotSent(unknown, { operatorId: "marketer", role: "marketer", reason: "Checked account replies for this target and time range", now: NOW });
    expect(investigated.notSentAttestation?.residualUncertainty).toBe(true);
    expect(decideReservation(investigated, { ...record(), id: "r2", attemptId: "a2" }).allowed).toBe(true);
  });
  it("confirmed recipients are immutable while a failed batch recipient may retry", () => {
    const confirmed = recordPublicationResult(record(), { attemptId: "a1", outcome: "confirmed", receipt: receipt(), expectedAccountId: "brand", expectedTargetId: "123" });
    expect(recordPublicationResult(confirmed, { attemptId: "a1", outcome: "unknown", expectedAccountId: "brand", expectedTargetId: "123" })).toEqual(confirmed);
    expect(decideReservation(confirmed, { ...record(), id: "new", attemptId: "next" }).allowed).toBe(false);
    expect(decideReservation({ ...record(), status: "definitely_not_sent" }, { ...record(), id: "new", attemptId: "next" }).allowed).toBe(true);
  });
  it("requires receipt identity and preserves simulator provenance", () => {
    expect(() => recordPublicationResult(record(), { attemptId: "a1", outcome: "confirmed", receipt: { ...receipt(), mode: "fixture" }, expectedAccountId: "brand", expectedTargetId: "123" })).toThrow("receipt_mismatch");
    expect(() => recordPublicationResult(record(), { attemptId: "a1", outcome: "confirmed", receipt: { ...receipt(), actualText: "changed" }, expectedAccountId: "brand", expectedTargetId: "123" })).toThrow("receipt_mismatch");
  });
  it("opening composer is not a receipt; manual text deviations cannot retroactively claim approval", () => {
    const input = { receipt: { ...receipt(), replyId: "", replyUrl: "", verified: false, operatorId: "marketer" }, approvedTextHash: record().textHash, accountId: "brand", targetId: "123", earlierAutomatic: null, supplemental: false, exactApprovalValid: true };
    expect(validateManualReceipt(input).allowed).toBe(false);
    expect(validateManualReceipt({ ...input, receipt: { ...receipt(), verified: false, attested: true, operatorId: "marketer" } }).allowed).toBe(true);
    expect(validateManualReceipt({ ...input, receipt: { ...receipt(), actualText: "different", operatorId: "marketer" } }).reasons).toContain("external_text_deviation_requires_recording");
    expect(validateManualReceipt({ ...input, receipt: { ...receipt(), operatorId: "marketer" }, exactApprovalValid: false }).reasons).toContain("current_manual_authority_required");
  });
  it("supplemental human resolution keeps the previous automatic receipt and needs exact approval", () => {
    const prior = { ...record(), status: "confirmed" as const, receipt: receipt() };
    const manual = { ...receipt(), replyId: "new-manual", actualText: "Verified fix", operatorId: "marketer", attested: true };
    const args = { receipt: manual, approvedTextHash: hashText(manual.actualText), accountId: "brand", targetId: "123", earlierAutomatic: prior, supplemental: true, exactApprovalValid: true };
    expect(validateManualReceipt(args).allowed).toBe(true);
    expect(validateManualReceipt({ ...args, exactApprovalValid: false }).allowed).toBe(false);
    expect(prior.receipt.replyId).toBe("r2"); expect(decideReservation(prior, { ...record(), id: "new" }).allowed).toBe(false);
  });
});
