import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { ChipSelect } from "@/components/yhc/ChipSelect";
import { DOCTOR_CONFIG, getRxPatient, useDoctorSession } from "@/lib/yhc-doctor";
import { Camera, Check, FileText, Save, Sparkles, Users, Undo2, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/doctor/rx/consult/$token")({
  head: () => ({ meta: [{ title: "Consultation — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: ConsultPage,
});

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{children}</div>;
}

function ConsultPage() {
  const { token } = Route.useParams();
  const patient = getRxPatient(token);
  const session = useDoctorSession();
  const navigate = useNavigate();

  const [med, setMed] = useState("");
  const [search, setSearch] = useState("");
  const [potency, setPotency] = useState<string | "">("");
  const [doseForm, setDoseForm] = useState<string | "">("");
  const [dose, setDose] = useState(1);
  const [freq, setFreq] = useState<string | "">("");
  const [anupan, setAnupan] = useState<string | "">("");
  const [showMed2, setShowMed2] = useState(false);
  const [slx, setSlx] = useState(true);
  const [nextVisit, setNextVisit] = useState("");
  const [outcome, setOutcome] = useState<string | "">("");
  const [charges, setCharges] = useState(DOCTOR_CONFIG.defaultCharges);
  const [notes, setNotes] = useState("");
  const [hasRubrics, setHasRubrics] = useState(false);

  const suggestions = search
    ? DOCTOR_CONFIG.medicines.filter((m) => m.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : [];

  const submit = () => {
    if (!med) return toast.error("Select a medicine first");
    if (!potency) return toast.error("Select a potency");
    if (!hasRubrics) return toast.error("Rubrics photo required before submission");
    toast.success("Prescription submitted — sent to pharmacy queue");
    navigate({ to: "/doctor/rx" });
  };

  if (!patient) {
    return (
      <DoctorShell title="Consultation" showBack>
        <p className="text-sm text-muted-foreground">Patient not found in queue.</p>
      </DoctorShell>
    );
  }

  return (
    <DoctorShell title="Consultation" subtitle={session?.name} showBack>
      {/* Patient card */}
      <div className="rounded-2xl bg-primary text-primary-foreground p-4">
        <div className="flex items-center justify-between">
          <span className="font-extrabold text-base">{patient.name}</span>
          <span className="rounded-full bg-accent text-accent-foreground text-[11px] font-bold px-2.5 py-1">
            {patient.token}
          </span>
        </div>
        <div className="text-[12px] text-primary-foreground/70 mt-1">
          {patient.age}y • {patient.gender} • Visit #{patient.visit}
        </div>
        <div className="text-[12px] text-primary-foreground/70">Last Rx: {patient.lastRx}</div>
      </div>

      {/* Case summary */}
      <div className="mt-3 rounded-2xl bg-accent/25 border border-accent/40 p-3.5">
        <Label>Case Summary (from Case-DR)</Label>
        <p className="text-[13px] text-primary leading-relaxed">
          Chilly patient, thirstless. Knee stiffness worse in the mornings and cold-damp weather, better with
          continued motion. Health anxiety. Past: recurrent joint issues.
        </p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={() => toast("Case paper photo opened")}
            className="rounded-lg bg-surface border border-border py-2 text-[12px] text-muted-foreground inline-flex items-center justify-center gap-1"
          >
            <FileText className="h-3.5 w-3.5" /> Case paper
          </button>
          <button
            onClick={() => toast("All files opened (reports categorised)")}
            className="rounded-lg bg-surface border border-border py-2 text-[12px] text-muted-foreground inline-flex items-center justify-center gap-1"
          >
            <FileText className="h-3.5 w-3.5" /> All files
          </button>
        </div>
      </div>

      {/* AI actions */}
      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
        {[
          { icon: Sparkles, label: "Suggest remedy" },
          { icon: HelpCircle, label: "Ask question" },
          { icon: Users, label: "Similar cases" },
          { icon: Undo2, label: "Send back for recase", danger: true },
        ].map((a) => (
          <button
            key={a.label}
            onClick={() =>
              a.danger ? toast("Recase scheduled — patient will be notified") : toast(`AI: ${a.label}`)
            }
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold border inline-flex items-center gap-1.5",
              a.danger
                ? "bg-destructive/10 text-destructive border-destructive/40"
                : "bg-accent/20 text-primary border-accent/60",
            )}
          >
            <a.icon className="h-3.5 w-3.5" /> {a.label}
          </button>
        ))}
      </div>

      {/* Medicine 1 */}
      <div className="mt-4 rounded-2xl bg-surface border border-border p-4 space-y-4">
        <div className="font-extrabold text-[15px] text-primary">Medicine 1</div>
        <div>
          <Label>Medicine (type to search)</Label>
          <input
            value={med || search}
            onChange={(e) => { setSearch(e.target.value); setMed(""); }}
            placeholder="e.g. Rhus Tox"
            className="w-full rounded-xl bg-accent/20 px-3 py-3 text-sm text-primary outline-none focus:ring-2 focus:ring-accent"
          />
          {suggestions.length > 0 && !med && (
            <div className="mt-2 rounded-xl bg-background border border-border overflow-hidden max-h-40 overflow-y-auto">
              {suggestions.map((m) => (
                <button
                  key={m}
                  onClick={() => { setMed(m); setSearch(""); }}
                  className="w-full text-left px-3.5 py-2.5 text-sm text-primary hover:bg-accent/10 border-b border-border last:border-b-0"
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <Label>Potency</Label>
          <ChipSelect size="sm" options={DOCTOR_CONFIG.potencies} value={potency} onChange={setPotency} />
        </div>
        <div>
          <Label>Dose form</Label>
          <ChipSelect size="sm" options={DOCTOR_CONFIG.doseForms} value={doseForm} onChange={setDoseForm} />
        </div>
        <div>
          <Label>Dose (drams)</Label>
          <div className="flex items-center gap-4">
            <button onClick={() => setDose(Math.max(1, dose - 1))} className="h-10 w-10 rounded-full border border-border bg-background text-xl text-primary">−</button>
            <span className="text-xl font-extrabold text-primary min-w-[30px] text-center">{dose}</span>
            <button onClick={() => setDose(dose + 1)} className="h-10 w-10 rounded-full border border-border bg-background text-xl text-primary">+</button>
          </div>
        </div>
        <div>
          <Label>Frequency</Label>
          <ChipSelect size="sm" options={DOCTOR_CONFIG.frequencies} value={freq} onChange={setFreq} />
        </div>
        <div>
          <Label>Anupan (optional)</Label>
          <ChipSelect size="sm" options={DOCTOR_CONFIG.anupan} value={anupan} onChange={setAnupan} />
        </div>
      </div>

      {/* Medicine 2 */}
      {!showMed2 ? (
        <button
          onClick={() => setShowMed2(true)}
          className="mt-3 w-full rounded-full bg-accent/30 text-primary font-bold py-3 text-sm"
        >
          + Add another medicine
        </button>
      ) : (
        <div className="mt-3 rounded-2xl bg-surface border border-border p-4">
          <div className="font-extrabold text-[15px] text-primary mb-2.5">Medicine 2</div>
          <input placeholder="Medicine name" className="w-full rounded-xl bg-accent/20 px-3 py-3 text-sm text-primary outline-none" />
        </div>
      )}

      {/* SLX toggle */}
      <div className="mt-3 rounded-2xl bg-surface border border-border p-4 flex justify-between items-center">
        <div>
          <div className="font-bold text-primary text-sm">SLX (placebo globules)</div>
          <div className="text-[11px] text-muted-foreground">Dispense with the remedy</div>
        </div>
        <button
          onClick={() => setSlx(!slx)}
          className={cn("relative h-7 w-12 rounded-full transition", slx ? "bg-success" : "bg-border")}
          aria-pressed={slx}
        >
          <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all", slx ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>

      {/* Next visit */}
      <div className="mt-3">
        <Label>Next visit</Label>
        <select
          value={nextVisit}
          onChange={(e) => setNextVisit(e.target.value)}
          className="w-full rounded-xl bg-surface border border-border px-3 py-3 text-sm text-primary"
        >
          <option value="">Choose follow-up period</option>
          {DOCTOR_CONFIG.nextVisit.map((v) => <option key={v}>{v}</option>)}
        </select>
      </div>

      {/* Outcome */}
      <div className="mt-3">
        <Label>Outcome (previous visit)</Label>
        <ChipSelect size="sm" options={DOCTOR_CONFIG.outcomes} value={outcome} onChange={setOutcome} />
      </div>

      {/* Notes */}
      <div className="mt-3">
        <Label>Clinical notes</Label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observations, reasoning, plan…"
          rows={3}
          className="w-full rounded-xl bg-surface border border-border px-3 py-3 text-sm text-primary resize-none outline-none"
        />
      </div>

      {/* Charges */}
      <div className="mt-3">
        <Label>Charges (₹) — auto, doctor can edit</Label>
        <div className="flex items-center gap-4">
          <button onClick={() => setCharges(Math.max(0, charges - 50))} className="h-10 w-10 rounded-full border border-border bg-background text-xl text-primary">−</button>
          <span className="text-xl font-extrabold text-primary min-w-[70px] text-center">₹{charges}</span>
          <button onClick={() => setCharges(charges + 50)} className="h-10 w-10 rounded-full border border-border bg-background text-xl text-primary">+</button>
        </div>
        {Math.abs(charges - DOCTOR_CONFIG.defaultCharges) > DOCTOR_CONFIG.chargesWarnDiff && (
          <p className="text-[11px] text-destructive font-semibold mt-1.5">
            ⚠ Standard is ₹{DOCTOR_CONFIG.defaultCharges}. Difference over ₹{DOCTOR_CONFIG.chargesWarnDiff} — bypass allowed.
          </p>
        )}
      </div>

      {/* Rubrics */}
      <button
        onClick={() => setHasRubrics(true)}
        className={cn(
          "mt-3 w-full rounded-2xl p-4 text-center border-2 border-dashed",
          hasRubrics ? "bg-success/10 border-success text-success" : "bg-destructive/5 border-destructive text-destructive",
        )}
      >
        <div className="grid place-items-center mb-1">
          {hasRubrics ? <Check className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
        </div>
        <div className="text-sm font-bold">{hasRubrics ? "Rubrics photo captured" : "Rubrics photo (required)"}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {hasRubrics ? "Tap to retake" : "Click or scan — submission blocked without this"}
        </div>
      </button>

      <button
        onClick={submit}
        className="mt-4 w-full rounded-full bg-success text-success-foreground font-bold py-3.5 text-sm inline-flex items-center justify-center gap-2"
      >
        <Check className="h-4 w-4" /> Submit prescription
      </button>
      <button
        onClick={() => toast("Draft saved")}
        className="mt-2 w-full rounded-full bg-surface border border-border text-primary font-bold py-3 text-sm inline-flex items-center justify-center gap-2"
      >
        <Save className="h-4 w-4" /> Save draft
      </button>
    </DoctorShell>
  );
}
