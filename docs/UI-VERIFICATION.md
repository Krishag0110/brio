# Control UI verification

## brio interface runtime verification — 2026-09-14

The landing (`/`), live board (`/cases`), metrics (`/dashboard`), and ticket pages now follow the supplied `Mend.html` reference: Hanken Grotesk and Geist Mono fonts extracted from that file, warm light/dark colors, editorial hero, seven Kanban columns, nine-step ticket timeline, original-signal sidebar, and compact charts. The reference was opened in Chromium and its board and ticket screens inspected before implementation. Counts, routes, approvals, and receipts come from persisted snapshots; the original mock's invented incidents, customer counts, timing claims, and Swift source path were not copied as live facts. The working weather defect is 20°C → 20°F, with 68°F expected, scoped to `lib/temperature.ts` in the separate weather repository.

The new demo toolbar is confined to explicit local demo mode. Run, Pause, Resume, and Restart use server commands and a persisted 13-step simulator. Cards animate when the server phase changes; the board follows the active card horizontally. The activity feed and connection indicator use the same snapshot revision, with a last-sync timestamp during disconnection. The simulator's Slack decisions, checks, release, and receipt are explicitly labeled simulated. Live authority still comes from Slack. Persona, connections, controls, manual intake, and all prior ticket operations remain accessible through Workspace and the ticket's **Operational controls** disclosure.

Official `next-dev-loop` verification used Next.js **16.3.5 / Turbopack** and **agent-browser 0.37.1**, with a stable worktree-scoped restore session and React DevTools enabled. An existing user-owned `bun run dev:demo` server at `http://127.0.0.1:3002` was reused and preserved. It was identified as a VS Code terminal process; its `.next` output was not reset.

| Runtime check | Evidence |
| --- | --- |
| Next MCP surface and route map | `tools/list` exposes `get_compilation_issues`; `get_routes` includes all new pages and existing control endpoints. |
| Compilation and runtime errors | Initial and final `get_compilation_issues`: empty issues. `get_errors`: empty config/session errors. [MCP record](../artifacts/ui/mend-next-mcp.json). |
| Server/client boundaries | `get_page_metadata` identifies the actual App Router layout/page. React tree shows ServerDashboard → Dashboard → CasesView or CaseDetail → TicketTimeline. |
| React state and live feed | `react inspect` shows CasesView receiving snapshot revision 18, `connection: live`, and ten recorded phase transitions. [React inspection](../artifacts/ui/mend-react-cases.json). |
| Simulator behavior | Browser Run completed all 13 steps with phase COMPLETED and a confirmed simulated receipt. Restart created another case; Pause and Resume changed persisted run state. No paid model calls or external writes occurred. |
| Responsive views | Landing, board, metrics, and ticket inspected at a 390 × 844 CSS viewport. Board scroll stays inside its container. A long-signal ticket overflow was found, corrected with zero-minimum grid tracks, and rechecked: document width 375 ≤ viewport 390. |
| Visual comparison | [Landing](../artifacts/ui/mend-landing-desktop.png), [board pause](../artifacts/ui/mend-board-paused.png), [ticket](../artifacts/ui/mend-ticket-complete-dev.png), [metrics](../artifacts/ui/mend-metrics-desktop.png), [dark metrics](../artifacts/ui/mend-metrics-dark.png), and [mobile ticket](../artifacts/ui/mend-ticket-mobile.png). These are visual/runtime evidence, not external-provider receipts or pixel-perfect proof. |

Final global lint and TypeScript checks passed. Generated `.next-e2e` files are excluded from source lint, and the isolated production build preserves the user’s development server. The 17-test baseline below predates the reference-based interface; the updated 21-scenario production browser results are recorded at the end of this document.

## Prior operational baseline

Verified **2026-09-13 at 20:13 UTC** against the implementation based on revision `af0178efa7a325baaa085c0cbc9baa1cfd822b4c`, including the separate weather repository and shared hackathon access changes. This records the tested working tree, not a claim that the base commit already contains the implementation. The integration owner's final report records the final submitted revision.

**Production build, lint, and typecheck passed. All 17 production browser tests passed in 10.6 seconds using Bun 1.4.2.** Tests use the real API, reducer, persistence, access-code endpoint, and cookie checks; no Playwright route mocks are used. Earlier browser failures were corrected and rerun rather than reported as passed.

## Environments and commands

The controller is `/home/big-daddy/Desktop/hackathon`. The standalone weather target is `/home/big-daddy/Desktop/hackathon-weather`, with its own Git history, dependencies, and root application. Candidate scope is `lib/temperature.ts` in the target; trusted checks and workflows stay with the controller. Control browser tests do not execute a generated weather patch.

```sh
cd /home/big-daddy/Desktop/hackathon
bun --no-env-file run lint
bun --no-env-file run typecheck
FDE_NEXT_DIST_DIR=.next-e2e FDE_DEMO_MODE=true bun --no-env-file run build
FDE_NEXT_DIST_DIR=.next-e2e bun --no-env-file run test:e2e
```

