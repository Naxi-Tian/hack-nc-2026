import { createHmac } from "node:crypto";

const DOMAIN_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Better Auth also lowercases emails; normalizing here keeps hashes and domain checks aligned. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parses CAMPUS_EMAIL_DOMAINS ("unc.edu,duke.edu"). Throws so a misconfigured server fails at startup. */
export function parseCampusDomains(raw: string): string[] {
  const domains = raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
  if (domains.length === 0) {
    throw new Error("CAMPUS_EMAIL_DOMAINS is empty; set it to a comma-separated list such as unc.edu");
  }
  for (const domain of domains) {
    if (!DOMAIN_PATTERN.test(domain)) {
      throw new Error(`CAMPUS_EMAIL_DOMAINS contains an invalid domain: ${domain}`);
    }
  }
  return domains;
}

/** Accepts an allowed domain or any of its subdomains (cs.unc.edu for unc.edu). */
export function isCampusEmail(email: string, domains: readonly string[]): boolean {
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf("@");
  if (at <= 0 || at !== normalized.lastIndexOf("@")) return false;
  const domain = normalized.slice(at + 1);
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

/** Keyed hash stored as identities.campus_email_hash; the raw address stays in auth."user". */
export function campusEmailHash(email: string, pepper: string): string {
  return createHmac("sha256", pepper).update(normalizeEmail(email)).digest("hex");
}
