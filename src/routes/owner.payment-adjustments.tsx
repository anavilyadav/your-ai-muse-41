import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchPendingPaymentAdjustments, resolvePaymentAdjustment } from "@/lib/db";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/owner/payment-adjustments")({
  head: () => ({ meta: [{ title: "Payment Adjustments — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <PaymentAdjustmentsPage />
    </AuthGate>
  ),
});

function PaymentAdjustmentsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["payment-adjustments-pending"],
    queryFn: fetchPendingPaymentAdjustments,
  });
  const items = data ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  const resolve = async (id: string, method: "REFUND" | "CREDIT_NOTE") => {
    setBusyId(id);
    const res = await resolvePaymentAdjustment(id, method, user?.name ?? "Owner");
    setBusyId(null);
    if (!res.success) {
      toast.error("Resolve nahi hua: " + res.error);
      return;
    }
    toast.success(method === "REFUND" ? "Refund mark ho gaya" : "Credit note ban gaya — agli visit pe khud adjust ho jaayega");
    qc.invalidateQueries({ queryKey: ["payment-adjustments-pending"] });
  };

  return (
    <RoleShell wide title="Payment Adjustments" subtitle="Overpayment — refund ya credit note" showBack>
      <p className="text-xs text-muted-foreground mb-3">
        Jab bhi charge se zyada paisa collect hota hai, wo yahan pending mein aata hai — khud detect hota hai, koi
        miss nahi hoga. Har ek pe decide karo: cash refund ya credit note (credit note agli visit ke bill mein khud
        adjust ho jaata hai).
      </p>
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyBlock label="Koi pending overpayment nahi hai." />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-primary">{it.patient?.name ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {it.patient?.patient_code} • {it.patient?.mobile}
                  </div>
                </div>
                <div className="text-lg font-extrabold text-accent-foreground">
                  ₹{Number(it.amount).toLocaleString("en-IN")}
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {new Date(it.created_at).toLocaleString("en-IN")}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => resolve(it.id, "REFUND")}
                  disabled={busyId === it.id}
                  className="flex-1 rounded-lg bg-destructive/10 text-destructive text-xs font-bold py-2 disabled:opacity-50"
                >
                  Cash Refund
                </button>
                <button
                  onClick={() => resolve(it.id, "CREDIT_NOTE")}
                  disabled={busyId === it.id}
                  className="flex-1 rounded-lg bg-success/15 text-success text-xs font-bold py-2 disabled:opacity-50"
                >
                  Credit Note
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </RoleShell>
  );
}
