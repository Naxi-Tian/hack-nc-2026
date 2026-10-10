// Round terms policy. Fees are M§4.12's initial example; the others are INVENTED demo limits
// (AGENTS.md: label assumptions) that the program's Config must mirror ("caps ≤ config limits",
// BACKEND_STACK §6.2). Changing any value is a versioned policy change, like a model version.
export const ROUND_POLICY = {
  version: "round-policy-v0.1",
  protocolFeeBps: 100n, // M§4.12: 1.00% of accepted
  founderFeeShareBps: 4000n, // M§4.12: 40% of the fee
  /** INVENTED: one round sells at most 20% of REFERENCE_UNITS (1,000,000). */
  maxUnitsPerRound: 200_000n,
  /** INVENTED: matches the frontend's 100,000-unit round fixture. */
  defaultMaxUnits: 100_000n,
  /** INVENTED: round length bounds and default, in whole days. */
  minDurationDays: 1,
  maxDurationDays: 30,
  defaultDurationDays: 14,
  /** INVENTED: default per-identity cap (M§10.2) as a share of the round target. */
  defaultMaxSubscriptionBps: 1000n,
  /** Round PDA seed uses round_number as u16 LE. */
  maxRoundNumber: 65_535,
} as const;
