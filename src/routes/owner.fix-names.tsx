import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Search, UserX } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, ErrorBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { OWNER_NAV } from "./owner.index";
import { fetchDataQualityReport, updatePatientContactInfo, formatCardNumber, compareByName, compareByCardNumber, type DQPatientRef } from "@/lib/db";
import { cn } from "@/lib/utils";
import { SortToggle, type SortMode } from "./owner.data-quality";

export const Route = createFileRoute("/owner/fix-names")({
  head: () => ({ meta: [{ title: "Adhoore Naam Theek Karo — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <FixNamesPage />
    </AuthGate>
  ),
});

const PAGE_SIZE = 50;

function NameRow({
  p,
  onSaved,
}: {
  p: DQPatientRef;
  onSaved: (id: string) => void;
}) {
  const [draft, setDraft] = useState(p.name ?? "");
  const [saving, setSaving] = useState(false);
  const changed = draft.trim() !== (p.name ?? "").trim();
  const card = formatCardNumber(p.card_series, p.card_register, p.card_number);

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) { toast.error("Naam khaali nahi ho sakta"); return; }
    // A single-word name is exactly the problem this screen exists to fix —
    // saving another single word would silently leave this patient back in
    // the same "adhoora naam" list on next refresh with no indication why.
    if (!trimmed.includes(" ")) { toast.error("Poora naam likho (first + last) — sirf ek word abhi bhi adhoora gina jayega"); return; }
    setSaving(true);
    const res = await updatePatientContactInfo(p.id, { name: trimmed });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success(`"${trimmed}" save ho gaya`);
    onSaved(p.id);
  };

  return (
    <div className="rounded-xl bg-surface border border-border p-3 flex items-center gap-2.5">
      <div className="min-w-0 flex-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && changed && !saving) save(); }}
          className="w-full rounded-lg bg-background border border-input px-3 py-2 text-sm font-semibold text-primary"
        />
        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          {p.mobile && <span>{p.mobile}</span>}
          {card && <span>Card: {card}</span>}
          {p.patient_code && <span>{p.patient_code}</span>}
        </div>
      </div>
      <button
        onClick={save}
        disabled={!changed || saving}
        className={cn(
          "shrink-0 h-9 w-9 grid place-items-center rounded-full",
          changed ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground opacity-50",
        )}
        aria-label="Save"
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}

function FixNamesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["data-quality-report"], queryFn: fetchDataQualityReport });
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sortMode, setSortMode] = useState<SortMode>("default");

  const handleSaved = (id: string) => {
    setFixedIds((s) => new Set(s).add(id));
    // Keep the live count in the header (and the Data Quality screen's own
    // count, since they share a query key) accurate without waiting for a
    // full refetch of a 1417-row report on every single save.
    qc.setQueryData(["data-quality-report"], (old: any) =>
      old ? { ...old, incomplete_names: old.incomplete_names.filter((p: DQPatientRef) => p.id !== id), incomplete_names_total: Math.max(0, old.incomplete_names_total - 1) } : old,
    );
  };

  if (q.isLoading) return <RoleShell wide title="Adhoore Naam" nav={OWNER_NAV}><LoadingBlock /></RoleShell>;
  if (q.isError) return <RoleShell wide title="Adhoore Naam" nav={OWNER_NAV}><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></RoleShell>;

  const all = (q.data!.incomplete_names ?? []).filter((p) => !fixedIds.has(p.id));
  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower
    ? all.filter((p) => (p.name ?? "").toLowerCase().includes(searchLower) || (p.mobile ?? "").includes(searchLower) || (p.patient_code ?? "").toLowerCase().includes(searchLower))
    : all;
  const sorted = sortMode === "default" ? filtered : [...filtered].sort(sortMode === "name" ? compareByName : compareByCardNumber);
  const visible = sorted.slice(0, visibleCount);

  return (
    <RoleShell wide title="Adhoore Naam Theek Karo" subtitle={`${all.length} baaki hain`} nav={OWNER_NAV}>
      <div className="rounded-2xl bg-primary text-primary-foreground p-3.5 flex items-start gap-2 mb-3">
        <UserX className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-[12px]">
          Har patient ka poora naam (first + last) likho, Enter dabao ya ✓ tap karo — save hote hi list se hat jayega.
          Mobile/card yahin dikh raha hai reference ke liye.
        </span>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
          placeholder="Naam, mobile ya card se filter karo"
          className="w-full rounded-full bg-surface border border-input pl-10 pr-4 py-2.5 text-sm"
        />
      </div>

      <SortToggle mode={sortMode} onChange={setSortMode} />

      {all.length === 0 ? (
        <div className="rounded-2xl bg-success/10 text-success p-5 text-center text-sm font-semibold">
          Sab naam theek ho gaye — koi adhoora naam nahi bacha.
        </div>
      ) : filtered.length === 0 ? (
        <EmptyBlock label="Is search se koi match nahi mila." />
      ) : (
        <>
          <div className="space-y-2">
            {visible.map((p) => (
              <NameRow key={p.id} p={p} onSaved={handleSaved} />
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