- Bun 1.4.2 package/script runner, Node.js 22 tool runtime, Next.js 16.3.5, React 19.2.8, Playwright 1.63.0, headless Chromium, Linux.
- Both browser servers always use the production build; create the isolated `.next-e2e` build above first. The verification build deliberately uses `FDE_DEMO_MODE=true`, while the hosted server overrides it to false at runtime. `/access` has `dynamic = "force-dynamic"`, so demo build settings cannot freeze the hosted access form.
- Production demo server: `127.0.0.1:3100`, explicit local/demo mode, isolated `.data/browser-tests.json`. Setup resets only that test file.
- Production access-gate server: `127.0.0.1:3101`, local bypass disabled, demo disabled, fixture access code/service key, empty Convex endpoint. These tests exercise the hosted gate over local HTTP; they do not claim a deployed HTTPS site was tested.
- The access server deliberately exposes setup state after admission because its backend is unconfigured. Actual fixed-operator behavior is tested in the Convex authorization suite.
- Demo identities simulate engineer/marketer/admin roles. Live Build, Go, reply, and persona decisions remain Slack-only. Shared hackathon access has no individual login attribution.
- The expiry test ages its pending fixture request under the isolated data-file lock, then uses the normal production API to request fresh authority.
- These browser/preflight runs make no paid model calls, live Slack decisions, social posts, or production releases. The app model is `gpt-5-mini`, and its displayed project cap is USD 100. Separate actual model/workflow smoke costs are recorded in their own artifacts.

## Browser results

| Scenario | Observed result |
| --- | --- |
| Provenance, budget/model, connections | Passed. Demo labels and USD 100 cap visible; account setup/reconnect works; real session import disabled and API-rejected in demo. |
| Manual intake, persistence, grouping/filtering | Passed. Reload retains signal, repeated interaction does not duplicate a case, source filters and navigation work. |
| Roles and workspace pause | Passed. Hidden unauthorized controls also reject direct API attempts; admin pause/resume persists. |
| Persona save/test/activate/revoke | Passed. Save creates inactive version; complaint preview refuses autonomy; activation stays pending until simulated marketer decision; revocation persists. |
| Local access and Slack authority | Passed. Local demo needs no login; the access page explains that live decisions remain in Slack. |
| Build/Go, draft invalidation, manual receipt | Passed. Exact edit revokes prior Go, new approval is needed, production and communication states remain separate, composer opening cannot complete publication. |
| Unknown publication | Passed. Retry/manual duplicate rejected until audited investigation; definitely-not-sent does not falsely confirm a reply. |
| Failed candidate recovery | Passed. Retry requires Build, creates new candidate/checks and fresh Go, and does not approve production or communication. |
| Cross-origin control mutation | Passed. Untrusted Origin rejected with HTTP 403 and no state change. |
| Infrastructure commitments | Passed. Bounded admin totals/reasons persist; role and missing-reduction-reason guards reject; no provider purchase occurs. |
| Fresh production evidence | Passed. Refresh is explicitly simulated; no new approval, receipt, or notification is invented; unauthorized role rejected. |
| Expired Build resubmission | Passed. Current request cannot duplicate; expired request is revoked and replacement remains pending until a new decision. |
| Supplemental human resolution | Passed. Confirmed engagement receipt remains immutable; another verified case supplies resolution evidence; exact approval and separate manual receipt required; follow-up remains manual-only. |
| Case cancellation | Passed. Before-dispatch and unresolved-publication outcomes differ; future advancement blocked; unknown receipt investigation remains available. |
| Hosted admission denial | Passed. Protected page redirects; API rejects before admission; wrong access code sets no cookie and clears the field. |
| Hosted admission success | Passed. Correct code opens setup workspace, sets HttpOnly/SameSite=Strict cookie invisible to JavaScript, and returns no service key. |
| Hosted tamper/origin checks | Passed. Tampered cookie loses access; foreign-Origin code submission rejected without a cookie. |

Playwright output is in `artifacts/browser-report/index.html`. The Bun build and browser run emitted Next.js notices about ignoring an unrelated parent-directory package-lock file, plus Playwright terminal-color notices. The build and all tests passed; no application errors occurred. The old runtime demo-file tracing warning was fixed using explicit runtime-file tracing exclusions without suppressing filesystem errors. Deleted sign-in route types were removed from the generated cache before the successful build.

## Supporting checks

`tests/integration/convex-auth.test.ts`: **15 passed** against actual Convex functions/schema/components. Missing/wrong keys fail on snapshots, commands, paid preview, imports, and manual receipts; bad configured secrets fail closed; forged identity claims cannot replace a key; rotation invalidates old keys. Valid access uses the fixed hackathon operator without exposing the key. Public internal/demo commands and Slack-role changes are denied, and workspace selectors cannot redirect writes.

