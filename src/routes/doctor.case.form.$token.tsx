import { PatientIdChip } from "@/components/yhc/PatientIdChip";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { ChipSelect } from "@/components/yhc/ChipSelect";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchVisitForCaseDR, saveCaseNotes, uploadCasePhoto, resolveDocUrl, isDuplicateCardNumber, savePatientCardNumber } from "@/lib/db";
import { Camera, Check, Save, BookOpen, Loader2, Images, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { ScanCropModal } from "@/components/yhc/ScanCropModal";

export const Route = createFileRoute("/doctor/case/form/$token")({
  head: () => ({ meta: [{ title: "Case Taking — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["CASE_DR", "OWNER"]} permKey="caseForm">
      <CaseFormPage />
    </AuthGate>
  ),
});

type PhotoKind = "case" | "tongue" | "reports";

// One photo slot of the case form, holding several photos (30 Oct 2026 —
// the case-taking doctor: "sirf ek hi picture upload ho rahi hai"). Camera
// takes one at a time and can be tapped again to add more; Gallery picks
// several together.
function PhotoSlot({
  kind,
  title,
  hint,
  photos,
  uploading,
  onPick,
  onRemove,
  big,
}: {
  kind: PhotoKind;
  title: string;
  hint: string;
  photos: string[];
  uploading: string | null;
  onPick: (files: File[]) => void;
  onRemove: (path: string) => void;
  big?: boolean;
}) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    for (const path of photos) {
      if (thumbs[path]) continue;
      resolveDocUrl("case-photos", path).then((url) => { if (alive && url) setThumbs((t) => ({ ...t, [path]: url })); });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);
  const has = photos.length > 0;
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) onPick(files);
  };
  const btn = "flex-1 rounded-xl py-2.5 text-[12px] font-bold flex items-center justify-center gap-1.5 cursor-pointer border";
  return (
    <div className={cn("rounded-2xl border-2 border-dashed p-3", has ? "bg-success/10 border-success" : big ? "bg-surface border-accent" : "bg-accent/10 border-accent/60")}>
      <div className="flex items-center gap-2 mb-2">
        {uploading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : has ? <Check className="h-4 w-4 text-success" /> : <Camera className="h-4 w-4 text-primary" />}
        <div className={cn("text-[13px] font-bold", has ? "text-success" : "text-primary")}>
          {title}{has ? ` — ${photos.length} photo` : ""}
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground mb-2">{uploading ?? hint}</div>
      {has && (
        <div className="flex flex-wrap gap-2 mb-2">
          {photos.map((path, i) => (
            <div key={path} className="relative">
              {thumbs[path] ? (
                <img src={thumbs[path]} alt={`${title} ${i + 1}`} className="h-16 w-16 rounded-lg border border-border object-cover" />
              ) : (
                <div className="h-16 w-16 rounded-lg border border-border bg-muted grid place-items-center text-[10px] text-muted-foreground">{i + 1}</div>
              )}
              <button
                type="button"
                onClick={() => onRemove(path)}
                aria-label="Photo hatao"
                className="absolute -top-1.5 -right-1.5 h-5 w-5 grid place-items-center rounded-full bg-destructive text-destructive-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <label className={cn(btn, "bg-primary text-primary-foreground border-primary")}>
          <input id={`photo-${kind}-camera`} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
          <Camera className="h-4 w-4" /> {has ? "Aur photo" : "Camera"}
        </label>
        <label className={cn(btn, "bg-background text-primary border-primary/40")}>
          <input id={`photo-${kind}-gallery`} type="file" accept="image/*" multiple className="hidden" onChange={pick} />
          <Images className="h-4 w-4" /> Gallery (kai photo)
        </label>
      </div>
    </div>
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
  const { data: visit, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["visit", visitId],
    queryFn: () => fetchVisitForCaseDR(visitId),
  });

  const [cardSeries, setCardSeries] = useState("");
  const [cardRegister, setCardRegister] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardPrefilled, setCardPrefilled] = useState(false);
  const [dupCardWarn, setDupCardWarn] = useState(false);
  useEffect(() => {
    if (!visit || cardPrefilled) return;
    const p = visit.patient as any;
    setCardSeries(p?.card_series || "");
    // No longer defaults to the logged-in doctor's name — card_register is
    // the register NUMBER within a series (e.g. "10" in B-10-12), not who
    // took the case. Corrected 10 Aug 2026 per Dr. Yadav.
    setCardRegister(p?.card_register || "");
    setCardNumber(p?.card_number || "");
    setCardPrefilled(true);
  }, [visit, cardPrefilled]);

  const checkDupCard = async (series: string, register: string, number: string) => {
    if (series.trim() && register.trim() && number.trim()) {
      setDupCardWarn(await isDuplicateCardNumber(series, register, number, visit?.patient?.id));
    } else {
      setDupCardWarn(false);
    }
  };
  const onCardSeriesChange = (v: string) => { setCardSeries(v); checkDupCard(v, cardRegister, cardNumber); };
  const onCardRegisterChange = (v: string) => { setCardRegister(v); checkDupCard(cardSeries, v, cardNumber); };
  const onCardNumberChange = (v: string) => { setCardNumber(v); checkDupCard(cardSeries, cardRegister, v); };

  const [photos, setPhotos] = useState<Record<PhotoKind, string[]>>({ case: [], tongue: [], reports: [] });
  const [uploading, setUploading] = useState<{ kind: PhotoKind; text: string } | null>(null);
  const [pendingScan, setPendingScan] = useState<{ kind: "case" | "reports"; file: File } | null>(null);
  // A saved draft keeps its photos when the case is opened again.
  const [photosPrefilled, setPhotosPrefilled] = useState(false);
  useEffect(() => {
    if (!visit || photosPrefilled) return;
    const v = visit as any;
    const list = (many: string[] | null | undefined, one: string | null | undefined) => (many?.length ? many : one ? [one] : []);
    setPhotos({
      case: list(v.case_photo_urls, v.case_photo_url),
      tongue: list(v.tongue_photo_urls, v.tongue_photo_url),
      reports: list(v.reports_photo_urls, v.reports_photo_url),
    });
    setPhotosPrefilled(true);
  }, [visit, photosPrefilled]);
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

  // Uploads one or more photos into a slot, one after the other.
  const uploadPhotos = async (kind: PhotoKind, files: File[]) => {
    const ok = files.filter((f) => {
      // Same reasoning as the patient-documents guard: decoding a huge
      // original into a canvas can itself hang a low-end phone browser.
      if (f.size > 25 * 1024 * 1024) { toast.error(`${f.name}: 25MB se badi hai — chhoti photo lo`); return false; }
      return true;
    });
    let saved = 0;
    for (const [i, file] of ok.entries()) {
      setUploading({ kind, text: ok.length > 1 ? `Upload ho rahi hai ${i + 1} / ${ok.length}…` : "Upload ho rahi hai…" });
      const res = await uploadCasePhoto(visitId, kind, file);
      if (!res.success || !res.url) { toast.error("Photo upload nahi hui: " + res.error); continue; }
      const path = res.url;
      setPhotos((p) => ({ ...p, [kind]: [...p[kind], path] }));
      saved++;
    }
    setUploading(null);
    if (saved) toast.success(saved > 1 ? `${saved} photos save ho gayi` : "Photo save ho gayi");
  };

  // "case" and "reports" are paper documents — a single photo goes through
  // the crop step first. Several picked together upload straight away (one
  // crop screen per photo would slow the doctor down); "tongue" never crops.
  const pickPhotos = (kind: PhotoKind, files: File[]) => {
    if (kind !== "tongue" && files.length === 1) { setPendingScan({ kind, file: files[0] }); return; }
    void uploadPhotos(kind, files);
  };
  const removePhoto = (kind: PhotoKind, path: string) =>
    setPhotos((p) => ({ ...p, [kind]: p[kind].filter((x) => x !== path) }));

  // One source of truth for the case text — submit(), saveDraft() and the
  // unsaved-changes guard all have to agree on exactly what "the case" is.
  const notesText = [
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

  // TASK 3 — a case sheet is 10+ minutes of typing on a phone; one stray
  // back-swipe used to wipe it silently. Snapshot = everything a save would
  // persist, compared against whatever was last actually written to the DB.
  const snapshot = [notesText, photos.case.join(","), photos.tongue.join(","), photos.reports.join(",")].join("|");
  const [savedSnapshot, setSavedSnapshot] = useState<string>("|||");
  const [submitted, setSubmitted] = useState(false);
  const isDirty = !submitted && snapshot !== savedSnapshot;
  useUnsavedChanges(isDirty, "Case abhi save nahi hua. Bahar jaana hai? Draft save kar lo pehle.");

  useEffect(() => {
    if (submitted) navigate({ to: "/doctor/case" });
  }, [submitted, navigate]);

  const submit = async () => {
    if (photos.case.length === 0) return toast.error("Case paper photo is required");
    if (dupCardWarn && !window.confirm("Ye card number isi register mein already kisi aur patient ke paas hai. Phir bhi save karein?")) return;
    if (!window.confirm("Submit case to the prescribing doctor? Cannot be edited after submit.")) return;
    const notes = notesText;
    setBusy(true);
    try {
      if (visit?.patient?.id && (cardSeries.trim() || cardRegister.trim() || cardNumber.trim())) {
        // A replaced card stays searchable (re-numbering every 7-8 years).
        await savePatientCardNumber(visit.patient.id, cardSeries, cardRegister, cardNumber, { keepOld: true });
      }
      await saveCaseNotes(visitId, {
        notes,
        case_photo_urls: photos.case,
        tongue_photo_urls: photos.tongue,
        reports_photo_urls: photos.reports,
      });
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      setSavedSnapshot(snapshot);
      // Redirect happens from the effect above, once `submitted` has
      // rendered and the unsaved-changes blocker is genuinely off.
      setSubmitted(true);
      toast.success("Case submitted — moved to prescriber's queue");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to submit");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    const notes = notesText;
    setBusy(true);
    try {
      // The card number is saved with a draft too — it must not wait for the
      // whole case to be submitted.
      if (visit?.patient?.id && (cardSeries.trim() || cardRegister.trim() || cardNumber.trim())) {
        await savePatientCardNumber(visit.patient.id, cardSeries, cardRegister, cardNumber, { keepOld: true });
        qc.invalidateQueries({ queryKey: ["today-queue"] });
      }
      await saveCaseNotes(visitId, {
        notes,
        draft: true,
        case_photo_urls: photos.case,
        tongue_photo_urls: photos.tongue,
        reports_photo_urls: photos.reports,
      });
      setSavedSnapshot(snapshot);
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
  // Was showing "Case not found" for both a genuine not-found AND a
  // network/server error — the second one told the doctor to give up on
  // a real case that just had a fetch hiccup, instead of retrying.
  if (isError) {
    return (
      <DoctorShell title="Case Taking" showBack>
        <p className="text-sm text-muted-foreground">
          Case load nahi hua — connection check karo.
          <span className="block text-[11px] mt-1 opacity-70">{(error as any)?.message ?? ""}</span>
        </p>
        <button onClick={() => refetch()} className="mt-3 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold">
          Dobara try karo
        </button>
      </DoctorShell>
    );
  }
  if (!visit) {
    return (
      <DoctorShell title="Case Taking" showBack>
        <p className="text-sm text-muted-foreground">Case not found on your board.</p>
      </DoctorShell>
    );
  }

  const p = visit.patient;

  if (pendingScan) {
    return (
      <ScanCropModal
        file={pendingScan.file}
        onCancel={() => setPendingScan(null)}
        onConfirm={(cropped) => { const kind = pendingScan.kind; setPendingScan(null); void uploadPhotos(kind, [cropped]); }}
      />
    );
  }

  return (
    <DoctorShell title="Case Taking" subtitle={`${visit.token_number ?? "—"} • Contact hidden`} showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 text-center">
        <span className="inline-block rounded-full bg-accent text-accent-foreground text-[11px] font-bold px-2.5 py-1">
          {visit.token_number ?? "—"}
        </span>
        <div className="text-lg font-extrabold mt-2">{p?.name} <PatientIdChip patient={p} onDark /></div>
        <div className="text-[12px] text-primary-foreground/70 mt-0.5">
          {p?.age ? `${p.age}y` : "—"} • {p?.gender ?? "—"}
        </div>
        <div className="text-[12px] text-primary-foreground/70">{visit.chief_complaint ?? "—"}</div>
      </div>

      <div className="mt-4 rounded-xl bg-surface border border-border p-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Card Number (aap dete ho)
        </div>
        {/* The case-taking doctor gives the card number (Dr. Yadav, 26 Oct
            2026): series are the ones he makes — A, AA, B, K. */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {["A", "AA", "B", "K"].map((sr) => (
            <button
              key={sr}
              type="button"
              onClick={() => onCardSeriesChange(cardSeries === sr ? "" : sr)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-bold border",
                cardSeries === sr ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border",
              )}
            >
              {sr}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder="Series (e.g. B)"
            value={cardSeries}
            maxLength={3}
            onChange={(e) => onCardSeriesChange(e.target.value.toUpperCase())}
            className={cn(
              "rounded-lg bg-background border px-3 py-2.5 text-sm uppercase",
              dupCardWarn ? "border-destructive" : "border-input",
            )}
          />
          <input
            placeholder="Register no."
            value={cardRegister}
            onChange={(e) => onCardRegisterChange(e.target.value)}
            className={cn(
              "rounded-lg bg-background border px-3 py-2.5 text-sm",
              dupCardWarn ? "border-destructive" : "border-input",
            )}
          />
          <input
            placeholder="Card no."
            value={cardNumber}
            onChange={(e) => onCardNumberChange(e.target.value)}
            className={cn(
              "rounded-lg bg-background border px-3 py-2.5 text-sm",
              dupCardWarn ? "border-destructive" : "border-input",
            )}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Series-Register-Card, e.g. B-10-12</p>
        {dupCardWarn && (
          <p className="text-[11px] text-destructive mt-1.5">⚠ Ye card number isi series/register mein kisi aur patient ke paas hai</p>
        )}
      </div>

      <div className="mt-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        1 — Case paper photo (primary)
      </div>
      <PhotoSlot
        kind="case"
        title="Case paper"
        hint="Required — kai page ho to sab ki photo lo. Camera se ek-ek, ya Gallery se ek saath."
        photos={photos.case}
        uploading={uploading?.kind === "case" ? uploading.text : null}
        onPick={(f) => pickPhotos("case", f)}
        onRemove={(path) => removePhoto("case", path)}
        big
      />

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
        <div className="grid gap-2 sm:grid-cols-2">
          <PhotoSlot
            kind="tongue"
            title="👅 Tongue photo"
            hint="Optional"
            photos={photos.tongue}
            uploading={uploading?.kind === "tongue" ? uploading.text : null}
            onPick={(f) => pickPhotos("tongue", f)}
            onRemove={(path) => removePhoto("tongue", path)}
          />
          <PhotoSlot
            kind="reports"
            title="📋 Reports"
            hint="Optional — saari reports ki photo ek saath"
            photos={photos.reports}
            uploading={uploading?.kind === "reports" ? uploading.text : null}
            onPick={(f) => pickPhotos("reports", f)}
            onRemove={(path) => removePhoto("reports", path)}
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
