import { describe, expect, it } from "vitest";

import { campusEmailHash, isCampusEmail, parseCampusDomains } from "../../src/auth/campus-email.js";

describe("campus email", () => {
  const domains = parseCampusDomains(" unc.edu , Duke.edu ");

  it("parses and validates the domain list", () => {
    expect(domains).toEqual(["unc.edu", "duke.edu"]);
    expect(() => parseCampusDomains(" , ")).toThrow(/empty/);
    expect(() => parseCampusDomains("unc.edu,not a domain")).toThrow(/invalid domain/);
  });

  it("accepts campus domains and subdomains only", () => {
    expect(isCampusEmail("Student@UNC.edu", domains)).toBe(true);
    expect(isCampusEmail("student@cs.unc.edu", domains)).toBe(true);
    expect(isCampusEmail("student@gmail.com", domains)).toBe(false);
    // Suffix tricks must not pass.
    expect(isCampusEmail("student@notunc.edu", domains)).toBe(false);
    expect(isCampusEmail("student@unc.edu.evil.com", domains)).toBe(false);
    expect(isCampusEmail("a@b@unc.edu", domains)).toBe(false);
    expect(isCampusEmail("@unc.edu", domains)).toBe(false);
  });

  it("hashes the normalized email with the pepper", () => {
    const hash = campusEmailHash(" Student@UNC.edu ", "pepper-a");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(campusEmailHash("student@unc.edu", "pepper-a"));
    expect(hash).not.toBe(campusEmailHash("student@unc.edu", "pepper-b"));
  });
});
