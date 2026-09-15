# Environment setup

The application has separate execution environments: the Next.js control app, the Convex deployment, the social browser worker, the engineering workflow jobs, and the protected browser-verification worker. A value in local `.env.local` does **not** automatically exist in any other environment.

The current local workspace contains an anonymous local Convex configuration in `.env.local`. This is development state, not a hosted deployment or evidence of a cloud account. Its localhost function/site URLs cannot serve callbacks from remote Slack, a hosted worker, or GitHub Actions.

## Separate repositories

The control app, Convex functions, workers, workflow definitions, and trusted verification code live in `/home/big-daddy/Desktop/hackathon`. The weather target is an independent Git repository at `/home/big-daddy/Desktop/hackathon-weather`; its Next.js application and package manifest are at that repository's root. Install and run each repository's dependencies from its own directory. Deploy the weather repository to its own Vercel project with the application root set to the repository root, not a `weather-app` subdirectory.

For live configuration, use the actual owned weather `owner/repository` as `FDE_WEATHER_REPOSITORY` and its reviewed baseline commit as `FDE_BASE_SHA`. Set `GITHUB_CONTROLLER_REPOSITORY` to the separate trusted controller `owner/repository` and `GITHUB_CONTROLLER_SHA` to its reviewed immutable revision. In the protected Actions environment, `WEATHER_TARGET_REPOSITORY` must match the weather target. Never substitute the controller SHA for the weather baseline. The default candidate change scope is only `lib/temperature.ts` in the target repository; credentials and trusted checks remain with the controller.

## Local demo

`bun run dev:demo` sets `FDE_DEMO_MODE=true` and binds Next.js to loopback. Its API rejects non-loopback and cross-origin access. Demo state lives in `.data/demo-state.json`; `FDE_DEMO_DATA_PATH` can select another isolated file. Browser tests use `.data/browser-tests.json` and reset only that test file.

Demo mode uses labeled local identities without a login and performs fixture work only. It does not accept real session imports or perform provider side effects. Do not expose the demo server as a public application.

## Hosted demo workspace

The existing hosted site uses `FDE_HOSTED_DEMO=true` on **Vercel only**. Keep `FDE_DEMO_MODE=false` and `FDE_LOCAL_ACCESS=false` there: the normal workspace access code and server service secret remain required. `NEXT_PUBLIC_CONVEX_URL` points to production `resilient-perch-131`.

Demo data lives in Convex `demoControlStates`, separately from live `controlStates`. The authenticated `demoControl:seed` mutation imported the existing 39-case/168-report local dataset once; calling seed again returns the saved workspace without replacement. Queries and commands use `demoControl:getSnapshot` and `demoControl:dispatch`; only internal demo timers advance playback. Native Convex subscriptions relay updates to browsers. No real provider jobs are dispatched by this namespace.

To show live integration state again, set Vercel **Production → Environment Variables → FDE_HOSTED_DEMO** to `false` and redeploy the same source. This preserves both datasets. Do not set the hosted flag in the local root `.env`, or set the loopback demo flag on Vercel. Keep service secrets private and unchanged. Changing modes does not enable social polling or verify a real repair.

## Next.js control app

Next.js reads `.env` from the repository root; the current `.env.local` intentionally contains no overrides. Existing process variables take precedence. The browser calls only same-origin Next.js APIs; the server forwards authorized requests to Convex. Never put the service secret or access code in public variables.

