# Optional Reddit setup

The connector now includes OAuth authorization/callback, verified account readiness, bounded community intake, publishing, and independent reply receipts. **Live Reddit access has not been verified.** The user supplied `drizzle-123` as the intended Reddit account; no approved community list or API approval has been established. Fresh normal-browser profile checks still reached Reddit's network-security block before app settings. Keep `REDDIT_API_APPROVED=false` until actual approval is established.

## Obtain approved access

Read the current [Reddit Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki) and [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy). Reddit requires explicit API approval. A working login or OAuth app is not evidence of that approval. Follow the appropriate developer/Devvit or commercial-use request path and the approved account/community scope. No access request was submitted by this setup task.

After approval, use [Reddit app preferences](https://www.reddit.com/prefs/apps) to register the permitted app type. A confidential web app matches brio's server-side code flow, subject to Reddit's approval:

| Setting | Value |
| --- | --- |
| Name | `brio` |
| About URL | `https://mend-hackathon.vercel.app` |
| Redirect URI | `https://mend-social-worker-ajmx2yigqq-uc.a.run.app/v1/oauth/reddit/callback` |
| Authorization | `response_type=code`, `duration=permanent`, scopes `identity read submit` |

The worker owns the callback. Deploy the updated worker, Convex functions/schema, and Next.js application together before using the redirect. Reddit and the worker must use the exact same redirect URI. The [OAuth protocol](https://github.com/reddit-archive/reddit/wiki/OAuth2) is linked by Reddit's current API wiki.

## Configure the worker

Provide these values only to the social worker. Client secrets and encryption keys belong in its secret settings, never public frontend variables, source control, case evidence, or model prompts.

| Variable | Value |
| --- | --- |
| `REDDIT_CLIENT_ID` | Approved OAuth application's client identifier. |
| `REDDIT_CLIENT_SECRET` | Approved OAuth application's secret. |
| `REDDIT_REDIRECT_URI` | Exact worker callback URL above. |
| `REDDIT_USER_AGENT` | For the intended account: `web:mend-hackathon:v0.1.0 (by /u/drizzle-123)`. Verify the account before using this identity. |
| `REDDIT_ALLOWED_SUBREDDITS` | One to five explicitly permitted subreddit names, comma separated, without `r/`. No default community is assumed. |

The existing `SOCIAL_GRANT_SECRET`, `SOCIAL_CALLBACK_SECRET`, `CONTROL_APP_ORIGIN`, `SESSION_ENCRYPTION_KEY`, and key-version settings are also required. `CONTROL_APP_ORIGIN` must equal `https://mend-hackathon.vercel.app` for the hosted UI.

Set `REDDIT_API_APPROVED=true` on **both Convex and the worker only after approved access is established**. This permits setup and eligible account operations; it does not approve a public response. Keep `FDE_SOCIAL_POLLING_ENABLED=false` while completing the connection and controlled validation.

`REDDIT_REFRESH_TOKEN` is no longer a process-wide runtime setting. The callback obtains the permanent token automatically, verifies that it can refresh and identify the expected account, then encrypts it using the worker's AES-256-GCM key. Private Convex `redditCredentials` records contain only ciphertext and non-secret account/version/community metadata. The key and plaintext token stay in the worker. No additional Secret Manager write permission is required.

## Connect and verify the account

1. Open brio **Connections** as an administrator. Save the actual Reddit account identifier, currently intended to be `drizzle-123`.
2. Select **Authorize Reddit account**. The UI requests a short-lived grant and submits it through a top-level form POST to the worker. The worker requires the exact brio Origin and sets a Secure, HttpOnly, host-only, SameSite=Lax proof cookie before redirecting to Reddit.
3. Complete legitimate Reddit login/challenges and authorization in that browser. The callback requires one-use state and its browser proof, checks expiry and the current connection version, exchanges the code, then verifies scopes and the actual account with `/api/v1/me`.
4. Return to Connections. Readiness appears only after the verified account matches the configured account and the controller atomically accepts the current encrypted credential. Denial, replay, missing proof, missing scopes, another account, expired state, or a reset/disabled connection cannot activate it.

Starting another OAuth attempt invalidates prior state and credentials. Resetting, reconfiguring, or disabling the connection removes its private credential and pending OAuth state. Key rotation can retain old worker key versions through `SESSION_PREVIOUS_KEYS_JSON` while credentials are re-encrypted by reconnecting.

No OAuth token or code is returned to Next.js. Keep body logging and browser/network traces disabled for setup endpoints; authorization codes arrive at the standard worker callback URL and should be redacted from infrastructure request logs where supported.

## Automatic intake and replies

After approved access and account verification, explicitly enable `FDE_SOCIAL_POLLING_ENABLED=true` in Convex if automatic intake is wanted. Maintenance polls each ready, unpaused account at most once every five minutes. The worker reads recent posts and comments only in configured communities, verifies the account each run, and selects direct mentions or comments replying to that account. It ignores detected opt-outs, its own content, removed/deleted content, and locked or archived targets.

The cursor starts at account activation, so there is no historical import. Each run uses at most two 100-item listings per community and batches parent lookups; only up to 20 matching interactions can be committed. A pagination gap, larger matching backlog, malformed response, or rate limit stops intake without advancing the cursor. The controller stores signals and advances the cursor atomically; stale or replayed results cannot duplicate intake or affect a replacement connection. Before reconnecting after a backlog, use manual intake for any missed original interactions you still want to handle; reconnection starts a new cursor.

The worker does not retry a rate-limited request. Intake enters a connection-review state; rate-limit response headers can stop a run before another read. These bounds suit a small approved demonstration community.

Public replies retain the existing exact-text approval and dispatch checks. The worker re-reads the original target, enforces community and direct-contact intent, and verifies the actual reply through an independent provider read. Unknown outcomes require reconciliation rather than another POST. A separately authorized real controlled reply and receipt remain necessary before claiming live publication is proven.

## Current verification

Focused automated tests cover OAuth replay/expiry/browser proof, account/scope mismatches, encryption/version binding, approval gates, community/cursor validation, and existing publication receipts. The new panel and disabled demo behavior were checked in the running Next.js app. Mocked provider responses do not establish real Reddit approval, login, ingestion, or publication.

Manual original-URL intake and tracked manual publication remain available while external access is pending. Preserve the exact approved text and record the actual posted receipt; opening a composer alone is not proof of publication.

Return to [the main setup guide](SETUP-GUIDE.md).
