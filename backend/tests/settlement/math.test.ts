import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SettlementError, quote, settleRound, validateTerms, type RoundTerms } from "../../src/settlement/math.js";

const golden = JSON.parse(readFileSync(new URL("../../../docs/fixtures/nessie-purchase-cases.json", import.meta.url), "utf8"));

const termsOf = (c: { targetMicroUsd: string; maxUnits: string; unitPriceMicroUsd: string }): RoundTerms => ({
  unitPriceMicroUsd: BigInt(c.unitPriceMicroUsd),
  maxUnits: BigInt(c.maxUnits),
  targetMicroUsd: BigInt(c.targetMicroUsd),
  protocolFeeBps: BigInt(golden.feeBps),
  founderFeeShareBps: BigInt(golden.founderFeeShareBps),
});

describe("settleRound (docs/fixtures/nessie-purchase-cases.json)", () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const allocations = settleRound(termsOf(c), c.grossAmountsMicroUsd.map(BigInt), c.cancelled === true);
      expect(
        allocations.map((a) => ({
          acceptedMicroUsd: String(a.acceptedMicroUsd),
          feeMicroUsd: String(a.feeMicroUsd),
          founderRewardMicroUsd: String(a.founderRewardMicroUsd),
          platformRevenueMicroUsd: String(a.platformRevenueMicroUsd),
          projectProceedsMicroUsd: String(a.projectProceedsMicroUsd),
          units: String(a.units),
          refundMicroUsd: String(a.refundMicroUsd),
          dustMicroUsd: String(a.dustMicroUsd),
        })),
      ).toEqual(c.expected.map((e: Record<string, string>) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "note"))));
    });
  }
});

describe("terms and quotes", () => {
  const terms: RoundTerms = { unitPriceMicroUsd: 374_463n, maxUnits: 100_000n, targetMicroUsd: 37_446_300_000n, protocolFeeBps: 100n, founderFeeShareBps: 4000n };

  it("rejects terms the program would reject", () => {
    expect(() => validateTerms({ ...terms, targetMicroUsd: terms.targetMicroUsd + 1n })).toThrow(SettlementError);
    expect(() => validateTerms({ ...terms, unitPriceMicroUsd: 0n, targetMicroUsd: 0n })).toThrow(SettlementError);
    expect(() => validateTerms({ ...terms, protocolFeeBps: 10_001n })).toThrow(SettlementError);
    expect(() => validateTerms({ ...terms, maxUnits: 1n << 64n })).toThrow(SettlementError);
  });

  it("quotes the $100 golden purchase at the model price and flags pro-rata reduction", () => {
    const q = quote(terms, 100_000_000n, 0n);
    expect(q).toMatchObject({ acceptedMicroUsd: 100_000_000n, feeMicroUsd: 1_000_000n, units: 264n, proRataReduced: false });
    expect(q.dustMicroUsd).toBe(99_000_000n - 264n * 374_463n);
    expect(quote(terms, 1_000_000_000n, 37_000_000_000n).proRataReduced).toBe(true);
  });

  it("never allocates beyond supply in a heavily oversubscribed round", () => {
    const gross = Array.from({ length: 997 }, (_, i) => BigInt(1_000_000 + i * 7919));
    const allocations = settleRound(terms, gross.map((g) => g * 1000n));
    expect(allocations.reduce((s, a) => s + a.units, 0n) <= terms.maxUnits).toBe(true);
  });
});
