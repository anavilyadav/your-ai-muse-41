import { useQuery } from "@tanstack/react-query";
import { fetchPatientCards, type PatientCardFields } from "@/lib/db";

// Card fields for the patients in a list whose rows only carry a patient id.
export function usePatientCards(ids: (string | null | undefined)[]): Record<string, PatientCardFields> {
  const list = Array.from(new Set(ids.filter((x): x is string => !!x))).sort();
  const { data } = useQuery({
    queryKey: ["patient-cards", list.join(",")],
    queryFn: () => fetchPatientCards(list),
    enabled: list.length > 0,
    staleTime: 60_000,
  });
  return data ?? {};
}
