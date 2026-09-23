import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, PhoneCall, Check, MessageCircle } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, ErrorBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { OWNER_NAV } from "./owner.index";
import { SortToggle, type SortMode } from "./owner.data-quality";
import { fetchDataQualityReport, updatePatientContactInfo, formatCardNumber, compareByName, compareByCardNumber, type DQPatientRef } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/fix-unconfirmed")({
  head: () => ({ meta: [{ title: "Number Confirm Karo — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <FixUnconfirmedPage />
    </AuthGate>
  ),
});

const PAGE_SIZE = 50;

type UnconfirmedPatient = DQPatientRef & { mobile_confirmed: boolean; whatsapp_confirmed: boolean; has_distinct_whatsapp: boolean };

function UnconfirmedRow({
  p,
  onResolved,
}: {
  p: UnconfirmedPatient;
  onResolved: (id: string) => void;
}) {
  const [mobileConfirmed, setMobileConfirmed] = useState(p.mobile_confirmed);
  const [waConfirmed, setWaConfirmed] = useState(p.whatsapp_confirmed);
  // Starts from the server's has_distinct_whatsapp, but flips true the
  // moment a distinct number is added below — the row shouldn't have to
  // wait for a refetch to switch from "add WhatsApp number" to "confirm
  // WhatsApp number".
  const [hasDistinctWa, setHasDistinctWa] = useState(p.has_distinct_whatsapp);
  const [showWaInput, setShowWaInput] = useState(false);
  const [waNumber, setWaNumber] = useState("");
  const [saving, setSaving] = useState<"mobile" | "wa" | "addWa" | null>(null);
  const card = formatCardNumber(p.card_series, p.card_register, p.card_number);
  const resolved = mobileConfirmed && (!hasDistinctWa || waConfirmed);

  const confirmMobile = async () => {
    setSaving("mobile");
    const res = await updatePatientContactInfo(p.id, { mobile_confirmed: true });
    setSaving(null);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    setMobileConfirmed(true);
    toast.success("Mobile confirm ho gaya");
    if (!hasDistinctWa || waConfirmed) onResolved(p.id);
  };

  const confirmWa = async () => {
    setSaving("wa");
    const res = await updatePatientContactInfo(p.id, { whatsapp_confirmed: true });
    setSaving(null);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    setWaConfirmed(true);
    toast.success("WhatsApp confirm ho gaya");
    if (mobileConfirmed) onResolved(p.id);
  };

  // Adding the number IS the confirmation — staff is on the call finding
  // out the WhatsApp number is different from mobile, so entering it here
  // means it was just verified, not typed in blind.
  const saveWaNumber = async () => {
    const digits = waNumber.replace(/\D/g, "");
    if (digits.length < 10) { toast.error("Poora WhatsApp number likho"); return; }
    setSaving("addWa");
    const res = await updatePatientContactInfo(p.id, { whatsapp_country_code: "+91", whatsapp_number: digits, whatsapp_confirmed: true });
    setSaving(null);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    setHasDistinctWa(true);
    setWaConfirmed(true);
    setShowWaInput(false);
    toast.success("WhatsApp number save ho gaya");
    if (mobileConfirmed) onResolved(p.id);
  };

  return (
    <div className="rounded-xl bg-surface border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-primary truncate">{p.name}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {p.mobile && <span>{p.mobile}</span>}
            {card && <span>Card: {card}</span>}
          </div>
        </div>
        {p.mobile && (
          <a href={`tel:${p.mobile}`} className="shrink-0 h-9 w-9 grid place-items-center rounded-full bg-success text-success-foreground">
            <PhoneCall className="h-4 w-4" />
          </a>
        )}
      </div>
      <div className="flex gap-1.5 mt-2.5">
        <button
          onClick={confirmMobile}
          disabled={mobileConfirmed || saving === "mobile"}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold py-2",
            mobileConfirmed ? "bg-success/15 text-success" : "bg-primary text-primary-foreground disabled:opacity-60",
          )}
        >
          <Check className="h-3.5 w-3.5" /> {mobileConfirmed ? "Mobile Confirmed" : "Mobile Confirm Kiya"}
        </button>
        {hasDistinctWa && (
          <button
            onClick={confirmWa}
            disabled={waConfirmed || saving === "wa"}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold py-2",
              waConfirmed ? "bg-success/15 text-success" : "bg-accent text-accent-foreground disabled:opacity-60",
            )}
          >
            <MessageCircle className="h-3.5 w-3.5" /> {waConfirmed ? "WhatsApp Confirmed" : "WhatsApp Confirm Kiya"}
          </button>
        )}
      </div>

      {!hasDistinctWa && !resolved && (
        showWaInput ? (
          <div className="mt-2 flex gap-1.5">
            <input
              inputMode="numeric"
              placeholder="Alag WhatsApp number"
              value={waNumber}
              onChange={(e) => setWaNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
              className="flex-1 min-w-0 rounded-lg bg-background border border-input px-2.5 py-2 text-sm"
            />
            <button
              onClick={saveWaNumber}
              disabled={saving === "addWa"}
              className="shrink-0 rounded-lg bg-accent text-accent-foreground text-[12px] font-bold px-3 disabled:opacity-60"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowWaInput(true)}
            className="mt-2 w-full text-center text-[11px] font-semibold text-primary underline"
          >
            + Alag WhatsApp number add karo
          </button>
        )
      )}
    </div>
  );
}

function FixUnconfirmedPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["data-quality-report"], queryFn: fetchDataQualityReport });
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sortMode, setSortMode] = useState<SortMode>("default");

  const handleResolved = (id: string) => {
    setResolvedIds((s) => new Set(s).add(id));
    qc.setQueryData(["data-quality-report"], (old: any) =>
      old ? { ...old, unconfirmed_numbers: old.unconfirmed_numbers.filter((p: DQPatientRef) => p.id !== id), unconfirmed_numbers_total: Math.max(0, old.unconfirmed_numbers_total - 1) } : old,
    );
  };

  if (q.isLoading) return <RoleShell wide title="Number Confirm Karo" nav={OWNER_NAV}><LoadingBlock /></RoleShell>;
  if (q.isError) return <RoleShell wide title="Number Confirm Karo" nav={OWNER_NAV}><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></RoleShell>;

  const all = ((q.data!.unconfirmed_numbers ?? []) as UnconfirmedPatient[]).filter((p) => !resolvedIds.has(p.id));
  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower
    ? all.filter((p) => (p.name ?? "").toLowerCase().includes(searchLower) || (p.mobile ?? "").includes(searchLower) || (p.patient_code ?? "").toLowerCase().includes(searchLower))
    : all;
  const sorted = sortMode === "default" ? filtered : [...filtered].sort(sortMode === "name" ? compareByName : compareByCardNumber);
  const visible = sorted.slice(0, visibleCount);

  return (
    <RoleShell wide title="Number Confirm Karo" subtitle={`${all.length} baaki hain`} nav={OWNER_NAV}>
      <div className="rounded-2xl bg-primary text-primary-foreground p-3.5 flex items-start gap-2 mb-3">
        <PhoneCall className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-[12px]">
          Ye 5000+ calls karne ki list NAHI hai — jab bhi kisi bhi wajah se patient se baat ho (follow-up, complaint,
          visit), tab yahan uska naam dhoondh ke ek tap mein confirm karte jao. Naturally kam hota jayega.
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
          Sab numbers confirm ho gaye.
        </div>
      ) : filtered.length === 0 ? (
        <EmptyBlock label="Is search se koi match nahi mila." />
      ) : (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {visible.map((p) => (
              <UnconfirmedRow key={p.id} p={p} onResolved={handleResolved} />
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
