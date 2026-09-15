# brio: what remains to set up

Updated 14 September 2026. This is the checklist for the existing installation. Do not recreate the completed projects.

## Already configured

| Service | Existing installation | Evidence and remaining verification |
| --- | --- | --- |
| Convex | Team `vinay-chamola`, project `mend-hackathon`, production `resilient-perch-131` | Functions from `e6ff0e1` deployed; separate demo and live state work behind authenticated APIs. |
| brio website | [mend-hackathon.vercel.app](https://mend-hackathon.vercel.app) | Source `e6ff0e1` deployed as `dpl_6mZYMxb27ZEciWRYN5nvpVKQ4w1B`; hosted demo contains 40 cases, 169 reports and 3 personas after verification. Playback, second-tab updates and persistence passed. Local backup remains on port 3002. |
| Weather website | [mend-weather.vercel.app](https://mend-weather.vercel.app) | Merged main `161835dba251f9739d25194ec21db0f2461df989` deployed as `dpl_2j3VMkCbdSJtAh565FdkXpu76PGK`; staged and stable URLs each passed exact identity verification and reproduced the planted defect in 34 browser checks. |
| Vercel API | Token saved and imported into production Convex | Real project, deployment, production alias, staging settings and environment allowlist verified. Automatic domain assignment is disabled. |
| GCP | Project `mend-hackathon-260914`, region `us-central1` | Social revision `00005-6wc` and verifier `00003-s98` active and healthy; immutable sandbox image built and offline Chromium smoke passed. No further GCP credentials needed. |
| OpenAI | App key installed; `gpt-5-mini` | Prior real writer, triage and persona evaluation passed. |
| Linear | Drizzle team and Done state configured in hosted Convex | Metadata read verified; issue creation/update still needs a controlled live flow. |
| GitHub | Separate controller/weather repositories and engineering environments | Controller PR #1 merged as `8a7636e`; final CI passed. Hosted callback, sandbox pull settings and Checks App configured; reviewed brio publication and signed execution verification are below. |
| Slack | brio’s app remains registered as `Mend` in BitsUp, bot in `#mend-approvals` | Elen is engineer; David is marketer. Hosted secrets saved. Callback enabled and URL persisted after reload; actual human button test remains. |

## 1. Verify a real signed Build

**The Checks App is complete.** `brio-mkc`, App ID `4934302`, is owned by Aarush-Dubey and installed only on `hackathon-weather`. It has Checks write and Metadata read. The downloaded key matched the app; `WEATHER_CHECKS_APP_ID` and `WEATHER_CHECKS_APP_PRIVATE_KEY` are saved in `engineering-pr-writer`. A scoped installation token was minted successfully and revoked after the read-only setup probe. No extra GitHub credential is currently needed from the user. [Evidence](../artifacts/github-checks-app-setup.json).

Initial controller review and tests passed. [CI 34785978933](https://github.com/Aarush-Dubey/hackathon/actions/runs/34785978933) passed on `e8f2dd0`; [controller PR #1](https://github.com/Aarush-Dubey/hackathon/pull/1) merged as `8a7636e2709d039773afa73857e6cb66f08a7d6f`. That is the historical first merge. Production `GITHUB_CONTROLLER_SHA` tracks the latest reviewed controller `main` commit and is synchronized after each merge. The lowercase brio rename merged through PR #2 into `4c1279c8ed9a165319b28fad01aea0f2d1ce55e0`, the current live controller pin. Later isolated hosted demo source `e6ff0e1` is deployed and pushed on `codex/hackathon-mvp`.

Weather [bootstrap 34786278162](https://github.com/Aarush-Dubey/hackathon/actions/runs/34786278162) also passed, recording 34 checks and the intentional defect on the migration head. Weather [PR #1](https://github.com/Aarush-Dubey/hackathon-weather/pull/1) merged as `161835dba251f9739d25194ec21db0f2461df989`, tree `2fc58d5c57da18d60ff7ece9952faf273117f22d`.

The merged weather baseline is deployed and promoted as `dpl_2j3VMkCbdSJtAh565FdkXpu76PGK`. Both staged and stable URLs matched the exact SHA/tree and reproduced the intentional conversion defect in 34 Chromium checks each. Production `FDE_BASE_SHA` is confirmed as `161835dba251f9739d25194ec21db0f2461df989`; the weather baseline pin is complete. [Weather baseline evidence](../artifacts/weather-main-baseline-deployment.json).

The next check is a current signed engineer Build, which must verify GitHub OIDC image pull and restricted candidate execution.

The immutable sandbox is built and its private registry access is configured. [Sandbox evidence](../artifacts/gcp-coding-sandbox-deployment.json). The independent audit found and fixed a Build approval-hash mismatch; the regression tests passed.

## 2. Verify Slack decisions

The expected configuration is:

- App: registered as `Mend` in BitsUp (legacy name for brio’s Slack integration).
- Socket Mode: **Off**; this app receives HTTP interactions.
- Interactivity: **On**.
- Request URL: `https://resilient-perch-131.convex.site/slack/interactions`.
- Engineer: Elen (`U0C1L62486M`).
- Marketer: David (`U0C1DJRE4KF`).

The saved URL has already been verified after reloading Slack settings. An unsigned request to the hosted endpoint correctly returns HTTP 403. A signed non-action probe also passed signature validation and was correctly refused with `slack_context_denied` because it had no valid action context. [Callback evidence](../artifacts/slack-signed-callback-verification.json). The remaining check is a real engineer/marketer button test on the current case. No message history scope is required for these signed button interactions.

## 3. X is ready; the controlled posting check remains

**@Vinaychamoc5** was reimported after the operator explicitly requested enablement. The hosted worker returned HTTP 200 and verified the account identity; brio reports **ready** with **paused false**. Both X switches are enabled on social revision `mend-social-worker-00005-6wc` and production Convex. [Enablement evidence](../artifacts/x-automation-enablement.json).

Background social polling remains **off**, and no X post or reply has been sent. Keep the verified connection and exercise the approved case flow below; do not import another session or create another account. Operator enablement does not establish external X approval, which has not been independently verified.

## 4. Reddit is deferred

The user chose to skip Reddit for now. The connection is **disabled and paused**, and both approval flags remain false. There is no Reddit setup action to take. Connector code is implemented, tested and deployed, but live API approval, account access and posting remain unverified. If the user opts in later, follow [Reddit setup](SETUP-REDDIT.md).

## Final live verification

Using the verified and pinned baseline above, exercise an actual complaint, engineer Build, isolated candidate verification, marketer Go, staged promotion, protected live verification and an approved reply with receipt reconciliation. A seeded presentation, configured token or worker health response is not evidence that this full flow has passed.

The [recording handoff](brio-RECORDING-HANDOFF.md) covers the requested 100-second staged video. Hosted demo playback is ready; a final film has not been rendered. To return the website to live integration state, set Vercel `FDE_HOSTED_DEMO=false` and redeploy. Both Convex datasets are preserved; see [environment setup](ENVIRONMENT.md#hosted-demo-workspace).

No Clerk or weather API account is needed. See [environment inventory](ENVIRONMENT.md), [GCP setup](SETUP-GCP.md), and the [test report](TEST-REPORT.md).
