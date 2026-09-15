import { z } from "zod";
import { canonicalJson, DAY, decision, type Decision, HOUR, MembershipSchema, type Membership, requireRole, type Role } from "./domain";

export const ApprovalKindSchema = z.enum(["build", "candidate_go", "reply_approval", "persona_policy"]);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;
export const ReplyBindingSchema = z.object({
  draftId: z.string().min(1), textHash: z.string().min(1), personaVersion: z.string().min(1),
  platform: z.enum(["x", "reddit"]), accountId: z.string().min(1), targetId: z.string().min(1),
  contextHash: z.string().min(1), purpose: z.enum(["resolution", "known_fix", "workaround", "instructions", "engagement"]),
}).strict();
export const BuildBindingSchema = z.object({
  repository: z.string().min(1), baseSha: z.string().min(1), planVersion: z.string().min(1),
  allowedPaths: z.array(z.string().min(1)).min(1), acceptanceCriteria: z.array(z.string().min(1)).min(1),
  risk: z.string().min(1), maxAttempts: z.number().int().min(1).max(3), maxCostUsd: z.number().positive().max(1),
}).strict();
export const CandidateBindingSchema = z.object({
  repository: z.string().min(1), baseSha: z.string().min(1), headSha: z.string().min(1), treeDigest: z.string().min(1),
  deploymentId: z.string().min(1), testRevision: z.string().min(1), buildConfigRevision: z.string().min(1),
  checkEvidenceDigest: z.string().min(1), targetEnvironment: z.literal("production"),
  replies: z.array(ReplyBindingSchema).min(1),
}).strict();
export const ReplyApprovalBindingSchema = ReplyBindingSchema.extend({
  evidenceContext: z.string().nullable(), deploymentId: z.string().nullable(),
}).strict();
export const PolicyActivationBindingSchema = z.object({
  policyId: z.string().min(1), version: z.string().min(1), configurationHash: z.string().min(1),
  previewCount: z.number().int().min(8), evaluationVersion: z.string().min(1), evaluationPassed: z.literal(true),
}).strict();
export type CandidateBinding = z.infer<typeof CandidateBindingSchema>;
export type ReplyBinding = z.infer<typeof ReplyBindingSchema>;

export function approvalBinding(kind: ApprovalKind, payload: unknown): string {
  const schema = { build: BuildBindingSchema, candidate_go: CandidateBindingSchema, reply_approval: ReplyApprovalBindingSchema, persona_policy: PolicyActivationBindingSchema }[kind];
  return canonicalJson({ kind, payload: schema.parse(payload) });
}
export function approvalLifetime(kind: ApprovalKind): number { return kind === "build" ? DAY : kind === "persona_policy" ? 7 * DAY : HOUR; }
export function approvalRequestLifetime(kind: ApprovalKind): number { return kind === "build" ? DAY : HOUR; }
export function approvalRole(kind: ApprovalKind): Role { return kind === "build" ? "engineer" : "marketer"; }
export const ApprovalRequestSchema = z.object({
  requestId: z.string().min(1), workspaceId: z.string().min(1), kind: ApprovalKindSchema,
  version: z.number().int().positive(), binding: z.string().min(1), createdAt: z.number().finite(), expiresAt: z.number().finite(),
  status: z.enum(["pending", "approved", "declined", "revoked"]),
  decisionAt: z.number().optional(), decisionActor: MembershipSchema.optional(), decisionRole: z.enum(["engineer", "marketer"]).optional(),
  reason: z.string().optional(), grantExpiresAt: z.number().optional(), revokedAt: z.number().optional(),
}).strict();
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export function createApprovalRequest(input: { requestId: string; workspaceId: string; kind: ApprovalKind; version: number; payload: unknown; now: number }): ApprovalRequest {
  return ApprovalRequestSchema.parse({ requestId: input.requestId, workspaceId: input.workspaceId, kind: input.kind, version: input.version,
    binding: approvalBinding(input.kind, input.payload), createdAt: input.now, expiresAt: input.now + approvalRequestLifetime(input.kind), status: "pending" });
}
export function decideApproval(request: ApprovalRequest, input: {
  currentRequestId: string; expectedVersion: number; expectedBinding: string; actor: Membership;
  decision: "approved" | "declined"; reason?: string; now: number;
}): { request: ApprovalRequest; duplicate: boolean } {
  requireRole(input.actor, request.workspaceId, approvalRole(request.kind));
  if (request.requestId !== input.currentRequestId || request.version !== input.expectedVersion || request.binding !== input.expectedBinding) throw new Error("stale_approval");
  if (request.status === "approved" || request.status === "declined") {
    if (request.status === input.decision) return { request, duplicate: true };
    throw new Error("approval_already_decided");
  }
  if (request.status !== "pending" || request.revokedAt !== undefined || input.now >= request.expiresAt || input.now < request.createdAt) throw new Error("stale_approval");
  if (input.decision === "declined" && !input.reason?.trim()) throw new Error("decline_reason_required");
  return { duplicate: false, request: { ...request, status: input.decision, decisionAt: input.now, decisionActor: input.actor,
    decisionRole: approvalRole(request.kind) as "engineer" | "marketer", reason: input.reason,
    ...(input.decision === "approved" ? { grantExpiresAt: input.now + approvalLifetime(request.kind) } : {}),
  } };
}
export function validateApproval(request: ApprovalRequest | null, expected: {
  workspaceId: string; kind: ApprovalKind; binding: string; version?: number; requestId?: string;
}, now: number): Decision {
  if (!request) return decision(["missing_approval"]);
  const reasons: string[] = [];
  if (request.workspaceId !== expected.workspaceId || request.kind !== expected.kind || request.binding !== expected.binding ||
    (expected.version !== undefined && request.version !== expected.version) || (expected.requestId !== undefined && request.requestId !== expected.requestId)) reasons.push("stale_approval");
  if (request.status !== "approved" || request.revokedAt !== undefined) reasons.push("approval_inactive");
  if (request.decisionAt === undefined || request.grantExpiresAt === undefined || now < request.decisionAt || now >= request.grantExpiresAt || request.grantExpiresAt > request.decisionAt + approvalLifetime(request.kind)) reasons.push("approval_expired");
  if (!request.decisionActor?.active || request.decisionActor.workspaceId !== expected.workspaceId || !request.decisionActor.roles.includes(approvalRole(request.kind)) || request.decisionRole !== approvalRole(request.kind)) reasons.push("approval_wrong_role");
  return decision(reasons);
}
export function resolveSlackActor(members: Membership[], workspaceId: string, teamId: string, userId: string): Membership | null {
  return members.find((member) => member.active && member.workspaceId === workspaceId && member.slackTeamId === teamId && member.slackUserId === userId) ?? null;
}
export function cancellationResult(dispatchedAt: number | undefined): "cancelled_before_dispatch" | "already_dispatched_reconcile" {
  return dispatchedAt === undefined ? "cancelled_before_dispatch" : "already_dispatched_reconcile";
}
