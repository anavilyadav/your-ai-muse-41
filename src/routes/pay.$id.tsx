import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchVisit, collectPayment, branchLabel } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pay/$id")({
  head: () => ({ meta: [{ title: "Collect Payment — YHC" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="payment">
      <PayPage />
    </AuthGate>
  ),
});

const modes: { key: "CASH" | "UPI" | "CARD"; label: string }[] = [
  { key: "CASH", label: "Cash" },
  { key: "UPI", label: "UPI" },
  { key: "CARD", label: "Card" },
];
const quick = [200, 300, 500, 700];

function PayPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: visit, isLoading } = useQuery({
    queryKey: ["visit", id],
    queryFn: () => fetchVisit(id),
  });

  const [charged, setCharged] = useState<number>(300);
  const [received, setReceived] = useState<number>(300);
  const [mode, setMode] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <MobileShell title="Collect Payment" showBack><LoadingBlock /></MobileShell>;
  if (!visit) return <MobileShell title="Collect Payment" showBack><div className="py-10 text-center text-sm text-muted-foreground">Visit nahi mila.</div></MobileShell>;

  const balance = Math.max(0, charged - received);

  const doCollect = async () => {
    if (charged <= 0) return toast.error("Amount daalo");
    setBusy(true);
    try {
      await collectPayment({
        visit_id: visit.id,
        patient_id: visit.patient_id,
        amount_charged: charged,
        amount_received: received,
        payment_mode: mode,
        branch: visit.branch,
      });
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      qc.invalidateQueries({ queryKey: ["visit", id] });
      toast.success(balance === 0 ? "Payment done. WhatsApp receipt sent." : "Partial payment saved.");
      navigate({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message || "Payment fail hua");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MobileShell title="Collect Payment" showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase opacity-70">Token</div>
            <div className="text-2xl font-black">{visit.token_number ?? "—"}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold">{visit.patient?.name}</div>
            <div className="text-[10px] opacity-70">{visit.patient?.patient_code} • {branchLabel(visit.branch)}</div>
          </div>
        </div>
        <div className="mt-2 text-xs opacity-80">{visit.chief_complaint || "—"}</div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Quick fill</div>
        <div className="grid grid-cols-4 gap-2">
          {quick.map((q) => (
            <button
              key={q}
              onClick={() => { setCharged(q); setReceived(q); }}
              className="rounded-lg border border-border bg-surface py-2 text-sm font-bold text-primary"
            >
              ₹{q}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-primary uppercase">Charged</label>
          <input
            inputMode="numeric"
            value={charged || ""}
            onChange={(e) => setCharged(Number(e.target.value.replace(/\D/g, "")) || 0)}
            className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-primary uppercase">Received</label>
          <input
            inputMode="numeric"
            value={received || ""}
            onChange={(e) => setReceived(Number(e.target.value.replace(/\D/g, "")) || 0)}
            className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-primary uppercase mb-2">Mode</div>
        <div className="flex gap-2">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                "flex-1 rounded-lg py-2.5 text-sm font-semibold border",
                mode === m.key ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-foreground border-border",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {balance > 0 && (
        <div className="mt-4 rounded-lg bg-accent/20 border border-accent/40 p-3 text-xs text-accent-foreground">
          ⚠ Partial payment — ₹{balance} balance due. Visit "Pay Due" mein rahega.
        </div>
      )}

      <button
        onClick={doCollect}
        disabled={busy}
        className="mt-5 w-full rounded-xl bg-success text-success-foreground py-3.5 text-sm font-bold disabled:opacity-60"
      >
        {busy ? "Saving…" : balance === 0 ? "Collect & Send WhatsApp Receipt" : "Save Partial Payment"}
      </button>
    </MobileShell>
  );
}
