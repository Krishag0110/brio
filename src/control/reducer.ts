import { z } from "zod";
import { canonicalJson, hashText, HOUR, DAY, type Membership } from "../core/domain";
import { approvalBinding, createApprovalRequest, decideApproval, validateApproval, type ApprovalKind } from "../core/approvals";
import { canGroupReports, classifySignal, normalizeSignal, isOptOut, routeForClassification, type NormalizedSignal } from "../core/signals";
import { hasSupportClaim, personaFromUi, previewPersona, universalDraftReasons, validateDraft } from "../core/persona";
import { PERSONA_EVALUATION_VERSION } from "../core/persona-evaluation-cases";
import type { Persona, Snapshot, TestResult } from "../shared/control-contract";
import type { Actor, Authority, Command, ControlState, InternalCase, InternalPublication, RuntimeConfig, Task } from "./types";
import { DEMO_STEPS, DEMO_STEP_INTERVAL_MS, recordDemoStep, SIMULATED_DEMO_ACTOR, stopDemoRun } from "./demo-run-state";

const text = (value: unknown, max = 2000) => z.string().trim().min(1).max(max).parse(value);
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const nextId = (state: ControlState, prefix: string, now: number) => prefix + "_" + now.toString(36) + "_" + (++state.sequence).toString(36);
const role = (actor: Actor, ...roles: string[]) => { if (!roles.some((r) => actor.roles.includes(r as never))) throw new Error("forbidden"); };
const member = (state: ControlState, actor: Actor): Membership => ({ workspaceId: state.workspaceId, userId: actor.id, roles: actor.roles, active: true, ...(actor.slackUserId ? { slackUserId: actor.slackUserId, slackTeamId: actor.slackTeamId } : {}) });
export function audit(state: ControlState, actor: Actor, action: string, detail: string, now: number) {
  state.audit.unshift({ id: nextId(state, "event", now), at: new Date(now).toISOString(), actor: actor.name, role: actor.roles.join(","), action, detail });
  state.audit = state.audit.slice(0, 500);
}
const getCase = (state: ControlState, id: unknown) => { const found = state.cases.find((c) => c.id === id); if (!found) throw new Error("case_not_found"); return found; };
const getPersona = (state: ControlState, id: unknown) => { const found = state.personas.find((p) => p.id === id); if (!found) throw new Error("persona_not_found"); return found; };
export function publicationEvidenceCase(state: ControlState, c: InternalCase, p: InternalPublication): InternalCase {
  return p.manualOnly ? getCase(state, p.resolutionCaseId) : c;
}
function supplementalOriginal(state: ControlState, c: InternalCase, p: InternalPublication): InternalPublication {
  const original = c.publications.find(item => item.id === p.supplementalToPublicationId);
  if (!p.manualOnly || p.purpose === "engagement" || !original || original.manualOnly || original.purpose !== "engagement" || original.status !== "confirmed" || !original.receiptUrl || !original.confirmedAt || original.account !== p.account || original.sourceKey !== p.sourceKey || original.targetId !== p.targetId || original.mode !== p.mode || p.resolutionCaseId === c.id) throw new Error("confirmed_engagement_receipt_required");
  const proof = publicationEvidenceCase(state, c, p);
  if (proof.route === "social_engagement" || (p.mode === "live" && proof.sourceMode === "fixture")) throw new Error("verified_resolution_required");
  return original;
}
export function createTask(state: ControlState, kind: string, caseId: string | undefined, payload: Record<string, unknown>, now: number): Task {
  if (caseId && getCase(state, caseId).canceledAt) throw new Error("case_canceled");
  const existing = state.tasks.find((t) => t.caseId === caseId && t.kind === kind && ["pending", "running", "unknown"].includes(t.status) && canonicalJson(t.payload) === canonicalJson(payload));
  if (existing) return existing;
  const c = caseId ? getCase(state, caseId) : null;
  if (["publish_reply", "reconcile_publication"].includes(kind) && c?.publications.find(p => p.id === payload.publicationId)?.manualOnly) throw new Error("supplemental_manual_only");
  const task: Task = { id: nextId(state, "job", now), kind, caseId, payload, status: "pending", attemptId: nextId(state, "attempt", now), inputRevision: c?.version ?? state.version, createdAt: now };
  state.tasks.push(json(task)); if (c) c.activeJobId = task.id;
  return task;
}
function replyBinding(c: InternalCase, p: InternalPublication) {
  return { draftId: p.id, textHash: p.textHash, personaVersion: String(p.personaVersion), platform: c.sourcePlatform, accountId: p.account || "unconfigured",
    targetId: p.targetId, contextHash: p.contextHash, purpose: p.purpose };
}
export function bindingPayload(state: ControlState, authority: Authority): Record<string, unknown> {
  if (authority.personaId) {
    const persona = getPersona(state, authority.personaId);
    return { policyId: persona.id, version: String(persona.version), configurationHash: hashText(canonicalJson({ personaHash: persona.hash || hashText(canonicalJson(persona)), accounts: state.connections.filter(c => persona.platforms.includes(c.platform)).map(c => ({ platform: c.platform, accountId: c.account ?? "unconfigured" })).sort((a, b) => a.platform.localeCompare(b.platform)) })), previewCount: 8,
      evaluationVersion: PERSONA_EVALUATION_VERSION, evaluationPassed: true };
  }
  const c = getCase(state, authority.caseId);
  if (authority.request.kind === "build") return { repository: c.repository, baseSha: c.baseSha, planVersion: String(c.planVersion), allowedPaths: c.scope,
    acceptanceCriteria: ["20C converts to 68F in the UI", "0C=32F", "-40C=-40F", "100C=212F", "Repeated toggle and default-unit checks"],
    risk: "isolated weather fixture", maxAttempts: 3, maxCostUsd: 1 };
  if (authority.request.kind === "candidate_go") {
    if (!c.candidate) throw new Error("candidate_missing");
    return { repository: c.repository, baseSha: c.baseSha, headSha: c.candidate.headSha, treeDigest: c.candidate.treeDigest,
      deploymentId: c.candidate.deploymentId, testRevision: c.testRevision || "protected-v1", buildConfigRevision: c.buildConfigRevision || "build-v1",
      checkEvidenceDigest: hashText(canonicalJson(c.evidence.filter((e) => e.label === "Candidate verified"))), targetEnvironment: "production",
      replies: (Array.isArray(authority.payload.replies)
        ? authority.payload.replies.map((bound) => { const id = (bound as { draftId: string }).draftId; const current = c.publications.find((p) => p.id === id); if (!current) throw new Error("approved_reply_missing"); return current; })
        : c.publications.filter((p) => !["confirmed", "manually_attested"].includes(p.status))).map((p) => replyBinding(c, p)) };
  }
  const p = c.publications.find((p) => p.id === authority.payload.draftId);
  if (!p) throw new Error("draft_missing");
  const proof = publicationEvidenceCase(state, c, p);
  const context = p.manualOnly ? { evidence: proof.evidence, resolutionCaseId: proof.id, candidate: proof.candidate, originalPublicationId: supplementalOriginal(state, c, p).id, originalReceipt: supplementalOriginal(state, c, p).receiptUrl, manualOnly: true } : proof.evidence;
  return { ...replyBinding(c, p), evidenceContext: p.purpose === "engagement" ? null : hashText(canonicalJson(context)), deploymentId: p.purpose === "engagement" ? null : proof.candidate?.deploymentId ?? null };
}
export function requestAuthority(state: ControlState, kind: ApprovalKind, caseId: string | undefined, personaId: string | undefined, now: number, publicationId?: string): Authority {
  if (caseId && getCase(state, caseId).canceledAt) throw new Error("case_canceled");
  const holder = { caseId, personaId, payload: publicationId ? { draftId: publicationId } : {}, request: { kind } } as Authority;
  const payload = bindingPayload(state, holder);
  const version = personaId ? getPersona(state, personaId).version : getCase(state, caseId).version;
  const existing = state.authorities.find((a) => a.request.kind === kind && a.caseId === caseId && a.personaId === personaId && a.request.status === "pending" && a.request.binding === approvalBinding(kind, payload) && a.request.expiresAt > now);
  if (existing) return existing;
  const request = createApprovalRequest({ requestId: nextId(state, "approval", now), workspaceId: state.workspaceId, kind, version, payload, now });
  const authority: Authority = json({ request, caseId, personaId, payload });
  state.authorities.push(authority);
  if (personaId) { const p = getPersona(state, personaId); p.approvalId = request.requestId; p.status = "pending"; }
  if (caseId) { const c = getCase(state, caseId); c.phase = kind === "build" ? "AWAITING_BUILD" : "AWAITING_GO"; delete c.blockingReason; }
  if (state.mode === "live") createTask(state, "slack_approval", caseId, { authorityId: request.requestId }, now);
  return authority;
}
function invalidate(state: ControlState, c: InternalCase, kinds: ApprovalKind[] = ["candidate_go", "reply_approval"]) {
  for (const a of state.authorities) if (a.caseId === c.id && kinds.includes(a.request.kind) && ["pending", "approved"].includes(a.request.status)) a.request.status = "revoked";
  for (const p of c.publications) if (!["confirmed", "manually_attested", "unknown"].includes(p.status)) { p.status = "draft"; delete p.authorityId; delete p.authorityKind; }
  c.version++; c.blockingReason = "stale_approval";
}
export function addDraft(state: ControlState, c: InternalCase, draft: string, persona: Persona, now: number, purpose: InternalPublication["purpose"], signal: NormalizedSignal = c.signals[0]): InternalPublication {
  const connection = state.connections.find((x) => x.platform === signal.platform);
  const p: InternalPublication = { id: nextId(state, "reply", now), status: "draft", draftText: draft, mode: state.mode === "demo" || c.sourceMode === "fixture" ? "fixture" : "live",
    account: connection?.account ?? "demo-brand", targetUrl: signal.normalizedUrl ?? signal.originalUrl, version: 1, textHash: hashText(draft), targetId: signal.interactionId,
    sourceKey: signal.sourceKey, personaId: persona.id, personaVersion: persona.version, purpose, contextHash: hashText(signal.text), authorId: signal.authorId };
  c.publications.push(p); return p;
}
export function costTotals(state: ControlState) {
  const spent = state.costs.reduce((n, r) => n + (r.actualUsd ?? 0), 0);
  const reserved = state.costs.reduce((n, r) => n + (r.status === "settled" ? 0 : r.maximumUsd), state.infrastructureCommittedUsd);
  return { spent, reserved, committed: spent + reserved };
}
export function reserveModelCost(state: ControlState, caseId: string, maximumUsd: number, now: number): string {
  if (state.cases.find(c => c.id === caseId)?.canceledAt) throw new Error("case_canceled");
  if (!(maximumUsd > 0 && maximumUsd <= 1) || !Number.isFinite(state.infrastructureCommittedUsd) || state.infrastructureCommittedUsd < 0 || state.paused || costTotals(state).committed + maximumUsd > 90) throw new Error("budget_exhausted");
  const modelCommitted = state.costs.reduce((sum, r) => sum + (r.status === "settled" ? r.actualUsd ?? r.maximumUsd : r.maximumUsd), 0);
  if (Math.ceil((modelCommitted + maximumUsd) * 1_000_000) > 40_000_000) throw new Error("model_envelope_exhausted");
  const caseCost = state.costs.filter((r) => r.caseId === caseId).reduce((n, r) => n + (r.status === "settled" ? r.actualUsd || 0 : r.maximumUsd), 0);
  const cap = state.cases.find((c) => c.id === caseId)?.route === "social_engagement" || caseId.startsWith("preview") ? 0.05 : 1;
  if (caseCost + maximumUsd > cap) throw new Error("case_budget_exhausted");
  const id = nextId(state, "cost", now); state.costs.push({ id, caseId, maximumUsd, status: "reserved", createdAt: now }); return id;
}
export function settleModelCost(state: ControlState, id: string, outcome: "settled" | "unknown", actualUsd?: number) {
  const r = state.costs.find((r) => r.id === id); if (!r) throw new Error("reservation_not_found");
  if (r.status === "settled") return;
  if (outcome === "unknown") { r.status = "unknown"; return; }
  if (actualUsd === undefined || actualUsd < 0 || actualUsd > r.maximumUsd) throw new Error("cost_reconciliation_required");
  r.status = "settled"; r.actualUsd = actualUsd;
}
export function assertCanPublish(state: ControlState, c: InternalCase, p: InternalPublication, now: number, options: { requireImmediateIdentity?: boolean; manualSupplemental?: boolean } = {}): void {
  if (c.canceledAt) throw new Error("case_canceled");
  if (p.manualOnly && options.manualSupplemental !== true) throw new Error("supplemental_manual_only");
  const original = p.manualOnly ? supplementalOriginal(state, c, p) : undefined;
  const proof = publicationEvidenceCase(state, c, p);
  if (state.paused) throw new Error("workspace_paused");
  const connection = state.connections.find((x) => x.platform === c.sourcePlatform);
  if (connection?.paused) throw new Error("account_paused");
  if (!p.manualOnly && state.mode === "live" && p.mode === "live" && (!connection || connection.status !== "ready" || connection.permission !== "granted")) throw new Error("access_pending");
  if (state.suppressions.some((s) => s.platform === c.sourcePlatform && s.author === p.authorId) || isOptOut(c.text)) throw new Error("opt_out");
  if (["confirmed", "manually_attested", "unknown"].includes(p.status)) throw new Error(p.status === "unknown" ? "publication_unknown" : "already_published");
  if (state.cases.some((other) => other.publications.some((r) => r.id !== p.id && r.id !== original?.id && r.account === p.account && r.sourceKey === p.sourceKey && ["reserved", "publishing", "unknown", "confirmed", "manually_attested"].includes(r.status)))) throw new Error("interaction_already_reserved");
  const source = c.signals.find((signal) => signal.sourceKey === p.sourceKey);
  if (!source || p.textHash !== hashText(p.draftText) || p.contextHash !== hashText(source.text)) throw new Error("stale_draft");
  if (p.mode === "live" && (source.sourceMode === "fixture" || !source.hasValidTarget)) throw new Error("invalid_live_target");
  if (p.purpose === "engagement" && hasSupportClaim(p.draftText)) throw new Error("support_claim_requires_exact_evidence");
  const persona = getPersona(state, p.personaId);
  if (p.personaVersion !== persona.version) throw new Error("stale_persona");
  const universal = universalDraftReasons(p.draftText);
  if (universal.length) throw new Error("draft_rejected");
  if ([...p.draftText].length > persona.maxLength) throw new Error("draft_too_long");
  if (p.purpose !== "engagement" && (!proof.productionVerified || !proof.candidate || !proof.liveVerifiedAt || proof.liveVerifiedAt > now || now - proof.liveVerifiedAt > 5 * 60000)) throw new Error("fresh_live_evidence_required");
  if (options.requireImmediateIdentity !== false && state.mode === "live" && p.mode === "live" && p.purpose !== "engagement" &&
    (!proof.productionIdentityCheckedAt || proof.productionIdentityCheckedAt > now || now - proof.productionIdentityCheckedAt > 10_000 ||
      proof.productionDeploymentId !== proof.candidate?.deploymentId || proof.productionTreeDigest !== proof.candidate?.treeDigest)) throw new Error("immediate_production_identity_required");
  if (!p.authorityId) throw new Error("missing_approval");
  const authority = state.authorities.find((a) => a.request.requestId === p.authorityId);
  if (!authority) throw new Error("missing_approval");
  if (p.manualOnly && (p.authorityKind !== "reply_approval" || authority.request.kind !== "reply_approval" || authority.caseId !== c.id || authority.payload.draftId !== p.id)) throw new Error("exact_supplemental_approval_required");
  if (p.authorityKind === "persona_policy") {
    const expiry = Date.parse(persona.expiresAt || "");
    if (p.purpose !== "engagement" || persona.status !== "active" || !persona.autonomyEnabled || !Number.isFinite(expiry) || expiry <= now) throw new Error("policy_inactive");
    if (c.classification.category !== "low_risk_engagement" || c.classification.riskFlags.length || c.classification.confidence < 0.9) throw new Error("not_low_risk");
    const policyConfig = personaFromUi(persona, { workspaceId: state.workspaceId, accountIds: p.account ? [p.account] : [] }).config;
    if (!persona.platforms.includes(c.sourcePlatform) || !c.classification.engagementCategory || !policyConfig.engagementCategories.includes(c.classification.engagementCategory)) throw new Error("policy_category_or_platform_denied");
    if (["light_roast", "mild_repetition"].includes(c.classification.engagementCategory) && persona.roastLevel < 2) throw new Error("roast_level_denied");
    if (state.mode === "live" && (!c.draftedByModel || !c.validatedByModel)) throw new Error("independent_model_validation_required");
    const sent = state.cases.flatMap((x) => x.publications).filter((r) => r.authorityKind === "persona_policy" && r.attemptedAt !== undefined && r.id !== p.id);
    if (sent.filter((r) => now - r.attemptedAt! < HOUR).length >= persona.hourlyCap || sent.filter((r) => now - r.attemptedAt! < DAY).length >= persona.dailyCap) throw new Error("policy_rate_limit");
    if (sent.some((r) => r.authorId === p.authorId && now - r.attemptedAt! < persona.authorCooldownHours * HOUR)) throw new Error("author_cooldown");
  }
  const personaConfig = personaFromUi(persona, { workspaceId: state.workspaceId, accountIds: p.account ? [p.account] : [] }).config;
  const draftCheck = validateDraft({ text: p.draftText, purpose: p.purpose, config: personaConfig, platformMaxLength: c.sourcePlatform === "x" ? 280 : 10_000,
    platformLengthValid: true, classificationDecision: c.classification.category === "low_risk_engagement" && c.classification.confidence >= 0.9 && !c.classification.riskFlags.length ? "eligible" : "review_required",
    autonomy: p.authorityKind === "persona_policy", validation: { decision: "approve", language: c.classification.language, toneAllowed: true, forbiddenContent: false, unsupportedClaim: false, promptInjectionCompliance: false, targetMatches: true, reasons: [] } });
  if (!draftCheck.allowed) throw new Error(draftCheck.reasons[0]);
  const expected = approvalBinding(authority.request.kind, bindingPayload(state, authority));
  const check = validateApproval(authority.request, { workspaceId: state.workspaceId, kind: authority.request.kind, binding: expected }, now);
  if (!check.allowed) throw new Error(check.reasons[0]);
}
export function preparePublication(state: ControlState, c: InternalCase, now: number) {
  if (c.canceledAt) return;
  const p = c.publications.find((p) => !["confirmed", "manually_attested"].includes(p.status) && p.authorityId); if (!p) return;
  try { assertCanPublish(state, c, p, now, { requireImmediateIdentity: false, manualSupplemental: p.manualOnly }); }
  catch (e) { c.blockingReason = e instanceof Error ? e.message : "needs_review"; c.phase = "READY_TO_PUBLISH"; return; }
  if (p.manualOnly) { p.status = "approved"; c.phase = "AWAITING_MANUAL_CONFIRMATION"; c.communicationStatus = "supplemental_manual_pending"; delete c.blockingReason; return; }
  p.status = "reserved"; c.phase = "READY_TO_PUBLISH"; delete c.blockingReason;
  if (state.mode === "live") createTask(state, "publish_reply", c.id, { publicationId: p.id }, now);
}
function demoPublish(state: ControlState, c: InternalCase, now: number) {
  if (state.mode !== "demo") throw new Error("demo_only");
  const p = c.publications.find((p) => !["confirmed", "manually_attested"].includes(p.status) && p.authorityId); if (!p) return;
  assertCanPublish(state, c, p, now);
  p.attemptedAt = now; p.confirmedAt = now; p.status = "confirmed"; p.receiptUrl = "https://example.invalid/simulated/" + p.id;
  p.mode = "fixture";
  finishCommunication(c, "simulated_confirmed");
  if (c.phase !== "COMPLETED") preparePublication(state, c, now);
}
export function finishCommunication(c: InternalCase, completedStatus: string): void {
  if (c.canceledAt) { c.communicationStatus = completedStatus; return; }
  if (c.publications.length > 0 && c.publications.every((p) => ["confirmed", "manually_attested"].includes(p.status))) {
    c.communicationStatus = completedStatus; c.phase = "COMPLETED";
    c.outcome = c.route === "social_engagement" ? "engaged" : c.route === "known_remedy" ? c.publications.some((p) => p.purpose === "workaround") ? "workaround_delivered" : "remedy_delivered" : "fixed_and_notified";
    delete c.blockingReason;
  } else { c.communicationStatus = "partially_confirmed"; c.phase = "READY_TO_PUBLISH"; delete c.outcome; }
}
export function localPreview(persona: Persona, input: string, purpose: "engagement" | "resolution" | "known_remedy" = "engagement", direct = true): TestResult {
  const config = personaFromUi(persona, { workspaceId: "fde", accountIds: ["demo-brand"] });
  const output = previewPersona(config, input, purpose === "known_remedy" ? "instructions" : purpose);
  if (!direct && purpose === "engagement") return { decision: "review_required", reasons: ["missing_contact_intent"], checks: output.checks };
  return output;
}
export function setApproved(state: ControlState, a: Authority, actor: Actor, decision: "approved" | "declined", now: number, reason?: string) {
  const expectedBinding = approvalBinding(a.request.kind, bindingPayload(state, a));
  const result = decideApproval(a.request, { currentRequestId: a.request.requestId, expectedVersion: a.request.version, expectedBinding, actor: member(state, actor), decision, reason, now });
  if (!result.duplicate && decision === "approved" && a.caseId && ["reply_approval", "candidate_go"].includes(a.request.kind)) {
    const c = getCase(state, a.caseId);
    const ids = a.request.kind === "reply_approval" ? [a.payload.draftId] : (a.payload.replies as { draftId: string }[]).map(reply => reply.draftId);
    if (c.publications.some(p => ids.includes(p.id) && ["confirmed", "manually_attested", "unknown", "publishing"].includes(p.status))) throw new Error("publication_not_editable");
  }
  a.request = json(result.request);
  if (result.duplicate) return;
  if (a.personaId) {
    const p = getPersona(state, a.personaId); p.status = decision === "approved" ? "active" : "draft";
    if (decision === "approved") {
      p.expiresAt = new Date(now + 7 * DAY).toISOString();
      // One active policy for overlapping accounts/platforms: a new strategy replaces the old strategy explicitly.
      for (const other of state.personas.filter(other => other.id !== p.id && other.status === "active" && other.platforms.some(platform => p.platforms.includes(platform)))) {
        other.status = "revoked";
        for (const previous of state.authorities.filter(previous => previous.personaId === other.id)) previous.request.status = "revoked";
        for (const c of state.cases) if (c.publications.some(reply => reply.personaId === other.id && reply.authorityKind === "persona_policy" && !["confirmed", "manually_attested"].includes(reply.status))) c.blockingReason = "policy_replaced";
      }
    }
    return;
  }
  const c = getCase(state, a.caseId);
  if (decision === "declined") {
    c.blockingReason = a.request.kind === "build" ? undefined : "no_go";
    if (a.request.kind === "build") { c.outcome = "build_declined"; c.phase = "COMPLETED"; }
    return;
  }
  if (a.request.kind === "build") { c.phase = "BUILDING"; delete c.blockingReason; if (state.mode === "live") createTask(state, "build_candidate", c.id, { authorityId: a.request.requestId }, now); }
  else {
    const frozenIds = Array.isArray(a.payload.replies) ? a.payload.replies.map((bound) => (bound as { draftId: string }).draftId) : [];
    const pubs = a.request.kind === "reply_approval" ? c.publications.filter((p) => p.id === a.payload.draftId) : c.publications.filter((p) => frozenIds.includes(p.id));
    for (const p of pubs) { p.authorityId = a.request.requestId; p.authorityKind = a.request.kind; p.status = "approved"; }
    if (a.request.kind === "candidate_go") { c.phase = "RELEASING"; if (state.mode === "live") createTask(state, "release_candidate", c.id, { authorityId: a.request.requestId }, now); }
    else preparePublication(state, c, now);
  }
}
export function applyCommand(original: ControlState, cmd: Command, actor: Actor, config: RuntimeConfig, now = Date.now(), internal = false): ControlState {
  let state = json(original);
  let actionDetail: string | undefined;
  const caseFor = () => getCase(state, cmd.caseId);
  if (!internal && cmd.action.startsWith("internal_")) throw new Error("forbidden");
  if ((cmd.action.startsWith("demo_") || cmd.action === "internal_demo_step") && (state.mode !== "demo" || config.mode !== "demo")) throw new Error("demo_only");
  if (cmd.caseId && state.cases.find(c => c.id === cmd.caseId)?.canceledAt && cmd.action !== "cancel_case" && !(cmd.action === "recover" && cmd.operation === "reconcile" && cmd.investigationOutcome !== undefined)) throw new Error("case_canceled");
  switch (cmd.action) {
    case "demo_start":
    case "demo_restart": {
      role(actor, "engineer", "marketer", "admin");
      if (state.paused) throw new Error("workspace_paused");
      if (cmd.runId !== undefined && cmd.runId !== state.demoRun?.runId) throw new Error("stale_demo_run");
      if (cmd.action === "demo_start" && state.demoRun && state.demoRun.status !== "completed") return state;
      if (state.demoRun) {
        stopDemoRun(state, now, "restarted", state.cases.find(c => c.id === state.demoRun!.caseId)?.phase ?? "COMPLETED");
        state.demoRunHistory = [...(state.demoRunHistory ?? []), json(state.demoRun)].slice(-20);
      }
      const runId = nextId(state, "demo", now);
      state = applyCommand(state, { action: "intake", platform: "x", mode: "fixture", demoRunId: runId,
        authorId: "simulated-customer-" + runId, sourceUrl: `https://example.invalid/demo/${runId}`,
        text: "20°C becomes 20°F. Your weather calculator is broken — it should show 68°F." }, SIMULATED_DEMO_ACTOR, config, now, true);
      const c = state.cases[0]; c.title = "[SIMULATED DEMO] Weather conversion: 20°C → 20°F"; c.phase = "RECEIVED";
      state.demoRun = { runId, caseId: c.id, status: "running", stepIndex: 0, totalSteps: DEMO_STEPS.length,
        stepLabel: DEMO_STEPS[0].title, nextAt: now + DEMO_STEP_INTERVAL_MS, startedAt: now, updatedAt: now, events: [] };
      recordDemoStep(state.demoRun, now);
      actionDetail = "Started a simulated seeded weather workflow. No providers, models, or public sends are used.";
      break;
    }
    case "demo_pause":
    case "demo_resume": {
      role(actor, "engineer", "marketer", "admin"); const run = state.demoRun;
      if (!run) throw new Error("demo_run_missing");
      if (cmd.runId !== undefined && cmd.runId !== run.runId) throw new Error("stale_demo_run");
      if (run.status === "completed") return state;
      const pause = cmd.action === "demo_pause";
      if (run.status === (pause ? "paused" : "running")) return state;
      if (!pause && state.paused) throw new Error("workspace_paused");
      if (!pause && getCase(state, run.caseId).canceledAt) throw new Error("case_canceled");
      run.status = pause ? "paused" : "running"; run.nextAt = pause ? null : now + DEMO_STEP_INTERVAL_MS; run.updatedAt = now;
      delete run.stopReason;
      run.events.push({ id: nextId(state, "demo_control", now), at: now, title: pause ? "Demo paused" : "Demo resumed", detail: "Operator changed the simulated run playback.", phase: getCase(state, run.caseId).phase });
      break;
    }
    case "internal_demo_step": {
      if (!internal || actor.id !== SIMULATED_DEMO_ACTOR.id) throw new Error("forbidden");
      const run = state.demoRun;
      if (!run || run.runId !== cmd.runId || run.caseId !== cmd.caseId || run.stepIndex !== cmd.stepIndex || run.status !== "running") return state;
      if (state.paused || run.nextAt === null || now < run.nextAt) return state;
      const c = caseFor(), step = DEMO_STEPS[run.stepIndex];
      if (c.sourceMode !== "fixture" || c.phase !== DEMO_STEPS[run.stepIndex - 1]?.phase || !step) throw new Error("demo_case_changed");
      const authority = (kind: "build" | "candidate_go", approved = false) => {
        const a = state.authorities.findLast(a => a.caseId === c.id && a.request.kind === kind);
        if (!a || (approved && !validateApproval(a.request, { workspaceId: state.workspaceId, kind, binding: approvalBinding(kind, bindingPayload(state, a)) }, now).allowed)) throw new Error(kind === "build" ? "missing_build_approval" : "missing_go");
        return a;
      };
      switch (run.stepIndex) {
        case 1: break; // The intake reducer already computed the deterministic classification.
        case 2: c.evidence.push({ id: nextId(state, "evidence", now), label: "Simulated reproduction", detail: step.detail }); break;
        case 3: requestAuthority(state, "build", c.id, undefined, now); break;
        case 4: setApproved(state, authority("build"), { id: "simulated-demo-engineer", name: "Simulated engineer", roles: ["engineer"] }, "approved", now); break;
        case 5: {
          authority("build", true); c.buildAttemptNumber = (c.buildAttemptNumber ?? 0) + 1;
          if (c.buildAttemptNumber > 3) throw new Error("engineering_attempts_exhausted");
          c.candidate = { headSha: hashText(c.id + ":head:" + c.buildAttemptNumber), treeDigest: hashText(c.id + ":tree:" + c.buildAttemptNumber), deploymentId: "simulated_" + c.id + "_" + c.buildAttemptNumber, checksPassed: false, productionUrl: "https://example.invalid/demo/weather" };
          c.testRevision = "protected-v1"; c.buildConfigRevision = "build-v1";
          c.evidence.push({ id: nextId(state, "patch", now), label: "Simulated patch", detail: "lib/temperature.ts: replace the seeded identity conversion with celsius * 9 / 5 + 32. No repository file was changed." });
          break;
        }
        case 6:
          authority("build", true); if (!c.candidate) throw new Error("candidate_missing"); c.candidate.checksPassed = true;
          c.evidence.push({ id: nextId(state, "evidence", now), label: "Candidate verified", detail: step.detail });
          addDraft(state, c, "Our calculator needed coffee. Fixed: 20°C now correctly shows 68°F. Thanks for catching it.", state.personas[0], now, "resolution");
          break;
        case 7: if (!c.candidate?.checksPassed) throw new Error("checks_failed"); requestAuthority(state, "candidate_go", c.id, undefined, now); break;
        case 8: setApproved(state, authority("candidate_go"), { id: "simulated-demo-marketer", name: "Simulated marketer", roles: ["marketer"] }, "approved", now); break;
        case 9:
          authority("candidate_go", true); c.releaseSubstage = "simulated_promoted";
          c.evidence.push({ id: nextId(state, "release", now), label: "Simulated release", detail: step.detail }); break;
        case 10:
          authority("candidate_go", true); if (!c.candidate?.checksPassed) throw new Error("checks_failed");
          c.productionVerified = true; c.liveVerifiedAt = now; c.productionIdentityCheckedAt = now;
          c.productionDeploymentId = c.candidate.deploymentId; c.productionTreeDigest = c.candidate.treeDigest;
          c.evidence.push({ id: nextId(state, "live", now), label: "Simulated live verification", detail: step.detail });
          preparePublication(state, c, now); if (c.blockingReason) throw new Error(c.blockingReason); break;
        case 11: {
          const p = c.publications[0]; if (!p || p.status !== "reserved") throw new Error("publication_not_ready");
          assertCanPublish(state, c, p, now); p.status = "publishing"; p.attemptedAt = now; c.communicationStatus = "simulated_sending"; break;
        }
        case 12: demoPublish(state, c, now); break;
      }
      c.phase = step.phase; recordDemoStep(run, now); actionDetail = step.detail;
      break;
    }
    case "cancel_case": {
      role(actor, "engineer", "marketer"); const c = caseFor(), reason = text(cmd.reason); if (c.canceledAt) return state;
      c.canceledAt = now; c.canceledBy = actor.id; c.cancellationReason = reason; c.version++;
      for (const authority of state.authorities) if (authority.caseId === c.id && ["pending", "approved"].includes(authority.request.status)) authority.request.status = "revoked";
      let uncertain = false, dispatched = false;
      for (const task of state.tasks.filter(task => task.caseId === c.id)) {
        const effect = ["publish_reply", "reconcile_publication", "build_candidate", "stage_candidate", "release_candidate", "rollback_deployment", "linear_create"].includes(task.kind);
        if (task.dispatchedAt !== undefined) dispatched = true;
        if (!["pending", "running", "unknown"].includes(task.status)) continue;
        const inFlight = task.status !== "pending" || task.dispatchedAt !== undefined;
        task.status = inFlight && effect ? "unknown" : "failed"; task.error = inFlight && effect ? "case_canceled_reconciliation_required" : "case_canceled_before_dispatch"; task.completedAt = now;
        if (inFlight && effect) {
          uncertain = true; const p = c.publications.find(p => p.id === task.payload.publicationId);
          if (p && !["confirmed", "manually_attested"].includes(p.status)) p.status = "unknown";
        }
      }
      for (const p of c.publications) {
        if (["confirmed", "manually_attested"].includes(p.status)) { dispatched = true; continue; }
        if (["publishing", "unknown"].includes(p.status)) { uncertain = true; p.status = "unknown"; }
        else { p.status = "definitely_not_sent"; }
      }
      c.phase = "COMPLETED"; c.outcome = uncertain ? "canceled_with_unresolved_effects" : dispatched ? "canceled_after_dispatch" : "canceled_before_dispatch";
      c.communicationStatus = uncertain ? "unknown" : "canceled"; c.blockingReason = uncertain ? "cancellation_reconciliation_required" : undefined;
      if (state.demoRun?.caseId === c.id) stopDemoRun(state, now, "case_canceled", c.phase);
      actionDetail = uncertain ? `Case canceled. In-flight effects remain uncertain and require reconciliation. ${reason}` : `Case canceled. Undispatched work stopped; prior receipts and evidence retained. ${reason}`;
      break;
    }
    case "intake": {
      if (!internal) role(actor, "engineer", "marketer", "admin");
      if (state.paused) throw new Error("workspace_paused");
      if (state.cases.length >= 100) throw new Error("case_capacity_reached");
      const platform = z.enum(["x", "reddit"]).parse(cmd.platform);
      const mode = z.enum(["live", "manual", "fixture"]).parse(cmd.mode ?? "manual");
      const demoRunIntake = internal && config.mode === "demo" && state.mode === "demo" && mode === "fixture" && typeof cmd.demoRunId === "string";
      if (mode === "live" && !internal) throw new Error("live_intake_requires_adapter");
      const input = internal ? z.string().min(1).max(10000).refine(value => value.trim().length > 0).parse(cmd.text) : text(cmd.text, 10000), sourceUrl = typeof cmd.sourceUrl === "string" ? cmd.sourceUrl : "";
      const signature = /20\s*°?\s*c(?:elsius)?\b.*20\s*°?\s*f(?:ahrenheit)?\b/i.test(input)
        ? { component: "temperature-conversion", symptomSignature: "celsius:20;fahrenheit:20;expected:68" } : {};
      const id = nextId(state, "case", now);
      const signal = normalizeSignal({ workspaceId: state.workspaceId, platform, sourceMode: mode, originalUrl: sourceUrl,
        authorId: typeof cmd.authorId === "string" ? cmd.authorId : sourceUrl ? new URL(sourceUrl).pathname.split("/")[1] || "manual" : id,
        text: input, observedAt: now, productId: "weather", deployedRevision: config.baseSha, localId: id, ...signature,
        ...(mode === "fixture" ? { fixtureNamespace: demoRunIntake ? String(cmd.demoRunId) : "demo" } : {}) });
      if (state.sourceKeys.includes(signal.sourceKey)) return state;
      state.sourceKeys.push(signal.sourceKey);
      const classification = classifySignal(input), route = routeForClassification(classification) ?? "social_engagement";
      const c: InternalCase = { id, title: input.slice(0, 100), sourcePlatform: platform, sourceMode: mode, sourceUrl: signal.normalizedUrl ?? sourceUrl,
        text: input, route, phase: "TRIAGING", createdAt: new Date(now).toISOString(), productionVerified: false, communicationStatus: "not_started",
        evidence: [], approvals: [], publications: [], classification, signals: [signal], version: 1, planVersion: 1, baseSha: config.baseSha,
        repository: config.repository, scope: ["lib/temperature.ts"] };
      state.cases.unshift(c);
      if (isOptOut(input)) {
        state.suppressions.push({ id: nextId(state, "optout", now), platform, author: signal.authorId, reason: "Customer opt-out" });
        c.phase = "COMPLETED"; c.outcome = "ignored";
      } else if (classification.category === "irrelevant_harmful_spam") { c.phase = "COMPLETED"; c.outcome = "ignored"; }
      else if (state.mode === "live" && mode !== "fixture") { createTask(state, "triage", c.id, {}, now); }
      else if (demoRunIntake) { c.phase = "RECEIVED"; }
      else if (route === "engineering_resolution") {
        const prior = state.cases.find((other) => other.id !== id && other.route === route && other.sourcePlatform === platform && other.phase !== "COMPLETED" && other.signals.some((existing) => canGroupReports(existing, signal)));
        if (prior) {
          prior.signals.push(signal); prior.evidence.push({ id: nextId(state, "duplicate", now), label: "Grouped report", detail: input });
          const existingDraft = prior.publications.find((p) => p.purpose === "resolution");
          if (existingDraft) {
            const persona = getPersona(state, existingDraft.personaId);
            addDraft(state, prior, existingDraft.draftText, persona, now, "resolution", signal);
            if (prior.productionVerified) { prior.communicationStatus = "pending_new_reply_approval"; prior.blockingReason = "needs_review"; }
          }
          state.cases = state.cases.filter((x) => x.id !== id);
        }
        else {
          const solved = state.cases.find((other) => other.id !== id && other.productionVerified && other.sourcePlatform === platform && other.signals.some((existing) => canGroupReports(existing, signal)));
          if (solved) { c.route = "known_remedy"; c.candidate = json(solved.candidate); }
          c.phase = "INVESTIGATING";
        }
      } else if (classification.category === "low_risk_engagement") {
        const p = state.personas.find((p) => p.status === "active" && p.autonomyEnabled) ?? state.personas[0];
        const preview = localPreview(p, input);
        if (preview.draft) {
          const pub = addDraft(state, c, preview.draft, p, now, "engagement");
          const a = state.authorities.findLast((a) => a.personaId === p.id && a.request.status === "approved");
          if (a && preview.decision === "eligible") { pub.authorityId = a.request.requestId; pub.authorityKind = "persona_policy"; preparePublication(state, c, now); if (!c.blockingReason) demoPublish(state, c, now); }
          else { c.phase = "AWAITING_GO"; c.blockingReason = "needs_review"; }
        } else { c.blockingReason = "needs_review"; }
      } else { c.blockingReason = "needs_review"; }
      break;
    }
    case "persona_save": {
      role(actor, "marketer");
      const raw = z.object({ id: z.string(), name: z.string().min(1).max(100), objective: z.string(), brandDescription: z.string().min(1).max(1000), audience: z.string().min(1).max(500),
        formality: z.number().min(0).max(5), warmth: z.number().min(0).max(5), directness: z.number().min(0).max(5), slang: z.number().min(0).max(5), humorLevel: z.number().min(0).max(5),
        roastLevel: z.number().int().min(0).max(2), maxLength: z.number().int().min(1).max(240), maxEmoji: z.number().int().min(0).max(1),
        allowedCategories: z.array(z.string()), doNotEngage: z.array(z.string()), bannedPhrases: z.array(z.string()), hourlyCap: z.number().int().min(0).max(100),
        dailyCap: z.number().int().min(0).max(500), authorCooldownHours: z.number().min(24), platforms: z.array(z.enum(["x", "reddit"])), autonomyEnabled: z.boolean(),
        approvedVocabulary: z.array(z.string()).optional(), examples: z.array(z.string()).optional(), counterexamples: z.array(z.string()).optional() }).parse(cmd.persona);
      const old = getPersona(state, raw.id);
      const p: Persona = { ...raw, version: old.version + 1, status: "draft" };
      p.hash = hashText(canonicalJson(json(p))); state.personas[state.personas.indexOf(old)] = p;
      for (const a of state.authorities) if (a.personaId === p.id) a.request.status = "revoked";
      for (const c of state.cases) if (c.publications.some((r) => r.personaId === p.id && !["confirmed", "manually_attested"].includes(r.status))) invalidate(state, c);
      break;
    }
    case "persona_request_activation": {
      role(actor, "marketer"); const p = getPersona(state, cmd.personaId);
      p.hash = hashText(canonicalJson(json({ ...p, status: "draft", approvalId: null, slackUrl: null, expiresAt: null })));
      if (state.mode === "live" && !internal) { createTask(state, "evaluate_persona", undefined, { personaId: p.id, version: p.version }, now); p.status = "pending"; }
      else requestAuthority(state, "persona_policy", undefined, p.id, now);
      break;
    }
    case "persona_revoke": {
      role(actor, "marketer", "admin"); const p = getPersona(state, cmd.personaId); p.status = "revoked";
      for (const a of state.authorities) if (a.personaId === p.id) a.request.status = "revoked";
      for (const c of state.cases) if (c.publications.some((r) => r.personaId === p.id && r.authorityKind === "persona_policy" && r.status !== "confirmed")) c.blockingReason = "policy_inactive";
      break;
    }
    case "demo_role": if (state.mode !== "demo") throw new Error("demo_only"); state.demoRole = z.enum(["engineer", "marketer", "admin"]).parse(cmd.role); break;
    case "demo_decide":
    case "internal_decide": {
      if (cmd.action === "demo_decide" && state.mode !== "demo") throw new Error("demo_only");
      const a = state.authorities.find((a) => a.request.requestId === cmd.approvalId); if (!a) throw new Error("approval_not_found");
      setApproved(state, a, actor, z.enum(["approved", "declined"]).parse(cmd.decision), now, typeof cmd.reason === "string" ? cmd.reason : "Human declined");
      break;
    }
    case "demo_advance": {
      if (state.mode !== "demo") throw new Error("demo_only"); if (state.paused) throw new Error("workspace_paused");
      const c = caseFor();
      if (c.phase === "INVESTIGATING") {
        role(actor, "engineer");
        c.evidence.push({ id: nextId(state, "evidence", now), label: "Simulated reproduction", detail: "Fixture scenario: 20°C displays 20°F; expected 68°F. This UI event is simulated; protected browser tests run separately." });
        if (c.route === "known_remedy" && c.candidate) {
          c.productionVerified = true; c.liveVerifiedAt = now;
          const pub = addDraft(state, c, "The verified demo now converts 20°C to 68°F. Thanks for checking.", state.personas[0], now, "known_fix");
          requestAuthority(state, "reply_approval", c.id, undefined, now, pub.id);
        } else requestAuthority(state, "build", c.id, undefined, now);
      } else if (c.phase === "BUILDING") {
        role(actor, "engineer");
        const a = state.authorities.findLast((a) => a.caseId === c.id && a.request.kind === "build");
        if (!a || !validateApproval(a.request, { workspaceId: state.workspaceId, kind: "build", binding: approvalBinding("build", bindingPayload(state, a)) }, now).allowed) throw new Error("missing_build_approval");
        c.buildAttemptNumber = (c.buildAttemptNumber ?? 0) + 1;
        if (c.buildAttemptNumber > 3) throw new Error("engineering_attempts_exhausted");
        c.candidate = { headSha: hashText(c.id + ":head:" + c.buildAttemptNumber), treeDigest: hashText(c.id + ":tree:" + c.buildAttemptNumber), deploymentId: "simulated_" + c.id + "_" + c.buildAttemptNumber, checksPassed: true, productionUrl: "http://127.0.0.1:3001" };
        c.testRevision = "protected-v1"; c.buildConfigRevision = "build-v1";
        c.evidence.push({ id: nextId(state, "evidence", now), label: "Candidate verified", detail: "SIMULATED candidate checks. Live GitHub and Vercel integrations not exercised." });
        for (const signal of c.signals) if (!c.publications.some((p) => p.sourceKey === signal.sourceKey && p.purpose === "resolution")) addDraft(state, c, "Our calculator needed coffee. Fixed: 20°C now correctly shows 68°F. Thanks for catching it.", state.personas[0], now, "resolution", signal);
        requestAuthority(state, "candidate_go", c.id, undefined, now);
      } else if (c.phase === "RELEASING") {
        role(actor, "engineer", "marketer");
        const a = state.authorities.findLast((a) => a.caseId === c.id && a.request.kind === "candidate_go");
        if (!a || !validateApproval(a.request, { workspaceId: state.workspaceId, kind: "candidate_go", binding: approvalBinding("candidate_go", bindingPayload(state, a)) }, now).allowed) throw new Error("missing_go");
        c.productionVerified = true; c.liveVerifiedAt = now; c.productionIdentityCheckedAt = now; c.productionDeploymentId = c.candidate?.deploymentId; c.productionTreeDigest = c.candidate?.treeDigest; c.phase = "READY_TO_PUBLISH";
        c.evidence.push({ id: nextId(state, "live", now), label: "Simulated live verification", detail: "SIMULATED approved deployment identity and 68°F behavior. No production release occurred." });
        preparePublication(state, c, now);
      } else if (["READY_TO_PUBLISH", "AWAITING_MANUAL_CONFIRMATION"].includes(c.phase)) {
        role(actor, "marketer"); demoPublish(state, c, now);
      } else throw new Error("no_demo_transition");
      break;
    }
    case "supplemental_resolution": {
      role(actor, "marketer"); if (state.paused) throw new Error("workspace_paused");
      const c = caseFor(), original = c.publications.find(p => p.id === cmd.publicationId); if (!original) throw new Error("publication_not_found");
      if (c.publications.some(p => p.supplementalToPublicationId === original.id)) throw new Error("supplemental_resolution_exists");
      const proof = getCase(state, cmd.resolutionCaseId);
      if (!proof.productionVerified || !proof.candidate?.checksPassed || !proof.liveVerifiedAt || proof.liveVerifiedAt > now || now - proof.liveVerifiedAt > 300_000) throw new Error("fresh_live_evidence_required");
      const source = c.signals.find(signal => signal.sourceKey === original.sourceKey); if (!source) throw new Error("source_missing");
      const draft = text(cmd.text, 240); if (universalDraftReasons(draft).length) throw new Error("draft_rejected");
      const p = addDraft(state, c, draft, getPersona(state, original.personaId), now, "resolution", source);
      p.account = original.account; p.mode = original.mode; p.manualOnly = true; p.supplementalToPublicationId = original.id; p.resolutionCaseId = proof.id;
      supplementalOriginal(state, c, p);
      if (state.cases.some(other => other.publications.some(item => item.sourceKey === p.sourceKey && item.account === p.account && ["unknown", "publishing", "reserved"].includes(item.status)))) throw new Error("reconciliation_required");
      requestAuthority(state, "reply_approval", c.id, undefined, now, p.id); delete c.outcome;
      actionDetail = `Supplemental human resolution ${p.id} links confirmed engagement ${original.id} to verified case ${proof.id}; exact approval and a separate manual receipt are required.`;
      break;
    }
    case "draft_edit": {
      role(actor, "marketer"); const c = caseFor(), p = c.publications.find((p) => p.id === cmd.publicationId); if (!p) throw new Error("draft_missing");
      if (["publishing", "unknown", "confirmed", "manually_attested"].includes(p.status)) throw new Error("publication_not_editable");
      p.draftText = text(cmd.text, 240); p.textHash = hashText(p.draftText); p.version = (p.version ?? 1) + 1;
      invalidate(state, c); c.phase = "AWAITING_GO"; break;
    }
    case "request_reply_approval": {
      role(actor, "marketer"); const c = caseFor(), p = c.publications.find((p) => p.id === cmd.publicationId); if (!p) throw new Error("draft_missing");
      if (["confirmed", "manually_attested", "unknown", "publishing"].includes(p.status)) throw new Error("publication_not_editable");
      if (universalDraftReasons(p.draftText).length) throw new Error("draft_rejected");
      p.personaVersion = getPersona(state, p.personaId).version;
      requestAuthority(state, c.candidate && !c.productionVerified && c.route === "engineering_resolution" ? "candidate_go" : "reply_approval", c.id, undefined, now, p.id); break;
    }
    case "request_build": {
      role(actor, "engineer"); if (state.paused) throw new Error("workspace_paused");
      const c = caseFor(); if (c.phase !== "AWAITING_BUILD") throw new Error("build_request_phase_required");
      if (state.mode === "live" && (!c.linearId || !c.evidence.some(item => item.label === "Protected reproduction"))) throw new Error("protected_reproduction_and_linear_required");
      const previous = state.authorities.filter(a => a.caseId === c.id && a.request.kind === "build");
      if (previous.some(a => (a.request.status === "pending" && a.request.expiresAt > now) || validateApproval(a.request, { workspaceId: state.workspaceId, kind: "build", binding: approvalBinding("build", bindingPayload(state, a)) }, now).allowed)) throw new Error("current_build_approval_exists");
      for (const a of previous) if (a.request.status === "pending" || a.request.status === "approved") a.request.status = "revoked";
      requestAuthority(state, "build", c.id, undefined, now);
      actionDetail = "Requested fresh engineer Build approval for the current reproduced scope; no build was authorized.";
      break;
    }
    case "budget_commit": {
      role(actor, "admin"); const reason = text(cmd.reason); const usd = z.number().finite().min(0).max(100).parse(cmd.usd);
      if (costTotals(state).committed - state.infrastructureCommittedUsd + usd > 100) throw new Error("budget_ceiling_exceeded");
      actionDetail = `Infrastructure commitment $${state.infrastructureCommittedUsd.toFixed(2)} to $${usd.toFixed(2)}. ${reason}`;
      state.infrastructureCommittedUsd = usd; break;
    }
    case "reverify_live": {
      role(actor, "engineer", "marketer"); if (state.paused) throw new Error("workspace_paused");
      const c = caseFor(); if (!c.productionVerified || !c.candidate) throw new Error("verified_production_candidate_required");
      if (c.publications.some(p => ["unknown", "publishing"].includes(p.status))) throw new Error("reconciliation_required");
      if (state.mode === "demo") {
        c.liveVerifiedAt = now; c.productionIdentityCheckedAt = now; c.productionDeploymentId = c.candidate.deploymentId; c.productionTreeDigest = c.candidate.treeDigest;
        c.evidence.push({ id: nextId(state, "evidence", now), label: "Simulated live evidence refresh", detail: "Fixture candidate identity and behavior refreshed by the local simulator. No live deployment was queried." });
        preparePublication(state, c, now);
        actionDetail = "Simulated current-production evidence refresh; no live verification or publication occurred.";
      } else {
        createTask(state, "verify_live", c.id, { deploymentId: c.candidate.deploymentId, headSha: c.candidate.headSha, treeDigest: c.candidate.treeDigest }, now);
        c.blockingReason = "live_reverification_pending";
        actionDetail = "Requested current-production identity and protected behavior checks; publication still requires current exact approval.";
      }
      break;
    }
    case "pause": role(actor, "marketer", "admin"); state.paused = z.boolean().parse(cmd.paused); text(cmd.reason); break;
    case "account_pause": {
      role(actor, "marketer", "admin"); const c = state.connections.find((c) => c.id === cmd.connectionId); if (!c) throw new Error("connection_not_found");
      c.paused = z.boolean().parse(cmd.paused); text(cmd.reason); break;
    }
    case "suppression_add": role(actor, "marketer", "admin"); state.suppressions.push({ id: nextId(state, "suppress", now), platform: z.enum(["x", "reddit"]).parse(cmd.platform), author: text(cmd.author, 100), reason: text(cmd.reason) }); break;
    case "suppression_remove": role(actor, "admin"); text(cmd.reason); state.suppressions = state.suppressions.filter((s) => s.id !== cmd.id); break;
    case "role_mapping": throw new Error("slack_roles_configured_server_side");
    case "connection_configure":
    case "connection_disable":
    case "reconnect": {
      role(actor, "admin"); const c = state.connections.find((c) => c.id === cmd.connectionId); if (!c) throw new Error("connection_not_found");
      c.version++; c.permission = "unverified"; c.status = cmd.action === "connection_disable" ? "disabled" : "reconnect_required"; c.paused = cmd.action === "connection_disable";
      if (cmd.account) c.account = text(cmd.account, 100); c.detail = "Credentials and permissions must be verified before live sending."; break;
    }
    case "review_disposition": role(actor, "engineer", "marketer"); { const c = caseFor(); text(cmd.reason); const d = z.enum(["needs_evidence", "needs_review", "resume"]).parse(cmd.disposition); c.blockingReason = d === "resume" ? undefined : d; break; }
    case "recover": {
      const c = caseFor(); const operation = text(cmd.operation, 40); text(cmd.reason);
      if (operation === "waive_reply") { role(actor, "marketer"); if (c.publications.some((p) => p.status === "unknown" || p.status === "publishing")) throw new Error("reconciliation_required"); c.phase = "COMPLETED"; c.outcome = "resolved_without_reply"; c.communicationStatus = "waived"; }
      else if (operation === "rollback") { role(actor, "engineer", "admin"); c.blockingReason = "rollback_requested"; if (state.mode === "live") { if (!c.previousDeploymentId) throw new Error("previous_deployment_required"); createTask(state, "rollback_deployment", c.id, { reason: cmd.reason, operatorId: actor.id, operatorRole: actor.roles.includes("engineer") ? "engineer" : "admin", operatorAuthorizationRef: nextId(state, "rollback_authority", now), previousDeploymentId: c.previousDeploymentId, requestedAt: now }, now); } else { c.productionVerified = false; c.phase = "INVESTIGATING"; c.evidence.push({ id: nextId(state, "rollback", now), label: "Simulated rollback", detail: "No live deployment was changed." }); } }
      else if (operation === "reconcile") {
        role(actor, "marketer", "admin"); const p = c.publications.find((p) => p.status === "unknown"); if (!p) throw new Error("no_unknown_publication");
        if (cmd.investigationOutcome === undefined) { if (state.mode === "live") createTask(state, "reconcile_publication", c.id, { publicationId: p.id }, now); }
        else {
          const outcome = z.enum(["unknown", "confirmed", "definitely_not_sent"]).parse(cmd.investigationOutcome);
          const attested = cmd.attested === true;
          if (outcome !== "unknown" && !attested) throw new Error("investigation_attestation_required");
          let receiptUrl: string | undefined;
          if (outcome === "confirmed") {
            receiptUrl = text(cmd.receiptUrl, 2000);
            const url = new URL(receiptUrl);
            const allowed = c.sourcePlatform === "x" ? ["x.com", "twitter.com", "www.x.com"] : ["reddit.com", "www.reddit.com"];
            if (url.protocol !== "https:" || !allowed.includes(url.hostname) || url.username || url.password || url.port) throw new Error("invalid_receipt_url");
            p.status = "manually_attested"; p.receiptUrl = url.href; p.attested = true; p.confirmedAt = now;
            finishCommunication(c, p.mode === "fixture" ? "simulated_attested" : "human_attested");
          } else if (outcome === "definitely_not_sent") {
            p.status = "definitely_not_sent"; c.phase = "READY_TO_PUBLISH"; delete c.blockingReason;
          } else { c.blockingReason = "publication_unknown"; }
          p.reconciliationHistory = [...(p.reconciliationHistory ?? []), { at: now, operatorId: actor.id, outcome, reason: text(cmd.reason), attested,
            ...(receiptUrl ? { receiptUrl } : {}), ...(outcome === "definitely_not_sent" ? { residualUncertainty: true } : {}) }];
        }
      }
      else if (operation === "reconcile_release") {
        role(actor, "engineer");
        const previous = state.tasks.findLast(t => t.caseId === c.id && t.kind === "release_candidate" && ["unknown", "failed"].includes(t.status));
        const authority = previous && state.authorities.find(a => a.request.requestId === previous.payload.authorityId && a.request.kind === "candidate_go");
        if (state.mode !== "live" || !previous || !authority || !validateApproval(authority.request, { workspaceId: state.workspaceId, kind: "candidate_go", binding: approvalBinding("candidate_go", bindingPayload(state, authority)) }, now).allowed) throw new Error("current_go_required_for_reconciliation");
        createTask(state, "release_candidate", c.id, { authorityId: authority.request.requestId, reconciliationOf: previous.id, operatorId: actor.id, reason: cmd.reason }, now);
        delete c.blockingReason;
      }
      else if (operation === "retry") {
        role(actor, "engineer", "marketer"); if (c.publications.some((p) => p.status === "unknown")) throw new Error("publication_unknown");
        if (state.tasks.some(t => t.caseId === c.id && ["release_candidate", "rollback_deployment"].includes(t.kind) && t.status === "unknown")) throw new Error("release_reconciliation_required");
        if (c.blockingReason === "checks_failed" || c.phase === "VERIFYING_CANDIDATE") {
          role(actor, "engineer");
          const build = state.authorities.findLast((a) => a.caseId === c.id && a.request.kind === "build");
          if (!build || !validateApproval(build.request, { workspaceId: state.workspaceId, kind: "build", binding: approvalBinding("build", bindingPayload(state, build)) }, now).allowed) throw new Error("fresh_build_approval_required");
          if ((c.buildAttemptNumber ?? 0) >= 3) throw new Error("engineering_attempts_exhausted");
          c.phase = "BUILDING";
          if (state.mode === "live") createTask(state, "build_candidate", c.id, { authorityId: build.request.requestId }, now);
        } else if (state.mode === "live") {
          const task = state.tasks.findLast((t) => t.caseId === c.id && t.status === "failed");
          if (task) {
            if (["release_candidate", "rollback_deployment"].includes(task.kind)) throw new Error("release_reconciliation_required");
            const payload = Object.fromEntries(Object.entries(task.payload).filter(([key]) => !["buildRequest", "modelAttempts", "socialJob", "grantJti"].includes(key)));
            createTask(state, task.kind, c.id, payload, now);
          }
        }
        delete c.blockingReason;
      }
      else throw new Error("unknown_recovery_operation"); break;
    }
    case "demo_fault": {
      role(actor, "admin"); if (state.mode !== "demo") throw new Error("demo_only");
      const c = caseFor(); const fault = z.enum(["publication_unknown", "reconnect_required", "checks_failed"]).parse(cmd.fault);
      if (fault === "publication_unknown") {
        const p = c.publications.find((p) => !["confirmed", "manually_attested"].includes(p.status));
        if (!p || p.mode !== "fixture") throw new Error("fixture_publication_required");
        assertCanPublish(state, c, p, now); p.status = "unknown"; p.attemptedAt = now;
        c.phase = "READY_TO_PUBLISH"; c.communicationStatus = "unknown"; c.blockingReason = fault;
      } else if (fault === "reconnect_required") {
        const connection = state.connections.find((connection) => connection.platform === c.sourcePlatform);
        if (connection) { connection.status = "reconnect_required"; connection.detail = "SIMULATED expired session; reconnect or use tracked manual publication."; }
        c.blockingReason = fault; c.phase = "AWAITING_MANUAL_CONFIRMATION";
      } else {
        if (!c.candidate) throw new Error("candidate_missing");
        c.candidate.checksPassed = false; invalidate(state, c); c.blockingReason = fault; c.phase = "VERIFYING_CANDIDATE";
      }
      break;
    }
    case "manual_receipt": {
      role(actor, "marketer"); const c = caseFor(), p = c.publications.find((p) => p.id === cmd.publicationId); if (!p) throw new Error("draft_missing");
      if (p.status === "unknown" || p.status === "publishing") throw new Error("publication_unknown");
      if (["confirmed", "manually_attested"].includes(p.status)) throw new Error("already_published");
      const url = new URL(text(cmd.receiptUrl, 2000));
      if (p.manualOnly && url.href === supplementalOriginal(state, c, p).receiptUrl) throw new Error("separate_supplemental_receipt_required");
      const hosts = c.sourcePlatform === "x" ? ["x.com", "twitter.com", "www.x.com"] : ["reddit.com", "www.reddit.com"];
      if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password) throw new Error("invalid_receipt_url");
      if (!cmd.attested) throw new Error("receipt_attestation_required"); text(cmd.reason);
      const connection = state.connections.find((x) => x.platform === c.sourcePlatform);
      const saved = connection ? { status: connection.status, permission: connection.permission } : null;
      if (connection) { connection.status = "ready"; connection.permission = "granted"; }
      assertCanPublish(state, c, p, now, { manualSupplemental: p.manualOnly });
      if (connection && saved) Object.assign(connection, saved);
      p.status = "manually_attested"; p.receiptUrl = url.href; p.attested = true; p.confirmedAt = now;
      finishCommunication(c, p.mode === "fixture" ? "simulated_attested" : "human_attested");
      break;
    }
    default: throw new Error("unknown_action");
  }
  if (cmd.caseId) {
    const c = state.cases.find(candidate => candidate.id === cmd.caseId);
    if (c?.canceledAt) { c.phase = "COMPLETED"; if (state.tasks.some(task => task.caseId === c.id && task.status === "unknown") || c.publications.some(p => p.status === "unknown")) c.blockingReason = "cancellation_reconciliation_required"; }
  }
  state.version++;
  audit(state, actor, (state.mode === "demo" ? "demo:" : "") + cmd.action, actionDetail?.slice(0, 500) ?? (typeof cmd.reason === "string" ? cmd.reason.slice(0, 500) : "Action recorded; secret input is never logged."), now);
  return json(state);
}
export function snapshot(state: ControlState, actor: Actor, config: RuntimeConfig): Snapshot {
  const totals = costTotals(state);
  const statuses: [string, string, boolean, string][] = [
    ["openai", "OpenAI", config.openaiConfigured, "App-scoped key present; gpt-5-mini only. Access is verified separately."],
    ["access", "Workspace access", config.accessConfigured, "Local access or a shared code; Slack user IDs govern live approvals."], ["convex", "Convex", config.convexConfigured, "Durable state and workflow execution."],
    ["slack", "Slack", config.slackConfigured, "Signed approvals; no public action without authority."], ["linear", "Linear", config.linearConfigured, "Canonical engineering tickets."],
    ["github", "GitHub", config.githubConfigured, "Scoped runner and protected checks."], ["vercel", "Vercel", config.vercelConfigured, "Staged deployment and live verification."],
    ["worker", "Browser worker", config.workerConfigured, "Isolated X sessions and confirmed receipts."], ["reddit", "Reddit", config.redditConfigured, "Conditional API permission."],
  ];
  return json({
    revision: state.version, mode: state.mode, demoRun: state.mode === "demo" ? state.demoRun : undefined, actor: { id: actor.id, name: actor.name, roles: actor.roles }, workspace: { paused: state.paused, model: state.model, spendUsd: totals.spent, reservedUsd: totals.reserved, infrastructureCommittedUsd: state.infrastructureCommittedUsd, capUsd: 100 },
    readiness: statuses.map(([id, label, ready, detail]) => ({ id, label, status: ready ? "configured" : "missing", detail })),
    cases: state.cases.map((c) => ({ id: c.id, title: c.title, sourcePlatform: c.sourcePlatform, sourceMode: c.sourceMode, sourceUrl: c.sourceUrl, text: c.text, route: c.route, phase: c.phase,
      blockingReason: c.blockingReason, outcome: c.outcome, createdAt: c.createdAt, productionVerified: c.productionVerified, communicationStatus: c.communicationStatus,
      canceledAt: c.canceledAt, canceledBy: c.canceledBy, cancellationReason: c.cancellationReason, repository: c.repository, scope: c.scope, liveVerifiedAt: c.liveVerifiedAt,
      classification: { category: c.classification.category, confidence: c.classification.confidence, riskFlags: c.classification.riskFlags, language: c.classification.language },
      signals: c.signals.map(signal => ({ authorId: signal.authorId, originalUrl: signal.originalUrl, text: signal.text, platform: signal.platform, observedAt: signal.observedAt })),
      evidence: c.evidence, candidate: c.candidate,
      publications: c.publications.map(p => ({ id: p.id, status: p.status, draftText: p.draftText, receiptUrl: p.receiptUrl, attested: p.attested, mode: p.mode, account: p.account, targetUrl: p.targetUrl, version: p.version, manualOnly: p.manualOnly, supplementalToPublicationId: p.supplementalToPublicationId, resolutionCaseId: p.resolutionCaseId })),
      approvals: state.authorities.filter((a) => a.caseId === c.id).map((a) => ({
      id: a.request.requestId, kind: a.request.kind, status: a.request.status, expiresAt: a.request.expiresAt, role: a.request.kind === "build" ? "engineer" : "marketer", slackUrl: a.slackUrl,
      candidateHash: c.candidate?.headSha, replyText: c.publications.map((p) => p.draftText).join("\n"), decisionActor: a.request.decisionActor?.userId, simulated: a.request.decisionActor?.userId.startsWith("simulated-demo-") })),
      drafts: c.publications.map((p) => ({ id: p.id, text: p.draftText, hash: p.textHash, version: p.version ?? 1, status: p.status, personaId: p.personaId })) })),
    personas: state.personas, connections: state.connections.map(c => ({ id: c.id, platform: c.platform, status: c.status, detail: c.detail, account: c.account, lastCheckedAt: c.lastCheckedAt, paused: c.paused })), audit: state.audit, suppressions: state.suppressions,
  });
}
