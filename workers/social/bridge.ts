import { z } from "zod";
import { encryptedSessionSchema, grantSchema, socialJobSchema, type EncryptedSession, type JobResult, type WorkerGrant } from "../shared/contracts";
import { encryptedRedditCredentialSchema, type EncryptedRedditCredential } from "../shared/reddit-contracts";
import { callbackSignature, requireSecret } from "../shared/security";

export const claimSchema = z.object({ job: socialJobSchema, leaseId: z.string().min(1), session: encryptedSessionSchema.optional(), redditCredential: encryptedRedditCredentialSchema.optional() });
export type ClaimedJob = z.infer<typeof claimSchema>;
export interface RedditOAuthBridge {
  start(grant: WorkerGrant, browserHash: string): Promise<void>;
  claim(state: string, browserHash: string): Promise<WorkerGrant>;
  activate(grant: WorkerGrant, verifiedAccountId: string, encrypted: EncryptedRedditCredential, allowedSubreddits: string[]): Promise<void>;
  fail(state: string): Promise<void>;
}
export interface WorkerBridge {
  reddit?: RedditOAuthBridge;
  claim(grant: WorkerGrant, jobId: string, attemptId: string): Promise<ClaimedJob>;
  heartbeat(grant: WorkerGrant, leaseId: string): Promise<void>;
  result(grant: WorkerGrant, leaseId: string, result: JobResult): Promise<void>;
  authorizeSend(grant: WorkerGrant, leaseId: string, publicationId: string): Promise<void>;
  quarantine(grant: WorkerGrant, encryptedSession: EncryptedSession): Promise<{ pendingId: string }>;
  activate(grant: WorkerGrant, pendingId: string, verifiedAccountId: string): Promise<void>;
  reject(grant: WorkerGrant, pendingId: string, reason: string): Promise<void>;
}

export class HttpWorkerBridge implements WorkerBridge {
  readonly reddit: RedditOAuthBridge = {
    start: async (grant, browserHash) => { z.object({ started: z.literal(true) }).parse(await this.send("reddit/start", { state: grant.jti, grant, browserHash })); },
    claim: async (state, browserHash) => z.object({ grant: grantSchema }).parse(await this.send("reddit/claim", { state, browserHash })).grant,
    activate: async (grant, verifiedAccountId, encrypted, allowedSubreddits) => { z.object({ activated: z.literal(true) }).parse(await this.send("reddit/activate", { state: grant.jti, verifiedAccountId, encrypted, allowedSubreddits })); },
    fail: async state => { await this.send("reddit/fail", { state }); },
  };
  constructor(private readonly baseUrl: string, private readonly callbackSecret: string) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") throw new Error("configuration_required:CONVEX_SITE_URL");
    requireSecret(callbackSecret, "SOCIAL_CALLBACK_SECRET");
  }
  private async send(path: string, value: unknown): Promise<unknown> {
    const body = JSON.stringify(value), timestamp = String(Date.now());
    const response = await fetch(new URL(`/worker/${path}`, this.baseUrl), {
      method: "POST", headers: { "content-type": "application/json", "x-worker-kind": "social", "x-worker-timestamp": timestamp, "x-worker-signature": callbackSignature(body, timestamp, this.callbackSecret) },
      body, signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`controller_rejected:${response.status}`);
    return response.json();
  }
  async claim(grant: WorkerGrant, jobId: string, attemptId: string) { return claimSchema.parse(await this.send("claim", { grant, jobId, attemptId })); }
  async heartbeat(grant: WorkerGrant, leaseId: string) { await this.send("heartbeat", { grant, leaseId }); }
  async result(grant: WorkerGrant, leaseId: string, result: JobResult) { await this.send("result", { grant, leaseId, result }); }
  async authorizeSend(grant: WorkerGrant, leaseId: string, publicationId: string) { await this.send("authorize-send", { grant, leaseId, publicationId }); }
  async quarantine(grant: WorkerGrant, encryptedSession: EncryptedSession) { return z.object({ pendingId: z.string().min(1) }).parse(await this.send("session/quarantine", { grant, encryptedSession })); }
  async activate(grant: WorkerGrant, pendingId: string, verifiedAccountId: string) { await this.send("session/activate", { grant, pendingId, verifiedAccountId }); }
  async reject(grant: WorkerGrant, pendingId: string, reason: string) { await this.send("session/reject", { grant, pendingId, reason }); }
}
