import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerServer, type WorkerConfig } from "../../workers/social/service";
import type { WorkerBridge } from "../../workers/social/bridge";
import type { WorkerGrant } from "../../workers/shared/contracts";
import { sha256, signGrant } from "../../workers/shared/security";
import { decryptRedditCredential, encryptRedditCredential } from "../../workers/social/reddit-credentials";

const secret = "test-only-grant-secret-with-more-than-32-bytes";
const servers: ReturnType<typeof createWorkerServer>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function fixture(options: { approved?: boolean; account?: string; scopes?: string; refresh?: boolean } = {}) {
  const grant: WorkerGrant = { schemaVersion: 1, jti: randomUUID(), workspaceId: "fde", connectionId: "reddit", connectionVersion: 4, accountId: "drizzle-123", operation: "reddit_oauth", exp: Date.now() + 120_000 };
  const config: WorkerConfig = { grantSecret: secret, allowedOrigin: "https://mend.example", encryptionKeys: { v1: randomBytes(32).toString("base64") }, currentKeyVersion: "v1", xPermissionApproved: false, reddit: { permissionApproved: options.approved ?? true, clientId: "test-client", clientSecret: "test-client-secret", userAgent: "web:mend-test:v1 (by /u/drizzle-123)", redirectUri: "https://worker.example/v1/oauth/reddit/callback", allowedSubreddits: ["weatherdemo"] } };
  let startedHash = "", claimed = false;
  const bridge: WorkerBridge = { claim: vi.fn(), heartbeat: vi.fn(), result: vi.fn(), authorizeSend: vi.fn(), quarantine: vi.fn(), activate: vi.fn(), reject: vi.fn(), reddit: {
    start: vi.fn(async (_grant, hash) => { startedHash = hash; }),
    claim: vi.fn(async (state, hash) => { if (claimed || state !== grant.jti || hash !== startedHash) throw new Error("state_rejected"); claimed = true; return grant; }),
    activate: vi.fn(async () => {}), fail: vi.fn(async () => {}),
  } };
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/access_token") {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("grant_type") === "authorization_code") return Response.json({ access_token: "test-code-access-token", token_type: "bearer", expires_in: 3600, scope: options.scopes ?? "identity read submit", ...(options.refresh === false ? {} : { refresh_token: "test-private-refresh-token" }) });
      expect(form.get("refresh_token")).toBe("test-private-refresh-token");
      return Response.json({ access_token: "test-refreshed-access-token", token_type: "bearer", expires_in: 3600, scope: options.scopes ?? "identity read submit" });
    }
    expect(url.href).toBe("https://oauth.reddit.com/api/v1/me?raw_json=1");
    return Response.json({ name: options.account ?? "drizzle-123" });
  });
  const server = createWorkerServer(config, { bridge, redditTransport: transport }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const start = (origin = config.allowedOrigin, value = grant) => fetch(`${base}/v1/oauth/reddit/start`, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant: signGrant(value, secret) }).toString(), redirect: "manual" });
  const callback = (cookie?: string, query = `state=${grant.jti}&code=test-authorization-code`) => fetch(`${base}/v1/oauth/reddit/callback?${query}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { grant, config, bridge, transport, start, callback };
}
describe("Reddit OAuth HTTP flow", () => {
  it("binds permanent authorization to a host-only browser cookie, verifies refresh identity, and persists only ciphertext", async () => {
    const f = await fixture(), start = await f.start();
    expect(start.status).toBe(303);
    const auth = new URL(start.headers.get("location")!);
    expect(auth.origin).toBe("https://www.reddit.com");
    expect(Object.fromEntries(auth.searchParams)).toMatchObject({ duration: "permanent", scope: "identity read submit", state: f.grant.jti, redirect_uri: f.config.reddit!.redirectUri });
    const cookie = start.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax"); expect(cookie).toContain("Path=/"); expect(cookie).not.toContain("Domain=");
    const result = await f.callback(cookie.split(";")[0]);
    expect(result.status).toBe(303); expect(result.headers.get("location")).toBe("https://mend.example/connections?reddit=connected");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer"); expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(f.transport).toHaveBeenCalledTimes(3);
    const [, account, encrypted, communities] = vi.mocked(f.bridge.reddit!.activate).mock.calls[0];
    expect(account).toBe("drizzle-123"); expect(communities).toEqual(["weatherdemo"]);
    expect(JSON.stringify(encrypted)).not.toContain("test-private-refresh-token");
    expect(decryptRedditCredential(encrypted, f.grant, f.config.encryptionKeys)).toMatchObject({ refreshToken: "test-private-refresh-token" });
    expect(f.bridge.authorizeSend).not.toHaveBeenCalled();
  });
  it("blocks absent API approval and an unapproved origin before state or provider calls", async () => {
    const denied = await fixture({ approved: false }); expect((await denied.start()).status).toBe(400); expect(denied.bridge.reddit!.start).not.toHaveBeenCalled(); expect(denied.transport).not.toHaveBeenCalled();
    const origin = await fixture(); expect((await origin.start("https://other.example")).status).toBe(400); expect(origin.bridge.reddit!.start).not.toHaveBeenCalled();
  });
  it("rejects missing/wrong browser proof and callback replay without repeating the token exchange", async () => {
    const f = await fixture(), start = await f.start(), cookie = start.headers.get("set-cookie")!.split(";")[0];
    expect((await f.callback()).status).toBe(400); expect(f.bridge.reddit!.claim).not.toHaveBeenCalled();
    expect((await f.callback(cookie.replace(/=.*/, "=" + "x".repeat(43)))).status).toBe(400); expect(f.transport).not.toHaveBeenCalled();
    expect((await f.callback(cookie)).status).toBe(303);
    const calls = f.transport.mock.calls.length;
    expect((await f.callback(cookie)).status).toBe(400); expect(f.transport).toHaveBeenCalledTimes(calls);
  });
  it.each([{ account: "wrong-account" }, { scopes: "identity read" }, { refresh: false }])("never activates invalid account or OAuth capability %j", async options => {
    const f = await fixture(options), start = await f.start();
    const result = await f.callback(start.headers.get("set-cookie")!.split(";")[0]);
    expect(result.status).toBe(400); expect(f.bridge.reddit!.activate).not.toHaveBeenCalled(); expect(f.bridge.reddit!.fail).toHaveBeenCalledWith(f.grant.jti);
    expect(await result.text()).not.toMatch(/test-private|test-code|test-client-secret/);
  });
  it("consumes a denied authorization without contacting the token endpoint", async () => {
    const f = await fixture(), start = await f.start();
    expect((await f.callback(start.headers.get("set-cookie")!.split(";")[0], `state=${f.grant.jti}&error=access_denied`)).status).toBe(400);
    expect(f.transport).not.toHaveBeenCalled(); expect(f.bridge.reddit!.fail).toHaveBeenCalledOnce();
  });
  it("rejects expired/wrong-operation grants before setting the browser proof", async () => {
    const f = await fixture();
    for (const grant of [{ ...f.grant, exp: Date.now() - 1 }, { ...f.grant, operation: "session_import" as const }]) expect((await f.start(undefined, grant)).status).toBe(400);
    expect(f.bridge.reddit!.start).not.toHaveBeenCalled();
  });
});
describe("Reddit credential encryption", () => {
  it("rejects account/version/ciphertext substitutions and supports explicit old key versions", () => {
    const key = randomBytes(32).toString("base64"), binding = { workspaceId: "fde", connectionId: "reddit", accountId: "drizzle-123", connectionVersion: 3 };
    const credential = { clientId: "test-client", refreshToken: "test-only-private-refresh-token", allowedSubreddits: ["weatherdemo"] };
    const encrypted = encryptRedditCredential(credential, binding, key, "old");
    expect(decryptRedditCredential(encrypted, binding, { old: key })).toEqual(credential);
    expect(sha256(JSON.stringify(encrypted))).toHaveLength(64);
    for (const changed of [{ ...binding, accountId: "other-account" }, { ...binding, connectionVersion: 4 }]) expect(() => decryptRedditCredential(encrypted, changed, { old: key })).toThrow("binding_mismatch");
    expect(() => decryptRedditCredential({ ...encrypted, ciphertext: Buffer.from("tampered").toString("base64") }, binding, { old: key })).toThrow();
    expect(() => decryptRedditCredential(encrypted, binding, { current: key })).toThrow("session_key_version_unavailable");
  });
});
