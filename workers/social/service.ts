import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { publishSchema, type JobResult, type SocialJob, type WorkerGrant } from "../shared/contracts";
import { decryptSession, encryptSession, storageStateSchema, verifyGrant, type SessionState } from "../shared/security";
import { type ClaimedJob, type WorkerBridge } from "./bridge";
import { SimulatorPublisher } from "./simulator";
import { readXMentions, verifyXAccount, XPublisher } from "./x-adapter";
import { RedditPublisher, type RedditConfig } from "./reddit-adapter";
import { decryptRedditCredential } from "./reddit-credentials";
import { handleRedditOAuth } from "./reddit-oauth";

export type WorkerConfig = { grantSecret: string; allowedOrigin: string; encryptionKeys: Record<string, string>; currentKeyVersion: string; xPermissionApproved: boolean; reddit?: RedditConfig };
export type WorkerDependencies = {
  bridge: WorkerBridge;
  verifyAccount?: (state: SessionState, accountId: string) => Promise<string>;
  redditTransport?: typeof fetch;
  execute?: (job: SocialJob, grant: WorkerGrant, claim: ClaimedJob, authorize: (publicationId: string) => Promise<void>) => Promise<unknown>;
};
export function assertClaimBinding(grant: WorkerGrant, job: SocialJob, now = Date.now()) {
  for (const key of ["jobId", "attemptId", "workspaceId", "accountId", "connectionId", "connectionVersion", "operation"] as const) if (grant[key] !== job[key]) throw new Error("job_binding_mismatch");
  if (job.expiresAt <= now || grant.exp <= now) throw new Error("job_expired");
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const value of request) {
    const chunk = Buffer.from(value); size += chunk.length;
    if (size > 32_768) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function send(response: ServerResponse, code: number, value: unknown) {
  response.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(JSON.stringify(value));
}
const dispatchSchema = z.object({ jobId: z.string(), attemptId: z.string() }).strict();
const importSchema = z.object({ grant: z.string(), storageState: storageStateSchema }).strict();

export function createWorkerServer(config: WorkerConfig, dependencies: WorkerDependencies) {
  const { bridge } = dependencies, activeAccounts = new Set<string>(), simulator = new SimulatorPublisher();
  const accountKey = (grant: WorkerGrant) => `${grant.workspaceId}:${grant.connectionId}:${grant.accountId}`;
  function redditConfig(claim: ClaimedJob, grant: WorkerGrant): RedditConfig {
    const reddit = config.reddit ?? { permissionApproved: false, allowedSubreddits: [] };
    if (!reddit.permissionApproved) return reddit;
    // A process-wide legacy refresh token cannot bypass version-bound account onboarding.
    if (!claim.redditCredential) return { ...reddit, refreshToken: undefined };
    const credential = decryptRedditCredential(claim.redditCredential, grant, config.encryptionKeys);
    if (credential.clientId !== reddit.clientId) throw new Error("reddit_client_changed");
    return { ...reddit, refreshToken: credential.refreshToken, allowedSubreddits: credential.allowedSubreddits.filter(name => reddit.allowedSubreddits.some(allowed => allowed.toLowerCase() === name)) };
  }
  async function execute(claim: ClaimedJob, grant: WorkerGrant): Promise<void> {
    const { job, leaseId } = claim;
    let leaseHealthy = true;
    const heartbeat = setInterval(() => { void bridge.heartbeat(grant, leaseId).catch(() => { leaseHealthy = false; }); }, 15_000);
    const authorize = async (publicationId: string) => {
      if (!leaseHealthy || job.expiresAt <= Date.now()) throw new Error("lease_or_job_expired");
      await bridge.authorizeSend(grant, leaseId, publicationId);
    };
    let result: JobResult;
    try {
      let output: unknown;
      if (dependencies.execute) output = await dependencies.execute(job, grant, claim, authorize);
      else if (job.operation === "publish_reply" || job.operation === "reconcile_publication") {
        const payload = publishSchema.parse(job.payload);
        if (payload.accountId !== job.accountId) throw new Error("account_mismatch");
        const adapter = payload.platform === "simulator" ? simulator : payload.platform === "reddit" ? new RedditPublisher(redditConfig(claim, grant), dependencies.redditTransport) : new XPublisher(decryptSession(claim.session!, grant, config.encryptionKeys), config.xPermissionApproved);
        output = job.operation === "publish_reply" ? await adapter.publish(payload, () => authorize(payload.publicationId)) : await adapter.reconcile(payload);
      } else {
        const { cursor, platform } = z.object({ cursor: z.string().regex(/^\d+$/).optional(), platform: z.enum(["x", "reddit"]).default("x") }).strict().parse(job.payload);
        output = platform === "reddit" ? await new RedditPublisher(redditConfig(claim, grant), dependencies.redditTransport).readMentions(job.accountId, cursor ?? "") : await readXMentions(decryptSession(claim.session!, grant, config.encryptionKeys), job.accountId, config.xPermissionApproved, cursor);
      }
      const publication = z.object({ status: z.string() }).safeParse(output);
      result = { schemaVersion: 1, jobId: job.jobId, attemptId: job.attemptId, inputRevision: job.inputRevision, status: publication.success && publication.data.status === "unknown" ? "unknown" : publication.success && publication.data.status === "definitely_not_sent" ? "failed" : "succeeded", evidenceRefs: [], output, completedAt: Date.now() };
    } catch (error) {
      const safeReason = error instanceof Error && /^reddit_(rate_limited|cursor_gap|intake_batch_limit|listing_limit|parent_mismatch|cursor_invalid)$/.test(error.message) ? error.message : "Execution did not produce a verified result; inspect connection and controller state.";
      result = { schemaVersion: 1, jobId: job.jobId, attemptId: job.attemptId, inputRevision: job.inputRevision, status: job.operation === "publish_reply" ? "unknown" : "failed", evidenceRefs: [], completedAt: Date.now(), error: { class: job.operation === "publish_reply" ? "publication_unknown" : "execution_failed", message: safeReason, retryable: job.operation === "ingest_social" } };
    } finally { clearInterval(heartbeat); }
    try { await bridge.result(grant, leaseId, result); }
    finally { activeAccounts.delete(accountKey(grant)); }
  }
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin === config.allowedOrigin) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
      response.setHeader("access-control-allow-methods", "POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "Content-Type, Authorization");
    }
    if (request.method === "GET" && request.url === "/health") return send(response, 200, { status: "ok", implementation: "experimental", queue: "convex", livePermission: config.xPermissionApproved ? "configured_unverified" : "access_pending" });
    if (request.method === "OPTIONS") return send(response, origin === config.allowedOrigin ? 204 : 403, {});
    if (await handleRedditOAuth(request, response, config, bridge.reddit, dependencies.redditTransport)) return;
    try {
      if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
      if (!(request.headers["content-type"] ?? "").startsWith("application/json")) return send(response, 415, { error: "json_required" });
      if (request.url === "/v1/sessions/import") {
        if (origin !== config.allowedOrigin) return send(response, 403, { error: "origin_rejected" });
        const input = importSchema.parse(await readJson(request));
        const grant = verifyGrant(input.grant, config.grantSecret);
        if (grant.operation !== "session_import") throw new Error("invalid_import_grant");
        const key = accountKey(grant);
        if (activeAccounts.has(key)) return send(response, 409, { error: "account_busy" });
        activeAccounts.add(key);
        let pendingId: string | undefined;
        try {
          const encrypted = encryptSession(input.storageState, grant, config.encryptionKeys[config.currentKeyVersion], config.currentKeyVersion);
          ({ pendingId } = await bridge.quarantine(grant, encrypted));
          const account = await (dependencies.verifyAccount ?? verifyXAccount)(input.storageState, grant.accountId);
          if (account.replace(/^@/, "").toLowerCase() !== grant.accountId.replace(/^@/, "").toLowerCase()) throw new Error("account_mismatch");
          if (grant.exp <= Date.now()) throw new Error("import_expired");
          await bridge.activate(grant, pendingId, account);
          return send(response, 200, { status: "activated", accountId: account, connectionVersion: grant.connectionVersion });
        } catch {
          if (pendingId) await bridge.reject(grant, pendingId, "import_verification_failed").catch(() => {});
          return send(response, 422, { error: "import_verification_failed", action: "Reconnect with a current account-owned session." });
        } finally { activeAccounts.delete(key); }
      }
      if (request.url === "/v1/jobs") {
        const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "", grant = verifyGrant(token, config.grantSecret);
        if (grant.operation === "session_import" || grant.operation === "reddit_oauth") throw new Error("invalid_job_grant");
        const input = dispatchSchema.parse(await readJson(request));
        if (grant.jobId !== input.jobId || grant.attemptId !== input.attemptId) throw new Error("job_binding_mismatch");
        const key = accountKey(grant);
        if (activeAccounts.has(key)) return send(response, 409, { error: "account_busy" });
        activeAccounts.add(key);
        let claim: ClaimedJob;
        try { claim = await bridge.claim(grant, input.jobId, input.attemptId); assertClaimBinding(grant, claim.job); }
        catch (error) { activeAccounts.delete(key); throw error; }
        send(response, 202, { status: "claimed", jobId: claim.job.jobId, attemptId: claim.job.attemptId });
        // Durable job/lease already exists in Convex. A failed callback remains unresolved there.
        void execute(claim, grant).catch(() => { process.stderr.write("worker_result_delivery_failed\n"); });
        return;
      }
      return send(response, 404, { error: "not_found" });
    } catch { return send(response, 400, { error: "request_rejected" }); }
  });
}
