import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthGate, ErrorBlock } from "@/components/yhc/AuthGate";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Cake, Calendar, MapPin, MessageCircle, PhoneCall, Pill, Users, X, Wallet, Camera, FileText, Trash2, Pencil, Briefcase, Gift, Heart, GitMerge, AlertTriangle } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { DMYDateField } from "@/components/yhc/DMYDateField";
import { PillOrOtherField } from "@/components/yhc/PillOrOtherField";
import { DataQualityBanner } from "@/components/yhc/DataQualityBanner";
import { useAuth } from "@/lib/auth";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SecureImage, SecurePhotoLightbox } from "@/components/yhc/SecurePhoto";
import { LogInteractionModal } from "@/components/yhc/LogInteractionModal";
import { ScanCropModal } from "@/components/yhc/ScanCropModal";
import {
  fetchPatientById,
  fetchPatientHistory,
  fetchFamilyMembers,
  linkFamilyMember,
  unlinkFamilyMember,
  searchPatients,
  fetchPatientDocuments,
  uploadPatientDocument,
  deletePatientDocument,
  resolveDocUrl,
  updatePatientContactInfo,
  isDuplicateMobile,
  patientWaMeNumber,
  secondaryWaMeNumber,
  fetchPatientInteractions,
  INTERACTION_TYPE_LABELS,
  DOC_TYPES,
  formatCardNumber,
  displayPatientCode,
  mergePatients,
  fetchWhatsAppDeliveryHealth,
  fetchInteractions,
  uploadPatientPhoto,
  resolveComplaint,
  createManualFollowup,
  isDuplicateCardNumber,
  savePatientCardNumber,
  type DocType,
  type PatientDocument,
  type PatientInteraction,
  type Interaction,
  type DBPatient,
  type WhatsAppDeliveryHealth,
  branchLabel as getBranchLabel,
  RELATIONSHIPS,
  fetchPatientAddresses,
  addPatientAddress,
  updatePatientAddress,
  deletePatientAddress,
  type PatientAddress,
} from "@/lib/db";

const countryCodes = [
  { code: "+91", label: "+91 India" },
  { code: "+971", label: "+971 UAE" },
  { code: "+1", label: "+1 USA/Canada" },
  { code: "+44", label: "+44 UK" },
  { code: "+61", label: "+61 Australia" },
  { code: "+65", label: "+65 Singapore" },
  { code: "+966", label: "+966 Saudi Arabia" },
  { code: "+974", label: "+974 Qatar" },
  { code: "+968", label: "+968 Oman" },
  { code: "+973", label: "+973 Bahrain" },
  { code: "+27", label: "+27 South Africa" },
  { code: "other", label: "Other — type code" },
] as const;

const secondaryLabelOptions = ["Mother", "Father", "Guardian", "Spouse"] as const;
const cityOptions = ["Jaipur"] as const;
const professionOptions = ["Business", "Service/Job", "Housewife", "Student", "Retired", "Farmer"] as const;

