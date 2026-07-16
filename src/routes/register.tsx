import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { ChipSelect } from "@/components/yhc/ChipSelect";
import { addPatient, isDuplicateMobile, type Branch, type Patient } from "@/lib/yhc-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "New Patient Registration — YHC Jaipur" }] }),
  component: RegisterPage,
});

const genders = ["Male", "Female", "Other"] as const;
const marital = ["Single", "Married", "Divorced", "Widowed"] as const;
const blood = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", "Not Known"] as const;
const branches = ["Bajaj Nagar", "Jagatpura"] as const satisfies readonly Branch[];
const visits = ["Walk-in", "Pre-booked", "Online", "Courier"] as const;
const sources = [
  "Walk-in", "Patient Referral", "Doctor Referral", "Google",
  "Instagram", "YouTube", "JustDial", "WhatsApp", "Pamphlet",
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
  const [saved, setSaved] = useState<Patient | null>(null);

  const [f, setF] = useState({
    name: "", mobile: "", age: "", gender: "" as "" | (typeof genders)[number],
    marital: "" as "" | (typeof marital)[number],
    blood: "" as "" | (typeof blood)[number],
    birthday: "", anniversary: "",
    address: "", city: "Jaipur", pincode: "",
    chief: "", branch: "" as "" | Branch,
    visit: "" as "" | (typeof visits)[number],
    source: "" as "" | (typeof sources)[number],
    consent: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const [dupWarn, setDupWarn] = useState(false);
  const onMobileChange = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 10);
    set("mobile", digits);
    setDupWarn(digits.length === 10 && isDuplicateMobile(digits));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    if (!f.name.trim()) errs.push("Name");
    if (f.mobile.length !== 10) errs.push("10-digit Mobile");
    if (!f.age || Number(f.age) <= 0) errs.push("Age");
    if (!f.gender) errs.push("Gender");
    if (!f.branch) errs.push("Branch");
    if (!f.consent) errs.push("WhatsApp Consent");
    if (errs.length) {
      toast.error(`Missing: ${errs.join(", ")}`);
      return;
    }
    if (isDuplicateMobile(f.mobile)) {
      toast.error("This mobile is already registered.");
      return;
    }
    const p = addPatient({
      name: f.name.trim(),
      mobile: f.mobile,
      age: Number(f.age),
      gender: f.gender || "Other",
      chiefComplaint: f.chief.trim() || "—",
      branch: (f.branch || "Bajaj Nagar") as Branch,
      visitType: f.visit || "Walk-in",
      source: f.source || "Walk-in",
    });
    setSaved(p);
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
              <div className="text-lg font-bold text-primary">{saved.id}</div>
              <div className="text-[10px] text-muted-foreground mt-1">Branch: {saved.branch}</div>
            </div>
          </div>

          <div className="mt-5 w-full rounded-xl bg-[#DCF8C6] border border-success/30 p-3 text-left">
            <div className="flex items-center gap-2 text-success text-xs font-semibold">
              <MessageCircle className="h-4 w-4" /> WhatsApp sent
            </div>
            <p className="mt-1.5 text-sm text-foreground leading-snug">
              Namaste {first} ji! Aapka token <b>{saved.token}</b> confirm hua.
              Dr. Yadav OPD chal raha hai. — YHC 🌿
            </p>
          </div>

          <div className="mt-6 w-full grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setSaved(null);
                setF({
                  name: "", mobile: "", age: "", gender: "", marital: "", blood: "",
                  birthday: "", anniversary: "", address: "", city: "Jaipur", pincode: "",
                  chief: "", branch: "", visit: "", source: "", consent: true,
                });
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

        <Section label="Mobile Number *" hint={dupWarn ? "⚠ Duplicate — this mobile is already registered." : "10 digits"}>
          <Field
            inputMode="numeric"
            placeholder="98XXXXXXXX"
            value={f.mobile}
            onChange={(e) => onMobileChange(e.target.value)}
            className={dupWarn ? "border-destructive" : ""}
          />
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

        <Section label="Marital Status">
          <ChipSelect options={marital} value={f.marital} onChange={(v) => set("marital", v)} />
        </Section>

        <div className="grid grid-cols-2 gap-3">
          <Section label="Birthday (DD/MM)">
            <Field placeholder="15/08" value={f.birthday} onChange={(e) => set("birthday", e.target.value)} />
          </Section>
          <Section label="Anniversary (DD/MM)">
            <Field placeholder="20/11" value={f.anniversary} onChange={(e) => set("anniversary", e.target.value)} />
          </Section>
        </div>

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

        <Section label="Chief Complaint" hint="Reference only">
          <Field placeholder="e.g. Joint pain, migraine" value={f.chief} onChange={(e) => set("chief", e.target.value)} />
        </Section>

        <Section label="Branch *">
          <ChipSelect options={branches} value={f.branch} onChange={(v) => set("branch", v)} />
        </Section>

        <Section label="Visit Type">
          <ChipSelect options={visits} value={f.visit} onChange={(v) => set("visit", v)} />
        </Section>

        <Section label="How did you find YHC?">
          <ChipSelect options={sources} value={f.source} onChange={(v) => set("source", v)} size="sm" />
        </Section>

        <div className="flex items-center justify-between rounded-xl bg-surface border border-border p-3">
          <div className="min-w-0 pr-3">
            <p className="text-sm font-semibold text-primary">WhatsApp Consent *</p>
            <p className="text-[11px] text-muted-foreground">Send updates & reminders on WhatsApp</p>
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
          className="w-full rounded-xl bg-success text-success-foreground py-3.5 text-sm font-bold shadow-md active:scale-[0.99] transition"
        >
          Register & Generate Token
        </button>
      </form>
    </MobileShell>
  );
}
