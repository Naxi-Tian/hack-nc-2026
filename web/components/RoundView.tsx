"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import HeroText from "@/components/HeroText";
import RoundTerminal from "@/components/RoundTerminal";
import FounderCards from "@/components/FounderCards";
import { ROUNDS, type Founder, type Round, type Stage } from "@/lib/fixtures";
import { normalizeLinkedIn } from "@/lib/linkedin";

/** sessionStorage key for the founder's unsaved preview from /launch/ (demo only, no backend). */
export const DRAFT_KEY = "prospecto:draft-round";
const STAGES: Stage[] = ["IDEA", "PROTOTYPE", "LAUNCHED", "REVENUE", "GROWTH"];

// The draft is user-typed data from this browser: accept it only if every field has the expected shape.
const readDraft = (): Round | null => {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    const ok = d && [d.t, d.n, d.h, d.dek].every((v) => typeof v === "string" && v.length <= 200)
      && STAGES.includes(d.s) && (d.e === "Incorporated" || d.e === "Unincorporated") && Number.isFinite(d.p) && d.p > 0;
    if (!ok) return null;
    // Founders: at most three, short plain strings, and a LinkedIn link only if it is a linkedin.com/in/ profile.
    const f: Founder[] = (Array.isArray(d.f) ? d.f : []).slice(0, 3)
      .filter((x: Founder) => x && typeof x.n === "string" && x.n.trim() && x.n.length <= 80 && typeof x.r === "string" && x.r.length <= 80)
      .map((x: Founder) => ({ n: x.n.trim(), r: x.r.trim() || "Founder", li: normalizeLinkedIn(x.li) ?? undefined }));
    return { t: d.t, n: d.n, s: d.s, e: d.e, p: d.p, h: d.h, dek: d.dek, f, city: "", sub: 0, b: 0, d: 21 };
  } catch { return null; }
};

export default function RoundView() {
  const code = useSearchParams().get("co")?.toUpperCase() ?? "";
  const fixture = ROUNDS.find((r) => r.t === code) ?? null;
  const [draft, setDraft] = useState<Round | null | undefined>(undefined);
  useEffect(() => { setDraft(code === "DRAFT" ? readDraft() : null); }, [code]);

  const co = fixture ?? draft;
  if (!fixture && draft === undefined) return null; // still reading the preview
  if (!co) {
    return (
      <div className="head">
        <HeroText text="No round" em="here." />
        <Link className="btn" href="/rounds/">Back a startup →</Link>
      </div>
    );
  }
  const preview = co === draft;
  return (
    <>
      <div className="head">
        <HeroText key={co.t} text="Back" em={`${co.n}.`} />
        <span className="kicker">{preview ? "Preview · not published, nothing is saved" : `${co.s} · ${co.e} · demo fixture`}</span>
      </div>
      <div className="L round-term">
        <RoundTerminal key={co.t} co={co} preview={preview} />
      </div>
      <FounderCards company={co.n} founders={co.f ?? []} demo={!preview} />
      <div className="foot"><Link href="/rounds/">← Back a startup</Link>{preview ? <Link href="/launch/">Edit your answers →</Link> : <Link href="/how/">How it works →</Link>}</div>
    </>
  );
}
