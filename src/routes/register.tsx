import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate } from "@/components/yhc/AuthGate";
import { ChipSelect } from "@/components/yhc/ChipSelect";
import { DMYDateField } from "@/components/yhc/DMYDateField";
import { createPatientWithVisit, isDuplicateMobile, patientWhatsAppTarget, findPatientByMobile, checkInExistingPatient, autoConvertMatchingLead, branchLabel, BRANCH_KEYS, LEAD_SOURCES, linkFamilyMember, RELATIONSHIPS, fetchFeeMaster, DEFAULT_FEE_MASTER, fetchPaymentModes, collectPayment } from "@/lib/db";
import { sendWhatsApp } from "@/lib/whatsapp";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "New Patient — YHC Jaipur" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="register">
      <RegisterPage />
    </AuthGate>
  ),
});

const genders = ["Male", "Female", "Other"] as const;
const blood = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", "Not Known"] as const;
const branchOpts = BRANCH_KEYS.map((key) => ({ key, label: branchLabel(key) }));
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

function Section({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-primary uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm text-foreground",
        "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
        props.className,
      )}
    />
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [saved, setSaved] = useState<{
    token: string; code: string; branch: string; name: string; visitId: string; caseChannel: "WALK_IN" | "ONLINE";
    paymentCollected: boolean; paymentAmount: number;
  } | null>(null);

  const [f, setF] = useState({
    name: "",
    mobile: "",
    countryCode: "+91" as (typeof countryCodes)[number]["code"],
    countryCodeCustom: "",
    waSameAsMobile: true,
    waNumber: "",
    waCountryCode: "+91" as (typeof countryCodes)[number]["code"],
    waCountryCodeCustom: "",
    age: "",
    gender: "" as "" | (typeof genders)[number],
    blood: "" as "" | (typeof blood)[number],
    address: "",
    city: "Jaipur",
    pincode: "",
    chief: "",
    dob: "",
    anniversary: "",
    profession: "",
    annualIncome: "",
    branch: "" as "" | "BAJAJ_NAGAR" | "JAGATPURA",
    consent: true,
    // Online-case tracking (Dr. Yadav, 29 Jul 2026)
    caseChannel: "WALK_IN" as "WALK_IN" | "ONLINE",
    // TASK 5 — where this patient came from, so the Owner can see which
    // sources actually turn into paying patients (not just enquiries).
    leadSource: "Walk-in" as string,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  // "other" resolves to whatever the user typed in the custom box; every
  // other option already has the code baked into its own value.
  const effectiveCountryCode = f.countryCode === "other" ? f.countryCodeCustom.trim() || "+" : f.countryCode;
  const effectiveWaCountryCode = f.waCountryCode === "other" ? f.waCountryCodeCustom.trim() || "+" : f.waCountryCode;
  const isIndia = effectiveCountryCode === "+91";

  const [dupWarn, setDupWarn] = useState(false);
  const [busy, setBusy] = useState(false);

  const [existingPatient, setExistingPatient] = useState<{ id: string; name: string; patient_code: string | null } | null>(null);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [familyRelationship, setFamilyRelationship] = useState(RELATIONSHIPS[0]);
  const [customFamilyRelationship, setCustomFamilyRelationship] = useState("");

  // Inline payment collection at registration (Dr. Yadav, 13 Aug 2026) —
  // "payment pehle hota hai, baad mein entry hoti hai" (payment happens
  // first in real life, the paperwork happens after). Reception collects
  // cash/UPI right at the counter, so payment now gets recorded in the
  // SAME submit as the patient/visit, instead of requiring a separate trip
  // to the Pay screen. planMonths covers the "someone bought a 3-month
  // plan" case in one shot instead of one payment per month.
  const { data: feeMaster } = useQuery({ queryKey: ["fee-master"], queryFn: fetchFeeMaster });
  const fees = feeMaster ?? DEFAULT_FEE_MASTER;
  const { data: paymentModesData } = useQuery({ queryKey: ["payment-modes"], queryFn: () => fetchPaymentModes(true) });
  const paymentModes = paymentModesData ?? [];
  const feeKind = f.caseChannel === "ONLINE" ? "ONLINE" : "NEW";
  const [planMonths, setPlanMonths] = useState(1);
  const standardAmount = fees[feeKind] * planMonths;
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAmountTouched, setPaymentAmountTouched] = useState(false);
  const [paymentMode, setPaymentMode] = useState("CASH");
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!paymentAmountTouched) setPaymentAmount(String(standardAmount));
  }, [standardAmount, paymentAmountTouched]);

  const pickPlan = (months: number) => {
    setPlanMonths(months);
    setPaymentAmountTouched(false);
  };

  const onMobileChange = async (v: string) => {
    const maxLen = isIndia ? 10 : 15;
    const digits = v.replace(/\D/g, "").slice(0, maxLen);
    set("mobile", digits);
    const minLen = isIndia ? 10 : 4;
    if (digits.length >= minLen) {
      const isDup = await isDuplicateMobile(digits, effectiveCountryCode);
      setDupWarn(isDup);
      setExistingPatient(isDup ? await findPatientByMobile(digits, effectiveCountryCode) : null);
      setFamilyRelationship(RELATIONSHIPS[0]);
    } else {
      setDupWarn(false);
      setExistingPatient(null);
    }
  };

  const checkInInstead = async () => {
    if (!existingPatient) return;
    if (!f.branch) { toast.error("Branch chuno pehle"); return; }
    setCheckInBusy(true);
    try {
      const { visit } = await checkInExistingPatient({
        patient_id: existingPatient.id,
        branch: f.branch as "BAJAJ_NAGAR" | "JAGATPURA",
        chief_complaint: f.chief.trim() || undefined,
        case_channel: f.caseChannel,
      });
      setSaved({
        token: visit.token_number ?? "T-01",
        code: existingPatient.patient_code ?? "YHC-—",
        branch: f.branch,
        name: existingPatient.name,
        visitId: visit.id,
        caseChannel: f.caseChannel,
        paymentCollected: false,
        paymentAmount: 0,
      });
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      toast.success(`${existingPatient.name} check-in ho gaye`);
    } catch (e: any) {
      toast.error(e?.message || "Check-in fail hui");
    } finally {
      setCheckInBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    const mobileMinLen = isIndia ? 10 : 4;
    if (!f.name.trim()) errs.push("Name");
    if (f.mobile.length < mobileMinLen) errs.push(isIndia ? "10-digit Mobile" : "Mobile Number");
    if (f.countryCode === "other" && !f.countryCodeCustom.trim()) errs.push("Country Code");
    if (!f.waSameAsMobile) {
      const waMinLen = effectiveWaCountryCode === "+91" ? 10 : 4;
      if (f.waNumber.length < waMinLen) errs.push("WhatsApp Number");
      if (f.waCountryCode === "other" && !f.waCountryCodeCustom.trim()) errs.push("WhatsApp Country Code");
    }
    if (!f.age || Number(f.age) <= 0) errs.push("Age");
    if (!f.gender) errs.push("Gender");
    if (!f.branch) errs.push("Branch");
    if (!f.consent) errs.push("WhatsApp Consent");
    if (errs.length) {
      toast.error(`Missing: ${errs.join(", ")}`);
      return;
    }
    // Was a hard block here — one mobile number could only ever have ONE
    // patient in the whole system, so any family sharing a single phone
    // (extremely common — husband/wife/kids on one number) could register
    // their first member and then every subsequent member from the same
    // household would be refused outright with no way through. The
    // family_group_id/family_relationship columns and the live duplicate
    // warning + "Check-In Instead" shortcut just above already handle the
    // real accidental-duplicate case; this submit-time check was blocking
    // the legitimate case on top of that, not just the mistake.
    setBusy(true);
    try {
      const { patient, visit } = await createPatientWithVisit({
        name: f.name.trim(),
        mobile: f.mobile,
        mobile_country_code: effectiveCountryCode,
        whatsapp_country_code: f.waSameAsMobile ? undefined : effectiveWaCountryCode,
        whatsapp_number: f.waSameAsMobile ? undefined : f.waNumber,
        age: Number(f.age),
        gender: f.gender || undefined,
        blood_group: f.blood || undefined,
        city: f.city || undefined,
        pincode: f.pincode || undefined,
        address: f.address.trim() || undefined,
        primary_disease: f.chief.trim() || undefined,
        wa_consent: f.consent,
        dob: f.dob || undefined,
        anniversary_date: f.anniversary || undefined,
        profession: f.profession.trim() || undefined,
        annual_income: f.annualIncome ? Number(f.annualIncome) : undefined,
        branch: f.branch as "BAJAJ_NAGAR" | "JAGATPURA",
        chief_complaint: f.chief.trim() || undefined,
        case_channel: f.caseChannel,
        lead_source: f.leadSource,
      });
      let paymentCollected = false;
      const amountToCollect = Number(paymentAmount) || 0;
      if (amountToCollect > 0) {
        try {
          await collectPayment({
            visit_id: visit.id,
            patient_id: patient.id,
            amount_charged: amountToCollect,
            amount_received: amountToCollect,
            payment_mode: paymentMode,
            branch: f.branch as "BAJAJ_NAGAR" | "JAGATPURA",
            notes: planMonths > 1 ? `${planMonths} Month Plan` : undefined,
            idempotency_key: paymentIdempotencyKey,
          });
          paymentCollected = true;
          qc.invalidateQueries({ queryKey: ["available-credit", patient.id] });
        } catch (e: any) {
          console.error("Inline payment collection failed:", e?.message ?? e);
          toast.warning("Registration ho gaya, par payment save nahi hua — Pay screen se dobara try karo: " + (e?.message ?? ""));
        }
      }
      setSaved({
        token: visit.token_number ?? "T-01",
        code: patient.patient_code ?? "YHC-—",
        branch: patient.branch,
        name: patient.name,
        visitId: visit.id,
        caseChannel: f.caseChannel,
        paymentCollected,
        paymentAmount: amountToCollect,
      });
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      if (existingPatient) {
        const finalRelationship = familyRelationship === "Other" ? customFamilyRelationship.trim() || "Other" : familyRelationship;
        try {
          const linkRes = await linkFamilyMember(existingPatient.id, patient.id, finalRelationship);
          if (!linkRes.success) toast.warning("Registration ho gaya, par family group link nahi ho saka: " + linkRes.error);
        } catch (e: any) {
          console.error("Family link failed:", e?.message ?? e);
          toast.warning("Registration ho gaya, par family group link nahi ho saka");
        }
      }
      // Guard now also lives inside autoConvertMatchingLead itself (Phase
      // 1 #6) — passing the country code here so it's checked regardless
      // of what future callers remember to do.
      autoConvertMatchingLead(patient.id, patient.mobile, effectiveCountryCode);
      if (f.consent) {
        const todayFormatted = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        const waRes = await sendWhatsApp({
          campaignName: "REGISTRATION_CONFIRM",
          destination: patientWhatsAppTarget(patient),
          userName: f.name.trim(),
          templateParams: [f.name.trim(), todayFormatted],
          patientId: patient.id,
        });
        // Registration itself already succeeded (patient/visit created) —
        // this is a separate, lower-urgency notice so reception knows to
        // manually follow up if the confirmation message didn't go out,
        // not a reason to treat the registration as failed.
        if (!waRes.success) toast.warning("Registration ho gaya, par WhatsApp confirmation nahi bheja ja saka");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Registration fail hui");
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    const first = saved.name.split(" ")[0];
    return (
      <MobileShell title="Registration Successful" showBack>
        <div className="mt-2 flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-success grid place-items-center shadow-lg">
            <CheckCircle2 className="h-9 w-9 text-success-foreground" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-primary">Welcome, {first}!</h2>
          <p className="text-sm text-muted-foreground">Registered at YHC Jaipur</p>

          <div className="mt-5 w-full grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-primary text-primary-foreground p-4">
              <div className="text-[10px] uppercase opacity-70">Token</div>
              <div className="text-3xl font-black">{saved.token}</div>
            </div>
            <div className="rounded-xl bg-surface border border-border p-4">
              <div className="text-[10px] uppercase text-muted-foreground">Patient ID</div>
              <div className="text-lg font-bold text-primary">{saved.code}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Branch: {branchLabel(saved.branch)}
              </div>
            </div>
          </div>

          {saved.paymentCollected ? (
            <div className="mt-4 w-full rounded-xl bg-success/15 border border-success/40 p-3 text-success text-sm font-bold flex items-center justify-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> ₹{saved.paymentAmount.toLocaleString("en-IN")} Payment Collected
            </div>
          ) : (
            <button
              onClick={() => navigate({ to: "/pay/$id", params: { id: saved.visitId } })}
              className="mt-4 w-full rounded-xl bg-accent text-accent-foreground py-3 text-sm font-bold"
            >
              Payment Collect Karo
            </button>
          )}
          <Link
            to="/pay/$id"
            params={{ id: saved.visitId }}
            className="mt-2 block w-full text-center text-[11px] font-semibold text-muted-foreground underline"
          >
            {saved.paymentCollected ? "Amount galat hai? Change karo" : "Split ya partial payment karna hai? Pay screen kholo"}
          </Link>

          <div className="mt-3 w-full grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setSaved(null);
                setF({
                  name: "", mobile: "", countryCode: "+91", countryCodeCustom: "",
                  waSameAsMobile: true, waNumber: "", waCountryCode: "+91", waCountryCodeCustom: "",
                  age: "", gender: "", blood: "",
                  address: "", city: "Jaipur", pincode: "", chief: "",
                  dob: "", anniversary: "", profession: "", annualIncome: "",
                  branch: "", consent: true, caseChannel: "WALK_IN", leadSource: "Walk-in",
                });
                setDupWarn(false);
                setExistingPatient(null);
                setPlanMonths(1);
                setPaymentAmount("");
                setPaymentAmountTouched(false);
                setPaymentMode("CASH");
                setPaymentIdempotencyKey(crypto.randomUUID());
              }}
              className="rounded-lg border border-border bg-surface py-2.5 text-sm font-semibold text-primary"
            >
              Register Another
            </button>
            <button
              onClick={() => navigate({ to: "/", replace: true })}
              className="rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-semibold"
            >
              View Queue
            </button>
          </div>
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell title="New Patient Registration" subtitle="Reception" showBack>
      <form onSubmit={submit} className="space-y-5">
        <Section label="Full Name *">
          <Field placeholder="e.g. Ramesh Sharma" value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Section>

        <Section label="Mobile Number *" hint={dupWarn ? "⚠ Yeh number pehle se ek patient ke naam hai — neeche dekho." : isIndia ? "10 digits" : "Country code chunkar number likho"}>
          <div className="flex gap-2">
            <select
              value={f.countryCode}
              onChange={(e) => { set("countryCode", e.target.value as typeof f.countryCode); set("mobile", ""); setDupWarn(false); }}
              className="w-[92px] shrink-0 rounded-lg bg-surface border border-input px-1.5 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {countryCodes.map((c) => <option key={c.code} value={c.code}>{c.code === "other" ? "Other" : c.code}</option>)}
            </select>
            <Field
              inputMode="numeric"
              placeholder={isIndia ? "98XXXXXXXX" : "Local number"}
              value={f.mobile}
              onChange={(e) => onMobileChange(e.target.value)}
              className={cn("flex-1", dupWarn ? "border-destructive" : "")}
            />
          </div>
          {f.countryCode === "other" && (
            <Field
              placeholder="e.g. +65"
              value={f.countryCodeCustom}
              onChange={(e) => set("countryCodeCustom", e.target.value.replace(/[^\d+]/g, ""))}
              className="mt-2"
            />
          )}
        </Section>

        {existingPatient && (
          <div className="rounded-xl bg-accent/15 border border-accent p-3">
            <p className="text-xs font-semibold text-primary">
              {existingPatient.name} is number se already registered hai ({existingPatient.patient_code ?? "—"})
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Agar {existingPatient.name} khud aaye hain to inko check-in karo. Agar koi aur hai — family member jo isi
              number use karta hai — to bas neeche form bharte raho, naya register ho jayega aur dono ka family group
              bhi yahin ban jayega.
            </p>
            <button
              type="button"
              onClick={checkInInstead}
              disabled={checkInBusy}
              className="mt-2 w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-xs font-bold disabled:opacity-60"
            >
              {checkInBusy ? "Checking in…" : `${existingPatient.name} ko Check-In karo`}
            </button>

            <div className="mt-3 pt-3 border-t border-accent/40">
              <p className="text-[11px] font-semibold text-primary mb-1.5">
                Ya, {existingPatient.name} ke family member ka naya registration ho raha hai — relation batao:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {RELATIONSHIPS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setFamilyRelationship(r)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold border",
                      familyRelationship === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-surface border-border text-muted-foreground",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {familyRelationship === "Other" && (
                <Field
                  value={customFamilyRelationship}
                  onChange={(e) => setCustomFamilyRelationship(e.target.value)}
                  placeholder="Relation likho (e.g. Bahnoi, Sasural)"
                  className="mt-2"
                />
              )}
            </div>
          </div>
        )}

        <Section label="WhatsApp Number">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={f.waSameAsMobile}
              onChange={(e) => set("waSameAsMobile", e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Mobile jaisa hi hai
          </label>
          {!f.waSameAsMobile && (
            <div className="mt-2 flex gap-2">
              <select
                value={f.waCountryCode}
                onChange={(e) => set("waCountryCode", e.target.value as typeof f.waCountryCode)}
                className="w-[92px] shrink-0 rounded-lg bg-surface border border-input px-1.5 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {countryCodes.map((c) => <option key={c.code} value={c.code}>{c.code === "other" ? "Other" : c.code}</option>)}
              </select>
              <Field
                inputMode="numeric"
                placeholder="WhatsApp number"
                value={f.waNumber}
                onChange={(e) => {
                  const maxLen = effectiveWaCountryCode === "+91" ? 10 : 15;
                  set("waNumber", e.target.value.replace(/\D/g, "").slice(0, maxLen));
                }}
                className="flex-1"
              />
            </div>
          )}
          {!f.waSameAsMobile && f.waCountryCode === "other" && (
            <Field
              placeholder="e.g. +65"
              value={f.waCountryCodeCustom}
              onChange={(e) => set("waCountryCodeCustom", e.target.value.replace(/[^\d+]/g, ""))}
              className="mt-2"
            />
          )}
        </Section>

        <div className="grid grid-cols-2 gap-3">
          <Section label="Age *">
            <Field inputMode="numeric" placeholder="e.g. 32" value={f.age} onChange={(e) => set("age", e.target.value.replace(/\D/g, ""))} />
          </Section>
          <Section label="Blood Group">
            <select
              value={f.blood}
              onChange={(e) => set("blood", e.target.value as typeof f.blood)}
              className="w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select</option>
              {blood.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Section>
        </div>

        <Section label="Gender *">
          <ChipSelect options={genders} value={f.gender} onChange={(v) => set("gender", v)} />
        </Section>

        <Section label="Full Address">
          <textarea
            rows={2}
            placeholder="House / street / area"
            value={f.address}
            onChange={(e) => set("address", e.target.value)}
            className="w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Section>

        <div className="grid grid-cols-2 gap-3">
          <Section label="City">
            <Field placeholder="Jaipur" value={f.city} onChange={(e) => set("city", e.target.value)} />
          </Section>
          <Section label="Pincode">
            <Field inputMode="numeric" placeholder="302001" value={f.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </Section>
        </div>

        <Section label="Chief Complaint">
          <Field placeholder="e.g. Joint pain, migraine" value={f.chief} onChange={(e) => set("chief", e.target.value)} />
        </Section>

        <Section label="Payment" hint={planMonths > 1 ? `${planMonths} Month Plan — ${fees[feeKind].toLocaleString("en-IN")} x ${planMonths}` : undefined}>
          <div className="flex gap-1.5 mb-2">
            {[1, 3, 6].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pickPlan(m)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[11px] font-semibold border",
                  planMonths === m ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                )}
              >
                {m === 1 ? "1 Month" : `${m} Month Plan`}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              placeholder="Amount"
              value={paymentAmount}
              onChange={(e) => { setPaymentAmount(e.target.value.replace(/\D/g, "")); setPaymentAmountTouched(true); }}
              className="flex-1 min-w-0 rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
            />
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              className="w-28 shrink-0 rounded-lg bg-surface border border-input px-2 py-2.5 text-sm"
            >
              {paymentModes.length === 0 && <option value="CASH">Cash</option>}
              {paymentModes.map((m) => (
                <option key={m.code} value={m.code}>{m.label}</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Payment abhi collect ho jayega registration ke saath. Khaali chhodo agar abhi collect nahi karna — baad mein Pay screen se ho jayega.
          </p>
        </Section>

        <Section label="Date of Birth">
          <DMYDateField value={f.dob} onChange={(v) => set("dob", v)} />
        </Section>
        <Section label="Anniversary">
          <DMYDateField value={f.anniversary} onChange={(v) => set("anniversary", v)} />
        </Section>

        <div className="grid grid-cols-2 gap-3">
          <Section label="Profession">
            <Field placeholder="e.g. Teacher, Business" value={f.profession} onChange={(e) => set("profession", e.target.value)} />
          </Section>
          <Section label="Annual Income (₹)">
            <Field inputMode="numeric" placeholder="e.g. 600000" value={f.annualIncome} onChange={(e) => set("annualIncome", e.target.value.replace(/\D/g, ""))} />
          </Section>
        </div>

        <Section label="Branch *">
          <div className="flex flex-wrap gap-2">
            {branchOpts.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => set("branch", b.key)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold border transition",
                  f.branch === b.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-surface text-foreground border-border",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </Section>

        <Section label="Case Type *">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => set("caseChannel", "WALK_IN")}
              className={cn(
                "flex-1 rounded-xl px-3.5 py-2.5 text-xs font-semibold border transition",
                f.caseChannel === "WALK_IN"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-surface text-foreground border-border",
              )}
            >
              Walk-in (Clinic)
              <div className="text-[10px] font-normal opacity-80 mt-0.5">₹1000 registration</div>
            </button>
            <button
              type="button"
              onClick={() => set("caseChannel", "ONLINE")}
              className={cn(
                "flex-1 rounded-xl px-3.5 py-2.5 text-xs font-semibold border transition",
                f.caseChannel === "ONLINE"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-surface text-foreground border-border",
              )}
            >
              Online (Courier)
              <div className="text-[10px] font-normal opacity-80 mt-0.5">₹3700 upfront</div>
            </button>
          </div>
        </Section>

        <Section label="Kaha se aaye? (Source)" hint="Isse pata chalta hai kaunsa source asli patients de raha hai.">
          <div className="flex flex-wrap gap-2">
            {LEAD_SOURCES.map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => set("leadSource", src)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold border transition",
                  f.leadSource === src
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-surface text-foreground border-border",
                )}
              >
                {src}
              </button>
            ))}
          </div>
        </Section>

        <div className="flex items-center justify-between rounded-xl bg-surface border border-border p-3">
          <div className="min-w-0 pr-3">
            <p className="text-sm font-semibold text-primary">WhatsApp Consent *</p>
            <p className="text-[11px] text-muted-foreground">Updates & reminders on WhatsApp</p>
          </div>
          <button
            type="button"
            onClick={() => set("consent", !f.consent)}
            className={cn(
              "shrink-0 h-7 w-12 rounded-full border transition-colors relative",
              f.consent ? "bg-success border-success" : "bg-muted border-border",
            )}
            aria-pressed={f.consent}
          >
            <span
              className={cn(
                "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all",
                f.consent ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-success text-success-foreground py-3.5 text-sm font-bold shadow-md active:scale-[0.99] transition disabled:opacity-60"
        >
          {busy ? "Saving…" : "Register & Generate Token"}
        </button>
      </form>
    </MobileShell>
  );
}
