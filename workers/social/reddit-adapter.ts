import { z } from "zod";
import { publishSchema, type PublicationResult, type PublisherAdapter, type PublishRequest } from "../shared/contracts";
import { hasContactOptOut } from "../shared/contact-intent";
import { sha256 } from "../shared/security";
import { redditAccountSchema, redditCommunitiesSchema, redditIngestionSchema } from "../shared/reddit-contracts";

export type RedditConfig = { permissionApproved: boolean; clientId?: string; clientSecret?: string; refreshToken?: string; userAgent?: string; allowedSubreddits: string[]; redirectUri?: string };
const normalizeAccount = (value: string) => value.replace(/^\/?u\//i, "").toLowerCase();
const fullname = z.string().regex(/^t[13]_[a-z0-9]+$/);
const thingSchema = z.object({ kind: z.enum(["t1", "t3"]), data: z.object({ name: fullname, author: z.string(), subreddit: z.string(), permalink: z.string(), body: z.string().optional(), title: z.string().optional(), selftext: z.string().optional(), parent_id: fullname.optional(), locked: z.boolean().optional(), archived: z.boolean().optional(), removed_by_category: z.string().nullable().optional(), created_utc: z.number().optional() }) });
const listingSchema = z.object({ data: z.object({ children: z.array(thingSchema), after: z.string().nullable().optional() }) });
type RedditThing = z.infer<typeof thingSchema>;

export function validateRedditTarget(raw: string, targetId: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !["reddit.com", "www.reddit.com", "old.reddit.com"].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) throw new Error("invalid_reddit_target");
  const parts = url.pathname.match(/^\/(?:r\/[A-Za-z0-9_]+\/)?comments\/([a-z0-9]+)(?:\/[^/]+)?(?:\/([a-z0-9]+))?\/?$/i);
  if (!parts || `${parts[2] ? "t1" : "t3"}_${(parts[2] ?? parts[1]).toLowerCase()}` !== targetId) throw new Error("invalid_reddit_target");
  return url;
}

