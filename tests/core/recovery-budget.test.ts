import { describe, expect, it } from "vitest";
import { budgetTotals, createBudgetLedger, maximumModelCharge, recordMerge, recordPromotion, releaseGuard, reserveCost, resumeRelease, retryDelayMs, settleCost, validatePatchPaths, type BudgetLedger, type CostRequest, type ReleaseContext } from "../../src/core";
import { candidate, grant, NOW } from "./fixtures";

describe("A07/A23 release serialization, exact deployment and crash recovery", () => {
  const context = (): ReleaseContext => ({ workspaceId: "ws", now: NOW, release: { caseId: "case", candidate, substage: "prepared" }, approval: grant("candidate_go", candidate), currentMainSha: candidate.baseSha, currentMainTree: "base-tree", currentPrHeadSha: candidate.headSha, trustedTestRevision: candidate.testRevision, buildConfigRevision: candidate.buildConfigRevision, checkEvidenceDigest: candidate.checkEvidenceDigest, checksPassed: true, accountReady: true, workspacePaused: false, releaseLockOwner: "case", currentStagedDeploymentId: candidate.deploymentId, stagedProductionBuild: true, autoProductionAssignmentDisabled: true });
  it("starts with an expected-head merge, then promotes the frozen staged deployment without rebuilding", () => {
    const c = context(); expect(resumeRelease(c).action).toBe("merge_expected_head");
    c.release = recordMerge(c.release, { expectedHeadSha: candidate.headSha, mergeSha: "merge-1", treeDigest: candidate.treeDigest });
    c.currentMainSha = "merge-1"; c.currentMainTree = candidate.treeDigest;
    expect(resumeRelease(c).action).toBe("promote_exact_deployment");
    c.release = recordPromotion(c.release, { deploymentId: candidate.deploymentId, previousDeploymentId: "previous", rebuilt: false });
    expect(resumeRelease(c).action).toBe("verify_live");
    expect(c.release.previousDeploymentId).toBe("previous");
  });
  it.each([
    { releaseLockOwner: "other-case" }, { currentPrHeadSha: "drift" }, { currentMainSha: "drift" }, { currentStagedDeploymentId: "other" },
    { buildConfigRevision: "changed" }, { trustedTestRevision: "changed" }, { checksPassed: false }, { autoProductionAssignmentDisabled: false },
    { stagedProductionBuild: false }, { accountReady: false }, { workspacePaused: true }, { approval: null },
  ] as Partial<ReleaseContext>[])("blocks release on %j", (changes) => expect(releaseGuard({ ...context(), ...changes }).allowed).toBe(false));
  it("checks both expected head and resulting tree", () => {
    expect(() => recordMerge(context().release, { expectedHeadSha: "changed", mergeSha: "m", treeDigest: candidate.treeDigest })).toThrow();
    expect(() => recordMerge(context().release, { expectedHeadSha: candidate.headSha, mergeSha: "m", treeDigest: "changed" })).toThrow();
  });
  it("crash after merge resumes the recorded merge, while unrelated main drift blocks", () => {
    const c = context(); c.release = recordMerge(c.release, { expectedHeadSha: candidate.headSha, mergeSha: "merge-1", treeDigest: candidate.treeDigest });
    c.currentMainSha = "merge-1"; c.currentMainTree = candidate.treeDigest;
    expect(resumeRelease(c).action).toBe("promote_exact_deployment");
    c.currentMainSha = "external-admin-commit"; expect(resumeRelease(c).action).toBe("blocked");
  });
  it("lost promotion response is reconciled rather than blindly retried", () => {
    const c = context(); c.release = { ...recordMerge(c.release, { expectedHeadSha: candidate.headSha, mergeSha: "merge-1", treeDigest: candidate.treeDigest }), promotionOutcome: "unknown" };
    c.currentMainSha = "merge-1"; c.currentMainTree = candidate.treeDigest;
    expect(resumeRelease(c).action).toBe("reconcile_promotion");
    expect(() => recordPromotion(c.release, { deploymentId: candidate.deploymentId, previousDeploymentId: "previous", rebuilt: true })).toThrow("without_rebuild");
  });
});
describe("A04/A25 scope allowlist guard", () => {
  it("permits approved source files", () => expect(validatePatchPaths([{ path: "src/weather/Temperature.tsx", resolvedInsideRepository: true }], ["src/weather/"]).allowed).toBe(true));
  it.each(["../secrets", "/etc/passwd", "src/weather/../../secret", "src\\weather\\file.ts", "src/weather/fixture.ts", "src/weather/tests/regression.ts", "src/weather/temperature.test.ts", "src/weather/package.json", "src/weather/version.ts", ".github/workflows/release.yml", "src/weather/.env"])("rejects protected/traversal path %s", (path) => expect(validatePatchPaths([{ path }], ["src/weather/"]).allowed).toBe(false));
  it("rejects symlinks and paths whose resolved location escapes the repo", () => {
    expect(validatePatchPaths([{ path: "src/weather/ui.ts", isSymlink: true }], ["src/weather/"]).allowed).toBe(false);
    expect(validatePatchPaths([{ path: "src/weather/ui.ts", resolvedInsideRepository: false }], ["src/weather/"]).allowed).toBe(false);
  });
});
describe("A29 aggregate cost reservations and bounded retries", () => {
  const request = (overrides: Partial<CostRequest> = {}): CostRequest => ({ id: "r1", attemptId: "a1", category: "model", maxUsd: 0.02, discretionary: true, now: NOW, pricingVerified: true, caseId: "case", caseKind: "engagement", model: "gpt-5-mini", ...overrides });
  it("requires known prices, approved model, and bounded per-case cost", () => {
    expect(reserveCost(createBudgetLedger(), request({ maxUsd: null })).allowed).toBe(false);
    expect(reserveCost(createBudgetLedger(), request({ pricingVerified: false })).allowed).toBe(false);
    expect(reserveCost(createBudgetLedger(), request({ model: "gpt-6" })).reason).toBe("model_not_approved");
    expect(reserveCost(createBudgetLedger(), request({ maxUsd: 0.051 })).reason).toBe("case_budget_exhausted");
    expect(reserveCost(createBudgetLedger(), request({ caseKind: "engineering", maxUsd: 1.001 })).reason).toBe("case_budget_exhausted");
  });
  it("retains full unknown charge; every retry reserves separately", () => {
    const first = reserveCost(createBudgetLedger(), request()); expect(first.allowed).toBe(true);
    const unknown = settleCost(first.ledger, "r1", { status: "unknown" }); expect(budgetTotals(unknown).reservedUsd).toBe(0.02);
    expect(reserveCost(unknown, request()).allowed).toBe(false);
    const retry = reserveCost(unknown, request({ id: "r2", attemptId: "a2" })); expect(retry.allowed).toBe(true);
    expect(budgetTotals(retry.ledger).committedUsd).toBe(0.04);
    expect(reserveCost(retry.ledger, request({ id: "r3", attemptId: "a3" })).reason).toBe("case_budget_exhausted");
    expect(unknown.reservations[0].status).toBe("unknown");
  });
  it("idempotent reservation cannot be repurposed for another attempt or charge", () => {
    const first = reserveCost(createBudgetLedger(), request());
    expect(reserveCost(first.ledger, request())).toMatchObject({ allowed: true, duplicate: true });
    expect(reserveCost(first.ledger, request({ attemptId: "other" })).reason).toBe("reservation_id_conflict");
  });
  it("reconciles actual charge, requires evidence to release unincurred cost, and rejects overshoot", () => {
    const first = reserveCost(createBudgetLedger(), request());
    expect(budgetTotals(settleCost(first.ledger, "r1", { status: "settled", actualUsd: 0.005 }))).toMatchObject({ spentUsd: 0.005, reservedUsd: 0 });
    expect(() => settleCost(first.ledger, "r1", { status: "definitely_not_incurred", evidenceRef: "" })).toThrow();
    expect(budgetTotals(settleCost(first.ledger, "r1", { status: "definitely_not_incurred", evidenceRef: "provider-cancelled-before-admission" })).committedUsd).toBe(0);
    expect(() => settleCost(first.ledger, "r1", { status: "settled", actualUsd: 0.03 })).toThrow("exceeded_reserved_bound");
  });
  it("warns at 50/75, preserves ten dollars at 90, and never admits above 100", () => {
    const ledger: BudgetLedger = { ...createBudgetLedger(), allocations: { model: 0, infrastructure: 90, testing: 0, contingency: 10 }, reservations: [{ id: "hosting", attemptId: "committed", category: "infrastructure", maxUsd: 89, status: "reserved", createdAt: NOW }] };
    expect(budgetTotals(ledger).warnings).toEqual([50, 75]);
    expect(reserveCost(ledger, request({ category: "infrastructure", maxUsd: 2, model: undefined })).reason).toBe("contingency_preserved");
    expect(reserveCost(ledger, request({ category: "contingency", maxUsd: 12, discretionary: false, model: undefined })).reason).toBe("project_budget_exhausted");
    expect(reserveCost(ledger, request({ category: "contingency", maxUsd: 10, discretionary: false, model: undefined })).allowed).toBe(true);
  });
  it("conservative uncached input and output ceilings determine reserved maximum", () => {
    expect(maximumModelCharge({ inputTokenBound: 10_000, outputTokenCeiling: 1000, inputUsdPerMillion: 0.25, outputUsdPerMillion: 2, pricingVerifiedAt: NOW, now: NOW })).toBe(0.0045);
    expect(() => maximumModelCharge({ inputTokenBound: -1, outputTokenCeiling: 1000, inputUsdPerMillion: 0.25, outputUsdPerMillion: 2, pricingVerifiedAt: NOW, now: NOW })).toThrow();
  });
  it("bounds transient/schema repair attempts and honors Retry-After", () => {
    expect(retryDelayMs({ attempt: 1, errorClass: "transient", retryAfterMs: 20_000, random: 0 })).toBe(20_000);
    expect(retryDelayMs({ attempt: 3, errorClass: "transient", random: 0 })).toBeNull();
    expect(retryDelayMs({ attempt: 2, errorClass: "invalid_output", random: 0 })).toBeNull();
    expect(retryDelayMs({ attempt: 1, errorClass: "effect_unknown", random: 0 })).toBeNull();
  });
});
