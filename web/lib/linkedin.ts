/**
 * Founder-entered LinkedIn links. Accepts "linkedin.com/in/name" with or without scheme or "www."
 * and returns the canonical https profile URL, or null. Only /in/ profile paths are allowed, so a
 * link can never point anywhere but a LinkedIn profile. A link is not identity verification.
 */
export function normalizeLinkedIn(raw: string | undefined | null): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 200) return null;
  const m = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([A-Za-z0-9_-]{3,100})\/?(?:[?#].*)?$/i.exec(s);
  return m ? `https://www.linkedin.com/in/${m[1]}/` : null;
}
