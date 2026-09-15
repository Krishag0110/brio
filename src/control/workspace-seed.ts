import { decideApproval } from "../core/approvals";
import { canonicalJson, hashText } from "../core/domain";
import { normalizeSignal } from "../core/signals";
import { requestAuthority } from "./reducer";
import type { ControlState, InternalCase } from "./types";

export const WORKSPACE_SEED = "mend-workspace-v1";
type Scenario = {
  title: string; text: string; phase: string; component: string; reports: number;
  route?: "known_remedy" | "social_engagement"; reply?: string; persona?: string;
  finding?: string; blocked?: string;
};

// Fictional product conversations. Never import these into live state or enqueue provider jobs.
const scenarios: Scenario[] = [
  { title: "Rain alerts arrive after the rain", text: "Got the 'rain in 10 minutes' notification while already standing in a puddle. Bengaluru, Android 15. Happened twice this morning.", phase: "RECEIVED", component: "rain-alerts", reports: 7 },
  { title: "Saved cities disappear after refresh", text: "I save Pune and Mumbai, refresh the page, and both cities disappear. The default city is all that's left.", phase: "TRIAGING", component: "saved-cities", reports: 5 },
  { title: "Sunrise time jumps across time zones", text: "Flying London to Delhi changed my saved London's sunrise to 11:40. Looks like it is using my phone's time zone.", phase: "RECEIVED", component: "sunrise-time", reports: 3 },
  { title: "The forecast has personal beef with my picnic", text: "Every time I plan a picnic your rain percentage goes up. Is this personal, drizzle?", phase: "TRIAGING", component: "community", reports: 1, route: "social_engagement", persona: "challenger", reply: "We checked. The clouds have your calendar. ☁️" },
  { title: "Hourly forecast repeats 2 AM at DST change", text: "New York forecast shows 2 AM twice on the clock-change weekend, but the temperatures differ. Which hour should I use?", phase: "INVESTIGATING", component: "hourly-forecast", reports: 6, finding: "Repeated local labels lose the UTC offset. Compare both instants across the daylight-saving boundary." },
  { title: "Location permission gets stuck in a loop", text: "Safari keeps asking for my location even after I allow it. The weather never loads unless I type the city manually.", phase: "INVESTIGATING", component: "location-permission", reports: 8, finding: "Permission succeeds but the geolocation state resets when the page regains focus." },
  { title: "Weather widget stops updating overnight", text: "The home-screen widget still says yesterday's weather at 8 AM. Opening the app fixes it. Pixel 9, battery saver off.", phase: "INVESTIGATING", component: "widget-refresh", reports: 4, blocked: "needs_evidence", finding: "Waiting for background-refresh logs and the Android build number to isolate the scheduling failure." },
  { title: "Help finding the feels-like temperature", text: "Where did feels-like move after the update? I can see the actual temperature but not the one that accounts for humidity.", phase: "INVESTIGATING", component: "weather-details", reports: 2, route: "known_remedy", persona: "support", reply: "Open your city forecast, then tap today's temperature. Feels-like is in the details panel just below humidity." },
  { title: "Celsius toggle changes the label, not the value", text: "20°C becomes 20°F when I tap the unit toggle. That is a very different jacket situation. Shouldn't it be 68°F?", phase: "AWAITING_BUILD", component: "temperature-conversion", reports: 12, finding: "20°C displays as 20°F; expected 68°F. Conversion currently returns the input unchanged.", reply: "Our calculator needed coffee. 20°C now correctly shows 68°F. Thanks for catching it." },
  { title: "Negative temperatures lose the minus sign", text: "It is -6°C in Oslo but the forecast card says 6°. The hourly chart is right; the big number at the top isn't.", phase: "AWAITING_BUILD", component: "temperature-format", reports: 5, finding: "The hero formatter applies an absolute value before rendering. Hourly data keeps the sign." },
  { title: "Wind direction rotates the wrong way", text: "The wind says NW but the arrow points southeast. Noticed this in three cities on desktop and mobile.", phase: "AWAITING_BUILD", component: "wind-direction", reports: 4, finding: "Meteorological direction is interpreted as the destination rather than the origin of the wind." },
  { title: "UV index rounds 0.4 up to a warning", text: "The UV panel says moderate risk at night with an index of 0.4. I think the threshold labels are shifted.", phase: "AWAITING_BUILD", component: "uv-index", reports: 3, finding: "Risk thresholds use the display bucket rather than the unrounded index." },
  { title: "Unit preference resets on every visit", text: "I use Fahrenheit. Every new tab sends me back to Celsius even though the settings screen still says Fahrenheit.", phase: "BUILDING", component: "unit-preference", reports: 9, finding: "Initial render overwrites the stored unit before hydration reads the preference." },
  { title: "Forecast cards overflow on iPhone SE", text: "The last two forecast days are cut off on my iPhone SE. I can scroll the whole page sideways, which also hides the menu.", phase: "BUILDING", component: "forecast-layout", reports: 6, finding: "The seven-day grid has a fixed minimum width larger than the viewport." },
  { title: "Repeated toggles leave stale temperature", text: "Tap C/F quickly a few times and the unit says C while the temperature is still Fahrenheit. Slow taps work.", phase: "BUILDING", component: "unit-state", reports: 7, finding: "The value and label update independently; one state transition needs to derive both." },
  { title: "Search picks the wrong Springfield", text: "Selecting Springfield, Illinois opens Springfield, Missouri. Both are in search results but resolve to the same weather.", phase: "BUILDING", component: "city-search", reports: 3, finding: "Search selection uses the city name as a key, losing the region and coordinates." },
  { title: "Humidity chart clips at 100%", text: "The 100% humidity point vanishes from the chart during rain. Everything below it is visible.", phase: "VERIFYING_CANDIDATE", component: "humidity-chart", reports: 4, finding: "Added top padding to keep the maximum-value marker inside the plot area." },
  { title: "Forecast day labels shift after midnight", text: "At 00:05 it still calls yesterday 'Today'. Refreshing doesn't help until the next forecast update.", phase: "VERIFYING_CANDIDATE", component: "forecast-date", reports: 8, finding: "Day labels now derive from the city-local date instead of the forecast fetch timestamp." },
  { title: "Keyboard focus skips the unit switch", text: "Tab goes straight from the city search to the seven-day forecast. I cannot reach C/F without a mouse.", phase: "VERIFYING_LIVE", component: "unit-accessibility", reports: 3, finding: "The toggle is now a native button with a visible focus ring and a pressed state.", reply: "The unit switch now works with Tab, Enter, and Space. Thanks for pointing out the keyboard gap." },
  { title: "Offline banner covers the retry button", text: "On mobile, the offline banner sits on top of Retry. As soon as I get signal back I still can't tap it.", phase: "VERIFYING_CANDIDATE", component: "offline-state", reports: 5, blocked: "checks_failed", finding: "Desktop checks passed; the 390px viewport regression still finds an overlapping banner." },
  { title: "Rain probability shows NaN for missing hours", text: "Tomorrow morning's rain row says NaN% for two hours. The rest of the day looks normal.", phase: "AWAITING_GO", component: "rain-probability", reports: 6, finding: "Missing probability values now display a dash and never enter percentage arithmetic.", reply: "Those mystery NaN% hours now show a dash when forecast data is unavailable. Thanks for catching the gap." },
  { title: "Snow depth displays centimeters as inches", text: "The snowfall total is 12 inches here but the source says 12 cm. That's a pretty big difference for my driveway.", phase: "AWAITING_GO", component: "snow-units", reports: 4, finding: "Snow depth converts with the selected measurement system; checked zero and fractional values.", reply: "Snow totals now convert correctly between centimeters and inches. Your driveway can exhale." },
  { title: "How to stop the daily morning summary", text: "I like the rain alerts but don't need the morning summary every day. Can I turn off just that one?", phase: "AWAITING_GO", component: "notification-settings", reports: 3, route: "known_remedy", persona: "support", reply: "Yes. In Settings → Notifications, turn off Morning summary and leave Rain alerts on. They're controlled separately." },
  { title: "One too many refreshes", text: "refresh refresh refresh. still raining. starting to think this button doesn't control the sky.", phase: "AWAITING_GO", component: "community", reports: 1, route: "social_engagement", persona: "challenger", reply: "bruh the clouds aren't taking feature requests 😭" },
  { title: "Feels-like value now respects selected units", text: "Actual temperature is in Fahrenheit but feels-like is still Celsius. Seeing 75° next to 'feels like 23°' is confusing.", phase: "READY_TO_PUBLISH", component: "feels-like-units", reports: 7, finding: "Both temperatures now use the same selected unit and rounding function.", reply: "Feels-like and actual temperature now speak the same unit. Thanks for spotting the mismatch." },
  { title: "Storm alert reply needs a human handoff", text: "Thanks for fixing the duplicate storm notification. Can you confirm this won't turn off the next real alert?", phase: "AWAITING_MANUAL_CONFIRMATION", component: "alert-deduplication", reports: 2, persona: "support", finding: "The deduplication key includes alert identity; distinct future alerts remain separate.", reply: "The change removes repeated copies of the same alert. It doesn't disable notifications for new alerts." },
  { title: "Dark mode flash on page load", text: "Love dark mode, but opening the app gives me a full white flash first. My eyes were not ready for sunrise indoors.", phase: "COMPLETED", component: "theme-persistence", reports: 8, finding: "The saved theme is applied before the initial paint.", reply: "Indoor sunrise cancelled. Your saved dark theme now loads from the first frame." },
  { title: "Decimal temperatures rounded twice", text: "A station reading of 18.4°C displays as 64°F instead of 65°F. Looks like you round before converting.", phase: "COMPLETED", component: "temperature-rounding", reports: 5, finding: "Conversion uses the raw reading; rounding happens once at the display boundary.", reply: "Fixed. We now convert the full reading before rounding, so 18.4°C correctly shows 65°F." },
  { title: "City switch leaves yesterday's forecast", text: "Switching from Chennai to Delhi changes the title but keeps Chennai's hourly forecast until I refresh.", phase: "COMPLETED", component: "forecast-cache", reports: 9, finding: "Forecast cache keys now include coordinates and the requested time zone.", reply: "City hopping works again. The hourly forecast now updates with the city you select." },
  { title: "This forecast saved my laundry", text: "Your rain alert gave me exactly enough time to get the laundry in. Actual hero behavior. Thanks drizzle.", phase: "COMPLETED", component: "community", reports: 1, route: "social_engagement", reply: "Laundry: 1. Surprise rain: 0. We've got you. ☀️" },
  { title: "A gentle roast for the umbrella optimist", text: "I ignored your 90% rain forecast, wore white shoes, and got soaked. Roast me. I deserve this one.", phase: "COMPLETED", component: "community", reports: 1, route: "social_engagement", persona: "challenger", reply: "90% chance of rain. 100% commitment to the outfit. Respectfully: bruh." },
  { title: "Weekend plans, weather permitting", text: "The forecast finally says sunny for Saturday. Please don't let the clouds see this post.", phase: "COMPLETED", component: "community", reports: 1, route: "social_engagement", reply: "Keeping this between us and literally the entire atmosphere. ☀️" },
  { title: "Recovering an accidentally removed city", text: "I removed my home city from favorites by accident. Is there a way to add it back without resetting everything?", phase: "COMPLETED", component: "saved-cities-help", reports: 2, route: "known_remedy", persona: "support", reply: "Search for your city and tap the star beside its name. It returns to Favorites without changing your other saved cities." },
  { title: "Reduce motion for animated weather", text: "Is there a way to turn off the moving rain background? It is distracting when I'm reading the hourly forecast.", phase: "COMPLETED", component: "accessibility-settings", reports: 3, route: "known_remedy", persona: "support", reply: "Enable Reduce motion in your device's accessibility settings. Drizzle follows that preference and keeps the forecast animation still." },
  { title: "Tiny weather icons, big appreciation", text: "The little cloud icons in the new forecast are so good. Whoever made these deserves a coffee.", phase: "COMPLETED", component: "community", reports: 1, route: "social_engagement", reply: "Passing this directly to the cloud department. Coffee forecast: very likely." },
  { title: "Loading spinner never clears after retry", text: "After an offline retry, the weather is visible but the loading spinner stays over it. Happens on Chrome mobile.", phase: "COMPLETED", component: "loading-state", reports: 6, finding: "The successful retry clears the loading flag in the same state update as the forecast.", reply: "The forecast no longer comes with a permanent loading spinner. Retry now clears it as soon as your weather is ready." },
];

