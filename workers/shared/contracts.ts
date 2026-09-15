import { z } from "zod";

export const grantSchema = z.object({
  schemaVersion: z.literal(1),
  jti: z.string().min(8),
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
  connectionId: z.string().min(1),
  connectionVersion: z.number().int().nonnegative(),
  operation: z.enum(["session_import", "reddit_oauth", "ingest_social", "publish_reply", "reconcile_publication"]),
  jobId: z.string().optional(),
  attemptId: z.string().optional(),
  exp: z.number().int(),
}).strict();
export type WorkerGrant = z.infer<typeof grantSchema>;

export const publishSchema = z.object({
  platform: z.enum(["x", "reddit", "simulator"]),
  mode: z.enum(["live", "fixture"]),
  accountId: z.string().min(1),
  targetId: z.string().min(1),
  targetUrl: z.string(),
  text: z.string().min(1).max(10000),
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
  authorizationKind: z.enum(["candidate_go", "reply_approval", "persona_policy"]),
  authorizationRef: z.string().min(1),
  authorizationVersion: z.number().int().nonnegative(),
  personaVersion: z.string().min(1),
  policyEvaluationRef: z.string().optional(),
  budgetReservation: z.string().min(1),
  deploymentId: z.string().optional(),
  evidenceRef: z.string().optional(),
  contactIntent: z.literal(true),
  sourceContextHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  publicationAttemptedAt: z.number().finite().optional(),
  // Only the durable controller supplies these; the browser cannot grant authority.
  publicationId: z.string().min(1),
  fault: z.enum(["none", "before_send", "after_send", "deleted_target"]).optional(),
}).strict();
export type PublishRequest = z.infer<typeof publishSchema>;

export type PublicationResult =
  | { status: "confirmed"; mode: "live" | "fixture"; providerReceipt: { id: string; url: string; accountId: string; targetId: string; textHash: string }; completedAt: number }
  | { status: "definitely_not_sent"; mode: "live" | "fixture"; reason: string; retryable: boolean; completedAt: number }
  | { status: "unknown"; mode: "live" | "fixture"; reason: string; retryable: false; completedAt: number };

export const socialJobSchema = z.object({
  schemaVersion: z.literal(1), jobId: z.string(), workspaceId: z.string(),
  operation: z.enum(["ingest_social", "publish_reply", "reconcile_publication"]),
  attemptId: z.string(), inputRevision: z.number().int(), idempotencyKey: z.string(),
  createdAt: z.number(), expiresAt: z.number(),
  connectionId: z.string(), accountId: z.string(), connectionVersion: z.number().int(),
  payload: z.unknown(),
}).strict();
export type SocialJob = z.infer<typeof socialJobSchema>;

export type JobResult = {
  schemaVersion: 1; jobId: string; attemptId: string; inputRevision: number;
  status: "succeeded" | "failed" | "unknown";
  evidenceRefs: string[]; providerReceipt?: unknown; output?: unknown; completedAt: number;
  error?: { class: string; message: string; retryable: boolean };
};

export interface PublisherAdapter {
  publish(request: PublishRequest, authorizeAtDispatch: () => Promise<void>): Promise<PublicationResult>;
  reconcile(request: PublishRequest): Promise<PublicationResult>;
}

export const encryptedSessionSchema = z.object({
  algorithm: z.literal("AES-256-GCM"), keyVersion: z.string(),
  nonce: z.string(), ciphertext: z.string(), tag: z.string(),
  workspaceId: z.string(), accountId: z.string(), connectionId: z.string(), connectionVersion: z.number().int(),
}).strict();
export type EncryptedSession = z.infer<typeof encryptedSessionSchema>;
