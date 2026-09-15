import { describe, expect, it } from "vitest";
import { assessJobResult, expiredLeaseAction, JobEnvelopeSchema, JobResultSchema, navigationAllowed, type JobEnvelope, type JobResult, type PersistedJob } from "../../src/core";
import { NOW, publication } from "./fixtures";

const job = (): JobEnvelope => ({ schemaVersion: 1, jobId: "job", workspaceId: "ws", operation: "publish_reply", attemptId: "a1", inputRevision: "revision-1", idempotencyKey: "send-1", createdAt: NOW, expiresAt: NOW + 120_000,
  scope: { kind: "case", caseId: "case", route: "social_engagement", expectedCaseVersion: 2 }, payload: { ...publication().payload, connectionId: "conn-1", connectionVersion: 1 } });
const result = (): JobResult => ({ schemaVersion: 1, jobId: "job", attemptId: "a1", inputRevision: "revision-1", status: "succeeded", evidenceRefs: [], providerReceipt: { replyId: "r1" }, completedAt: NOW + 1000,
  result: { kind: "publication", outcome: "confirmed", replyId: "r1", replyUrl: "https://x.com/brand/status/456", mode: "live" }, error: null });
const persisted = (): PersistedJob => ({ envelope: job(), activeAttemptId: "a1", currentInputRevision: "revision-1", currentCaseVersion: 2, dispatchedAt: NOW, leaseExpiresAt: NOW + 60_000 });

describe("A12/A20/A25 runtime contracts and late callback disposition", () => {
  it("validates versioned typed job and result boundaries", () => {
    expect(JobEnvelopeSchema.safeParse(job()).success).toBe(true); expect(JobResultSchema.safeParse(result()).success).toBe(true);
    expect(JobEnvelopeSchema.safeParse({ ...job(), schemaVersion: 2 }).success).toBe(false);
    expect(JobEnvelopeSchema.safeParse({ ...job(), expiresAt: NOW - 1 }).success).toBe(false);
    expect(JobEnvelopeSchema.safeParse({ ...job(), extra: "secret" }).success).toBe(false);
  });
  it("ingestion binds connection/account version before any case exists", () => {
    const ingest = { ...job(), operation: "ingest_social", scope: { kind: "account", connectionId: "conn", accountId: "brand", connectionVersion: 1, configVersion: 1 }, payload: { platform: "x", cursor: null, limit: 20 } };
    expect(JobEnvelopeSchema.safeParse(ingest).success).toBe(true);
    expect(JobEnvelopeSchema.safeParse({ ...ingest, payload: { ...ingest.payload, limit: 21 } }).success).toBe(false);
    expect(JobEnvelopeSchema.safeParse({ ...ingest, scope: { ...ingest.scope, connectionVersion: undefined } }).success).toBe(false);
  });
  it("duplicate matching result is acknowledged without repeating a transition", () => {
    expect(assessJobResult(persisted(), result())).toBe("accept");
    expect(assessJobResult({ ...persisted(), acceptedResultDigest: "digest" }, result(), "digest")).toBe("duplicate");
  });
  it.each([{ activeAttemptId: "a2" }, { currentCaseVersion: 3 }, { currentInputRevision: "revision-2" }])("retains an authentic stale effect for reconciliation: %j", (changes) => expect(assessJobResult({ ...persisted(), ...changes }, result())).toBe("stale_reconcile"));
  it("wrong job identity and malformed confirmed receipts fail closed", () => {
    expect(assessJobResult(persisted(), { ...result(), jobId: "other" })).toBe("invalid");
    expect(assessJobResult(persisted(), { ...result(), result: { kind: "publication", outcome: "confirmed", mode: "live" } })).toBe("invalid");
  });
  it("verification callbacks must identify the requested deployment, tree, and trusted tests", () => {
    const envelope: JobEnvelope = { ...job(), operation: "verify_live", scope: { kind: "case", caseId: "case", route: "engineering_resolution", expectedCaseVersion: 2 }, payload: { url: "https://weather.example.test", expectedDeploymentId: "deploy", expectedTreeDigest: "tree", trustedTestRevision: "tests-v1" } };
    const verification: JobResult = { ...result(), result: { kind: "verification", passed: true, deploymentId: "deploy", treeDigest: "tree", testVersion: "tests-v1" } };
    expect(assessJobResult({ ...persisted(), envelope }, verification)).toBe("accept");
    expect(assessJobResult({ ...persisted(), envelope }, { ...verification, result: { ...verification.result, deploymentId: "other" } })).toBe("invalid");
    expect(assessJobResult({ ...persisted(), envelope }, { ...verification, result: { ...verification.result, testVersion: "untrusted-tests" } })).toBe("invalid");
  });
  it("unknown billing/publication outcomes are not marked retryable", () => expect(JobResultSchema.safeParse({ ...result(), status: "unknown", error: { class: "effect_unknown", code: "timeout_after_post", message: "Outcome unknown", retryable: true } }).success).toBe(false));
  it("expired effect lease reconciles, never blindly reruns Post", () => {
    expect(expiredLeaseAction(persisted(), NOW + 100)).toBe("wait");
    expect(expiredLeaseAction(persisted(), NOW + 70_000)).toBe("reconcile_effect");
  });
  it.each(["http://x.com/", "https://x.com.evil.test/", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data", "https://x.com:444/", "https://user:pass@x.com/"])("navigation allowlist rejects %s", (url) => expect(navigationAllowed(url, ["x.com", "127.0.0.1", "169.254.169.254"])).toBe(false));
  it("permits the exact approved HTTPS host", () => expect(navigationAllowed("https://x.com/brand/status/123", ["x.com"])).toBe(true));
});