| Variable                            | Purpose                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `CONTROL_SERVICE_SECRET`          | Random server-only secret of at least 32 characters, identical on Next.js and Convex. |
| `CONTROL_ACCESS_PASSWORD`         | Shared hosted-workspace access code; keep private. Required on hosted deployments. |
| `FDE_HOSTED_DEMO`               | `true` selects the isolated persistent Convex demo workspace; Vercel server setting only. Requires normal hosted access. |
| `FDE_LOCAL_ACCESS`                | `true` permits direct access only when the request Host is loopback. Never use it as a hosted access grant. |
| `NEXT_PUBLIC_CONVEX_URL`           | Convex function endpoint used by the Next.js server; the URL itself grants no access. |
| `CONTROL_APP_ORIGIN`                | Exact control app origin, including the local port if applicable. Must match the session worker's allowed origin.        |
| `SOCIAL_WORKER_URL`                 | Hosted HTTPS social-worker origin used by the session-import API.                                                        |
| `FDE_DEMO_MODE`                     | `true` only for the loopback fixture demo. Leave unset or false for live mode.                                           |
| `FDE_DEMO_DATA_PATH`                | Optional local-demo state path; unused for live Convex state.                                                            |

The Convex CLI also manages `CONVEX_DEPLOYMENT` and may write `NEXT_PUBLIC_CONVEX_SITE_URL` into `.env.local`. The **function endpoint** and the **HTTP-action site origin** are distinct. Remote workers use their separately configured `CONVEX_SITE_URL`; do not substitute the function endpoint.

Do not copy all backend credentials into Next.js for convenience. Model and provider actions execute in Convex; their credentials belong there. A preliminary local readiness screen can show a variable as missing even when it is configured elsewhere. The authenticated Convex snapshot is the relevant backend view.

## Hackathon access and Slack identities

There is no external sign-in provider, user provisioning, or identity-provider setup. The local launcher explicitly enables loopback access. On a hosted control app, configure `CONTROL_ACCESS_PASSWORD` and a random `CONTROL_SERVICE_SECRET` of at least 32 characters. The `/access` form submits the code to `/api/access`; a successful server check sets an HMAC-signed, HttpOnly cookie. Pages and APIs independently enforce access. The cookie and service key are never accepted as Slack decisions.

Copy only `CONTROL_SERVICE_SECRET` into the Convex deployment's secret settings. Every public control query, mutation, paid preview, import-grant action, and manual-receipt action validates this key; it is passed from the Next.js server, never from browser JavaScript. Valid workspace access uses one **Hackathon operator** actor with engineer, marketer, and admin controls. This is deliberately shared hackathon access and does not provide individual operator attribution.

Set Convex `SLACK_TEAM_ID` and comma-separated `SLACK_ENGINEER_USER_IDS` / `SLACK_MARKETER_USER_IDS` to exact authorized Slack IDs. `SLACK_ADMIN_USER_IDS` is optional. Build requires an authorized engineer's Slack decision; Go, exact reply, and persona activation require the corresponding marketer authority. Display names and shared workspace access do not grant Slack roles. Manage the allowlists through deployment configuration; the app shows guidance rather than an identity-mapping editor.

## Convex deployment

For local backend development, use the existing `.env` deployment selection and run `bun run dev:convex`. For hosted live operation, select the authorized deployment deliberately and supply its configuration through its own environment/secret settings. Next.js environment files are not a deployment secret sync mechanism.

