import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  // A bounded, single-workspace MVP aggregate gives approvals, reservations and jobs one atomic transaction.
  controlStates: defineTable({ workspaceId: v.string(), state: v.any() }).index("by_workspace", ["workspaceId"]),
  // Hosted fixture playback has its own aggregate and never feeds the live task pump.
  demoControlStates: defineTable({ workspaceId: v.literal("fde"), state: v.any(), timerVersion: v.number(), scheduledTick: v.optional(v.object({ runId: v.string(), stepIndex: v.number(), nextAt: v.number() })) }).index("by_workspace", ["workspaceId"]),
  auditEvents: defineTable({ workspaceId: v.string(), eventId: v.string(), at: v.string(), actor: v.string(), role: v.string(), action: v.string(), detail: v.string(), digest: v.string(), expiresAt: v.number() }).index("by_workspace_event", ["workspaceId", "eventId"]).index("by_expiry", ["expiresAt"]),
  releaseLocks: defineTable({ resource: v.string(), caseId: v.string(), candidateId: v.string(), taskId: v.string(), attemptId: v.string(), lockId: v.string(), expiresAt: v.number(), held: v.boolean(), state: v.optional(v.any()), blockedReason: v.optional(v.string()) }).index("by_resource", ["resource"]).index("by_lock", ["lockId"]),
  workerGrants: defineTable({ jti: v.string(), grant: v.any(), consumed: v.boolean() }).index("by_jti", ["jti"]),
  workerLeases: defineTable({ jobId: v.string(), attemptId: v.string(), leaseId: v.string(), grantJti: v.string(), expiresAt: v.number(), sendAuthorized: v.boolean(), completed: v.boolean(), resultHash: v.optional(v.string()), connectionId: v.optional(v.string()), accountId: v.optional(v.string()), workspaceId: v.optional(v.string()) }).index("by_job", ["jobId"]).index("by_lease", ["leaseId"]).index("by_connection", ["connectionId"]),
  socialSessions: defineTable({ connectionId: v.string(), connectionVersion: v.number(), status: v.union(v.literal("quarantined"), v.literal("active"), v.literal("rejected")), grantJti: v.string(), encrypted: v.any(), createdAt: v.number() }).index("by_connection", ["connectionId"]),
  // OAuth state and worker-encrypted credentials never enter the public workspace snapshot.
  redditOAuthStates: defineTable({ jti: v.string(), connectionId: v.string(), grant: v.any(), phase: v.union(v.literal("issued"), v.literal("started"), v.literal("claimed"), v.literal("activated"), v.literal("failed")), browserHash: v.optional(v.string()), expiresAt: v.number() }).index("by_jti", ["jti"]).index("by_connection", ["connectionId"]).index("by_expiry", ["expiresAt"]),
  redditCredentials: defineTable({ connectionId: v.string(), connectionVersion: v.number(), encrypted: v.any(), allowedSubreddits: v.array(v.string()), verifiedAt: v.number() }).index("by_connection", ["connectionId"]),
});
