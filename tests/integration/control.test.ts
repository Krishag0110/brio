import { describe, expect, it } from "vitest";
import { applyCommand, assertCanPublish, bindingPayload, costTotals, createTask, localPreview, preparePublication, reserveModelCost, setApproved, settleModelCost } from "../../src/control/reducer";
import { initialState } from "../../src/control/seed";
import type { Actor, Command, ControlState, RuntimeConfig } from "../../src/control/types";
import { canonicalJson, hashText } from "../../src/core";

const config: RuntimeConfig = { mode: "demo", repository: "owned/weather", baseSha: "base-v1", openaiConfigured: false, accessConfigured: false, convexConfigured: false, slackConfigured: false, linearConfigured: false, githubConfigured: false, vercelConfigured: false, workerConfigured: false, redditConfigured: false };
const engineer: Actor = { id: "engineer", name: "Engineer", roles: ["engineer"] };
const marketer: Actor = { id: "marketer", name: "Marketer", roles: ["marketer"] };
const admin: Actor = { id: "admin", name: "Admin", roles: ["admin"] };
const NOW = 1_800_000_000_000;
function run(state: ControlState, command: Command, actor = marketer, offset = 1): ControlState { return applyCommand(state, command, actor, config, Math.max(NOW + offset, state.audit.length ? Date.parse(state.audit[0].at) + 1 : NOW + offset)); }
function intake(state = initialState(config), target = "123", body = "20°C becomes 20°F. your calculator asleep?") { return run(state, { action: "intake", platform: "x", mode: "fixture", sourceUrl: `https://x.com/customer${target}/status/${target}`, text: body }, marketer); }
function approve(state: ControlState, kind: string, actor = kind === "build" ? engineer : marketer): ControlState {
  const approval = state.authorities.findLast((a) => a.request.kind === kind && a.request.status === "pending")!;
  return run(state, { action: "demo_decide", approvalId: approval.request.requestId, decision: "approved" }, actor, 2);
}
function candidateState(grouped = false): ControlState {
  let s = intake(); if (grouped) s = intake(s, "456", "My app shows 20°C as 20°F too.");
  const id = s.cases[0].id;
  s = run(s, { action: "demo_advance", caseId: id }, engineer); s = approve(s, "build");
  return run(s, { action: "demo_advance", caseId: id }, engineer, 3);
}
function readyState(grouped = false): ControlState {
  let s = candidateState(grouped); s = approve(s, "candidate_go");
  return run(s, { action: "demo_advance", caseId: s.cases[0].id }, marketer, 4);
}
function supplementalState() {
  let s = readyState(); const resolutionCaseId = s.cases[0].id;
  s = intake(s, "888", "Love the weather app!"); const c = s.cases[0], publicationId = c.publications[0].id;
  s = run(s, { action: "request_reply_approval", caseId: c.id, publicationId }); s = approve(s, "reply_approval");
  s = run(s, { action: "demo_advance", caseId: c.id });
  return { s, c: s.cases.find(item => item.id === c.id)!, command: { action: "supplemental_resolution", caseId: c.id, publicationId, resolutionCaseId, text: "Fixed: 20°C now correctly shows 68°F. Thanks for catching it." } };
}