| Variables                                                                                                     | Capability                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTROL_SERVICE_SECRET` | Same random server-only service key as Next.js, at least 32 characters. |
| `SLACK_ENGINEER_USER_IDS`, `SLACK_MARKETER_USER_IDS`, `SLACK_ADMIN_USER_IDS` | Exact comma-separated Slack role IDs; administrator list optional. |
| `OPENAI_API_KEY`                                                                                              | App-scoped model access. Generation model is fixed in code to `gpt-5-mini`.                                                                                                              |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID`, `SLACK_TEAM_ID`                                | Approval cards and signed interactivity for the exact configured team/channel and mapped people.                                                                                         |
| `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `LINEAR_RELEASED_STATE_ID`                                                | Canonical engineering tickets and the team's released-state update after verified release.                                                                                               |
| `FDE_WEATHER_REPOSITORY`, `FDE_BASE_SHA`, `GITHUB_CONTROLLER_REPOSITORY`, `GITHUB_CONTROLLER_SHA`             | Separate owned weather target and trusted controller repositories, each with its own exact reviewed revision.                                                                                                 |
| `GITHUB_DISPATCH_TOKEN`, `GITHUB_READ_TOKEN`, `GITHUB_RELEASE_TOKEN`                                          | Prefer separate dispatch, read, and merge credentials. `GITHUB_TOKEN` is the dispatch compatibility fallback; reads fall back to dispatch. Release requires its explicit credential.     |
| `GITHUB_CONTROLLER_BRANCH`, `GITHUB_DEFAULT_BRANCH`, `GITHUB_REQUIRED_CHECKS`                                | Controller dispatch branch, target branch, and required check configuration. Defaults are `main`, `main`, and `Protected weather`; verify against repository protection rules. |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME`, `WEATHER_PRODUCTION_DOMAIN`                       | Owned project and exact production hostname, without a scheme or path. Stage and verify the candidate before promoting its existing deployment.                                          |
| `VERCEL_TEAM_ID`, `VERCEL_RELEASE_TOKEN`                                                                      | Optional Vercel team scope and separate promotion credential; promotion otherwise uses `VERCEL_TOKEN`.                                                                                   |
| `CONTROL_APP_ORIGIN`                                                                                          | Public control origin used by Slack and Linear links; configure in Convex as well as Next.                                                                                               |
| `FDE_INFRASTRUCTURE_COMMITTED_USD`                                                                            | Initial recorded infrastructure commitment, finite USD 0–100. Strict live preflight requires an explicit value, including `0` when no commitment exists.                                 |
| `SOCIAL_WORKER_URL`, `SOCIAL_GRANT_SECRET`, `SOCIAL_CALLBACK_SECRET`                                          | Worker dispatch/import grants and signed callbacks. Use distinct secrets of at least 32 random characters.                                                                               |
| `ENGINEERING_GRANT_SECRET`, `ENGINEERING_CALLBACK_SECRET`                                                     | Bounded engineering grants and authenticated controller callbacks. These must match the protected engineering environment.                                                               |
| `ENGINEERING_WORKER_URL`, `ENGINEERING_VERIFY_SECRET`                                                         | HTTPS protected-browser worker and shared request-signing secret. This is separate from the social worker.                                                                               |
| `REDDIT_API_APPROVED`                                                                                         | Conditional controller readiness flag; keep false until the dedicated account and approved community capability are authorized. OAuth secrets stay in the social worker.                 |

Set Convex `X_AUTOMATION_PERMISSION_CONFIRMED=false` until the account/platform capability is authorized. This controller-side gate is independent of the social worker's `X_PLATFORM_PERMISSION_APPROVED` flag. Neither flag proves external permission.

The publisher also checks configured account identifiers, connection capability, pauses, fresh evidence, exact authority, and the shared ledger. Setting environment variables does not grant platform access, approve a draft, activate a persona, or verify deployment behavior.

## Social browser worker

The worker implementation is in `workers/social/`. Its Dockerfile runs Chromium in a dedicated process under the `pwuser` account; [SETUP-GCP.md](SETUP-GCP.md) describes the selected Google Cloud Run deployment; the older Render YAML remains an optional alternative. The blueprint does not establish a price, entitlement, or approved platform capability.

Before any paid deployment, record its maximum committed cost, renewal exposure, and shutdown plan within the shared USD 100 ceiling. The application does not provision this service automatically.

