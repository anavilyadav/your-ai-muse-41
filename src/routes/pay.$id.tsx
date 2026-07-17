import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CreditCard, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { ChipSelect } from "@/components/yhc/ChipSelect";
import { collectPayment, getPatientById, type PaymentMode } from "@/lib/yhc-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pay/$id")({
  head: () => ({ meta: [{ title: "Collect Payment — YHC Jaipur" }] }),
  component: PayPage,
});

const modes = ["Cash", "UPI", "QR", "Card"] as const satisfies readonly PaymentMode[];
const quick = [200, 300, 500, 700] as const;

function PayPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const patient = getPatientById(id);

  const [amount, setAmount] = useState<string>(patient ? String(patient.amountDue || 300) : "300");
  const [mode, setMode] = useState<PaymentMode | "">("");
  const [note, setNote] = useState("");

  if (!patient) {
    return (
      <MobileShell title="Collect Payment" showBack>
        <p className="text-center text-sm text-muted-foreground py-10">Patient not found.</p>
      </MobileShell>
    );
  }

  const doCollect = (opts: { partial?: boolean; credit?: boolean } = {}) => {
    const amt = Number(amount);
    if (!opts.credit && (!amt || amt <= 0)) return toast.error("Enter a valid amount");
    if (!opts.credit && !mode) return toast.error("Select payment mode");
    if (opts.partial && amt >= patient.amountDue) {
      return toast.error("Partial payment must be less than amount due");
    }
    collectPayment(id, opts.credit ? 0 : amt, (mode || "Cash") as PaymentMode, {
      note,
      partial: opts.partial,
      credit: opts.credit,
    });
    toast.success(
      opts.credit
        ? "Marked as credit"
        : opts.partial
        ? "Partial payment recorded"
        : "Payment collected — WhatsApp receipt sent",
    );
    setTimeout(() => navigate({ to: "/" }), 400);
  };

  return (
    <MobileShell title="Collect Payment" subtitle={`Token ${patient.token}`} showBack>
      {/* Patient header */}
      <div className="rounded-xl bg-primary text-primary-foreground p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs opacity-70">{patient.id}</p>
            <p className="text-lg font-bold">{patient.name}</p>
            <p className="text-xs opacity-80">{patient.chiefComplaint}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase opacity-70">Amount Due</p>
            <p className="text-3xl font-black text-accent">₹{patient.amountDue || 300}</p>
          </div>
        </div>
      </div>

      {/* Quick amounts */}
      <div className="mt-5">
        <label className="text-xs font-semibold text-primary uppercase tracking-wide">Quick Amount</label>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {quick.map((q) => {
            const active = amount === String(q);
            return (
              <button
                key={q}
                type="button"
                onClick={() => setAmount(String(q))}
                className={cn(
                  "rounded-lg border py-2.5 text-sm font-bold transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-surface text-primary border-border",
                )}
              >
                ₹{q}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs font-semibold text-primary uppercase tracking-wide">Custom Amount</label>
        <div className="mt-1.5 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            placeholder="0"
            className="w-full rounded-lg bg-surface border border-input pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs font-semibold text-primary uppercase tracking-wide">Payment Mode</label>
        <div className="mt-2">
          <ChipSelect options={modes} value={mode} onChange={(v) => setMode(v)} />
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs font-semibold text-primary uppercase tracking-wide">
          Advance / Credit Note <span className="opacity-60">(optional)</span>
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Advance for next visit"
          className="mt-1.5 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="mt-6 space-y-2">
        <button
          onClick={() => doCollect()}
          className="w-full rounded-xl bg-success text-success-foreground py-3.5 text-sm font-bold shadow-md active:scale-[0.99] transition inline-flex items-center justify-center gap-2"
        >
          <MessageCircle className="h-4 w-4" /> Collect & Send WhatsApp Receipt
        </button>

        <button
          onClick={() => {
            if (!confirm("Partial payments require Doctor approval. Continue?")) return;
            doCollect({ partial: true });
          }}
          className="w-full rounded-xl bg-accent text-accent-foreground py-3 text-sm font-bold shadow-sm active:scale-[0.99] transition inline-flex items-center justify-center gap-2"
        >
          <AlertTriangle className="h-4 w-4" /> Partial Payment
        </button>

        <button
          onClick={() => doCollect({ credit: true })}
          className="w-full rounded-xl bg-surface border border-border text-primary py-3 text-sm font-semibold active:scale-[0.99] transition inline-flex items-center justify-center gap-2"
        >
          <CreditCard className="h-4 w-4" /> Mark as Credit
        </button>
      </div>
    </MobileShell>
  );
}
