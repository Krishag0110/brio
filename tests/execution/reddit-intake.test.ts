import { describe, expect, it, vi } from "vitest";
import { RedditPublisher, type RedditConfig } from "../../workers/social/reddit-adapter";

const now = 1_800_000_000_000, cursor = String(now - 60_000);
const config: RedditConfig = { permissionApproved: true, clientId: "test-client", clientSecret: "test-secret", refreshToken: "test-refresh", userAgent: "web:mend-test:v1 (by /u/drizzle-123)", allowedSubreddits: ["weatherdemo"] };
const thing = (id: string, body: string, overrides: Record<string, unknown> = {}) => ({ kind: id.startsWith("t1_") ? "t1" : "t3", data: { name: id, author: "customer", subreddit: "weatherdemo", permalink: `/r/weatherdemo/comments/post/title/${id.startsWith("t1_") ? id.slice(3) + "/" : ""}`, ...(id.startsWith("t1_") ? { body, parent_id: "t3_post" } : { title: body, selftext: body }), created_utc: (now - 10_000) / 1000, ...overrides } });
function fixture(options: { posts?: unknown[]; comments?: unknown[]; parentAuthor?: string; me?: string; rateLimited?: boolean; remaining?: string; after?: string | null } = {}) {
  const listing = (children: unknown[], after: string | null = null, headers?: HeadersInit) => Response.json({ data: { children, after } }, { headers });
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "www.reddit.com") return Response.json({ access_token: "test-access", token_type: "bearer", expires_in: 3600, scope: "identity read submit" });
    expect(init?.method).toBe("GET");
    if (url.pathname === "/api/v1/me") return Response.json({ name: options.me ?? "drizzle-123" });
    if (url.pathname === "/r/weatherdemo/new") return options.rateLimited ? new Response("", { status: 429, headers: { "Retry-After": "600" } }) : listing(options.posts ?? [thing("t3_post", "u/drizzle-123 temperature is wrong")], options.after ?? null, options.remaining ? { "x-ratelimit-remaining": options.remaining } : undefined);
    if (url.pathname === "/r/weatherdemo/comments") return listing(options.comments ?? [thing("t1_reply", "Thanks for the update")]);
    if (url.pathname === "/api/info") return listing([thing("t3_post", "Update", { author: options.parentAuthor ?? "drizzle-123" })]);
    throw new Error("unexpected_provider_request");
  });
  return { transport, adapter: new RedditPublisher(config, transport) };
}
describe("approved-community Reddit ingestion", () => {
  it("reads scoped listings, includes direct mentions and replies, and returns a cursor only after all reads", async () => {
    const f = fixture(), result = await f.adapter.readMentions("drizzle-123", cursor, now);
    expect(result).toMatchObject({ mode: "live", cursorCommitRequired: true, nextCursor: String(now - 5000) });
    expect(result.items.map(item => item.externalId).sort()).toEqual(["t1_reply", "t3_post"]);
    expect(result.items.every(item => item.platform === "reddit" && item.subreddit === "weatherdemo")).toBe(true);
    expect(f.transport).toHaveBeenCalledTimes(5);
    expect(f.transport.mock.calls.some(([input]) => String(input).includes("/api/comment"))).toBe(false);
  });
  it("blocks missing permission, communities, or cursor before network access", async () => {
    const f = fixture();
    await expect(new RedditPublisher({ ...config, permissionApproved: false }, f.transport).readMentions("drizzle-123", cursor, now)).rejects.toThrow("access_pending");
    await expect(new RedditPublisher({ ...config, allowedSubreddits: [] }, f.transport).readMentions("drizzle-123", cursor, now)).rejects.toThrow("allowedSubreddits");
    await expect(f.adapter.readMentions("drizzle-123", "", now)).rejects.toThrow("reddit_cursor_invalid"); expect(f.transport).not.toHaveBeenCalled();
  });
  it("filters opt-outs, deleted/locked/self-authored, unrelated, old, and unsettled interactions", async () => {
    const comments = [thing("t1_opt", "u/drizzle-123 stop replying"), thing("t1_del", "[deleted]"), thing("t1_lock", "u/drizzle-123 hi", { locked: true }), thing("t1_self", "u/drizzle-123 hi", { author: "drizzle-123" }), thing("t1_old", "u/drizzle-123 hi", { created_utc: (Number(cursor) - 1000) / 1000 }), thing("t1_new", "u/drizzle-123 hi", { created_utc: (now - 1000) / 1000 }), thing("t1_other", "Weather is nice")];
    const f = fixture({ posts: [], comments, parentAuthor: "someone-else" });
    expect((await f.adapter.readMentions("drizzle-123", cursor, now)).items).toEqual([]);
  });
  it("rejects a provider account mismatch or community substitution", async () => {
    await expect(fixture({ me: "other-account" }).adapter.readMentions("drizzle-123", cursor, now)).rejects.toThrow("account_mismatch");
    await expect(fixture({ posts: [thing("t3_post", "u/drizzle-123 hi", { subreddit: "unapproved" })] }).adapter.readMentions("drizzle-123", cursor, now)).rejects.toThrow("reddit_community_not_allowed");
  });
  it("stops without retrying or advancing after rate limits and pagination gaps", async () => {
    const limited = fixture({ rateLimited: true }); await expect(limited.adapter.readMentions("drizzle-123", cursor, now)).rejects.toThrow("reddit_rate_limited"); expect(limited.transport).toHaveBeenCalledTimes(3);
    const exhausted = fixture({ remaining: "0" }); await expect(exhausted.adapter.readMentions("drizzle-123", cursor, now)).rejects.toThrow("reddit_rate_limited"); expect(exhausted.transport).toHaveBeenCalledTimes(3);
    await expect(fixture({ after: "t3_older" }).adapter.readMentions("drizzle-123", cursor, now)).rejects.toThrow("reddit_cursor_gap");
  });
  it("refuses a batch larger than the controller can atomically store", async () => {
    const comments = Array.from({ length: 21 }, (_, index) => thing(`t1_c${index}`, "u/drizzle-123 support requested"));
    await expect(fixture({ posts: [], comments }).adapter.readMentions("drizzle-123", cursor, now)).rejects.toThrow("reddit_intake_batch_limit");
  });
});