function LinkFamilyModal({
  patientId,
  patientName,
  onClose,
  onLinked,
}: {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  // Not pre-selected — see register.tsx's identical fix (Dr. Yadav, 23 Sep
  // 2026): a pre-highlighted "Husband" here risked the same silent-wrong-
  // relationship submit if staff didn't notice/change it before saving.
  const [relationship, setRelationship] = useState<string | null>(null);
  const [customRelationship, setCustomRelationship] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (debouncedQ.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    searchPatients(debouncedQ).then((r) => { if (!cancelled) setResults(r.filter((p: any) => p.id !== patientId)); });
    return () => { cancelled = true; };
  }, [debouncedQ, patientId]);

  const submit = async () => {
    if (!selected) { toast.error("Pehle patient select karo"); return; }
    if (!relationship) { toast.error("Relation batao pehle"); return; }
    const finalRelationship = relationship === "Other" ? customRelationship.trim() || "Other" : relationship;
    setSaving(true);
    const res = await linkFamilyMember(patientId, selected.id, finalRelationship);
    setSaving(false);
    if (!res.success) { toast.error("Link nahi hua: " + res.error); return; }
    toast.success(`${selected.name} family mein link ho gaye`);
    onLinked();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Add Family Member</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Patient dhoondo</label>
            <input
              value={selected ? `${selected.name} — ${selected.mobile}` : q}
              onChange={(e) => { setSelected(null); setQ(e.target.value); }}
              placeholder="Naam ya mobile"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
            {!selected && results.length > 0 && (
              <ul className="mt-1 rounded-xl border border-border bg-background shadow-lg max-h-40 overflow-y-auto">
                {results.map((p: any) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => { setSelected(p); setQ(""); setResults([]); }}
                      className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-accent/15"
                    >
                      {p.name} — {p.mobile}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">
              {selected ? selected.name : "Jo patient upar select karoge, wo"} , {patientName} ka <u>KYA LAGTA HAI</u>?
            </label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {RELATIONSHIPS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRelationship(r)}
                  className={
                    "rounded-full px-3 py-1.5 text-[12px] font-bold border " +
                    (relationship === r ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground")
                  }
                >
                  {r}
                </button>
              ))}
            </div>
            {relationship === "Other" && (
              <input
                value={customRelationship}
                onChange={(e) => setCustomRelationship(e.target.value)}
                placeholder="Relation likho (e.g. Bahnoi, Sasural)"
                className="w-full mt-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
              />
            )}
            {selected && relationship && (
              <p className="text-[11px] mt-2 rounded-lg bg-primary/10 border border-primary/30 px-2 py-1.5 text-primary font-semibold">
                ✓ {selected.name} , {patientName} ka{" "}
                <b>{relationship === "Other" ? customRelationship.trim() || "Other" : relationship}</b> hai.
              </p>
            )}
          </div>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Linking…" : "Link Family Member"}
          </button>
        </div>
      </div>
    </div>
  );
}

const addressLabelOptions = ["Ghar", "Office", "Native/Village"] as const;

// Multiple delivery addresses (24 Sep 2026, Dr. Yadav) — online-bundle
// patients often want medicine sent somewhere different each time. This
// modal both adds a new address and edits an existing one — same form,
// `existing` just seeds the fields and switches submit to an update.
function AddressModal({
  patientId,
  existing,
  onClose,
  onSaved,
}: {
  patientId: string;
  existing: PatientAddress | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? addressLabelOptions[0]);
  const [address, setAddress] = useState(existing?.address ?? "");
  const [city, setCity] = useState(existing?.city ?? "");
  const [pincode, setPincode] = useState(existing?.pincode ?? "");
  const [isDefault, setIsDefault] = useState(existing?.is_default ?? false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!address.trim()) { toast.error("Address likho"); return; }
    setSaving(true);
    const res = existing
      ? await updatePatientAddress(existing.id, { label, address: address.trim(), city: city.trim() || null, pincode: pincode.trim() || null, is_default: isDefault })
      : await addPatientAddress(patientId, { label, address: address.trim(), city: city.trim(), pincode: pincode.trim(), is_default: isDefault });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success(existing ? "Address update ho gaya" : "Address add ho gaya");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">{existing ? "Address Edit Karo" : "Naya Address"}</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Kaunsa address?</label>
            <div className="mt-1">
              <PillOrOtherField options={addressLabelOptions} value={label} onChange={setLabel} otherPlaceholder="e.g. In-laws, Shop" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Full Address</label>
            <textarea
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="House / street / area / landmark"
              className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">City</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Pincode</label>
              <input inputMode="numeric" value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4 rounded border-input" />
            Default address (delivery order banate time sabse pehle yahi dikhega)
          </label>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : existing ? "Save Changes" : "Address Add Karo"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Manual follow-up (23 Sep 2026) — Search → Patient Profile had no way to
// schedule a follow-up for a patient directly; the only path that ever
// created one was automatically off a prescription's next_visit_date.
// Dr. Yadav: "wahan se option nahi aa raha uska follow up add karne ka."
function AddFollowupModal({
  patientId,
  branch,
  onClose,
  onAdded,
}: {
  patientId: string;
  branch: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [channel, setChannel] = useState<"CALL" | "WHATSAPP">("CALL");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!dueDate) { toast.error("Date chuno"); return; }
    setSaving(true);
    try {
      await createManualFollowup({ patient_id: patientId, branch, due_date: dueDate, channel, notes: note });
      toast.success("Follow-up add ho gaya");
      onAdded();
      onClose();
    } catch (e: any) {
      toast.error("Follow-up add nahi hua: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Follow-up Add Karo</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Kab follow-up karna hai</label>
            <input
              type="date"
              value={dueDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Kaise contact karna hai</label>
            <div className="flex gap-1.5 mt-1">
              {(["CALL", "WHATSAPP"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setChannel(c)}
                  className={cn(
                    "flex-1 rounded-lg px-2.5 py-2 text-xs font-semibold border",
                    channel === c ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-foreground border-border",
                  )}
                >
                  {c === "CALL" ? "Call" : "WhatsApp"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Medicine khatam hone wali hai"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
          </div>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Save ho raha hai…" : "Follow-up Add Karo"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Owner-only (16 Sep 2026, Dr. Yadav: "sirf woh main kar sakta hoon, koi
// bhi staff nahi kar sakta") — visibility is gated by the caller, not this
// modal itself, same pattern as everywhere else in this app. `patientId`
// is the record staying alive (the one this modal was opened from); the
// searched-and-selected patient is the duplicate that gets retired and
// folded into it.
function MergePatientModal({
  patientId,
  patientName,
  onClose,
  onMerged,
}: {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (debouncedQ.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    searchPatients(debouncedQ).then((r) => { if (!cancelled) setResults(r.filter((p: any) => p.id !== patientId)); });
    return () => { cancelled = true; };
  }, [debouncedQ, patientId]);

  const expectedConfirm = selected?.name ?? "";
  const confirmed = selected && confirmText.trim().toLowerCase() === expectedConfirm.trim().toLowerCase();

  const submit = async () => {
    if (!selected || !confirmed) return;
    setSaving(true);
    const res = await mergePatients(patientId, selected.id);
    setSaving(false);
    if (!res.success) { toast.error("Merge nahi hua: " + res.error); return; }
    toast.success(`${selected.name} ka poora data ${patientName} mein merge ho gaya`);
    onMerged();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Duplicate Patient Merge Karo</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-muted-foreground">
            Purana/duplicate patient dhoondo — uska poora history (visits, payments, prescriptions, WhatsApp log,
            sab kuch) <b>{patientName}</b> mein aa jayega, aur woh record retire ho jayega (delete nahi hoga).
          </p>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Duplicate patient dhoondo</label>
            <input
              value={selected ? `${selected.name} — ${selected.mobile}` : q}
              onChange={(e) => { setSelected(null); setConfirmText(""); setQ(e.target.value); }}
              placeholder="Naam ya mobile"
              className="w-full mt-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
            {!selected && results.length > 0 && (
              <ul className="mt-1 rounded-xl border border-border bg-background shadow-lg max-h-40 overflow-y-auto">
                {results.map((p: any) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => { setSelected(p); setQ(""); setResults([]); }}
                      className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-accent/15"
                    >
                      {p.name} — {p.mobile} ({displayPatientCode(p)})
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3">
              <p className="text-[12px] text-destructive font-semibold">
                Pakka? {selected.name} ka record retire ho jayega, {patientName} mein merge ho jayega — yeh wapas
                is screen se undo nahi ho sakta.
              </p>
              <label className="text-[11px] font-bold text-muted-foreground uppercase mt-2 block">
                Confirm karne ke liye "{selected.name}" type karo
              </label>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={selected.name}
                className="w-full mt-1 rounded-xl border border-destructive/40 bg-surface px-3 py-2.5 text-sm"
              />
            </div>
          )}

          <button
            onClick={submit}
            disabled={!confirmed || saving}
            className="mt-2 w-full rounded-full bg-destructive text-destructive-foreground font-bold py-3 text-sm disabled:opacity-50"
          >
            {saving ? "Merge ho raha hai…" : "Merge Karo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditContactModal({
  patient,
  onClose,
  onSaved,
}: {
  patient: DBPatient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(patient.name);
  const [mobile, setMobile] = useState(patient.mobile);
  const [mobileConfirmed, setMobileConfirmed] = useState(patient.mobile_confirmed);
  const [countryCode, setCountryCode] = useState<string>(patient.mobile_country_code || "+91");
  const [countryCodeCustom, setCountryCodeCustom] = useState("");
  const [waSameAsMobile, setWaSameAsMobile] = useState(!patient.whatsapp_number);
  const [waNumber, setWaNumber] = useState(patient.whatsapp_number || "");
  const [waConfirmed, setWaConfirmed] = useState(patient.whatsapp_confirmed);
  const [waCountryCode, setWaCountryCode] = useState<string>(patient.whatsapp_country_code || patient.mobile_country_code || "+91");
  const [waCountryCodeCustom, setWaCountryCodeCustom] = useState("");
  const [waConsent, setWaConsent] = useState(patient.wa_consent);
  const [secondaryLabel, setSecondaryLabel] = useState(patient.secondary_mobile_label || "");
  const [secondaryMobile, setSecondaryMobile] = useState(patient.secondary_mobile || "");
  const [secondaryCountryCode, setSecondaryCountryCode] = useState<string>(patient.secondary_mobile_country_code || "+91");
  const [secondaryCountryCodeCustom, setSecondaryCountryCodeCustom] = useState("");
  const [secondaryConfirmed, setSecondaryConfirmed] = useState(patient.secondary_mobile_confirmed);
  const [address, setAddress] = useState(patient.address || "");
  const [city, setCity] = useState(patient.city || "");
  const [pincode, setPincode] = useState(patient.pincode || "");
  const [dob, setDob] = useState(patient.dob || "");
  const [anniversary, setAnniversary] = useState(patient.anniversary_date || "");
  const [profession, setProfession] = useState(patient.profession || "");
  const [annualIncome, setAnnualIncome] = useState(patient.annual_income != null ? String(patient.annual_income) : "");
  const [cardSeries, setCardSeries] = useState(patient.card_series || "");
  const [cardRegister, setCardRegister] = useState(patient.card_register || "");
  const [cardNumber, setCardNumber] = useState(patient.card_number || "");
  const [dupCardWarn, setDupCardWarn] = useState(false);
  const [dupWarn, setDupWarn] = useState(false);
  const [saving, setSaving] = useState(false);

  const checkDupCard = async (series: string, register: string, number: string) => {
    if (series.trim() && register.trim() && number.trim()) {
      setDupCardWarn(await isDuplicateCardNumber(series, register, number, patient.id));
    } else {
      setDupCardWarn(false);
    }
  };
  const onCardSeriesChange = (v: string) => { setCardSeries(v); checkDupCard(v, cardRegister, cardNumber); };
  const onCardRegisterChange = (v: string) => { setCardRegister(v); checkDupCard(cardSeries, v, cardNumber); };
  const onCardNumberChange = (v: string) => { setCardNumber(v); checkDupCard(cardSeries, cardRegister, v); };

  const effectiveCC = countryCode === "other" ? countryCodeCustom.trim() || "+" : countryCode;
  const effectiveWaCC = waCountryCode === "other" ? waCountryCodeCustom.trim() || "+" : waCountryCode;
  const effectiveSecondaryCC = secondaryCountryCode === "other" ? secondaryCountryCodeCustom.trim() || "+" : secondaryCountryCode;
  const isIndia = effectiveCC === "+91";

  const onMobileChange = async (v: string) => {
    const maxLen = isIndia ? 10 : 15;
    const digits = v.replace(/\D/g, "").slice(0, maxLen);
    setMobile(digits);
    // A confirmation only means something for the number it was given
    // for — editing the digits invalidates it until re-confirmed.
    if (digits !== patient.mobile) setMobileConfirmed(false);
    const minLen = isIndia ? 10 : 4;
    if (digits.length >= minLen && (digits !== patient.mobile || effectiveCC !== patient.mobile_country_code)) {
      try {
        setDupWarn(await isDuplicateMobile(digits, effectiveCC, patient.id));
      } catch {
        // RF-09: fail closed, not open — submit() below blocks on dupWarn,
        // so treating a failed check as "duplicate" forces a retry instead
        // of silently letting a possibly-duplicate mobile number save.
        setDupWarn(true);
        toast.error("Duplicate check fail hua — number dobara check karo ya thodi der baad try karo");
      }
    } else {
      setDupWarn(false);
    }
  };

  const submit = async () => {
    const minLen = isIndia ? 10 : 4;
    if (!name.trim()) { toast.error("Naam khaali nahi ho sakta"); return; }
    if (mobile.length < minLen) { toast.error("Mobile number check karo"); return; }
    if (dupWarn) { toast.error("Ye number kisi aur patient ke paas already hai"); return; }
    if (dupCardWarn) { toast.error("Ye card number kisi aur patient ke paas already hai"); return; }
    setSaving(true);
    const res = await updatePatientContactInfo(patient.id, {
      name: name.trim(),
      mobile,
      mobile_country_code: effectiveCC,
      mobile_confirmed: mobileConfirmed,
      whatsapp_country_code: waSameAsMobile ? null : effectiveWaCC,
      whatsapp_number: waSameAsMobile ? null : waNumber || null,
      // "Same as mobile" isn't a separate number to confirm — confirming
      // the mobile above already covers it.
      whatsapp_confirmed: waSameAsMobile ? mobileConfirmed : waConfirmed,
      wa_consent: waConsent,
      secondary_mobile: secondaryMobile.trim() || null,
      secondary_mobile_country_code: effectiveSecondaryCC,
      secondary_mobile_label: secondaryLabel.trim() || null,
      secondary_mobile_confirmed: secondaryMobile.trim() ? secondaryConfirmed : false,
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      pincode: pincode.trim() || undefined,
      dob: dob || null,
      anniversary_date: anniversary || null,
      profession: profession.trim() || null,
      annual_income: annualIncome ? Number(annualIncome) : null,
    });
    // Card number lives in a separate save (savePatientCardNumber) — same
    // split the Case-Taking form already uses, not folded into
    // updatePatientContactInfo's field set.
    if (res.success && (cardSeries.trim() || cardRegister.trim() || cardNumber.trim())) {
      const cardRes = await savePatientCardNumber(patient.id, cardSeries, cardRegister, cardNumber);
      if (!cardRes.success) toast.warning("Baaki details save ho gayi, par card number save nahi hua: " + cardRes.error);
    }
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Details update ho gayi");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl max-h-[85vh] flex flex-col">
        <div className="flex-1 overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Edit Naam / Contact Details</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Naam</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Poora naam"
              className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Mobile</label>
            <div className="flex gap-2 mt-1">
              <select
                value={countryCode}
                onChange={(e) => { setCountryCode(e.target.value); setMobile(""); setDupWarn(false); }}
                className="w-[118px] shrink-0 rounded-lg bg-surface border border-input px-1.5 py-2.5 text-xs"
              >
                {countryCodes.map((c) => <option key={c.code} value={c.code}>{c.code === "other" ? "Other" : c.label}</option>)}
              </select>
              <input
                inputMode="numeric"
                value={mobile}
                onChange={(e) => onMobileChange(e.target.value)}
                className={cn(
                  "flex-1 rounded-lg bg-surface border px-3 py-2.5 text-sm",
                  dupWarn ? "border-destructive" : "border-input",
                )}
              />
            </div>
            {countryCode === "other" && (
              <input
                placeholder="e.g. +65"
                value={countryCodeCustom}
                onChange={(e) => setCountryCodeCustom(e.target.value.replace(/[^\d+]/g, ""))}
                className="mt-2 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
              />
            )}
            {dupWarn && <p className="text-[11px] text-destructive mt-1">⚠ Ye number kisi aur patient ke paas hai</p>}
            <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <input type="checkbox" checked={mobileConfirmed} onChange={(e) => setMobileConfirmed(e.target.checked)} className="h-4 w-4 rounded border-input" />
              Patient se number confirm kar liya hai
            </label>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={waSameAsMobile} onChange={(e) => setWaSameAsMobile(e.target.checked)} className="h-4 w-4 rounded border-input" />
              WhatsApp mobile jaisa hi hai
            </label>
            {!waSameAsMobile && (
              <>
                <div className="flex gap-2 mt-2">
                  <select
                    value={waCountryCode}
                    onChange={(e) => setWaCountryCode(e.target.value)}
                    className="w-[118px] shrink-0 rounded-lg bg-surface border border-input px-1.5 py-2.5 text-xs"
                  >
                    {countryCodes.map((c) => <option key={c.code} value={c.code}>{c.code === "other" ? "Other" : c.label}</option>)}
                  </select>
                  <input
                    inputMode="numeric"
                    placeholder="WhatsApp number"
                    value={waNumber}
                    onChange={(e) => {
                      const maxLen = effectiveWaCC === "+91" ? 10 : 15;
                      setWaNumber(e.target.value.replace(/\D/g, "").slice(0, maxLen));
                      setWaConfirmed(false);
                    }}
                    className="flex-1 rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                  <input type="checkbox" checked={waConfirmed} onChange={(e) => setWaConfirmed(e.target.checked)} className="h-4 w-4 rounded border-input" />
                  Patient se WhatsApp number confirm kar liya hai
                </label>
              </>
            )}
          </div>

          <div className="rounded-lg bg-accent/10 border border-accent/30 p-2.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-primary">
              <input type="checkbox" checked={waConsent} onChange={(e) => setWaConsent(e.target.checked)} className="h-4 w-4 rounded border-input" />
              WhatsApp par updates/reminders bhej sakte hain
            </label>
            <p className="text-[10px] text-muted-foreground mt-1">
              Bulk-imported purane patients ka consent registration ke time nahi liya gaya tha — jab bhi patient se
              poochho aur haan bole, yahan se on kar do.
            </p>
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Doosra Number (optional)</label>
            <p className="text-[10px] text-muted-foreground mt-0.5 mb-1.5">
              Kai patients (khaaskar bacchon) ke 2 reachable number hote hain — jaise Mother/Father. Yahan dusra bhi
              save kar sakte ho, staff call/WhatsApp donon kar sakenge.
            </p>
            <div className="mb-2">
              <PillOrOtherField options={secondaryLabelOptions} value={secondaryLabel} onChange={setSecondaryLabel} otherPlaceholder="Kiska number hai? likho" />
            </div>
            <div className="flex gap-2">
              <select
                value={secondaryCountryCode}
                onChange={(e) => setSecondaryCountryCode(e.target.value)}
                className="w-[118px] shrink-0 rounded-lg bg-surface border border-input px-1.5 py-2.5 text-xs"
              >
                {countryCodes.map((c) => <option key={c.code} value={c.code}>{c.code === "other" ? "Other" : c.label}</option>)}
              </select>
              <input
                inputMode="numeric"
                placeholder="Doosra number"
                value={secondaryMobile}
                onChange={(e) => {
                  const maxLen = effectiveSecondaryCC === "+91" ? 10 : 15;
                  setSecondaryMobile(e.target.value.replace(/\D/g, "").slice(0, maxLen));
                  setSecondaryConfirmed(false);
                }}
                className="flex-1 rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
              />
            </div>
            {secondaryMobile.trim() && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                <input type="checkbox" checked={secondaryConfirmed} onChange={(e) => setSecondaryConfirmed(e.target.checked)} className="h-4 w-4 rounded border-input" />
                Isse bhi confirm kar liya hai
              </label>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Address</label>
            <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">City</label>
              <div className="mt-1">
                <PillOrOtherField options={cityOptions} value={city} onChange={setCity} otherPlaceholder="City likho" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Pincode</label>
              <input inputMode="numeric" value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">DOB</label>
            <DMYDateField value={dob} onChange={setDob} className="mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Anniversary</label>
            <DMYDateField value={anniversary} onChange={setAnniversary} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Profession</label>
              <div className="mt-1">
                <PillOrOtherField options={professionOptions} value={profession} onChange={setProfession} otherPlaceholder="Profession likho" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Annual Income (₹)</label>
              <input inputMode="numeric" value={annualIncome} onChange={(e) => setAnnualIncome(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Card Number</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <input
                placeholder="Series (e.g. B)"
                value={cardSeries}
                maxLength={2}
                onChange={(e) => onCardSeriesChange(e.target.value.toUpperCase())}
                className={cn(
                  "rounded-lg bg-surface border px-3 py-2.5 text-sm uppercase",
                  dupCardWarn ? "border-destructive" : "border-input",
                )}
              />
              <input
                placeholder="Register no."
                value={cardRegister}
                onChange={(e) => onCardRegisterChange(e.target.value)}
                className={cn(
                  "rounded-lg bg-surface border px-3 py-2.5 text-sm",
                  dupCardWarn ? "border-destructive" : "border-input",
                )}
              />
              <input
                placeholder="Card no."
                value={cardNumber}
                onChange={(e) => onCardNumberChange(e.target.value)}
                className={cn(
                  "rounded-lg bg-surface border px-3 py-2.5 text-sm",
                  dupCardWarn ? "border-destructive" : "border-input",
                )}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Series-Register-Card, e.g. B-10-12</p>
            {dupCardWarn && (
              <p className="text-[11px] text-destructive mt-1.5">⚠ Ye card number isi series/register mein kisi aur patient ke paas hai</p>
            )}
          </div>

        </div>
        </div>
        <div className="p-5 pt-3 border-t border-border">
          <button
            onClick={submit}
            disabled={saving}
            className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadDocumentModal({
  patientId,
  onClose,
  onUploaded,
}: {
  patientId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { user } = useAuth();
  const [docType, setDocType] = useState<DocType>("Follow-up Notes");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState<File | null>(null);

  const pickFile = (f: File) => {
    // Compression (in uploadPatientDocument) shrinks the eventual upload
    // regardless of input size, but decoding a huge original into a
    // canvas to do that can itself hang/crash a low-end phone browser —
    // this catches that before it ever gets that far.
    if (f.size > 25 * 1024 * 1024) {
      toast.error("File 25MB se badi hai — chhoti photo chuno");
      return;
    }
    // Case files (Lab Report, Prescription, etc.) are almost always a
    // paper document — route through the crop/scan step first so the
    // table/background around the paper doesn't end up in the upload.
    setScanning(f);
  };

  const acceptScanned = (f: File) => {
    setScanning(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!file) { toast.error("Photo lo ya chuno"); return; }
    setSaving(true);
    const res = await uploadPatientDocument(patientId, docType, file, note, user?.name);
    setSaving(false);
    if (!res.success) { toast.error("Upload nahi hua: " + res.error); return; }
    toast.success("Document upload ho gaya");
    onUploaded();
    onClose();
  };

  if (scanning) {
    return (
      <ScanCropModal
        file={scanning}
        onCancel={() => setScanning(null)}
        onConfirm={acceptScanned}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Upload Document</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Type</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {DOC_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setDocType(t)}
                  className={
                    "rounded-full px-3 py-1.5 text-[12px] font-bold border " +
                    (docType === t ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground")
                  }
                >
                  {t}
                </button>
              ))}
            </div>
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
                <div className="text-sm font-bold text-primary">Photo lo ya chuno</div>
              </>
            )}
            {preview && <div className="text-[11px] text-muted-foreground">Badalne ke liye tap karo</div>}
          </label>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional — e.g. date on paper, visit context)"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
          />
          <button onClick={submit} disabled={saving || !file} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/patient/$id")({
  head: ({ params }) => ({
    meta: [{ title: `Patient ${params.id} — YHC Jaipur` }],
  }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="patientDetail">
      <PatientProfilePage />
    </AuthGate>
  ),
});

function PatientProfilePage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";
  const [patient, setPatient] = useState<DBPatient | null>(null);
  const [visits, setVisits] = useState<any[]>([]);
  const [interactions, setInteractions] = useState<PatientInteraction[]>([]);
  const [crmInteractions, setCrmInteractions] = useState<Interaction[]>([]);
  const [family, setFamily] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<PatientAddress[]>([]);
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  const [viewerDoc, setViewerDoc] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [resolvingComplaintId, setResolvingComplaintId] = useState<string | null>(null);
  const [complaintDrafts, setComplaintDrafts] = useState<Record<string, { clarified: string; answer: string }>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [editingAddress, setEditingAddress] = useState<PatientAddress | "new" | null>(null);
  const [waHealth, setWaHealth] = useState<WhatsAppDeliveryHealth | null>(null);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [p, vs, fam, addrs, docs, ints, crmInts, wa] = await Promise.all([
        fetchPatientById(id),
        // Was 20 — after the bulk historical import, patients with 2-3
        // years of visits genuinely have more than 20; the Doctor Rx
        // Consult screen already uses 200 for the same "poori timeline"
        // reason (see its own fetchPatientHistory call), this page should
        // match so the profile shows the same full history.
        fetchPatientHistory(id, 200),
        fetchFamilyMembers(id),
        fetchPatientAddresses(id),
        fetchPatientDocuments(id),
        fetchPatientInteractions(id),
        fetchInteractions({ patientId: id }),
        fetchWhatsAppDeliveryHealth(id),
      ]);
      setPatient(p);
      setVisits(vs);
      setFamily(fam);
      setAddresses(addrs);
      setDocuments(docs);
      setInteractions(ints);
      setCrmInteractions(crmInts);
      setWaHealth(wa);
      setPhotoUrl(p?.photo_url ? await resolveDocUrl("patient-documents", p.photo_url) : null);
    } catch (e) {
      // Any one of the 7 parallel fetches failing used to leave this page
      // stuck on "Loading patient…" forever — the whole point of this
      // screen is being unusable for that patient until a manual browser
      // reload. Now a failure shows a real retry instead.
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, [id]);

  // Bucket is private — every stored photo_url is just an identifier now,
  // not a working link. Mint a short-lived signed URL per document each
  // time the list loads so thumbnails and "open full size" actually work.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        documents.map(async (d) => [d.id, await resolveDocUrl("patient-documents", d.photo_url)] as const),
      );
      if (!cancelled) {
        setDocUrls(Object.fromEntries(entries.filter((e): e is [string, string] => !!e[1])));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documents]);

  const onPhotoFileChange = async (file: File | null) => {
    if (!file) return;
    setPhotoUploading(true);
    const res = await uploadPatientPhoto(id, file);
    setPhotoUploading(false);
    if (!res.success) {
      toast.error("Photo save nahi hui: " + res.error);
      return;
    }
    toast.success("Photo update ho gayi");
    reload();
  };

  const resolveComplaintCall = async (interactionId: string, resolutionNote: string, clarifiedNote: string) => {
    if (!resolutionNote.trim()) {
      toast.error("Doctor ka jawab likho pehle");
      return;
    }
    setResolvingComplaintId(interactionId);
    const res = await resolveComplaint(interactionId, resolutionNote, user?.name, clarifiedNote);
    setResolvingComplaintId(null);
    if (!res.success) {
      toast.error("Save nahi hua: " + res.error);
      return;
    }
    toast.success("Complaint resolve ho gayi");
    reload();
  };

  if (loading) {
    return (
      <MobileShell title="Loading…" showBack>
        <p className="text-sm text-muted-foreground text-center py-8">Loading patient…</p>
      </MobileShell>
    );
  }

  if (loadError) {
    return (
      <MobileShell title="Patient" showBack>
        <ErrorBlock error={loadError} onRetry={reload} />
      </MobileShell>
    );
  }

  if (!patient) {
    return (
      <MobileShell title="Patient not found" showBack>
        <p className="text-sm text-muted-foreground">
          This patient record doesn't exist.{" "}
          <Link to="/" className="text-primary underline">Back to Queue</Link>
        </p>
      </MobileShell>
    );
  }

  const totalSpent = Number(patient.lifetime_revenue ?? 0);
  const branchLabel = getBranchLabel(patient.branch);

  return (
    <MobileShell title={patient.name} subtitle={displayPatientCode(patient)} showBack>
      {showLinkModal && (
        <LinkFamilyModal patientId={id} patientName={patient.name} onClose={() => setShowLinkModal(false)} onLinked={reload} />
      )}
      {showUploadModal && (
        <UploadDocumentModal patientId={id} onClose={() => setShowUploadModal(false)} onUploaded={reload} />
      )}
      {showEditModal && (
        <EditContactModal patient={patient} onClose={() => setShowEditModal(false)} onSaved={reload} />
      )}
      {showLogModal && (
        <LogInteractionModal patientId={id} onClose={() => setShowLogModal(false)} onLogged={reload} />
      )}
      {editingAddress && (
        <AddressModal
          patientId={id}
          existing={editingAddress === "new" ? null : editingAddress}
          onClose={() => setEditingAddress(null)}
          onSaved={reload}
        />
      )}
      {showFollowupModal && (
        <AddFollowupModal patientId={id} branch={patient.branch} onClose={() => setShowFollowupModal(false)} onAdded={reload} />
      )}
      {showMergeModal && isOwner && (
        <MergePatientModal
          patientId={id}
          patientName={patient.name}
          onClose={() => setShowMergeModal(false)}
          onMerged={reload}
        />
      )}
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <label className="relative shrink-0 h-14 w-14 rounded-full bg-accent text-accent-foreground grid place-items-center text-xl font-bold overflow-hidden cursor-pointer">
            {photoUrl ? (
              <img src={photoUrl} alt={patient.name} className="h-full w-full object-cover" />
            ) : (
              patient.name.charAt(0)
            )}
            {photoUploading && (
              <div className="absolute inset-0 bg-black/40 grid place-items-center text-[9px] text-white">...</div>
            )}
            <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition grid place-items-center">
              <Camera className="h-4 w-4 text-white opacity-0 hover:opacity-100" />
            </div>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPhotoFileChange(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate">{patient.name}</div>
            <div className="text-[11px] opacity-80">
              {patient.age ?? "?"} yrs • {patient.gender ?? "—"} • {branchLabel}
            </div>
            <div className="text-[11px] opacity-80 mt-0.5">{patient.primary_disease ?? ""}</div>
          </div>
          <button
            onClick={() => setShowEditModal(true)}
            className="h-8 w-8 shrink-0 grid place-items-center rounded-full bg-primary-foreground/15"
            aria-label="Edit naam ya contact details"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <a href={`tel:+${(patient.mobile_country_code || "+91").replace(/\D/g, "")}${patient.mobile}`} className="rounded-lg bg-success text-success-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1">
            <PhoneCall className="h-3.5 w-3.5" /> Call
          </a>
          <a href={`https://wa.me/${patientWaMeNumber(patient)}`} target="_blank" rel="noreferrer" className="rounded-lg bg-accent text-accent-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
          <button onClick={() => setShowFollowupModal(true)} className="rounded-lg bg-primary-foreground/15 text-primary-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1">
            <Calendar className="h-3.5 w-3.5" /> Follow-up
          </button>
        </div>
      </div>

      {(!patient.address || !patient.city || !patient.dob || !patient.profession) && (
        <button
          onClick={() => setShowEditModal(true)}
          className="mt-3 w-full rounded-xl bg-accent/15 border border-accent p-2.5 text-left text-[11px] text-primary font-semibold flex items-center gap-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
          Iski kuch details (address/city/DOB/profession) missing hain — tap karke bharo
        </button>
      )}

      <div className="mt-3">
        <DataQualityBanner patient={patient} onEdit={() => setShowEditModal(true)} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat icon={Calendar} label="Visits" value={String(patient.lifetime_visits ?? visits.length)} />
        <Stat icon={Wallet} label="Lifetime" value={`₹${totalSpent}`} />
        <Stat icon={Pill} label="Balance" value={`₹${Number(patient.current_balance ?? 0)}`} />
      </div>

      <div className="mt-4 rounded-xl bg-surface border border-border p-3 text-xs space-y-1.5">
        <Row icon={PhoneCall} label="Mobile" value={`${patient.mobile_country_code || "+91"} ${patient.mobile}`} badge={<ConfirmBadge confirmed={patient.mobile_confirmed} />} />
        {patient.whatsapp_number && (
          <Row icon={MessageCircle} label="WhatsApp" value={`${patient.whatsapp_country_code || patient.mobile_country_code || "+91"} ${patient.whatsapp_number}`} badge={<ConfirmBadge confirmed={patient.whatsapp_confirmed} />} />
        )}
        {patient.secondary_mobile && (
          <Row
            icon={PhoneCall}
            label={patient.secondary_mobile_label || "Doosra"}
            value={`${patient.secondary_mobile_country_code || "+91"} ${patient.secondary_mobile}`}
            badge={
              <div className="flex items-center gap-1.5 shrink-0">
                <ConfirmBadge confirmed={patient.secondary_mobile_confirmed} />
                <a href={`tel:+${(patient.secondary_mobile_country_code || "+91").replace(/\D/g, "")}${patient.secondary_mobile}`} className="h-6 w-6 grid place-items-center rounded-full bg-success/15 text-success">
                  <PhoneCall className="h-3 w-3" />
                </a>
                <a href={`https://wa.me/${secondaryWaMeNumber(patient)}`} target="_blank" rel="noreferrer" className="h-6 w-6 grid place-items-center rounded-full bg-accent/15 text-primary">
                  <MessageCircle className="h-3 w-3" />
                </a>
              </div>
            }
          />
        )}
        <Row icon={MapPin} label="Branch" value={branchLabel} />
        <Row icon={Cake} label="City" value={patient.city ?? "—"} />
        {patient.address && <Row icon={MapPin} label="Address" value={patient.address} />}
        {patient.dob && <Row icon={Gift} label="DOB" value={new Date(patient.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />}
        {patient.anniversary_date && <Row icon={Heart} label="Anniversary" value={new Date(patient.anniversary_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />}
        {patient.profession && <Row icon={Briefcase} label="Profession" value={patient.profession} />}
        {formatCardNumber(patient.card_series, patient.card_register, patient.card_number) && (
          <Row icon={FileText} label="Card No." value={formatCardNumber(patient.card_series, patient.card_register, patient.card_number)!} />
        )}
      </div>

      {waHealth && waHealth.failed > 0 && (
        <div className="mt-4 rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> WhatsApp deliver nahi ho raha
          </div>
          <p className="mt-1 text-destructive/90">
            Last {waHealth.totalSent} messages me se {waHealth.failed} fail hue is number pe
            {waHealth.lastFailedReason ? ` — "${waHealth.lastFailedReason}"` : ""}.
          </p>
        </div>
      )}

      <div className="mt-5">
        <div className="flex items-center justify-between px-1 mb-2">
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" /> Family
          </h2>
          <button onClick={() => setShowLinkModal(true)} className="text-[11px] font-bold text-primary underline">
            + Add
          </button>
        </div>
        {family.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-4 rounded-xl bg-surface border border-border">
            Koi family member link nahi hai. Naam yaad rakhne ki zarurat nahi — yahan se link kar do.
          </p>
        ) : (
          <ul className="space-y-2">
            {family.map((f: any) => (
              <li key={f.id}>
                <Link
                  to="/patient/$id"
                  params={{ id: f.id }}
                  className="flex items-center justify-between rounded-xl bg-surface border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-primary truncate">{f.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {f.family_relationship ?? "—"} • {f.age ?? "?"}y • {f.gender ?? "—"}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {f.last_visit_date ? new Date(f.last_visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between px-1 mb-2">
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Delivery Addresses
          </h2>
          <button onClick={() => setEditingAddress("new")} className="text-[11px] font-bold text-primary underline">
            + Add
          </button>
        </div>
        {addresses.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-4 rounded-xl bg-surface border border-border">
            Koi address save nahi hai. Courier ke liye yahan se ek ya zyada address add karo (Ghar, Office, etc).
          </p>
        ) : (
          <ul className="space-y-2">
            {addresses.map((a) => (
              <li key={a.id} className="rounded-xl bg-surface border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-primary">{a.label}</span>
                      {a.is_default && <span className="rounded-full bg-accent/20 text-accent-foreground text-[9px] font-bold px-1.5 py-0.5">DEFAULT</span>}
                    </div>
                    <p className="text-[13px] text-foreground/90 mt-0.5">{a.address}</p>
                    {(a.city || a.pincode) && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{[a.city, a.pincode].filter(Boolean).join(" — ")}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => setEditingAddress(a)} className="h-7 w-7 grid place-items-center rounded-full bg-accent/15 text-primary">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm("Yeh address delete karein?")) return;
                        const res = await deletePatientAddress(a.id);
                        if (res.success) { toast.success("Address hataaya"); reload(); }
                        else toast.error("Delete nahi hua: " + res.error);
                      }}
                      className="h-7 w-7 grid place-items-center rounded-full bg-destructive/10 text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isOwner && (
        <div className="mt-5">
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 px-1 mb-2">
            <GitMerge className="h-3 w-3" /> Duplicate Record
          </h2>
          <button
            onClick={() => setShowMergeModal(true)}
            className="w-full rounded-xl bg-surface border border-border p-3 text-left text-[12px] text-muted-foreground"
          >
            Agar yeh patient ka koi purana/duplicate record hai, usse yahan merge karo — sirf Owner kar sakta hai.
          </button>
        </div>
      )}

      <div className="mt-5">
        <div className="flex items-center justify-between px-1 mb-2">
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <FileText className="h-3 w-3" /> Documents
          </h2>
          <button onClick={() => setShowUploadModal(true)} className="text-[11px] font-bold text-primary underline inline-flex items-center gap-1">
            <Camera className="h-3 w-3" /> Upload
          </button>
        </div>
        {documents.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-4 rounded-xl bg-surface border border-border">
            Koi document upload nahi hua. Paper pe likha follow-up ya case note yahan se photo khinch ke upload kar do.
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li key={d.id} className="rounded-xl bg-surface border border-border p-2.5 flex items-center gap-2.5">
                {docUrls[d.id] ? (
                  <button
                    type="button"
                    onClick={() => setViewerDoc(d.id)}
                    aria-label={`Open ${d.doc_type}`}
                    className="shrink-0"
                  >
                    <SecureImage src={docUrls[d.id]} alt={d.doc_type} className="h-14 w-14 rounded-lg object-cover border border-border" />
                  </button>
                ) : (
                  <div className="h-14 w-14 rounded-lg border border-border bg-accent/10 shrink-0 grid place-items-center text-[9px] text-muted-foreground">
                    …
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold text-primary">{d.doc_type}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(d.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    {d.uploaded_by && ` • ${d.uploaded_by}`}
                  </div>
                  {d.note && <div className="text-[11px] text-foreground/80 truncate mt-0.5">{d.note}</div>}
                </div>
                <button
                  onClick={async () => {
                    if (!window.confirm("Yeh document delete karein?")) return;
                    const res = await deletePatientDocument(d.id);
                    if (res.success) { toast.success("Document hataaya"); reload(); }
                    else toast.error("Delete nahi hua: " + res.error);
                  }}
                  className="shrink-0 h-7 w-7 grid place-items-center rounded-full bg-destructive/10 text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewerDoc && docUrls[viewerDoc] && (
        <SecurePhotoLightbox
          items={documents
            .filter((d) => docUrls[d.id])
            .map((d) => ({
              id: d.id,
              url: docUrls[d.id],
              label: d.doc_type,
              date: new Date(d.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
              note: d.note,
            }))}
          index={Math.max(0, documents.filter((d) => docUrls[d.id]).findIndex((d) => d.id === viewerDoc))}
          onIndexChange={(i) => {
            const list = documents.filter((d) => docUrls[d.id]);
            if (list[i]) setViewerDoc(list[i].id);
          }}
          onClose={() => setViewerDoc(null)}
        />
      )}

      <div className="mt-5">
        <div className="flex items-center justify-between px-1 mb-2">
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeline</h2>
          <button
            onClick={() => setShowLogModal(true)}
            className="text-[11px] font-bold text-primary underline inline-flex items-center gap-1"
          >
            <PhoneCall className="h-3 w-3" /> Log Interaction
          </button>
        </div>
        {/* 04 Aug 2026 — Operational Manual Feature 1: visits and
            interactions merged into one chronologically-sorted list
            instead of two separate sections, so "why did they call" and
            "what happened at their last visit" are answerable from one
            scroll instead of hunting across the page.
            18 Sep 2026 — a THIRD source joins this timeline: `interactions`
            (the CRM table Reception's Follow-up screen logs pre-visit
            reminder calls into). Before this it only lived on the
            Follow-up/Leads screens, invisible here — a patient's own
            profile is the one place Dr. Yadav actually wants the full
            "kab kab kya hua" picture, so it belongs in this same list. */}
        {visits.length === 0 && interactions.length === 0 && crmInteractions.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">Abhi tak koi visit ya interaction record nahi hai.</p>
        ) : (
          <ul className="space-y-2">
            {[
              ...visits.map((v: any) => ({ kind: "visit" as const, at: v.visit_date, data: v })),
              ...interactions.map((i) => ({ kind: "interaction" as const, at: i.created_at, data: i })),
              ...crmInteractions.map((i) => ({ kind: "crm" as const, at: i.created_at, data: i })),
            ]
              .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
              .map((entry) => {
                if (entry.kind === "visit") {
                  const isVideo = (entry.data.visit_type ?? "").toUpperCase() === "VIDEO";
                  return (
                    <li
                      key={`v-${entry.data.id}`}
                      className="rounded-xl bg-surface border border-border border-l-4 border-l-primary p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                          {new Date(entry.data.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          {isVideo && (
                            <span className="rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-bold">
                              🎥 Online Follow-up
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] font-bold text-success">{entry.data.visit_status}</span>
                      </div>
                      {entry.data.chief_complaint && <p className="text-sm mt-1">{entry.data.chief_complaint}</p>}
                      {entry.data.prescriptions && entry.data.prescriptions.length > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Pill className="h-3 w-3" />{" "}
                          {entry.data.prescriptions.map((r: any) => `${r.medicine_name} ${r.potency ?? ""}`.trim()).join(", ")}
                        </p>
                      )}
                      {/* Bulk-imported visit history (medicine/duration/charges/slip no./
                          due date/details) — folded into one text field at import time
                          (buildVisitImportNotes in db.ts) since these rows never go
                          through the structured prescriptions table. Was saved in the DB
                          from day one but never actually rendered here, so every
                          bulk-imported visit looked like a bare date with nothing else —
                          found live 22 Sep 2026 when the Owner asked why the timeline
                          wasn't showing what medicine a patient was given historically. */}
                      {entry.data.import_notes && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
                          <Pill className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>{entry.data.import_notes}</span>
                        </p>
                      )}
                      {entry.data.recased_at && (
                        <p className="text-[11px] text-destructive mt-1">🔁 Recase ki gayi{entry.data.recase_reason ? `: ${entry.data.recase_reason}` : ""}</p>
                      )}
                    </li>
                  );
                }
                if (entry.kind === "crm") {
                  return (
                    <li
                      key={`c-${entry.data.id}`}
                      className="rounded-xl bg-surface border border-border border-l-4 border-l-success p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-success bg-success/15 rounded-full px-2 py-0.5">
                          {entry.data.type === "call" ? "Follow-up Call" : "WhatsApp"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(entry.data.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{entry.data.summary}</p>
                      {entry.data.created_by && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">— {entry.data.created_by}</p>
                      )}
                    </li>
                  );
                }
                const isComplaint = entry.data.type === "COMPLAINT";
                const isOpen = isComplaint && entry.data.status === "OPEN";
                return (
                  <li
                    key={`i-${entry.data.id}`}
                    className={cn(
                      "rounded-xl bg-surface border p-3",
                      isOpen ? "border-destructive/50 border-l-4 border-l-destructive" : "border-border border-l-4 border-l-accent",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "text-xs font-semibold rounded-full px-2 py-0.5",
                          isOpen ? "text-destructive bg-destructive/15" : "text-accent-foreground bg-accent/20",
                        )}
                      >
                        {INTERACTION_TYPE_LABELS[entry.data.type]}{isOpen ? " — Jawab pending" : ""}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(entry.data.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{entry.data.note}</p>
                    {entry.data.created_by && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">— {entry.data.created_by}</p>
                    )}
                    {isComplaint && entry.data.status === "RESOLVED" && (
                      <div className="mt-2 space-y-2">
                        {entry.data.clarified_note && (
                          <div className="rounded-lg bg-accent/15 border border-accent/40 p-2">
                            <p className="text-[10px] font-bold text-accent-foreground uppercase">Asli complaint (Jr Doctor ne confirm ki)</p>
                            <p className="text-sm mt-0.5 whitespace-pre-wrap">{entry.data.clarified_note}</p>
                          </div>
                        )}
                        <div className="rounded-lg bg-success/10 border border-success/30 p-2">
                          <p className="text-[10px] font-bold text-success uppercase">Doctor ka jawab</p>
                          <p className="text-sm mt-0.5 whitespace-pre-wrap">{entry.data.resolved_note}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            — {entry.data.resolved_by ?? "—"}
                            {entry.data.resolved_at && ` • ${new Date(entry.data.resolved_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
                          </p>
                        </div>
                      </div>
                    )}
                    {isOpen && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <input
                          value={complaintDrafts[entry.data.id]?.clarified ?? ""}
                          onChange={(e) => setComplaintDrafts((s) => ({ ...s, [entry.data.id]: { clarified: e.target.value, answer: s[entry.data.id]?.answer ?? "" } }))}
                          placeholder="Patient ne actually kya bola (optional)..."
                          className="w-full rounded-lg bg-background border border-input px-2.5 py-1.5 text-xs"
                        />
                        <div className="flex gap-1.5">
                          <input
                            value={complaintDrafts[entry.data.id]?.answer ?? ""}
                            onChange={(e) => setComplaintDrafts((s) => ({ ...s, [entry.data.id]: { clarified: s[entry.data.id]?.clarified ?? "", answer: e.target.value } }))}
                            placeholder="Doctor ka jawab likho..."
                            className="flex-1 min-w-0 rounded-lg bg-background border border-input px-2.5 py-1.5 text-xs"
                          />
                          <button
                            onClick={() => resolveComplaintCall(entry.data.id, complaintDrafts[entry.data.id]?.answer ?? "", complaintDrafts[entry.data.id]?.clarified ?? "")}
                            disabled={resolvingComplaintId === entry.data.id}
                            className="shrink-0 rounded-lg bg-success text-success-foreground px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                          >
                            {resolvingComplaintId === entry.data.id ? "..." : "Resolve"}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </MobileShell>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <Icon className="h-4 w-4 mx-auto text-primary" />
      <div className="text-sm font-bold mt-1 truncate">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ icon: Icon, label, value, badge }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-16">{label}</span>
      <span className="font-medium truncate">{value}</span>
      {badge}
    </div>
  );
}

function ConfirmBadge({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <span className="shrink-0 text-[10px] font-bold text-success">✓ Confirmed</span>
  ) : (
    <span className="shrink-0 text-[10px] font-bold text-destructive">⚠ Confirm nahi hai</span>
  );
}
