"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ROUNDS, type Round } from "@/lib/fixtures";

const FILTERS = ["All", "Idea", "Prototype", "Launched", "Revenue", "Growth", "Closing soon"] as const;
type Filter = (typeof FILTERS)[number];

const matches = (c: Round, f: Filter) =>
  f === "All" ? true : f === "Closing soon" ? c.d > 0 && c.d <= 9 : c.s === f.toUpperCase();

export default function RoundsFeed() {
  const [active, setActive] = useState<Filter>("All");
  const list = ROUNDS.filter((c) => matches(c, active));
  return (
    <>
      <div className="filters">
        <div className="chips" role="group" aria-label="Filter rounds">
          {FILTERS.map((f) => (
            <button key={f} className="chip" aria-pressed={f === active} onClick={() => setActive(f)}>{f}</button>
          ))}
        </div>
        <span className="kicker">Fixed prices · bought from the startup</span>
      </div>
      {/* key forces a remount so cards replay their entrance on every filter change */}
      <section className="grid" aria-live="polite" key={active}>
        {list.length ? list.map((c, i) => {
          const full = c.sub >= 100, lead = i === 0 && list.length > 2;
          return (
            <article key={c.t} className={`card enter${lead ? " lead" : ""}`} style={{ "--n": i } as CSSProperties}>
              <Link className="cover" href="/#rounds" aria-label={`Back ${c.n}`} />
              <span className="k"><b>{c.s}</b> · {c.city} · {c.e}</span>
              {lead && <div className="plate"><div className="ridge" /><div className="sun" /></div>}
              <h2>{c.h}</h2>
              <p>{c.dek}</p>
              <span className="sp" />
              <div className={`bar${full ? " full" : ""}`}><i style={{ width: `${Math.min(c.sub, 100)}%` }} /></div>
              <div className="ft">
                <span>
                  <b>${c.p.toFixed(2)}</b> · {full ? <span className="dn">Full</span> : `${c.sub}%`}
                  {c.d > 0 && <> · <span className={c.d <= 3 ? "dn" : ""}>{c.d}d left</span></>}
                </span>
                <span className="go">{full ? "Watch" : "Back them"} <span>→</span></span>
              </div>
            </article>
          );
        }) : <p className="empty">No open rounds here yet.</p>}
      </section>
    </>
  );
}
