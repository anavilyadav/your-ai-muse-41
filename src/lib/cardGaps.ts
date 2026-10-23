// Which card numbers are missing from a physical register book
// (Dr. Yadav, 23 Oct 2026: "har register wise batana ki is register me
// entry nahi aa rahi hai in numbers ki").
//
// A register holds roughly 60-110 numbers (1, 2, 3 ...). Two patients can
// share a printed number as 26A / 26B — that still counts as number 26
// being present. Only numbers up to the highest one seen are checked: what
// lies beyond it may simply not have been issued yet.

export interface RegisterGaps {
  /** Distinct numbers present (26A and 26B count once). */
  present: number;
  /** Highest number seen in the register. */
  highest: number;
  /** Numbers between 1 and `highest` that have no card. */
  missing: number[];
  /** Numbers that appear more than once as A/B/C doubles. */
  doubles: number;
}

export function baseNumber(cardNumber: string | null | undefined): number | null {
  const m = String(cardNumber ?? "").trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

export function registerGaps(cardNumbers: (string | null | undefined)[]): RegisterGaps {
  const seen = new Map<number, number>();
  for (const raw of cardNumbers) {
    const n = baseNumber(raw);
    if (n === null || n < 1) continue;
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  const highest = seen.size ? Math.max(...seen.keys()) : 0;
  const missing: number[] = [];
  for (let n = 1; n <= highest; n++) if (!seen.has(n)) missing.push(n);
  const doubles = Array.from(seen.values()).filter((c) => c > 1).length;
  return { present: seen.size, highest, missing, doubles };
}

/** "16, 17, 18, 40" -> "16-18, 40" so a long run stays readable. */
export function formatNumberRanges(nums: number[]): string {
  if (nums.length === 0) return "";
  const out: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const cur = nums[i];
    if (cur === prev + 1) { prev = cur; continue; }
    out.push(start === prev ? String(start) : prev === start + 1 ? `${start}, ${prev}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return out.join(", ");
}
