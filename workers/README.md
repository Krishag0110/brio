# brio execution services

The Convex controller owns approvals, budgets, job claims, retries, encrypted-session storage, publication records, and release locks. These processes execute bounded effects. Missing credentials produce `configuration_required`; fixture receipts never represent live provider success.

## Local verification

The weather app is a separate Git repository at sibling `../hackathon-weather`; it is never embedded in the controller. Use Bun 1.4.2 and run `bun install --frozen-lockfile --ignore-scripts` in both repositories first. Set `WEATHER_TARGET_PATH` when the target checkout is elsewhere. From the controller repository:

```sh
bun run --no-env-file vitest run tests/execution tests/integration/providers.test.ts tests/integration/providers-release-control.test.ts tests/integration/providers-preflight.test.ts
bun run --cwd ../hackathon-weather build
bun run --cwd ../hackathon-weather dev
```

The browser test executes the owned, seeded source in Chromium and reproduces `20°C → 20°F`. Its test passes because it proves the defect; the generated `tests/execution/artifacts/protected-baseline-browser-evidence.json` correctly reports failed weather QA. It checks all four protected fixtures, repeated toggles, reload, and provenance. The repository deliberately retains the defect until an actual approved coding run generates a verified patch.

Controller CI checks out the controller and private `Aarush-Dubey/hackathon-weather` as sibling directories. Configure `WEATHER_REPO_READ_SSH_KEY` with the weather repository’s read-only SSH deploy key (preferred), or `WEATHER_REPO_READ_TOKEN` with read-only contents access and `WEATHER_BASELINE_SHA` with the reviewed immutable seeded-baseline commit. Missing settings fail explicitly; CI never substitutes an embedded target or a passing simulator for the browser baseline. The fixed baseline SHA remains the reproduction fixture after a generated fix changes the weather default branch. Candidate checks continue to run in the restricted coding workflow against the exact separately approved candidate source.

On the current development host, Docker socket access is denied. The real generated-candidate sandbox has therefore **not** been executed here. No candidate fix, provider receipt, PR, deployment, or account verification is claimed from fixture tests.

## Social worker

Launch `node --import tsx workers/social/main.ts`, or deploy `workers/social/Dockerfile` to Cloud Run using [the GCP walkthrough](../docs/SETUP-GCP.md). The container has no engineering, GitHub, Vercel, or model keys. The experimental X browser adapter requires `X_PLATFORM_PERMISSION_APPROVED=true`; the default is blocked. It stops on account challenges and never solves them or retries login.

Required environment:

| Name | Purpose |
| --- | --- |
| `CONTROL_APP_ORIGIN` | Exact UI origin accepted for imports |
| `CONVEX_SITE_URL` | Controller's HTTPS HTTP-action origin |
| `SOCIAL_GRANT_SECRET` | At least 32 characters; signs short-lived grants |
| `SOCIAL_CALLBACK_SECRET` | Separate 32-character callback signing secret |
| `SESSION_ENCRYPTION_KEY` | Base64-encoded 32-byte AES key |
| `SESSION_KEY_VERSION` | Current encryption key identifier, default `v1` |
| `SESSION_PREVIOUS_KEYS_JSON` | Optional version-to-key map during rotation |
| `X_PLATFORM_PERMISSION_APPROVED` | Explicit platform-access gate, default `false` |

`GET /health` is read-only. `POST /v1/jobs` accepts `{jobId,attemptId}` with `Authorization: Bearer <grant>` and returns acceptance only after a durable controller claim. `POST /v1/sessions/import` accepts `{grant,storageState}`. Import state is normalized to the supported `auth_token` and `ct0` cookies; arbitrary storage or cookies are rejected. The worker encrypts the state with AES-256-GCM and account/version-bound AAD, quarantines it, verifies the active account, then requests atomic activation. Failed imports never replace the active session. Do not enable body logging or browser traces.

Grant and callback formats are defined in `shared/contracts.ts` and `shared/security.ts`. Controller calls use `/worker/claim`, `/worker/heartbeat`, `/worker/result`, `/worker/authorize-send`, and `/worker/session/{quarantine,activate,reject}`. Callbacks include `x-worker-kind: social`, `x-worker-timestamp` and `x-worker-signature`; the signature is hex HMAC-SHA256 of `timestamp + "." + rawBody`.

Publishing requires the exact account, target, approved text hash and authority references. Live X also requires `sourceContextHash`: the original post is re-read, must match exactly, mention the configured account directly, and contain no detected opt-out. The controller rechecks authority immediately before the browser click. Outcomes are `confirmed`, `definitely_not_sent`, or `unknown`; an uncertain click is never automatically retried. Browser timeline absence does not prove non-publication. The simulator uses the same outcomes with visibly marked fixture receipts.

