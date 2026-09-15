import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callbackSignature, decryptSession, encryptSession, signGrant, storageStateSchema, verifyCallback, verifyGrant, type SessionState } from "../../workers/shared/security";
import { assertClaimBinding } from "../../workers/social/service";
import { validateXTarget } from "../../workers/social/x-adapter";
import type { SocialJob, WorkerGrant } from "../../workers/shared/contracts";

export const secret = "test-only-callback-secret-with-32-bytes";
export const grant = (): WorkerGrant => ({ schemaVersion: 1, jti: "one-use-test-grant", workspaceId: "workspace", accountId: "weatherbrand", connectionId: "connection", connectionVersion: 3, operation: "session_import", exp: Date.now() + 60_000 });
export const storageState = (): SessionState => ({ cookies: ["auth_token", "ct0"].map(name => ({ name: name as "auth_token" | "ct0", value: `test-only-${name}`, domain: ".x.com", path: "/" as const, expires: -1, httpOnly: name === "auth_token", secure: true as const, sameSite: "Lax" as const })), origins: [] });

describe("worker grant and callback boundaries", () => {
  it("verifies a bound short-lived grant", () => { const value = grant(); expect(verifyGrant(signGrant(value, secret), secret)).toEqual(value); });
  it.each(["workspaceId", "accountId", "operation", "connectionVersion"])("rejects tampering with %s", field => {
    const token = signGrant(grant(), secret), [payload, signature] = token.split(".");
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()); value[field] = "changed";
    expect(() => verifyGrant(`${Buffer.from(JSON.stringify(value)).toString("base64url")}.${signature}`, secret)).toThrow("invalid_grant");
  });
  it("rejects expired and unbounded grants", () => {
    expect(() => verifyGrant(signGrant({ ...grant(), exp: Date.now() - 1 }, secret), secret)).toThrow();
    expect(() => verifyGrant(signGrant({ ...grant(), exp: Date.now() + 600_000 }, secret), secret)).toThrow();
  });
  it("rejects weak secrets", () => expect(() => signGrant(grant(), "weak")).toThrow());
  it("separates callback body and timestamp authenticity", () => {
    const timestamp = String(Date.now()), body = '{"status":"confirmed"}', signature = callbackSignature(body, timestamp, secret);
    expect(verifyCallback(body, timestamp, signature, secret)).toBe(true);
    expect(verifyCallback(body + " ", timestamp, signature, secret)).toBe(false);
    expect(verifyCallback(body, timestamp, signature, secret, Number(timestamp) + 61_000)).toBe(false);
    expect(verifyCallback(body, timestamp, signature, "engineering-credential-separate-32-bytes")).toBe(false);
  });
  it("rejects wrong-account and wrong-attempt claims", () => {
    const bound = { ...grant(), operation: "ingest_social" as const, jobId: "job", attemptId: "attempt" };
    const job: SocialJob = { schemaVersion: 1, jobId: "job", attemptId: "attempt", workspaceId: "workspace", accountId: "weatherbrand", connectionId: "connection", connectionVersion: 3, operation: "ingest_social", inputRevision: 1, idempotencyKey: "id", createdAt: Date.now(), expiresAt: Date.now() + 60_000, payload: {} };
    expect(() => assertClaimBinding(bound, job)).not.toThrow();
    expect(() => assertClaimBinding(bound, { ...job, accountId: "other" })).toThrow();
    expect(() => assertClaimBinding(bound, { ...job, attemptId: "stale" })).toThrow();
  });
});

describe("session quarantine cryptography", () => {
  it("uses fresh nonces and authenticates workspace/account/version", () => {
    const key = randomBytes(32).toString("base64"), binding = grant();
    const first = encryptSession(storageState(), binding, key, "v1"), second = encryptSession(storageState(), binding, key, "v1");
    expect(first.nonce).not.toBe(second.nonce); expect(first.ciphertext).not.toContain("test-only");
    expect(decryptSession(first, binding, { v1: key })).toEqual(storageState());
    expect(() => decryptSession(first, { ...binding, workspaceId: "other" }, { v1: key })).toThrow();
    expect(() => decryptSession(first, { ...binding, accountId: "other" }, { v1: key })).toThrow();
    expect(() => decryptSession(first, { ...binding, connectionVersion: 4 }, { v1: key })).toThrow();
  });
  it("rejects altered authenticated ciphertext and unavailable key versions", () => {
    const key = randomBytes(32).toString("base64"), binding = grant(), encrypted = encryptSession(storageState(), binding, key, "v1");
    expect(() => decryptSession({ ...encrypted, tag: randomBytes(16).toString("base64") }, binding, { v1: key })).toThrow();
    expect(() => decryptSession(encrypted, binding, { v2: key })).toThrow();
  });
  it("rejects unrelated cookies, origins, insecure storage, and missing credentials", () => {
    expect(storageStateSchema.safeParse({ ...storageState(), origins: [{ origin: "https://evil.example", localStorage: [] }] }).success).toBe(false);
    expect(storageStateSchema.safeParse({ ...storageState(), cookies: storageState().cookies.slice(1) }).success).toBe(false);
    expect(storageStateSchema.safeParse({ ...storageState(), cookies: storageState().cookies.map(c => ({ ...c, secure: false })) }).success).toBe(false);
    expect(storageStateSchema.safeParse({ ...storageState(), cookies: [...storageState().cookies, { ...storageState().cookies[0], domain: "evil.example" }] }).success).toBe(false);
  });
});

describe("social navigation allowlist", () => {
  it("accepts an exact X status identity", () => expect(validateXTarget("https://x.com/person/status/123", "123").hostname).toBe("x.com"));
  it.each(["http://x.com/person/status/123", "https://evil.example/person/status/123", "https://x.com.evil.example/person/status/123", "https://user:password@x.com/person/status/123", "https://x.com:444/person/status/123", "http://169.254.169.254/latest/meta-data", "http://127.0.0.1:8080/health", "https://x.com/person/status/456"])("rejects %s", url => expect(() => validateXTarget(url, "123")).toThrow());
});