| Variable                         | Required setting                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTROL_APP_ORIGIN`             | Exact permitted HTTPS control-app origin.                                                                                              |
| `CONVEX_SITE_URL`                | Public HTTPS Convex HTTP-action origin; a local anonymous endpoint is not reachable from the hosted worker.                            |
| `SOCIAL_GRANT_SECRET`            | Same grant-signing secret as the controller; at least 32 random characters.                                                            |
| `SOCIAL_CALLBACK_SECRET`         | Separate callback-signing secret shared with the controller; at least 32 random characters.                                            |
| `SESSION_ENCRYPTION_KEY`         | Exactly 32 random bytes encoded as base64. Keep this key in the worker secret store; Convex retains bound ciphertext, not this key.    |
| `SESSION_KEY_VERSION`            | Non-secret key version, for example `v1`.                                                                                              |
| `SESSION_PREVIOUS_KEYS_JSON`     | Optional object mapping earlier key versions to their base64 keys during a controlled rotation. Never include it in diagnostic output. |
| `X_PLATFORM_PERMISSION_APPROVED` | Defaults to false. Set true only after establishing the authorized account/platform capability. The flag is not proof of permission.   |
| `CHROMIUM_SANDBOX`               | Optional; `true` enables Chromium's sandbox when the deployment runtime supports it. Verify the runtime configuration independently.   |
| `PORT`                           | Host-assigned listen port; defaults to 8080.                                                                                           |

Build the container from the repository root so its shared worker contracts are available:

```sh
docker build -f workers/social/Dockerfile -t fde-social-worker .
```

Supply deployment secrets through the service's secret settings. `/health` reports process liveness; it does not validate X access.

For conditional Reddit setup, configure worker-only `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REDIRECT_URI`, `REDDIT_USER_AGENT`, and one to five comma-separated `REDDIT_ALLOWED_SUBREDDITS`. The redirect must be the worker's HTTPS `/v1/oauth/reddit/callback` endpoint. Keep `REDDIT_API_APPROVED=false` on both worker and Convex until official account/community access is approved. An administrator then uses **Connections → Authorize Reddit account** for permanent `identity read submit` authorization. The callback verifies one-use state, browser proof, and the actual account before encrypting the refresh token with the worker key. Only ciphertext and non-secret binding metadata are stored privately in Convex; plaintext OAuth tokens and encryption keys are never stored in Next.js or Convex. A legacy `REDDIT_REFRESH_TOKEN` environment value cannot bypass account/version verification.

After verification, `FDE_SOCIAL_POLLING_ENABLED=true` enables bounded intake from permitted communities, beginning at account activation. Rate limits, pagination gaps, and oversized matching batches stop polling without advancing the cursor. Public replies retain exact approval, current source/account/community checks, and independent receipts. Live Reddit access remains unverified; see [Reddit setup](SETUP-REDDIT.md) and [worker setup](../workers/README.md).

An admin uses **Connections → Import X session** after live workspace access and worker setup. Import only the dedicated brand account's `auth_token` and `ct0` cookies. The UI supports a narrowly scoped storage-state JSON file (under 28 KB) or guided password-field entry; `origins` must be empty. No browser profile from unrelated accounts should be imported. The worker validates the expected account and binds encrypted state to the workspace, account, connection, and connection version.

A login challenge, expired session, or throttling must lead to reconnect/manual operation. Do not attempt to bypass platform challenges or treat a simulator receipt as an X post.

## Restricted engineering controller

`.github/workflows/restricted-coding.yml` is dispatched from the protected controller branch with an exact signed Build request. Its `engineering-controller` environment supplies:

| Setting                       | Location / purpose                                                               |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `ENGINEERING_GRANT_SECRET`    | Protected environment secret; validates signed Build request.                    |
| `ENGINEERING_CALLBACK_SECRET` | Protected environment secret; authenticates controller/broker calls.             |
| `CONVEX_SITE_URL`             | Environment variable containing the public controller HTTP-action origin.        |
| `CODING_SANDBOX_IMAGE`        | Environment variable naming the prebuilt, verified restricted image.             |
| `WEATHER_TARGET_REPOSITORY`   | Environment variable containing the exact allowed `owner/repository`.            |
| `WEATHER_REPO_READ_SSH_KEY` | Preferred read-only SSH deploy key registered on the weather repository; checkout does not persist it. |
| `WEATHER_REPO_READ_TOKEN` | Optional fallback token with target contents read access. |

Set `CODING_SANDBOX_IMAGE` to a reviewed immutable digest (`registry/image@sha256:…`), not a mutable tag. Build `workers/engineering/Dockerfile` from the repository root, verify the protected checks locally, then publish only to the authorized registry. The workflow pulls that specific reviewed image; preflight never builds or downloads it.

The separate `engineering-pr-writer` environment supplies `ENGINEERING_CALLBACK_SECRET` and `WEATHER_PR_TOKEN`, plus `CONVEX_SITE_URL` and optional `WEATHER_DEFAULT_BRANCH`. The workflow maps the GitHub secret `WEATHER_PR_TOKEN` to runtime `GITHUB_PR_TOKEN`; custom GitHub secret names cannot use the reserved `GITHUB_` prefix.

For protected check creation, create and install a GitHub App on `hackathon-weather` with **Checks: write**, then set variable `WEATHER_CHECKS_APP_ID` and secret `WEATHER_CHECKS_APP_PRIVATE_KEY` in the writer environment. The optional `actions/create-github-app-token@v2` step mints a short-lived token scoped to that repository and passes it as runtime `GITHUB_CHECKS_TOKEN`; the action revokes it at job end. This account-level App creation/install is a manual setup step. A supported `WEATHER_CHECKS_TOKEN` secret is an optional fallback, not the primary long-term installation-token mechanism. The writer verifies the signed candidate artifact, writes the allowed patch/PR, and attaches the protected check. PR/check credentials never enter the candidate execution container.

The general controller CI workflow checks out the private target repository `Aarush-Dubey/hackathon-weather` separately. Configure its read-only `WEATHER_REPO_READ_SSH_KEY` deploy-key secret (preferred) or `WEATHER_REPO_READ_TOKEN` fallback, and the `WEATHER_BASELINE_SHA` variable containing the reviewed 40-character seeded-baseline commit. The CI checkout must match that exact revision; missing settings fail explicitly. Fork pull requests without access cannot run the private baseline check. This setup describes the workflow; it does not claim a GitHub Actions run has passed.

Local protected-weather tests use `WEATHER_TARGET_PATH`, defaulting to the sibling `../hackathon-weather` checkout. Run these tests from the controller repository; the weather checkout must have its own dependencies installed. The runner accepts explicit `TRUSTED_CONTROLLER_DIRECTORY`, `TARGET_REPOSITORY_DIRECTORY`, and `CANDIDATE_OUTPUT_DIRECTORY` paths. Locally, the first two correspond to `/home/big-daddy/Desktop/hackathon` and `/home/big-daddy/Desktop/hackathon-weather`; hosted workflows check them out into separate directories. Confirm these paths, the requested weather repository, exact controller revision, weather baseline SHA, and `lib/temperature.ts` change allowlist before enabling dispatch. Candidate code must not control the trusted workflow or protected test definitions. Weather application files containing identity and fixture routes are protected from the proposed patch.

Model proposal calls stay in the trusted controller; provider credentials are not passed into candidate containers. The verifier uses Docker without network access, enforces resource limits, and mounts trusted checks separately. A missing or unbounded runtime blocks execution rather than running candidate code with host credentials.

Weather artifacts include `WEATHER_RUN_ID`, `WEATHER_CANDIDATE_ID`, `WEATHER_HEAD_SHA`, `WEATHER_TREE_DIGEST`, `WEATHER_TRUSTED_TEST_REVISION`, `WEATHER_BUILD_CONFIG_REVISION`, and `WEATHER_DEPLOYMENT_MODE`. These identity fields are supplied by the approved release process. `WEATHER_ALLOWED_HOSTS` limits verification targets; `WEATHER_ALLOW_LOCALHOST=true` is for isolated local tests. `VERCEL_AUTOMATION_BYPASS_SECRET`, when needed for authorized protected previews, stays with the trusted verifier.

## Protected browser-verification worker

`workers/engineering/weather-main.ts` serves signed verification requests at `/v1/weather/verify` and listens on port 8081 unless the hosting service supplies `PORT`. Deploy it in a reviewed runtime with the repository dependencies and matching Playwright Chromium installed. Its environment has `ENGINEERING_VERIFY_SECRET`, the exact comma-separated `WEATHER_ALLOWED_HOSTS`, and optionally `WEATHER_ACCEPT_SIGNED_DEPLOYMENT_HOSTS=true` when allowing dynamically staged hosts that are explicitly signed by the controller. Private network targets remain rejected. Keep `VERCEL_AUTOMATION_BYPASS_SECRET`, if needed, in this worker's secret settings.

Point Convex `ENGINEERING_WORKER_URL` at this service's HTTPS origin and use the same verification secret. Liveness, a reachable URL, or an installed browser does not prove the protected regression and deployment-identity checks pass. Record the worker's hosting commitment before enabling it.

## Budget and live-readiness gate

`gpt-5-mini` is fixed by `APP_MODEL`. The project's maximum incremental spend is USD 100, with USD 90 for discretionary work and USD 10 reserved for uncertainty/recovery. Initial allocation is USD 40 model, USD 35 infrastructure, USD 15 testing, and USD 10 contingency. These are product budgets, not provider price quotes.

Every paid call needs a conservative bounded reservation based on verified pricing. An unknown charge keeps its reservation; a retry needs its own reservation. Register infrastructure/build/subscription commitments before enabling them, including renewal exposure. The UI can display only the costs recorded in its ledger, not unknown external bills. Preflight performs no paid calls and does not reserve funds.

For a fresh state, `FDE_INFRASTRUCTURE_COMMITTED_USD` seeds the ledger; a supplied invalid amount blocks initialization. The local setup default is USD 0. Existing stored commitments are preserved across restarts. Administrators update the current total on **Controls & audit → Project budget** with a reason, including evidence for reductions. This records commitments; it neither purchases nor cancels services. New discretionary model work is blocked when committed spend plus its reservation would exceed USD 90.

Run the local inventory without making provider requests:

```sh
bun run test:preflight --mode live --scope next --strict
bun run test:preflight --mode live --scope all --json
```

When checking an already provisioned process environment, add `--no-env-files`. `--scope convex`, `--scope social`, `--scope engineering`, and `--scope verifier` select expected variables but still inspect **only the environment of the process running the script**. They do not inspect a remote service. Engineering scope inventories both protected workflow jobs; do not combine their credentials into the candidate runtime merely to make an inventory pass. Default exit status is reporting-only; `--strict` fails incomplete required configuration. `--include-reddit` makes conditional Reddit credentials required.

After configuration, record real authenticated and provider tests separately: hosted access/service-key checks, exact Slack-role decisions, Linear ticket receipt, GitHub PR/checks, staged-to-live Vercel identity/behavior, and confirmed social publication. Missing access is **blocked**, not passed. See the verification reports for the current executed evidence.

## Selected worker host: Google Cloud Run

Use [SETUP-GCP.md](SETUP-GCP.md) for Cloud Build, Secret Manager, runtime identities and the two service URLs. The social worker needs instance-based billing/CPU always allocated and a minimum of one instance during the live demo because job execution continues after its 202 response. The verifier can use request-based billing and scale to zero. Configure one concurrent request and one maximum instance initially. The current signed-grant protocol uses public invocation with application authorization; Google IAM-only invocation needs an additional caller integration. No Google API key is required in the app. Both services are now deployed in explicit `WORKER_SETUP_PENDING=true` mode, with request-based billing and minimum 0 until their public dependencies exist. Health returns ready=false and work endpoints return 503. Remove that gate and apply the live social CPU settings only after configuration; browser execution remains unverified. [Recorded deployment](../artifacts/gcp-worker-deployment.json).
