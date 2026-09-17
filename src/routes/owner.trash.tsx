import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchActiveTrash, restoreTrashedRow, type TrashEntry } from "@/lib/db";

export const Route = createFileRoute("/owner/trash")({
  head: () => ({ meta: [{ title: "Trash — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <TrashPage />
    </AuthGate>
  ),
});

const TABLE_LABEL: Record<string, string> = {
  patient_documents: "Patient Document",
  payment_modes: "Payment Mode",
  holidays: "Holiday",
  winback_tiers: "Win-back Tier",
  followup_touchpoints: "Follow-up Rule",
};

function describe(entry: TrashEntry): string {
  const d = entry.record_data;
  switch (entry.table_name) {
    case "patient_documents":
      return `${d.doc_type ?? "Document"}${d.note ? " — " + d.note : ""}`;
    case "payment_modes":
      return d.label ?? d.code ?? "—";
    case "holidays":
      return `${d.name ?? "—"} (${d.date ?? "—"})`;
    case "winback_tiers":
      return `${d.label ?? "—"} — ${d.days_lapsed ?? "?"} din`;
    case "followup_touchpoints":
      return d.label ?? "—";
    default:
      return entry.record_id;
  }
}

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Khatam ho gaya";
  const hrs = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hrs > 0) return `${hrs}h ${mins}m bacha hai`;
  return `${mins}m bacha hai`;
}

function TrashPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["trash"], queryFn: fetchActiveTrash, refetchInterval: 60_000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const items = data ?? [];

  const restore = async (id: string) => {
    setBusyId(id);
    const res = await restoreTrashedRow(id);
    setBusyId(null);
    if (!res.success) {
      toast.error("Restore nahi hua: " + res.error);
      return;
    }
    toast.success("Record wapas aa gaya");
    qc.invalidateQueries({ queryKey: ["trash"] });
  };

  return (
    <RoleShell wide showBack title="Trash" subtitle="Aaj delete hui cheezein — end of day tak restore ho sakti hain">
      <p className="text-xs text-muted-foreground mb-3">
        Jo bhi document, holiday, payment mode, win-back tier ya follow-up rule aaj delete hui hai, wo yahan hai. Sirf
        Owner restore kar sakta hai. Din khatam hote hi (raat ko) ye hamesha ke liye chali jaati hain.
      </p>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock label="Trash khaali hai." />
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="rounded-xl border border-border bg-surface p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Trash2 className="h-3 w-3" /> {TABLE_LABEL[it.table_name] ?? it.table_name}
                </div>
                <div className="text-sm font-semibold text-primary truncate mt-0.5">{describe(it)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {new Date(it.deleted_at).toLocaleString("en-IN")} • {it.deleted_by_role ?? "—"} • {timeLeft(it.expires_at)}
                </div>
              </div>
              <button
                onClick={() => restore(it.id)}
                disabled={busyId === it.id}
                className="shrink-0 rounded-lg bg-primary text-primary-foreground text-xs font-bold px-3 py-2 disabled:opacity-50"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </RoleShell>
  );
}
