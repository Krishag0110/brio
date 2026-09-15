# Core contracts

These modules contain pure, framework-independent business rules. They perform no network calls, publish no content, and spend no money. `index.ts` exports their public APIs.

- `approvals.ts`: immutable Build, candidate Go, reply-only, and persona-activation bindings; role-bound decisions; independent request and accepted-grant lifetimes. Persist the original approval payload. Regenerate its binding from current corresponding fields before an undispatched effect.
- `persona.ts`: runtime policy schemas, three presets, deterministic exclusions, exact-draft checks, UI adaptation, and labeled fixture previews. `previewPersona` intentionally does not activate a policy. Production eligibility requires separate model classification and validation calls, followed by these deterministic checks.
- `publication.ts`: final common publication guard, interaction reservations, uncertain-result freezing, and receipt validation. A current exact human approval can authorize benign engagement without standing autonomy. Reply purpose independently controls live evidence, including renewed reply-only fix announcements.
- `release.ts`: exact-head/tree/deployment checks and persisted merge/promotion recovery. A recorded merge advancing main is expected; unrelated drift blocks. Unknown promotion status reconciles before retry.
- `budget.ts`: immutable worst-case reservations under the aggregate $100 ceiling, category and per-case envelopes, unknown-charge retention, and bounded retries. Monetary comparisons use integer microdollars. A retry needs a separate reservation.
- `jobs.ts`: runtime job/result contracts, operation-specific output identity checks, late-effect reconciliation, and navigation allowlists.
- `signals.ts`: untrusted text preservation, URL/ID normalization, fixture namespaces, conservative structured grouping, and fictional remedy seeds.

## Persistence boundaries

The calling Convex mutation must atomically persist reservations, uniqueness, counters, dispatch state, and approval decisions. Calling a pure helper without an authoritative transaction does not provide concurrency control. Derive Slack roles, policies, grants, target state, evidence, and connection readiness from trusted server records; never accept those assertions directly from a browser or model.

`publicationGuard` is a dispatch check. Freshness means a successful protected live check within five minutes, plus a production identity observation within ten seconds immediately before dispatch. The external worker still needs its platform-specific parent/context/contact-intent and length checks. Hold publication if the external observation is unavailable. No text is trimmed or rewritten after approval.

Confirmed receipts and unknown attempts must remain in the shared interaction ledger. Explicit not-sent investigations record residual uncertainty. Supplemental human receipts link to the existing record without enabling another automatic send. Simulated receipts keep `mode: "fixture"`.

`hashText` computes synchronous UTF-8 SHA-256 for reducers and Convex mutations. `canonicalJson` provides deterministic exact-field serialization; it is not itself a cryptographic digest.

## Local evidence

Run `npx vitest run tests/core tests/integration/control.test.ts`. The versioned 60-case persona dataset is in `tests/core/persona-evaluations.ts`: 20 eligible, 20 hard exclusions, 10 ambiguous, and 10 factual support/resolution cases. These deterministic evaluations validate implementation behavior and fixture wording. They do not claim that real model evaluations, social publication, hosted access, or external deployment checks have run.
