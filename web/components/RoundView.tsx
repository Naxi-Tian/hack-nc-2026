"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import HeroText from "@/components/HeroText";
import RoundTerminal from "@/components/RoundTerminal";
import FounderCards from "@/components/FounderCards";
import { getProject, STAGE_LABEL, STAGES, toRound } from "@/lib/api";
import type { Founder, Round } from "@/lib/fixtures";
import { normalizeLinkedIn } from "@/lib/linkedin";

/** sessionStorage key for the founder's unsaved preview from /launch/ (?co=draft; never sent anywhere). */
export const DRAFT_KEY = "prospecto:draft-round";

// The draft is user-typed data from this browser: accept it only if every field has the expected shape.
const readDraft = (): Round | null => {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    const ok = d && [d.t, d.n, d.h, d.dek].every((v) => typeof v === "string" && v.length <= 200)
      && (STAGES as readonly string[]).includes(d.s) && (d.e === "Incorporated" || d.e === "Unincorporated") && Number.isFinite(d.p) && d.p > 0;
    if (!ok) return null;
    // Founders: at most three, short plain strings, and a LinkedIn link only if it is a linkedin.com/in/ profile.
    const f: Founder[] = (Array.isArray(d.f) ? d.f : []).slice(0, 3)
      .filter((x: Founder) => x && typeof x.n === "string" && x.n.trim() && x.n.length <= 80 && typeof x.r === "string" && x.r.length <= 80)
      .map((x: Founder) => ({ n: x.n.trim(), r: x.r.trim() || "Founder", li: normalizeLinkedIn(x.li) ?? undefined }));
    return { t: d.t, n: d.n, s: d.s, e: d.e, p: d.p, h: d.h, dek: d.dek, f, sub: 0, b: 0, d: 21 };
  } catch { return null; }
};

export default function RoundView() {
  const params = useSearchParams();
  const slug = params.get("slug") ?? "";
  const isDraft = params.get("co")?.toUpperCase() === "DRAFT";
  // undefined while loading; null when there is nothing to show.
  const [co, setCo] = useState<Round | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCo(undefined); setError(null);
    if (isDraft) { setCo(readDraft()); return; }
    if (!slug) { setCo(null); return; }
    getProject(slug).then(
      (p) => setCo(p.round ? toRound(p) : null),
      (e: { status?: number; message: string }) => { if (e.status !== 404) setError(e.message); setCo(null); },
    );
  }, [slug, isDraft]);

  if (co === undefined) return null; // still loading
  if (!co) {
    return (
      <div className="head">
        <HeroText text="No round" em="here." />
        {error && <span className="kicker">{error}</span>}
        <Link className="btn" href={slug ? `/project/?slug=${slug}` : "/rounds/"}>{slug ? "See the profile →" : "Back a startup →"}</Link>
      </div>
    );
  }
  const preview = isDraft;
  return (
    <>
      <div className="head">
        <HeroText key={co.t} text="Back" em={`${co.n}.`} />
        <span className="kicker">{preview ? "Preview · not published, nothing is saved" : `${STAGE_LABEL[co.s]} · ${co.e}`}</span>
      </div>
      <div className="L round-term">
        <RoundTerminal key={co.slug ?? co.t} co={co} preview={preview} live={false} />
      </div>
      <FounderCards company={co.n} founders={co.f ?? []} demo={false} />
      <div className="foot"><Link href="/rounds/">← Back a startup</Link>{preview ? <Link href="/launch/">Edit your answers →</Link> : <Link href={`/project/?slug=${co.slug}`}>Why this price? →</Link>}</div>
    </>
  );
}
