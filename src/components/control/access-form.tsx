"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccessForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = event.currentTarget;
        const code = new FormData(form).get("code");
        try {
          const response = await fetch("/api/access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          if (!response.ok)
            throw new Error(
              response.status === 503
                ? "Hosted workspace access is not configured."
                : "The access code was not accepted.",
            );
          router.replace("/");
          router.refresh();
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Workspace access failed.",
          );
        } finally {
          form.reset();
          setBusy(false);
        }
      }}
    >
      <label>
        Workspace access code
        <input
          name="code"
          type="password"
          autoComplete="current-password"
          required
          maxLength={512}
          disabled={busy}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Opening…" : "Open workspace"}
      </button>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </form>
  );
}
