import { z } from "zod";
import { canGroupReports, ClassificationSchema, isOptOut, parseSocialTarget, routeForClassification } from "../core/signals";
import { hashText, canonicalJson } from "../core/domain";
import { hasSupportClaim, universalDraftReasons } from "../core/persona";
import { PERSONA_EVALUATION_CASES, PERSONA_EVALUATION_VERSION } from "../core/persona-evaluation-cases";
import { addDraft, audit, createTask, finishCommunication, nextId, preparePublication, requestAuthority } from "./reducer";
import type { ControlState, InternalCase, Task } from "./types";
const resultSchema = z.object({ status: z.enum(["succeeded", "failed", "unknown", "dispatched"]), output: z.unknown().optional(), error: z.string().max(200).optional() }).strict();
export const ProtectedEvidenceSchema = z.object({
  suiteVersion: z.literal("weather-protected-v1"), runId: z.string().min(1), url: z.string().url(), mode: z.enum(["live", "fixture"]), timestamp: z.number().finite(),
  provenance: z.object({ schemaVersion: z.literal(1), runId: z.string().min(1), candidateId: z.string().min(1), headSha: z.string().min(1), treeDigest: z.string().min(1), trustedTestRevision: z.string().min(1), buildConfigRevision: z.string().min(1), mode: z.enum(["live", "fixture"]) }),
  identityPassed: z.boolean(), identityAssurance: z.enum(["expected_matches", "observed_only"]).optional(),
  checks: z.array(z.object({ name: z.string(), expected: z.string(), actual: z.string(), passed: z.boolean() })).min(1),
  screenshots: z.array(z.string()), status: z.enum(["passed", "failed"]), seededDefectReproduced: z.boolean(),
});
const expectedChecks: [string, string][] = [["default Celsius", "20°C"], ["reload/default unit", "20°C"]];
for (const [fixture, celsius, fahrenheit] of [["pleasant", 20, 68], ["freezing", 0, 32], ["extreme-cold", -40, -40], ["boiling", 100, 212]] as const) {
  expectedChecks.push([`${fixture} Celsius`, `${celsius}°C`], [`${fixture} Fahrenheit`, `${fahrenheit}°F`]);
  for (let repeat = 1; repeat <= 3; repeat++) expectedChecks.push([`${fixture} repeat ${repeat} Celsius`, `${celsius}°C`], [`${fixture} repeat ${repeat} Fahrenheit`, `${fahrenheit}°F`]);
}
export function verifiedWeatherEvidence(state: ControlState, c: InternalCase, raw: unknown, now: number, purpose: "baseline" | "fix" | "workaround" | "instructions") {
  const parsed = ProtectedEvidenceSchema.parse(raw), provenance = parsed.provenance;
  if (!parsed.identityPassed || parsed.identityAssurance === "observed_only" || parsed.mode !== provenance.mode || (state.mode === "live" && parsed.mode !== "live")) throw new Error("protected_identity_required");
  if (parsed.timestamp > now || now - parsed.timestamp > 300_000) throw new Error("protected_evidence_stale");
  if (purpose === "baseline") {
    if (provenance.headSha !== c.baseSha) throw new Error("baseline_revision_mismatch");
    const observed = parsed.checks.find(check => check.name === "pleasant Fahrenheit");
    if (!parsed.seededDefectReproduced || !observed || observed.expected !== "68°F" || observed.actual !== "20°F" || observed.passed) throw new Error("defect_not_reproduced");
  } else {
    if (!c.candidate || provenance.headSha !== c.candidate.headSha || provenance.treeDigest !== c.candidate.treeDigest || provenance.trustedTestRevision !== c.testRevision || provenance.buildConfigRevision !== c.buildConfigRevision) throw new Error("candidate_provenance_mismatch");
    const required = purpose === "fix" ? expectedChecks : expectedChecks.filter(([name]) => name.includes("Celsius") || name === "reload/default unit");
    if ((purpose === "fix" && parsed.status !== "passed") || required.some(([name, expected]) => !parsed.checks.some(check => check.name === name && check.expected === expected && check.actual === expected && check.passed))) throw new Error("protected_checks_failed");
  }
  return parsed;
}
const obj = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
function storedReceipt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(storedReceipt);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(artifacts|base64|storageState|cookies|encryptedSession|ciphertext|accessToken|refreshToken|clientSecret|password)$/i.test(key)).map(([key, child]) => [key, storedReceipt(child)]));
}
const evaluationItemSchema = z.object({ id: z.string(), group: z.enum(["eligible", "hard_exclusion", "ambiguous", "factual"]), accepted: z.boolean(), text: z.string().max(240), reason: z.string().max(240), generationRef: z.string().min(1), validationRef: z.string().min(1) }).strict();
const actor = { id: "controller", name: "Durable controller", roles: [] };
function evidence(state: ControlState, c: InternalCase, label: string, value: unknown, now: number, url?: string) { c.evidence.push({ id: nextId(state, "evidence", now), label, detail: JSON.stringify(value).slice(0, 5000), ...(url ? { url } : {}) }); }
export function applyTaskResult(state: ControlState, task: Task, raw: unknown, now: number): void {
  // Mirror a mutation transaction: malformed callbacks cannot partially advance the supplied state.
  const working = structuredClone(state), current = working.tasks.find(item => item.id === task.id) ?? structuredClone(task);
  applyResult(working, current, raw, now);
  Object.assign(state, working); Object.assign(task, current);
}
function applyResult(state: ControlState, task: Task, raw: unknown, now: number): void {
  const result = resultSchema.parse(raw); const c = state.cases.find(c => c.id === task.caseId);
  if (["publish_reply", "reconcile_publication"].includes(task.kind) && c?.publications.find(p => p.id === task.payload.publicationId)?.manualOnly) throw new Error("supplemental_manual_only");
  const digest = hashText(canonicalJson(JSON.parse(JSON.stringify(result))));
  const possibleEffect = ["publish_reply", "reconcile_publication", "build_candidate", "stage_candidate", "release_candidate", "rollback_deployment", "linear_create"].includes(task.kind);
  if (task.resultDigest === digest) return;
  if (c?.canceledAt) {
    task.lateResults = [...(task.lateResults ?? []), { receivedAt: now, digest, status: result.status, sideEffectPossible: possibleEffect }];
    task.resultDigest = digest; task.receipt = { lateCanceledResult: storedReceipt(result), requiresInvestigation: possibleEffect };
    if (possibleEffect) c.blockingReason = "cancellation_reconciliation_required";
    audit(state, actor, "canceled_task_result", possibleEffect ? "Retained late external result for investigation; canceled case remains stopped." : "Ignored late read result for canceled case.", now); return;
  }
  const stale = Boolean(c && task.inputRevision !== c.version && task.kind !== "linear_update");
  if (task.status === "completed" || stale) {
    task.lateResults = [...(task.lateResults ?? []), { receivedAt: now, digest, status: result.status, sideEffectPossible: possibleEffect }];
    if (c && possibleEffect) {
      const p = c.publications.find(p => p.id === task.payload.publicationId);
      if (p && !["confirmed", "manually_attested"].includes(p.status)) p.status = "unknown";
      c.blockingReason = "stale_external_result_reconcile";
    }
    audit(state, actor, "late_task_result", possibleEffect ? "Retained stale external result for reconciliation." : "Ignored stale read-only result.", now); return;
  }
  if (result.status === "dispatched") { task.status = "running"; task.receipt = storedReceipt(result.output); return; }
  if (["publish_reply", "reconcile_publication"].includes(task.kind) && result.status === "failed" && z.object({ status: z.literal("definitely_not_sent") }).safeParse(result.output).success) result.status = "succeeded";
  task.status = result.status === "succeeded" ? "completed" : result.status; task.completedAt = now; task.resultDigest = digest;
  if (result.status !== "succeeded") {
    task.error = result.error && /^[a-z][a-z0-9_:]{0,150}$/i.test(result.error) ? result.error : "execution_failed";
    if (c) {
      c.blockingReason = task.error;
      if (["verify_live", "verify_remedy"].includes(task.kind)) {
        c.productionVerified = false; delete c.liveVerifiedAt; delete c.productionIdentityCheckedAt;
        for (const issue of state.solvedIssues) if (!issue.fictional && issue.affectedRevision === c.candidate?.headSha) issue.valid = false;
      }
      if (task.kind === "verify_candidate" || (task.kind === "build_candidate" && task.error === "checks_failed")) { c.phase = "VERIFYING_CANDIDATE"; c.blockingReason = "checks_failed"; if (c.candidate) c.candidate.checksPassed = false; }
      if (task.kind === "publish_reply" || task.kind === "reconcile_publication") {
        const p = c.publications.find(p => p.id === task.payload.publicationId);
        if (p && !["confirmed", "manually_attested"].includes(p.status)) { p.status = "unknown"; task.status = "unknown"; c.communicationStatus = p.status; c.blockingReason = "publication_unknown"; }
      }
    }
    audit(state, actor, "task:" + task.kind, task.error, now); return;
  }
  const out = obj(result.output ?? {}); task.receipt = storedReceipt(out);
  if (task.kind === "evaluate_persona") {
    const p = state.personas.find(p => p.id === task.payload.personaId);
    if (!p || p.version !== task.payload.version) throw new Error("stale_persona_evaluation");
    if (out.partial === true) {
      const offset = z.number().int().min(0).max(40).parse(task.payload.offset ?? 0);
      const nextOffset = z.number().int().parse(out.nextOffset);
      const results = z.array(evaluationItemSchema).parse(out.results);
      const prior = z.array(evaluationItemSchema).parse(task.payload.results ?? []);
      if (offset % 10 || out.model !== "gpt-5-mini" || out.evaluationVersion !== PERSONA_EVALUATION_VERSION || nextOffset !== offset + 10 || nextOffset >= 60 || results.length !== nextOffset || prior.length !== offset || canonicalJson(results.slice(0, offset)) !== canonicalJson(prior) || results.some((item, index) => item.id !== PERSONA_EVALUATION_CASES[index].id || item.group !== PERSONA_EVALUATION_CASES[index].group)) throw new Error("partial_evaluation_binding_mismatch");
      createTask(state, "evaluate_persona", undefined, { personaId: p.id, version: p.version, offset: nextOffset, results }, now); return;
    }
    if (out.passed !== true || typeof out.evaluationRef !== "string" || out.model !== "gpt-5-mini" || out.totalCases !== 60 || typeof out.eligibleAccepted !== "number" || out.eligibleAccepted < 18 || out.eligibleAccepted > 20 || out.hardExclusionAccepted !== 0 || out.evaluationVersion !== PERSONA_EVALUATION_VERSION) { p.status = "draft"; throw new Error("persona_evaluation_failed"); }
    const examples = z.array(evaluationItemSchema).length(60).parse(out.examples), prior = z.array(evaluationItemSchema).length(50).parse(task.payload.results);
    if (task.payload.offset !== 50 || out.policyHash !== p.hash || out.evaluationRef !== hashText(canonicalJson(examples)) || canonicalJson(examples.slice(0, 50)) !== canonicalJson(prior) || examples.some((item, index) => item.id !== PERSONA_EVALUATION_CASES[index].id || item.group !== PERSONA_EVALUATION_CASES[index].group) || examples.filter(item => item.group === "eligible" && item.accepted).length !== out.eligibleAccepted || examples.some(item => item.group !== "eligible" && item.accepted)) throw new Error("final_evaluation_binding_mismatch");
    requestAuthority(state, "persona_policy", undefined, p.id, now); return;
  }
  if (task.kind === "slack_approval") {
    const a = state.authorities.find(a => a.request.requestId === task.payload.authorityId);
    if (a && typeof out.url === "string") { a.slackUrl = out.url; const p = state.personas.find(p => p.id === a.personaId); if (p) p.slackUrl = out.url; }
    return;
  }
  if (task.kind === "slack_reminder") return;
  if (!c) throw new Error("case_not_found");
  switch (task.kind) {
    case "triage": {
      c.classification = ClassificationSchema.parse(out.classification);
      c.route = routeForClassification(c.classification) ?? "social_engagement"; c.phase = "INVESTIGATING";
      if (isOptOut(c.text) || c.classification.riskFlags.includes("opt_out")) {
        for (const signal of c.signals) if (!state.suppressions.some(entry => entry.platform === signal.platform && entry.author === signal.authorId)) state.suppressions.push({ id: nextId(state, "optout", now), platform: signal.platform, author: signal.authorId, reason: "Customer opt-out" });
        c.phase = "COMPLETED"; c.outcome = "ignored"; break;
      }
      if (c.classification.category === "irrelevant_harmful_spam") { c.phase = "COMPLETED"; c.outcome = "ignored"; break; }
      if (!routeForClassification(c.classification)) { c.blockingReason = "needs_review"; break; }
      if (c.route === "social_engagement" && (c.classification.confidence < 0.9 || c.classification.riskFlags.length)) { c.blockingReason = "needs_review"; break; }
      if (c.route === "social_engagement") createTask(state, "draft_reply", c.id, { purpose: "engagement" }, now);
      else if (["engineering_resolution", "known_remedy"].includes(c.route)) {
        const prior = state.cases.find(other => other.id !== c.id && other.productionVerified && other.candidate && other.signals.some(old => c.signals.some(current => canGroupReports({ ...old, deployedRevision: current.deployedRevision }, current))) && state.solvedIssues.some(issue => issue.id === "solved-" + other.id && issue.valid && !issue.fictional));
        if (prior?.candidate) {
          c.route = "known_remedy"; c.candidate = structuredClone(prior.candidate); c.testRevision = prior.testRevision; c.buildConfigRevision = prior.buildConfigRevision;
          createTask(state, "verify_remedy", c.id, { remedyId: "solved-" + prior.id }, now);
        } else createTask(state, "reproduce", c.id, {}, now);
      }
      else c.blockingReason = "needs_review";
      break;
    }
    case "reproduce": {
      if (out.seededDefectReproduced === true) {
        const verified = verifiedWeatherEvidence(state, c, out, now, "baseline"); evidence(state, c, "Protected reproduction", verified, now);
        c.route = "engineering_resolution"; createTask(state, "linear_create", c.id, {}, now);
      } else if (out.status === "passed" && c.candidate) {
        const verified = verifiedWeatherEvidence(state, c, out, now, "fix"); evidence(state, c, "Verified current remedy", verified, now);
        c.route = "known_remedy"; c.productionVerified = true; c.liveVerifiedAt = verified.timestamp;
        c.productionIdentityCheckedAt = verified.timestamp; c.productionDeploymentId = c.candidate.deploymentId; c.productionTreeDigest = c.candidate.treeDigest;
        createTask(state, "draft_reply", c.id, { purpose: "known_fix" }, now);
      } else { c.blockingReason = "needs_evidence"; }
      break;
    }
    case "verify_remedy": {
      const remedy = state.solvedIssues.find(issue => issue.id === task.payload.remedyId);
      if (!remedy || !c.candidate || (remedy.affectedRevision !== c.baseSha && remedy.affectedRevision !== c.candidate.headSha)) throw new Error("remedy_version_mismatch");
      const verified = verifiedWeatherEvidence(state, c, out, now, remedy.remedyType === "fix" ? "fix" : remedy.remedyType);
      evidence(state, c, "Verified current remedy", verified, now); c.route = "known_remedy";
      c.liveVerifiedAt = verified.timestamp; c.productionIdentityCheckedAt = verified.timestamp; c.productionDeploymentId = c.candidate.deploymentId; c.productionTreeDigest = c.candidate.treeDigest;
      c.productionVerified = true;
      createTask(state, "draft_reply", c.id, { purpose: remedy.remedyType === "fix" ? "known_fix" : remedy.remedyType, remedyId: remedy.id }, now); break;
    }
    case "linear_create": {
      c.linearId = z.string().parse(out.id); const url = z.string().url().parse(out.url);
      evidence(state, c, "Linear engineering issue", { identifier: out.identifier }, now, url);
      requestAuthority(state, "build", c.id, undefined, now); break;
    }
    case "build_candidate": {
      if (out.status !== "pr_created") { c.phase = "VERIFYING_CANDIDATE"; c.blockingReason = "candidate_pr_required"; break; }
      c.phase = "VERIFYING_CANDIDATE";
      createTask(state, "stage_candidate", c.id, { headSha: z.string().regex(/^[a-f0-9]{40}$/).parse(out.headSha), treeDigest: z.string().regex(/^[a-f0-9]{40}$/).parse(out.treeDigest), pullNumber: z.number().int().positive().parse(out.pullNumber), pullUrl: z.string().url().parse(out.pullUrl) }, now); break;
    }
    case "stage_candidate": {
      const v = z.object({ headSha: z.string(), treeDigest: z.string(), deploymentId: z.string().startsWith("dpl_"), deploymentUrl: z.string().url(), pullNumber: z.number(), testRevision: z.string(), buildConfigRevision: z.string() }).parse(out);
      if (v.headSha !== task.payload.headSha || v.treeDigest !== task.payload.treeDigest || v.pullNumber !== task.payload.pullNumber) throw new Error("staged_candidate_binding_mismatch");
      c.candidate = { headSha: v.headSha, treeDigest: v.treeDigest, deploymentId: v.deploymentId, checksPassed: false, productionUrl: v.deploymentUrl };
      c.testRevision = v.testRevision; c.buildConfigRevision = v.buildConfigRevision;
      createTask(state, "verify_candidate", c.id, v, now); break;
    }
    case "verify_candidate": {
      if (!c.candidate) throw new Error("candidate_missing");
      const verified = verifiedWeatherEvidence(state, c, out, now, "fix");
      c.candidate.checksPassed = true; evidence(state, c, "Candidate verified", verified, now, c.candidate.productionUrl);
      createTask(state, "draft_reply", c.id, { purpose: "resolution" }, now); break;
    }
    case "draft_reply": {
      const p = state.personas.find(p => p.id === out.personaId && p.version === out.personaVersion);
      if (!p) throw new Error("stale_persona");
      const text = z.string().min(1).max(p.maxLength).parse(out.text);
      if (out.validated !== true || out.model !== "gpt-5-mini" || out.validationTextHash !== hashText(text) || typeof out.promptVersion !== "string" || !out.promptVersion || typeof out.validatorVersion !== "string" || !out.validatorVersion || universalDraftReasons(text).length) throw new Error("independent_validation_failed");
      const purpose = z.enum(["engagement", "resolution", "known_fix", "workaround", "instructions"]).parse(task.payload.purpose);
      if (purpose === "engagement" && (hasSupportClaim(text) || c.classification.category !== "low_risk_engagement" || c.classification.confidence < 0.9 || c.classification.riskFlags.length)) throw new Error("engagement_claim_or_classification_rejected");
      c.draftedByModel = true; c.validatedByModel = true;
      for (const signal of c.signals) {
        if (c.publications.some(pub => pub.sourceKey === signal.sourceKey && !["draft", "definitely_not_sent"].includes(pub.status))) continue;
        const pub = addDraft(state, c, text, p, now, purpose, signal);
        if (purpose === "engagement") {
          const a = state.authorities.findLast(a => a.personaId === p.id && a.request.status === "approved");
          if (a && p.status === "active" && p.autonomyEnabled) { pub.authorityId = a.request.requestId; pub.authorityKind = "persona_policy"; }
          else requestAuthority(state, "reply_approval", c.id, undefined, now, pub.id);
        } else if (purpose !== "resolution") requestAuthority(state, "reply_approval", c.id, undefined, now, pub.id);
      }
      if (purpose === "resolution") requestAuthority(state, "candidate_go", c.id, undefined, now);
      else if (purpose === "engagement") preparePublication(state, c, now);
      break;
    }
    case "release_candidate": {
      if (out.stage !== "live_verified" || !c.candidate || out.deploymentId !== c.candidate.deploymentId || out.treeDigest !== c.candidate.treeDigest) throw new Error("live_verification_required");
      const verified = verifiedWeatherEvidence(state, c, out.verification, now, "fix");
      const identityAt = z.number().finite().parse(out.productionIdentityCheckedAt);
      if (identityAt > now || now - identityAt > 10_000) throw new Error("immediate_production_identity_required");
      c.productionVerified = true; c.liveVerifiedAt = verified.timestamp; c.productionIdentityCheckedAt = identityAt;
      c.productionDeploymentId = c.candidate.deploymentId; c.productionTreeDigest = c.candidate.treeDigest;
      c.previousDeploymentId = typeof out.previousDeploymentId === "string" ? out.previousDeploymentId : undefined;
      c.releaseSubstage = "live_verified"; if (typeof out.mergeSha === "string") c.mergeSha = out.mergeSha;
      evidence(state, c, "Live production verified", { verification: verified, deploymentId: out.deploymentId, treeDigest: out.treeDigest, productionIdentityCheckedAt: identityAt }, now, typeof out.productionUrl === "string" ? out.productionUrl : undefined);
      const solved = { id: "solved-" + c.id, fictional: false, symptomSignature: c.signals[0].symptomSignature ?? c.title, component: c.signals[0].component ?? "temperature-display", affectedRevision: c.candidate.headSha, remedy: "Correct Celsius to Fahrenheit conversion verified on production.", remedyType: "fix" as const, verificationNotes: hashText(canonicalJson(verified)), valid: true };
      state.solvedIssues = [...state.solvedIssues.filter(issue => issue.id !== solved.id), solved];
      preparePublication(state, c, now); createTask(state, "linear_update", c.id, { state: "released" }, now); break;
    }
    case "verify_live": {
      if (!c.candidate || out.deploymentId !== c.candidate.deploymentId) throw new Error("live_deployment_mismatch");
      const verified = verifiedWeatherEvidence(state, c, out.verification ?? out, now, "fix");
      const identityAt = z.number().finite().parse(out.productionIdentityCheckedAt);
      if (identityAt > now || now - identityAt > 10_000) throw new Error("immediate_production_identity_required");
      c.productionVerified = true; c.liveVerifiedAt = verified.timestamp; c.productionIdentityCheckedAt = identityAt; c.productionDeploymentId = c.candidate.deploymentId; c.productionTreeDigest = c.candidate.treeDigest;
      evidence(state, c, "Live production reverified", { verification: verified, deploymentId: c.candidate.deploymentId }, now);
      if (task.payload.requestReplyApproval === true) {
        const drafts = c.publications.filter(p => !["confirmed", "manually_attested", "unknown", "publishing"].includes(p.status) && (!task.payload.publicationId || p.id === task.payload.publicationId));
        for (const draft of drafts) requestAuthority(state, "reply_approval", c.id, undefined, now, draft.id);
      } else preparePublication(state, c, now);
      break;
    }
    case "publish_reply":
    case "reconcile_publication": {
      const p = c.publications.find(p => p.id === task.payload.publicationId); if (!p) throw new Error("publication_not_found");
      if (p.manualOnly) throw new Error("supplemental_manual_only");
      if (out.mode !== p.mode || !["confirmed", "definitely_not_sent", "unknown"].includes(String(out.status))) throw new Error("publication_outcome_invalid");
      if (out.status === "confirmed") {
        const receipt = obj(out.providerReceipt);
        if (out.mode !== p.mode || typeof receipt.id !== "string" || !receipt.id || receipt.accountId !== p.account || receipt.targetId !== p.targetId || receipt.textHash !== p.textHash) throw new Error("receipt_binding_mismatch");
        const url = new URL(z.string().url().parse(receipt.url));
        if (out.mode === "live" && !parseSocialTarget(c.sourcePlatform as "x" | "reddit", url.href)) throw new Error("receipt_url_invalid");
        const completedAt = z.number().finite().parse(out.completedAt); if (completedAt > now || completedAt < task.createdAt) throw new Error("receipt_timestamp_invalid");
        p.status = "confirmed"; p.confirmedAt = completedAt; p.receiptUrl = url.href;
        finishCommunication(c, p.mode === "fixture" ? "simulated_confirmed" : "confirmed"); if (c.phase !== "COMPLETED") preparePublication(state, c, now);
      } else {
        if (["confirmed", "manually_attested"].includes(p.status)) break;
        if (out.status === "definitely_not_sent" && task.kind === "publish_reply" && p.status === "unknown") throw new Error("explicit_reconciliation_required");
        p.status = out.status === "definitely_not_sent" ? "definitely_not_sent" : "unknown";
        c.blockingReason = p.status === "unknown" ? "publication_unknown" : String(out.reason ?? "publication_failed");
        c.communicationStatus = p.status; c.phase = "AWAITING_MANUAL_CONFIRMATION";
      }
      break;
    }
    case "rollback_deployment": {
      if (!task.payload.previousDeploymentId || out.deploymentId !== task.payload.previousDeploymentId || out.operatorAuthorizationRef !== task.payload.operatorAuthorizationRef || out.operatorId !== task.payload.operatorId || out.operatorRole !== task.payload.operatorRole || !["engineer", "admin"].includes(String(out.operatorRole))) throw new Error("rollback_receipt_required");
      const verified = ProtectedEvidenceSchema.parse(out.verification);
      const identityAt = z.number().finite().parse(out.productionIdentityCheckedAt);
      if (!verified.identityPassed || verified.identityAssurance === "observed_only" || identityAt > now || now - identityAt > 10_000 || (state.mode === "live" && verified.mode !== "live")) throw new Error("rollback_identity_required");
      c.productionVerified = false; delete c.liveVerifiedAt; delete c.productionIdentityCheckedAt; c.blockingReason = "rolled_back_review_required";
      for (const issue of state.solvedIssues) if (issue.id === "solved-" + c.id) issue.valid = false;
      evidence(state, c, "Rollback receipt", { deploymentId: out.deploymentId, verification: verified, operatorId: out.operatorId, operatorAuthorizationRef: out.operatorAuthorizationRef }, now); break;
    }
    case "linear_update": break;
    default: throw new Error("unsupported_task_kind");
  }
  audit(state, actor, "task:" + task.kind, "Validated result applied to the current attempt.", now);
}
