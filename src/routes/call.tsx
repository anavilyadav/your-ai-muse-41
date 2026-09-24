import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, Camera, Clock, Package, PhoneCall, UserPlus, X } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { LogInteractionModal } from "@/components/yhc/LogInteractionModal";
import { ScanCropModal } from "@/components/yhc/ScanCropModal";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  searchPatients,
  fetchStaff,
  fetchPatientById,
  fetchOnlineFollowupRequests,
  createOnlineFollowupRequest,
  cancelOnlineFollowupRequest,
  confirmOnlineFollowupRequest,
  fetchOnlineFollowupPricing,
  DEFAULT_ONLINE_FOLLOWUP_PRICING,
  onlineFollowupAmountFor,
  findCombinableFamilyDelivery,
  fetchPatientAddresses,
  addPatientAddress,
  uploadPatientDocument,
  fetchPaymentModes,
  branchLabel,
  normalizeBranchKey,
  BRANCH_KEYS,
  type OnlineFollowupDeliveryMethod,
  type OnlineFollowupRequest,
  type PatientAddress,
  type ApptBranch,
  type DBPatient,
} from "@/lib/db";
import { PillOrOtherField } from "@/components/yhc/PillOrOtherField";
import { NewAppointmentModal } from "./appointments";
import { AddLeadModal } from "./leads";

const ADDRESS_LABEL_OPTIONS = ["Ghar", "Office", "Native/Village"] as const;

