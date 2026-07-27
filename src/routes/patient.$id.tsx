import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthGate } from "@/components/yhc/AuthGate";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Cake, Calendar, MapPin, MessageCircle, PhoneCall, Pill, Users, X, Wallet, Camera, FileText, Trash2, Pencil, Briefcase, Gift, Heart } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { useAuth } from "@/lib/auth";
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
  patientWhatsAppTarget,
  DOC_TYPES,
  type DocType,
  type PatientDocument,
  type DBPatient,
} from "@/lib/db";

const RELATIONSHIPS = ["Spouse", "Son", "Daughter", "Parent", "Sibling", "Other"];
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

function LinkFamilyModal({
  patientId,
  onClose,
  onLinked,
}: {
  patientId: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    searchPatients(q).then((r) => { if (!cancelled) setResults(r.filter((p: any) => p.id !== patientId)); });
    return () => { cancelled = true; };
  }, [q, patientId]);

  const submit = async () => {
    if (!selected) { toast.error("Pehle patient select karo"); return; }
    setSaving(true);
    const res = await linkFamilyMember(patientId, selected.id, relationship);
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
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
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
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Yeh patient family mein kaun hai?</label>
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
          </div>
          <button onClick={submit} disabled={saving} className="mt-2 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Linking…" : "Link Family Member"}
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
  const [mobile, setMobile] = useState(patient.mobile);
  const [countryCode, setCountryCode] = useState<string>(patient.mobile_country_code || "+91");
  const [countryCodeCustom, setCountryCodeCustom] = useState("");
  const [waSameAsMobile, setWaSameAsMobile] = useState(!patient.whatsapp_number);
  const [waNumber, setWaNumber] = useState(patient.whatsapp_number || "");
  const [waCountryCode, setWaCountryCode] = useState<string>(patient.whatsapp_country_code || patient.mobile_country_code || "+91");
  const [waCountryCodeCustom, setWaCountryCodeCustom] = useState("");
  const [address, setAddress] = useState(patient.address || "");
  const [city, setCity] = useState(patient.city || "");
  const [pincode, setPincode] = useState(patient.pincode || "");
  const [dob, setDob] = useState(patient.dob || "");
  const [anniversary, setAnniversary] = useState(patient.anniversary_date || "");
  const [profession, setProfession] = useState(patient.profession || "");
  const [annualIncome, setAnnualIncome] = useState(patient.annual_income != null ? String(patient.annual_income) : "");
  const [dupWarn, setDupWarn] = useState(false);
  const [saving, setSaving] = useState(false);

  const effectiveCC = countryCode === "other" ? countryCodeCustom.trim() || "+" : countryCode;
  const effectiveWaCC = waCountryCode === "other" ? waCountryCodeCustom.trim() || "+" : waCountryCode;
  const isIndia = effectiveCC === "+91";
  const maxDobDate = new Date().toISOString().slice(0, 10);

  const onMobileChange = async (v: string) => {
    const maxLen = isIndia ? 10 : 15;
    const digits = v.replace(/\D/g, "").slice(0, maxLen);
    setMobile(digits);
    const minLen = isIndia ? 10 : 4;
    if (digits.length >= minLen && (digits !== patient.mobile || effectiveCC !== patient.mobile_country_code)) {
      setDupWarn(await isDuplicateMobile(digits, effectiveCC, patient.id));
    } else {
      setDupWarn(false);
    }
  };

  const submit = async () => {
    const minLen = isIndia ? 10 : 4;
    if (mobile.length < minLen) { toast.error("Mobile number check karo"); return; }
    if (dupWarn) { toast.error("Ye number kisi aur patient ke paas already hai"); return; }
    setSaving(true);
    const res = await updatePatientContactInfo(patient.id, {
      mobile,
      mobile_country_code: effectiveCC,
      whatsapp_country_code: waSameAsMobile ? null : effectiveWaCC,
      whatsapp_number: waSameAsMobile ? null : waNumber || null,
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      pincode: pincode.trim() || undefined,
      dob: dob || null,
      anniversary_date: anniversary || null,
      profession: profession.trim() || null,
      annual_income: annualIncome ? Number(annualIncome) : null,
    });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Details update ho gayi");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Edit Contact Details</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Mobile</label>
            <div className="flex gap-2 mt-1">
              <select
                value={countryCode}
                onChange={(e) => { setCountryCode(e.target.value); setMobile(""); setDupWarn(false); }}
                className="w-[92px] shrink-0 rounded-lg bg-surface border border-input px-1.5 py-2.5 text-xs"
              >
                {countryCodes.map((c) => <option key={c.code} value={c.code}>{c.code === "other" ? "Other" : c.code}</option>)}
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
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={waSameAsMobile} onChange={(e) => setWaSameAsMobile(e.target.checked)} className="h-4 w-4 rounded border-input" />
              WhatsApp mobile jaisa hi hai
            </label>
            {!waSameAsMobile && (
              <div className="flex gap-2 mt-2">
                <select
                  value={waCountryCode}
                  onChange={(e) => setWaCountryCode(e.target.value)}
                  className="w-[92px] shrink-0 rounded-lg bg-surface border border-input px-1.5 py-2.5 text-xs"
                >
                  {countryCodes.map((c) => <option key={c.code} value={c.code}>{c.code === "other" ? "Other" : c.code}</option>)}
                </select>
                <input
                  inputMode="numeric"
                  placeholder="WhatsApp number"
                  value={waNumber}
                  onChange={(e) => {
                    const maxLen = effectiveWaCC === "+91" ? 10 : 15;
                    setWaNumber(e.target.value.replace(/\D/g, "").slice(0, maxLen));
                  }}
                  className="flex-1 rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
                />
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Address</label>
            <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm resize-none" />
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">DOB</label>
              <input type="date" max={maxDobDate} value={dob} onChange={(e) => setDob(e.target.value)} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Anniversary</label>
              <input type="date" max={maxDobDate} value={anniversary} onChange={(e) => setAnniversary(e.target.value)} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Profession</label>
              <input value={profession} onChange={(e) => setProfession(e.target.value)} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground uppercase">Annual Income (₹)</label>
              <input inputMode="numeric" value={annualIncome} onChange={(e) => setAnnualIncome(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
            </div>
          </div>

          <button
            onClick={submit}
            disabled={saving}
            className="mt-2 w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold disabled:opacity-60"
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

  const pickFile = (f: File) => {
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

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Upload Document</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
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
  const [patient, setPatient] = useState<DBPatient | null>(null);
  const [visits, setVisits] = useState<any[]>([]);
  const [family, setFamily] = useState<any[]>([]);
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const reload = async () => {
    setLoading(true);
    const [p, vs, fam, docs] = await Promise.all([
      fetchPatientById(id),
      fetchPatientHistory(id, 20),
      fetchFamilyMembers(id),
      fetchPatientDocuments(id),
    ]);
    setPatient(p);
    setVisits(vs);
    setFamily(fam);
    setDocuments(docs);
    setLoading(false);
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

  if (loading) {
    return (
      <MobileShell title="Loading…" showBack>
        <p className="text-sm text-muted-foreground text-center py-8">Loading patient…</p>
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
  const branchLabel = patient.branch === "BAJAJ_NAGAR" ? "Bajaj Nagar" : patient.branch === "JAGATPURA" ? "Jagatpura" : patient.branch ?? "";

  return (
    <MobileShell title={patient.name} subtitle={patient.patient_code ?? patient.id.slice(0, 8)} showBack>
      {showLinkModal && (
        <LinkFamilyModal patientId={id} onClose={() => setShowLinkModal(false)} onLinked={reload} />
      )}
      {showUploadModal && (
        <UploadDocumentModal patientId={id} onClose={() => setShowUploadModal(false)} onUploaded={reload} />
      )}
      {showEditModal && (
        <EditContactModal patient={patient} onClose={() => setShowEditModal(false)} onSaved={reload} />
      )}
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-accent text-accent-foreground grid place-items-center text-xl font-bold">
            {patient.name.charAt(0)}
          </div>
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
            aria-label="Edit contact details"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a href={`tel:+${(patient.mobile_country_code || "+91").replace(/\D/g, "")}${patient.mobile}`} className="rounded-lg bg-success text-success-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1">
            <PhoneCall className="h-3.5 w-3.5" /> Call
          </a>
          <a href={`https://wa.me/${patientWhatsAppTarget(patient)}`} target="_blank" rel="noreferrer" className="rounded-lg bg-accent text-accent-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat icon={Calendar} label="Visits" value={String(patient.lifetime_visits ?? visits.length)} />
        <Stat icon={Wallet} label="Lifetime" value={`₹${totalSpent}`} />
        <Stat icon={Pill} label="Balance" value={`₹${Number(patient.current_balance ?? 0)}`} />
      </div>

      <div className="mt-4 rounded-xl bg-surface border border-border p-3 text-xs space-y-1.5">
        <Row icon={PhoneCall} label="Mobile" value={`${patient.mobile_country_code || "+91"} ${patient.mobile}`} />
        {patient.whatsapp_number && (
          <Row icon={MessageCircle} label="WhatsApp" value={`${patient.whatsapp_country_code || patient.mobile_country_code || "+91"} ${patient.whatsapp_number}`} />
        )}
        <Row icon={MapPin} label="Branch" value={branchLabel} />
        <Row icon={Cake} label="City" value={patient.city ?? "—"} />
        {patient.address && <Row icon={MapPin} label="Address" value={patient.address} />}
        {patient.dob && <Row icon={Gift} label="DOB" value={new Date(patient.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />}
        {patient.anniversary_date && <Row icon={Heart} label="Anniversary" value={new Date(patient.anniversary_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} />}
        {patient.profession && <Row icon={Briefcase} label="Profession" value={patient.profession} />}
        {patient.card_number && <Row icon={FileText} label="Card No." value={`${patient.card_number}${patient.card_register ? " (" + patient.card_register + ")" : ""}`} />}
      </div>

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
                  <a href={docUrls[d.id]} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={docUrls[d.id]} alt={d.doc_type} className="h-14 w-14 rounded-lg object-cover border border-border" />
                  </a>
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

      <div className="mt-5">
        <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-2">
          Visit History
        </h2>
        {visits.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">No previous visits recorded.</p>
        ) : (
          <ul className="space-y-2">
            {visits.map((v: any) => (
              <li key={v.id} className="rounded-xl bg-surface border border-border border-l-4 border-l-primary p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">
                    {new Date(v.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                  <span className="text-[11px] font-bold text-success">{v.visit_status}</span>
                </div>
                {v.chief_complaint && <p className="text-sm mt-1">{v.chief_complaint}</p>}
                {v.prescriptions && v.prescriptions.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Pill className="h-3 w-3" />{" "}
                    {v.prescriptions.map((r: any) => `${r.medicine_name} ${r.potency ?? ""}`.trim()).join(", ")}
                  </p>
                )}
              </li>
            ))}
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

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-16">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}