`tests/integration/control-operations.test.ts`: **12 passed** covering budgets, unknown reservations, infrastructure initialization, stale/live/demo verification, fresh Build authority, and the policy/cancellation regression. Together with `control.test.ts`, **40 tests passed** after the final reducer correction. Full lint and TypeScript also passed after that correction.

Six updated preflight black-box checks passed: demo readiness without credentials; strict live missing-state rejection; valid hosted configuration and secret redaction; public-secret rejection; explicit-zero/invalid commitment checks plus Slack ID shapes; Reddit secrets confined to worker checks. Preflight made zero network calls. `.env.example` remains absent as requested.

## Visual inspection

Final production preview pages were inspected in Chromium at desktop 1365 × 900 and mobile 390 × 844. No `pageerror` events occurred, and case/controls pages had no document-level mobile overflow; wide tables scroll inside their containers. Case, persona, connection, and controls screenshots were refreshed after the access change. That prior preview used explicit demo mode at `http://127.0.0.1:3000`; the current brio development verification uses the preserved server at `http://127.0.0.1:3002`. Screenshots under `artifacts/ui/` supplement browser assertions and are not external-provider evidence.

## Remaining live and runtime evidence

| Capability | Remaining prerequisite / limitation |
| --- | --- |
| Hosted HTTPS access | Actual deployment, private access code/service key, and TLS cookie behavior; local production gate tests passed. |
| Live Slack decisions | Bot/signature/team/channel access plus exact engineer/marketer Slack ID allowlists. Local signed HTTP tests are separate from an actual workspace receipt. |
| X import/reconnect/send | Hosted worker, worker-only encryption keys, dedicated authorized session and platform capability. |
| Reddit publication | Conditional official API approval, OAuth account/community scope; controlled manual URL intake is supported, automated Reddit ingestion is absent. |
| GitHub/Linear/Vercel release | Actual separate target/controller repositories, protected checks, owned project and current deployment identity/behavior. Configuration alone does not establish a passed release. |
| Generated candidate pass-after | Reviewed restricted Docker runtime and actual candidate execution; current host could not access Docker. |
| Actual persona evaluation | [60-example live evaluation](../artifacts/live-persona-evaluation.json) passed: 20/20 eligible accepted and zero autonomous acceptance in 20 hard, 10 ambiguous, and 10 factual examples. Twelve gpt-5-mini calls cost USD 0.012922. Canonical-digest callback recovery replayed retained outputs without new calls; policy remains pending/unapproved. |
| Durable workflow smoke | Actual local gpt-5-mini triage now passed after a strict nullable-schema correction; [validated triage](../artifacts/durable-triage-validated.json) records USD 0.000359 settled and phase INVESTIGATING. Earlier failed attempts retain USD 0.009157 in unknown reservations. Reproduction/release is separate and remains unverified. |

The standalone protected baseline correctly reproduces the deliberate 20°C→20°F defect. The bounded OpenAI smoke records a real model output, not approval or publication. See [acceptance matrix](ACCEPTANCE-MATRIX.md) and the smoke artifacts for precise evidence and remaining gates. Finite tests do not establish universal correctness.

## Final brio production browser coverage

The production build at `.next-e2e` preserves the user’s running `.next` dev server. The 21-scenario suite passed 19 initially. Both new cross-tab/fallback tests initially searched for a separate case after submitting a complaint deliberately grouped into an existing canonical incident. Unique non-canonical complaint fixtures corrected that test assumption; both then passed in 12.7 seconds. The observer receives card movement with its HTTP snapshot endpoint blocked; a 503 stream failure recovers through polling and then native EventSource without reload. The 13-step autoplay/pause/resume/restart scenario passed in 29.7 seconds. All 21 scenarios have passing evidence across those runs; no complete 21-pass single rerun is claimed.

## Complete GitHub browser run

The fresh GitHub runner passed all **21 browser tests together in 1.4 minutes** on source commit `9da2b61`, after frozen installs and both production builds. Lint, TypeScript and all 490 automated tests also passed. [Run](https://github.com/Aarush-Dubey/hackathon/actions/runs/34782975073), [recorded summaries](../artifacts/github-ci-verification.json). This supersedes the earlier local split-run limitation above. Live provider decisions, browser accounts and deployment receipts remain separate prerequisites.

## Rich workspace — 2026-09-14

The local preview now has 38 incidents and 167 reports. All columns are populated with functional scrolling, excerpts, timestamps, varied routes and failures. The dashboard derives its charts from those records. The shared shell shows one compact Demo data indicator; stored fixture provenance remains available in operational records. Incident pages show persona name, draft version/status and reply text; engagement/support paths omit irrelevant build steps.

Next.js compilation/runtime error checks passed; agent-browser React tree and fiber inspection verified CasesView. Desktop board/dashboard and the 390×844 persona view were inspected. All 22 production browser scenarios passed. See [board](../artifacts/seed-board.png), [dashboard](../artifacts/seed-dashboard.png), [persona reply](../artifacts/seed-persona-reply.png), [mobile](../artifacts/seed-persona-mobile.png), and [verification data](../artifacts/seed-workspace-verification.json).
