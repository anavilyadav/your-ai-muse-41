import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, RotateCw, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { today } from "@/lib/supabase";
import { rotateImageFile } from "@/lib/image-rotate";
import { ScanCropModal } from "@/components/yhc/ScanCropModal";
import { DOC_KIND_WORD, DOC_TYPES, DOC_TYPE_LABEL, fetchDocNamePreview, uploadPatientDocument, type DocType } from "@/lib/db";

const ddmmyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

// Multi-photo batch upload (25 Sep 2026, Dr. Yadav: "staff ek saath baith
// kr purani files ko upload karta jaye, taaki mere liye aasani ho") —
// digitizing old physical case files one photo at a time (open modal →
// pick → crop → upload → repeat) was the bottleneck. Staff now picks
// every page/photo for one patient in a single tap (native multi-select),
// crops each in sequence (same crop step as before, just queued), then
// uploads the whole batch under one shared Type + note in one go.
// Shared with the Appointments list (21 Nov 2026) so the case paper of a
// booked patient can go in before the day of the visit.
// 21 Nov 2026 (Dr. Yadav): papers are uploaded at every visit, 20–25 at a
// time — every one carries the paper's date and gets a name like
// "B-42-78 21/11/26 FOLLOW-UP (1)", (2) … — each kind (case paper, recase,
// follow-up, payment, report) numbered on its own by the database, never
// repeated; cropping each page is optional so a big batch goes in quickly.
export function UploadDocumentModal({
  patientId,
  onClose,
  onUploaded,
  initialType = "Follow-up Notes",
}: {
  patientId: string;
  onClose: () => void;
  onUploaded: () => void;
  initialType?: DocType;
}) {
  const { user } = useAuth();
  const [docType, setDocType] = useState<DocType>(initialType);
  const [note, setNote] = useState("");
  const [paperDate, setPaperDate] = useState(() => today());
  const [cropEach, setCropEach] = useState(true);
  const [saving, setSaving] = useState(false);
  const preview = useQuery({
    queryKey: ["doc-name-preview", patientId, paperDate, docType],
    queryFn: () => fetchDocNamePreview(patientId, paperDate, docType),
    enabled: !!paperDate,
  });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Not-yet-cropped files waiting their turn, and already-cropped files
  // ready to upload — `total` is fixed at selection time so "Photo 2/5"
  // stays correct even as items move from one list to the other.
  const [queue, setQueue] = useState<File[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [ready, setReady] = useState<{ file: File; preview: string }[]>([]);

  const pickFiles = (files: File[]) => {
    const tooBig = files.filter((f) => f.size > 25 * 1024 * 1024);
    const ok = files.filter((f) => f.size <= 25 * 1024 * 1024);
    if (tooBig.length > 0) {
      toast.error(`${tooBig.length} photo(s) 25MB se badi hai — skip ho gayi`);
    }
    if (ok.length === 0) return;
    if (!cropEach) {
      // straight to the list, in the order picked — that order becomes (1), (2) …
      setReady((r) => [...r, ...ok.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
      setQueueTotal(ok.length + ready.length);
      return;
    }
    setQueueTotal(ok.length + ready.length);
    setQueue((q) => [...q, ...ok]);
  };

  // Case files (Lab Report, Prescription, etc.) are almost always a paper
  // document — each one in the queue still goes through the crop/scan
  // step so the table/background around the paper doesn't end up in the
  // upload, just one after another instead of re-opening this modal.
  const scanning = queue[0] ?? null;
  const scanIndexLabel = scanning ? `Photo ${queueTotal - queue.length + 1}/${queueTotal} — Kinaare adjust karo` : undefined;

  const acceptScanned = (f: File) => {
    setReady((r) => [...r, { file: f, preview: URL.createObjectURL(f) }]);
    setQueue((q) => q.slice(1));
  };
  const skipScanning = () => {
    setQueueTotal((t) => Math.max(0, t - 1));
    setQueue((q) => q.slice(1));
  };
  // a quarter turn per tap, for pages photographed sideways or upside down
  const [turningIdx, setTurningIdx] = useState<number | null>(null);
  const rotateReady = async (idx: number) => {
    const item = ready[idx];
    if (!item) return;
    setTurningIdx(idx);
    try {
      const turned = await rotateImageFile(item.file);
      setReady((r) => r.map((x, i) => (i === idx ? { file: turned, preview: URL.createObjectURL(turned) } : x)));
    } catch {
      toast.error("Photo ghum nahi payi");
    } finally {
      setTurningIdx(null);
    }
  };
  const removeReady = (idx: number) => {
    setReady((r) => r.filter((_, i) => i !== idx));
    setQueueTotal((t) => Math.max(0, t - 1));
  };

  const submit = async () => {
    if (ready.length === 0) { toast.error("Kam se kam ek photo chuno"); return; }
    if (!paperDate) { toast.error("Paper ki tareekh chuno"); return; }
    setSaving(true);
    setProgress({ done: 0, total: ready.length });
    let uploaded = 0;
    const failed: string[] = [];
    const names: string[] = [];
    // one after another, so the numbers follow the order on screen
    for (let i = 0; i < ready.length; i++) {
      const res = await uploadPatientDocument(patientId, docType, ready[i].file, note, user?.name, paperDate);
      if (res.success) { uploaded++; if (res.title) names.push(res.title); }
      else failed.push(`Photo ${i + 1}: ${res.error}`);
      setProgress({ done: i + 1, total: ready.length });
    }
    setSaving(false);
    const span = names.length > 1 ? `${names[0]} se ${names[names.length - 1]} tak` : names[0] ?? "";
    if (failed.length > 0) {
      toast.warning(`${uploaded} photo(s) upload ho gayi${span ? ` (${span})` : ""}, ${failed.length} fail hui — dobara try karo`);
    } else {
      toast.success(`${uploaded} photo${uploaded === 1 ? "" : "s"} upload ho gayi${span ? ` — ${span}` : ""}`);
    }
    onUploaded();
    if (failed.length === 0) onClose();
  };

  if (scanning) {
    return (
      <ScanCropModal
        file={scanning}
        title={scanIndexLabel}
        onCancel={skipScanning}
        onConfirm={acceptScanned}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Upload Document{ready.length > 1 ? "s" : ""}</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Type (sab photos ke liye)</label>
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
                  {DOC_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="doc-paper-date" className="text-[11px] font-bold text-muted-foreground uppercase">Paper ki tareekh (visit ki)</label>
            <input
              id="doc-paper-date"
              type="date"
              value={paperDate}
              max={today()}
              onChange={(e) => setPaperDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
            {paperDate && preview.data && (
              <div className="mt-1.5 rounded-lg bg-primary/5 border border-primary/20 px-2.5 py-1.5 text-[11.5px] text-primary">
                Naam aise banenge: <b>{preview.data.card} {ddmmyy(paperDate)} {DOC_KIND_WORD[docType]} ({preview.data.nextSeq})</b>
                {ready.length > 1 && <> se <b>({preview.data.nextSeq + ready.length - 1})</b> tak</>}
                {preview.data.nextSeq > 1 && <span className="text-muted-foreground"> — is din ke {preview.data.nextSeq - 1} {DOC_TYPE_LABEL[docType]} pehle se hain</span>}
              </div>
            )}
          </div>

          {ready.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              Ulti ya tedhi photo ko <RotateCw className="inline h-3 w-3" /> dabakar seedha karo — har tap par 90° ghumti hai.
            </div>
          )}
          {ready.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ready.map((r, i) => (
                <div key={i} className="relative">
                  <img src={r.preview} alt={`Photo ${i + 1}`} className={"h-20 w-20 rounded-lg border border-border object-contain bg-muted" + (turningIdx === i ? " opacity-40" : "")} />
                  <button
                    type="button"
                    onClick={() => void rotateReady(i)}
                    disabled={turningIdx !== null}
                    aria-label={`Photo ${i + 1} ghumao`}
                    className="absolute bottom-0.5 right-0.5 h-6 w-6 grid place-items-center rounded-full bg-primary text-primary-foreground shadow disabled:opacity-50"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                  {preview.data && (
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] font-bold text-white">({preview.data.nextSeq + i})</span>
                  )}
                  <button
                    onClick={() => removeReady(i)}
                    aria-label="Hatao"
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 grid place-items-center rounded-full bg-destructive text-destructive-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <label className="w-full rounded-2xl border-2 border-dashed border-accent bg-accent/10 p-5 text-center flex flex-col items-center gap-2 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) pickFiles(files); e.target.value = ""; }}
            />
            <Camera className="h-7 w-7 text-primary" />
            <div className="text-sm font-bold text-primary">{ready.length > 0 ? "Aur Photos Jodo" : "Photos Chuno (ek se zyada bhi)"}</div>
            <div className="text-[11px] text-muted-foreground">Gallery se ek saath kai photo select kar sakte ho — jis kram me chunoge, usi kram me number lagenge</div>
          </label>
          <label className="flex items-start gap-2 text-[12px] font-semibold text-primary">
            <input type="checkbox" checked={cropEach} onChange={(e) => setCropEach(e.target.checked)} className="h-4 w-4 mt-0.5" />
            <span>Har photo ka kinaara adjust karna (crop) <span className="font-normal text-muted-foreground">— bahut saare paper ho to hata do, seedha jud jayenge</span></span>
          </label>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional — sab photos ke liye, e.g. date on paper)"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
          />
          {progress ? (
            <div className="rounded-xl bg-surface border border-border p-3">
              <div className="flex justify-between text-[11px] text-muted-foreground mb-1.5">
                <span>Upload ho raha hai…</span>
                <span>{progress.done} / {progress.total}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </div>
            </div>
          ) : (
            <button onClick={submit} disabled={saving || ready.length === 0} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
              {ready.length > 1 ? `${ready.length} Photos Upload Karo` : "Upload"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
