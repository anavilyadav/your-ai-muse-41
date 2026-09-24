import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users, Phone, EyeOff, Link2 } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { OWNER_NAV } from "./owner.index";
import { PatientChip, SortToggle, applyDirection, type SortMode, type SortDirection } from "./owner.data-quality";
import {
  fetchDataQualityReport, fetchDismissedSharedMobiles, setSharedMobileDismissed,
  linkFamilyMember, compareByName, compareByCardNumber, RELATIONSHIPS, type DQPatientRef,
} from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/fix-shared-mobiles")({
  head: () => ({ meta: [{ title: "Shared Mobile Review — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <FixSharedMobilesPage />
    </AuthGate>
  ),
});

type Group = { mobile: string; count: number; patients: DQPatientRef[] };

function GroupCard({ group, onResolved }: { group: Group; onResolved: (mobile: string) => void }) {
  const [mode, setMode] = useState<"idle" | "family">("idle");
  const [relations, setRelations] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const anchor = group.patients[0];
  const others = group.patients.slice(1);

  const notRelated = async () => {
    setSaving(true);
    try {
      await setSharedMobileDismissed(group.mobile, true);
      toast.success("Ignore kar diya");
      onResolved(group.mobile);
    } catch (e: any) {
      toast.error("Save nahi hua: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  // Audit finding (24 Sep 2026): with a for-loop + single try/catch, a
  // 3+-patient group where the 2nd link failed would abort immediately —
  // the 1st link stayed committed (linkFamilyMember upserts, so the data
  // itself was never wrong), but the toast only ever said "Link nahi
  // hua" with no indication which patient failed or that others already
  // succeeded. Now attempts every link regardless of earlier failures,
  // and reports exactly which ones didn't go through.
  const linkFamily = async () => {
    if (others.some((p) => !relations[p.id])) { toast.error("Sabke liye relation chuno"); return; }
    setSaving(true);
    const failed: string[] = [];
    for (const p of others) {
      const res = await linkFamilyMember(anchor.id, p.id, relations[p.id]!);
      if (!res.success) failed.push(`${p.name} (${res.error ?? "unknown error"})`);
    }
    if (failed.length > 0) {
      toast.error(`Kuch links nahi hue: ${failed.join(", ")} — baaki ho gaye, inhe dobara try karo`);
      setSaving(false);
      return;
    }
    // Once every relationship is on record, this mobile isn't
    // "unresolved" anymore — same as clicking Not related, just a
    // different resolution.
    await setSharedMobileDismissed(group.mobile, true);
    toast.success("Family link ho gaya");
    setSaving(false);
    onResolved(group.mobile);
  };

  return (
    <div className="rounded-xl bg-surface border border-border p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[13px] font-bold text-primary inline-flex items-center gap-1.5">
          <Phone className="h-3.5 w-3.5" /> {group.mobile} <span className="text-muted-foreground font-normal">({group.count} patients)</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {group.patients.map((p) => <PatientChip key={p.id} p={p} />)}
      </div>

      {mode === "idle" && (
        <div className="flex gap-1.5">
          <button
            onClick={notRelated}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-muted text-muted-foreground text-[12px] font-bold py-2 disabled:opacity-60"
          >
            <EyeOff className="h-3.5 w-3.5" /> Not related
          </button>
          <button
            onClick={() => setMode("family")}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-bold py-2 disabled:opacity-60"
          >
            <Link2 className="h-3.5 w-3.5" /> Family hai
          </button>
        </div>
      )}

      {mode === "family" && (
        <div className="rounded-lg bg-background border border-border p-2.5 space-y-3">
          {others.map((p) => (
            <div key={p.id}>
              <p className="text-[11px] font-semibold text-primary mb-1">
                {p.name} , {anchor.name} ka <u>KYA LAGTA HAI</u>?
              </p>
              <div className="flex flex-wrap gap-1">
                {RELATIONSHIPS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRelations((s) => ({ ...s, [p.id]: r }))}
                    className={cn(
                      "rounded-full px-2 py-1 text-[10px] font-semibold border",
                      relations[p.id] === r ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-1.5">
            <button
              onClick={() => { setMode("idle"); setRelations({}); }}
              disabled={saving}
              className="flex-1 rounded-lg bg-muted text-muted-foreground text-[12px] font-bold py-2 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={linkFamily}
              disabled={saving}
              className="flex-1 rounded-lg bg-accent text-accent-foreground text-[12px] font-bold py-2 disabled:opacity-60"
            >
              {saving ? "Link ho raha hai…" : "Link Family Karo"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FixSharedMobilesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["data-quality-report"], queryFn: fetchDataQualityReport });
  const dismissedQ = useQuery({ queryKey: ["dq-dismissed-shared-mobiles"], queryFn: fetchDismissedSharedMobiles });
  const [resolvedMobiles, setResolvedMobiles] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleResolved = (mobile: string) => {
    setResolvedMobiles((s) => new Set(s).add(mobile));
    qc.invalidateQueries({ queryKey: ["dq-dismissed-shared-mobiles"] });
  };

  if (q.isLoading || dismissedQ.isLoading) return <RoleShell wide title="Shared Mobile Review" nav={OWNER_NAV}><LoadingBlock /></RoleShell>;
  if (q.isError) return <RoleShell wide title="Shared Mobile Review" nav={OWNER_NAV}><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></RoleShell>;

  const dismissedSet = new Set(dismissedQ.data ?? []);
  const groups = (q.data!.shared_mobiles ?? []).filter((g) => !dismissedSet.has(g.mobile) && !resolvedMobiles.has(g.mobile));
  const sorted = sortMode === "default"
    ? (sortDirection === "asc" ? groups : [...groups].reverse())
    : [...groups].sort((a, b) => applyDirection((sortMode === "name" ? compareByName : compareByCardNumber)(a.patients[0] ?? {}, b.patients[0] ?? {}), sortDirection));

  return (
    <RoleShell wide title="Shared Mobile Review" subtitle={`${groups.length} baaki hain`} nav={OWNER_NAV}>
      <div className="rounded-2xl bg-primary text-primary-foreground p-3.5 flex items-start gap-2 mb-3">
        <Users className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-[12px]">
          Har group ke liye decide karo — "Family hai" dabao to relation choose karke link ho jayega, "Not related" dabao
          to list se hat jayega (dono reversible hain — Data Quality screen se recheck kar sakte ho).
        </span>
      </div>

      <SortToggle mode={sortMode} onChange={setSortMode} direction={sortDirection} onDirectionChange={setSortDirection} />

      {groups.length === 0 ? (
        <div className="rounded-2xl bg-success/10 text-success p-5 text-center text-sm font-semibold">
          Sab groups review ho gaye.
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((g) => (
            <GroupCard key={g.mobile} group={g} onResolved={handleResolved} />
          ))}
        </div>
      )}
    </RoleShell>
  );
}
