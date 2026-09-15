# brio — recording handoff

**Priority deliverable · 1 minute 40 seconds · 1920×1080 · 30 fps · no cursor · human voice-over**

This is the handoff for the person recording and editing the demo. The brand is **brio**, always lowercase; pronounce it “bree-oh.” Drizzle is the separate weather product brio supports.

## 1. Open these first

| Purpose | Link / location | What to expect |
| --- | --- | --- |
| Hosted brio — recommended for remote recording | https://mend-hackathon.vercel.app/cases | Persistent demo workspace: 39 imported cases, 168 reports, 3 personas, and workflow playback. Enter the existing workspace access code if prompted. |
| Local brio — recording backup | http://127.0.0.1:3002/cases | Populated demo board, deterministic playback, no provider delays. Already running on the development machine. |
| Hosted Drizzle weather app | https://mend-weather.vercel.app | Real deployed baseline. The conversion bug is deliberately still present. |
| Local persona example | http://127.0.0.1:3002/cases/MND-1071 | Existing completed fixture with Playful Challenger and a “bruh” reply. |
| Local persona policy | http://127.0.0.1:3002/persona | Persona editor and examples. |
| Completed workflow backup | http://127.0.0.1:3002/cases/case_mu09uehu_u | Existing completed fixture; use for detail shots if a new run is interrupted. |
| Controller repository | https://github.com/Aarush-Dubey/hackathon | brio application, backend, workers and docs. |
| Separate weather repository | https://github.com/Aarush-Dubey/hackathon-weather | Intentionally buggy target application. |

**Remote recorder:** use the hosted board above. The local demo dataset has now been imported into a separate persistent Convex demo workspace. Run workflow, Pause, Resume, Restart and persona screens work there. The global model/budget strip, Demo data badge and View as selector have been removed for the public presentation. `127.0.0.1` remains a backup available only on the development machine. The hosted and local copies evolve independently; new verification or recording runs add cases.

The hosted access code is the value of `CONTROL_ACCESS_PASSWORD` in the private `/home/big-daddy/Desktop/hackathon/.env` file. The project owner should share that code privately if needed. Never film this file, tokens, cookies, CLI login pages or service configuration screens.

## 2. Exact accounts — do not guess

| Service / role | Use this | Notes |
| --- | --- | --- |
| X account connected to brio | **@Vinaychamoc5** — https://x.com/Vinaychamoc5 | This supersedes all earlier handles. The verified normal Chrome login was in **Profile 3**. Confirm the profile handle before a real recording. |
| Customer-facing product | **Drizzle** | Product name, not proof that we own `@Drizzle`. Use “Drizzle” in complaint text; use `@Vinaychamoc5` if a real mention is needed. |
| Slack workspace | **BitsUp** | Workspace ID `T0C1G4Z2H5L`. |
| Slack channel | **#mend-approvals** | Channel ID `C0C1324SFF1`. The infrastructure name is unchanged. |
| Product engineer | **Ellen** | Slack member ID **`U0C1L62486M`**. “Elen” occurs in older setup notes; the ID determines authority. |
| Marketer | **David** | Slack member ID **`U0C1DJRE4KF`**. |
| Registered Slack application | **Mend** | The installed Slack app still has its old registration name; the product interface is **brio**. Do not create another Slack app for this recording. |
| Reddit | **Skip it** | Explicitly disabled/deferred. No Reddit account or footage is needed. |

The X session is verified, the connection is ready, and posting capability is enabled under the account owner’s instruction. **Background social polling is off.** An X post will not currently appear automatically just because it was posted. No complete live X → fix → reply run has been verified. Do not spend the recording session trying to discover missing automation steps.

## 3. How the product works, end to end

