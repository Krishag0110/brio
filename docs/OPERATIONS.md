# Operator runbook

Use the web control app for daily operation. Live Build, Go, exact-reply approval, and persona activation are decided in Slack; the app prepares requests and displays their status. Hosted workspace access uses a shared hackathon operator; actual live approval authority comes from the configured Slack role IDs. Fixture-only demo decisions are visibly labeled simulations.

The controller runs from `/home/big-daddy/Desktop/hackathon`; the weather app runs from the independent `/home/big-daddy/Desktop/hackathon-weather` repository. Start them in separate terminals with `bun run dev:demo` from the controller and `bun run dev` from the weather checkout. The control app is on port 3000; the weather app is on port 3001. Live case configuration must name the actual weather GitHub repository and baseline SHA, with a separate trusted controller repository/revision. Candidate patches are scoped to the target's `lib/temperature.ts`.

## Start a local demonstration

Open the control app after `bun run dev:demo`. Choose **Marketer (demo)** in the identity selector. On **Persona**, choose a preset, edit strategy and limits, save a version, test a friendly joke and a genuine complaint, and request activation. The policy remains pending until **Simulate policy approval** is selected. Test previews never authorize a public reply.

An active policy may authorize low-risk fixture engagement. A real complaint, unsupported language, opt-out, sensitive context, or validator disagreement must be suppressed or reviewed. Policy editing creates a new version; revocation blocks old-policy work.

## Engineering case

1. Choose **Engineer (demo)** and use **Cases → Add signal**. Keep the source mode **Labeled fixture** for a rehearsal. Preserve the exact source text and source URL when available.
2. For the weather defect, enter `20°C becomes 20°F when I toggle the unit.` Repeated intake of the same source interaction is deduplicated.
3. Open the case. **Advance demo workflow** records simulated reproduction and requests Build. **Simulate Build** is available to the engineer identity.
4. Advance the candidate stage, then switch to the marketer to review exact draft text and candidate evidence. **Simulate Go** authorizes that frozen version.
5. Advance simulated live verification. Production verification and customer communication remain separate facts. A ready-to-publish case is not yet a notified customer.

In live operation, the actual workflow/provider evidence replaces these simulated steps. Do not describe the demo buttons as a real build, deployment, or public send.

If the weather baseline needs to be restored for a new rehearsal, use a reviewed commit in the separate weather repository and start a new case against that exact revision. Existing candidate approvals bind their original baseline and do not authorize a different reset or deployment. Do not reset or modify the controller repository to reproduce the weather defect.

## Draft changes and approval

A marketer can edit an unpublished draft. **Save new draft version** changes the exact text/version and invalidates earlier reply/candidate authority. Request a fresh exact approval and review the new Slack card. A stale Go cannot authorize a changed candidate, persona, account, target, or reply batch.

No-go holds the case for review. No build ends the proposed engineering attempt without claiming a fix. Review dispositions and recovery reasons are recorded in audit history.

For an expired or revoked Build request in **Awaiting Build**, the engineer selects **Request fresh Build approval**. The live path requires the protected reproduction and canonical Linear issue already recorded. A fresh request remains pending until a new engineer decision; it does not start a build. A still-current pending Build cannot be duplicated.

When a delayed reply needs fresh evidence, an engineer or marketer selects **Verify current production again** in the case's engineering evidence panel. The live controller queues protected behavior and identity verification for the recorded candidate. A request is pending work, not successful verification; it does not renew expired approvals. In demo mode the button is **Simulate evidence refresh** and records fixture evidence without contacting a deployment.

## Connection outage and manual publication

The admin checks **Connections** for account, credential, and permission readiness. Reconnect or import the dedicated X session only through the authenticated live import flow. Demo mode rejects real session imports.

When the adapter is unavailable, the marketer uses the tracked manual composer for the approved text and target. Opening the composer does **not** mark the customer notified. Publish manually only when the case has current authority and no unresolved send, then record the actual reply URL and explicit attestation. Fixture receipts remain simulated.

To rehearse this fallback, an admin can select **Social session requires reconnect** under **Simulated failure scenario**. This changes only demo state. Switch to the marketer to open the composer and record a simulated receipt.

## Unknown publication outcome

If an automated engagement reply was already confirmed before a defect was recognized, keep that original receipt. A marketer can select **Prepare supplemental human resolution** on the engagement case, choose a different case with verified production evidence, and submit the exact factual text. The new record requires exact reply approval and separate manual attestation; it cannot create another automated send to the original interaction.

An unknown result freezes the interaction. Do not click send again or create a second manual reply. Both direct retry and manual-receipt shortcuts are rejected while the original send is unresolved.

A marketer or admin chooses **Investigate publication receipt**, records the investigation, and selects the truthful outcome:

- **Still unknown** keeps the interaction frozen.
- **Confirmed published** requires the verified receipt URL and explicit attestation.
- **Definitely not sent** records an explicit human investigation and reopens only the authorization-checked retry path. A timeout alone is not evidence of non-publication.

The demo admin can inject **Publication outcome unknown** only for an eligible fixture publication. Reconciliation does not itself claim a completed reply unless publication was confirmed.

## Failed checks, rollback, and pause

An engineer investigates failed candidate checks and records a recovery reason. A bounded retry must retain current Build authority, rerun candidate verification, and request a new Go. Clearing an error does not grant release authority.

Engineers/admins can request an audited rollback from case recovery. A rollback must retain the correct deployment/candidate evidence and cannot claim the customer was notified. In demo mode it changes fixture state only.

For a failed or uncertain live release, an engineer selects **Reconcile uncertain release**. The controller checks the recorded merge/promotion against provider state using the current exact Go. It cannot approve drift, rebuild a different candidate, or treat a lost response as a failed release.

Engineers and marketers can **Cancel future case work** with a reason. The recorded outcome distinguishes cancellation before dispatch, after confirmed effects, and with unresolved effects. Already dispatched work and confirmed receipts remain recorded; unknown publications still allow receipt investigation. Cancellation never reverses an external effect or silently resumes automated work.

Admins use **Controls & audit** to pause the workspace or a social account, inspect pending failures, and manage suppressions. A committed pause blocks subsequent dispatch; already dispatched work still needs reconciliation. Resume does not renew an expired approval or revoked policy.

Before any paid provider operation, check the recorded spend and reservations against the USD 100 ceiling. Missing, unbounded, or unknown costs require review; do not upgrade the approved `gpt-5-mini` model or enable an unregistered recurring service.

An admin records the **total infrastructure commitment (USD)** on **Controls & audit → Project budget**. Include hosting, builds, paid integrations, and renewal exposure, and explain every change. A reduction needs evidence that the exposure actually fell. Recorded commitments are included in reserved budget; the form cannot purchase a service, cancel a subscription, clear unknown model charges, or raise the ceiling.

## Handoff evidence

For each real run, retain the source mode, actor/role, approval binding, trusted evidence, candidate/deployment identity, exact public text, receipt, and outcome. Keep credentials out of notes and artifacts. Report an external-access failure as blocked and use the supported manual fallback. Browser screenshots supplement assertions and receipts; they do not establish live integration success.
