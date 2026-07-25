import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { ChipSelect } from "@/components/yhc/ChipSelect";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchVisitForCaseDR, saveCaseNotes, uploadCasePhoto } from "@/lib/db";
import { Camera, Check, Save, BookOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/doctor/case/form/$token")({
  head: () => ({ meta: [{ title: "Case Taking — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["CASE_DR", "OWNER"]}>
      <CaseFormPage />
    </AuthGate>
  ),
});

function PhotoCapture({
  label,
  icon,
  url,
  uploading,
  onPick,
  required,
}: {
  label: string;
  icon: React.ReactNode;
  url: string | null;
  uploading: boolean;
  onPick: (file: File) => void;
  required?: boolean;
}) {
  const inputId = `photo-${label.replace(/\s+/g, "-")}`;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "rounded-xl text-[12px] font-semibold py-2.5 flex flex-col items-center justify-center gap-1 cursor-pointer",
        url ? "bg-success/15 text-success" : "bg-accent/20 text-primary",
      )}
    >
      <input
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
      />
      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : url ? <Check className="h-4 w-4" /> : icon}
      {uploading ? "Uploading…" : url ? `${label} ✓` : `${label}${required ? " *" : ""}`}
    </label>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        {n} — {title}
      </div>
      <div className="rounded-2xl bg-surface border border-border p-4 space-y-3.5">{children}</div>
    </div>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{children}</div>;
}
function Multi({ options, sel, setSel }: { options: string[]; sel: string[]; setSel: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = sel.includes(o);
        return (
          <button
            key={o}
            onClick={() => setSel(on ? sel.filter((x) => x !== o) : [...sel, o])}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium border transition",
              on ? "bg-primary text-primary-foreground border-primary" : "bg-background text-primary border-border",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function CaseFormPage() {
  const { token: visitId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: visit, isLoading } = useQuery({
    queryKey: ["visit", visitId],
    queryFn: () => fetchVisitForCaseDR(visitId),
  });

  const [casePhotoUrl, setCasePhotoUrl] = useState<string | null>(null);
  const [tonguePhotoUrl, setTonguePhotoUrl] = useState<string | null>(null);
  const [reportsPhotoUrl, setReportsPhotoUrl] = useState<string | null>(null);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const [thermals, setThermals] = useState<string | "">("");
  const [thirst, setThirst] = useState<string | "">("");
  const [sleep, setSleep] = useState<string | "">("");
  const [appetite, setAppetite] = useState<string | "">("");
  const [sweat, setSweat] = useState<string | "">("");
  const [mentals, setMentals] = useState<string[]>([]);
  const [worse, setWorse] = useState<string[]>([]);
  const [better, setBetter] = useState<string[]>([]);
  const [detail, setDetail] = useState("");
  const [past, setPast] = useState("");
  const [flag, setFlag] = useState("");
  const [busy, setBusy] = useState(false);

  const handlePhoto = async (kind: "case" | "tongue" | "reports", file: File) => {
    setUploadingKind(kind);
    const res = await uploadCasePhoto(visitId, kind, file);
    setUploadingKind(null);
    if (!res.success) {
      toast.error("Photo upload nahi hui: " + res.error);
      return;
    }
    if (kind === "case") setCasePhotoUrl(res.url);
    if (kind === "tongue") setTonguePhotoUrl(res.url);
    if (kind === "reports") setReportsPhotoUrl(res.url);
    toast.success("Photo save ho gayi");
  };

  const submit = async () => {
    if (!casePhotoUrl) return toast.error("Case paper photo is required");
    if (!window.confirm("Submit case to the prescribing doctor? Cannot be edited after submit.")) return;
    const notes = [
      thermals && `Thermals: ${thermals}`,
      thirst && `Thirst: ${thirst}`,
      sleep && `Sleep: ${sleep}`,
      appetite && `Appetite: ${appetite}`,
      sweat && `Sweat: ${sweat}`,
      mentals.length && `Mentals: ${mentals.join(", ")}`,
      worse.length && `Worse: ${worse.join(", ")}`,
      better.length && `Better: ${better.join(", ")}`,
      detail && `Detail: ${detail}`,
      past && `Past history: ${past}`,
      flag && `Flag to Rx: ${flag}`,
    ].filter(Boolean).join("\n");
    setBusy(true);
    try {
      await saveCaseNotes(visitId, {
        notes,
        case_photo_url: casePhotoUrl,
        tongue_photo_url: tonguePhotoUrl,
        reports_photo_url: reportsPhotoUrl,
      });
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      toast.success("Case submitted — moved to prescriber's queue");
      navigate({ to: "/doctor/case" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to submit");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    const notes = [
      thermals && `Thermals: ${thermals}`,
      thirst && `Thirst: ${thirst}`,
      sleep && `Sleep: ${sleep}`,
      appetite && `Appetite: ${appetite}`,
      sweat && `Sweat: ${sweat}`,
      mentals.length && `Mentals: ${mentals.join(", ")}`,
      worse.length && `Worse: ${worse.join(", ")}`,
      better.length && `Better: ${better.join(", ")}`,
      detail && `Detail: ${detail}`,
      past && `Past history: ${past}`,
      flag && `Flag to Rx: ${flag}`,
    ].filter(Boolean).join("\n");
    setBusy(true);
    try {
      await saveCaseNotes(visitId, {
        notes,
        draft: true,
        case_photo_url: casePhotoUrl,
        tongue_photo_url: tonguePhotoUrl,
        reports_photo_url: reportsPhotoUrl,
      });
      toast.success("Draft saved — case abhi bhi tumhare paas hai");
    } catch (e: any) {
      toast.error(e?.message ?? "Draft save nahi hua");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <DoctorShell title="Case Taking" showBack><LoadingBlock /></DoctorShell>;
  }
  if (!visit) {
    return (
      <DoctorShell title="Case Taking" showBack>
        <p className="text-sm text-muted-foreground">Case not found on your board.</p>
      </DoctorShell>
    );
  }

  const p = visit.patient;

  return (
    <DoctorShell title="Case Taking" subtitle={`${visit.token_number ?? "—"} • Contact hidden`} showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 text-center">
        <span className="inline-block rounded-full bg-accent text-accent-foreground text-[11px] font-bold px-2.5 py-1">
          {visit.token_number ?? "—"}
        </span>
        <div className="text-lg font-extrabold mt-2">{p?.name}</div>
        <div className="text-[12px] text-primary-foreground/70 mt-0.5">
          {p?.age ? `${p.age}y` : "—"} • {p?.gender ?? "—"}
        </div>
        <div className="text-[12px] text-primary-foreground/70">{visit.chief_complaint ?? "—"}</div>
      </div>

      <div className="mt-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        1 — Case paper photo (primary)
      </div>
      <label
        htmlFor="photo-case-paper"
        className={cn(
          "w-full rounded-2xl p-6 text-center border-2 border-dashed block cursor-pointer",
          casePhotoUrl ? "bg-success/10 border-success" : "bg-surface border-accent",
        )}
      >
        <input
          id="photo-case-paper"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto("case", f); }}
        />
        <div className="grid place-items-center mb-1">
          {uploadingKind === "case" ? (
            <Loader2 className="h-7 w-7 text-primary animate-spin" />
          ) : casePhotoUrl ? (
            <Check className="h-7 w-7 text-success" />
          ) : (
            <Camera className="h-7 w-7 text-primary" />
          )}
        </div>
        <div className={cn("text-sm font-bold", casePhotoUrl ? "text-success" : "text-primary")}>
          {uploadingKind === "case" ? "Uploading…" : casePhotoUrl ? "Case paper captured" : "Scan or click the case paper"}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {casePhotoUrl ? "Tap to retake" : "Required — submission blocked without this"}
        </div>
        {casePhotoUrl && (
          <img src={casePhotoUrl} alt="Case paper" className="mt-3 mx-auto max-h-32 rounded-lg border border-border" />
        )}
      </label>

      <Section n={2} title="Generals">
        <div><Label>Thermals</Label><ChipSelect size="sm" options={["Chilly", "Hot", "Ambi-thermal"]} value={thermals} onChange={setThermals} /></div>
        <div><Label>Thirst</Label><ChipSelect size="sm" options={["Thirsty", "Thirstless", "Normal"]} value={thirst} onChange={setThirst} /></div>
        <div><Label>Sleep</Label><ChipSelect size="sm" options={["Sound", "Disturbed", "Insomnia", "Excessive"]} value={sleep} onChange={setSleep} /></div>
        <div><Label>Appetite</Label><ChipSelect size="sm" options={["Good", "Reduced", "Increased", "None"]} value={appetite} onChange={setAppetite} /></div>
        <div><Label>Sweat</Label><ChipSelect size="sm" options={["Profuse", "Scanty", "Offensive", "Normal"]} value={sweat} onChange={setSweat} /></div>
      </Section>

      <Section n={3} title="Mental generals (multi-select)">
        <Multi
          options={["Anxiety++", "Fear of dark", "Fear of heights", "Claustrophobia", "Health anxiety", "Irritable++", "Anger → headache", "Weeps easily", "Consolation agg", "Consolation amel", "Mild / Yielding", "None"]}
          sel={mentals}
          setSel={setMentals}
        />
      </Section>

      <Section n={4} title="Modalities (multi-select)">
        <div><Label>Worse from</Label><Multi options={["Cold", "Heat", "Damp", "Motion", "Rest", "Night", "Morning", "Exertion", "Pressure", "Sun"]} sel={worse} setSel={setWorse} /></div>
        <div><Label>Better from</Label><Multi options={["Cold", "Heat", "Motion", "Rest", "Open air", "Pressure", "Eating"]} sel={better} setSel={setBetter} /></div>
      </Section>

      <Section n={5} title="Particulars">
        <div>
          <Label>Chief complaint detail (in patient's words)</Label>
          <textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Onset, duration, character, location — plain language" className="w-full rounded-xl bg-accent/20 px-3 py-3 text-sm text-primary resize-none outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PhotoCapture
            label="Tongue photo"
            icon={<span>👅</span>}
            url={tonguePhotoUrl}
            uploading={uploadingKind === "tongue"}
            onPick={(f) => handlePhoto("tongue", f)}
          />
          <PhotoCapture
            label="Reports scan"
            icon={<span>📋</span>}
            url={reportsPhotoUrl}
            uploading={uploadingKind === "reports"}
            onPick={(f) => handlePhoto("reports", f)}
          />
        </div>
      </Section>

      <Section n={6} title="Notes">
        <div>
          <Label>Past history</Label>
          <textarea rows={2} value={past} onChange={(e) => setPast(e.target.value)} placeholder="Past illnesses, surgeries, family history…" className="w-full rounded-xl bg-accent/20 px-3 py-3 text-sm text-primary resize-none outline-none" />
        </div>
        <div>
          <Label>Notes for prescribing doctor</Label>
          <textarea rows={2} value={flag} onChange={(e) => setFlag(e.target.value)} placeholder="Anything important to flag…" className="w-full rounded-xl bg-accent/20 px-3 py-3 text-sm text-primary resize-none outline-none" />
        </div>
      </Section>

      <button
        onClick={() => navigate({ to: "/doctor/case/reference" })}
        className="mt-3 w-full rounded-xl bg-accent/25 text-primary text-sm font-semibold py-3 inline-flex items-center justify-center gap-2"
      >
        <BookOpen className="h-4 w-4" /> Performa reference — check if you're forgetting something
      </button>

      <button onClick={submit} disabled={busy} className="mt-4 w-full rounded-full bg-success text-success-foreground font-bold py-3.5 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
        <Check className="h-4 w-4" /> {busy ? "Submitting…" : "Send to prescribing doctor"}
      </button>
      <button onClick={saveDraft} disabled={busy} className="mt-2 w-full rounded-full bg-surface border border-border text-primary font-bold py-3 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
        <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save draft"}
      </button>
    </DoctorShell>
  );
}
