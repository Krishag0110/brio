import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { redditCommunitiesSchema } from "../shared/reddit-contracts";
import { sha256, verifyGrant } from "../shared/security";
import type { WorkerConfig } from "./service";
import type { RedditOAuthBridge } from "./bridge";
import { RedditPublisher } from "./reddit-adapter";
import { encryptRedditCredential } from "./reddit-credentials";

const callbackPath = "/v1/oauth/reddit/callback";
const cookieName = (state: string) => `__Host-mend-reddit-${state}`;
const cookie = (state: string, value: string, maxAge: number) => `${cookieName(state)}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
function settings(config: WorkerConfig) {
  const reddit = config.reddit;
  if (!reddit?.permissionApproved) throw new Error("reddit_access_pending");
  if (!reddit.clientId || !reddit.clientSecret || !reddit.userAgent || !reddit.redirectUri) throw new Error("reddit_configuration_required");
  const redirect = new URL(reddit.redirectUri);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.pathname !== callbackPath || redirect.search || redirect.hash) throw new Error("reddit_redirect_invalid");
  const allowedSubreddits = redditCommunitiesSchema.parse(reddit.allowedSubreddits);
  return { ...reddit, clientId: reddit.clientId, clientSecret: reddit.clientSecret, userAgent: reddit.userAgent, redirectUri: redirect.href, allowedSubreddits };
}
function redirect(response: ServerResponse, location: string) {
  response.writeHead(303, { location, "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" }); response.end();
}
async function form(request: IncomingMessage) {
  if (!(request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) throw new Error("form_required");
  let body = "";
  for await (const chunk of request) { body += String(chunk); if (Buffer.byteLength(body) > 12_000) throw new Error("payload_too_large"); }
  const values = new URLSearchParams(body);
  if (values.getAll("grant").length !== 1 || [...values.keys()].some(key => key !== "grant")) throw new Error("grant_required");
  return values.get("grant")!;
}

/** Top-level form navigation keeps the OAuth proof in a host-only cookie, not third-party storage. */
export async function handleRedditOAuth(request: IncomingMessage, response: ServerResponse, config: WorkerConfig, bridge: RedditOAuthBridge | undefined, transport: typeof fetch = fetch): Promise<boolean> {
  const url = new URL(request.url ?? "/", "https://worker.invalid");
  if (!["/v1/oauth/reddit/start", callbackPath].includes(url.pathname)) return false;
  response.setHeader("cache-control", "no-store"); response.setHeader("referrer-policy", "no-referrer");
  let claimedState: string | undefined;
  try {
    const reddit = settings(config);
    if (!bridge) throw new Error("reddit_configuration_required");
    if (url.pathname === "/v1/oauth/reddit/start") {
      if (request.method !== "POST" || request.headers.origin !== config.allowedOrigin || url.search) throw new Error("origin_or_method_rejected");
      const grant = verifyGrant(await form(request), config.grantSecret);
      if (grant.operation !== "reddit_oauth" || !z.string().uuid().safeParse(grant.jti).success) throw new Error("invalid_grant");
      const proof = randomBytes(32).toString("base64url");
      await bridge.start(grant, sha256(proof));
      response.setHeader("set-cookie", cookie(grant.jti, proof, Math.max(1, Math.floor((grant.exp - Date.now()) / 1000))));
      const authorize = new URL("https://www.reddit.com/api/v1/authorize");
      authorize.search = new URLSearchParams({ client_id: reddit.clientId, response_type: "code", state: grant.jti, redirect_uri: reddit.redirectUri, duration: "permanent", scope: "identity read submit" }).toString();
      redirect(response, authorize.href); return true;
    }
    if (request.method !== "GET" || url.searchParams.getAll("state").length !== 1) throw new Error("reddit_state_invalid");
    const state = z.string().uuid().parse(url.searchParams.get("state"));
    const values = (request.headers.cookie ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(cookieName(state) + "="));
    response.setHeader("set-cookie", cookie(state, "", 0));
    if (values.length !== 1) throw new Error("reddit_browser_proof_required");
    const proof = values[0].slice(cookieName(state).length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new Error("reddit_browser_proof_required");
    const grant = await bridge.claim(state, sha256(proof)); claimedState = state;
    if (grant.jti !== state || grant.operation !== "reddit_oauth" || grant.exp <= Date.now() || grant.exp > Date.now() + 300_000) throw new Error("reddit_state_invalid");
    if (url.searchParams.has("error") || url.searchParams.getAll("code").length !== 1) throw new Error("reddit_authorization_denied");
    const code = z.string().min(1).max(4096).parse(url.searchParams.get("code"));
    const reply = await transport("https://www.reddit.com/api/v1/access_token", {
      method: "POST", headers: { authorization: `Basic ${Buffer.from(`${reddit.clientId}:${reddit.clientSecret}`).toString("base64")}`, "user-agent": reddit.userAgent, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: reddit.redirectUri }).toString(), signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!reply.ok) throw new Error("reddit_token_exchange_failed");
    const token = z.object({ refresh_token: z.string().min(1).max(4096), scope: z.string(), token_type: z.string() }).parse(await reply.json());
    if (token.token_type.toLowerCase() !== "bearer" || !["identity", "read", "submit"].every(scope => token.scope.split(" ").includes(scope) || token.scope === "*")) throw new Error("reddit_scopes_required");
    // Prove that the permanent credential itself can refresh and identify the exact account.
    const verifiedAccountId = await new RedditPublisher({ ...reddit, refreshToken: token.refresh_token }, transport).verifyAccount(grant.accountId);
    const encrypted = encryptRedditCredential({ refreshToken: token.refresh_token, clientId: reddit.clientId, allowedSubreddits: reddit.allowedSubreddits }, grant, config.encryptionKeys[config.currentKeyVersion], config.currentKeyVersion);
    await bridge.activate(grant, verifiedAccountId, encrypted, reddit.allowedSubreddits);
    redirect(response, new URL("/connections?reddit=connected", config.allowedOrigin).href); return true;
  } catch {
    if (claimedState) await bridge?.fail(claimedState).catch(() => {});
    // Provider bodies, codes, cookies, access tokens, and refresh tokens never reach logs or responses.
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    response.end("Reddit connection was not completed. Return to brio Connections, check approved API access and configuration, and start a new authorization attempt."); return true;
  }
}