1. **Social signal:** an incoming complaint becomes a brio case. Original report context and provenance stay attached; related reports should tell one issue story.
2. **Triage and QA:** classify whether this is a real defect, a known remedy, or low-risk engagement. For a defect, reproduce the behavior and collect evidence. The video’s “QA / Clarifying Agent” corresponds to the investigation/evidence step; the board need not contain a column with that exact name.
3. **Engineer approval in Slack:** Ellen reviews the reproduction, proposed plan, repository revision and allowed change scope. **Build** grants permission to implement that scoped change; **No Build** stops it.
4. **Engineering:** a restricted GitHub workflow runs the coding work in an isolated GCP-hosted sandbox image, prepares a candidate PR, and runs independent protected checks against the separate weather repository. Linear holds the engineering ticket.
5. **Candidate preview:** demonstrate the candidate fixing the unit conversion. This is a preview, not yet the approved production release.
6. **Marketer approval in Slack:** David reviews the candidate evidence and the **exact** customer reply. **Go** authorizes that candidate and reply. If David edits the text, it becomes a new version and needs fresh approval. For a smooth recording, approve the already prepared message.
7. **Release and verification:** after Go, release/promote the approved candidate, verify the deployed identity and actual behavior, then permit publication.
8. **Customer response:** reply to the original X interaction, confirm the actual receipt, and only then show the case as resolved/notified. A ready-to-send draft is not a posted reply.
9. **Personality route:** a harmless “please make it rain” joke is not an engineering bug. A current marketer-approved persona can authorize a short, low-risk reply. Real complaints must not be dismissed with a roast.

**Critical story order:** candidate checks → David’s Go → production release/live verification → X reply → confirmed receipt. Do not show production already released before David’s approval.

## 4. Choose the recording mode before starting

**Recommended for this deadline: a staged product walkthrough.** Record the real brio interface and its deterministic hosted or local workflow, with scripted X and Slack scenes for the same fictional customer story. The user explicitly authorized a staged/hardcoded recording path. These scenes demonstrate the intended experience; they do not prove live provider execution.

Keep the staging description in the handoff and export metadata, and include a discreet “Staged product walkthrough” caption at the beginning or end of the film. The UI can otherwise remain clean. Hosted demo records are isolated from the live integration workspace and retain fixture provenance. Never present those receipts or approval events as proof of actual Slack, GitHub, weather deployment or X execution.

| Shot | Reliable source now | Live limitation |
| --- | --- | --- |
| X notification, three complaints, final reply | Scripted local X scene with fictional customers | No real customer complaint/reply sequence has been verified. |
| brio grouped-intake shot | Scripted scene with three fictional reports attached | **Run workflow creates one report, not three.** This shot must be staged explicitly. |
| brio card transitions | Hosted or local **Run workflow** playback, or the same scripted three-report board throughout | Its approvals, checks and publication receipts are fixtures. Keep report count and case identity consistent across cuts. |
| Ellen / David Slack decisions | Scripted Slack scene, or actual Slack only after a controlled live run exists | Demo autoplay does not send Slack cards. |
| Corrected weather behavior | Staged **candidate preview**, followed by staged approved-release verification | The actual hosted weather baseline still intentionally has the bug. |
| Persona reply “bruh 💀” | Scripted scene using the approved-policy concept | Existing seeded persona case has a longer “bruh” reply; do not claim it already contains the exact shorter text. |

The full live route still needs a controlled engineer Build, GitHub OIDC/candidate execution, David’s Go, verified release and real X receipt. It is not the dependable one-take recording route today.

## 5. Record the hosted board (local backup available)

1. Open **https://mend-hackathon.vercel.app/cases** and enter the privately shared workspace access code. The local backup is **http://127.0.0.1:3002/cases**; keep that server alive and do not reset `.data/demo-state.json`.
2. Click **▶ Run workflow**. If an earlier run exists, use **↻ Restart** to create a fresh case.
3. Follow the new card titled **Weather conversion: 20°C → 20°F**. Use the same new case throughout your shots. **This playback creates one source report.** For the three-complaint story, use the scripted three-report incident consistently for the grouped-intake and board shots; raw autoplay alone does not demonstrate that grouping. Treat autoplay as a motion/control reference or backup, and never cut between mismatched report counts or case IDs.
4. The card traverses **Detected → Triaged → Build approval → Fixing → Verifying → Reply approval → Resolved**. There are 13 events, roughly 24–26 seconds total, with later events two seconds apart.
5. Use **Ⅱ Pause** and **▶ Resume** to hold readable states. Pause before cutting away to the Slack shot, then resume for the next board section. Editing can extend the holds to the timings below.
6. Autoplay simulates both approvals automatically. **Do not mix manual approvals or case edits into an autoplay case**; its state checks can pause playback.
7. Open the completed case for the customer response and event history. The prepared fixture reply is:

> Our calculator needed coffee. Fixed: 20°C now correctly shows 68°F. Thanks for catching it.

8. For personality footage, open **https://mend-hackathon.vercel.app/cases/MND-1071**. Its existing response is:

> 90% chance of rain. 100% commitment to the outfit. Respectfully: bruh.

This is a backup persona shot, not the exact “make it rain” example. Use the scripted scene for that exact example and **bruh 💀** response.

