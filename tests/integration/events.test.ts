import { describe, expect, it } from "vitest";
import { applyTaskResult } from "../../src/control/events";
import { applyCommand, createTask } from "../../src/control/reducer";
import { initialState } from "../../src/control/seed";
import type { ControlState, RuntimeConfig } from "../../src/control/types";
import { canonicalJson, hashText, PERSONA_EVALUATION_CASES, PERSONA_EVALUATION_VERSION } from "../../src/core";

const NOW = 1_800_000_000_000;
const config: RuntimeConfig = { mode: "demo", repository: "owned/weather", baseSha: "a".repeat(40), openaiConfigured: false, accessConfigured: false, convexConfigured: false, slackConfigured: false, linearConfigured: false, githubConfigured: false, vercelConfigured: false, workerConfigured: false, redditConfigured: false };
function state(): ControlState {
  const s = applyCommand(initialState(config), { action: "intake", mode: "fixture", platform: "x", sourceUrl: "https://x.com/customer/status/123", text: "20°C becomes 20°F" }, { id: "engineer", name: "Engineer", roles: ["engineer"] }, config, NOW);
  s.cases[0].candidate = { headSha: "b".repeat(40), treeDigest: "c".repeat(40), deploymentId: "dpl_approved", productionUrl: "https://weather.example.test", checksPassed: false };
  s.cases[0].testRevision = "tests-v1"; s.cases[0].buildConfigRevision = "config-v1";
  return s;
}
function evidence(s = state()) {
  const c = s.cases[0], checks = [{ name: "default Celsius", expected: "20°C", actual: "20°C", passed: true }, { name: "reload/default unit", expected: "20°C", actual: "20°C", passed: true }];
  for (const [name, celsius, fahrenheit] of [["pleasant", 20, 68], ["freezing", 0, 32], ["extreme-cold", -40, -40], ["boiling", 100, 212]]) {
    checks.push({ name: `${name} Celsius`, expected: `${celsius}°C`, actual: `${celsius}°C`, passed: true }, { name: `${name} Fahrenheit`, expected: `${fahrenheit}°F`, actual: `${fahrenheit}°F`, passed: true });
    for (let repeat = 1; repeat <= 3; repeat++) checks.push({ name: `${name} repeat ${repeat} Celsius`, expected: `${celsius}°C`, actual: `${celsius}°C`, passed: true }, { name: `${name} repeat ${repeat} Fahrenheit`, expected: `${fahrenheit}°F`, actual: `${fahrenheit}°F`, passed: true });
  }
  return { suiteVersion: "weather-protected-v1", runId: "qa-1", url: "https://weather.example.test", mode: "fixture" as "fixture" | "live", timestamp: NOW,
    provenance: { schemaVersion: 1, runId: "candidate-run", candidateId: "candidate-1", headSha: c.candidate!.headSha, treeDigest: c.candidate!.treeDigest, trustedTestRevision: c.testRevision!, buildConfigRevision: c.buildConfigRevision!, mode: "fixture" as "fixture" | "live" },
    identityPassed: true, identityAssurance: "expected_matches" as "expected_matches" | "observed_only", checks, screenshots: ["protected-20c.png"], status: "passed" as "passed" | "failed", seededDefectReproduced: false };
}
function job(s: ControlState, kind: string, payload: Record<string, unknown> = {}) { const created = createTask(s, kind, s.cases[0].id, payload, NOW); s.tasks.find(t => t.id === created.id)!.status = "running"; return s.tasks.find(t => t.id === created.id)!; }
function publication(s: ControlState) {
  const c = s.cases[0]; c.publications.push({ id: "pub", status: "publishing", draftText: "bruh", textHash: hashText("bruh"), targetId: "123", sourceKey: c.signals[0].sourceKey, contextHash: hashText(c.text), personaId: "friendly", personaVersion: 1, purpose: "engagement", mode: "fixture", account: "brand", authorId: "customer" });
  c.route = "social_engagement";
}

