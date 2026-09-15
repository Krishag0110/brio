"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MendHeader } from "./mend";

const chapters = [
  ["01", "A customer complains on X.", "20°C becomes 20°F when the customer toggles the unit. The original report is preserved."],
  ["02", "Matching reports become one incident.", "Reports of the same defect share an investigation. Each customer's original interaction stays attached."],
  ["03", "Triage picks the bug exit.", "A genuine conversion defect, not banter. Protected checks reproduce 20°F where 68°F is expected."],
  ["04", "A human approves Build.", "An engineer reviews the proposed scope in Slack. Only the approved weather repository can change."],
  ["05", "A candidate is independently verified.", "The patch is limited to lib/temperature.ts. Trusted checks must fail before and pass after."],
  ["06", "The customer hears back.", "Exact approval, verified production evidence, and a confirmed reply receipt close the loop."],
];
export function Landing() {
  const [chapter, setChapter] = useState(0);
  useEffect(() => { const timer = setInterval(() => setChapter(current => (current + 1) % chapters.length), 4200); return () => clearInterval(timer); }, []);
  return <div className="mend-app"><MendHeader /><main id="main-content" className="landing">
    <section className="landing-hero">
      <div className="eyebrow accent">FDE FOR B2C APPS</div>
      <h1>Turn every customer complaint into a verified resolution.</h1>
      <p>An always-on forward deployed engineer between your customers and your codebase. It finds the complaint, reproduces the bug, ships the fix, proves it, and tells the customer.</p>
      <div className="hero-actions"><Link href="/cases" className="button accent-button">See it working</Link><Link href="#walkthrough" className="button secondary">A complaint, start to finish →</Link></div>
    </section>
    <section className="landing-story" id="walkthrough"><div className="story-grid">
      <div><div className="eyebrow">ILLUSTRATIVE WALKTHROUGH · WEATHER FIXTURE</div><h2>A complaint on X becomes a verified resolution. Follow every step.</h2>
        <div className="story-timeline">{chapters.map(([number,title,detail],index) => <button key={number} className={`story-step ${index === chapter ? "current" : index < chapter ? "done" : ""}`} onClick={() => setChapter(index)}><span className="story-rail"><i /></span><span><span className="story-step-title"><span className="mono">{number}</span> {title}</span><span className="story-step-detail">{detail}</span></span></button>)}</div>
      </div>
      <div className="story-visual"><div className="story-example" key={chapter}>
        {chapter === 0 && <div className="tweet-example"><div className="tweet-meta"><span className="avatar"/><div><strong>Weather customer</strong><span>@weather_customer · X</span></div><span className="mono">Example</span></div><p>@drizzleapp it says 20°C, but switching to Fahrenheit shows 20°F. That should be 68°F. Can you check the conversion?</p><small>A customer report starts the loop</small></div>}
        {chapter === 1 && <><div className="story-number">1<span> shared incident</span></div><p className="muted">Distinct reports. One engineering investigation.</p><div className="example-line"><span><i className="source-dot"/>X · Temperature conversion report</span><span>linked</span></div><div className="example-line"><span><i className="source-dot reddit"/>Reddit · Matching conversion report</span><span>linked</span></div><p className="small muted">Illustrative grouping. The board displays recorded counts.</p></>}
        {chapter === 2 && <><div className="eyebrow accent">PROTECTED REPRODUCTION</div><h3 className="example-heading">20°C should become 68°F.</h3><div className="check-example"><span>Before patch</span><b className="accent">20°F · failed</b></div><div className="check-example"><span>Expected result</span><b>68°F</b></div><p className="small muted">The seeded weather app deliberately contains this conversion defect.</p></>}
        {chapter === 3 && <><div className="eyebrow">SLACK · ENGINEERING APPROVAL</div><h3 className="example-heading">Reproduced. Ready to build?</h3><p>Proposed scope: <code>lib/temperature.ts</code> in the owned weather repository.</p><div className="button-row"><span className="button">Build</span><span className="button secondary">No build</span><span className="mono muted small">Illustrative approval card</span></div></>}
        {chapter === 4 && <><div className="eyebrow">INDEPENDENT VERIFICATION</div><h3 className="example-heading">A small fix. Concrete proof.</h3><pre className="code-example">{`lib/temperature.ts\n\nExpected conversion\n(20 × 9 / 5) + 32 = 68°F`}</pre><p className="small muted">A candidate needs protected checks and exact approval before a live release.</p></>}
        {chapter === 5 && <><div className="eyebrow">CLOSE THE LOOP</div><h3 className="example-heading">Fixed and notified are separate facts.</h3><div className="example-line">Production behavior verified <span>required</span></div><div className="example-line">Exact reply approved <span>required</span></div><div className="example-line">Publication receipt confirmed <span>required</span></div><Link className="text-link" href="/cases">Follow the workflow on the board →</Link></>}
      </div></div>
    </div></section>
    <section className="landing-triage"><div className="content-width"><div className="triage-heading"><h2>Triage has three exits.</h2><p>Only real bugs reach engineering. Everything else is handled in context.</p></div><div className="triage-cards">
      <article><div className="eyebrow accent">01 · REAL BUG</div><blockquote>20°C becomes 20°F. The temperature toggle is broken.</blockquote><p><b>QA agent:</b> reproduce the defect. → Engineer approves Build. → Scoped patch and independent verification. → Exact reply approval.</p><div className="triage-reply">The case stays open until production evidence and a reply receipt agree.</div></article>
      <article><div className="eyebrow accent">02 · ALREADY ANSWERED</div><blockquote>Is there a verified workaround while this is being fixed?</blockquote><p><b>Memory:</b> checks current evidence. → A known remedy or workaround must remain valid for the current version. → Exact approval when required.</p><div className="triage-reply">A workaround is described as a workaround. It never becomes an invented fix.</div></article>
      <article><div className="eyebrow accent">03 · NOT A BUG, JUST VIBES</div><blockquote>Opened the weather app to check if outside exists.</blockquote><p><b>QA agent:</b> harmless banter. → Active persona policy and independent checks. → One permitted reply in the brand&apos;s voice.</p><div className="triage-reply accent-rail">Serious complaints, opt-outs, and ambiguity leave the autonomous path.</div></article>
    </div></div></section>
  </main><footer className="landing-footer"><div className="content-width"><p>X and Reddit signals. Slack, Linear and GitHub workflows. Human authority before production.</p><div>{["X","Reddit","Slack","Linear","GitHub"].map(name => <span key={name}>{name}</span>)}</div></div></footer></div>;
}
