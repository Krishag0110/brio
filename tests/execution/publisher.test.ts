import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../../workers/shared/security";
import { SimulatorPublisher } from "../../workers/social/simulator";
import { validXText, validateFreshXSource, XPublisher } from "../../workers/social/x-adapter";
import type { PublishRequest } from "../../workers/shared/contracts";

function request(): PublishRequest { return { platform: "simulator", mode: "fixture", accountId: "weatherbrand", targetId: "123", targetUrl: "fixture://joke/123", text: "bruh", textHash: sha256("bruh"), authorizationKind: "persona_policy", authorizationRef: "policy-1", authorizationVersion: 1, personaVersion: "v1", policyEvaluationRef: "eval-1", budgetReservation: "reservation-1", contactIntent: true, publicationId: "reply-1" }; }
describe("shared publication outcomes", () => {
  it("uses the official X weighted character validator for emoji and CJK", () => {
    expect(validXText("a".repeat(280))).toBe(true); expect(validXText("a".repeat(281))).toBe(false);
    expect(validXText("界".repeat(140))).toBe(true); expect(validXText("界".repeat(141))).toBe(false);
    expect(validXText("👨‍👩‍👧‍👦".repeat(140))).toBe(true); expect(validXText("👨‍👩‍👧‍👦".repeat(141))).toBe(false);
  });
  it("requires fresh original source and an exact account mention before X contact", () => {
    const text = "@weatherbrand the Fahrenheit reading is wrong";
    expect(() => validateFreshXSource(text, "weatherbrand", sha256(text))).not.toThrow();
    expect(() => validateFreshXSource(text, "weatherbrand", sha256("old"))).toThrow("source_context_changed");
    for (const other of ["the weatherbrand site is wrong", "@weatherbrand_other wrong", "@weatherbrand don't reply", "@weatherbrand no bots", "@weatherbrand opt out"]) {
      expect(() => validateFreshXSource(other, "weatherbrand", sha256(other))).toThrow();
    }
  });
  it("confirms a visibly labeled fixture receipt only after final authorization", async () => {
    const adapter = new SimulatorPublisher(), authorize = vi.fn(async () => {});
    const result = await adapter.publish(request(), authorize);
    expect(authorize).toHaveBeenCalledOnce(); expect(result.status).toBe("confirmed"); expect(result.mode).toBe("fixture");
    if (result.status === "confirmed") expect(result.providerReceipt.url).toMatch(/^fixture:/);
  });
  it("does not reauthorize or resend an existing receipt", async () => {
    const adapter = new SimulatorPublisher(), authorize = vi.fn(async () => {});
    const first = await adapter.publish(request(), authorize), second = await adapter.publish(request(), authorize);
    expect(second).toEqual(first); expect(authorize).toHaveBeenCalledOnce();
  });
  it("distinguishes known non-send from unknown after send", async () => {
    const adapter = new SimulatorPublisher(), authorize = vi.fn(async () => {});
    expect((await adapter.publish({ ...request(), fault: "before_send" }, authorize)).status).toBe("definitely_not_sent");
    expect(authorize).not.toHaveBeenCalled();
    expect((await adapter.publish({ ...request(), fault: "after_send" }, authorize)).status).toBe("unknown");
    expect((await adapter.reconcile(request())).status).toBe("confirmed");
    expect(authorize).toHaveBeenCalledOnce();
  });
  it("does not infer a non-send when a restarted simulator has no receipt", async () => expect((await new SimulatorPublisher().reconcile(request())).status).toBe("unknown"));
  it("blocks policy revocation at the final dispatch boundary", async () => {
    const adapter = new SimulatorPublisher();
    await expect(adapter.publish(request(), async () => { throw new Error("policy_revoked"); })).rejects.toThrow("policy_revoked");
    expect((await adapter.reconcile(request())).status).toBe("unknown");
  });
  it("rejects fixture-to-live mismatches and altered exact wording", async () => {
    const adapter = new SimulatorPublisher();
    await expect(adapter.publish({ ...request(), mode: "live" }, async () => {})).rejects.toThrow("fixture_live_mismatch");
    await expect(adapter.publish({ ...request(), text: "different" }, async () => {})).rejects.toThrow("text_hash_mismatch");
  });
  it("X access-pending cannot launch a browser or report success", async () => {
    const adapter = new XPublisher({ cookies: [], origins: [] }, false), authorize = vi.fn(async () => {});
    const result = await adapter.publish({ ...request(), mode: "live", platform: "x", targetUrl: "https://x.com/user/status/123" }, authorize);
    expect(result).toMatchObject({ status: "definitely_not_sent", reason: "access_pending", mode: "live" }); expect(authorize).not.toHaveBeenCalled();
  });
});