**For approval shots:** use Run workflow with Pause/Resume and the matching Slack scenes described above. The presentation no longer exposes a View as role selector. Live engineer and marketer authority remains attached to their Slack identities.

**Only if the local server is not running:**

```bash
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon
bun run dev:demo --port 3002
```

Leave that terminal open. If port 3002 is already in use, first check whether the existing app works; do not kill it or start another instance unnecessarily.

## 6. Exact story data for all scripted scenes

Use fictional customers, one consistent incident, and the same original post throughout.

- Original: **“Drizzle, 20°C turns into 20°F when I switch units. Shouldn’t that be 68°F?”**
- Similar report 2: **“Same here. The number stays the same when I switch to Fahrenheit.”**
- Similar report 3: **“Can reproduce on my phone too. Please fix the unit toggle.”**
- Case title: **Weather conversion: 20°C → 20°F**.
- QA evidence: **Actual 20°F · Expected 68°F · conversion reproduced**.
- Build plan: **Correct Celsius/Fahrenheit conversion in `lib/temperature.ts`; test 20, 0, −40 and 100°C plus repeated toggles.**
- Engineer scene: **Ellen → Build**. Keep **No Build** visible as the alternative.
- Marketer scene: **David → Go** on the exact reply quoted above. Optional visible comment: **“Accurate and on-brand. Go.”**
- Candidate/approved-release result: **20°C → 68°F**. Do not switch to unrelated example temperatures mid-story.
- Personality post: **“Drizzle, please make it rain. My plants are judging me.”**
- Personality routing: **Non-bug · Playful Challenger · No engineering action**.
- Personality reply: **bruh 💀**.

## 7. The 100-second film and exact voice-over

No long intro, separate title sequence or closing slide outside these timings. Record the narration in a human voice, in complete thoughts. The timeline is an editing guide, not an instruction to pause at every second. Use a calm conversational delivery and allow viewers time to read the approvals.

| Time | What the viewer sees | Exact voice-over |
| --- | --- | --- |
| 00:00–00:05 | **X notification:** Open the original complaint; show Drizzle and the unit-toggle problem. | Three customers are reporting the same problem with Drizzle. |
| 00:05–00:12 | **X thread:** Show the original and two similar complaints. Keep all three legible. | “Twenty Celsius becomes twenty Fahrenheit.” “Same here.” “Please fix the toggle.” |
| 00:12–00:19 | **brio intake:** Show one incident with the related reports, then its card moving from Detected to Triaged. | brio groups those reports into one incident, keeping each original post attached. |
| 00:19–00:26 | **brio QA:** Open investigation evidence: actual 20°F, expected 68°F. Move toward Build approval. | The QA agent reproduces the bug. Twenty Celsius should be sixty-eight Fahrenheit. |
| 00:26–00:35 | **Slack / Ellen:** Show Ellen reviewing the build plan, Build / No Build, then Build approved. | Ellen gets the evidence and proposed change in Slack. She reviews the scope and clicks Build. |
| 00:35–00:45 | **brio engineering:** Show the same card moving through Fixing and Verifying. Briefly show the scoped patch and checks. | Now brio starts the fix. The same card moves through engineering, with the patch and test results attached. |
| 00:45–00:54 | **Candidate preview:** Show the candidate preview changing 20°C to 68°F. This is before production release. | The candidate passes its checks. In the preview, twenty Celsius now converts to sixty-eight Fahrenheit. |
| 00:54–01:06 | **Slack / David:** Show the exact reply and candidate evidence. David approves Go; hold the approval for two seconds. | David reviews the proposed customer reply alongside the evidence. He approves Go, authorizing this candidate and this exact message. |
| 01:06–01:16 | **brio release / live check:** Show release, verification of the approved deployment, and 20°C to 68°F. Then ready to reply. | brio releases the approved change, checks the live version, and confirms the conversion works before replying. |
| 01:16–01:28 | **X reply / receipt:** Return to the SAME original post, reveal the approved reply, then show the receipt and resolved case. | Back on X, the original customer gets the update. The reply receipt closes the case, with both human decisions recorded. |
| 01:28–01:35 | **X personality example:** Show “Drizzle, please make it rain.” Briefly show non-bug routing and the approved Playful Challenger policy. | But “Drizzle, please make it rain” isn’t a bug. That’s a job for the brand’s personality. |
| 01:35–01:40 | **X persona reply:** Reveal “bruh 💀”. Hold it through the final frame. No engineering ticket. | The approved playful persona keeps it short: “bruh.” |

