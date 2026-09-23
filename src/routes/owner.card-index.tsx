import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { RoleShell } from "@/components/yhc/RoleShell";
import { fetchCardIndex, type CardIndexPatient } from "@/lib/db";

export const Route = createFileRoute("/owner/card-index")({
  head: () => ({ meta: [{ title: "Card Index — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <CardIndexPage />
    </AuthGate>
  ),
});

// Real registers run ~40-85 patients each (verified live 23 Sep 2026) — a
// freshly-started register with only a handful of patients isn't
// necessarily wrong, but it's exactly the kind of thing worth a second
// look, so it's called out rather than left for the Owner to notice on
// their own.
const LOW_COUNT_HINT = 5;

function CardIndexPage() {
  const [series, setSeries] = useState<string | null>(null);
  const [register, setRegister] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["card-index"],
    queryFn: fetchCardIndex,
    staleTime: 60_000,
  });

  const seriesList = useMemo(() => {
    if (!data) return [];
    return Object.keys(data)
      .sort((a, b) => (a.length !== b.length ? a.length - b.length : a.localeCompare(b)))
      .map((s) => ({ series: s, count: data[s].length }));
  }, [data]);

  const registersInSeries = useMemo(() => {
    if (!data || !series) return [];
    const byRegister = new Map<string, CardIndexPatient[]>();
    for (const p of data[series]) {
      (byRegister.get(p.card_register) ?? byRegister.set(p.card_register, []).get(p.card_register)!).push(p);
    }
    return Array.from(byRegister.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([register, patients]) => ({ register, patients }));
  }, [data, series]);

  const patientsInRegister = useMemo(() => {
    if (!data || !series || !register) return [];
    return data[series].filter((p) => p.card_register === register);
  }, [data, series, register]);

  if (isLoading) {
    return (
      <RoleShell wide title="Card Index" subtitle="Master sheet A-01-01, A-01-02... ke hisaab se" showBack>
        <LoadingBlock />
      </RoleShell>
    );
  }
  if (isError) {
    return (
      <RoleShell wide title="Card Index" subtitle="Master sheet A-01-01, A-01-02... ke hisaab se" showBack>
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      </RoleShell>
    );
  }

  // Level 3: patients within one register, sorted by card_number.
  if (series && register) {
    return (
      <RoleShell wide title={`${series}-${register}`} subtitle={`${patientsInRegister.length} patients is register mein`} showBack>
        <button onClick={() => setRegister(null)} className="inline-flex items-center gap-1 text-sm text-primary font-semibold mb-2">
          <ChevronLeft className="h-4 w-4" /> {series} ke registers
        </button>
        <ul className="space-y-2">
          {patientsInRegister.map((p) => (
            <li key={p.id}>
              <Link
                to="/patient/$id"
                params={{ id: p.id }}
                className="rounded-xl bg-surface border border-border p-3 flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-primary text-sm">
                    {series}-{register}-{p.card_number} <span className="font-normal text-muted-foreground">— {p.name}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {p.mobile} {p.patient_code && `• ${p.patient_code}`} • {p.lifetime_visits} visits
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </RoleShell>
    );
  }

  // Level 2: registers within one series, sorted numerically.
  if (series) {
    return (
      <RoleShell wide title={series} subtitle={`${registersInSeries.length} registers`} showBack>
        <button onClick={() => setSeries(null)} className="inline-flex items-center gap-1 text-sm text-primary font-semibold mb-2">
          <ChevronLeft className="h-4 w-4" /> Saari series
        </button>
        <div className="text-[11px] text-muted-foreground px-1 mb-2">
          Register ka count achanak bahut kam ho ({"<"}{LOW_COUNT_HINT}) to check karo — ho sakta hai card number galat type hua ho.
        </div>
        <ul className="space-y-1.5">
          {registersInSeries.map(({ register: r, patients }) => {
            const low = patients.length < LOW_COUNT_HINT;
            return (
              <li key={r}>
                <button
                  onClick={() => setRegister(r)}
                  className={
                    "w-full rounded-xl border p-3 flex items-center justify-between text-left " +
                    (low ? "bg-destructive/10 border-destructive/30" : "bg-surface border-border")
                  }
                >
                  <span className="font-bold text-primary text-sm">{series}-{r}</span>
                  <span className={"text-[12px] font-semibold " + (low ? "text-destructive" : "text-muted-foreground")}>
                    {patients.length} patient{patients.length === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </RoleShell>
    );
  }

  // Level 1: all series.
  return (
    <RoleShell wide title="Card Index" subtitle="Master sheet A-01-01, A-01-02... ke hisaab se" showBack>
      <div className="text-[12px] text-muted-foreground px-1 mb-2">
        Card series select karo — phir register, phir patient. Isse aap khud check kar sakte ho ki koi register missing ya galat to nahi.
      </div>
      <ul className="space-y-2">
        {seriesList.map(({ series: s, count }) => (
          <li key={s}>
            <button
              onClick={() => setSeries(s)}
              className="w-full rounded-2xl bg-surface border border-border p-3.5 flex items-center justify-between"
            >
              <span className="font-bold text-primary">{s} series</span>
              <span className="text-[12px] text-muted-foreground">{count} patients</span>
            </button>
          </li>
        ))}
      </ul>
    </RoleShell>
  );
}
