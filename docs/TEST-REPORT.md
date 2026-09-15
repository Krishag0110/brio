# Implementation verification

Latest hosted demo verification (14 September 2026): source `e6ff0e1` passed **558 tests in 39 files**, all **22 browser regression scenarios**, typecheck and production build. ESLint passed with one nonblocking unused test-helper warning. Independent review found no blocker. Production `dpl_6mZYMxb27ZEciWRYN5nvpVKQ4w1B` was tested through the actual hosted browser: 39 imported cases became 40 after a complete 13-step fixture run; a second tab received phase movement without reload, pause/resume and reload persistence passed, page errors were zero, and the live workspace stayed unchanged. [Evidence](../artifacts/brio-hosted-demo-verification.json).

Latest rebrand verification (14 September 2026): source `872c226` passed all 530 tests in 37 files, 22 production browser scenarios (including lowercase `brio` header/title), lint, typecheck, and the isolated production build. Local browser and Next.js runtime checks found no errors. The hosted rebrand is deployed as `dpl_3Ywkgbs9Q3afzFf2jH7acFkfm2Dd`. See [hosted branding evidence](../artifacts/brio-browser-verification.json).


Verified 14 September 2026. Source `6981750` passed **530 automated tests across 37 files**, **all 22 production browser scenarios**, lint, TypeScript and an isolated production build. [Final GitHub CI 34785978933](https://github.com/Aarush-Dubey/hackathon/actions/runs/34785978933) passed on `e8f2dd0`. Controller [PR #1](https://github.com/Aarush-Dubey/hackathon/pull/1) merged to protected `main` as `8a7636e2709d039773afa73857e6cb66f08a7d6f`.

Cloud deployment checks and complete live execution are reported separately below. Earlier dated runs are retained as historical evidence.

| Check | Result |
|---|---|
| Controller lint and TypeScript | Passed. |
| Full unit/integration/execution suite | 530 tests passed across 37 files on `6981750`, including Reddit connector boundaries and the engineering Build approval-hash regression. |
| Controller production build | Passed. |
| Production browser tests | All 22 scenarios passed together against the production build on `6981750` in 1.1 minutes. Final GitHub CI also passed on `e8f2dd0`. |
| Standalone weather production build | Passed in its own repository using Bun 1.4.2. The target pins `packageManager` and `.bun-version`, uses `bun.lock`, and passes frozen installation and TypeScript checking; the seeded conversion defect is unchanged. |
| Actual Chromium weather baseline | Correctly reproduces seeded conversion failure; 34 protected observations recorded. The target intentionally remains unfixed. |
| Real OpenAI writer smoke | Passed with gpt-5-mini; recorded cost $0.000159. |
| Real durable triage smoke | Passed after correcting the strict nullable model schema; recorded cost $0.000359. |
| Real 60-case persona evaluation | Passed with gpt-5-mini: 20/20 eligible examples accepted; 0/20 hard exclusions, 0/10 ambiguous examples and 0/10 factual examples accepted for autonomous replies. All 12 writer/validator calls settled at $0.012922. [Full results and ledger](../artifacts/live-persona-evaluation.json). No policy was activated or public reply sent. |
| GitHub configuration | Independent target pushed, immutable baseline configured, read-only SSH checkout verified, protected branches and separate environments configured. |
| Secret scan | Configured secret values absent from Git candidate files. Private environment bundles remain ignored. |

The first two durable triage attempts failed. Their reservations totaling $0.009157 remain conservatively counted as unknown charges; the successful retry does not erase those reservations. Model charges and infrastructure commitments are tracked separately. A $1 infrastructure allowance was reserved for bounded GitHub CI and artifact storage; it is a budget reservation, not proof of a charge.

The persona evaluation's initial final callback failed because its digest depended on JSON property order across the Convex storage boundary. Both producer and validator now hash canonical JSON, with a regression test that reorders object keys. The saved, unmodified writer and independent-validator outputs were recovered, passed the unchanged 60-case guard, and were replayed into the original task without another model call. [Recovery record](../artifacts/live-persona-evaluation-recovery.json) and [saved final batch](../artifacts/live-persona-final-batch-raw.json) preserve this history. The policy remains pending, without human approval.

Recorded model usage costs total **$0.013440**: writer smoke $0.000159, successful durable triage $0.000359, and the 60-case evaluation $0.012922. Retained unknown model reservations are **$0.009157**. With the separate $1 infrastructure allowance, recorded cost exposure before GCP provisioning is **$1.022597**; the allowance and unknown reservations are not represented as confirmed vendor charges.

New GCP charges have not yet been reconciled into that application ledger. No GCP budget or alert policy was created.

The tests cover revision-bound approvals, role and service-key checks, signed Slack replay, budget concurrency, restricted patch scope, release locks, deployment identity, public-send guards, opt-outs, cancellation, unknown-send reconciliation, persona gates, and supplemental manual resolution. Browser tests additionally verify admission, HttpOnly access cookies, wrong-code/tampered-cookie rejection, and cross-origin rejection. See [UI-VERIFICATION.md](UI-VERIFICATION.md) and [ACCEPTANCE-MATRIX.md](ACCEPTANCE-MATRIX.md).

## Remaining live evidence

No full customer-to-fix-to-public-reply run is claimed. Local Docker access was unavailable; the GCP-built restricted sandbox is now configured for GitHub Actions, but a real signed Build has not yet proved its OIDC pull and generated candidate execution. Hosted Convex, Vercel, Linear settings and the GCP workers are now configured; remaining account and flow checks are listed in [SETUP-REMAINING.md](SETUP-REMAINING.md). The merged weather baseline has been deployed, promoted and verified; no PR-based weather repair or candidate release, X send, or Reddit send has occurred. Manual fallback and provider behavior have local automated coverage.

GitHub Actions results are separate from local checks. Controller PR #1 is merged after final CI passed. The initial checkout failure and its fix are preserved in [earlier CI evidence](../artifacts/github-ci-verification.json); later successful runs supersede that failure. A configured key, successful health response or passing fixture does not count as a live integration test.

## brio and GCP follow-up

The 13-step simulation completed in the production browser with pause/reload/resume/restart coverage. Cross-tab SSE delivery passed with observer HTTP reads blocked; a 503 stream failure recovered through HTTP fallback and returned to SSE without a reload. Ten stream unit tests cover access failure, cancellation, native callback delivery, redaction and renewal. Five pending-worker tests ensure every job/import/verification endpoint rejects while setup is incomplete.

GCP project and billing linkage are real, as are the runtime/build identities and four scoped Secret Manager entries. Cloud Build `569f3b8b-c458-490d-bf73-1d9775c4bc86` successfully built worker source `6981750`. Active revisions are `mend-social-worker-00005-6wc` and `mend-weather-verifier-00003-s98`. Their health routes report ok. Social revision `00005-6wc` applies brio source `872c226` from the later social-only build `e31a15fd-5a36-4c02-903c-1ce57a415aa1`, preserving the operator-authorized X configuration; identity reimport is verified, polling remains off, and no posting test is claimed. [Initial deployment evidence](../artifacts/gcp-worker-deployment.json) and [latest social deployment evidence](../artifacts/brio-social-worker-deployment.json) record the revisions, image digests and probes. Cloud Run Chromium execution is verified by the hosted baseline evidence below. No live social post, weather fix or release is implied by infrastructure setup.

## Linear setup correction

The user’s real metadata request returned HTTP 400 with “Query too complex.” The helper now reads teams and workflow states in separate cursor-paginated queries and distinguishes complexity, access and rate-limit failures without printing provider bodies or credentials. Ten focused tests, targeted lint and whole-project TypeScript passed after this change. A real read-only run found Drizzle/Done and the selected IDs were saved locally. [Evidence](../artifacts/linear-setup.json). The subsequent GitHub run passed all 490 automated tests and all 21 browser tests.

## Slack configuration evidence

The replacement bot token passed Slack auth.test for BitsUp; brio’s Slack integration remains registered as `Mend`, is installed with chat:write and joined the created `mend-approvals` channel. All six settings, including the user-supplied Elen engineer ID and David marketer ID, are saved privately and imported into hosted production Convex. The first exposed token was revoked. The public callback is enabled and its URL persisted after browser reload. A signed non-action callback probe passed signature validation and returned the expected `slack_context_denied` for absent action context; it created no approval. No live human approval decision was tested. [Configuration record](../artifacts/slack-setup.json) and [signed probe evidence](../artifacts/slack-signed-callback-verification.json).

## Populated workspace iteration — 2026-09-14

Local verification on the complete seeded-workspace change passed 493 tests in 32 files, all 22 production browser scenarios together in 1.0 minute, lint, TypeScript and an isolated `.next-e2e` production build. The additional browser scenario seeds only its isolated test database, receives the changes over the event stream, filters the board, opens a persona reply and checks the mobile layout. Seed tests cover all stages, fixture-only targets, idempotence, preserved existing data and live-state rejection. [Recorded evidence](../artifacts/seed-workspace-verification.json). Cloud integration authentication remains separate from this local result.

## Hosted verification — 14 September 2026

Hosted brio deployment `dpl_6mZYMxb27ZEciWRYN5nvpVKQ4w1B` and production Convex `resilient-perch-131` run hosted demo source `e6ff0e1`; the social worker retains lowercase-brand source `872c226` and the verifier retains source `6981750`. These deployment identities do not prove a completed customer repair.

- [Hosted brio admission](../artifacts/hosted-mend-verification.json): unauthenticated page redirect, API denial, wrong-code denial, secure HttpOnly cookie and authenticated live Convex state all verified.
- [Vercel and callback checks](../artifacts/hosted-provider-verification.json): token accesses the expected weather project, production alias resolves to the recorded deployment, candidate auto-assignment is disabled, only public identity settings exist, and unsigned Slack callback is refused.
- [Cloud weather baseline](../artifacts/hosted-weather-baseline.json): signed GCP request returned 200; exact expected source identity matched; Chromium recorded 34 checks and reproduced the planted conversion defect. Twelve conversion observations intentionally fail. This is baseline reproduction, not a fixed release.
- [Sandbox build](../artifacts/gcp-coding-sandbox-deployment.json): Cloud Build succeeded; immutable runtime passed Bun/Chromium smoke as UID 65532 with no network, read-only root and no Docker socket. Workflow lint and credential-cleanup checks passed. The reviewed controller workflow is merged; production Convex is pinned to controller main `8a7636e`. The merged weather baseline is deployed and verified; production `FDE_BASE_SHA` is pinned to `161835dba251f9739d25194ec21db0f2461df989`. Real GitHub OIDC pull/candidate execution awaits a valid signed Build.

Weather bootstrap [34786278162](https://github.com/Aarush-Dubey/hackathon/actions/runs/34786278162) passed on controller main `8a7636e`. App 4934302 attached the required check to migration head `a96c50e`; all 34 observations preserved the intentional baseline defect. Weather PR #1 then merged as `161835dba251f9739d25194ec21db0f2461df989`, tree `2fc58d5c57da18d60ff7ece9952faf273117f22d`. Fresh deployment `dpl_2j3VMkCbdSJtAh565FdkXpu76PGK` was promoted to `mend-weather.vercel.app`. Staged and stable `/api/version` checks and Cloud Run Chromium each matched that exact SHA/tree. Each browser suite recorded 34 checks, identity passed, and the seeded defect reproduced; the expected `20°F` failure remains. Run ID is `seed-main-2026-09-14`, candidate ID `seed-baseline-main`. Production Convex `FDE_BASE_SHA` is confirmed as that exact merged SHA; no deployment pin work remains. [Fresh baseline evidence](../artifacts/weather-main-baseline-deployment.json).

No live public message or complete engineer-to-marketer approval flow is claimed.

- GitHub Checks App 4934302: matching private key verified, selected weather-only installation confirmed, writer environment saved, repository-scoped token mint succeeded and probe token revoked. [Evidence](../artifacts/github-checks-app-setup.json).
- X: operator-authorized enablement set both switches true; reimport returned HTTP 200 and verified `Vinaychamoc5` at 22:21:24 UTC on 13 September (14 September locally). The connection reports ready, paused false; social revision `00005-6wc` now serves all traffic. Polling remains off and no public send is verified. External X approval is not independently verified. [Enablement evidence](../artifacts/x-automation-enablement.json).

## Complete connector and dispatch verification

Source 6981750 passed 530 automated tests across 37 files, all 22 production browser scenarios in 1.1 minutes, lint, TypeScript and an isolated `.next-e2e` production build. The new dispatch test reproduces the previous engineering_scope_denied failure and verifies that a bound Build passes the same scope check used by the runner. Reddit tests cover OAuth browser proof, replay/expiry, exact account and scope checks, encrypted credential binding, disconnect, bounded intake and API admission. Reddit remains deferred, disabled and paused, with both approval flags false; these tests do not establish live provider access. The demo video is also deferred by the user.