// Unified "Call Desk" (25 Sep 2026, Dr. Yadav's Reception-flow rebuild) —
// "call se hi sab start hota hai": every piece of Reception-initiated work
// (appointment booking, online follow-up intake, complaints, inquiries)
// now begins from this one screen instead of 4 scattered entry points.
// Downstream worklists stay separate per role (Case-Taking/Prescribing/
// Pharmacy each keep their own queue) — only the START of the work is
// unified here.
export const Route = createFileRoute("/call")({
  // Search hand-off (25 Sep 2026) — Dr. Yadav: patient search-karke milne
  // ke baad seedha follow-up/online follow-up banane ka koi tarika nahi
  // tha. search.tsx now links here with the patient already picked, same
  // prefill pattern as Appointments' "Arrived" hand-off to /register.
  validateSearch: (search: Record<string, unknown>): { patientId?: string } => ({
    patientId: typeof search.patientId === "string" ? search.patientId : undefined,
  }),
  head: () => ({ meta: [{ title: "Call Desk — YHC Jaipur" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="callDesk">
      <CallDeskPage />
    </AuthGate>
  ),
});

const DELIVERY_METHOD_LABELS: Record<OnlineFollowupDeliveryMethod, string> = {
  SELF_PICKUP: "Khud/Kisi Ko Bhej Ke Collect",
  JAIPUR_COURIER: "Jaipur Courier",
  COURIER: "Rest of India Courier",
};

function CallDeskPage() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const qc = useQueryClient();
  const [showAppt, setShowAppt] = useState(false);
  const [showOnlineFollowup, setShowOnlineFollowup] = useState(false);
  const [showComplaint, setShowComplaint] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [confirmingRequest, setConfirmingRequest] = useState<OnlineFollowupRequest | null>(null);
  const [prefilledPatient, setPrefilledPatient] = useState<DBPatient | null>(null);

  // Search hand-off — a patientId in the URL (from search.tsx's "Online
  // Follow-up" quick action) opens the request modal already pointed at
  // that patient, skipping the redundant re-search inside the modal.
  useEffect(() => {
    if (!search.patientId) return;
    fetchPatientById(search.patientId).then((p) => {
      if (p) { setPrefilledPatient(p); setShowOnlineFollowup(true); }
    });
  }, [search.patientId]);

  const awaitingQ = useQuery({ queryKey: ["online-followup-awaiting"], queryFn: () => fetchOnlineFollowupRequests("AWAITING_PAYMENT") });
  const staffQ = useQuery({ queryKey: ["staff-for-leads"], queryFn: fetchStaff });

  const refreshAwaiting = () => qc.invalidateQueries({ queryKey: ["online-followup-awaiting"] });

  return (
    <MobileShell title="Call Desk" subtitle="Reception">
      <div className="rounded-xl bg-primary/10 text-primary text-[12px] px-3 py-2.5 mb-3">
        Koi bhi call ya patient ka kaam yahi se shuru karo — Appointment, Online Follow-up, Complaint, ya Inquiry.
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <TileButton icon={CalendarCheck} label="Appointment" onClick={() => setShowAppt(true)} />
        <TileButton icon={Package} label="Online Follow-up" onClick={() => setShowOnlineFollowup(true)} />
        <TileButton icon={PhoneCall} label="Complaint" onClick={() => setShowComplaint(true)} />
        <TileButton icon={UserPlus} label="Inquiry" onClick={() => setShowLead(true)} />
      </div>

      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
          <Clock className="h-3 w-3" /> Payment Baaki — Awaiting Payment ({awaitingQ.data?.length ?? 0})
        </div>
        {awaitingQ.isLoading ? (
          <LoadingBlock />
        ) : awaitingQ.isError ? (
          <ErrorBlock error={awaitingQ.error} onRetry={() => void awaitingQ.refetch()} />
        ) : (awaitingQ.data?.length ?? 0) === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-4 rounded-xl bg-surface border border-border">
            Koi payment pending nahi hai.
          </p>
        ) : (
          <ul className="space-y-2">
            {awaitingQ.data!.map((r) => (
              <li key={r.id} className="rounded-xl bg-surface border border-accent/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-primary truncate">{r.patient?.name ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.patient?.mobile} • {DELIVERY_METHOD_LABELS[r.delivery_method]} • ₹{r.amount_expected}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </span>
                </div>
                {r.note && <p className="text-[12px] text-foreground/80 mt-1.5">{r.note}</p>}
                <div className="flex gap-1.5 mt-2.5">
                  <button
                    onClick={() => setConfirmingRequest(r)}
                    className="flex-1 rounded-lg bg-primary text-primary-foreground text-[12px] font-bold py-2"
                  >
                    Screenshot Upload + Confirm
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm("Ye request cancel karein?")) return;
                      const res = await cancelOnlineFollowupRequest(r.id);
                      if (res.success) { toast.success("Cancel ho gaya"); refreshAwaiting(); }
                      else toast.error("Cancel nahi hua: " + res.error);
                    }}
                    className="shrink-0 rounded-lg bg-destructive/10 text-destructive text-[12px] font-bold px-3"
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAppt && <NewAppointmentModal onClose={() => setShowAppt(false)} onAdded={() => {}} />}
      {showOnlineFollowup && (
        <OnlineFollowupRequestModal
          staffName={user?.name}
          initialPatient={prefilledPatient ?? undefined}
          onClose={() => { setShowOnlineFollowup(false); setPrefilledPatient(null); }}
          onCreated={refreshAwaiting}
        />
      )}
      {showComplaint && <ComplaintModal onClose={() => setShowComplaint(false)} />}
      {showLead && <AddLeadModal staff={staffQ.data ?? []} onClose={() => setShowLead(false)} onAdded={() => {}} />}
      {confirmingRequest && (
        <ConfirmPaymentModal
          request={confirmingRequest}
          staffName={user?.name}
          onClose={() => setConfirmingRequest(null)}
          onConfirmed={refreshAwaiting}
        />
      )}
    </MobileShell>
  );
}

function TileButton({ icon: Icon, label, onClick }: { icon: typeof CalendarCheck; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-2xl bg-surface border border-border p-4 flex flex-col items-center gap-2 text-center">
      <Icon className="h-6 w-6 text-primary" />
      <span className="text-[13px] font-bold text-primary">{label}</span>
    </button>
  );
}

const DELIVERY_METHODS: OnlineFollowupDeliveryMethod[] = ["SELF_PICKUP", "JAIPUR_COURIER", "COURIER"];

// Online Follow-up Request (Part A/B/G) — the payment-gated intake step.
// No visit/token is created here — just this request, status AWAITING_
// PAYMENT, until someone confirms a payment screenshot (ConfirmPaymentModal
// below). Auto-fills the amount from Owner-set pricing, auto-detects a
// combinable family courier at the same address (Part B — the surcharge
// only applies once per combined group), and offers an optional call-time
// slot (Part G) once the request is created.
function OnlineFollowupRequestModal({
  staffName,
  initialPatient,
  onClose,
  onCreated,
}: {
  staffName?: string;
  // Search hand-off (25 Sep 2026) — when set, skips the search step and
  // goes straight to the form, same as this modal's own "pick" flow.
  initialPatient?: DBPatient;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [selected, setSelected] = useState<any | null>(initialPatient ?? null);
  const [branch, setBranch] = useState<ApptBranch>((normalizeBranchKey(initialPatient?.branch) || "BAJAJ_NAGAR") as ApptBranch);
  const [note, setNote] = useState("");
  const [days, setDays] = useState("");
  const [method, setMethod] = useState<OnlineFollowupDeliveryMethod>("SELF_PICKUP");
  const [addresses, setAddresses] = useState<PatientAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  // Extra address, save-for-later (25 Sep 2026) — Dr. Yadav: army/transfer
  // patients courier to a different place every time, so a NEW address
  // typed here should be offerable as a save, not just a one-off — reuses
  // the same patient_addresses table/pattern as the Patient Profile's own
  // Delivery Addresses section.
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [saveNewAddress, setSaveNewAddress] = useState(true);
  const [newAddressLabel, setNewAddressLabel] = useState<string>(ADDRESS_LABEL_OPTIONS[0]);
  const [combine, setCombine] = useState<{ delivery_id: string; patient_name: string } | null>(null);
  const [pricing, setPricing] = useState(DEFAULT_ONLINE_FOLLOWUP_PRICING);
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createdFor, setCreatedFor] = useState<any | null>(null);
  const [showSlotPicker, setShowSlotPicker] = useState(false);

  useEffect(() => {
    fetchOnlineFollowupPricing().then(setPricing);
  }, []);

  const loadAddresses = async (patientId: string) => {
    const addrs = await fetchPatientAddresses(patientId);
    setAddresses(addrs);
    const def = addrs.find((a) => a.is_default) ?? addrs[0] ?? null;
    setSelectedAddressId(def?.id ?? null);
    setShowNewAddress(addrs.length === 0);
  };

  useEffect(() => {
    if (initialPatient) loadAddresses(initialPatient.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: results } = useQuery({
    queryKey: ["call-desk-onlinefollowup-search", debouncedQ],
    queryFn: () => searchPatients(debouncedQ),
    enabled: !selected && debouncedQ.trim().length >= 2,
  });

  const pick = async (p: any) => {
    setSelected(p);
    setQ("");
    setBranch((normalizeBranchKey(p.branch) || "BAJAJ_NAGAR") as ApptBranch);
    await loadAddresses(p.id);
  };

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) ?? null;
  const resolvedAddressText = method === "SELF_PICKUP" ? "" : (selectedAddress?.address ?? manualAddress);

  useEffect(() => {
    if (!selected || method === "SELF_PICKUP" || !resolvedAddressText.trim()) { setCombine(null); return; }
    let cancelled = false;
    findCombinableFamilyDelivery(selected.id, resolvedAddressText).then((c) => { if (!cancelled) setCombine(c); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, method, resolvedAddressText]);

  const computedAmount = onlineFollowupAmountFor(method, pricing, !!combine);
  useEffect(() => {
    if (!amountTouched) setAmount(String(computedAmount));
  }, [computedAmount, amountTouched]);

  const submit = async () => {
    if (!selected) { toast.error("Patient chuno"); return; }
    if (!note.trim()) { toast.error("Note likho — kya chahiye"); return; }
    if (method !== "SELF_PICKUP" && !resolvedAddressText.trim()) { toast.error("Address chuno ya likho"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Amount check karo"); return; }
    setSaving(true);
    // Save the new address for next time (25 Sep 2026) — a failure here
    // shouldn't block the actual request, which already has the address
    // text either way (delivery_address_text).
    if (showNewAddress && saveNewAddress && manualAddress.trim()) {
      const addrRes = await addPatientAddress(selected.id, { label: newAddressLabel, address: manualAddress.trim() });
      if (!addrRes.success) toast.warning("Address save nahi hui, par request ban jayega: " + addrRes.error);
    }
    const res = await createOnlineFollowupRequest({
      patient_id: selected.id,
      branch,
      note: note.trim(),
      days_requested: days ? Number(days) : undefined,
      delivery_method: method,
      delivery_address_id: selectedAddress?.id,
      delivery_address_text: resolvedAddressText || undefined,
      amount_expected: amt,
      created_by: staffName,
    });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success(`${selected.name} ka request ban gaya — payment ka wait hai`);
    onCreated();
    setCreatedFor(selected);
  };

  if (showSlotPicker && createdFor) {
    return (
      <NewAppointmentModal
        initialType="CALL_BACK"
        initialPatient={{ id: createdFor.id, name: createdFor.name, mobile: createdFor.mobile, branch: createdFor.branch, wa_consent: createdFor.wa_consent }}
        onClose={onClose}
        onAdded={onClose}
      />
    );
  }

  if (createdFor) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
        <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
          <h2 className="font-extrabold text-primary text-lg mb-2">Request Ban Gaya</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {createdFor.name} ka online follow-up request save ho gaya — payment screenshot aane tak "Awaiting Payment" me rahega.
          </p>
          <button onClick={() => setShowSlotPicker(true)} className="w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm mb-2">
            Call/Consultation ka Time Bhi Schedule Karo (optional)
          </button>
          <button onClick={onClose} className="w-full rounded-full bg-muted text-muted-foreground font-bold py-3 text-sm">
            Bas Itna Hi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Online Follow-up Request</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {!selected ? (
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Patient</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Naam ya mobile se search karo"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              autoFocus
            />
            {results && results.length > 0 && (
              <ul className="mt-2 rounded-xl border border-border bg-surface overflow-hidden">
                {results.map((p: any) => (
                  <li key={p.id}>
                    <button
                      onClick={() => pick(p)}
                      className="w-full text-left px-3.5 py-2.5 text-[13px] font-semibold text-primary hover:bg-accent/15 border-b border-border last:border-0"
                    >
                      {p.name} — {p.mobile}
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
                <div className="text-[11px] text-muted-foreground">{selected.mobile}</div>
              </div>
              <button onClick={() => { setSelected(null); setAddresses([]); setSelectedAddressId(null); }} className="text-[11px] font-semibold text-primary underline">Badlo</button>
            </div>

            <div className="flex gap-1.5">
              {BRANCH_KEYS.map((b) => (
                <button
                  key={b}
                  onClick={() => setBranch(b)}
                  className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", branch === b ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}
                >
                  {branchLabel(b)}
                </button>
              ))}
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Kya Chahiye (note)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Pichli dawa khatam ho gayi, 1 mahine ki aur chahiye"
                className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm resize-none"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Kitne Din Ki Dawa (optional)</label>
              <input
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
                placeholder="e.g. 30"
                className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Delivery</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {DELIVERY_METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMethod(m); setAmountTouched(false); }}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-[12px] font-bold border",
                      method === m ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                    )}
                  >
                    {DELIVERY_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            {method !== "SELF_PICKUP" && (
              <div>
                <label className="text-[11px] font-bold text-muted-foreground uppercase">Address</label>
                <div className="flex flex-wrap gap-1.5 mt-1 mb-1.5">
                  {addresses.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => { setSelectedAddressId(a.id); setShowNewAddress(false); }}
                      className={cn(
                        "rounded-full px-2.5 py-1.5 text-[11px] font-semibold border",
                        !showNewAddress && selectedAddressId === a.id ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                  <button
                    onClick={() => { setShowNewAddress(true); setSelectedAddressId(null); }}
                    className={cn(
                      "rounded-full px-2.5 py-1.5 text-[11px] font-semibold border",
                      showNewAddress ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                    )}
                  >
                    + Naya Address
                  </button>
                </div>

                {showNewAddress && (
                  <div className="space-y-1.5">
                    <textarea
                      value={manualAddress}
                      onChange={(e) => setManualAddress(e.target.value)}
                      rows={2}
                      placeholder="Naya address likho"
                      className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm resize-none"
                    />
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <input type="checkbox" checked={saveNewAddress} onChange={(e) => setSaveNewAddress(e.target.checked)} className="h-4 w-4 rounded border-input" />
                      Is address ko save bhi karo (agli baar ke liye — army/transfer job wale patients alag alag jagah mangwate hai)
                    </label>
                    {saveNewAddress && (
                      <PillOrOtherField options={ADDRESS_LABEL_OPTIONS} value={newAddressLabel} onChange={setNewAddressLabel} otherPlaceholder="e.g. In-laws, Shop" />
                    )}
                  </div>
                )}

                {combine && (
                  <p className="text-[11px] text-success mt-1">
                    ✓ {combine.patient_name} ke order jaisa hi address hai — courier combine ho jayega, surcharge dobara nahi lagega.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Amount</label>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-sm text-muted-foreground">₹</span>
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "")); setAmountTouched(true); }}
                  className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
                />
              </div>
            </div>

            <button onClick={submit} disabled={saving} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
              {saving ? "Saving…" : "Request Banao"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Complaint (Part D/G) — same search→log pattern the old standalone
// /complaint-call screen used, now a Call Desk tile. After logging, offers
// the same optional call-time slot as Online Follow-up.
function ComplaintModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [selected, setSelected] = useState<any | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [logged, setLogged] = useState(false);
  const [showSlotPicker, setShowSlotPicker] = useState(false);

  const { data: results } = useQuery({
    queryKey: ["call-desk-complaint-search", debouncedQ],
    queryFn: () => searchPatients(debouncedQ),
    enabled: !selected && debouncedQ.trim().length >= 2,
  });

  if (showSlotPicker && selected) {
    return (
      <NewAppointmentModal
        initialType="CALL_BACK"
        initialPatient={{ id: selected.id, name: selected.name, mobile: selected.mobile, branch: selected.branch, wa_consent: selected.wa_consent }}
        onClose={onClose}
        onAdded={onClose}
      />
    );
  }

  if (selected && showLog && !logged) {
    return (
      <LogInteractionModal
        patientId={selected.id}
        defaultType="COMPLAINT"
        onClose={onClose}
        onLogged={() => setLogged(true)}
      />
    );
  }

  if (logged) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
        <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
          <h2 className="font-extrabold text-primary text-lg mb-2">Complaint Log Ho Gaya</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {selected?.name} ki complaint register ho gayi — Case-Taking/Prescribing Dr aur Owner ko dikhegi.
          </p>
          <button onClick={() => setShowSlotPicker(true)} className="w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm mb-2">
            Call Back Ka Time Bhi Schedule Karo (optional)
          </button>
          <button onClick={onClose} className="w-full rounded-full bg-muted text-muted-foreground font-bold py-3 text-sm">
            Bas Itna Hi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Complaint / Support Call</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {!selected ? (
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Patient</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Naam ya mobile se search karo"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              autoFocus
            />
            {results && results.length > 0 && (
              <ul className="mt-2 rounded-xl border border-border bg-surface overflow-hidden">
                {results.map((p: any) => (
                  <li key={p.id}>
                    <button
                      onClick={() => { setSelected(p); setShowLog(true); }}
                      className="w-full text-left px-3.5 py-2.5 text-[13px] font-semibold text-primary hover:bg-accent/15 border-b border-border last:border-0"
                    >
                      {p.name} — {p.mobile}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Confirm Payment (Part A/C) — upload a payment screenshot and confirm the
// amount, one combined action ("screenshot bhej do, confirm hota hai").
// This is the ONLY place confirm_online_followup_request_atomic gets
// called from — creates the real visit/payment/delivery in one transaction.
function ConfirmPaymentModal({
  request,
  staffName,
  onClose,
  onConfirmed,
}: {
  request: OnlineFollowupRequest;
  staffName?: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState<File | null>(null);
  const [charged, setCharged] = useState(String(request.amount_expected));
  // Advance/partial payment (25 Sep 2026, migration 0082) — Dr. Yadav found
  // there was no way to record "patient paid an advance now, rest is due."
  // Received defaults equal to charged (full payment, the common case) but
  // is independently editable down for an advance.
  const [received, setReceived] = useState(String(request.amount_expected));
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [paymentMode, setPaymentMode] = useState("UPI");
  const [saving, setSaving] = useState(false);

  const { data: modes } = useQuery({ queryKey: ["payment-modes"], queryFn: () => fetchPaymentModes(true) });

  useEffect(() => {
    if (!receivedTouched) setReceived(charged);
  }, [charged, receivedTouched]);

  const pickFile = (f: File) => {
    if (f.size > 25 * 1024 * 1024) { toast.error("File 25MB se badi hai"); return; }
    setScanning(f);
  };
  const acceptScanned = (f: File) => {
    setScanning(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!file) { toast.error("Payment screenshot upload karo"); return; }
    const chargedAmt = Number(charged);
    const receivedAmt = Number(received);
    if (!chargedAmt || chargedAmt <= 0) { toast.error("Total amount check karo"); return; }
    if (receivedAmt < 0) { toast.error("Received amount check karo"); return; }
    if (receivedAmt > chargedAmt) { toast.error("Received amount total se zyada nahi ho sakta"); return; }
    setSaving(true);
    const uploadRes = await uploadPatientDocument(request.patient_id, "Payment Screenshot", file, `Online follow-up request ${request.id}`, staffName);
    if (!uploadRes.success || !uploadRes.id) {
      setSaving(false);
      toast.error("Screenshot upload nahi hua: " + uploadRes.error);
      return;
    }
    const res = await confirmOnlineFollowupRequest({
      request_id: request.id,
      amount_charged: chargedAmt,
      amount_received: receivedAmt,
      payment_mode: paymentMode,
      doc_id: uploadRes.id,
      confirmed_by: staffName,
    });
    setSaving(false);
    if (!res.success) { toast.error("Confirm nahi hua: " + res.error); return; }
    const balanceNote = res.balance && res.balance > 0 ? ` — ₹${res.balance} baaki hai` : "";
    toast.success(`Confirm ho gaya — token ${res.token_number ?? ""} ban gaya, ab doctor ki queue me dikhega${balanceNote}`);
    onConfirmed();
    onClose();
  };

  if (scanning) {
    return <ScanCropModal file={scanning} onCancel={() => setScanning(null)} onConfirm={acceptScanned} />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Payment Confirm Karo</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-accent/15 border border-accent/40 p-3">
            <div className="text-sm font-bold text-primary">{request.patient?.name}</div>
            <div className="text-[11px] text-muted-foreground">{request.note}</div>
          </div>

          <label className="w-full rounded-2xl border-2 border-dashed border-accent bg-accent/10 p-5 text-center flex flex-col items-center gap-2 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }}
            />
            {preview ? (
              <img src={preview} alt="Preview" className="max-h-40 rounded-lg border border-border" />
            ) : (
              <>
                <Camera className="h-7 w-7 text-primary" />
                <div className="text-sm font-bold text-primary">Payment Screenshot Lo Ya Chuno</div>
              </>
            )}
          </label>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Total Amount</label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm text-muted-foreground">₹</span>
              <input inputMode="numeric" value={charged} onChange={(e) => setCharged(e.target.value.replace(/\D/g, ""))} className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Abhi Kitna Mila (screenshot me jo dikhe)</label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm text-muted-foreground">₹</span>
              <input
                inputMode="numeric"
                value={received}
                onChange={(e) => { setReceived(e.target.value.replace(/\D/g, "")); setReceivedTouched(true); }}
                className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              />
            </div>
            {Number(received) < Number(charged) && (
              <p className="text-[11px] text-warning mt-1">
                Advance hai — ₹{Number(charged) - Number(received)} baaki rahega, patient ki profile me dikhega.
              </p>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Payment Mode</label>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
              {(modes ?? []).length === 0 && <option value="UPI">UPI</option>}
              {(modes ?? []).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>

          <button onClick={submit} disabled={saving || !file} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Confirming…" : "Confirm Karo — Token Banega"}
          </button>
        </div>
      </div>
    </div>
  );
}