const authors = ["rhea_runs", "cloudwatch_kai", "mira_cycles", "neelbuilds", "sam_on_trails", "sundaywithjo", "aria_in_motion", "dev_undercloud", "ishaan.png", "tess_outside", "rohan_rides", "luna_forecasts"];

export function seedWorkspace(input: ControlState, now = Date.now()): { state: ControlState; added: number } {
  if (input.mode !== "demo") throw new Error("workspace_seed_demo_only");
  const state = structuredClone(input);
  let added = 0;
  scenarios.forEach((scenario, index) => {
    const id = `MND-${1041 + index}`;
    if (state.cases.some(c => c.id === id || c.signals.some(s => s.fixtureNamespace === `${WORKSPACE_SEED}:${id}`))) return;
    if (state.cases.length >= 90) return; // Leave room for interactive runs and manual intake.
    const route = scenario.route ?? "engineering_resolution";
    const complete = scenario.phase === "COMPLETED";
    const ageHours = complete ? 24 + ((index * 19) % 120) : index < 4 ? (index + 1) / 4 : 1 + (index * 7) % 55;
    const created = now - ageHours * 3_600_000;
    const platform = index % 3 === 1 ? "reddit" : "x";
    const signals = Array.from({ length: scenario.reports }, (_, n) => normalizeSignal({
      workspaceId: state.workspaceId, platform, sourceMode: "fixture", fixtureNamespace: `${WORKSPACE_SEED}:${id}`,
      localId: `${id}-report-${n + 1}`, originalUrl: "", authorId: authors[(index + n) % authors.length],
      text: n === 0 ? scenario.text : [
        `Seeing this too: ${scenario.title.toLowerCase()}. It happens again after reopening the app.`,
        `Can reproduce on my phone. ${scenario.text}`,
        `Same issue here. ${scenario.title}. Happy to share more details if it helps.`,
        `Adding another report for this. ${scenario.text}`,
      ][(n - 1) % 4], observedAt: created + n * 60_000,
      productId: "drizzle", deployedRevision: "sample-2026.09", component: scenario.component, symptomSignature: scenario.component,
    }));
    const personaId = scenario.persona ?? "friendly";
    const persona = state.personas.find(p => p.id === personaId) ?? state.personas[0];
    const late = ["AWAITING_GO", "READY_TO_PUBLISH", "AWAITING_MANUAL_CONFIRMATION", "COMPLETED"].includes(scenario.phase);
    const hasCandidate = route === "engineering_resolution" && ["VERIFYING_CANDIDATE", "VERIFYING_LIVE", "AWAITING_GO", "READY_TO_PUBLISH", "AWAITING_MANUAL_CONFIRMATION", "COMPLETED"].includes(scenario.phase);
    const verified = route === "engineering_resolution" && ["READY_TO_PUBLISH", "AWAITING_MANUAL_CONFIRMATION", "COMPLETED"].includes(scenario.phase);
    const record: InternalCase = {
      id, title: scenario.title, text: scenario.text, createdAt: new Date(created).toISOString(), sourcePlatform: platform,
      sourceMode: "fixture", route, phase: scenario.phase, blockingReason: scenario.blocked,
      productionVerified: verified, communicationStatus: complete ? "simulated_confirmed" : late ? "draft_ready" : "not_started",
      outcome: complete ? route === "social_engagement" ? "engaged" : route === "known_remedy" ? "remedy_delivered" : "fixed_and_notified" : undefined,
      version: 1, planVersion: 1, baseSha: hashText(`${WORKSPACE_SEED}:base`).slice(0, 40), repository: "sample/drizzle-weather",
      scope: ["lib/temperature.ts"], signals, approvals: [], publications: [],
      classification: { category: route === "social_engagement" ? "low_risk_engagement" : route === "known_remedy" ? "potential_known_remedy" : "actionable_defect", confidence: .92 + (index % 7) / 100, riskFlags: route === "engineering_resolution" ? ["genuine_complaint"] : [], language: "en", evidence: [scenario.text], ...(route === "social_engagement" ? { engagementCategory: personaId === "challenger" ? "light_roast" as const : "friendly_banter" as const } : {}) },
      evidence: [{ id: `${id}:provenance`, label: "Source provenance", detail: `Fictional workspace sample · ${WORKSPACE_SEED}. No real customer, provider execution, approval or publication is asserted.` }],
    };
    if (scenario.finding) record.evidence.push({ id: `${id}:reproduction`, label: "Reproduction notes", detail: scenario.finding });
    if (hasCandidate) {
      record.candidate = { headSha: hashText(`${id}:head`).slice(0, 40), treeDigest: hashText(`${id}:tree`), deploymentId: `fixture:${id}`, checksPassed: !scenario.blocked };
      record.testRevision = "sample-checks-v1"; record.buildConfigRevision = "sample-build-v1";
      record.evidence.push({ id: `${id}:checks`, label: scenario.blocked ? "Checks need attention" : "Candidate verified", detail: scenario.blocked ? scenario.finding! : `${scenario.finding} Regression, boundary-value and responsive checks passed in this example.` });
    }
    if (verified) {
      record.liveVerifiedAt = complete ? created + 35 * 60_000 : now - 60_000;
      record.productionIdentityCheckedAt = record.liveVerifiedAt;
      record.productionDeploymentId = record.candidate!.deploymentId;
      record.productionTreeDigest = record.candidate!.treeDigest;
    }
    if (scenario.reply && persona) {
      const draftText = scenario.reply;
      record.publications.push({ id: `${id}:reply`, status: complete ? "confirmed" : scenario.phase === "READY_TO_PUBLISH" ? "reserved" : scenario.phase === "AWAITING_MANUAL_CONFIRMATION" ? "manual_required" : "draft", draftText, mode: "fixture", version: 1,
        account: "drizzle", targetId: signals[0].interactionId, sourceKey: signals[0].sourceKey, textHash: hashText(draftText),
        contextHash: hashText(canonicalJson(record.evidence)), personaId: persona.id, personaVersion: persona.version,
        purpose: route === "social_engagement" ? "engagement" : route === "known_remedy" ? "instructions" : "resolution", authorId: signals[0].authorId,
        ...(complete ? { receiptUrl: `https://example.invalid/simulated/${id}/reply`, attemptedAt: created + 36 * 60_000, confirmedAt: created + 37 * 60_000 } : {}),
      });
    }
    state.cases.push(record);
    const decide = (kind: "build" | "candidate_go" | "reply_approval", approved: boolean) => {
      const publicationStatus = record.publications[0]?.status;
      if (kind === "candidate_go") record.publications[0].status = "draft";
      const authority = requestAuthority(state, kind, id, undefined, now - 5 * 60_000, kind === "reply_approval" ? record.publications[0]?.id : undefined);
      if (publicationStatus) record.publications[0].status = publicationStatus;
      if (approved) {
        const role = kind === "build" ? "engineer" : "marketer";
        authority.request = decideApproval(authority.request, { currentRequestId: authority.request.requestId, expectedVersion: authority.request.version, expectedBinding: authority.request.binding,
          actor: { workspaceId: state.workspaceId, userId: `simulated-demo-${role}`, roles: [role], active: true }, decision: "approved", now: now - 4 * 60_000 }).request;
        if (kind !== "build") Object.assign(record.publications[0], { authorityId: authority.request.requestId, authorityKind: kind });
      }
    };
    if (route === "engineering_resolution" && !["RECEIVED", "TRIAGING", "INVESTIGATING"].includes(scenario.phase)) decide("build", scenario.phase !== "AWAITING_BUILD");
    if (record.publications.length && late) decide(route === "engineering_resolution" ? "candidate_go" : "reply_approval", scenario.phase !== "AWAITING_GO");
    record.phase = scenario.phase;
    record.blockingReason = scenario.blocked;
    state.sourceKeys.push(...signals.map(s => s.sourceKey));
    const events = [{ action: "Report received", detail: `${scenario.title} · ${signals.length} report${signals.length === 1 ? "" : "s"}`, at: created }];
    if (!["RECEIVED", "TRIAGING"].includes(record.phase)) events.push({ action: "Triage completed", detail: `${scenario.title} · ${route === "engineering_resolution" ? "engineering investigation" : route === "known_remedy" ? "known remedy" : "persona reply"}`, at: created + 3 * 60_000 });
    if (scenario.finding) events.push({ action: "Investigation updated", detail: scenario.finding, at: created + 9 * 60_000 });
    if (late) events.push({ action: complete ? "Reply confirmed" : scenario.phase === "AWAITING_GO" ? "Reply ready for review" : "Reply approved", detail: scenario.reply ?? scenario.title, at: complete ? created + 37 * 60_000 : now - (index + 1) * 60_000 });
    for (const [n, event] of events.entries()) state.audit.push({ id: `seed-case:${id}:${n}`, at: new Date(event.at).toISOString(), actor: "brio · sample data", role: "demo", action: event.action, detail: event.detail });
    added++;
  });
  if (added) {
    state.cases.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    state.audit.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    state.audit = state.audit.slice(0, 500);
    state.version++;
  }
  return { state, added };
}