describe("control reducer integration: authorized engineering and communication", () => {
  it("cancels queued work, revokes approvals, retains budget reservations and blocks future effects", () => {
    let state = candidateState(); const c = state.cases[0];
    const pending = createTask(state, "build_candidate", c.id, { authorityId: "test-authority" }, NOW);
    reserveModelCost(state, c.id, 0.02, NOW);
    expect(() => run(state, { action: "cancel_case", caseId: c.id, reason: "Stop work" }, admin)).toThrow("forbidden");
    state = run(state, { action: "cancel_case", caseId: c.id, reason: "User withdrew the report" }, engineer);
    const canceled = state.cases[0]; expect(canceled).toMatchObject({ phase: "COMPLETED", outcome: "canceled_before_dispatch", canceledBy: engineer.id });
    expect(state.tasks.find(task => task.id === pending.id)).toMatchObject({ status: "failed", error: "case_canceled_before_dispatch" });
    expect(state.authorities.filter(a => a.caseId === c.id).every(a => a.request.status === "revoked")).toBe(true); expect(state.costs[0].status).toBe("reserved");
    expect(() => createTask(state, "build_candidate", c.id, {}, NOW + 100)).toThrow("case_canceled");
    expect(() => reserveModelCost(state, c.id, 0.02, NOW + 100)).toThrow("case_canceled");
    expect(() => run(state, { action: "recover", caseId: c.id, operation: "retry", reason: "Restart" }, engineer)).toThrow("case_canceled");
  });
  it("cancellation after dispatch preserves original receipts and requires investigation without reactivation", () => {
    const f = supplementalState(); let state = f.s; const c = state.cases.find(item => item.id === f.c.id)!, receipt = structuredClone(c.publications[0]);
    const publication = { ...receipt, id: "in-flight", status: "publishing", receiptUrl: undefined, confirmedAt: undefined }; c.publications.push(publication);
    const dispatched = createTask(state, "publish_reply", c.id, { publicationId: publication.id }, NOW); Object.assign(state.tasks.find(task => task.id === dispatched.id)!, { status: "running", dispatchedAt: NOW });
    state = run(state, { action: "cancel_case", caseId: c.id, reason: "Stop after worker dispatch" }, marketer);
    let canceled = state.cases.find(item => item.id === c.id)!; expect(canceled.publications[0]).toEqual(receipt); expect(canceled.publications[1].status).toBe("unknown"); expect(canceled.outcome).toBe("canceled_with_unresolved_effects");
    state = run(state, { action: "recover", caseId: c.id, operation: "reconcile", investigationOutcome: "definitely_not_sent", attested: true, reason: "Checked target and account history" }, marketer);
    canceled = state.cases.find(item => item.id === c.id)!; expect(canceled.phase).toBe("COMPLETED"); expect(canceled.canceledAt).toBeTruthy(); expect(canceled.publications[1].status).toBe("definitely_not_sent");
  });
  it("runs the complete labeled demo route with distinct Build/Go roles and no unapproved sends", () => {
    const candidate = candidateState(); expect(candidate.cases[0].scope).toEqual(["lib/temperature.ts"]);
    expect(candidate.cases[0].productionVerified).toBe(false); expect(candidate.cases[0].publications[0].status).toBe("draft");
    expect(() => run(candidate, { action: "demo_advance", caseId: candidate.cases[0].id }, marketer)).toThrow("no_demo_transition");
    let state = readyState(); expect(state.cases[0].productionVerified).toBe(true); expect(state.cases[0].phase).toBe("READY_TO_PUBLISH"); expect(state.cases[0].outcome).toBeUndefined();
    state = run(state, { action: "demo_advance", caseId: state.cases[0].id }, marketer, 5);
    expect(state.cases[0].phase).toBe("COMPLETED"); expect(state.cases[0].outcome).toBe("fixed_and_notified");
    expect(state.cases[0].communicationStatus).toBe("simulated_confirmed"); expect(state.cases[0].publications[0].mode).toBe("fixture");
    expect(state.cases[0].publications[0].receiptUrl).toContain("example.invalid/simulated");
  });
  it("wrong roles cannot Build, Go, pause, or forge internal decisions", () => {
    let state = intake(); state = run(state, { action: "demo_advance", caseId: state.cases[0].id }, engineer);
    expect(() => approve(state, "build", marketer)).toThrow("forbidden");
    expect(() => approve(candidateState(), "candidate_go", engineer)).toThrow("forbidden");
    expect(() => run(state, { action: "pause", paused: true, reason: "Pause" }, engineer)).toThrow("forbidden");
    expect(() => run(state, { action: "internal_decide" }, marketer)).toThrow("forbidden");
  });
  it("a frozen approved batch completes each distinct grouped target exactly once", () => {
    let state = readyState(true); const c = state.cases[0]; expect(state.cases).toHaveLength(1); expect(c.signals).toHaveLength(2); expect(c.publications).toHaveLength(2);
    const a = state.authorities.find((a) => a.request.kind === "candidate_go")!; const originalBinding = canonicalJson(bindingPayload(state, a));
    state = run(state, { action: "demo_advance", caseId: c.id }, marketer, 5);
    expect(state.cases[0].communicationStatus).toBe("partially_confirmed"); expect(state.cases[0].outcome).toBeUndefined();
    expect(canonicalJson(bindingPayload(state, state.authorities.find((a) => a.request.kind === "candidate_go")!))).toBe(originalBinding);
    state = run(state, { action: "demo_advance", caseId: c.id }, marketer, 6);
    expect(state.cases[0].phase).toBe("COMPLETED"); expect(state.cases[0].publications.every((p) => p.status === "confirmed")).toBe(true);
    expect(new Set(state.cases[0].publications.map((p) => p.targetId)).size).toBe(2);
  });
  it("reports after Go receive a separate exact reply approval without changing the frozen batch", () => {
    let state = candidateState(); state = approve(state, "candidate_go");
    const originalGo = state.authorities.find((a) => a.request.kind === "candidate_go")!; const originalBinding = originalGo.request.binding;
    state = intake(state, "999", "20°C becomes 20°F for me as well.");
    expect(state.cases).toHaveLength(1); expect(state.cases[0].publications).toHaveLength(2);
    expect(state.cases[0].publications[1].authorityId).toBeUndefined();
    expect(state.authorities.find((a) => a.request.kind === "candidate_go")!.request.binding).toBe(originalBinding);
    const id = state.cases[0].id;
    state = run(state, { action: "demo_advance", caseId: id }, marketer, 4); state = run(state, { action: "demo_advance", caseId: id }, marketer, 5);
    expect(state.cases[0].phase).toBe("READY_TO_PUBLISH"); expect(state.cases[0].publications[1].status).toBe("draft");
    state = run(state, { action: "request_reply_approval", caseId: id, publicationId: state.cases[0].publications[1].id }, marketer, 6);
    state = approve(state, "reply_approval"); state = run(state, { action: "demo_advance", caseId: id }, marketer, 7);
    expect(state.cases[0].publications.every((p) => p.status === "confirmed")).toBe(true);
  });
  it("does not group contradictory defects merely because both contain 20", () => {
    let state = intake(); state = intake(state, "456", "The app crashes after 20 refreshes"); expect(state.cases).toHaveLength(2);
  });
  it("failed candidate checks recover under the same valid Build and require a fresh Go", () => {
    let state = candidateState(); const id = state.cases[0].id, originalGo = state.authorities.find((a) => a.request.kind === "candidate_go")!.request.requestId;
    state = run(state, { action: "demo_fault", caseId: id, fault: "checks_failed" }, admin);
    expect(state.cases[0].phase).toBe("VERIFYING_CANDIDATE");
    expect(() => run(state, { action: "recover", caseId: id, operation: "retry", reason: "Recheck" }, marketer)).toThrow("forbidden");
    state = run(state, { action: "recover", caseId: id, operation: "retry", reason: "Repair within approved scope" }, engineer);
    expect(state.cases[0].phase).toBe("BUILDING");
    state = run(state, { action: "demo_advance", caseId: id }, engineer);
    expect(state.cases[0].phase).toBe("AWAITING_GO"); expect(state.cases[0].buildAttemptNumber).toBe(2);
    expect(state.cases[0].publications).toHaveLength(1); expect(state.authorities.find((a) => a.request.requestId === originalGo)!.request.status).toBe("revoked");
    state.cases[0].buildAttemptNumber = 3; state.cases[0].blockingReason = "checks_failed";
    expect(() => run(state, { action: "recover", caseId: id, operation: "retry", reason: "Fourth attempt" }, engineer)).toThrow("engineering_attempts_exhausted");
  });
  it("an expired Go renewed as reply-only cannot bypass fresh live evidence", () => {
    let state = readyState(); const c = state.cases[0]; c.liveVerifiedAt = NOW - 300_001;
    expect(() => assertCanPublish(state, c, c.publications[0], NOW)).toThrow("fresh_live_evidence_required");
    state = run(state, { action: "request_reply_approval", caseId: c.id, publicationId: c.publications[0].id }, marketer);
    state = approve(state, "reply_approval"); expect(state.cases[0].blockingReason).toBe("fresh_live_evidence_required");
  });
});

