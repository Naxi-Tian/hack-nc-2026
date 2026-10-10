// PURE: round settlement math, the off-chain mirror of the program's (BACKEND_STACK §6.3, M§4.10–4.12,
// NESSIE_PURCHASE_FLOW §8). Integer micro-USD only; BigInt stands in for the program's u128
// intermediates. Used for quotes before a buyer signs and to reconcile the mirror against chain
// state. The program is authoritative for real settlement (BACKEND_STACK §3).

export const BPS = 10_000n;
const U64_MAX = (1n << 64n) - 1n;

export interface RoundTerms {
  unitPriceMicroUsd: bigint;
  maxUnits: bigint;
  targetMicroUsd: bigint;
  protocolFeeBps: bigint;
  founderFeeShareBps: bigint;
}

export interface Allocation {
  grossMicroUsd: bigint;
  acceptedMicroUsd: bigint;
  feeMicroUsd: bigint;
  founderRewardMicroUsd: bigint;
  platformRevenueMicroUsd: bigint;
  projectProceedsMicroUsd: bigint;
  units: bigint;
  refundMicroUsd: bigint;
  dustMicroUsd: bigint;
}

export class SettlementError extends Error {}

function u64(value: bigint, name: string): bigint {
  if (value < 0n || value > U64_MAX) throw new SettlementError(`${name} out of u64 range`);
  return value;
}

/** open_round's checks: positive price and supply, target = max_units × price, bps within range. */
export function validateTerms(terms: RoundTerms): void {
  if (u64(terms.unitPriceMicroUsd, "unit price") < 1n) throw new SettlementError("unit price must be at least 1 micro-USD");
  if (u64(terms.maxUnits, "max units") < 1n) throw new SettlementError("max units must be positive");
  if (u64(terms.targetMicroUsd, "target") !== terms.maxUnits * terms.unitPriceMicroUsd) {
    throw new SettlementError("target must equal max_units × unit_price");
  }
  for (const [name, bps] of [["protocol fee", terms.protocolFeeBps], ["founder share", terms.founderFeeShareBps]] as const) {
    if (bps < 0n || bps > BPS) throw new SettlementError(`${name} bps must be within 0–10000`);
  }
}

/** One subscription's settlement given the round's total commitments. All divisions round down. */
export function allocate(terms: RoundTerms, grossMicroUsd: bigint, totalCommittedMicroUsd: bigint): Allocation {
  u64(grossMicroUsd, "gross");
  u64(totalCommittedMicroUsd, "total committed");
  if (grossMicroUsd > totalCommittedMicroUsd) throw new SettlementError("gross exceeds total committed");
  const accepted =
    totalCommittedMicroUsd <= terms.targetMicroUsd ? grossMicroUsd : (grossMicroUsd * terms.targetMicroUsd) / totalCommittedMicroUsd;
  const fee = (accepted * terms.protocolFeeBps) / BPS;
  const founderReward = (fee * terms.founderFeeShareBps) / BPS;
  const proceeds = accepted - fee;
  const units = proceeds / terms.unitPriceMicroUsd;
  return {
    grossMicroUsd,
    acceptedMicroUsd: accepted,
    feeMicroUsd: fee,
    founderRewardMicroUsd: founderReward,
    platformRevenueMicroUsd: fee - founderReward,
    projectProceedsMicroUsd: proceeds,
    units,
    refundMicroUsd: grossMicroUsd - accepted,
    dustMicroUsd: proceeds - units * terms.unitPriceMicroUsd,
  };
}

/** A cancelled round accepts nothing, charges nothing, mints nothing, and refunds full gross. */
export function cancelledAllocation(grossMicroUsd: bigint): Allocation {
  return {
    grossMicroUsd: u64(grossMicroUsd, "gross"),
    acceptedMicroUsd: 0n,
    feeMicroUsd: 0n,
    founderRewardMicroUsd: 0n,
    platformRevenueMicroUsd: 0n,
    projectProceedsMicroUsd: 0n,
    units: 0n,
    refundMicroUsd: grossMicroUsd,
    dustMicroUsd: 0n,
  };
}

/** Settles a whole round and asserts BACKEND_STACK §6.3's invariants; throws if any fails. */
export function settleRound(terms: RoundTerms, grossAmounts: bigint[], cancelled = false): Allocation[] {
  validateTerms(terms);
  const total = grossAmounts.reduce((sum, gross) => sum + gross, 0n);
  const allocations = grossAmounts.map((gross) => (cancelled ? cancelledAllocation(gross) : allocate(terms, gross, total)));
  let accepted = 0n;
  let units = 0n;
  for (const a of allocations) {
    accepted += a.acceptedMicroUsd;
    units += a.units;
    const parts: [string, boolean][] = [
      ["accepted + refund = gross", a.acceptedMicroUsd + a.refundMicroUsd === a.grossMicroUsd],
      ["fee = founder reward + platform revenue", a.feeMicroUsd === a.founderRewardMicroUsd + a.platformRevenueMicroUsd],
      ["proceeds + fee = accepted", a.projectProceedsMicroUsd + a.feeMicroUsd === a.acceptedMicroUsd],
      ["units × price + dust = proceeds", a.units * terms.unitPriceMicroUsd + a.dustMicroUsd === a.projectProceedsMicroUsd],
      ["no negative values", Object.values(a).every((value) => value >= 0n)],
    ];
    const broken = parts.find(([, ok]) => !ok);
    if (broken) throw new SettlementError(`invariant failed: ${broken[0]}`);
  }
  if (accepted > terms.targetMicroUsd) throw new SettlementError("invariant failed: Σaccepted ≤ target");
  if (units > terms.maxUnits) throw new SettlementError("invariant failed: Σunits ≤ max_units");
  return allocations;
}

/**
 * What a buyer would get if the round closed with `committedSoFar + gross` in total. A later
 * oversubscription can still reduce it pro rata, which the UI must disclose (NESSIE_PURCHASE_FLOW §8).
 */
export function quote(terms: RoundTerms, grossMicroUsd: bigint, committedSoFarMicroUsd: bigint): Allocation & { proRataReduced: boolean } {
  const allocation = allocate(terms, grossMicroUsd, committedSoFarMicroUsd + grossMicroUsd);
  return { ...allocation, proRataReduced: allocation.acceptedMicroUsd < grossMicroUsd };
}
