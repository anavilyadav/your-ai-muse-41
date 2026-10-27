// Which card numbers are missing from a physical register book
// (Dr. Yadav, 23 and 26 Oct 2026: "har register wise batana ki is register me
// entry nahi aa rahi hai in numbers ki").
//
// A register holds about 100 numbers, sometimes more, so every number from 1
// up to 100 (or the highest one seen, if that is above 100) is checked. Two
// patients can share a printed number as 26A / 26B - that still counts as
// number 26 being present. A number held by a deleted or merged patient is
// "hidden": taken, but not visible in the register's patient list.

export interface RegisterGaps {
  /** Distinct numbers present (26A and 26B count once). */
  present: number;
  /** Highest number seen in the register. */
  highest: number;
  /** Numbers checked: 1 up to this (at least EXPECTED_REGISTER_SIZE). */
  checkedUpTo: number;
  /** Numbers in 1..checkedUpTo that have no card at all. */
  missing: number[];
  /** Numbers held by a deleted/merged patient — taken, but not visible in the list. */
  hidden: number[];
  /** Numbers that appear more than once as A/B/C doubles. */
  doubles: number;
}

// A register book holds about 100 numbers, sometimes a few more (Dr. Yadav,
// 26 Oct 2026) — so numbers are checked up to 100 even when the highest
// entry so far is lower, and beyond 100 when the register already runs past it.
export const EXPECTED_REGISTER_SIZE = 100;

export function baseNumber(cardNumber: string | null | undefined): number | null {
  const m = String(cardNumber ?? "").trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

export function registerGaps(
  cardNumbers: (string | null | undefined)[],
  hiddenNumbers: (string | null | undefined)[] = [],
): RegisterGaps {
  const seen = new Map<number, number>();
  for (const raw of cardNumbers) {
    const n = baseNumber(raw);
    if (n === null || n < 1) continue;
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  const hiddenSet = new Set<number>();
  for (const raw of hiddenNumbers) {
    const n = baseNumber(raw);
    if (n !== null && n >= 1 && !seen.has(n)) hiddenSet.add(n);
  }
  const highest = seen.size ? Math.max(...seen.keys()) : 0;
  const checkedUpTo = Math.max(EXPECTED_REGISTER_SIZE, highest);
  const missing: number[] = [];
  for (let n = 1; n <= checkedUpTo; n++) if (!seen.has(n) && !hiddenSet.has(n)) missing.push(n);
  const doubles = Array.from(seen.values()).filter((c) => c > 1).length;
  return { present: seen.size, highest, checkedUpTo, missing, hidden: Array.from(hiddenSet).sort((x, y) => x - y), doubles };
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
