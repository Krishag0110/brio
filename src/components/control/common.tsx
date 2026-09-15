import type { ReactNode } from "react";

export function humanize(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "bad";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Status({ value }: { value: string }) {
  const tone = /failed|revoked|denied|unknown|expired|blocked/.test(
    value.toLowerCase(),
  )
    ? "bad"
    : /pending|awaiting|review|paused|missing|reconnect|unverified|not_verified|inactive|access_pending|not_ready/.test(
          value.toLowerCase(),
        )
      ? "warning"
      : /confirmed|active|approved|verified|completed|ready/.test(
            value.toLowerCase(),
          )
        ? "good"
        : "neutral";
  return <Badge tone={tone}>{humanize(value)}</Badge>;
}
export function ExternalLink({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  let safe = false;
  try {
    const url = new URL(href || "");
    safe =
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch {
    /* Untrusted or incomplete links remain plain text. */
  }
  if (!safe) return <span className="muted">{children} unavailable</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function DateText({ value }: { value?: string }) {
  if (!value) return <span>Not recorded</span>;
  const date = new Date(value);
  return (
    <time dateTime={value}>
      {Number.isNaN(date.getTime()) ? value : date.toLocaleString()}
    </time>
  );
}
