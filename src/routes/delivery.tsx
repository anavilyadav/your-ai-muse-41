import { createFileRoute } from "@tanstack/react-router";
import { AuthGate, ErrorBlock } from "@/components/yhc/AuthGate";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MapPin, Package, Plus, Truck, X } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";
import { DELIVERY_STEPS, fetchDeliveries, updateDelivery, createDelivery, notifyDeliveryUpdate, searchPatients, fetchPatientAddresses, findCombinableFamilyDelivery, displayPatientCode, type PatientAddress } from "@/lib/db";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "sonner";

export const Route = createFileRoute("/delivery")({
  head: () => ({ meta: [{ title: "Delivery Tracking — YHC Jaipur" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="delivery">
      <DeliveryPage />
    </AuthGate>
  ),
});

const PARTNERS = ["Swiggy", "Porter", "Courier", "Self-pickup"];

const partnerIcon: Record<string, typeof Truck> = {
  Swiggy: Truck,
  Porter: Truck,
  Courier: Package,
  "Self-pickup": Package,
};

function DeliveryPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["deliveries"], queryFn: fetchDeliveries });
  const deliveries = (data ?? []) as any[];
  const [showNew, setShowNew] = useState(false);
  const qc = useQueryClient();

  const stats = useMemo(() => {
    const active = deliveries.filter(
      (d) => d.status !== "Delivered" && d.status !== "Issue",
    ).length;
    const delivered = deliveries.filter((d) => d.status === "Delivered").length;
    const issues = deliveries.filter((d) => d.status === "Issue").length;
    return { active, delivered, issues };
  }, [deliveries]);

  return (
    <MobileShell
      title="Delivery Tracking"
      subtitle="Active orders"
      showBack
      right={
        <button
          onClick={() => setShowNew(true)}
          className="h-9 px-3 rounded-full bg-accent text-accent-foreground text-[11px] font-bold inline-flex items-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Naya Order
        </button>
      }
    >
      {showNew && (
        <NewDeliveryModal
          onClose={() => setShowNew(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["deliveries"] })}
        />
      )}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Delivered" value={stats.delivered} tone="success" />
        <StatCard label="Issues" value={stats.issues} tone="destructive" />
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-8">Loading…</div>
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : deliveries.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          Koi active delivery nahi hai. "+ Naya Order" se online patient ka courier track karna shuru karo.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {deliveries.map((d) => (
            <DeliveryCard key={d.id} d={d} allDeliveries={deliveries} />
          ))}
        </ul>
      )}
    </MobileShell>
  );
}

function NewDeliveryModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [selected, setSelected] = useState<any | null>(null);
  const [partner, setPartner] = useState(PARTNERS[0]);
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [advance, setAdvance] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: results } = useQuery({
    queryKey: ["delivery-patient-search", debouncedQ],
    queryFn: () => searchPatients(debouncedQ),
    enabled: !selected && debouncedQ.trim().length >= 2,
  });

  // Saved addresses (24 Sep 2026) — patients often courier to a different
  // place each time (home vs office vs native village), so offer their
  // saved list as one-tap fills instead of retyping/remembering it.
  const { data: savedAddresses } = useQuery({
    queryKey: ["patient-addresses", selected?.id],
    queryFn: () => fetchPatientAddresses(selected.id),
    enabled: !!selected,
  });

  const pick = (p: any) => {
    setSelected(p);
    setQ("");
    setArea(p.city ?? "");
    setAddress(p.address ?? "");
  };

  const pickAddress = (a: PatientAddress) => {
    setArea(a.city || area);
    setAddress(a.address);
  };

  // Family courier combine (25 Sep 2026, Part B) — same rule as the Call
  // Desk's Online Follow-up Request: 2 family members shipping to the same
  // address should be one parcel, not two separate ones.
  const [combine, setCombine] = useState<{ delivery_id: string; patient_name: string } | null>(null);
  useEffect(() => {
    if (!selected || !address.trim()) { setCombine(null); return; }
    let cancelled = false;
    findCombinableFamilyDelivery(selected.id, address).then((c) => { if (!cancelled) setCombine(c); });
    return () => { cancelled = true; };
  }, [selected, address]);

  const submit = async () => {
    if (!selected) { toast.error("Patient chuno pehle"); return; }
    const amt = Number(advance);
    if (!amt || amt <= 0) {
      toast.error("Advance payment amount daalo — bina advance ke delivery nahi bana sakte");
      return;
    }
    setSaving(true);
    const res = await createDelivery({
      patient_id: selected.id,
      patient_name: selected.name,
      area: area.trim() || undefined,
      address: address.trim() || undefined,
      partner,
      advance_amount_paid: amt,
      branch: selected.branch,
      combined_with_delivery_id: combine?.delivery_id,
    });
    if (!res.success) {
      setSaving(false);
      toast.error("Order nahi bana: " + res.error);
      return;
    }
    // Fire-and-forget — tells the patient their order is confirmed and
    // being packed. Needs the DELIVERY_UPDATE AiSensy campaign approved
    // (see the comment on notifyDeliveryUpdate in db.ts).
    notifyDeliveryUpdate(selected.id, selected.name, "Packed");
    setSaving(false);
    toast.success(`${selected.name} ka order bana diya — WhatsApp update bhej diya`);
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Naya Delivery Order</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!selected ? (
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Patient</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Naam ya mobile se search karo"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
            {results && results.length > 0 && (
              <ul className="mt-2 rounded-xl border border-border bg-surface overflow-hidden">
                {results.map((p: any) => (
                  <li key={p.id}>
                    <button
                      onClick={() => pick(p)}
                      className="w-full text-left px-3.5 py-2.5 text-[13px] font-semibold text-primary hover:bg-accent/15 border-b border-border last:border-0"
                    >
                      {p.name} — {p.mobile} • {displayPatientCode(p)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {results && results.length === 0 && debouncedQ.trim().length >= 2 && (
              <p className="mt-2 text-xs text-muted-foreground">Koi patient nahi mila.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-accent/15 border border-accent/40 p-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-primary">{selected.name}</div>
                <div className="text-[11px] text-muted-foreground">{selected.mobile} • {displayPatientCode(selected)}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-[11px] font-semibold text-primary underline">Badlo</button>
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Partner</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {PARTNERS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPartner(p)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[12px] font-bold border",
                      partner === p ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Area / City</label>
              <input value={area} onChange={(e) => setArea(e.target.value)} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Address</label>
              {savedAddresses && savedAddresses.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1 mb-1.5">
                  {savedAddresses.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => pickAddress(a)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[11px] font-bold border",
                        address === a.address ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm resize-none" />
              {combine && (
                <p className="text-[11px] text-success mt-1">
                  ✓ {combine.patient_name} ke order jaisa hi address hai — courier combine ho jayega.
                </p>
              )}
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Advance Amount Paid (₹) *</label>
              <input
                inputMode="numeric"
                value={advance}
                onChange={(e) => setAdvance(e.target.value.replace(/\D/g, ""))}
                placeholder="e.g. 3700"
                className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Online bundle payment jo already collect ho chuki hai.</p>
            </div>

            <button
              onClick={submit}
              disabled={saving}
              className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Order Banao — Patient ko WhatsApp jayega"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeliveryCard({ d, allDeliveries }: { d: any; allDeliveries: any[] }) {
  // Family courier combine (Part B) — a delivery pointing at another via
  // combined_with_delivery_id shares one physical parcel; resolve the
  // other patient's name from the already-fetched list so Pharmacy knows
  // to pack once, not twice.
  const combinedWith = d.combined_with_delivery_id
    ? allDeliveries.find((o) => o.id === d.combined_with_delivery_id)
    : allDeliveries.find((o) => o.combined_with_delivery_id === d.id);
  const queryClient = useQueryClient();
  const [note, setNote] = useState(d.note ?? "");
  const Icon = partnerIcon[d.partner] ?? Package;
  const isIssue = d.status === "Issue";

  const currentIdx = DELIVERY_STEPS.indexOf(d.status);

  const save = async (patch: { status?: string; note?: string }) => {
    const res = await updateDelivery(d.id, patch);
    if (res.success) {
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      // Every real status change (not just a note edit) tells the patient —
      // this is the whole reason a courier delivery needed its own screen
      // instead of just a spreadsheet: the patient never walks in to ask.
      if (patch.status) notifyDeliveryUpdate(d.patient_id, d.patient_name, patch.status, patch.note ?? d.note);
    } else {
      toast.error("Update nahi hua: " + res.error);
    }
  };

  return (
    <li className="rounded-xl bg-surface border border-border p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{d.patient_name}</span>
            {d.token && (
              <span className="text-[10px] font-bold text-accent-foreground bg-accent rounded-full px-1.5 py-0.5">
                {d.token}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Icon className="h-3.5 w-3.5" /> {d.partner}
            {d.area && (
              <>
                <span className="mx-1">•</span>
                <MapPin className="h-3 w-3" /> {d.area}
              </>
            )}
          </div>
        </div>
        {isIssue && (
          <span className="shrink-0 flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/15 text-destructive px-2 py-0.5 text-[10px] font-semibold">
            <AlertTriangle className="h-3 w-3" /> Issue
          </span>
        )}
      </div>
      {combinedWith && (
        <p className="mt-1 text-[10px] text-muted-foreground">🔗 Combined parcel — {combinedWith.patient_name} ke saath</p>
      )}

      <div className="mt-3 flex items-center gap-1">
        {DELIVERY_STEPS.map((step, i) => {
          const active = !isIssue && i === currentIdx;
          const done = !isIssue && i < currentIdx;
          const complete = !isIssue && d.status === "Delivered";
          const clickable = !isIssue && step !== "Delivered" && i !== currentIdx;
          return (
            <button
              key={step}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && save({ status: step, note })}
              className={cn("flex-1 flex flex-col items-center gap-1", clickable && "cursor-pointer")}
            >
              <div
                className={cn(
                  "h-1.5 w-full rounded-full transition-colors",
                  active && "bg-accent",
                  done && "bg-success",
                  complete && "bg-success",
                  !active && !done && !complete && "bg-muted",
                )}
              />
              <span
                className={cn(
                  "text-[9px] leading-tight text-center",
                  active && "text-accent-foreground font-semibold",
                  done && "text-success",
                  !active && !done && "text-muted-foreground",
                )}
              >
                {step}
              </span>
            </button>
          );
        })}
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => save({ note })}
        placeholder="Tracking note (AWB, driver, etc.) — patient ko WhatsApp mein bhi jaayega"
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            if (!window.confirm(`${d.patient_name} ko delivered mark karein?`)) return;
            save({ status: "Delivered", note });
            toast.success(`${d.patient_name} — marked delivered`);
          }}
          disabled={d.status === "Delivered"}
          className="flex items-center justify-center gap-1 rounded-lg bg-success text-success-foreground py-2 text-xs font-semibold disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Mark Delivered
        </button>
        <button
          onClick={() => {
            if (!window.confirm(`${d.patient_name} — issue/return flag karein?`)) return;
            save({ status: "Issue", note });
            toast.error(`${d.patient_name} — issue flagged`);
          }}
          className="flex items-center justify-center gap-1 rounded-lg bg-destructive text-destructive-foreground py-2 text-xs font-semibold"
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Issue / Return
        </button>
      </div>
    </li>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive" | "success";
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <div
        className={cn(
          "text-lg font-bold",
          tone === "destructive" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