describe("typed callback evidence and provenance", () => {
  it("candidate verification requires every protected UI regression, not a passed boolean", () => {
    const s = state(), task = job(s, "verify_candidate"); const out = evidence(s);
    const before = structuredClone(s); expect(() => applyTaskResult(s, task, { status: "succeeded", output: { ...out, checks: out.checks.slice(0, 2) } }, NOW + 1)).toThrow("protected_checks_failed"); expect(s).toEqual(before);
    applyTaskResult(s, task, { status: "succeeded", output: out }, NOW + 1); expect(s.cases[0].candidate!.checksPassed).toBe(true); expect(s.tasks.some(t => t.kind === "draft_reply")).toBe(true);
  });
  it.each(["headSha", "treeDigest", "trustedTestRevision", "buildConfigRevision"])("rejects mismatched %s", (field) => {
    const s = state(), task = job(s, "verify_candidate"), out = evidence(s); (out.provenance as Record<string, unknown>)[field] = "different";
    expect(() => applyTaskResult(s, task, { status: "succeeded", output: out }, NOW + 1)).toThrow("candidate_provenance_mismatch");
  });
  it("baseline reproduction needs expected identity and observed 20°F failure", () => {
    const s = state(), task = job(s, "reproduce"), out = evidence(s); out.provenance.headSha = s.cases[0].baseSha; out.status = "failed"; out.seededDefectReproduced = true;
    const failed = out.checks.find(check => check.name === "pleasant Fahrenheit")!; failed.actual = "20°F"; failed.passed = false;
    expect(() => applyTaskResult(s, task, { status: "succeeded", output: { ...out, identityAssurance: "observed_only" } }, NOW + 1)).toThrow("protected_identity_required");
    applyTaskResult(s, task, { status: "succeeded", output: out }, NOW + 1); expect(s.tasks.some(t => t.kind === "linear_create")).toBe(true);
  });
  it("a fixture report cannot establish a live production result", () => {
    const s = state(); s.mode = "live"; const task = job(s, "verify_candidate"); expect(() => applyTaskResult(s, task, { status: "succeeded", output: evidence(s) }, NOW + 1)).toThrow("protected_identity_required");
  });
  it("release callback needs full fresh behavior and identity, and learns even when publication is blocked", () => {
    const s = state(), task = job(s, "release_candidate"); const out = { stage: "live_verified", deploymentId: s.cases[0].candidate!.deploymentId, treeDigest: s.cases[0].candidate!.treeDigest, productionIdentityCheckedAt: NOW, verification: evidence(s), previousDeploymentId: "dpl_previous" };
    expect(() => applyTaskResult(s, task, { status: "succeeded", output: { ...out, verification: undefined } }, NOW + 1)).toThrow();
    applyTaskResult(s, task, { status: "succeeded", output: out }, NOW + 1); expect(s.cases[0].productionVerified).toBe(true); expect(s.cases[0].outcome).toBeUndefined();
    expect(s.solvedIssues.find(issue => issue.id === "solved-" + s.cases[0].id)).toMatchObject({ fictional: false, valid: true, affectedRevision: s.cases[0].candidate!.headSha });
  });
  it("known remedy is reverified at the current deployment before exact support approval", () => {
    const s = state(); s.solvedIssues.push({ id: "real-remedy", fictional: false, symptomSignature: "conversion", component: "temperature-conversion", affectedRevision: s.cases[0].candidate!.headSha, remedy: "Convert correctly", remedyType: "fix", verificationNotes: "Earlier independent protected evidence", valid: true });
    const task = job(s, "verify_remedy", { remedyId: "real-remedy" }); applyTaskResult(s, task, { status: "succeeded", output: evidence(s) }, NOW + 1);
    expect(s.cases[0].route).toBe("known_remedy"); expect(s.tasks.some(t => t.kind === "draft_reply" && t.payload.purpose === "known_fix")).toBe(true);
  });
  it("delivers a verified Celsius workaround by exact approval and separate manual receipt without claiming the Fahrenheit defect is fixed", () => {
    const s = state(), proof = evidence(s); proof.status = "failed"; proof.seededDefectReproduced = true;
    for (const check of proof.checks) if (check.name.includes("Fahrenheit")) { check.actual = "20°F"; check.passed = false; }
    s.solvedIssues.push({ id: "celsius-workaround", fictional: false, symptomSignature: "conversion", component: "temperature-conversion", affectedRevision: s.cases[0].candidate!.headSha, remedy: "Keep Celsius selected until the Fahrenheit conversion is repaired.", remedyType: "workaround", verificationNotes: "Current UI Celsius fixtures remain correct", valid: true });
    const verify = job(s, "verify_remedy", { remedyId: "celsius-workaround" }); applyTaskResult(s, verify, { status: "succeeded", output: proof }, NOW + 1);
    const draft = s.tasks.find(task => task.kind === "draft_reply" && task.payload.purpose === "workaround")!;
    const text = "Until the conversion is repaired, keep Celsius selected to view the correct temperature.";
    applyTaskResult(s, draft, { status: "succeeded", output: { text, personaId: "friendly", personaVersion: 1, validated: true, model: "gpt-5-mini", promptVersion: "persona-writer-v1", validatorVersion: "independent-validator-v1", validationTextHash: hashText(text) } }, NOW + 2);
    const approval = s.authorities.find(item => item.request.kind === "reply_approval")!; expect(approval.request.status).toBe("pending"); expect(s.cases[0].publications[0].purpose).toBe("workaround"); expect(s.cases[0].candidate!.checksPassed).toBe(false);
    const marketer = { id: "marketer", name: "Marketer", roles: ["marketer" as const] };
    let approved = applyCommand(s, { action: "demo_decide", approvalId: approval.request.requestId, decision: "approved" }, marketer, config, NOW + 3);
    const p = approved.cases[0].publications[0]; expect(p.authorityKind).toBe("reply_approval");
    approved = applyCommand(approved, { action: "manual_receipt", caseId: approved.cases[0].id, publicationId: p.id, receiptUrl: "https://x.com/brand/status/456", attested: true, reason: "Posted exact approved Celsius guidance" }, marketer, config, NOW + 4);
    expect(approved.cases[0]).toMatchObject({ phase: "COMPLETED", outcome: "workaround_delivered", communicationStatus: "simulated_attested" }); expect(approved.cases[0].candidate!.checksPassed).toBe(false);
    expect(approved.cases[0].publications[0]).toMatchObject({ status: "manually_attested", draftText: text, purpose: "workaround" });
  });
});