The companion [second-by-second voice-over sheet](brio-VOICEOVER-100S.md) contains all 100 one-second slots and the continuous reading script. [Subtitle timing](brio-VOICEOVER-100S.srt) is supplied for optional captions.

## 8. Cursor-free capture and a clean edit

- Deliver **exactly 100.000 seconds**, **1920×1080**, **30 fps**, H.264 MP4, with the human voice-over added separately or as the final audio track.
- Disable cursor capture in the recorder. Turn off click highlights, touch circles and pointer trails. Check a short exported sample before recording the whole film.
- A deterministic browser-frame render avoids capturing the operating-system pointer entirely. Local browser scenes should also set `cursor: none` on all elements.
- Keep browser zoom and window size fixed. Close unrelated tabs/popups and disable desktop notifications. Never expose credentials, account menus, developer tools or terminal output.
- Use button press states and clear status changes to communicate Ellen’s Build and David’s Go without showing a pointer. Hold each approval and the **68°F** result for at least two seconds.
- Show the same incident moving across the board. Use short, direct cuts between apps; avoid spinning transitions, excessive zooms, stock footage, generated avatars, synthetic voices or music that fights the narration.
- Treat the complaints as a small, believable product issue. Do not invent viral metrics or claim a real customer endorsed the fix.
- Keep all brand text lowercase **brio**. Slack’s actual registration and existing URLs may still contain `mend`; they are not new accounts to configure.

## 9. Existing local scripted-film assets

The workspace already contains **`artifacts/brio-demo-film/film.html`** and **`artifacts/brio-demo-film/render.mjs`**. They are local staged scenes, not the hosted product. The renderer produces exactly 3,000 browser frames and a silent 100-second MP4; it does not send posts or Slack messages.

**These assets are a starting point, not an approved final cut.** Before export, align them with this handoff: lowercase brio, correct account/channel labels, consistent 20°C/68°F values, candidate preview before Go, production verification after Go, and this exact voice-over timeline. Existing scene timing and some labels differ. Do not hand over an unreviewed render as complete.

For the technical operator, after aligning those scenes:

```bash
export PATH="/home/big-daddy/.bun/bin:$PATH"
cd /home/big-daddy/Desktop/hackathon
bun --no-env-file artifacts/brio-demo-film/render.mjs preview
bun --no-env-file artifacts/brio-demo-film/render.mjs render
```

The current script writes its output under `artifacts/brio-demo-film/`; the existing filename is `Brio-Drizzle-Demo-1080p.mp4`. Rename the delivery to **`brio-drizzle-demo-100s.mp4`**. Its encoder and probe are installed under `/tmp/brio-video-tools/`; if that temporary directory is gone, restore the tooling before running. Do not run a long encode until preview frames and timing have been reviewed.

## 10. Two-person division of work

**Person A — technical operator:** prepare and rehearse the local board; keep the selected case consistent; prepare staged X/Slack/weather scenes; verify the exact accounts and approval order; capture/export cursor-free visuals. Do not change real provider settings or run public actions merely for a screenshot.

**Person B — narrator/editor:** record the supplied continuous script in a natural voice; match shots to the 100-second timeline; make approval and temperature text readable; add optional captions; check duration, audio and cursor absence; export the final master.

At handoff, Person A supplies the silent master, source scene files and the chosen case URL. Person B supplies the narrated master and retains the uncompressed voice recording. Both inspect the final 10 seconds so the persona reply is not cut off.

## 11. Final acceptance checklist

- [ ] Exactly 1:40; no cursor, pointer ring, click highlight or credentials in any frame.
- [ ] First scene starts on X and shows the original plus two related complaints.
- [ ] One incident visibly moves through brio; QA evidence explains the real bug.
- [ ] Ellen visibly approves Build; David visibly approves Go on the exact response.
- [ ] Candidate preview precedes Go; production release/verification follows Go.
- [ ] Corrected conversion is consistently 20°C → 68°F.
- [ ] Reply is visibly attached to the original customer post; resolution follows a receipt.
- [ ] The second example clearly takes the persona route and creates no engineering work.
- [ ] The closing reply is **bruh 💀** and remains readable until the end.
- [ ] All product branding is lowercase **brio**, and staged scenes are disclosed as a product walkthrough.
- [ ] Human voice-over sounds natural and matches the cuts; no generated voice is required.

This handoff describes how to record the demo. It is not a claim that a final narrated video or a complete live customer-resolution run has already been produced.
