import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { approvalBinding, approvalLifetime, canGroupReports, canonicalJson, classifySignal, completionOutcome, createApprovalRequest, DAY, decideApproval, hashText, HOUR, normalizeSignal, parseSocialTarget, requireRole, resolveSlackActor, validateApproval } from "../../src/core";
import { candidate, engineer, grant, marketer, NOW } from "./fixtures";

describe("cryptographic exact-text bindings", () => {
  it.each(["", "abc", "bruh 😭", "a".repeat(1000), "20°C → 68°F"])('matches SHA-256 for %j', (text) => expect(hashText(text)).toBe(createHash("sha256").update(text).digest("hex")));
  it("canonicalizes nested keys and rejects unrepresentable values", () => {
    expect(canonicalJson({ z: 2, a: { d: true, b: [1, null] } })).toBe(canonicalJson({ a: { b: [1, null], d: true }, z: 2 }));
    expect(() => canonicalJson({ x: undefined })).toThrow();
    expect(() => canonicalJson(NaN)).toThrow();
    expect(hashText("text")).not.toBe(hashText("text "));
  });
});
describe("A04/A06/A12 authorization and identity", () => {
  it("requires exact workspace and role; admin does not impersonate marketer", () => {
    expect(() => requireRole(engineer, "other", "engineer")).toThrow("forbidden");
    expect(() => requireRole({ ...engineer, roles: ["admin"] }, "ws", "marketer")).toThrow();
    expect(resolveSlackActor([marketer], "ws", "T-other", "UM")).toBeNull();
    expect(resolveSlackActor([marketer], "ws", "T1", "UM")).toEqual(marketer);
  });
  it("separates request and accepted-grant clocks", () => {
    const build = { repository: "owned/weather", baseSha: "base", planVersion: "1", allowedPaths: ["src/weather/"], acceptanceCriteria: ["20 Celsius becomes 68 Fahrenheit"], risk: "low", maxAttempts: 3, maxCostUsd: 1 };
    const request = createApprovalRequest({ requestId: "b", workspaceId: "ws", kind: "build", version: 1, payload: build, now: NOW });
    expect(request.expiresAt).toBe(NOW + DAY);
    const approved = decideApproval(request, { currentRequestId: "b", expectedVersion: 1, expectedBinding: request.binding, actor: engineer, decision: "approved", now: NOW + DAY - 1 }).request;
    expect(approved.grantExpiresAt).toBe(NOW + 2 * DAY - 1);
    expect(validateApproval(approved, { workspaceId: "ws", kind: "build", binding: request.binding }, NOW + DAY + 100).allowed).toBe(true);
    expect(approvalLifetime("candidate_go")).toBe(HOUR);
  });
  it("duplicate decisions return the original actor/time; stale cards and wrong roles fail", () => {
    const accepted = grant("candidate_go", candidate);
    const click = { currentRequestId: accepted.requestId, expectedVersion: 1, expectedBinding: accepted.binding, actor: marketer, decision: "approved" as const, now: NOW + 2 };
    expect(decideApproval(accepted, click)).toEqual({ request: accepted, duplicate: true });
    expect(() => decideApproval(accepted, { ...click, actor: engineer })).toThrow();
    expect(() => decideApproval(accepted, { ...click, expectedVersion: 2 })).toThrow("stale_approval");
    expect(() => decideApproval(accepted, { ...click, currentRequestId: "new-card" })).toThrow("stale_approval");
    expect(validateApproval(accepted, { workspaceId: "ws", kind: "candidate_go", binding: accepted.binding }, NOW + HOUR).allowed).toBe(false);
  });
  it.each(["headSha", "treeDigest", "deploymentId", "testRevision", "buildConfigRevision", "baseSha"] as const)("invalidates Go when %s changes", (key) => {
    const accepted = grant("candidate_go", candidate);
    expect(validateApproval(accepted, { workspaceId: "ws", kind: "candidate_go", binding: approvalBinding("candidate_go", { ...candidate, [key]: "changed" }) }, NOW).allowed).toBe(false);
  });
  it.each(["textHash", "personaVersion", "accountId", "targetId", "contextHash"] as const)("freezes reply batch %s", (key) => {
    expect(approvalBinding("candidate_go", { ...candidate, replies: [{ ...candidate.replies[0], [key]: "changed" }] })).not.toBe(approvalBinding("candidate_go", candidate));
  });
  it("no-go is a reasoned hold, not authorization", () => {
    const request = createApprovalRequest({ requestId: "go", workspaceId: "ws", kind: "candidate_go", version: 1, payload: candidate, now: NOW });
    const declined = decideApproval(request, { currentRequestId: "go", expectedVersion: 1, expectedBinding: request.binding, actor: marketer, decision: "declined", reason: "Wording is too strong", now: NOW }).request;
    expect(validateApproval(declined, { workspaceId: "ws", kind: "candidate_go", binding: request.binding }, NOW).allowed).toBe(false);
  });
});
describe("A10/A11/A24 normalization and grouping", () => {
  const input = { workspaceId: "ws", platform: "x" as const, sourceMode: "manual" as const, originalUrl: "https://twitter.com/alice/status/123?s=1", authorId: "alice", text: "20°C becomes 20°F", observedAt: NOW, productId: "weather" };
  it("extracts an ID without altering source evidence; fixture cannot alias a real signal", () => {
    const real = normalizeSignal(input);
    const fixture = normalizeSignal({ ...input, sourceMode: "fixture", fixtureNamespace: "demo" });
    expect(real.interactionId).toBe("123"); expect(real.text).toBe(input.text); expect(real.originalUrl).toBe(input.originalUrl);
    expect(real.sourceKey).not.toBe(fixture.sourceKey); expect(fixture.hasValidTarget).toBe(false);
    expect(() => normalizeSignal({ ...input, externalInteractionId: "456" })).toThrow("source_id_url_mismatch");
  });
  it.each(["http://x.com/alice/status/123", "https://x.com.evil.test/alice/status/123", "https://a:b@x.com/alice/status/123", "https://x.com:444/alice/status/123"])("rejects unsafe target %s", (url) => expect(parseSocialTarget("x", url)).toBeNull());
  it("retains separate reports if revision, component, or symptom is uncertain", () => {
    const report = { productId: "weather", deployedRevision: "v1", component: "unit", symptomSignature: "label-only" };
    expect(canGroupReports(report, report)).toBe(true);
    for (const key of Object.keys(report)) expect(canGroupReports(report, { ...report, [key]: "different" })).toBe(false);
    expect(canGroupReports({ productId: "weather" }, { productId: "weather" })).toBe(false);
  });
  it("sends joking genuine complaints to engineering before banter", () => expect(classifySignal("20°C becomes 20°F. your calculator asleep?").category).toBe("actionable_defect"));
  it("keeps production verification distinct from customer notification", () => {
    expect(completionOutcome({ route: "engineering_resolution", purpose: "resolution", liveVerified: true, requiredReplies: 2, confirmedReplies: 1, communicationWaived: false })).toBeNull();
    expect(completionOutcome({ route: "engineering_resolution", purpose: "resolution", liveVerified: true, requiredReplies: 2, confirmedReplies: 1, communicationWaived: true })).toBe("resolved_without_reply");
  });
});