describe("receipt reconciliation and immutable confirmed effects", () => {
  it("late effects after cancellation retain sanitized evidence without reactivating or publishing", () => {
    const s = state(); publication(s); const task = job(s, "publish_reply", { publicationId: "pub" });
    const canceled = applyCommand(s, { action: "cancel_case", caseId: s.cases[0].id, reason: "Stop outstanding work" }, { id: "marketer", name: "Marketer", roles: ["marketer"] }, config, NOW + 1);
    const saved = canceled.tasks.find(item => item.id === task.id)!, count = canceled.tasks.length;
    const result = { status: "succeeded", output: { status: "confirmed", providerReceipt: { id: "observed-late-receipt" }, encryptedSession: "private" } };
    applyTaskResult(canceled, saved, result, NOW + 2);
    expect(canceled.cases[0].phase).toBe("COMPLETED"); expect(canceled.cases[0].publications[0].status).toBe("unknown"); expect(canceled.tasks).toHaveLength(count);
    expect(saved.receipt).toEqual({ lateCanceledResult: { status: "succeeded", output: { status: "confirmed", providerReceipt: { id: "observed-late-receipt" } } }, requiresInvestigation: true });
    expect(saved.lateResults).toHaveLength(1); applyTaskResult(canceled, saved, result, NOW + 3); expect(saved.lateResults).toHaveLength(1);
  });
  it("rejects an automatic callback aimed at a supplemental manual publication", () => {
    const s = state(); publication(s); const task = job(s, "publish_reply", { publicationId: "pub" }); s.cases[0].publications[0].manualOnly = true;
    expect(() => applyTaskResult(s, task, { status: "succeeded", output: { status: "confirmed" } }, NOW + 1)).toThrow("supplemental_manual_only");
    expect(s.cases[0].publications[0].status).toBe("publishing");
  });
  it("generic failure after possible send stays unknown", () => {
    const s = state(); publication(s); const task = job(s, "publish_reply", { publicationId: "pub" });
    applyTaskResult(s, task, { status: "failed", error: "network_timeout" }, NOW + 1); expect(s.cases[0].publications[0].status).toBe("unknown"); expect(s.cases[0].blockingReason).toBe("publication_unknown");
  });
  it("stale effect receipts are retained without authorizing or overwriting newer state", () => {
    const s = state(); publication(s); const task = job(s, "publish_reply", { publicationId: "pub" }); s.cases[0].version++;
    applyTaskResult(s, task, { status: "succeeded", output: { status: "confirmed" } }, NOW + 1); expect(s.cases[0].publications[0].status).toBe("unknown"); expect(task.lateResults).toHaveLength(1);
  });
  it("requires exact receipt identity and keeps simulation labeled", () => {
    const s = state(); publication(s); const task = job(s, "publish_reply", { publicationId: "pub" });
    const out = { status: "confirmed", mode: "fixture", completedAt: NOW + 1, providerReceipt: { id: "fixture:pub", url: "fixture://publication/pub", accountId: "brand", targetId: "123", textHash: hashText("bruh") } };
    expect(() => applyTaskResult(s, task, { status: "succeeded", output: { ...out, providerReceipt: { ...out.providerReceipt, textHash: "different" } } }, NOW + 1)).toThrow("receipt_binding_mismatch");
    applyTaskResult(s, task, { status: "succeeded", output: out }, NOW + 1); expect(s.cases[0].communicationStatus).toBe("simulated_confirmed");
    const eventCount = s.audit.length; applyTaskResult(s, task, { status: "succeeded", output: out }, NOW + 2); expect(s.audit).toHaveLength(eventCount);
    applyTaskResult(s, task, { status: "unknown", error: "timeout" }, NOW + 3); expect(s.cases[0].publications[0].status).toBe("confirmed");
  });
  it("rollback records the actual previous build and invalidates learned applicability without claiming a fix", () => {
    const s = state(); s.cases[0].productionVerified = true; const binding = { previousDeploymentId: "dpl_previous", operatorId: "engineer", operatorRole: "engineer", operatorAuthorizationRef: "rollback-approved" };
    const task = job(s, "rollback_deployment", binding), proof = evidence(s); proof.status = "failed"; proof.seededDefectReproduced = true;
    s.solvedIssues.push({ id: "solved-" + s.cases[0].id, fictional: false, valid: true, symptomSignature: "conversion", component: "temperature", affectedRevision: "head", remedy: "fix", remedyType: "fix", verificationNotes: "old" });
    applyTaskResult(s, task, { status: "succeeded", output: { ...binding, deploymentId: "dpl_previous", verification: proof, productionIdentityCheckedAt: NOW } }, NOW + 1);
    expect(s.cases[0].productionVerified).toBe(false); expect(s.solvedIssues.at(-1)!.valid).toBe(false); expect(s.cases[0].blockingReason).toBe("rolled_back_review_required");
  });
});

