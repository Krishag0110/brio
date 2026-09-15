"use client";
import type { Action, Snapshot } from "./types";
export function CaseIntake({snapshot, act, busy, onClose}:{snapshot:Snapshot;act:Action;busy:boolean;onClose:()=>void}) {
  return (
        <section className="panel">
          <h2>Manual signal intake</h2>
          <p className="muted">
            Preserve the original wording. Missing or invalid targets cannot
            enter live publication.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const values = new FormData(form);
              if (!String(values.get("authorId") || "").trim())
                values.delete("authorId");
              if (
                await act(
                  "intake",
                  Object.fromEntries(values),
                  "Signal stored. Duplicate interactions are linked to their existing case.",
                )
              ) {
                form.reset();
                onClose();
              }
            }}
          >
            <div className="form-grid">
              <label>
                Platform
                <select name="platform" defaultValue="x">
                  <option value="x">X</option>
                  <option value="reddit">Reddit</option>
                </select>
              </label>
              <label>
                Source mode
                <select
                  name="mode"
                  defaultValue={snapshot.mode === "demo" ? "fixture" : "manual"}
                >
                  <option value="manual">Manually copied interaction</option>
                  <option value="fixture">Labeled fixture</option>
                </select>
              </label>
            </div>
            <label>
              Original URL
              <input
                type="url"
                name="sourceUrl"
                placeholder="https://x.com/customer/status/123"
                maxLength={2048}
              />
            </label>
            <label>
              Observed author
              <input
                name="authorId"
                placeholder="Source account identifier"
                maxLength={200}
              />
            </label>
            <label>
              Customer text
              <textarea
                name="text"
                required
                minLength={2}
                maxLength={10000}
                rows={4}
                placeholder="20°C becomes 20°F when I toggle the unit."
              />
            </label>
            <button type="submit" disabled={busy}>
              Store signal
            </button>
          </form>
        </section>
  );
}