/** Official OAuth API only. No scraping, credential forwarding, challenge bypass, or implicit retry. */
export class RedditPublisher implements PublisherAdapter {
  constructor(private readonly config: RedditConfig, private readonly transport: typeof fetch = fetch) {}
  private configured(): void {
    if (!this.config.permissionApproved) throw new Error("access_pending");
    for (const key of ["clientId", "clientSecret", "refreshToken", "userAgent"] as const) if (!this.config[key]) throw new Error(`configuration_required:reddit.${key}`);
    if (!redditCommunitiesSchema.safeParse(this.config.allowedSubreddits).success) throw new Error("configuration_required:reddit.allowedSubreddits");
  }
  private async session() {
    this.configured();
    const response = await this.transport("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`, "user-agent": this.config.userAgent!, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.config.refreshToken! }).toString(), signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error("reconnect_required");
    const token = z.object({ access_token: z.string().min(1), token_type: z.string(), expires_in: z.number().positive(), scope: z.string() }).parse(await response.json());
    if (token.token_type.toLowerCase() !== "bearer" || !["identity", "read", "submit"].every(scope => token.scope.split(" ").includes(scope) || token.scope === "*")) throw new Error("reddit_scopes_required");
    let exhausted = false;
    return async (endpoint: string, values?: Record<string, string>): Promise<unknown> => {
      if (exhausted) throw new Error("reddit_rate_limited");
      const url = new URL(endpoint, "https://oauth.reddit.com");
      if (url.origin !== "https://oauth.reddit.com") throw new Error("reddit_origin_forbidden");
      url.searchParams.set("raw_json", "1");
      const reply = await this.transport(url, { method: values ? "POST" : "GET", headers: { authorization: `Bearer ${token.access_token}`, "user-agent": this.config.userAgent!, ...(values ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body: values ? new URLSearchParams(values).toString() : undefined, signal: AbortSignal.timeout(10_000), redirect: "error" });
      const remaining = reply.headers.get("x-ratelimit-remaining");
      exhausted = remaining !== null && Number.isFinite(Number(remaining)) && Number(remaining) < 1;
      if (!reply.ok) throw new Error(reply.status === 401 ? "reconnect_required" : reply.status === 429 ? "reddit_rate_limited" : `reddit_http_${reply.status}`);
      return reply.json();
    };
  }
  private async assertAccount(api: Awaited<ReturnType<RedditPublisher["session"]>>, account: string) {
    const me = z.object({ name: z.string(), is_suspended: z.boolean().optional() }).parse(await api("/api/v1/me"));
    if (normalizeAccount(me.name) !== normalizeAccount(account) || me.is_suspended) throw new Error("account_mismatch");
  }
  async verifyAccount(account: string): Promise<string> {
    const normalized = redditAccountSchema.parse(account), api = await this.session();
    await this.assertAccount(api, normalized);
    return normalized;
  }
  /** Bounded recent listings in explicitly approved communities, using read scope only. */
  async readMentions(accountId: string, cursor: string, now = Date.now()) {
    this.configured();
    const account = redditAccountSchema.parse(accountId);
    if (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) > now) throw new Error("reddit_cursor_invalid");
    const previous = Number(cursor), upper = Math.max(previous, Math.floor(now / 1000) * 1000 - 5000);
    const api = await this.session(); await this.assertAccount(api, account);
    const candidates = new Map<string, RedditThing>();
    for (const subreddit of redditCommunitiesSchema.parse(this.config.allowedSubreddits)) {
      for (const feed of ["new", "comments"] as const) {
        const listing = listingSchema.parse(await api(`/r/${subreddit}/${feed}?limit=100`));
        if (listing.data.children.length > 100) throw new Error("reddit_listing_limit");
        // Refuse to advance past a gap rather than silently dropping an overloaded feed.
        const timestamps = listing.data.children.map(thing => thing.data.created_utc).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        if (timestamps.length !== listing.data.children.length || (listing.data.after && (!timestamps.length || Math.min(...timestamps) * 1000 > previous))) throw new Error("reddit_cursor_gap");
        for (const thing of listing.data.children) {
          const data = thing.data, createdAt = Math.floor(data.created_utc! * 1000);
          if (data.subreddit.toLowerCase() !== subreddit || (feed === "new" ? thing.kind !== "t3" : thing.kind !== "t1")) throw new Error("reddit_community_not_allowed");
          if (createdAt > previous && createdAt <= upper) candidates.set(data.name, thing);
        }
      }
    }
    const items: z.infer<typeof redditIngestionSchema>["items"] = [];
    const parents = new Map<string, RedditThing>();
    const parentIds = [...new Set([...candidates.values()].flatMap(thing => thing.kind === "t1" && thing.data.parent_id ? [thing.data.parent_id] : []))];
    // api/info accepts comma-separated fullnames; batch parents instead of a request per comment.
    for (let start = 0; start < parentIds.length; start += 100) {
      const ids = parentIds.slice(start, start + 100);
      const batch = listingSchema.parse(await api(`/api/info?id=${ids.join(",")}`));
      for (const thing of batch.data.children) {
        if (!ids.includes(thing.data.name) || !this.config.allowedSubreddits.some(name => name.toLowerCase() === thing.data.subreddit.toLowerCase())) throw new Error("reddit_parent_mismatch");
        parents.set(thing.data.name, thing);
      }
    }
    for (const thing of candidates.values()) {
      const data = thing.data, text = thing.kind === "t1" ? data.body : data.selftext || data.title;
      if (!text || text.length > 20_000 || ["[deleted]", "[removed]"].includes(text) || !redditAccountSchema.safeParse(data.author).success || normalizeAccount(data.author) === account || data.locked || data.archived || data.removed_by_category || hasContactOptOut(text)) continue;
      let contact = new RegExp(`(?:^|[^A-Za-z0-9_])/?u/${account}(?![A-Za-z0-9_-])`, "i").test(text);
      if (!contact && thing.kind === "t1" && data.parent_id) {
        const parent = parents.get(data.parent_id);
        contact = !!parent && parent.data.subreddit.toLowerCase() === data.subreddit.toLowerCase() && normalizeAccount(parent.data.author) === account;
      }
      if (!contact) continue;
      const originalUrl = new URL(data.permalink, "https://www.reddit.com").href;
      validateRedditTarget(originalUrl, data.name);
      items.push({ platform: "reddit", sourceMode: "live", externalId: data.name, originalUrl, author: normalizeAccount(data.author), text, subreddit: data.subreddit.toLowerCase(), observedAt: Math.floor(data.created_utc! * 1000) });
      if (items.length > 20) throw new Error("reddit_intake_batch_limit");
    }
    items.sort((a, b) => a.observedAt - b.observedAt || a.externalId.localeCompare(b.externalId));
    return redditIngestionSchema.parse({ mode: "live", cursorCommitRequired: true, nextCursor: String(upper), items });
  }
  private async info(api: Awaited<ReturnType<RedditPublisher["session"]>>, id: string): Promise<RedditThing> {
    fullname.parse(id);
    const things = listingSchema.parse(await api(`/api/info?id=${encodeURIComponent(id)}`)).data.children;
    if (things.length !== 1 || things[0].data.name !== id) throw new Error("reddit_target_unavailable");
    return things[0];
  }
  private async assertSource(api: Awaited<ReturnType<RedditPublisher["session"]>>, request: PublishRequest) {
    const source = await this.info(api, request.targetId), data = source.data;
    const text = source.kind === "t1" ? data.body : data.selftext || data.title;
    if (!text || ["[deleted]", "[removed]"].includes(text) || data.author === "[deleted]" || data.locked || data.archived || data.removed_by_category) throw new Error("reddit_target_unavailable");
    if (!this.config.allowedSubreddits.some(subreddit => subreddit.toLowerCase() === data.subreddit.toLowerCase())) throw new Error("reddit_community_not_allowed");
    validateRedditTarget(new URL(data.permalink, "https://www.reddit.com").href, request.targetId);
    if (!request.sourceContextHash || sha256(text) !== request.sourceContextHash) throw new Error("source_context_changed");
    if (hasContactOptOut(text)) throw new Error("contact_opt_out");
    const account = normalizeAccount(request.accountId);
    if (!/^[a-z0-9_-]{3,20}$/.test(account)) throw new Error("account_mismatch");
    const directlyMentioned = new RegExp(`(?:^|[^A-Za-z0-9_])/?u/${account}(?![A-Za-z0-9_-])`, "i").test(text);
    if (!directlyMentioned && !(source.kind === "t1" && data.parent_id && normalizeAccount((await this.info(api, data.parent_id)).data.author) === account)) throw new Error("direct_contact_intent_missing");
  }
  private confirmed(request: PublishRequest, thing: RedditThing): PublicationResult {
    const data = thing.data;
    if (thing.kind !== "t1" || normalizeAccount(data.author) !== normalizeAccount(request.accountId) || data.parent_id !== request.targetId || data.body !== request.text) throw new Error("reddit_receipt_binding_mismatch");
    const url = new URL(data.permalink, "https://www.reddit.com").href;
    validateRedditTarget(url, data.name);
    return { status: "confirmed", mode: "live", providerReceipt: { id: data.name, url, accountId: request.accountId, targetId: request.targetId, textHash: request.textHash }, completedAt: Date.now() };
  }
  async publish(input: PublishRequest, authorizeAtDispatch: () => Promise<void>): Promise<PublicationResult> {
    const request = publishSchema.parse(input);
    let mayHaveSent = false;
    try {
      this.configured();
      if (request.platform !== "reddit" || request.mode !== "live") throw new Error("fixture_live_mismatch");
      validateRedditTarget(request.targetUrl, request.targetId);
      if (request.textHash !== sha256(request.text) || !request.text.trim() || Array.from(request.text).length > 10_000) throw new Error("invalid_exact_text");
      const api = await this.session();
      await this.assertAccount(api, request.accountId);
      await this.assertSource(api, request);
      // No network preflight remains between authoritative dispatch permission and the actual POST.
      await authorizeAtDispatch();
      mayHaveSent = true;
      const response = z.object({ json: z.object({ errors: z.array(z.unknown()), data: z.object({ things: z.array(thingSchema) }).optional() }) }).parse(await api("/api/comment", { api_type: "json", thing_id: request.targetId, text: request.text, return_rtjson: "false" }));
      if (response.json.errors.length || response.json.data?.things.length !== 1) throw new Error("reddit_send_not_confirmed");
      const receipt = response.json.data.things[0];
      this.confirmed(request, receipt);
      // Independently read the receipt from the provider before marking delivery confirmed.
      return this.confirmed(request, await this.info(api, receipt.data.name));
    } catch (error) {
      if (mayHaveSent) return { status: "unknown", mode: "live", reason: "post_may_have_completed_reconcile_required", retryable: false, completedAt: Date.now() };
      const reason = error instanceof Error && /^(access_pending|configuration_required:reddit\.[a-zA-Z]+|reconnect_required|reddit_scopes_required|account_mismatch|reddit_target_unavailable|reddit_community_not_allowed|source_context_changed|contact_opt_out|direct_contact_intent_missing|fixture_live_mismatch|invalid_exact_text|invalid_reddit_target)$/.test(error.message) ? error.message : "pre_send_check_failed";
      return { status: "definitely_not_sent", mode: "live", reason, retryable: false, completedAt: Date.now() };
    }
  }
  async reconcile(input: PublishRequest): Promise<PublicationResult> {
    const request = publishSchema.parse(input), unknown = (): PublicationResult => ({ status: "unknown", mode: "live", reason: "provider_receipt_or_recorded_human_investigation_required", retryable: false, completedAt: Date.now() });
    try {
      if (request.mode !== "live" || request.platform !== "reddit" || request.textHash !== sha256(request.text) || !request.publicationAttemptedAt || request.publicationAttemptedAt > Date.now()) return unknown();
      validateRedditTarget(request.targetUrl, request.targetId);
      const api = await this.session(); await this.assertAccount(api, request.accountId);
      const recent = listingSchema.parse(await api(`/user/${encodeURIComponent(normalizeAccount(request.accountId))}/comments?sort=new&limit=100`));
      const matches = recent.data.children.filter(thing => thing.kind === "t1" && thing.data.parent_id === request.targetId && thing.data.body === request.text && normalizeAccount(thing.data.author) === normalizeAccount(request.accountId) && typeof thing.data.created_utc === "number" && thing.data.created_utc * 1000 >= request.publicationAttemptedAt! - 5000 && thing.data.created_utc * 1000 <= request.publicationAttemptedAt! + 120_000);
      if (matches.length !== 1) return unknown();
      return this.confirmed(request, await this.info(api, matches[0].data.name));
    } catch { return unknown(); }
  }
}
