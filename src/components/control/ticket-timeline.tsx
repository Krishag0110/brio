"use client";
import Link from "next/link";
import type { Approval, CaseRecord, Snapshot } from "./types";
import { ExternalLink, humanize } from "./common";
import { caseKind, caseTitle, formatTime, reportCount, shortId, stageFor } from "./mend";

type Step = { title: string; app: string; done: boolean; detail?: string; approval?: Approval; code?: string; href?: string; at?: string | number };
export function TicketTimeline({record,snapshot}:{record:CaseRecord;snapshot:Snapshot}) {
  const build=[...record.approvals].reverse().find(item=>item.kind==="build");
  const go=[...record.approvals].reverse().find(item=>item.kind==="candidate_go" || item.kind==="reply_approval");
  const receipt=record.publications.find(item=>["confirmed","manually_attested"].includes(item.status));
  const reproduction=record.evidence.find(item=>/reproduc/i.test(item.label));
  const run=snapshot.demoRun?.caseId===record.id ? snapshot.demoRun : undefined;
  const engineering=record.route==="engineering_resolution" || record.route==="engineering";
  const engagement=record.route==="social_engagement";
  const pastTriage=!['RECEIVED','TRIAGING'].includes(record.phase);
  const history=snapshot.audit.filter(event=>event.id.startsWith(`seed-case:${record.id}:`));
  const eventTime=(action:string)=>history.find(event=>event.action===action)?.at;
  const steps:Step[]=[
    {title:"Discover",app:record.sourcePlatform.toUpperCase(),done:true,detail:`${reportCount(record)} original report${reportCount(record)===1?"":"s"} grouped into this incident. Source wording and authors are preserved.`,at:record.createdAt},
    {title:"Triage",app:"QA agent",done:pastTriage,detail:record.classification ? `${humanize(record.classification.category)} · ${Math.round(record.classification.confidence*100)}% confidence${record.classification.riskFlags.length ? ` · ${record.classification.riskFlags.map(humanize).join("; ")}`:""}.`:`Route: ${humanize(record.route)}.`,at:eventTime("Triage completed")},
    ...(engineering ? [
      {title:"Memory",app:"Known remedies",done:pastTriage,detail:"Prior issues checked for a matching symptom. This case requires its own reproduction and verification."},
      {title:"Investigate",app:"Protected checks",done:!!reproduction,detail:reproduction?.detail,at:eventTime("Investigation updated")},
      {title:"Approve build",app:"Slack",done:build?.status==="approved",detail:build ? `Build ${build.status}. The decision covers the repository, revision and allowed change scope.`:undefined,approval:build},
      {title:"Fix",app:"GitHub · weather",done:!!record.candidate,detail:record.candidate ? `Candidate ${record.candidate.headSha.slice(0,12)} is ready for review.`:undefined},
      {title:"Verify",app:"Independent verifier",done:!!record.candidate?.checksPassed,detail:record.candidate ? `Candidate checks ${record.candidate.checksPassed ? "passed":"need attention"}. Production verification ${record.productionVerified ? "complete":"pending"}.`:undefined},
    ] : [{title:engagement?"Shape the reply":"Find the answer",app:engagement?"Brand persona":"Support knowledge",done:record.publications.length>0,detail:engagement?"Keep the reply in the selected brand voice. Claims about a fix or customer support require separate evidence.":"Match the question to a known remedy and prepare clear instructions."}]),
    {title:"Approve reply",app:"Slack",done:go?.status==="approved",detail:go ? `${humanize(go.kind)} ${go.status}. The exact reply wording is included in the decision.`:undefined,approval:go,at:eventTime("Reply approved")},
    {title:"Close loop",app:record.sourcePlatform.toUpperCase(),done:!!receipt,detail:receipt ? `Reply ${humanize(receipt.status)}. ${record.outcome ? humanize(record.outcome):"Communication outcome recorded."}`:undefined,code:receipt?.draftText,href:receipt?.mode==="live"?receipt.receiptUrl:undefined,at:eventTime("Reply confirmed")},
  ];
  const active=record.phase==="COMPLETED" ? -1 : Math.max(0,steps.findIndex(item=>!item.done));
  const links=record.evidence.filter(item=>item.url).map(item=>({title:item.label,url:item.url!})).concat(record.approvals.filter(item=>item.slackUrl).map(item=>({title:humanize(item.kind),url:item.slackUrl!})));
  const communication=record.communicationStatus.replace(/^simulated_/, "");
  return <section className="ticket-view">
    <Link href="/cases" className="back-link">← Board</Link>
    <div className="ticket-heading"><div><div className="ticket-meta mono"><span title={record.id}>{shortId(record.id)}</span><span>{caseKind(record)}</span><span>drizzle / {engagement?"community":engineering?"engineering":"support"}</span></div><h1>{caseTitle(record)}</h1></div><div className="ticket-summary"><span className="mono">{reportCount(record)} report{reportCount(record)===1?"":"s"} · opened {formatTime(record.createdAt)}</span><span className={`stage-pill ${stageFor(record).includes("approval") ? "hot":""}`}>{record.canceledAt ? "Canceled":stageFor(record)}</span></div></div>
    <div className="ticket-progress" aria-label="Case progress">{steps.map((step,index)=><div key={step.title} className={step.done ? "done":index===active?"active":"pending"}><i/><span>{step.title}</span></div>)}</div>
    <div className="ticket-grid"><div className="ticket-timeline">{steps.map((step,index)=>{const event=run?.events.find(item=>item.title.toLowerCase().includes(step.title.toLowerCase().split(" ")[0]));return <article className={`timeline-step ${step.done ? "done":index===active ? "active":"pending"}`} key={step.title}><div className="timeline-rail"><i/><span/></div><div><div className="timeline-title"><h2>{step.title}<span> · {step.app}</span></h2><time className="mono">{step.at ? formatTime(step.at):event ? formatTime(event.at):"—"}</time></div>{step.detail && <p>{step.detail}</p>}{index===active && <span className="active-stage"><i className="status-dot"/>{record.blockingReason ? humanize(record.blockingReason):`Awaiting ${step.title.toLowerCase()}`}</span>}{step.approval && <div className="timeline-approval"><span className={`stage-pill ${step.approval.status==="approved"?"":"muted-pill"}`}>{humanize(step.approval.status)}</span><span className="mono muted">{step.approval.role==="engineer"?"Engineer decision":"Marketer decision"}</span></div>}{step.code && <pre className="code-example">{step.code}</pre>}{step.href&&<ExternalLink href={step.href}>View reply receipt</ExternalLink>}</div></article>;})}</div>
    <aside className="ticket-sidebar"><section><h2>ORIGINAL SIGNAL</h2><div className="original-signal"><div className="signal-meta"><span><i className={`source-dot ${record.sourcePlatform==="reddit"?"reddit":""}`}/>{record.signals?.[0]?.authorId || "Customer"} · {record.sourcePlatform.toUpperCase()}</span><span className="mono">{formatTime(record.createdAt)}</span></div><blockquote>{record.text}</blockquote>{record.sourceMode!=="fixture"&&record.sourceUrl&&<ExternalLink href={record.sourceUrl}>Open on {record.sourcePlatform.toUpperCase()}</ExternalLink>}</div></section>
      {!!record.publications.length && <section><h2>BRAND REPLY</h2>{record.publications.map(reply=>{const draft=record.drafts?.find(item=>item.id===reply.id);const persona=snapshot.personas.find(item=>item.id===draft?.personaId);return <div className="reply-preview" key={reply.id}><div className="signal-meta"><strong>{persona?.name ?? "Brand voice"}</strong><span className="mono">{humanize(reply.status)} · v{reply.version??1}</span></div><blockquote>{reply.draftText}</blockquote></div>;})}</section>}
      <section><h2>SAME ISSUE · {reportCount(record)} REPORT{reportCount(record)===1?"":"S"}</h2>{record.signals?.map((signal,index)=><div className="related-signal" key={`${signal.originalUrl}:${index}`}><span><i className={`source-dot ${signal.platform==="reddit"?"reddit":""}`}/>{signal.authorId} · {signal.text}</span><span className="mono">{formatTime(signal.observedAt)}</span></div>) || <p className="muted">Original source attached to this case.</p>}</section>
      <section><h2>TRIAGE</h2><dl className="triage-facts"><div><dt>Class</dt><dd>{caseKind(record)}</dd></div><div><dt>Confidence</dt><dd>{record.classification ? `${Math.round(record.classification.confidence*100)}%`:"Not recorded"}</dd></div>{engineering&&<div><dt>Production</dt><dd>{record.productionVerified?"Verified":"Pending"}</dd></div>}<div><dt>Communication</dt><dd>{humanize(communication)}</dd></div></dl></section>
      {!!links.length&&<section><h2>LINKED</h2>{links.map((link,index)=><ExternalLink key={`${link.url}:${index}`} href={link.url}>{link.title}</ExternalLink>)}</section>}
    </aside></div>
  </section>;
}
