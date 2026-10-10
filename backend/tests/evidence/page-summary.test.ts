import { describe, expect, it } from "vitest";

import { pageSummary } from "../../src/evidence/research/safe-fetch.js";

describe("pageSummary", () => {
  it("reads the title and first non-empty description, decoded and whitespace-collapsed", () => {
    const html = `<html><head><title>Asterlo &amp;  Research-backed
      outreach</title><meta name="description" content=""><meta property="og:description" content="Personalized outreach, with the receipts."></head><body>x</body></html>`;
    expect(pageSummary(html)).toEqual({ title: "Asterlo & Research-backed outreach", description: "Personalized outreach, with the receipts." });
  });

  it("caps long values and returns nulls when absent", () => {
    expect(pageSummary(`<title>${"a".repeat(500)}</title>`).title).toHaveLength(300);
    expect(pageSummary("<p>no head</p>")).toEqual({ title: null, description: null });
  });
});
