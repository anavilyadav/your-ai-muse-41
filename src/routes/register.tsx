import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate } from "@/components/yhc/AuthGate";
import { ChipSelect } from "@/components/yhc/ChipSelect";
import { createPatientWithVisit, isDuplicateMobile, patientWhatsAppTarget } from "@/lib/db";
import { sendWhatsApp } from "@/lib/whatsapp";
import { useQueryClient } from "@tanstack/react-query";
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
const branchOpts = [
  { key: "BAJAJ_NAGAR", label: "Bajaj Nagar" },
  { key: "JAGATPURA", label: "Jagatpura" },
] as const;
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
  const [saved, setSaved] = useState<{ token: string; code: string; branch: string; name: string } | null>(null);

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
    branch: "" as "" | "BAJAJ_NAGAR" | "JAGATPURA",
    consent: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  // "other" resolves to whatever the user typed in the custom box; every
  // other option already has the code baked into its own value.
  const effectiveCountryCode = f.countryCode === "other" ? f.countryCodeCustom.trim() || "+" : f.countryCode;
  const effectiveWaCountryCode = f.waCountryCode === "other" ? f.waCountryCodeCustom.trim() || "+" : f.waCountryCode;
  const isIndia = effectiveCountryCode === "+91";

  const [dupWarn, setDupWarn] = useState(false);
  const [busy, setBusy] = useState(false);

  const onMobileChange = async (v: string) => {
    const maxLen = isIndia ? 10 : 15;
    const digits = v.replace(/\D/g, "").slice(0, maxLen);
    set("mobile", digits);
    const minLen = isIndia ? 10 : 4;
    if (digits.length >= minLen) {
      setDupWarn(await isDuplicateMobile(digits, effectiveCountryCode));
    } else {
      setDupWarn(false);
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
    if (await isDuplicateMobile(f.mobile, effectiveCountryCode)) {
      toast.error("Yeh mobile already registered hai.");
      return;
    }
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
        primary_disease: f.chief.trim() || undefined,
        wa_consent: f.consent,
        branch: f.branch as "BAJAJ_NAGAR" | "JAGATPURA",
        chief_complaint: f.chief.trim() || undefined,
      });
      setSaved({
        token: visit.token_number ?? "T-01",
        code: patient.patient_code ?? "YHC-—",
        branch: patient.branch,
        name: patient.name,
      });
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      if (f.consent) {
        const todayFormatted = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        sendWhatsApp({
          campaignName: "REGISTRATION_CONFIRM",
          destination: patientWhatsAppTarget(patient),
          userName: f.name.trim(),
          templateParams: [f.name.trim(), todayFormatted],
        });
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
                Branch: {saved.branch === "BAJAJ_NAGAR" ? "Bajaj Nagar" : "Jagatpura"}
              </div>
            </div>
          </div>

          <div className="mt-5 w-full rounded-xl bg-[#DCF8C6] border border-success/30 p-3 text-left">
            <div className="flex items-center gap-2 text-success text-xs font-semibold">
              <MessageCircle className="h-4 w-4" /> WhatsApp (simulated)
            </div>
            <p className="mt-1.5 text-sm text-foreground leading-snug">
              Namaste {first} ji! Aapka token <b>{saved.token}</b> confirm hua. Dr. Yadav OPD chal raha hai. — YHC 🌿
            </p>
          </div>

          <div className="mt-6 w-full grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setSaved(null);
                setF({
                  name: "", mobile: "", countryCode: "+91", countryCodeCustom: "",
                  waSameAsMobile: true, waNumber: "", waCountryCode: "+91", waCountryCodeCustom: "",
                  age: "", gender: "", blood: "",
                  address: "", city: "Jaipur", pincode: "", chief: "", branch: "", consent: true,
                });
                setDupWarn(false);
              }}
              className="rounded-lg border border-border bg-surface py-2.5 text-sm font-semibold text-primary"
            >
              Register Another
            </button>
            <button
              onClick={() => navigate({ to: "/" })}
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

        <Section label="Mobile Number *" hint={dupWarn ? "⚠ Duplicate — pehle se registered hai." : isIndia ? "10 digits" : "Country code chunkar number likho"}>
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
