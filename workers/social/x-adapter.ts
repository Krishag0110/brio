import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { z } from "zod";
import twitterText from "twitter-text";
import { publishSchema, type PublicationResult, type PublisherAdapter, type PublishRequest } from "../shared/contracts";
import { sha256, type SessionState } from "../shared/security";
import { hasContactOptOut } from "../shared/contact-intent";

const navigationHosts = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const resourceHosts = new Set([...navigationHosts, "api.x.com", "api.twitter.com", "abs.twimg.com", "pbs.twimg.com", "video.twimg.com", "ton.twimg.com"]);
const normalizeAccount = (account: string) => account.replace(/^@/, "").toLowerCase();
export const validXText = (text: string): boolean => twitterText.parseTweet(text).valid;
/** Re-read the original post; a queued URL or literal consent flag is insufficient. */
export function validateFreshXSource(text: string, accountId: string, expectedHash?: string): void {
  const account = normalizeAccount(accountId);
  if (!expectedHash || sha256(text) !== expectedHash) throw new Error("source_context_changed");
  if (!/^[a-z0-9_]{1,15}$/.test(account)) throw new Error("account_mismatch");
  if (hasContactOptOut(text)) throw new Error("contact_opt_out");
  if (!new RegExp(`(?:^|[^A-Za-z0-9_])@${account}(?![A-Za-z0-9_])`, "i").test(text)) throw new Error("direct_contact_intent_missing");
}
export function validateXTarget(url: string, targetId: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !navigationHosts.has(parsed.hostname) || parsed.username || parsed.password || parsed.port || !/^\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(parsed.pathname) || parsed.pathname.split("/").at(-1) !== targetId) throw new Error("invalid_x_target");
  return parsed;
}

/** An isolated, bounded session. No tracing, persistent profile, challenge solving, or login retries. */
export class XBrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private timer?: NodeJS.Timeout;
  async open(storageState: SessionState): Promise<Page> {
    this.browser = await chromium.launch({ headless: true, chromiumSandbox: process.env.CHROMIUM_SANDBOX === "true" });
    this.context = await this.browser.newContext({ storageState, serviceWorkers: "block", acceptDownloads: false, permissions: [] });
    this.context.setDefaultTimeout(15_000);
    this.context.setDefaultNavigationTimeout(25_000);
    await this.context.route("**/*", async route => {
      try {
        const url = new URL(route.request().url());
        const approved = route.request().isNavigationRequest() ? navigationHosts : resourceHosts;
        if (url.protocol !== "https:" || !approved.has(url.hostname) || url.username || url.password || url.port) return route.abort("blockedbyclient");
        return route.continue();
      } catch { return route.abort("blockedbyclient"); }
    });
    this.timer = setTimeout(() => { void this.close(); }, 120_000);
    return this.context.newPage();
  }
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}

async function assertHealthy(page: Page): Promise<void> {
  if (/\/(?:i\/flow\/login|account\/access|login)(?:\/|\?|$)/.test(page.url())) throw new Error("reconnect_required");
  if (await page.locator('iframe[src*="captcha"], [data-testid="LoginForm_Login_Button"]').count()) throw new Error("reconnect_required");
  if (await page.getByText(/verify you are human|unusual activity|account is locked|rate limit exceeded|something went wrong.*try again/i).first().isVisible().catch(() => false)) throw new Error("reconnect_required");
}
async function currentAccount(page: Page): Promise<string> {
  await assertHealthy(page);
  const link = page.locator('[data-testid="AppTabBar_Profile_Link"]');
  await link.waitFor({ state: "visible" });
  const href = await link.getAttribute("href");
  if (!href || !/^\/[A-Za-z0-9_]{1,15}$/.test(href)) throw new Error("account_identity_unavailable");
  return normalizeAccount(href.slice(1));
}
export async function verifyXAccount(state: SessionState, expected: string): Promise<string> {
  const session = new XBrowserSession();
  try {
    const page = await session.open(state);
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
    const actual = await currentAccount(page);
    if (actual !== normalizeAccount(expected)) throw new Error("account_mismatch");
    return expected;
  } finally { await session.close(); }
}

const createTweetSchema = z.object({ data: z.object({ create_tweet: z.object({ tweet_results: z.object({ result: z.object({
  rest_id: z.string().regex(/^\d+$/), legacy: z.object({ full_text: z.string(), in_reply_to_status_id_str: z.string() }),
  core: z.object({ user_results: z.object({ result: z.object({ legacy: z.object({ screen_name: z.string() }) }) }) }),
}) }) }) }) });