X uses the official `twitter-text` weighted validator, including emoji sequences and CJK characters, without truncating approved content. See [X character counting](https://docs.x.com/fundamentals/counting-characters).

The optional Reddit connector uses the [official OAuth flow](https://github.com/reddit-archive/reddit/wiki/OAuth2) and [Reddit API](https://www.reddit.com/dev/api/). Configure worker-only `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REDIRECT_URI`, `REDDIT_USER_AGENT`, and `REDDIT_ALLOWED_SUBREDDITS` (one to five permitted communities). `REDDIT_API_APPROVED` must remain false on worker and controller until actual access approval is established. See [Reddit setup](../docs/SETUP-REDDIT.md); live Reddit access is still unverified.

`POST /v1/oauth/reddit/start` accepts a form-encoded administrator grant only from the exact UI Origin. It sets a Secure, HttpOnly, host-only, SameSite=Lax proof cookie and begins permanent `identity read submit` authorization. `GET /v1/oauth/reddit/callback` requires matching one-use controller state and browser proof, checks expiry/current account/connection version, exchanges the code, refreshes the resulting credential, and verifies `/api/v1/me`. It encrypts the refresh token with a Reddit-purpose/account/version-bound AES-GCM envelope before activation. Only ciphertext is retained in private Convex `redditCredentials`; the worker key and plaintext never enter the UI or controller. No process-wide `REDDIT_REFRESH_TOKEN` overrides this binding. HMAC-authenticated callbacks use `/worker/reddit/{start,claim,activate,fail}`. Never enable body logging or traces for these routes; redact OAuth callback query strings from infrastructure logs where possible.

Verified, unpaused Reddit connections participate in the existing five-minute schedule only when `FDE_SOCIAL_POLLING_ENABLED=true`. Intake begins at activation and reads bounded recent post/comment listings in permitted communities. It returns direct mentions or replies to the configured account, at most 20 per run. Parent reads are batched. Rate limits, listing gaps, and larger matching backlogs stop intake without advancing its cursor. The controller validates community/source/version bindings and persists signals and the cursor atomically. Reset/reconfiguration/disable removes private credentials and pending authorization state.

Publishing still requires approved exact text, the current account, fresh source hash, a permitted community, and direct-contact intent. Opt-outs, archived/locked/removed targets, and exact parent/text receipts are checked. Confirmation independently reads the created comment. Reconciliation accepts only a unique exact account/parent/text receipt in the bounded original-attempt time window; `publicationAttemptedAt` comes from the controller. Missing or ambiguous evidence remains unknown and never authorizes another POST. Connection readiness does not replace reply approval or a real controlled live validation.

## Protected weather verifier

Deploy `workers/engineering/Verifier.Dockerfile` to Cloud Run using [the GCP walkthrough](../docs/SETUP-GCP.md), or run `node --import tsx workers/engineering/weather-main.ts`. This service only receives `ENGINEERING_VERIFY_SECRET`, `WEATHER_ALLOWED_HOSTS`, optional `VERCEL_AUTOMATION_BYPASS_SECRET`, and `WEATHER_ACCEPT_SIGNED_DEPLOYMENT_HOSTS`.

`POST /v1/weather/verify` accepts `{requestId,mode,url,expectedProvenance?,approvedHost?}` where mode is `baseline`, `candidate`, or `live`. Sign the exact body with the engineering verification secret using the timestamp/signature headers above. Candidate and live requests require trusted expected provenance. The controller validates the Vercel project/deployment before signing an ephemeral exact deployment host. This feature requires `WEATHER_ACCEPT_SIGNED_DEPLOYMENT_HOSTS=true`; no wildcard Vercel host is trusted. Unauthenticated requests and private destinations are rejected. Baseline requests without trusted expectations explicitly return observed-only identity and failed verification status.

The service runs one browser verification at a time with a 120-second browser limit. Results include the complete 34-check evidence, provenance, timestamps, and bounded PNG artifacts. Convex persists the PNGs before accepting evidence. Browser requests stay on the verified origin, including protection-bypass headers.

## Restricted coding workflow

Build and review the engineering Docker image using `workers/engineering/Dockerfile`. All worker images copy the pinned Bun 1.4.2 binary and install frozen `bun.lock` dependencies with lifecycle scripts disabled. Node remains available for the trusted Playwright and Convex-compatible execution harness. The coding image's dedicated reviewed dependencies are pinned in `workers/engineering/runtime/package.json` and `bun.lock`, independent of the controller app; the weather target must use matching production dependency versions. The sandbox maps the separate target repository root to `/candidate` and receives only approved app build inputs, including the committed weather `bun.lock`. Then publish it to an approved registry and configure `CODING_SANDBOX_IMAGE` as an immutable `registry/image@sha256:...` reference. Pull it before execution. Do not substitute ordinary host subprocess execution for a missing sandbox.

The workflow `.github/workflows/restricted-coding.yml` runs from the protected controller default branch. Configure the `engineering-controller` and `engineering-pr-writer` environments with narrowly scoped tokens:

| Location | Configuration |
| --- | --- |
| Controller variables | `CONVEX_SITE_URL`, `WEATHER_TARGET_REPOSITORY`, `CODING_SANDBOX_IMAGE` |
| Controller secrets | `ENGINEERING_GRANT_SECRET`, `ENGINEERING_CALLBACK_SECRET`, `WEATHER_REPO_READ_SSH_KEY` (or `WEATHER_REPO_READ_TOKEN`) |
| PR writer variables | `CONVEX_SITE_URL`, `WEATHER_DEFAULT_BRANCH`, `WEATHER_CHECKS_APP_ID` |
| PR writer secrets | `ENGINEERING_CALLBACK_SECRET`, `WEATHER_PR_TOKEN`, `WEATHER_CHECKS_APP_PRIVATE_KEY` (or supported `WEATHER_CHECKS_TOKEN` fallback) |

GitHub custom secrets use the `WEATHER_` prefix; the workflow maps `WEATHER_PR_TOKEN` to runtime `GITHUB_PR_TOKEN` and the check token to runtime `GITHUB_CHECKS_TOKEN`. The preferred check credential is a GitHub App installed only on `hackathon-weather` with Checks write permission. Configure its App ID and private key in the writer environment; `actions/create-github-app-token@v2` creates a short-lived, repository-scoped token and revokes it after the job. The App must be created and installed through the account’s GitHub settings. A permanently stored installation token is not the primary setup. See the [official action inputs](https://github.com/actions/create-github-app-token/tree/v2).

The signed Build binds job/attempt, current authority, repository, base SHA, trusted controller SHA, scope hash, acceptance criteria and expiry. The runner rechecks authority before each model call, verification and PR write. Model requests go through `/worker/model-proposal` and accept only budget-reserved `gpt-5-mini` results. There are at most three proposal attempts. The worker never receives a model API key.

Only `lib/temperature.ts` may change. Preimage hashes, paths, file modes, symlinks and generated content are checked before applying the patch. Docker runs without network, host home, credentials or Docker socket, with bounded CPU/memory/processes. Candidate processes run as UID 65532. A separate trusted supervisor owns protected tests and private evidence. A failed/missing runtime blocks before any model proposal. The trusted PR writer authenticates the artifact and writes only verified source; it creates the PR and attaches the exact-head protected check. `verified_patch` is intermediate. Only the later `pr_created` callback supplies the actual head, tree and PR identity for staging.

## Provider and release configuration

`src/integrations/providers.ts` contains real HTTP adapters for Slack, Linear, GitHub and Vercel with injectable HTTP fixtures. `src/integrations/engineering.ts` coordinates the durable engineering tasks through `convex/releaseControl.ts`.

Engineering controller configuration includes `FDE_WEATHER_REPOSITORY`, `GITHUB_DISPATCH_TOKEN` (or `GITHUB_TOKEN`), `GITHUB_READ_TOKEN`, `GITHUB_RELEASE_TOKEN`, `GITHUB_CONTROLLER_REPOSITORY`, `GITHUB_CONTROLLER_BRANCH`, `GITHUB_DEFAULT_BRANCH`, `ENGINEERING_GRANT_SECRET`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME`, optional `VERCEL_TEAM_ID` / `VERCEL_RELEASE_TOKEN`, `WEATHER_PRODUCTION_DOMAIN`, `ENGINEERING_WORKER_URL`, and `ENGINEERING_VERIFY_SECRET`. Set `GITHUB_REQUIRED_CHECKS` to the protected exact-head checks; the default is `Protected weather`. Configure public `WEATHER_TRUSTED_TEST_REVISION` and `WEATHER_BUILD_CONFIG_REVISION` consistently with the reviewed protected implementation.

Use a separate weather Vercel project with repository root directory `.`. Staging explicitly uses `bunx bun@1.4.2 install --frozen-lockfile --ignore-scripts` and `bunx bun@1.4.2 run build`, following [Vercel's Bun version pinning guidance](https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds). Vercel staging requires verifiable automatic production-domain assignment disabled and an environment containing only the public weather provenance variables. The adapter blocks if it cannot verify these conditions. The staged deployment is created from the exact committed weather files with production build settings and no production alias. READY status and browser QA are checked later; deployment creation never means verification passed.

The release path requires a current candidate Go binding, exact base/head/tree/checks, staged deployment provenance, and the single durable repository/project lock. It records merge, promotion intent, previous production and verification substages. A lost merge/promotion response is reconciled against provider state before continuing. The promoted deployment is exactly the verified deployment; no second build occurs. Full live browser checks and fresh alias identity are required before completion. Failed live verification pauses the workspace. Rollback requires a current recorded engineer/admin authorization bound to the saved prior deployment and verifies the resulting production identity.

Live service credentials and actual integrations remain untested until explicitly configured. Fixture HTTP tests validate request bindings and failure behavior without sending external messages or modifying provider resources.
