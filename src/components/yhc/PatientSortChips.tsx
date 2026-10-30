import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PATIENT_SORTS, sortPatients, type PatientSort } from "@/lib/patientSearch";

const STORAGE_KEY = "yhc-patient-sort";

function readSaved(): PatientSort {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as PatientSort | null;
    if (v && PATIENT_SORTS.some((s) => s.key === v)) return v;
  } catch {}
  return "best";
}

/** One sort choice shared by every patient search box, remembered on this device. */
export function usePatientSort() {
  const [sort, setSortState] = useState<PatientSort>(readSaved);
  const setSort = (s: PatientSort) => {
    setSortState(s);
    try { localStorage.setItem(STORAGE_KEY, s); } catch {}
  };
  return [sort, setSort] as const;
}

/** Patient search results in the chosen order. */
export function useSortedPatients<T extends Record<string, any>>(rows: T[] | undefined, sort: PatientSort, term: string): T[] {
  return useMemo(() => sortPatients(rows ?? [], sort, term), [rows, sort, term]);
}

export function PatientSortChips({ value, onChange, className }: { value: PatientSort; onChange: (s: PatientSort) => void; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-0.5">Sort</span>
      {PATIENT_SORTS.map((s) => (
        <button
          key={s.key}
          type="button"
          // Keeps focus in the search box, so a dropdown list stays open.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(s.key)}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
            value === s.key ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
