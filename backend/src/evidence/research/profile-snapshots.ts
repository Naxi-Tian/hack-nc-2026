// Founder-provided LinkedIn profile snapshots (MARKET ARCHITECTURE §6.5). LinkedIn pages need a
// login and must never be scraped, so a founder can supply their profile text instead. The runner
// treats it as founder-provided text: every claim from it stays FOUNDER_ATTESTED.
import { readFile } from "node:fs/promises";

import { z } from "zod";

const snapshotFileSchema = z.object({
  profile_url: z.string().url(),
  provided_by: z.literal("founder"),
  captured_at: z.string().date(),
  text: z.string().trim().min(1).max(20_000),
});

export interface ProfileSnapshot {
  profileUrl: string;
  capturedAt: string;
  text: string;
}

export type ProfileSnapshotLookup = (url: string) => Promise<ProfileSnapshot | null>;

/** Keys on the /in/<handle> path, so www/http/trailing-slash/query variants of one profile match. */
export function linkedinProfileKey(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const match = /^\/in\/([^/]+)\/?$/i.exec(parsed.pathname);
  if (!match) return null;
  try {
    return `linkedin:${decodeURIComponent(match[1]).toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Loads snapshot JSON files (e.g. db/fixtures/demo-linkedin-snapshot.json). Throws on any invalid file. */
export async function loadProfileSnapshots(paths: readonly string[]): Promise<ProfileSnapshotLookup> {
  const byKey = new Map<string, ProfileSnapshot>();
  for (const path of paths) {
    const parsed = snapshotFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const key = linkedinProfileKey(parsed.profile_url);
    if (!key) throw new Error(`${path}: profile_url must be a LinkedIn /in/ profile URL`);
    byKey.set(key, { profileUrl: parsed.profile_url, capturedAt: parsed.captured_at, text: parsed.text });
  }
  return async (url) => {
    const key = linkedinProfileKey(url);
    return key ? (byKey.get(key) ?? null) : null;
  };
}
