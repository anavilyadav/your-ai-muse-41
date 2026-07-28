import { useEffect, useState } from "react";

/**
 * Returns `value`, but delayed by `delayMs` after the last change — for
 * search boxes that fire a network query on every keystroke otherwise.
 * Applies to every un-debounced search box flagged in the audit: leads.tsx
 * (30k+ rows), appointments.tsx, patient.$id.tsx (family search),
 * doctor.rx.history.tsx, doctor.rx.consult.$token.tsx (medicine search),
 * pharmacy.inventory.tsx.
 *
 * Usage:
 *   const [term, setTerm] = useState("");
 *   const debouncedTerm = useDebouncedValue(term, 300);
 *   useQuery({ queryKey: ["x", debouncedTerm], queryFn: () => fetchX(debouncedTerm) });
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