describe("control reducer integration: personas and uncertain effects", () => {
  it.each(["confirmed", "manually_attested", "unknown", "publishing"])("%s publication cannot receive a new approval or be reset by a pending approval", status => {
    let s = intake(initialState(config), "900", "Love the weather app!"); const c = s.cases[0], p = c.publications[0];
    s = run(s, { action: "request_reply_approval", caseId: c.id, publicationId: p.id });
    const stored = s.cases[0].publications[0]; stored.status = status; stored.receiptUrl = "https://x.com/brand/status/901";
    const before = structuredClone(s), approval = s.authorities.at(-1)!;
    expect(() => run(s, { action: "request_reply_approval", caseId: c.id, publicationId: p.id })).toThrow("publication_not_editable");
    expect(() => setApproved(s, approval, marketer, "approved", NOW + 100)).toThrow("publication_not_editable");
    expect(s).toEqual(before);
  });
  it("Go cannot reset a frozen reply that became confirmed while approval was pending", () => {
    const s = candidateState(), c = s.cases[0], approval = s.authorities.find(a => a.request.kind === "candidate_go")!;
    c.publications[0].status = "confirmed"; c.publications[0].receiptUrl = "https://x.com/brand/status/902";
    const before = structuredClone(s); expect(() => setApproved(s, approval, marketer, "approved", NOW + 100)).toThrow("publication_not_editable"); expect(s).toEqual(before);
  });
  it("adds an approved manual resolution linked to earlier banter, preserving both receipts and preventing automatic sends", () => {
    const f = supplementalState(), original = structuredClone(f.c.publications[0]);
    let s = run(f.s, f.command); let c = s.cases.find(item => item.id === f.c.id)!, p = c.publications[1];
    expect(p).toMatchObject({ manualOnly: true, supplementalToPublicationId: original.id, resolutionCaseId: f.command.resolutionCaseId, targetId: original.targetId, sourceKey: original.sourceKey });
    expect(() => run(s, { action: "manual_receipt", caseId: c.id, publicationId: p.id, receiptUrl: "https://x.com/brand/status/999", attested: true, reason: "Exact human follow-up" })).toThrow("missing_approval");
    s = approve(s, "reply_approval"); c = s.cases.find(item => item.id === f.c.id)!; p = c.publications[1];
    expect(c.phase).toBe("AWAITING_MANUAL_CONFIRMATION"); expect(p.status).toBe("approved"); expect(c.publications[0]).toEqual(original);
    expect(() => assertCanPublish(s, c, p, NOW + 100)).toThrow("supplemental_manual_only");
    expect(() => createTask(s, "publish_reply", c.id, { publicationId: p.id }, NOW + 100)).toThrow("supplemental_manual_only");
    expect(() => run(s, { action: "demo_advance", caseId: c.id })).toThrow("supplemental_manual_only");
    s = run(s, { action: "manual_receipt", caseId: c.id, publicationId: p.id, receiptUrl: "https://x.com/brand/status/999", attested: true, reason: "Exact human follow-up" });
    c = s.cases.find(item => item.id === f.c.id)!; expect(c.publications[0]).toEqual(original); expect(c.publications[1]).toMatchObject({ status: "manually_attested", receiptUrl: "https://x.com/brand/status/999" });
    expect(() => run(s, f.command)).toThrow("supplemental_resolution_exists");
  });
  it("supplemental resolution requires marketer, confirmed engagement, fresh resolution proof and no unresolved attempt", () => {
    const f = supplementalState(); expect(() => run(f.s, f.command, engineer)).toThrow("forbidden");
    const stale = structuredClone(f.s); stale.cases.find(item => item.id === f.command.resolutionCaseId)!.liveVerifiedAt = NOW - 300_001;
    expect(() => run(stale, f.command)).toThrow("fresh_live_evidence_required");
    const uncertain = structuredClone(f.s); uncertain.cases.find(item => item.id === f.c.id)!.publications[0].status = "unknown";
    expect(() => run(uncertain, f.command)).toThrow("confirmed_engagement_receipt_required");
    const duplicate = structuredClone(f.s), c = duplicate.cases.find(item => item.id === f.c.id)!;
    c.publications.push({ ...c.publications[0], id: "another-attempt", status: "unknown" });
    expect(() => run(duplicate, f.command)).toThrow("reconciliation_required");
  });
  it("supplemental handoff rechecks changed text, referenced evidence, and expiry", () => {
    const f = supplementalState(); const s = approve(run(f.s, f.command), "reply_approval"), c = s.cases.find(item => item.id === f.c.id)!, p = c.publications[1];
    expect(() => assertCanPublish(s, c, p, NOW + 100, { manualSupplemental: true })).not.toThrow();
    const drift = structuredClone(s), changed = drift.cases.find(item => item.id === f.c.id)!; changed.publications[1].draftText = "Different approved text"; changed.publications[1].textHash = hashText(changed.publications[1].draftText);
    expect(() => assertCanPublish(drift, changed, changed.publications[1], NOW + 100, { manualSupplemental: true })).toThrow("stale_approval");
    s.cases.find(item => item.id === f.command.resolutionCaseId)!.evidence.push({ id: "new", label: "New revision", detail: "Changed evidence" });
    expect(() => assertCanPublish(s, c, p, NOW + 100, { manualSupplemental: true })).toThrow("stale_approval");
    expect(() => assertCanPublish(s, c, p, NOW + 301_000, { manualSupplemental: true })).toThrow("fresh_live_evidence_required");
  });
  it("edits/previews all seed voices, with the UI scale and human-readable objectives mapped", () => {
    const personas = initialState(config).personas;
    for (const p of personas) expect(localPreview(p, "Love the weather app").draft).toBeTruthy();
    expect(localPreview(personas[0], "opened the weather app to check if outside exists").draft).toBe("bruh 😭");
    expect(localPreview(personas[2], "roast me").decision).toBe("eligible");
  });
  it("activated persona auto-engages; genuine bugs are reserved for resolution", () => {
    let state = initialState(config); state = run(state, { action: "persona_request_activation", personaId: "friendly" }); state = approve(state, "persona_policy");
    state = intake(state, "789", "opened the weather app to check if outside exists");
    expect(state.cases[0].outcome).toBe("engaged"); expect(state.cases[0].publications[0].draftText).toBe("bruh 😭");
    state = intake(state); expect(state.cases[0].route).toBe("engineering_resolution"); expect(state.cases[0].publications).toHaveLength(0);
  });
  it("standing policy account bindings invalidate when the configured account changes", () => {
    let s = initialState(config); s = run(s, { action: "persona_request_activation", personaId: "friendly" }); s = approve(s, "persona_policy");
    s = intake(s, "account-bound", "Love the weather app!"); const c = s.cases[0], p = c.publications[0]; p.status = "approved"; delete p.confirmedAt; delete p.attemptedAt;
    s.connections.find(item => item.platform === "x")!.account = "different-brand";
    expect(() => assertCanPublish(s, c, p, NOW + 100)).toThrow("stale_approval");
  });
  it("activating Challenger revokes an overlapping Friendly standing policy", () => {
    let s = initialState(config); s = run(s, { action: "persona_request_activation", personaId: "friendly" }); s = approve(s, "persona_policy");
    const friendlyApproval = s.authorities.find(item => item.personaId === "friendly")!.request.requestId;
    const challenger = s.personas.find(item => item.id === "challenger")!;
    s = run(s, { action: "persona_request_activation", personaId: challenger.id }); s = approve(s, "persona_policy");
    expect(s.personas.find(item => item.id === challenger.id)!.status).toBe("active"); expect(s.personas.find(item => item.id === "friendly")!.status).toBe("revoked");
    expect(s.authorities.find(item => item.request.requestId === friendlyApproval)!.request.status).toBe("revoked");
  });
  it("revocation and missing expiry block an already queued policy reply", () => {
    let state = initialState(config); state = run(state, { action: "persona_request_activation", personaId: "friendly" }); state = approve(state, "persona_policy");
    state = intake(state, "777", "opened the weather app to check if outside exists");
    const c = state.cases[0], p = c.publications[0]; p.status = "approved"; delete p.confirmedAt; delete p.attemptedAt;
    preparePublication(state, c, NOW + 100); expect(p.status).toBe("reserved");
    const missing = structuredClone(state); delete missing.personas[0].expiresAt;
    expect(() => assertCanPublish(missing, missing.cases[0], missing.cases[0].publications[0], NOW + 101)).toThrow("policy_inactive");
    state = run(state, { action: "persona_revoke", personaId: "friendly" }, marketer, 4);
    expect(() => assertCanPublish(state, state.cases[0], state.cases[0].publications[0], NOW + 5)).toThrow("policy_inactive");
  });
  it("an engagement draft cannot acquire a fix claim by exact human approval", () => {
    let state = intake(initialState(config), "777", "Love this weather app");
    const c = state.cases[0], p = c.publications[0];
    state = run(state, { action: "draft_edit", caseId: c.id, publicationId: p.id, text: "We fixed the conversion bug." });
    state = run(state, { action: "request_reply_approval", caseId: c.id, publicationId: p.id }); state = approve(state, "reply_approval");
    expect(state.cases[0].blockingReason).toBe("support_claim_requires_exact_evidence");
  });
  it("unknown send blocks retry/manual duplication until recorded not-sent investigation", () => {
    let state = readyState(); const id = state.cases[0].id;
    expect(() => run(state, { action: "demo_fault", caseId: id, fault: "publication_unknown" }, marketer)).toThrow("forbidden");
    state = run(state, { action: "demo_fault", caseId: id, fault: "publication_unknown" }, admin, 5);
    expect(() => run(state, { action: "recover", caseId: id, operation: "retry", reason: "Retry" }, marketer)).toThrow("publication_unknown");
    expect(() => run(state, { action: "manual_receipt", caseId: id, publicationId: state.cases[0].publications[0].id, receiptUrl: "https://x.com/brand/status/444", attested: true, reason: "I posted" }, marketer)).toThrow("publication_unknown");
    expect(() => run(state, { action: "recover", caseId: id, operation: "reconcile", investigationOutcome: "definitely_not_sent", reason: "Investigated" }, marketer)).toThrow("investigation_attestation_required");
    state = run(state, { action: "recover", caseId: id, operation: "reconcile", investigationOutcome: "definitely_not_sent", attested: true, reason: "Checked target and account reply history" }, marketer, 6);
    expect(state.cases[0].publications[0].reconciliationHistory?.[0].residualUncertainty).toBe(true);
    state = run(state, { action: "demo_advance", caseId: id }, marketer, 7); expect(state.cases[0].phase).toBe("COMPLETED");
  });
  it("manual receipt requires attestation and preserves fixture provenance", () => {
    let state = readyState(); const id = state.cases[0].id;
    state = run(state, { action: "demo_fault", caseId: id, fault: "reconnect_required" }, admin, 5);
    const command = { action: "manual_receipt", caseId: id, publicationId: state.cases[0].publications[0].id, receiptUrl: "https://x.com/brand/status/444", attested: true, reason: "Operator confirms exact approved draft at original target" };
    expect(() => run(state, { ...command, attested: false }, marketer)).toThrow("receipt_attestation_required");
    state = run(state, command, marketer, 6); expect(state.cases[0].communicationStatus).toBe("simulated_attested"); expect(state.cases[0].publications[0].mode).toBe("fixture");
  });
  it("serial cost reservations enforce per-case caps and retain unknown billing", () => {
    const state = initialState(config); const first = reserveModelCost(state, "preview-1", 0.02, NOW); settleModelCost(state, first, "unknown");
    reserveModelCost(state, "preview-1", 0.02, NOW + 1); expect(() => reserveModelCost(state, "preview-1", 0.02, NOW + 2)).toThrow("case_budget_exhausted");
    expect(costTotals(state).reserved).toBe(0.04); expect(state.costs[0].status).toBe("unknown");
    const snapshot = hashText(canonicalJson(state)); expect(snapshot).toHaveLength(64);
  });
  it("retry binds a fresh attempt without reusing dispatched grants or model reservations", () => {
    let state = intake(); state.mode = "live"; const c = state.cases[0]; c.phase = "BUILDING";
    const created = createTask(state, "build_candidate", c.id, { authorityId: "build-authority", scope: ["lib/temperature.ts"], buildRequest: { attemptId: "old" }, modelAttempts: { 0: { reservationId: "unknown-old-charge" } }, socialJob: {}, grantJti: "consumed" }, NOW);
    state.tasks.find(task => task.id === created.id)!.status = "failed";
    state = run(state, { action: "recover", caseId: c.id, operation: "retry", reason: "Repair worker connection" }, engineer);
    const retried = state.tasks.at(-1)!; expect(retried.attemptId).not.toBe(created.attemptId); expect(retried.payload).toEqual({ authorityId: "build-authority", scope: ["lib/temperature.ts"] });
  });
  it("uncertain release needs explicit engineer reconciliation and the current exact Go", () => {
    let state = readyState(); state.mode = "live"; const c = state.cases[0], authorityId = state.authorities.find(a => a.request.kind === "candidate_go")!.request.requestId;
    const created = createTask(state, "release_candidate", c.id, { authorityId }, NOW); state.tasks.find(task => task.id === created.id)!.status = "unknown";
    expect(() => run(state, { action: "recover", caseId: c.id, operation: "retry", reason: "Try again" }, engineer)).toThrow("release_reconciliation_required");
    expect(() => run(state, { action: "recover", caseId: c.id, operation: "reconcile_release", reason: "Inspect merge and production alias" }, marketer)).toThrow("forbidden");
    state = run(state, { action: "recover", caseId: c.id, operation: "reconcile_release", reason: "Inspect merge and production alias" }, engineer);
    expect(state.tasks.at(-1)!.payload).toMatchObject({ authorityId, reconciliationOf: created.id, operatorId: engineer.id });
  });
});
