import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronLeft, Download } from "lucide-react";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { RoleShell } from "@/components/yhc/RoleShell";
import { fetchCardIndex, fetchHiddenCardNumbers, type CardIndexPatient, systemIdLabel } from "@/lib/db";
import { registerGaps, formatNumberRanges } from "@/lib/cardGaps";

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
  const [onlyGaps, setOnlyGaps] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["card-index"],
    queryFn: fetchCardIndex,
    staleTime: 60_000,
  });

  // Numbers still held by deleted patients: counted as taken ("hidden"), not missing.
  const { data: hiddenCards } = useQuery({ queryKey: ["card-index-hidden"], queryFn: fetchHiddenCardNumbers, staleTime: 60_000 });
  const hiddenFor = (s: string, r: string) =>
    (hiddenCards ?? []).filter((h) => h.series === s && h.register === r);

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
      .map(([register, patients]) => ({ register, patients, gaps: registerGaps(patients.map((p) => p.card_number), hiddenFor(series, register).map((h) => h.number)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, series, hiddenCards]);

  // Every series/register with its missing numbers — the totals on the
  // first screen and the CSV download both come from this.
  const allGaps = useMemo(() => {
    if (!data) return [];
    const rows: { series: string; register: string; patients: number; gaps: ReturnType<typeof registerGaps> }[] = [];
    for (const s of Object.keys(data)) {
      const byRegister = new Map<string, string[]>();
      for (const p of data[s]) (byRegister.get(p.card_register) ?? byRegister.set(p.card_register, []).get(p.card_register)!).push(p.card_number);
      for (const [r, nums] of byRegister) rows.push({ series: s, register: r, patients: nums.length, gaps: registerGaps(nums, hiddenFor(s, r).map((h) => h.number)) });
    }
    return rows.sort((a, b) =>
      a.series.length !== b.series.length ? a.series.length - b.series.length : a.series !== b.series ? a.series.localeCompare(b.series) : Number(a.register) - Number(b.register));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hiddenCards]);
  const missingBySeries = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allGaps) m.set(r.series, (m.get(r.series) ?? 0) + r.gaps.missing.length);
    return m;
  }, [allGaps]);

  const downloadCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ["Series", "Register", "Patients", "Sabse bada number", "Kaha tak check kiya", "Gayab kitne", "Gayab numbers", "Hidden (delete hue patient ke paas)"].map(esc).join(","),
      ...allGaps.map((r) => [r.series, r.register, r.patients, r.gaps.highest, r.gaps.checkedUpTo, r.gaps.missing.length, formatNumberRanges(r.gaps.missing), formatNumberRanges(r.gaps.hidden)].map(esc).join(",")),
    ];
    const url = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-register-gayab-numbers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
    const hiddenHere = hiddenFor(series, register);
    const gaps = registerGaps(patientsInRegister.map((p) => p.card_number), hiddenHere.map((h) => h.number));
    return (
      <RoleShell wide title={`${series}-${register}`} subtitle={`${patientsInRegister.length} patients is register mein`} showBack>
        <button onClick={() => setRegister(null)} className="inline-flex items-center gap-1 text-sm text-primary font-semibold mb-2">
          <ChevronLeft className="h-4 w-4" /> {series} ke registers
        </button>
        <div className={"rounded-xl border p-3 mb-3 text-[12px] " + (gaps.missing.length ? "bg-destructive/10 border-destructive/30 text-destructive" : "bg-success/10 border-success/30 text-success")}>
          {gaps.missing.length
            ? <>⚠️ <b>{gaps.missing.length} number gayab</b> (1 se {gaps.checkedUpTo} tak check kiya): {formatNumberRanges(gaps.missing)}</>
            : <>✓ 1 se {gaps.checkedUpTo} tak koi number gayab nahi.</>}
          {hiddenHere.length > 0 && (
            <div className="text-muted-foreground mt-0.5">
              🔒 Hidden (delete hue patient ke paas): {hiddenHere.map((h) => `${h.number} (${h.name})`).join(", ")}
            </div>
          )}
          {gaps.doubles > 0 && <div className="text-muted-foreground mt-0.5">{gaps.doubles} number A/B wale double hain (ek number pe 2 patient).</div>}
        </div>
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
                    {p.mobile} {p.patient_code && `• ${systemIdLabel(p.patient_code)}`} • {p.lifetime_visits} visits
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
          Laal "gayab" wale numbers ki entry is register me abhi nahi aayi hai.
        </div>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-primary mb-2 px-1">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} className="h-4 w-4" />
          Sirf jin registers me number gayab hain
        </label>
        <ul className="space-y-1.5">
          {registersInSeries.filter(({ gaps }) => !onlyGaps || gaps.missing.length > 0).map(({ register: r, patients, gaps }) => {
            const low = patients.length < LOW_COUNT_HINT;
            return (
              <li key={r}>
                <button
                  onClick={() => setRegister(r)}
                  className={
                    "w-full rounded-xl border p-3 text-left " +
                    (low ? "bg-destructive/10 border-destructive/30" : "bg-surface border-border")
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-primary text-sm">{series}-{r}</span>
                    <span className={"text-[12px] font-semibold " + (low ? "text-destructive" : "text-muted-foreground")}>
                      {patients.length} patient{patients.length === 1 ? "" : "s"} • aakhri no. {gaps.highest}
                    </span>
                  </div>
                  {gaps.missing.length > 0 && (
                    <div className="text-[11.5px] text-destructive mt-1 leading-snug">
                      {gaps.missing.length} gayab (1–{gaps.checkedUpTo}): {formatNumberRanges(gaps.missing)}
                    </div>
                  )}
                  {gaps.hidden.length > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">🔒 Hidden: {formatNumberRanges(gaps.hidden)}</div>
                  )}
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
        Card series select karo — phir register, phir patient. Har register me jo number gayab hain (entry nahi aayi) wo laal me dikhte hain.
      </div>
      <button
        onClick={downloadCsv}
        className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold text-primary"
      >
        <Download className="h-3.5 w-3.5" /> Saare registers ki gayab-number list (Excel/CSV)
      </button>
      <ul className="space-y-2">
        {seriesList.map(({ series: s, count }) => (
          <li key={s}>
            <button
              onClick={() => setSeries(s)}
              className="w-full rounded-2xl bg-surface border border-border p-3.5 flex items-center justify-between"
            >
              <span className="font-bold text-primary">{s} series</span>
              <span className="text-[12px] text-muted-foreground">
                {count} patients
                {(missingBySeries.get(s) ?? 0) > 0 && <b className="text-destructive"> • {missingBySeries.get(s)} number gayab</b>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </RoleShell>
  );
}
