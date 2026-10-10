// Exact decimal handling for evidence values. Values are scaled BigInts with 8 fractional digits,
// matching evidence_claims.value_numeric numeric(30, 8). No binary floating point.

export const DECIMAL_PATTERN = /^-?\d{1,22}(?:\.\d{1,8})?$/;
const SCALE = 8;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

export function isDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

/** Parses a decimal string into a BigInt scaled by 10^8. Throws on invalid input. */
export function toScaled(value: string): bigint {
  if (!isDecimal(value)) throw new RangeError(`invalid decimal: ${value}`);
  const negative = value.startsWith("-");
  const [intPart, fracPart = ""] = (negative ? value.slice(1) : value).split(".");
  const scaled = BigInt(intPart) * SCALE_FACTOR + BigInt(fracPart.padEnd(SCALE, "0"));
  return negative ? -scaled : scaled;
}

export function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = abs / SCALE_FACTOR;
  const frac = (abs % SCALE_FACTOR).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${intPart}${frac ? `.${frac}` : ""}`;
}

/** Canonical form: no leading/trailing zeros, no "-0". */
export function normalizeDecimal(value: string): string {
  return fromScaled(toScaled(value));
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = toScaled(a);
  const y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isInteger(value: string): boolean {
  return isDecimal(value) && toScaled(value) % SCALE_FACTOR === 0n;
}

/** True when |a − b| > tolerancePct% of max(|a|, |b|). Exact integer arithmetic. */
export function differsBeyond(a: string, b: string, tolerancePct: bigint): boolean {
  const x = toScaled(a);
  const y = toScaled(b);
  const diff = x > y ? x - y : y - x;
  const absX = x < 0n ? -x : x;
  const absY = y < 0n ? -y : y;
  const max = absX > absY ? absX : absY;
  return diff * 100n > max * tolerancePct;
}

const MULTIPLIERS: Record<string, number> = {
  k: 3,
  thousand: 3,
  m: 6,
  mm: 6,
  mn: 6,
  million: 6,
  b: 9,
  bn: 9,
  billion: 9,
  t: 12,
  trillion: 12,
};

// Matches "5,000", "$1.2M", "40%", "3.5 million", "12k". Suffix must end at a word boundary.
const NUMBER_IN_TEXT =
  /(?<![\d.])(-?\d{1,3}(?:,\d{3})+|-?\d+)(?:\.(\d+))?\s?(k|thousand|mm|mn|m|million|bn|b|billion|t|trillion)?(?![a-z])/gi;

/**
 * Every number a quote states, in canonical decimal form, expanding k/M/B suffixes.
 * Used to confirm that a claimed value literally appears in the cited text.
 */
export function numbersInText(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(NUMBER_IN_TEXT)) {
    const intPart = match[1].replace(/,/g, "");
    const fracPart = match[2] ?? "";
    const exponent = match[3] ? MULTIPLIERS[match[3].toLowerCase()] : 0;
    if (fracPart.length > 8 || intPart.replace("-", "").length > 22) continue;
    const base = fracPart ? `${intPart}.${fracPart}` : intPart;
    found.add(normalizeDecimal(base));
    if (exponent) {
      const scaled = toScaled(base) * 10n ** BigInt(exponent);
      found.add(fromScaled(scaled));
    }
  }
  return found;
}

export function valueAppearsInText(value: string, text: string): boolean {
  return numbersInText(text).has(normalizeDecimal(value));
}
