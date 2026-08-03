import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchVisit, collectPayment, branchLabel, fetchAvailableCredit, fetchFeeMaster, feeKindForVisit, FEE_LABELS, DEFAULT_FEE_MASTER, fetchPreviousVisitDate, needsRecaseSurcharge, fetchFeeRules, activeFeeRulesTotal, DEFAULT_FEE_RULES } from "@/lib/db";
import { useAuth } from "@/lib/auth";
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
  const { hasReceptionPermission } = useAuth();
  // Phase 1 #11 — feature-level permission, separate from the whole-screen
  // "payment" gate above. Owner can restrict specific RECP1/RECP2 staff
  // from saving a partial payment at all, without touching their access
  // to the Payment screen for full payments.
  const canPartial = hasReceptionPermission("payment.partial");
  const { data: visit, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["visit", id],
    queryFn: () => fetchVisit(id),
  });

  const [charged, setCharged] = useState<number>(0);
  const [received, setReceived] = useState<number>(0);
  const [mode, setMode] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [busy, setBusy] = useState(false);
  const [useCredit, setUseCredit] = useState(true);

  // Overpayment ledger (audit P0-6) — patients can have credit sitting from
  // a past overpayment the Owner converted to a credit note. Show it here so
  // reception offers it before asking for fresh cash, instead of it staying
  // invisible forever.
  const { data: availableCredit } = useQuery({
    queryKey: ["available-credit", visit?.patient_id],
    queryFn: () => fetchAvailableCredit(visit!.patient_id),
    enabled: !!visit?.patient_id,
  });
  const credit = availableCredit ?? 0;

  // TASK 4 — Fee Master. Reception was starting every payment from a blank
  // 0 and typing the consultation fee from memory, which is where the wrong
  // amounts came from. Prefill the standard fee for this visit's kind
  // (new case / follow-up / online) and keep the field fully editable for
  // concessions.
  const { data: feeMaster } = useQuery({ queryKey: ["fee-master"], queryFn: fetchFeeMaster });
  const fees = feeMaster ?? DEFAULT_FEE_MASTER;
  const feeKind = visit ? feeKindForVisit(visit) : null;

  // Re-case surcharge (Phase 3 decision #24) — needs the visit BEFORE this
  // one, not patient.last_visit_date (already stamped to today by the time
  // payment happens). See fetchPreviousVisitDate for why.
  const { data: previousVisitDate } = useQuery({
    queryKey: ["previous-visit-date", visit?.patient_id, visit?.id],
    queryFn: () => fetchPreviousVisitDate(visit!.patient_id, visit!.id),
    enabled: !!visit?.patient_id && !!visit?.id,
  });
  const recaseApplies = needsRecaseSurcharge(visit?.patient?.lifetime_visits, previousVisitDate ?? null);

  // Owner-managed extra rules (03 Aug 2026 request) — replaces the old
  // hard-coded RECASE_SURCHARGE constant with a dynamic, owner-editable
  // list (see Owner Control Centre > Extra Fee Rules). Re-case is still
  // the only one gated on the 1-year-gap check above; any other rule the
  // Owner adds applies purely by matching feeKind (or ALL).
  const { data: feeRules } = useQuery({ queryKey: ["fee-rules"], queryFn: fetchFeeRules });
  const rules = feeRules ?? DEFAULT_FEE_RULES;
  const { total: extraTotal, applied: appliedRules } = feeKind
    ? activeFeeRulesTotal(rules, feeKind, recaseApplies)
    : { total: 0, applied: [] };
  const standardFee = feeKind ? fees[feeKind] + extraTotal : 0;

  // Prefill exactly once per visit, and never over something already typed.
  // Gated on previousVisitDate query having settled (not `isLoading`, since
  // `undefined` vs `null` both mean "resolved, no surcharge") so the re-case
  // surcharge — when it applies — is never missed by a prefill that fired
  // before the check finished.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  useEffect(() => {
    if (!visit || !standardFee) return;
    if (previousVisitDate === undefined) return; // still loading
    if (prefilledFor === visit.id) return;
    setPrefilledFor(visit.id);
    if (charged === 0 && received === 0) {
      setCharged(standardFee);
      setReceived(standardFee);
    }
  }, [visit, standardFee, prefilledFor, charged, received, previousVisitDate]);

  if (isLoading) return <MobileShell title="Collect Payment" showBack><LoadingBlock /></MobileShell>;
  // Was a single "Visit nahi mila" for both a genuine not-found AND a
  // network/server error — the second one told staff to give up on a
  // real visit that just had a fetch hiccup, instead of retrying.
  if (isError) {
    return (
      <MobileShell title="Collect Payment" showBack>
        <div className="py-10 text-center text-sm text-muted-foreground">
          Visit load nahi hua — connection check karo.
          <div className="text-[11px] mt-1 opacity-70">{(error as any)?.message ?? ""}</div>
          <button onClick={() => refetch()} className="mt-3 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold">
            Dobara try karo
          </button>
        </div>
      </MobileShell>
    );
  }
  if (!visit) return <MobileShell title="Collect Payment" showBack><div className="py-10 text-center text-sm text-muted-foreground">Visit nahi mila.</div></MobileShell>;

  // Still owed after cash — this is the ceiling on how much credit can
  // usefully be applied (never apply more credit than what's actually due).
  const owedAfterCash = Math.max(0, charged - received);
  const creditToApply = useCredit ? Math.min(credit, owedAfterCash) : 0;
  const balance = Math.max(0, owedAfterCash - creditToApply);

  const doCollect = async () => {
    if (charged <= 0) return toast.error("Amount daalo");
    if (balance > 0 && !canPartial) {
      return toast.error("Partial payment ki permission nahi hai — Owner/Doctor se poora amount collect karwao.");
    }
    setBusy(true);
    try {
      // Credit consumption + payment insert now happen inside ONE atomic
      // RPC call (migration 0012) — no more separate apply-then-revert
      // steps. If anything fails, Postgres rolls back the whole thing,
      // including any credit that was about to be spent, so credit can
      // never get stuck "applied" against a payment that never happened.
      await collectPayment({
        visit_id: visit.id,
        patient_id: visit.patient_id,
        amount_charged: charged,
        amount_received: received,
        payment_mode: mode,
        branch: visit.branch,
        credit_to_apply: creditToApply,
      });
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      qc.invalidateQueries({ queryKey: ["visit", id] });
      qc.invalidateQueries({ queryKey: ["available-credit", visit.patient_id] });
      toast.success(balance === 0 ? "Payment done." : "Partial payment saved.");
      navigate({ to: "/", replace: true });
    } catch (e: any) {
      toast.error(e?.message || "Payment fail hua");
    } finally {
      setBusy(false);
    }
  };

  const existingDue = Number(visit.patient?.current_balance ?? 0);

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

      {existingDue > 0 && (
        <div className="mt-3 rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive font-semibold flex items-center justify-between">
          <span>Previous balance due</span>
          <span className="text-sm font-bold">₹{existingDue.toLocaleString("en-IN")}</span>
        </div>
      )}

      {credit > 0 && (
        <button
          type="button"
          onClick={() => setUseCredit((v) => !v)}
          className={cn(
            "mt-3 w-full rounded-xl border p-3 text-xs font-semibold flex items-center justify-between",
            useCredit ? "bg-success/15 border-success/40 text-success" : "bg-surface border-border text-muted-foreground",
          )}
        >
          <span>{useCredit ? "✓ Credit note apply ho raha hai" : "Available credit — apply karein?"}</span>
          <span className="text-sm font-bold">₹{credit.toLocaleString("en-IN")}</span>
        </button>
      )}


      {feeKind && (
        <div className="mt-3 rounded-xl bg-surface border border-border p-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Standard fee</div>
            <div className="text-xs font-semibold text-primary">
              {FEE_LABELS[feeKind]}
              {appliedRules.map((r) => (
                <span key={r.id} className={r.amount >= 0 ? "text-warning" : "text-success"}>
                  {" "}+ {r.label} {r.amount >= 0 ? "₹" : "-₹"}{Math.abs(r.amount).toLocaleString("en-IN")}
                </span>
              ))}
            </div>
            {recaseApplies && appliedRules.some((r) => r.key === "RECASE") && (
              <div className="text-[10px] text-muted-foreground mt-0.5">1 saal se follow-up nahi aaya — re-case charge lagega</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setCharged(standardFee); setReceived(standardFee); }}
            className="rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-bold"
          >
            ₹{standardFee.toLocaleString("en-IN")}
          </button>
        </div>
      )}

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
      {balance > 0 && !canPartial && (
        <div className="mt-2 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive font-semibold">
          Aapke paas partial payment save karne ki permission nahi hai. Poora amount collect karo ya Owner/Doctor ko bulao.
        </div>
      )}

      <button
        onClick={doCollect}
        disabled={busy || (balance > 0 && !canPartial)}
        className="mt-5 w-full rounded-xl bg-success text-success-foreground py-3.5 text-sm font-bold disabled:opacity-60"
      >
        {busy ? "Saving…" : balance === 0 ? "Collect Payment" : "Save Partial Payment"}
      </button>
    </MobileShell>
  );
}
