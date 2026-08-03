import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { RoleShell, Badge } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchVisit, fetchVisitPrescriptions, markDispensed, reportStockIssue, branchLabel } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pharmacy/dispense/$token")({
  head: () => ({ meta: [{ title: "Dispense — Pharmacy" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["PHARMA", "OWNER"]}>
      <DispensePage />
    </AuthGate>
  ),
});

function DispensePage() {
  const { token: visitId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: visit, isLoading: lv, isError: ev, error: errV, refetch: refetchV } = useQuery({ queryKey: ["visit", visitId], queryFn: () => fetchVisit(visitId) });
  const { data: rxData, isLoading: lr } = useQuery({ queryKey: ["rx", visitId], queryFn: () => fetchVisitPrescriptions(visitId) });
  const rx = rxData ?? [];
  const [checked, setChecked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  if (lv || lr) {
    return <RoleShell wide title="Dispense" showBack><LoadingBlock /></RoleShell>;
  }
  // Was showing "Patient not found" for both a genuine not-found AND a
  // network/server error — the second one told pharmacy staff to give
  // up on a real visit that just had a fetch hiccup, instead of retrying.
  if (ev) {
    return (
      <RoleShell wide title="Dispense" showBack>
        <p className="text-sm text-muted-foreground">
          Visit load nahi hua — connection check karo.
          <span className="block text-[11px] mt-1 opacity-70">{(errV as any)?.message ?? ""}</span>
        </p>
        <button onClick={() => refetchV()} className="mt-3 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold">
          Dobara try karo
        </button>
      </RoleShell>
    );
  }
  if (!visit) {
    return (
      <RoleShell wide title="Dispense" showBack>
        <p className="text-sm text-muted-foreground">Patient not found in pharmacy queue.</p>
      </RoleShell>
    );
  }

  const toggle = (i: number) => setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));
  // A visit can legitimately have zero prescribed items (advice-only
  // consult, no medicines needed) — that must still be able to move
  // forward to Payment, not get stuck forever behind "check all 0 items".
  const allDone = rx.length === 0 || checked.length === rx.length;

  const reportIssue = async () => {
    const note = window.prompt("Kaunsi medicine/kya issue hai? (Owner ko dikhega)");
    if (!note || !note.trim()) return;
    const res = await reportStockIssue(visitId, note.trim());
    if (res.success) toast.success("Owner ko report ho gaya");
    else toast.error("Report nahi hua: " + res.error);
  };

  const submit = async () => {
    if (!allDone) return toast.error("Please check all items first");
    setBusy(true);
    try {
      await markDispensed(visitId);
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      toast.success("Dispensed — patient sent to payment counter");
      navigate({ to: "/pharmacy" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleShell wide title="Dispense Medicines" showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4">
        <div className="flex justify-between items-center">
          <span className="font-extrabold text-base">{visit.patient?.name}</span>
          <Badge tone="warn">{visit.token_number ?? "—"}</Badge>
        </div>
        <div className="text-[12px] text-primary-foreground/70 mt-1">{branchLabel(visit.branch)}</div>
        {visit.patient?.card_number && (
          <div className="text-[12px] text-primary-foreground/90 mt-1 font-semibold">
            Card No. {visit.patient.card_number}
            {visit.patient.card_register ? ` (${visit.patient.card_register})` : ""}
          </div>
        )}
      </div>

      <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Prescription — check each item
      </div>
      {rx.length === 0 ? (
        <div className="mt-2 rounded-xl bg-accent/20 text-primary p-3 text-[12px]">No prescription found for this visit.</div>
      ) : (
        <ul className="mt-2 space-y-2">
          {rx.map((r, i) => {
            const on = checked.includes(i);
            return (
              <li key={r.id ?? i}>
                <button
                  onClick={() => toggle(i)}
                  className={cn(
                    "w-full text-left rounded-2xl p-3.5 border-2 flex items-center gap-3 transition",
                    on ? "bg-success/10 border-success" : "bg-surface border-border",
                  )}
                >
                  <div
                    className={cn(
                      "h-6 w-6 rounded-full grid place-items-center border-2",
                      on ? "bg-success border-success text-success-foreground" : "border-muted-foreground",
                    )}
                  >
                    {on && <Check className="h-4 w-4" />}
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-primary text-sm">
                      {r.medicine_name} {r.potency && r.potency !== "—" && r.potency}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {r.dose ?? "—"} • {r.frequency ?? "—"}
                      {r.duration_days ? ` • ${r.duration_days}d` : ""}
                      {r.is_slx ? " • SLX" : ""}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 rounded-xl bg-accent/25 text-accent-foreground p-3 text-[12px]">
        💡 Dispensing se stock automatically kam hoga (drams/globules)
      </div>

      <button
        onClick={submit}
        disabled={busy}
        className={cn(
          "mt-4 w-full rounded-full font-bold py-3.5 text-sm inline-flex items-center justify-center gap-2",
          allDone ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Check className="h-4 w-4" /> {allDone ? (rx.length === 0 ? "No medicines — send to Payment" : "Mark Dispensed & Send to Payment") : `Check all ${rx.length} items first`}
      </button>
      <button
        onClick={reportIssue}
        className="mt-2 w-full rounded-full bg-surface border-2 border-destructive text-destructive font-bold py-3 text-sm"
      >
        Report Stock Issue
      </button>
    </RoleShell>
  );
}
