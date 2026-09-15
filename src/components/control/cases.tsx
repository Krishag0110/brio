"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import type { Action, Snapshot } from "./types";
import { humanize } from "./common";
import { caseKind, caseTitle, formatTime, reportCount, shortId, stageFor, STAGES } from "./mend";
import { DEMO_STEPS } from "../../control/demo-run-state";
import { CaseIntake } from "./case-intake";

type Transition = { caseId: string; title: string; from: string; to: string; at: number };
export function CasesView({ snapshot, act, busy, connection = "connecting", recentTransitions = [] }: { snapshot: Snapshot; act: Action; busy: boolean; connection?: string; recentTransitions?: Transition[] }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("All");
  const [stage, setStage] = useState("");
  const [mode, setMode] = useState("");
  const [route, setRoute] = useState("");
  const [phase, setPhase] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, DOMRect>());
  const followedStage = useRef("");
  const run = snapshot.demoRun;
  const visible = snapshot.cases.filter(item => (!search || `${item.id} ${item.title} ${item.text}`.toLowerCase().includes(search.toLowerCase())) && (source === "All" || item.sourcePlatform === source) && (!stage || stageFor(item) === stage) && (!mode || item.sourceMode === mode) && (!route || item.route === route) && (!phase || item.phase === phase) && (!blocked || item.blockingReason));
  const completed = snapshot.cases.filter(item => item.phase === "COMPLETED").length;
  const deduped = snapshot.cases.reduce((sum,item) => sum + reportCount(item) - 1,0);
  const canIntake = snapshot.actor.roles.length > 0;
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    board.current?.querySelectorAll<HTMLElement>("[data-case-id]").forEach(node => {
      const key = node.dataset.caseId!;
      const rect = node.getBoundingClientRect();
      const previous = positions.current.get(key);
      next.set(key,rect);
      if (previous && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const x = previous.left - rect.left, y = previous.top - rect.top;
        if (Math.abs(x) > 1 || Math.abs(y) > 1) node.animate([{ transform: `translate(${x}px,${y}px)`, boxShadow: "var(--shadow)" },{ transform: "translate(0,0)", boxShadow: "none" }], {duration:700,easing:"cubic-bezier(.2,.7,.2,1)"});
      }
    });
    positions.current = next;
    const activeCase = snapshot.cases.find(item => item.id === run?.caseId);
    const activeStage = activeCase ? `${run?.runId}:${stageFor(activeCase)}` : "";
    if (board.current && activeCase && activeStage !== followedStage.current) {
      followedStage.current = activeStage;
      const card = [...board.current.querySelectorAll<HTMLElement>("[data-case-id]")].find(node => node.dataset.caseId === activeCase.id);
      if (card) {
        const area = board.current.getBoundingClientRect(), rect = card.getBoundingClientRect();
        board.current.scrollTo({left: board.current.scrollLeft + rect.left - area.left - (area.width - rect.width)/2, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
      }
    }
  }, [snapshot, source, stage, search, mode, route, phase, blocked, run]);
  const clear = () => { setSearch("");setSource("All");setStage("");setMode("");setRoute("");setPhase("");setBlocked(false); };
  const events = [
    ...(run?.events.map(event => { const step = DEMO_STEPS[Number(event.id.split(":step:")[1]) - 1]; return {id:event.id,at:event.at,title:step?.title ?? event.title,detail:step?.detail ?? event.detail,caseId:run.caseId}; }) ?? []),
    ...recentTransitions.map(event => ({id:`${event.caseId}:${event.at}`,at:event.at,title:event.title,detail:`${humanize(event.from)} → ${humanize(event.to)}`,caseId:event.caseId})),
    ...snapshot.audit.filter(event => event.id.startsWith("seed-case:")).map(event => ({id:event.id,at:Date.parse(event.at),title:event.action,detail:event.detail,caseId:event.id.split(":")[1]})),
  ];
  return <>
    <div className="board-heading"><h1>Incidents <span className="listening"><i className="status-dot" data-state={connection}/>{connection === "live" ? "listening" : connection}</span></h1><span className="mono board-counts">{snapshot.cases.length - completed} open · {completed} closed · {deduped} reports deduped</span></div>
    {snapshot.mode === "demo" && <section className="demo-run-bar" aria-label="Live demo controls">
      <div><span className="eyebrow accent">WORKFLOW PLAYBACK</span><strong>{run?.stopReason ? `Workflow stopped: ${humanize(run.stopReason)}` : run?.status === "running" ? run.stepLabel : run?.status === "paused" ? "Workflow paused" : run?.status === "completed" ? "Loop closed. Every step is recorded." : "Watch a complaint move through the board."}</strong><p>Follow a report through investigation, approvals, verification, and a reply.</p></div>
      <div className="demo-run-actions">
        {!run || run.status === "completed" ? <button className="accent-button" disabled={busy} onClick={() => void act("demo_start", {}, "Workflow started.")}>▶ Run workflow</button> : run.status === "running" ? <button disabled={busy} onClick={() => void act("demo_pause", {runId:run.runId}, "Workflow paused.")}>Ⅱ Pause</button> : <button className="accent-button" disabled={busy} onClick={() => void act("demo_resume", {runId:run.runId}, "Workflow resumed.")}>▶ Resume</button>}
        {run && <button className="secondary" disabled={busy} onClick={() => void act("demo_restart", {runId:run.runId}, "A fresh workflow started.")}>↻ Restart</button>}
        {run && <span className="mono muted">{run.stepIndex}/{run.totalSteps}</span>}
      </div>
      {run && <div className="demo-progress"><span style={{width:`${Math.min(100,run.stepIndex / Math.max(1,run.totalSteps)*100)}%`}} /></div>}
    </section>}
    <div className="board-filters" aria-label="Case filters"><label className="search-field"><span aria-hidden>⌕</span><input aria-label="Search" placeholder="Search incidents" value={search} onChange={event => setSearch(event.target.value)}/></label><i className="filter-divider"/>
      {["All","x","reddit"].map(value => <button key={value} className={`filter-chip ${source === value ? "selected" : ""}`} onClick={() => setSource(value)}><i className={`source-dot ${value === "reddit" ? "reddit" : ""}`}/>{value === "All" ? "All sources" : value === "x" ? "X" : "Reddit"}<span className="mono">{snapshot.cases.filter(item => value === "All" || item.sourcePlatform === value).length}</span></button>)}<i className="filter-divider"/>
      {STAGES.map(value => <button key={value} className={`filter-chip ${stage === value ? "selected" : ""}`} onClick={() => setStage(stage === value ? "" : value)}>{value}<span className="mono">{snapshot.cases.filter(item => stageFor(item) === value).length}</span></button>)}
      {canIntake && <button className="filter-chip add-signal" onClick={() => setIntakeOpen(!intakeOpen)} aria-expanded={intakeOpen}>{intakeOpen ? "Close intake" : "+ Add signal"}</button>}
      {(search || source !== "All" || stage || mode || route || phase || blocked) && <button className="text-button accent" onClick={clear}>Clear</button>}
    </div>
    {intakeOpen && <CaseIntake snapshot={snapshot} act={act} busy={busy} onClose={() => setIntakeOpen(false)} />}
    <details className="advanced-filters"><summary>More filters</summary><div className="filters"><label>Route<select value={route} onChange={event=>setRoute(event.target.value)}><option value="">All routes</option>{[...new Set(snapshot.cases.map(item=>item.route))].map(value=><option key={value}>{value}</option>)}</select></label><label>Phase<select value={phase} onChange={event=>setPhase(event.target.value)}><option value="">All phases</option>{[...new Set(snapshot.cases.map(item=>item.phase))].map(value=><option key={value}>{value}</option>)}</select></label><label>Source<select value={mode} onChange={event=>setMode(event.target.value)}><option value="">All modes</option><option value="live">Live</option><option value="manual">Manual</option><option value="fixture">Fixture</option></select></label><label className="checkbox"><input type="checkbox" checked={blocked} onChange={event=>setBlocked(event.target.checked)}/>Blocked only</label></div></details>
    <div className="kanban-board" ref={board} aria-label="Incident board">{STAGES.filter(value=>!stage || stage===value).map((value,index)=><section className={`kanban-column ${value.includes("approval") ? "approval-column" : ""}`} key={value} aria-label={value} style={{animationDelay:`${index*40}ms`}}><div className="column-heading"><h2>{value}</h2><span className="mono">{visible.filter(item=>stageFor(item)===value).length}</span></div><div className="column-cards">{visible.filter(item=>stageFor(item)===value).map(item=><Link key={item.id} href={`/cases/${item.id}`} data-case-id={item.id} data-phase={item.phase} className={`incident-card ${run?.caseId===item.id && run.status==="running" ? "run-card" : ""}`}><div className="card-meta mono"><span title={item.id}>{shortId(item.id)}</span><span>{caseKind(item)}</span></div><h3>{caseTitle(item)}</h3><p className="card-excerpt">{item.text}</p><div className="card-bottom"><span><i className={`source-dot ${item.sourcePlatform === "reddit" ? "reddit" : ""}`}/>{item.sourcePlatform.toUpperCase()}</span><span>{reportCount(item)} report{reportCount(item)!==1 ? "s" : ""}</span></div>{item.blockingReason && <div className="card-blocker">{humanize(item.blockingReason)}</div>}<div className="card-context"><span className="mono">{new Date(item.createdAt).toLocaleDateString("en-GB", {day:"numeric",month:"short"})} · {formatTime(item.createdAt)}</span><span>{item.canceledAt ? "Canceled" : stageFor(item) === "Build approval" ? "Engineer review" : stageFor(item) === "Reply approval" ? "Marketer review" : item.route === "social_engagement" ? "Brand voice" : item.route === "known_remedy" ? "Support" : "Engineering"}</span></div></Link>)}{!visible.some(item=>stageFor(item)===value)&&<div className="column-empty">Nothing here</div>}</div></section>)}</div>
    {snapshot.cases.length>0 && visible.length===0 && <div className="board-empty"><h2>No incidents match</h2><p>Try another source, stage, or search term.</p><button onClick={clear}>Clear filters</button></div>}
    <section className="activity-panel" aria-label="Live event feed"><div className="activity-header"><h2><i className="status-dot"/>Live activity</h2><span className="mono">{events.length} events</span></div>{events.length ? [...events].sort((a,b)=>b.at-a.at).slice(0,10).map(event=><Link href={`/cases/${event.caseId}`} className="activity-event" key={event.id}><time className="mono">{formatTime(event.at)}</time><strong>{event.title}</strong><span>{event.detail}</span><span>↗</span></Link>) : <p className="activity-empty">{snapshot.mode === "demo" ? "Run a workflow to follow its progress here." : "Case transitions will appear as work progresses."}</p>}</section>
  </>;
}
