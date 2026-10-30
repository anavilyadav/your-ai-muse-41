// Patient search + sort shared by every patient search box (30 Oct 2026).
//
// Dr. Yadav: "har search pe sort karne ka option aana chahiye" and searching
// a printed card ("A 57-39", "B-05-79") kept turning up noise — each card part
// was matched with "contains", so "B-5-79" also pulled every register with a 5
// in it (15, 50, 57…) and the real card got lost in an unsorted list of 30.
// Card numbers in the database are always stored padded ("05", "79", "50A"),
// so a typed card is now matched exactly, part by part.

export interface CardTerm {
  series?: string;
  register?: string;
  /** Exact values the number column may hold: "50" also covers 50A/50B/50C. */
  numbers?: string[];
}

const pad2 = (d: string) => d.padStart(2, "0");

function numberVariants(raw: string): string[] {
  const m = raw.toUpperCase().match(/^(\d{1,3})([A-Z]?)$/);
  if (!m) return [raw.toUpperCase()];
  const n = pad2(m[1]);
  // An A/B suffix marks two different patients on one card slot (26A / 26B);
  // without a typed suffix, show all of them.
  return m[2] ? [n + m[2]] : [n, `${n}A`, `${n}B`, `${n}C`];
}

/**
 * Reads a typed card number the ways staff actually type it:
 * "A-57-39", "A 57-39", "a57 39", "57-39" (any series), "B-81" (a whole
 * register), "1T-24" / "1T 24" (T series has no register). Returns null
 * when the term is not a card number.
 */
export function parseCardTerm(term: string): CardTerm | null {
  const t = term.trim().toUpperCase().replace(/\s*-\s*/g, "-");
  let m = t.match(/^([1-9]T)[\s-]*(\d{1,3}[A-Z]?)$/);
  if (m) return { series: m[1], numbers: numberVariants(m[2]) };
  m = t.match(/^([A-Z]{1,2})[\s-]*(\d{1,3})[\s-]+(\d{1,3}[A-Z]?)$/);
  if (m) return { series: m[1], register: pad2(m[2]), numbers: numberVariants(m[3]) };
  m = t.match(/^(\d{1,3})[\s-]+(\d{1,3}[A-Z]?)$/);
  if (m) return { register: pad2(m[1]), numbers: numberVariants(m[2]) };
  m = t.match(/^([A-Z]{1,2})[\s-]*(\d{1,3})$/);
  if (m) return { series: m[1], register: pad2(m[2]) };
  return null;
}

/** PostgREST and(...) group for a parsed card, or "" when the term is no card. */
export function cardFilterGroup(term: string): string {
  // A bare "39" could be a register or a card number.
  const lone = term.trim().toUpperCase().match(/^(\d{1,3})([A-Z]?)$/);
  if (lone) {
    const nums = numberVariants(lone[0]);
    const numClause = nums.length === 1 ? `card_number.eq.${nums[0]}` : `card_number.in.(${nums.join(",")})`;
    return lone[2] ? numClause : `or(card_register.eq.${pad2(lone[1])},${numClause})`;
  }
  const c = parseCardTerm(term);
  if (!c) return "";
  const parts: string[] = [];
  if (c.series) parts.push(`card_series.eq.${c.series}`);
  if (c.register) parts.push(`card_register.eq.${c.register}`);
  if (c.numbers) parts.push(c.numbers.length === 1 ? `card_number.eq.${c.numbers[0]}` : `card_number.in.(${c.numbers.join(",")})`);
  return `and(${parts.join(",")})`;
}

type CardFields = { card_series?: string | null; card_register?: string | null; card_number?: string | null };

export function cardMatchesTerm(p: CardFields, term: string): boolean {
  const c = parseCardTerm(term);
  if (!c) return false;
  if (c.series && (p.card_series ?? "").toUpperCase() !== c.series) return false;
  if (c.register && (p.card_register ?? "") !== c.register) return false;
  if (c.numbers && !c.numbers.includes((p.card_number ?? "").toUpperCase())) return false;
  return true;
}

export type PatientSort = "best" | "name" | "card" | "recent" | "visits";

export const PATIENT_SORTS: { key: PatientSort; label: string }[] = [
  { key: "best", label: "Best match" },
  { key: "name", label: "Naam A–Z" },
  { key: "card", label: "Card no." },
  { key: "recent", label: "Last visit" },
  { key: "visits", label: "Most visits" },
];

type SortablePatient = CardFields & {
  name?: string | null;
  mobile?: string | null;
  patient_code?: string | null;
  last_visit_date?: string | null;
  lifetime_visits?: number | null;
};

function compareCards(a: SortablePatient, b: SortablePatient): number {
  const ac = !!(a.card_series || a.card_register || a.card_number);
  const bc = !!(b.card_series || b.card_register || b.card_number);
  if (!ac || !bc) return ac ? -1 : bc ? 1 : 0;
  return (
    (a.card_series ?? "").localeCompare(b.card_series ?? "") ||
    (Number(a.card_register) || 0) - (Number(b.card_register) || 0) ||
    (parseInt(a.card_number ?? "", 10) || 0) - (parseInt(b.card_number ?? "", 10) || 0) ||
    (a.card_number ?? "").localeCompare(b.card_number ?? "")
  );
}

const byName = (a: SortablePatient, b: SortablePatient) =>
  (a.name ?? "").trim().toLowerCase().localeCompare((b.name ?? "").trim().toLowerCase());

// Newest visit first; never-visited patients last.
const byRecent = (a: SortablePatient, b: SortablePatient) =>
  (b.last_visit_date ?? "").localeCompare(a.last_visit_date ?? "");

/** How closely a patient matches the typed term: lower is better. */
export function matchRank(p: SortablePatient, term: string): number {
  const t = term.trim().toLowerCase();
  if (!t) return 9;
  if (cardMatchesTerm(p, term)) return 0;
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 6 && (p.mobile ?? "").replace(/\D/g, "") === digits) return 1;
  if ((p.patient_code ?? "").toLowerCase() === t.replace(/^sys-/, "yhc-")) return 1;
  const name = (p.name ?? "").trim().toLowerCase();
  if (name === t) return 2;
  const words = name.split(/\s+/);
  // "priyank" finds PRIYANK GANG before the many Priyankas.
  if (name.startsWith(`${t} `)) return 3;
  if (words.includes(t)) return 4;
  if (name.startsWith(t)) return 5;
  if (words.some((w) => w.startsWith(t))) return 6;
  if (digits.length >= 4 && (p.mobile ?? "").includes(digits)) return 7;
  return 8;
}

export function sortPatients<T extends SortablePatient>(rows: T[], sort: PatientSort, term = ""): T[] {
  const out = [...rows];
  switch (sort) {
    case "name":
      return out.sort((a, b) => byName(a, b) || compareCards(a, b));
    case "card":
      return out.sort((a, b) => compareCards(a, b) || byName(a, b));
    case "recent":
      return out.sort((a, b) => byRecent(a, b) || byName(a, b));
    case "visits":
      return out.sort((a, b) => (b.lifetime_visits ?? 0) - (a.lifetime_visits ?? 0) || byRecent(a, b));
    default:
      return out.sort((a, b) => matchRank(a, term) - matchRank(b, term) || byRecent(a, b) || byName(a, b));
  }
}
