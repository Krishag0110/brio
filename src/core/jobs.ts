import { z } from "zod";
import { CandidateBindingSchema } from "./approvals";
import { PlatformSchema, RouteSchema } from "./domain";
import { PublishPayloadSchema } from "./publication";

export const AccountScopeSchema = z.object({
  kind: z.literal("account"), connectionId: z.string().min(1), accountId: z.string().min(1),
  connectionVersion: z.number().int().positive(), configVersion: z.number().int().positive(),
}).strict();
export const CaseScopeSchema = z.object({
  kind: z.literal("case"), caseId: z.string().min(1), route: RouteSchema, expectedCaseVersion: z.number().int().positive(),
}).strict();
const base = z.object({
  schemaVersion: z.literal(1), jobId: z.string().min(1), workspaceId: z.string().min(1), attemptId: z.string().min(1),
  inputRevision: z.string().min(1), idempotencyKey: z.string().min(1), createdAt: z.number().finite(), expiresAt: z.number().finite(),
});
const verifyPayload = z.object({ url: z.string().url(), expectedDeploymentId: z.string().min(1), expectedTreeDigest: z.string().min(1), trustedTestRevision: z.string().min(1) }).strict();
export const JobEnvelopeSchema = z.discriminatedUnion("operation", [
  base.extend({ operation: z.literal("ingest_social"), scope: AccountScopeSchema,
    payload: z.object({ platform: PlatformSchema, cursor: z.string().nullable(), limit: z.number().int().min(1).max(20) }).strict() }).strict(),
  base.extend({ operation: z.literal("reproduce"), scope: CaseScopeSchema, payload: verifyPayload }).strict(),
  base.extend({ operation: z.literal("verify_remedy"), scope: CaseScopeSchema, payload: verifyPayload.extend({ remedyId: z.string().min(1), remedyType: z.enum(["fix", "workaround", "instructions"]) }).strict() }).strict(),
  base.extend({ operation: z.literal("build_candidate"), scope: CaseScopeSchema,
    payload: z.object({ repository: z.string().min(1), baseSha: z.string().min(1), buildApprovalRef: z.string().min(1), allowedPaths: z.array(z.string()).min(1), attemptNumber: z.number().int().min(1).max(3), trustedTestRevision: z.string().min(1) }).strict() }).strict(),
  base.extend({ operation: z.literal("verify_candidate"), scope: CaseScopeSchema, payload: verifyPayload }).strict(),
  base.extend({ operation: z.literal("release_candidate"), scope: CaseScopeSchema, payload: z.object({ candidate: CandidateBindingSchema, goApprovalRef: z.string().min(1), releaseLockId: z.string().min(1) }).strict() }).strict(),
  base.extend({ operation: z.literal("verify_live"), scope: CaseScopeSchema, payload: verifyPayload }).strict(),
  base.extend({ operation: z.literal("publish_reply"), scope: CaseScopeSchema,
    payload: PublishPayloadSchema.extend({ connectionId: z.string().min(1), connectionVersion: z.number().int().positive() }).strict() }).strict(),
  base.extend({ operation: z.literal("reconcile_publication"), scope: CaseScopeSchema,
    payload: z.object({ publicationId: z.string().min(1), accountId: z.string().min(1), connectionId: z.string().min(1), connectionVersion: z.number().int().positive(), targetId: z.string().min(1), textHash: z.string().min(1), attemptStartedAt: z.number() }).strict() }).strict(),
  base.extend({ operation: z.literal("rollback_deployment"), scope: CaseScopeSchema,
    payload: z.object({ repository: z.string().min(1), previousDeploymentId: z.string().min(1), operatorAuthorizationRef: z.string().min(1), operatorId: z.string().min(1), operatorRole: z.enum(["engineer", "admin"]) }).strict() }).strict(),
]).superRefine((job, ctx) => {
  if (job.expiresAt <= job.createdAt) ctx.addIssue({ code: "custom", message: "Job expiry must follow creation" });
  if (job.scope.kind === "case" && ["build_candidate", "release_candidate", "rollback_deployment"].includes(job.operation) && job.scope.route !== "engineering_resolution") ctx.addIssue({ code: "custom", message: "Engineering operations require the engineering route" });
});
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;
export const CandidateResultSchema = z.object({
  kind: z.literal("candidate"), headSha: z.string().min(1), treeDigest: z.string().min(1),
  testVersion: z.string().min(1), stagedDeploymentId: z.string().min(1), checksPassed: z.boolean(),
}).strict();
export const PublicationResultSchema = z.object({
  kind: z.literal("publication"), outcome: z.enum(["confirmed", "definitely_not_sent", "unknown"]),
  replyId: z.string().optional(), replyUrl: z.string().url().optional(), mode: z.enum(["live", "fixture"]),
}).strict().superRefine((result, ctx) => {
  if (result.outcome === "confirmed" && (!result.replyId || !result.replyUrl)) ctx.addIssue({ code: "custom", message: "Confirmed publication requires a receipt" });
});
export const JobResultSchema = z.object({
  schemaVersion: z.literal(1), jobId: z.string().min(1), attemptId: z.string().min(1), inputRevision: z.string().min(1),
  status: z.enum(["succeeded", "failed", "unknown"]), evidenceRefs: z.array(z.string()), providerReceipt: z.record(z.string(), z.unknown()).nullable(), completedAt: z.number().finite(),
  result: z.union([CandidateResultSchema, PublicationResultSchema,
    z.object({ kind: z.literal("verification"), passed: z.boolean(), deploymentId: z.string(), treeDigest: z.string(), testVersion: z.string() }).strict(),
    z.object({ kind: z.literal("ingestion"), signalIds: z.array(z.string()), cursor: z.string().nullable() }).strict(),
    z.object({ kind: z.literal("release"), deploymentId: z.string(), mergeSha: z.string().optional(), substage: z.enum(["merged", "promoted", "live_verified"]) }).strict(),
  ]).nullable(),
  error: z.object({ class: z.enum(["transient", "permanent", "invalid_output", "authorization", "effect_unknown"]), code: z.string(), message: z.string(), retryable: z.boolean() }).strict().nullable(),
}).strict().superRefine((result, ctx) => {
  if (result.status === "succeeded" && (!result.result || result.error)) ctx.addIssue({ code: "custom", message: "Successful result requires typed data and no error" });
  if (result.status !== "succeeded" && !result.error) ctx.addIssue({ code: "custom", message: "Failed or unknown results require an error" });
  if (result.status === "unknown" && result.error?.retryable) ctx.addIssue({ code: "custom", message: "Unknown effect is not blindly retryable" });
});
export type JobResult = z.infer<typeof JobResultSchema>;
export const EFFECTFUL_OPERATIONS = new Set<JobEnvelope["operation"]>(["build_candidate", "release_candidate", "publish_reply", "rollback_deployment"]);
export interface PersistedJob {
  envelope: JobEnvelope; activeAttemptId: string; acceptedResultDigest?: string; currentInputRevision: string;
  currentCaseVersion?: number; dispatchedAt?: number; leaseExpiresAt?: number;
}
export function assessJobResult(job: PersistedJob, rawResult: unknown, resultDigest?: string): "accept" | "duplicate" | "invalid" | "stale_ignore" | "stale_reconcile" {
  const parsed = JobResultSchema.safeParse(rawResult);
  if (!parsed.success) return "invalid";
  const r = parsed.data, e = job.envelope;
  if (r.jobId !== e.jobId || r.completedAt < e.createdAt) return "invalid";
  if (job.acceptedResultDigest) return resultDigest === job.acceptedResultDigest ? "duplicate" : EFFECTFUL_OPERATIONS.has(e.operation) ? "stale_reconcile" : "stale_ignore";
  if (r.attemptId !== job.activeAttemptId || r.attemptId !== e.attemptId || r.inputRevision !== e.inputRevision || r.inputRevision !== job.currentInputRevision ||
    (e.scope.kind === "case" && job.currentCaseVersion !== undefined && e.scope.expectedCaseVersion !== job.currentCaseVersion)) return EFFECTFUL_OPERATIONS.has(e.operation) ? "stale_reconcile" : "stale_ignore";
  if (r.status === "succeeded") {
    const kind = r.result?.kind;
    if ((e.operation === "publish_reply" || e.operation === "reconcile_publication") && kind !== "publication") return "invalid";
    if (e.operation === "build_candidate" && kind !== "candidate") return "invalid";
    if (e.operation === "ingest_social" && kind !== "ingestion") return "invalid";
    if (["reproduce", "verify_remedy", "verify_candidate", "verify_live"].includes(e.operation) && kind !== "verification") return "invalid";
    if (["release_candidate", "rollback_deployment"].includes(e.operation) && kind !== "release") return "invalid";
    if (e.operation === "build_candidate" && r.result?.kind === "candidate" && r.result.testVersion !== e.payload.trustedTestRevision) return "invalid";
    if (["reproduce", "verify_remedy", "verify_candidate", "verify_live"].includes(e.operation) && r.result?.kind === "verification" && "expectedDeploymentId" in e.payload &&
      (r.result.deploymentId !== e.payload.expectedDeploymentId || r.result.treeDigest !== e.payload.expectedTreeDigest || r.result.testVersion !== e.payload.trustedTestRevision)) return "invalid";
    if (e.operation === "release_candidate" && r.result?.kind === "release" && r.result.deploymentId !== e.payload.candidate.deploymentId) return "invalid";
    if (e.operation === "rollback_deployment" && r.result?.kind === "release" && r.result.deploymentId !== e.payload.previousDeploymentId) return "invalid";
  }
  return "accept";
}
export function expiredLeaseAction(job: PersistedJob, now: number): "wait" | "retry_read_only" | "reconcile_effect" {
  if (job.leaseExpiresAt === undefined || job.leaseExpiresAt > now) return "wait";
  return EFFECTFUL_OPERATIONS.has(job.envelope.operation) && job.dispatchedAt !== undefined ? "reconcile_effect" : "retry_read_only";
}
export function navigationAllowed(rawUrl: string, approvedHosts: string[]): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !approvedHosts.includes(url.hostname)) return false;
    return !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(url.hostname);
  } catch { return false; }
}
