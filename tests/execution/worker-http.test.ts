import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerServer, type WorkerConfig } from "../../workers/social/service";
import { sha256, signGrant, type SessionState } from "../../workers/shared/security";
import type { WorkerBridge } from "../../workers/social/bridge";
import type { WorkerGrant } from "../../workers/shared/contracts";

const secret = "test-only-callback-secret-with-32-bytes";
const grant = (): WorkerGrant => ({ schemaVersion: 1, jti: "one-use-test-grant", workspaceId: "workspace", accountId: "weatherbrand", connectionId: "connection", connectionVersion: 3, operation: "session_import", exp: Date.now() + 60_000 });
const state: SessionState = { cookies: ["auth_token", "ct0"].map(name => ({ name: name as "auth_token" | "ct0", value: `test-only-${name}`, domain: ".x.com", path: "/", expires: -1, httpOnly: name === "auth_token", secure: true, sameSite: "Lax" })), origins: [] };
const servers: ReturnType<typeof createWorkerServer>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });

async function fixture(verifiedAccountId = "weatherbrand") {
  const bridge: WorkerBridge = { claim: vi.fn(), heartbeat: vi.fn(async () => {}), result: vi.fn(async () => {}), authorizeSend: vi.fn(async () => {}), quarantine: vi.fn(async () => ({ pendingId: "pending-1" })), activate: vi.fn(async () => {}), reject: vi.fn(async () => {}) };
  const config: WorkerConfig = { grantSecret: secret, allowedOrigin: "https://control.example", encryptionKeys: { v1: randomBytes(32).toString("base64") }, currentKeyVersion: "v1", xPermissionApproved: false };
  const verifyAccount = vi.fn(async () => verifiedAccountId), server = createWorkerServer(config, { bridge, verifyAccount }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const importSession = (origin = config.allowedOrigin, value: unknown = state) => fetch(`${base}/v1/sessions/import`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ grant: signGrant(grant(), secret), storageState: value }) });
  return { bridge, base, importSession, verifyAccount };
}
describe("worker HTTP import boundaries", () => {
  it("routes Reddit independently of X ciphertext and keeps missing API approval blocked", async () => {
    const { bridge, base, verifyAccount } = await fixture();
    const dispatchGrant: WorkerGrant = { ...grant(), operation: "publish_reply", jobId: "reddit-job", attemptId: "reddit-attempt" };
    vi.mocked(bridge.claim).mockResolvedValue({ leaseId: "reddit-lease", job: { schemaVersion: 1, jobId: "reddit-job", attemptId: "reddit-attempt", workspaceId: dispatchGrant.workspaceId, operation: "publish_reply", accountId: dispatchGrant.accountId, connectionId: dispatchGrant.connectionId, connectionVersion: dispatchGrant.connectionVersion, inputRevision: 1, idempotencyKey: "reddit-one", createdAt: Date.now(), expiresAt: dispatchGrant.exp, payload: { platform: "reddit", mode: "live", accountId: dispatchGrant.accountId, targetId: "t1_parent", targetUrl: "https://www.reddit.com/r/weatherdemo/comments/post/title/parent/", text: "bruh", textHash: sha256("bruh"), authorizationKind: "reply_approval", authorizationRef: "approval", authorizationVersion: 1, personaVersion: "1", budgetReservation: "reservation", contactIntent: true, publicationId: "publication" } } });
    const response = await fetch(`${base}/v1/jobs`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${signGrant(dispatchGrant, secret)}` }, body: JSON.stringify({ jobId: "reddit-job", attemptId: "reddit-attempt" }) });
    expect(response.status).toBe(202);
    await vi.waitUntil(() => vi.mocked(bridge.result).mock.calls.length === 1);
    expect(vi.mocked(bridge.result).mock.calls[0][2]).toMatchObject({ status: "failed", output: { status: "definitely_not_sent", reason: "access_pending" } });
    expect(verifyAccount).not.toHaveBeenCalled(); expect(bridge.authorizeSend).not.toHaveBeenCalled();
  });
  it("quarantines only ciphertext, then activates after owner verification", async () => {
    const { bridge, importSession, verifyAccount } = await fixture(); const response = await importSession();
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ status: "activated", accountId: "weatherbrand" });
    const [, encrypted] = vi.mocked(bridge.quarantine).mock.calls[0]; expect(JSON.stringify(encrypted)).not.toContain("test-only-auth_token");
    expect(verifyAccount).toHaveBeenCalledOnce(); expect(bridge.activate).toHaveBeenCalledOnce(); expect(bridge.reject).not.toHaveBeenCalled();
  });
  it("wrong account deletes quarantine without replacing active session", async () => {
    const { bridge, importSession } = await fixture("wrong-account"); expect((await importSession()).status).toBe(422);
    expect(bridge.activate).not.toHaveBeenCalled(); expect(bridge.reject).toHaveBeenCalledWith(expect.anything(), "pending-1", "import_verification_failed");
  });
  it("disconnected connection or reused grant cannot activate", async () => {
    const { bridge, importSession } = await fixture(); vi.mocked(bridge.activate).mockRejectedValue(new Error("connection_version_changed"));
    expect((await importSession()).status).toBe(422); expect(bridge.reject).toHaveBeenCalledOnce();
    vi.mocked(bridge.quarantine).mockRejectedValue(new Error("grant_already_used")); expect((await importSession()).status).toBe(422);
  });
  it("rejects unapproved origin and invalid/oversized session payloads", async () => {
    const { bridge, importSession } = await fixture(); expect((await importSession("https://evil.example")).status).toBe(403);
    expect((await importSession(undefined, { ...state, origins: [{ origin: "https://evil.example" }] })).status).toBe(400);
    expect((await importSession(undefined, { ...state, extra: "x".repeat(40_000) })).status).toBe(400); expect(bridge.quarantine).not.toHaveBeenCalled();
  });
  it("health distinguishes implementation from account permission", async () => {
    const { base } = await fixture(); expect(await fetch(`${base}/health`).then(response => response.json())).toMatchObject({ implementation: "experimental", livePermission: "access_pending", queue: "convex" });
  });
});
