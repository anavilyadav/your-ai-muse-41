import { useMemo } from "react";
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
  const { day, month, year } = parseISO(value);
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
    if (!nextDay || !nextMonth || !nextYear) {
      onChange("");
      return;
    }
    // A previously-picked day can overflow a newly-picked shorter month
    // (e.g. 31 then switching to Feb) — clamp instead of producing an
    // invalid date.
    const clampedDay = Math.min(nextDay, daysInMonth(nextMonth, nextYear));
    onChange(toISO(clampedDay, nextMonth, nextYear));
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
