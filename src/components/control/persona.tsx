"use client";

import { useState } from "react";
import type { Action, Persona, Snapshot, TestResult } from "./types";
import {
  Badge,
  DateText,
  Empty,
  ExternalLink,
  humanize,
  Status,
} from "./common";

const splitLines = (value: FormDataEntryValue | null) =>
  String(value || "")
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
const numericFields = [
  "formality",
  "warmth",
  "directness",
  "slang",
  "humorLevel",
  "roastLevel",
  "maxLength",
  "maxEmoji",
  "hourlyCap",
  "dailyCap",
  "authorCooldownHours",
] as const;
const listFields = [
  "allowedCategories",
  "doNotEngage",
  "bannedPhrases",
  "approvedVocabulary",
  "examples",
  "counterexamples",
] as const;

function PersonaEditor({
  persona,
  snapshot,
  act,
  busy,
}: {
  persona: Persona;
  snapshot: Snapshot;
  act: Action;
  busy: boolean;
}) {
  const marketer = snapshot.actor.roles.includes("marketer");
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const [changed, setChanged] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [input, setInput] = useState(
    "opened the weather app to check if outside exists",
  );
  return (
    <>
      <section className="panel">
        <div className="section-header">
          <h2>{persona.name}</h2>
          <div>
            <Badge>Version {persona.version}</Badge>{" "}
            <Status value={persona.status} />
          </div>
        </div>
        <dl className="facts">
          <div>
            <dt>Expiry</dt>
            <dd>
              <DateText value={persona.expiresAt} />
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>gpt-5-mini</dd>
          </div>
          <div>
            <dt>Automatic engagement</dt>
            <dd>
              {persona.status === "active" && persona.autonomyEnabled
                ? "Enabled under policy"
                : "Disabled until activation"}
            </dd>
          </div>
        </dl>
        {persona.hash && (
          <details>
            <summary>Immutable version hash</summary>
            <code>{persona.hash}</code>
          </details>
        )}
        <p className="muted">
          Save creates an immutable version. Limits, wording, prompts, and
          validator changes require a fresh activation. Policies expire after
          seven days unless renewed.
        </p>
        {!marketer && (
          <p className="notice">
            Persona changes and activation requests require the marketer role.
          </p>
        )}
        <form
          id="persona-form"
          onChange={() => setChanged(true)}
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const updated: Persona = {
              ...persona,
              name: String(data.get("name")),
              objective: String(data.get("objective")),
              brandDescription: String(data.get("brandDescription")),
              audience: String(data.get("audience")),
              autonomyEnabled: data.get("autonomyEnabled") === "on",
              platforms: data.getAll("platforms").map(String),
            };
            for (const field of numericFields)
              updated[field] = Number(data.get(field));
            for (const field of listFields)
              updated[field] = splitLines(data.get(field));
            if (
              await act(
                "persona_save",
                { persona: updated },
                "New persona version saved. Request marketer activation before autonomous use.",
              )
            ) {
              setChanged(false);
              setResult(null);
            }
          }}
        >
          <fieldset disabled={!marketer || busy}>
            <div className="form-grid">
              <label>
                Policy name
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={persona.name}
                />
              </label>
              <label>
                Primary strategy
                <select name="objective" defaultValue={persona.objective}>
                  <option value="customer_trust">Customer trust</option>
                  <option value="community_engagement">
                    Community engagement
                  </option>
                  <option value="playful_brand_awareness">
                    Playful brand awareness
                  </option>
                  <option value="product_education">Product education</option>
                  {![
                    "customer_trust",
                    "community_engagement",
                    "playful_brand_awareness",
                    "product_education",
                  ].includes(persona.objective) && (
                    <option value={persona.objective}>
                      {humanize(persona.objective)}
                    </option>
                  )}
                </select>
              </label>
            </div>
            <label>
              Brand description and approved product facts
              <textarea
                name="brandDescription"
                required
                rows={3}
                maxLength={1000}
                defaultValue={persona.brandDescription}
              />
            </label>
            <label>
              Audience
              <input
                name="audience"
                required
                maxLength={500}
                defaultValue={persona.audience}
              />
            </label>
            <h3>Voice</h3>
            <p className="small muted">
              Voice levels range from 0 (least) to 5 (most). English is the
              supported demo language; uncertain language requires review.
            </p>
            <div className="form-grid three-columns">
              {(
                [
                  ["formality", "Formality"],
                  ["warmth", "Warmth"],
                  ["directness", "Directness"],
                  ["slang", "Slang"],
                  ["humorLevel", "Humor"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    name={key}
                    min={0}
                    max={5}
                    required
                    defaultValue={persona[key]}
                  />
                </label>
              ))}
              <label>
                Roast level
                <select name="roastLevel" defaultValue={persona.roastLevel}>
                  <option value="0">0 — none</option>
                  <option value="1">1 — situation / self</option>
                  <option value="2">2 — light interaction teasing</option>
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                Allowed engagement categories (one per line)
                <textarea
                  name="allowedCategories"
                  rows={4}
                  defaultValue={persona.allowedCategories.join("\n")}
                />
              </label>
              <label>
                Do not engage (one per line)
                <textarea
                  name="doNotEngage"
                  rows={4}
                  defaultValue={persona.doNotEngage.join("\n")}
                />
              </label>
              <label>
                Approved vocabulary (one per line)
                <textarea
                  name="approvedVocabulary"
                  rows={3}
                  defaultValue={(persona.approvedVocabulary || []).join("\n")}
                />
              </label>
              <label>
                Banned phrases (one per line)
                <textarea
                  name="bannedPhrases"
                  rows={3}
                  defaultValue={persona.bannedPhrases.join("\n")}
                />
              </label>
              <label>
                Approved examples (one per line)
                <textarea
                  name="examples"
                  rows={3}
                  defaultValue={(persona.examples || []).join("\n")}
                />
              </label>
              <label>
                Counterexamples (one per line)
                <textarea
                  name="counterexamples"
                  rows={3}
                  defaultValue={(persona.counterexamples || []).join("\n")}
                />
              </label>
            </div>
            <h3>Style and autonomous limits</h3>
            <div className="form-grid three-columns">
              <label>
                Maximum reply length
                <input
                  name="maxLength"
                  type="number"
                  min={1}
                  max={240}
                  required
                  defaultValue={persona.maxLength}
                />
              </label>
              <label>
                Maximum emoji
                <input
                  name="maxEmoji"
                  type="number"
                  min={0}
                  max={1}
                  required
                  defaultValue={persona.maxEmoji}
                />
              </label>
              <label>
                Replies per hour
                <input
                  name="hourlyCap"
                  type="number"
                  min={0}
                  max={100}
                  required
                  defaultValue={persona.hourlyCap}
                />
              </label>
              <label>
                Replies per day
                <input
                  name="dailyCap"
                  type="number"
                  min={0}
                  max={500}
                  required
                  defaultValue={persona.dailyCap}
                />
              </label>
              <label>
                Author cooldown (hours)
                <input
                  name="authorCooldownHours"
                  type="number"
                  min={24}
                  required
                  defaultValue={persona.authorCooldownHours}
                />
              </label>
            </div>
            <div className="button-row">
              <label className="checkbox">
                <input
                  name="platforms"
                  type="checkbox"
                  value="x"
                  defaultChecked={persona.platforms.includes("x")}
                />
                X
              </label>
              <label className="checkbox">
                <input
                  name="platforms"
                  type="checkbox"
                  value="reddit"
                  defaultChecked={persona.platforms.includes("reddit")}
                />
                Reddit (approved access only)
              </label>
              <label className="checkbox">
                <input
                  name="autonomyEnabled"
                  type="checkbox"
                  defaultChecked={persona.autonomyEnabled}
                />
                Request autonomous engagement
              </label>
            </div>
            <p className="notice">
              Truth rules are mandatory: no invented fixes, diagnostics, ETAs,
              refunds, guarantees, or human identity. No profanity, unsolicited
              mentions, or links. Real complaints and sensitive contexts go to
              review; silence is a valid outcome.
            </p>
            <button type="submit" disabled={busy || !changed}>
              Save new persona version
            </button>
          </fieldset>
        </form>
        {marketer && (
          <div className="button-row policy-actions">
            <button
              disabled={busy || changed || persona.status === "active"}
              onClick={() =>
                void act(
                  "persona_request_activation",
                  { personaId: persona.id },
                  "Policy activation requested in Slack. The saved version remains inactive until approved.",
                )
              }
            >
              Request activation in Slack
            </button>
            <button
              className="secondary"
              disabled={busy || persona.status !== "active"}
              onClick={() => setRevokeOpen(!revokeOpen)}
            >
              Pause / revoke policy
            </button>
          </div>
        )}
        {changed && (
          <p className="small warning-text">
            Unsaved edits. Save a new version before testing or requesting
            activation.
          </p>
        )}
        {persona.slackUrl && (
          <p>
            <ExternalLink href={persona.slackUrl}>
              Open policy activation in Slack
            </ExternalLink>
          </p>
        )}
        {snapshot.mode === "demo" &&
          marketer &&
          persona.approvalId &&
          ["pending", "pending_activation", "awaiting_activation"].includes(
            persona.status,
          ) && (
            <div className="notice demo">
              <p>Simulated Slack policy approval · {snapshot.actor.name}</p>
              <button
                disabled={busy || changed}
                onClick={() =>
                  void act(
                    "demo_decide",
                    {
                      caseId: `policy:${persona.id}`,
                      approvalId: persona.approvalId,
                      decision: "approved",
                    },
                    "Simulated marketer policy activation recorded.",
                  )
                }
              >
                Simulate policy approval
              </button>
            </div>
          )}
        {revokeOpen && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              if (
                await act(
                  "persona_revoke",
                  { personaId: persona.id, reason: data.get("reason") },
                  "Policy revoked. Queued work must pass authorization again.",
                )
              )
                setRevokeOpen(false);
            }}
          >
            <label>
              Revocation reason
              <input name="reason" required minLength={8} maxLength={2000} />
            </label>
            <button disabled={busy}>Confirm policy revocation</button>
          </form>
        )}
      </section>
      <section className="panel">
        <h2>Test persona</h2>
        <p className="muted">
          Preview the saved version. Testing does not authorize or publish a
          reply.{" "}
          {snapshot.mode === "demo"
            ? "Demo uses deterministic fixture evaluation, without a paid model call."
            : "Live model work requires configured credentials and a cost reservation."}
        </p>
        <div className="button-row">
          <button
            className="secondary"
            onClick={() =>
              setInput("opened the weather app to check if outside exists")
            }
          >
            Friendly joke example
          </button>
          <button
            className="secondary"
            onClick={() =>
              setInput("20°C becomes 20°F. your calculator asleep?")
            }
          >
            Real complaint example
          </button>
          <button
            className="secondary"
            onClick={() => setInput("stop replying to me")}
          >
            Opt-out example
          </button>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setTesting(true);
            setTestError("");
            setResult(null);
            try {
              const response = await fetch("/api/persona/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  persona,
                  input,
                  context: data.get("context"),
                  directInteraction: data.get("directInteraction") === "on",
                }),
              });
              const body = await response.json();
              if (!response.ok)
                throw new Error(body.error || "Persona test failed.");
              setResult(body as TestResult);
            } catch (cause) {
              setTestError(
                cause instanceof Error ? cause.message : "Persona test failed.",
              );
            } finally {
              setTesting(false);
            }
          }}
        >
          <label>
            Example customer message
            <textarea
              required
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={3000}
              rows={3}
            />
          </label>
          <label>
            Reply register
            <select name="context">
              <option value="engagement">Engagement</option>
              <option value="resolution">
                Resolution (requires facts and approval)
              </option>
              <option value="known_remedy">
                Known remedy (requires verified evidence)
              </option>
            </select>
          </label>
          <label className="checkbox">
            <input name="directInteraction" type="checkbox" defaultChecked />
            This is a direct interaction with the brand.
          </label>
          <button type="submit" disabled={testing || busy || changed}>
            {testing ? "Evaluating…" : "Test saved persona"}
          </button>
        </form>
        {testError && (
          <p role="alert" className="notice error">
            {testError}
          </p>
        )}
        {result && (
          <div className="subpanel" role="status">
            <h3>
              Decision: <Status value={result.decision} />
            </h3>
            {result.draft ? (
              <blockquote className="source-text">{result.draft}</blockquote>
            ) : (
              <p>No autonomous reply proposed.</p>
            )}
            <ul>
              {result.reasons.map((reason, index) => (
                <li key={index}>{humanize(reason)}</li>
              ))}
            </ul>
            {result.checks && (
              <ul>
                {result.checks.map((check, index) => (
                  <li key={index}>
                    <Badge tone={check.passed ? "good" : "bad"}>
                      {check.passed ? "Pass" : "Block"}
                    </Badge>{" "}
                    {check.label}
                    {check.detail && `: ${check.detail}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </>
  );
}

export function PersonaView({
  snapshot,
  act,
  busy,
}: {
  snapshot: Snapshot;
  act: Action;
  busy: boolean;
}) {
  const [selected, setSelected] = useState("");
  const persona =
    snapshot.personas.find((item) => item.id === selected) ||
    snapshot.personas[0];
  return (
    <>
      <div className="section-header">
        <div>
          <h1>Persona policy</h1>
          <p className="muted">
            Versioned strategy, voice, exclusions, and authority to engage.
          </p>
        </div>
      </div>
      <section className="panel">
        <label>
          Policy version / preset
          <select
            value={persona?.id || ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {snapshot.personas.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · v{item.version} · {humanize(item.status)}
              </option>
            ))}
          </select>
        </label>
      </section>
      {persona ? (
        <PersonaEditor
          key={`${persona.id}-${persona.version}`}
          persona={persona}
          snapshot={snapshot}
          act={act}
          busy={busy}
        />
      ) : (
        <Empty>No persona policies are available.</Empty>
      )}
    </>
  );
}
