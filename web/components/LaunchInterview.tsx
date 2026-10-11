"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DRAFT_KEY } from "@/components/RoundView";
import type { Stage } from "@/lib/fixtures";
import { normalizeLinkedIn } from "@/lib/linkedin";

// Demo anchors from MEGA_PLAN §10 (illustrative only; the real estimate comes from the server valuation module).
const ANCHOR: Record<Stage, number> = { IDEA: 100000, PROTOTYPE: 500000, LAUNCHED: 1000000, EARLY_REVENUE: 2000000, REPEATABLE_REVENUE: 5000000 };

type Field = { k: string; l?: string; ph: string; type?: string };
type Step = { k: string; sec: string; q: [string, string]; fields?: Field[]; opts?: string[]; hint?: string; req?: boolean };

const STEPS: Step[] = [
  { k: "name", sec: "Identity", q: ["What’s it", "called?"], fields: [{ k: "name", ph: "Mothlight" }], hint: "A working title is fine.", req: true },
  { k: "line", sec: "Identity", q: ["Say it in", "one line."], fields: [{ k: "line", ph: "Quiet study rooms at 2 a.m." }], req: true },
  { k: "stage", sec: "Stage", q: ["How far", "along is it?"], opts: Object.keys(ANCHOR), req: true },
  { k: "entity", sec: "Stage", q: ["Is it", "incorporated?"], opts: ["Unincorporated", "Incorporated"], hint: "Either is fine. We label it honestly.", req: true },
  { k: "site", sec: "Web", q: ["Where can backers", "see it?"], fields: [{ k: "site", ph: "https://mothlight.app", type: "url" }], hint: "No site? A Notion, Figma or demo link works." },
  { k: "founder", sec: "Founders", q: ["Who’s", "building it?"], fields: [{ k: "fname", l: "Name", ph: "Ana Ruiz" }, { k: "role", l: "Role", ph: "CEO" }, { k: "li", l: "LinkedIn", ph: "linkedin.com/in/ana-ruiz", type: "url" }] },
  { k: "contact", sec: "Contact", q: ["How do backers", "reach you?"], fields: [{ k: "pub", l: "Public contact", ph: "hello@mothlight.app", type: "email" }, { k: "acct", l: "Account email · private", ph: "ana@unc.edu", type: "email" }] },
];

type Data = Record<string, string>;
const summary = (s: Step, d: Data) => (s.fields ? s.fields.map((f) => d[f.k]).filter(Boolean).join(" · ") : d[s.k] ?? "");

