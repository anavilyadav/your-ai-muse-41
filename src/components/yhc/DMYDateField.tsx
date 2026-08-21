import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function parseISO(value: string): { day: number | null; month: number | null; year: number | null } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return { day: null, month: null, year: null };
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function toISO(day: number, month: number, year: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const selectClass =
  "rounded-lg bg-surface border border-input px-2 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

// Native <input type="date"> on Android has no fast year-jump the way
// iOS' scroll-wheel picker does — entering an old DOB means clicking
// "previous month" dozens of times (staff feedback, 13 Aug 2026). Plain
// Day/Month/Year dropdowns sidestep that entirely and behave identically
// on every platform. Outputs the same YYYY-MM-DD string every DOB/
// anniversary field in this app already expects.
export function DMYDateField({
  value,
  onChange,
  maxYear,
  minYear,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  maxYear?: number;
  minYear?: number;
  className?: string;
}) {
  // Day/month/year live as LOCAL state, not derived from `value` on every
  // render. The first cut of this component derived them straight from
  // `value` and called onChange("") whenever the triple was incomplete —
  // so picking just the day fired onChange(""), the parent re-rendered
  // with value="", and the day selection reset itself right back to blank
  // on the very next render. Staff could never pick day/month/year one at
  // a time; it looked like the dropdowns did nothing. Local state lets a
  // partial pick persist across renders — the parent only hears about it
  // once all three are actually chosen.
  const [day, setDay] = useState<number | null>(() => parseISO(value).day);
  const [month, setMonth] = useState<number | null>(() => parseISO(value).month);
  const [year, setYear] = useState<number | null>(() => parseISO(value).year);

  // The only external change this needs to react to is a full reset (e.g.
  // "Register Another" clearing the whole form back to "") — we never call
  // onChange with an incomplete date ourselves anymore, so any "" seen
  // here genuinely came from outside, not an echo of our own partial pick.
  useEffect(() => {
    if (value === "" && (day !== null || month !== null || year !== null)) {
      setDay(null);
      setMonth(null);
      setYear(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const effectiveMaxYear = maxYear ?? new Date().getFullYear();
  const effectiveMinYear = minYear ?? effectiveMaxYear - 120;

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = effectiveMaxYear; y >= effectiveMinYear; y--) arr.push(y);
    return arr;
  }, [effectiveMaxYear, effectiveMinYear]);

  const dayCount = month && year ? daysInMonth(month, year) : 31;
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount]);

  const commit = (nextDay: number | null, nextMonth: number | null, nextYear: number | null) => {
    // A previously-picked day can overflow a newly-picked shorter month
    // (e.g. 31 then switching to Feb) — clamp instead of leaving an
    // invalid day selected.
    const clampedDay = nextDay && nextMonth && nextYear ? Math.min(nextDay, daysInMonth(nextMonth, nextYear)) : nextDay;
    setDay(clampedDay);
    setMonth(nextMonth);
    setYear(nextYear);
    if (clampedDay && nextMonth && nextYear) {
      onChange(toISO(clampedDay, nextMonth, nextYear));
    }
  };

  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      <select value={day ?? ""} onChange={(e) => commit(e.target.value ? Number(e.target.value) : null, month, year)} className={selectClass}>
        <option value="">Din</option>
        {days.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select value={month ?? ""} onChange={(e) => commit(day, e.target.value ? Number(e.target.value) : null, year)} className={selectClass}>
        <option value="">Mahina</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      <select value={year ?? ""} onChange={(e) => commit(day, month, e.target.value ? Number(e.target.value) : null)} className={selectClass}>
        <option value="">Saal</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
