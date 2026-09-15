"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CaseRecord, Tab } from "./types";

export const STAGES = ["Detected", "Triaged", "Build approval", "Fixing", "Verifying", "Reply approval", "Resolved"] as const;
export function stageFor(record: CaseRecord): (typeof STAGES)[number] {
  if (record.phase === "COMPLETED") return "Resolved";
  if (["RECEIVED", "TRIAGING"].includes(record.phase)) return "Detected";
  if (record.phase === "INVESTIGATING") return "Triaged";
  if (record.phase === "AWAITING_BUILD") return "Build approval";
  if (record.phase === "BUILDING") return "Fixing";
  if (["VERIFYING_CANDIDATE", "RELEASING", "VERIFYING_LIVE"].includes(record.phase)) return "Verifying";
  return "Reply approval";
}
export function caseTitle(record: CaseRecord) { return record.sourceMode === "fixture" ? record.title.replace(/^\[SIMULATED DEMO\]\s*/, "") : record.title; }
export function shortId(id: string) { return id.length > 16 ? id.slice(-12).toUpperCase() : id; }
export function reportCount(record: CaseRecord) { return record.signals?.length || 1; }
export function formatTime(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
export function caseKind(record: CaseRecord) {
  return ["engineering", "engineering_resolution"].includes(record.route) ? "Bug" : record.route === "known_remedy" ? "Known remedy" : record.route === "social_engagement" ? "Engagement" : "Review";
}
export function MendHeader({ tab = "landing" }: { tab?: Tab }) {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const timer = setTimeout(() => { const next = localStorage.getItem("mend-theme") === "dark" ? "dark" : "light"; setTheme(next); document.documentElement.dataset.theme = next; }, 0);
    return () => clearTimeout(timer);
  }, []);
  return <header className="mend-header">
    <Link href="/" className="mend-brand"><span className="brand-square" /><strong>brio</strong><span className="mono brand-context">drizzle · weather</span></Link>
    <div className="header-actions">
      {tab !== "landing" && <nav className="mend-tabs" aria-label="Main navigation">
        <Link href="/cases" aria-current={tab === "cases" ? "page" : undefined}>Board</Link>
        <Link href="/dashboard" aria-current={tab === "dashboard" ? "page" : undefined}>Dashboard</Link>
      </nav>}
      {tab !== "landing" && <details className="workspace-menu"><summary aria-label="Workspace settings">Workspace <span>⌄</span></summary><nav aria-label="Workspace navigation"><Link href="/persona">Persona</Link><Link href="/connections">Connections</Link><Link href="/controls">Controls & audit</Link></nav></details>}
      <button className="theme-toggle" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} onClick={() => { const next = theme === "light" ? "dark" : "light"; setTheme(next); document.documentElement.dataset.theme = next; localStorage.setItem("mend-theme", next); }}><span className="toggle-track"><span /></span>{theme === "light" ? "Light" : "Dark"}</button>
      {tab === "landing" && <Link className="button compact" href="/cases">Open the board</Link>}
    </div>
  </header>;
}
