import { v } from "convex/values";

const role = v.union(v.literal("engineer"), v.literal("marketer"), v.literal("admin"));
const optionalString = () => v.optional(v.string());
const optionalNumber = () => v.optional(v.number());
const optionalBoolean = () => v.optional(v.boolean());
const strings = () => v.array(v.string());

/** The public projection is explicit: controller tasks, grants, bindings, and session metadata stay private. */
export const snapshotValidator = v.object({
  revision: v.number(), mode: v.union(v.literal("demo"), v.literal("live")),
  actor: v.object({ id: v.string(), name: v.string(), roles: v.array(role) }),
  workspace: v.object({ paused: v.boolean(), model: v.string(), spendUsd: v.number(), reservedUsd: v.number(), infrastructureCommittedUsd: optionalNumber(), capUsd: v.number() }),
  demoRun: v.optional(v.object({
    runId: v.string(), caseId: v.string(), status: v.union(v.literal("running"), v.literal("paused"), v.literal("completed")),
    stepIndex: v.number(), totalSteps: v.number(), stepLabel: v.string(), nextAt: v.union(v.number(), v.null()),
    startedAt: v.number(), updatedAt: v.number(), completedAt: optionalNumber(), stopReason: optionalString(),
    events: v.array(v.object({ id: v.string(), at: v.number(), title: v.string(), detail: v.string(), phase: v.string() })),
  })),
  readiness: v.array(v.object({ id: v.string(), label: v.string(), status: v.string(), detail: v.string() })),
  cases: v.array(v.object({
    id: v.string(), title: v.string(), sourcePlatform: v.string(), sourceMode: v.union(v.literal("live"), v.literal("manual"), v.literal("fixture")),
    sourceUrl: optionalString(), text: v.string(), route: v.string(), phase: v.string(), blockingReason: optionalString(), outcome: optionalString(), createdAt: v.string(),
    productionVerified: v.boolean(), communicationStatus: v.string(), canceledAt: optionalNumber(), canceledBy: optionalString(), cancellationReason: optionalString(),
    repository: optionalString(), scope: v.optional(strings()), liveVerifiedAt: optionalNumber(),
    classification: v.optional(v.object({ category: v.string(), confidence: v.number(), riskFlags: strings(), language: v.string() })),
    signals: v.optional(v.array(v.object({ authorId: v.string(), originalUrl: v.string(), text: v.string(), platform: v.string(), observedAt: v.number() }))),
    evidence: v.array(v.object({ id: v.string(), label: v.string(), detail: v.string(), url: optionalString() })),
    candidate: v.optional(v.object({ headSha: v.string(), treeDigest: v.string(), deploymentId: v.string(), productionUrl: optionalString(), checksPassed: v.boolean() })),
    approvals: v.array(v.object({ id: v.string(), kind: v.string(), status: v.string(), expiresAt: optionalNumber(), expired: optionalBoolean(), role: v.string(), slackUrl: optionalString(), candidateHash: optionalString(), replyText: optionalString(), decisionActor: optionalString(), simulated: optionalBoolean() })),
    publications: v.array(v.object({ id: v.string(), status: v.string(), draftText: v.string(), receiptUrl: optionalString(), attested: optionalBoolean(), mode: v.string(), account: optionalString(), targetUrl: optionalString(), version: optionalNumber(), manualOnly: optionalBoolean(), supplementalToPublicationId: optionalString(), resolutionCaseId: optionalString() })),
    drafts: v.optional(v.array(v.object({ id: v.string(), text: v.string(), hash: v.string(), version: v.number(), status: v.string(), personaId: optionalString() }))),
  })),
  personas: v.array(v.object({
    id: v.string(), name: v.string(), version: v.number(), status: v.string(), objective: v.string(), brandDescription: v.string(), audience: v.string(),
    formality: v.number(), warmth: v.number(), directness: v.number(), slang: v.number(), humorLevel: v.number(), roastLevel: v.number(), maxLength: v.number(), maxEmoji: v.number(),
    allowedCategories: strings(), doNotEngage: strings(), bannedPhrases: strings(), hourlyCap: v.number(), dailyCap: v.number(), authorCooldownHours: v.number(),
    expiresAt: optionalString(), platforms: strings(), autonomyEnabled: v.boolean(), hash: optionalString(), approvedVocabulary: v.optional(strings()), examples: v.optional(strings()), counterexamples: v.optional(strings()), approvalId: optionalString(), slackUrl: optionalString(),
  })),
  connections: v.array(v.object({ id: v.string(), platform: v.string(), status: v.string(), detail: v.string(), account: optionalString(), lastCheckedAt: optionalString(), paused: optionalBoolean() })),
  audit: v.array(v.object({ id: v.string(), at: v.string(), actor: v.string(), role: v.string(), action: v.string(), detail: v.string() })),
  suppressions: v.optional(v.array(v.object({ id: v.string(), platform: v.string(), author: v.string(), reason: v.string() }))),
});
