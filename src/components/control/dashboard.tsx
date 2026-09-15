"use client";

import Link from "next/link";
import type { Tab } from "./types";
import { CasesView } from "./cases";
import { CaseDetail } from "./case-detail";
import { PersonaView } from "./persona";
import { ConnectionsView } from "./connections";
import { ControlsView } from "./controls";
import { MetricsView } from "./metrics";
import { MendHeader } from "./mend";
import { useControl } from "./use-control";

export function Dashboard({tab="cases",caseId}:{tab?:Tab;caseId?:string}) {
  const {snapshot,act,busy,error,loadError,message,refresh,connection,recentTransitions}=useControl();
  return <div className="mend-app"><MendHeader tab={tab}/>
    <main id="main-content" className={caseId?"ticket-workspace":tab==="cases"?"board-page":tab==="dashboard"?"metrics-page":"settings-page"}>
      {(error||loadError)&&<div className="notice error" role="alert"><div><strong>Action unavailable</strong><p>{error||loadError}</p>{/access|unauthorized/i.test(loadError)&&<Link href="/access">Enter workspace access code</Link>}</div><button className="secondary" onClick={()=>void refresh()}>Retry loading</button></div>}
      {message&&<div className="action-message" role="status">✓ {message}</div>}
      {!snapshot&&!loadError&&<div className="loading-state"><span className="status-dot"/>Connecting to the workspace…</div>}
      {snapshot?.mode==="live"&&!snapshot.actor.roles.length&&<div className="notice"><div><strong>Live workspace setup incomplete</strong><p>Connections lists the remaining integration prerequisites.</p></div><Link href="/connections">View readiness →</Link></div>}
      {snapshot&&tab==="cases"&&!caseId&&<CasesView snapshot={snapshot} act={act} busy={busy} connection={connection} recentTransitions={recentTransitions}/>}
      {snapshot&&caseId&&<CaseDetail snapshot={snapshot} caseId={caseId} act={act} busy={busy}/>}
      {snapshot&&tab==="dashboard"&&<MetricsView snapshot={snapshot}/>}
      {snapshot&&tab==="persona"&&<PersonaView snapshot={snapshot} act={act} busy={busy}/>}
      {snapshot&&tab==="connections"&&<ConnectionsView snapshot={snapshot} act={act} busy={busy} refresh={async()=>{await refresh();}}/>}
      {snapshot&&tab==="controls"&&<ControlsView snapshot={snapshot} act={act} busy={busy}/>}
    </main>
  </div>;
}