export default function LaunchInterview() {
  const [data, setData] = useState<Data>({});
  const [cur, setCur] = useState(0);
  const [phase, setPhase] = useState<"" | "out" | "in">("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const step = STEPS[cur];

  useEffect(() => { firstInput.current?.focus({ preventScroll: true }); }, [cur, done]);

  // Demo stand-in for publishing: keep a preview in this tab so Publish can show the round page.
  // Only public fields go in (the founder card, LinkedIn included); contact emails stay out. Nothing leaves the browser.
  useEffect(() => {
    if (!done) return;
    const stage = (data.stage as Stage) || "IDEA";
    const draft = {
      t: (data.name || "NEW").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "NEW",
      n: data.name || "Your company", s: stage, e: data.entity === "Incorporated" ? "Incorporated" : "Unincorporated",
      p: ANCHOR[stage] / 1e6, h: data.line || "", dek: "Preview of your round. Nothing is published until the Prospecto backend is live.",
      f: data.fname ? [{ n: data.fname, r: data.role || "Founder", li: normalizeLinkedIn(data.li) ?? undefined }] : [],
    };
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* private mode: preview page shows "No round here" */ }
  }, [done, data]);

  // Slide the question out, swap, slide the next one in.
  const go = (i: number) => {
    setErr("");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setCur(i); return; }
    setPhase("out");
    setTimeout(() => {
      setCur(i); setPhase("in");
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase("")));
    }, 220);
  };
  const next = (d: Data = data, skip = false) => {
    if (!skip && step.req && !summary(step, d)) { setErr("Needed to publish."); return; }
    if (!skip && step.k === "founder" && d.li && !normalizeLinkedIn(d.li)) { setErr("Use your LinkedIn profile link, like linkedin.com/in/your-name."); return; }
    if (cur < STEPS.length - 1) go(cur + 1); else setDone(true);
  };
  const pick = (v: string) => { const d = { ...data, [step.k]: v }; setData(d); next(d); };

  if (done) {
    const stage = (data.stage as Stage) || "IDEA";
    const anchor = ANCHOR[stage];
    const slug = (data.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
    const link = `<a href="https://prospecto.finance/i/${slug}">Invest in us →</a>`;
    const meta = [data.site, data.pub, data.fname && `${data.fname}${data.role ? ", " + data.role : ""}`].filter(Boolean).join(" · ");
    return (
      <section className="done on" aria-live="polite">
        <div>
          <span className="kicker">Proof · how backers see you</span>
          <div className="ad">
            <span className="what">Wanted: first believers</span>
            <h3>{data.name}</h3>
            <p>{(data.line || "").replace(/[.!?]+$/, "")}. {data.entity === "Incorporated" ? "Incorporated" : "Unincorporated project"} · {stage}.</p>
            <span className="meta">{meta || "Add links any time."}</span>
          </div>
          <div className="stats">
            <div><span>Anchor</span><b>${anchor.toLocaleString()}</b></div>
            <div><span>Unit price</span><b className="up">${(anchor / 1e6).toFixed(2)}</b></div>
            <div><span>Cap</span><b>100,000</b></div>
          </div>
        </div>
        <div>
          <h2>Ready to <i>print.</i></h2>
          <p className="kicker" style={{ marginTop: 16 }}>Your “Invest in us” link</p>
          <code className="snip">&lt;a href=<em>&quot;https://prospecto.finance/i/{slug}&quot;</em>&gt;Invest in us →&lt;/a&gt;</code>
          <div className="row">
            <button className="btn ghost" type="button" onClick={() => { setDone(false); setCur(0); }}>← Edit answers</button>
            <button className="btn" type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy link"}</button>
            <Link className="btn go" href="/round/?co=draft">Publish →</Link>
          </div>
          <p className="kicker" style={{ marginTop: 18, textTransform: "none", letterSpacing: ".02em" }}>Demo only: simulated units, illustrative estimate.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="desk">
      <aside className="nb">
        <span className="kicker">Your answers</span>
        {STEPS.map((s, i) => {
          const v = summary(s, data);
          return (
            <button key={s.k} type="button" className={`${!v && i !== cur ? "todo" : ""} ${i === cur ? "cur" : ""}`} onClick={() => go(i)}>
              <span>{s.sec}</span><b>{v || "—"}</b>
            </button>
          );
        })}
      </aside>
      <div className="stage">
        <div className="folio"><span>Question {cur + 1} of {STEPS.length}</span><span>{step.sec}</span></div>
        <div className="dots">{STEPS.map((s, i) => <i key={s.k} className={i <= cur ? "on" : ""} />)}</div>
        <form className={`q ${phase}`} noValidate onSubmit={(e) => { e.preventDefault(); next(); }}>
          <h2>{step.q[0]} <i>{step.q[1]}</i></h2>
          {step.opts ? (
            <div className="opts">
              {step.opts.map((o) => <button key={o} type="button" aria-pressed={data[step.k] === o} onClick={() => pick(o)}>{o}</button>)}
            </div>
          ) : (
            step.fields!.map((f, fi) => (
              <div key={f.k}>
                {f.l && <label htmlFor={`f-${f.k}`}>{f.l}</label>}
                <input
                  id={`f-${f.k}`} ref={fi === 0 ? firstInput : undefined} name={f.k} type={f.type ?? "text"} placeholder={f.ph}
                  aria-label={f.l ?? step.sec} value={data[f.k] ?? ""}
                  onChange={(e) => setData({ ...data, [f.k]: e.target.value })}
                />
              </div>
            ))
          )}
          {step.hint && <p className="hint">{step.hint}</p>}
          <p className="err" role="alert">{err}</p>
          <button type="submit" hidden />
        </form>
        <div className="acts">
          <button className="btn ghost" type="button" style={{ visibility: cur ? "visible" : "hidden" }} onClick={() => cur && go(cur - 1)}>← Back</button>
          <span className="enter">Press <kbd>Enter ↵</kbd></span>
          <span className="row">
            {!step.req && <button className="btn ghost" type="button" onClick={() => next(data, true)}>Skip</button>}
            <button className="btn go" type="button" onClick={() => next()}>Next →</button>
          </span>
        </div>
      </div>
    </section>
  );
}