export class XPublisher implements PublisherAdapter {
  constructor(private readonly storageState: SessionState, private readonly permissionApproved: boolean) {}
  async publish(input: PublishRequest, authorizeAtDispatch: () => Promise<void>): Promise<PublicationResult> {
    const request = publishSchema.parse(input), now = () => Date.now();
    const fail = (reason: string): PublicationResult => ({ status: "definitely_not_sent", mode: "live", reason, retryable: false, completedAt: now() });
    if (!this.permissionApproved) return fail("access_pending");
    if (request.mode !== "live" || request.platform !== "x") return fail("fixture_live_mismatch");
    if (!request.sourceContextHash) return fail("source_context_required");
    if (sha256(request.text) !== request.textHash || !validXText(request.text) || /https?:\/\//i.test(request.text)) return fail("invalid_exact_text");
    try { validateXTarget(request.targetUrl, request.targetId); } catch { return fail("invalid_x_target"); }
    const session = new XBrowserSession();
    let mayHaveSent = false;
    try {
      const page = await session.open(this.storageState);
      await page.goto(request.targetUrl, { waitUntil: "domcontentloaded" });
      if (await currentAccount(page) !== normalizeAccount(request.accountId)) return fail("account_mismatch");
      const article = page.locator('article[data-testid="tweet"]').filter({ has: page.locator(`a[href$="/status/${request.targetId}"]`) }).first();
      await article.waitFor({ state: "visible" });
      validateFreshXSource(await article.locator('[data-testid="tweetText"]').first().innerText(), request.accountId, request.sourceContextHash);
      await article.locator('[data-testid="reply"]').click();
      const composer = page.locator('[data-testid="tweetTextarea_0"]').last();
      await composer.fill(request.text);
      if ((await composer.innerText()) !== request.text) return fail("composer_text_mismatch");
      await assertHealthy(page);
      const button = page.locator('[data-testid="tweetButton"]').last();
      if (!await button.isEnabled()) return fail("publish_unavailable");
      validateFreshXSource(await article.locator('[data-testid="tweetText"]').first().innerText(), request.accountId, request.sourceContextHash);
      // This atomic Convex dispatch check consumes the ledger reservation immediately before click.
      await authorizeAtDispatch();
      const receipt = page.waitForResponse(response => new URL(response.url()).hostname === "x.com" && /\/CreateTweet$/.test(new URL(response.url()).pathname) && response.request().method() === "POST", { timeout: 25_000 }).catch(() => undefined);
      mayHaveSent = true;
      await button.click();
      const response = await receipt;
      if (!response) throw new Error("receipt_unverified");
      const result = createTweetSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok() || !result.success) throw new Error("receipt_unverified");
      const tweet = result.data.data.create_tweet.tweet_results.result;
      if (tweet.legacy.full_text !== request.text || tweet.legacy.in_reply_to_status_id_str !== request.targetId || normalizeAccount(tweet.core.user_results.result.legacy.screen_name) !== normalizeAccount(request.accountId)) throw new Error("receipt_binding_mismatch");
      return { status: "confirmed", mode: "live", providerReceipt: { id: tweet.rest_id, url: `https://x.com/${normalizeAccount(request.accountId)}/status/${tweet.rest_id}`, accountId: request.accountId, targetId: request.targetId, textHash: request.textHash }, completedAt: now() };
    } catch (error) {
      if (mayHaveSent) return { status: "unknown", mode: "live", reason: "post_may_have_completed_reconcile_required", retryable: false, completedAt: now() };
      // Do not propagate browser error text; it may contain customer content or session fields.
      const reason = error instanceof Error && ["reconnect_required", "account_mismatch", "source_context_changed", "contact_opt_out", "direct_contact_intent_missing"].includes(error.message) ? error.message : "pre_send_check_failed";
      return fail(reason);
    } finally { await session.close(); }
  }
  async reconcile(input: PublishRequest): Promise<PublicationResult> {
    const request = publishSchema.parse(input);
    if (request.mode !== "live" || request.platform !== "x" || !this.permissionApproved) return { status: "unknown", mode: "live", reason: "reconciliation_unavailable", retryable: false, completedAt: Date.now() };
    // A missing item in an incomplete browser timeline never establishes non-publication.
    // A trusted receipt verification/human investigation may resolve this in the controller.
    return { status: "unknown", mode: "live", reason: "provider_receipt_or_recorded_human_investigation_required", retryable: false, completedAt: Date.now() };
  }
}

export async function readXMentions(state: SessionState, accountId: string, permissionApproved: boolean, cursor?: string) {
  if (!permissionApproved) throw new Error("access_pending");
  const session = new XBrowserSession();
  try {
    const page = await session.open(state);
    await page.goto("https://x.com/notifications/mentions", { waitUntil: "domcontentloaded" });
    if (await currentAccount(page) !== normalizeAccount(accountId)) throw new Error("account_mismatch");
    const articles = page.locator('article[data-testid="tweet"]');
    const items: { platform: "x"; sourceMode: "live"; externalId: string; originalUrl: string; author: string; text: string; observedAt: number }[] = [];
    for (let index = 0; index < Math.min(await articles.count(), 20); index++) {
      const article = articles.nth(index), href = await article.locator('a[href*="/status/"]').filter({ has: page.locator("time") }).first().getAttribute("href");
      const match = href?.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
      if (!match || (cursor && BigInt(match[2]) <= BigInt(cursor))) continue;
      const text = await article.locator('[data-testid="tweetText"]').innerText().catch(() => "");
      if (!text) continue;
      items.push({ platform: "x", sourceMode: "live", externalId: match[2], originalUrl: `https://x.com${href}`, author: match[1], text, observedAt: Date.now() });
    }
    const nextCursor = items.reduce((current, item) => !current || BigInt(item.externalId) > BigInt(current) ? item.externalId : current, cursor ?? "");
    return { items, nextCursor, cursorCommitRequired: true, mode: "live" as const };
  } finally { await session.close(); }
}
