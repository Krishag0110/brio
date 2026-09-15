import { describe, expect, it, vi } from "vitest";
import { RedditPublisher, validateRedditTarget, type RedditConfig } from "../../workers/social/reddit-adapter";
import { sha256 } from "../../workers/shared/security";
import type { PublishRequest } from "../../workers/shared/contracts";

const now = Math.floor(Date.now() / 1000) * 1000;
const sourceText = "u/weatherbrand the temperature is wrong";
const config: RedditConfig = { permissionApproved: true, clientId: "test-client", clientSecret: "test-secret", refreshToken: "test-refresh", userAgent: "test:fde:v1 (by /u/weatherbrand)", allowedSubreddits: ["weatherdemo"] };
function request(): PublishRequest { return { platform: "reddit", mode: "live", accountId: "weatherbrand", targetId: "t1_parent", targetUrl: "https://www.reddit.com/r/weatherdemo/comments/post/title/parent/", text: "Thanks for the direct report.", textHash: sha256("Thanks for the direct report."), sourceContextHash: sha256(sourceText), contactIntent: true, authorizationKind: "reply_approval", authorizationRef: "approval-1", authorizationVersion: 1, personaVersion: "1", budgetReservation: "reserved", publicationId: "publication-1", publicationAttemptedAt: now }; }
function fixture(options: { source?: string; subreddit?: string; me?: string; parentAuthor?: string; postFailure?: boolean; badReceipt?: boolean; comments?: number; tokenStatus?: number } = {}) {
  let authorized = false;
  const receipt = { kind: "t1", data: { name: "t1_receipt", author: "weatherbrand", subreddit: "weatherdemo", permalink: "/r/weatherdemo/comments/post/title/receipt/", body: options.badReceipt ? "different" : request().text, parent_id: "t1_parent", created_utc: now / 1000 } };
  const listing = (children: unknown[]) => Response.json({ data: { children, after: null } });
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "www.reddit.com") {
      expect(url.pathname).toBe("/api/v1/access_token");
      expect(init?.body).toBe("grant_type=refresh_token&refresh_token=test-refresh");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${Buffer.from("test-client:test-secret").toString("base64")}`);
      return Response.json({ access_token: "test-access", token_type: "bearer", expires_in: 3600, scope: "identity read submit" }, { status: options.tokenStatus ?? 200 });
    }
    expect(url.origin).toBe("https://oauth.reddit.com"); expect(url.searchParams.get("raw_json")).toBe("1");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-access");
    if (url.pathname === "/api/v1/me") return Response.json({ name: options.me ?? "weatherbrand" });
    if (url.pathname === "/api/info") {
      const id = url.searchParams.get("id");
      if (id === "t1_receipt") return listing([receipt]);
      if (id === "t3_post") return listing([{ kind: "t3", data: { name: id, author: options.parentAuthor ?? "other", subreddit: "weatherdemo", title: "Forecast", permalink: "/r/weatherdemo/comments/post/title/" } }]);
      return listing([{ kind: "t1", data: { name: "t1_parent", author: "customer", subreddit: options.subreddit ?? "weatherdemo", body: options.source ?? sourceText, parent_id: "t3_post", permalink: "/r/weatherdemo/comments/post/title/parent/" } }]);
    }
    if (url.pathname === "/api/comment") {
      expect(authorized).toBe(true);
      expect(new URLSearchParams(String(init?.body)).get("thing_id")).toBe("t1_parent");
      expect(new URLSearchParams(String(init?.body)).get("text")).toBe(request().text);
      if (options.postFailure) throw new Error("lost_post_response");
      return Response.json({ json: { errors: [], data: { things: [receipt] } } });
    }
    if (url.pathname === "/user/weatherbrand/comments") return listing(Array.from({ length: options.comments ?? 1 }, () => receipt));
    throw new Error("unexpected_fixture_request");
  });
  const authorize = vi.fn(async () => { authorized = true; });
  return { transport, authorize, adapter: new RedditPublisher(config, transport) };
}
describe("conditional official Reddit API publisher", () => {
  it("blocks missing permission and configuration before any network request", async () => {
    const { transport, authorize } = fixture();
    expect(await new RedditPublisher({ ...config, permissionApproved: false }, transport).publish(request(), authorize)).toMatchObject({ status: "definitely_not_sent", reason: "access_pending" });
    expect(await new RedditPublisher({ ...config, refreshToken: undefined }, transport).publish(request(), authorize)).toMatchObject({ status: "definitely_not_sent", reason: "configuration_required:reddit.refreshToken" });
    expect(transport).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
  });
  it("refreshes OAuth, verifies account/source, reauthorizes, sends exact text and independently reads the receipt", async () => {
    const { adapter, transport, authorize } = fixture();
    expect(await adapter.publish(request(), authorize)).toMatchObject({ status: "confirmed", mode: "live", providerReceipt: { id: "t1_receipt", accountId: "weatherbrand", targetId: "t1_parent", textHash: request().textHash } });
    expect(authorize).toHaveBeenCalledOnce(); expect(transport).toHaveBeenCalledTimes(5);
  });
  it.each([
    [{ me: "wrong-account" }, "account_mismatch"],
    [{ source: "u/weatherbrand changed" }, "source_context_changed"],
    [{ subreddit: "unapproved" }, "reddit_community_not_allowed"],
    [{ tokenStatus: 401 }, "reconnect_required"],
  ] as const)("blocks fresh preflight mismatch %j", async (options, reason) => {
    const { adapter, authorize } = fixture(options);
    expect(await adapter.publish(request(), authorize)).toMatchObject({ status: "definitely_not_sent", reason }); expect(authorize).not.toHaveBeenCalled();
  });
  it("honors current opt-out even with an exact approved context hash", async () => {
    const text = "u/weatherbrand stop replying", { adapter, authorize } = fixture({ source: text });
    expect(await adapter.publish({ ...request(), sourceContextHash: sha256(text) }, authorize)).toMatchObject({ status: "definitely_not_sent", reason: "contact_opt_out" }); expect(authorize).not.toHaveBeenCalled();
  });
  it("a plain manually copied comment requires verified direct reply intent", async () => {
    const text = "bruh", blocked = fixture({ source: text }), allowed = fixture({ source: text, parentAuthor: "weatherbrand" });
    expect(await blocked.adapter.publish({ ...request(), sourceContextHash: sha256(text) }, blocked.authorize)).toMatchObject({ status: "definitely_not_sent", reason: "direct_contact_intent_missing" });
    expect(await allowed.adapter.publish({ ...request(), sourceContextHash: sha256(text) }, allowed.authorize)).toMatchObject({ status: "confirmed" });
  });
  it.each([{ postFailure: true }, { badReceipt: true }])("uncertain send or receipt mismatch stays unknown %j", async options => {
    const { adapter, authorize, transport } = fixture(options);
    expect(await adapter.publish(request(), authorize)).toMatchObject({ status: "unknown", retryable: false });
    expect(transport.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/api/comment")).toHaveLength(1);
  });
  it("revocation immediately before dispatch produces no POST", async () => {
    const { adapter, transport } = fixture();
    expect(await adapter.publish(request(), async () => { throw new Error("revoked"); })).toMatchObject({ status: "definitely_not_sent" });
    expect(transport.mock.calls.some(([url]) => new URL(String(url)).pathname === "/api/comment")).toBe(false);
  });
  it("reconciles only a unique exact account/parent/text/time receipt without sending", async () => {
    const { adapter, transport } = fixture();
    expect(await adapter.reconcile(request())).toMatchObject({ status: "confirmed" });
    expect(transport.mock.calls.some(([url]) => new URL(String(url)).pathname === "/api/comment")).toBe(false);
    for (const comments of [0, 2]) expect(await fixture({ comments }).adapter.reconcile(request())).toMatchObject({ status: "unknown" });
    expect(await adapter.reconcile({ ...request(), publicationAttemptedAt: now - 500_000 })).toMatchObject({ status: "unknown" });
  });
  it("rejects unbound or private target URLs", () => {
    for (const url of ["https://evil.test/r/weatherdemo/comments/post/title/parent/", "http://169.254.169.254/", "https://www.reddit.com/r/weatherdemo/comments/post/title/wrong/"]) expect(() => validateRedditTarget(url, "t1_parent")).toThrow("invalid_reddit_target");
  });
});
