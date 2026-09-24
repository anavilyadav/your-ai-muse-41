import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Search, CreditCard } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, ErrorBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { OWNER_NAV } from "./owner.index";
import { SortToggle, applyDirection, type SortMode, type SortDirection } from "./owner.data-quality";
import {
  fetchDataQualityReport, isDuplicateCardNumber, savePatientCardNumber,
  compareByName, compareByCardNumber, type DQPatientRef,
} from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/fix-cards")({
  head: () => ({ meta: [{ title: "Adhoore Card Number Theek Karo — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <FixCardsPage />
    </AuthGate>
  ),
});

const PAGE_SIZE = 50;

type PartialCardPatient = DQPatientRef & { card_series: string | null; card_register: string | null; card_number: string | null };

function CardRow({
  p,
  onSaved,
}: {
  p: PartialCardPatient;
  onSaved: (id: string) => void;
}) {
  const [series, setSeries] = useState(p.card_series ?? "");
  const [register, setRegister] = useState(p.card_register ?? "");
  const [number, setNumber] = useState(p.card_number ?? "");
  const [dupWarn, setDupWarn] = useState(false);
  const [saving, setSaving] = useState(false);
  const changed = series !== (p.card_series ?? "") || register !== (p.card_register ?? "") || number !== (p.card_number ?? "");

  const checkDup = async (s: string, r: string, n: string) => {
    if (s.trim() && r.trim() && n.trim()) setDupWarn(await isDuplicateCardNumber(s, r, n, p.id));
    else setDupWarn(false);
  };

  const save = async () => {
    const filledCount = [series, register, number].filter((v) => v.trim()).length;
    // The whole point of this screen is "not all three filled" — saving
    // another 1-or-2-filled combination would leave this patient right
    // back in the same partial_card list on next refresh with no signal
    // why. Either complete it, or genuinely clear it (this patient really
    // has no card) — no in-between.
    if (filledCount !== 0 && filledCount !== 3) {
      toast.error("Ya to teeno (Series/Register/Number) bharo, ya teeno khaali chhodo — warna adhoora hi rahega");
      return;
    }
    if (dupWarn) { toast.error("Ye card number kisi aur patient ke paas already hai"); return; }
    setSaving(true);
    const res = await savePatientCardNumber(p.id, series, register, number);
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success(filledCount === 0 ? "Card khaali kar diya" : "Card number save ho gaya");
    onSaved(p.id);
  };

  return (
    <div className="rounded-xl bg-surface border border-border p-3">
      <div className="text-[13px] font-semibold text-primary mb-2">
        {p.name} <span className="text-[11px] font-normal text-muted-foreground">{p.patient_code}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input
          placeholder="Series (e.g. B)"
          value={series}
          maxLength={2}
          onChange={(e) => { const v = e.target.value.toUpperCase(); setSeries(v); checkDup(v, register, number); }}
          className={cn("rounded-lg bg-background border px-2.5 py-2 text-sm uppercase", dupWarn ? "border-destructive" : "border-input")}
        />
        <input
          placeholder="Register no."
          value={register}
          onChange={(e) => { setRegister(e.target.value); checkDup(series, e.target.value, number); }}
          className={cn("rounded-lg bg-background border px-2.5 py-2 text-sm", dupWarn ? "border-destructive" : "border-input")}
        />
        <input
          placeholder="Card no."
          value={number}
          onChange={(e) => { setNumber(e.target.value); checkDup(series, register, e.target.value); }}
          className={cn("rounded-lg bg-background border px-2.5 py-2 text-sm", dupWarn ? "border-destructive" : "border-input")}
        />
      </div>
      {dupWarn && <p className="text-[11px] text-destructive mt-1.5">⚠ Ye card number isi series/register mein kisi aur patient ke paas hai</p>}
      <button
        onClick={save}
        disabled={!changed || saving}
        className={cn(
          "mt-2 w-full rounded-lg py-2 text-[12px] font-bold inline-flex items-center justify-center gap-1.5",
          changed ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground opacity-50",
        )}
      >
        <Check className="h-3.5 w-3.5" /> Save
      </button>
    </div>
  );
}

function FixCardsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["data-quality-report"], queryFn: fetchDataQualityReport });
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSaved = (id: string) => {
    setFixedIds((s) => new Set(s).add(id));
    qc.setQueryData(["data-quality-report"], (old: any) =>
      old ? { ...old, partial_card: old.partial_card.filter((p: DQPatientRef) => p.id !== id), partial_card_total: Math.max(0, old.partial_card_total - 1) } : old,
    );
  };

  if (q.isLoading) return <RoleShell wide title="Adhoore Card Number" nav={OWNER_NAV}><LoadingBlock /></RoleShell>;
  if (q.isError) return <RoleShell wide title="Adhoore Card Number" nav={OWNER_NAV}><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></RoleShell>;

  const all = ((q.data!.partial_card ?? []) as PartialCardPatient[]).filter((p) => !fixedIds.has(p.id));
  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower
    ? all.filter((p) => (p.name ?? "").toLowerCase().includes(searchLower) || (p.patient_code ?? "").toLowerCase().includes(searchLower))
    : all;
  const sorted = sortMode === "default" ? (sortDirection === "asc" ? filtered : [...filtered].reverse()) : [...filtered].sort((a, b) => applyDirection((sortMode === "name" ? compareByName : compareByCardNumber)(a, b), sortDirection));
  const visible = sorted.slice(0, visibleCount);

  return (
    <RoleShell wide title="Adhoore Card Number Theek Karo" subtitle={`${all.length} baaki hain`} nav={OWNER_NAV}>
      <div className="rounded-2xl bg-primary text-primary-foreground p-3.5 flex items-start gap-2 mb-3">
        <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-[12px]">
          Series/Register/Card teeno bharo (ya patient ke paas card hi nahi hai to teeno khaali chhod do), Save karo —
          save hote hi list se hat jayega.
        </span>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
          placeholder="Naam ya patient code se filter karo"
          className="w-full rounded-full bg-surface border border-input pl-10 pr-4 py-2.5 text-sm"
        />
      </div>

      <SortToggle mode={sortMode} onChange={setSortMode} direction={sortDirection} onDirectionChange={setSortDirection} />

      {all.length === 0 ? (
        <div className="rounded-2xl bg-success/10 text-success p-5 text-center text-sm font-semibold">
          Sab card numbers theek ho gaye — koi adhoora nahi bacha.
        </div>
      ) : filtered.length === 0 ? (
        <EmptyBlock label="Is search se koi match nahi mila." />
      ) : (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {visible.map((p) => (
              <CardRow key={p.id} p={p} onSaved={handleSaved} />
            ))}
          </div>
          {visibleCount < filtered.length && (
            <button
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="mt-3 w-full rounded-xl bg-surface border border-border py-2.5 text-sm font-bold text-primary"
            >
              Aur {Math.min(PAGE_SIZE, filtered.length - visibleCount)} dikhao ({filtered.length - visibleCount} baaki)
            </button>
          )}
        </>
      )}
    </RoleShell>
  );
}