describe("persona policy evaluation gate", () => {
  const evaluations = () => PERSONA_EVALUATION_CASES.map(example => ({ id: example.id, group: example.group, accepted: example.group === "eligible", text: example.group === "eligible" ? "Thanks!" : "", reason: "Independent evaluation", generationRef: "writer-thread", validationRef: "validator-thread" }));
  it("persists ordered chunks without activating and rejects overwritten previous results", () => {
    const s = state(), task = createTask(s, "evaluate_persona", undefined, { personaId: "friendly", version: 1 }, NOW);
    const results = evaluations().slice(0, 10);
    applyTaskResult(s, task, { status: "succeeded", output: { partial: true, nextOffset: 10, results, model: "gpt-5-mini", evaluationVersion: PERSONA_EVALUATION_VERSION } }, NOW + 1);
    const next = s.tasks.find(item => item.kind === "evaluate_persona" && item.payload.offset === 10)!; expect(next).toBeTruthy(); expect(s.authorities).toHaveLength(0);
    const changed = evaluations().slice(0, 20); changed[0].accepted = false;
    expect(() => applyTaskResult(s, next, { status: "succeeded", output: { partial: true, nextOffset: 20, results: changed, model: "gpt-5-mini", evaluationVersion: PERSONA_EVALUATION_VERSION } }, NOW + 2)).toThrow("partial_evaluation_binding_mismatch");
  });
  it("eight previews are insufficient to activate live standing authority", () => {
    const s = state(); const task = createTask(s, "evaluate_persona", undefined, { personaId: "friendly", version: 1 }, NOW);
    expect(() => applyTaskResult(s, task, { status: "succeeded", output: { passed: true, evaluationRef: "preview8", totalCases: 8 } }, NOW + 1)).toThrow("persona_evaluation_failed");
    const examples = evaluations(); Object.assign(s.tasks.find(item => item.id === task.id)!.payload, { offset: 50, results: examples.slice(0, 50) });
    applyTaskResult(s, task, { status: "succeeded", output: { passed: true, evaluationRef: hashText(canonicalJson(examples)), totalCases: 60, eligibleAccepted: 20, hardExclusionAccepted: 0, evaluationVersion: PERSONA_EVALUATION_VERSION, model: "gpt-5-mini", examples, policyHash: s.personas.find(p => p.id === "friendly")!.hash } }, NOW + 1);
    expect(s.authorities.some(a => a.request.kind === "persona_policy" && a.request.status === "pending")).toBe(true);
  });
  it("rejects fabricated passing counts or policy mismatch in the final chunk", () => {
    const s = state(), examples = evaluations(), task = createTask(s, "evaluate_persona", undefined, { personaId: "friendly", version: 1, offset: 50, results: examples.slice(0, 50) }, NOW);
    const out = { passed: true, evaluationRef: hashText(canonicalJson(examples)), totalCases: 60, eligibleAccepted: 19, hardExclusionAccepted: 0, evaluationVersion: PERSONA_EVALUATION_VERSION, model: "gpt-5-mini", examples, policyHash: s.personas.find(p => p.id === "friendly")!.hash };
    expect(() => applyTaskResult(s, task, { status: "succeeded", output: out }, NOW + 1)).toThrow("final_evaluation_binding_mismatch");
    expect(() => applyTaskResult(s, task, { status: "succeeded", output: { ...out, eligibleAccepted: 20, policyHash: "old-policy" } }, NOW + 1)).toThrow("final_evaluation_binding_mismatch");
  });
  it("stores case-free reminder receipts while omitting nested secrets and artifact bodies", () => {
    const s = state(), task = createTask(s, "slack_reminder", undefined, { authorityId: "approval" }, NOW);
    applyTaskResult(s, task, { status: "succeeded", output: { sent: true, details: { artifacts: [{ base64: "private-image" }], refreshToken: "secret", receiptId: "reminder-id" } } }, NOW + 1);
    expect(task.status).toBe("completed"); expect(task.receipt).toEqual({ sent: true, details: { receiptId: "reminder-id" } });
  });
  it("final evaluation digest survives Convex object-key reordering", () => {
    const s = state(), examples = evaluations();
    const serialized = JSON.parse(canonicalJson(examples));
    expect(JSON.stringify(serialized)).not.toBe(JSON.stringify(examples));
    const task = createTask(s, "evaluate_persona", undefined, { personaId: "friendly", version: 1, offset: 50, results: serialized.slice(0, 50) }, NOW);
    applyTaskResult(s, task, { status: "succeeded", output: { passed: true, evaluationRef: hashText(canonicalJson(examples)), totalCases: 60, eligibleAccepted: 20, hardExclusionAccepted: 0, evaluationVersion: PERSONA_EVALUATION_VERSION, model: "gpt-5-mini", examples: serialized, policyHash: s.personas.find(p => p.id === "friendly")!.hash } }, NOW + 1);
    expect(task.status).toBe("completed"); expect(s.authorities.some(a => a.request.kind === "persona_policy" && a.request.status === "pending")).toBe(true);
  });
});
