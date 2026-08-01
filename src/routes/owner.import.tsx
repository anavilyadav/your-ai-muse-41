import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload, Undo2, CheckCircle2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { RoleShell, Badge } from "@/components/yhc/RoleShell";
import { AuthGate } from "@/components/yhc/AuthGate";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";
import {
  parseCSV,
  newImportBatchId,
  recordImportBatch,
  rollbackImportBatch,
  previewLeadsImport,
  commitLeadsImport,
  previewPatientsImport,
  commitPatientsImport,
  previewVisitHistoryImport,
  commitVisitHistoryImport,
  fetchImportBatches,
  fetchPatientsByIds,
  BRANCH_KEYS,
  branchLabel,
  type ImportLeadRow,
  type ImportPatientRow,
  type ImportVisitRow,
} from "@/lib/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/owner/import")({
  head: () => ({ meta: [{ title: "Bulk Import — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <ImportPage />
    </AuthGate>
  ),
});

type FieldDef = { key: string; label: string; required?: boolean };

const ALIASES: Record<string, string[]> = {
  name: ["name", "patient name", "full name", "patientname"],
  mobile: ["mobile", "phone", "contact", "mobile number", "phone number", "contact number", "mob"],
  age: ["age"],
  gender: ["gender", "sex"],
  city: ["city", "area", "location"],
  primary_disease: ["disease", "primary disease", "complaint", "category", "disease interest", "problem"],
  branch: ["branch", "clinic", "location"],
  source: ["source", "lead source"],
  note: ["note", "notes", "remarks", "comments"],
  visit_date: ["visit date", "date", "reg date", "registration date", "visited on"],
  chief_complaint: ["complaint", "chief complaint", "diagnosis", "notes"],
  amount_charged: ["amount charged", "fee", "total fee", "bill amount", "charged"],
  amount_received: ["amount received", "paid", "amount paid", "received"],
  payment_mode: ["payment mode", "mode", "payment type"],
};

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function guessColumn(headers: string[], field: string): number {
  const aliases = [field, ...(ALIASES[field] ?? [])].map(norm);
  for (let i = 0; i < headers.length; i++) {
    if (aliases.includes(norm(headers[i]))) return i;
  }
  return -1;
}

function useCSVImport(fields: FieldDef[]) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});

  const onFile = (file: File) => {
    // A CSV this large is almost certainly the wrong file selected by
    // mistake — FileReader would read the whole thing into memory as
    // text before parsing, which can hang the tab on a genuinely huge
    // file. 10MB is already tens of thousands of rows, far more than
    // any realistic clinic import.
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File 10MB se badi hai — sahi CSV select kiya hai?");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
      const rows = parseCSV(text);
      if (rows.length < 2) {
        toast.error("CSV mein data nahi mila (sirf header ya khaali file)");
        return;
      }
      const [head, ...rest] = rows;
      setHeaders(head);
      setDataRows(rest);
      setFileName(file.name);
      const guessed: Record<string, number> = {};
      fields.forEach((f) => { guessed[f.key] = guessColumn(head, f.key); });
      setMapping(guessed);
    };
    reader.onerror = () => toast.error("File padhne mein error aaya");
    reader.readAsText(file);
  };

  const mappedRows = useMemo(() => {
    return dataRows.map((row) => {
      const obj: Record<string, string> = {};
      fields.forEach((f) => {
        const idx = mapping[f.key];
        obj[f.key] = idx != null && idx >= 0 ? (row[idx] ?? "").trim() : "";
      });
      return obj;
    });
  }, [dataRows, mapping, fields]);

  const reset = () => { setFileName(null); setHeaders([]); setDataRows([]); setMapping({}); };

  return { fileName, headers, dataRows, mapping, setMapping, mappedRows, onFile, reset };
}

function FilePicker({ onFile, fileName }: { onFile: (f: File) => void; fileName: string | null }) {
  const id = useMemo(() => `csv-${Math.random().toString(36).slice(2)}`, []);
  return (
    <label
      htmlFor={id}
      className="w-full rounded-2xl border-2 border-dashed border-accent bg-accent/10 p-6 text-center flex flex-col items-center gap-2 cursor-pointer"
    >
      <input
        id={id}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />
      <FileSpreadsheet className="h-7 w-7 text-primary" />
      <div className="text-sm font-bold text-primary">{fileName ?? "CSV file chuno"}</div>
      <div className="text-[11px] text-muted-foreground">Tap to {fileName ? "replace" : "upload"}</div>
    </label>
  );
}

function ColumnMapper({
  fields, headers, mapping, setMapping,
}: {
  fields: FieldDef[]; headers: string[];
  mapping: Record<string, number>; setMapping: (m: Record<string, number>) => void;
}) {
  return (
    <div className="rounded-2xl bg-surface border border-border p-3.5 space-y-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Column mapping</div>
      {fields.map((f) => (
        <div key={f.key} className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-primary">
            {f.label}{f.required && <span className="text-destructive"> *</span>}
          </span>
          <select
            className="rounded-lg border border-border bg-background text-[12px] px-2 py-1.5 max-w-[55%]"
            value={mapping[f.key] ?? -1}
            onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
          >
            <option value={-1}>— skip —</option>
            {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function PreviewSummary({ valid, duplicates, invalid, extraLabel, extraCount, samples }: {
  valid: number; duplicates?: number; invalid?: number; extraLabel?: string; extraCount?: number; samples?: string[];
}) {
  return (
    <div className="rounded-2xl bg-surface border border-border p-3.5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div><div className="text-lg font-bold text-success">{valid}</div><div className="text-[10px] uppercase text-muted-foreground">Ready</div></div>
        {duplicates !== undefined && (
          <div><div className="text-lg font-bold text-accent-foreground">{duplicates}</div><div className="text-[10px] uppercase text-muted-foreground">Duplicate</div></div>
        )}
        {invalid !== undefined && (
          <div><div className="text-lg font-bold text-destructive">{invalid}</div><div className="text-[10px] uppercase text-muted-foreground">Invalid</div></div>
        )}
        {extraLabel && (
          <div><div className="text-lg font-bold text-destructive">{extraCount}</div><div className="text-[10px] uppercase text-muted-foreground">{extraLabel}</div></div>
        )}
      </div>
      {samples && samples.length > 0 && (
        <div className="mt-2.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1 font-semibold text-destructive"><AlertTriangle className="h-3 w-3" /> Sample skipped rows</div>
          {samples.map((s, i) => <div key={i} className="mt-0.5">• {s}</div>)}
        </div>
      )}
    </div>
  );
}

const BRANCH_OPTIONS = BRANCH_KEYS;

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="rounded-xl bg-surface border border-border p-3">
      <div className="flex justify-between text-[11px] text-muted-foreground mb-1.5">
        <span>{label}</span>
        <span>{done.toLocaleString("en-IN")} / {total.toLocaleString("en-IN")}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LeadsImportTab() {
  const fields: FieldDef[] = [
    { key: "name", label: "Name", required: true },
    { key: "mobile", label: "Mobile", required: true },
    { key: "source", label: "Source" },
    { key: "note", label: "Disease / note" },
  ];
  const csv = useCSVImport(fields);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewLeadsImport>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const runPreview = async () => {
    setBusy(true);
    try {
      const rows = csv.mappedRows as unknown as ImportLeadRow[];
      setPreview(await previewLeadsImport(rows));
    } catch (e: any) {
      toast.error("Preview fail: " + (e?.message ?? "unknown error"));
    } finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!preview || !preview.valid.length) return;
    if (!window.confirm(`${preview.valid.length} leads import karein?`)) return;
    setBusy(true);
    setProgress({ done: 0, total: preview.valid.length });
    const batchId = newImportBatchId();
    try {
      const imported = await commitLeadsImport(preview.valid, batchId, (done, total) => setProgress({ done, total }));
      await recordImportBatch({ batchId, type: "Leads", count: imported });
      toast.success(`${imported} leads imported`);
      csv.reset(); setPreview(null);
    } catch (e: any) {
      toast.error("Import fail: " + (e?.message ?? "unknown error"));
    } finally { setBusy(false); setProgress(null); }
  };

  return (
    <div className="space-y-3">
      <FilePicker onFile={csv.onFile} fileName={csv.fileName} />
      {csv.headers.length > 0 && (
        <>
          <ColumnMapper fields={fields} headers={csv.headers} mapping={csv.mapping} setMapping={csv.setMapping} />
          <div className="text-[11px] text-muted-foreground px-1">{csv.dataRows.length} rows detected in file</div>
          <button disabled={busy} onClick={runPreview} className="w-full rounded-full bg-primary text-primary-foreground font-bold py-3 text-sm disabled:opacity-60">
            {busy ? "Checking…" : "Preview"}
          </button>
        </>
      )}
      {preview && (
        <>
          <PreviewSummary valid={preview.valid.length} duplicates={preview.duplicates} invalid={preview.invalid} samples={preview.invalidSamples} />
          {progress ? (
            <ProgressBar done={progress.done} total={progress.total} label="Importing leads…" />
          ) : (
            <button disabled={busy || !preview.valid.length} onClick={doImport} className="w-full rounded-full bg-success text-success-foreground font-bold py-3.5 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
              <CheckCircle2 className="h-4 w-4" /> Import {preview.valid.length} leads
            </button>
          )}
        </>
      )}
    </div>
  );
}

function PatientsImportTab() {
  const fields: FieldDef[] = [
    { key: "name", label: "Name", required: true },
    { key: "mobile", label: "Mobile", required: true },
    { key: "age", label: "Age" },
    { key: "gender", label: "Gender" },
    { key: "city", label: "City" },
    { key: "primary_disease", label: "Primary disease" },
    { key: "branch", label: "Branch (per-row, optional)" },
  ];
  const csv = useCSVImport(fields);
  const [defaultBranch, setDefaultBranch] = useState<(typeof BRANCH_OPTIONS)[number]>("BAJAJ_NAGAR");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewPatientsImport>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const runPreview = async () => {
    setBusy(true);
    try {
      const rows = csv.mappedRows as unknown as ImportPatientRow[];
      setPreview(await previewPatientsImport(rows, defaultBranch));
    } catch (e: any) {
      toast.error("Preview fail: " + (e?.message ?? "unknown error"));
    } finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!preview || !preview.valid.length) return;
    if (!window.confirm(`${preview.valid.length} patients import karein? Har ek ko WhatsApp consent OFF milega (fresh consent lena hoga).`)) return;
    setBusy(true);
    setProgress({ done: 0, total: preview.valid.length });
    const batchId = newImportBatchId();
    try {
      const imported = await commitPatientsImport(preview.valid, batchId, (done, total) => setProgress({ done, total }));
      await recordImportBatch({ batchId, type: "Patients", count: imported });
      toast.success(`${imported} patients imported`);
      csv.reset(); setPreview(null);
    } catch (e: any) {
      toast.error("Import fail: " + (e?.message ?? "unknown error"));
    } finally { setBusy(false); setProgress(null); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-surface border border-border p-3.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Default branch</div>
        <div className="flex gap-2">
          {BRANCH_OPTIONS.map((b) => (
            <button key={b} onClick={() => setDefaultBranch(b)} className={cn("flex-1 rounded-full border py-2 text-[12px] font-bold", defaultBranch === b ? "bg-primary text-primary-foreground border-primary" : "bg-background text-primary border-border")}>
              {branchLabel(b)}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground mt-2">Used for every row unless the CSV has its own Branch column mapped.</div>
      </div>
      <FilePicker onFile={csv.onFile} fileName={csv.fileName} />
      {csv.headers.length > 0 && (
        <>
          <ColumnMapper fields={fields} headers={csv.headers} mapping={csv.mapping} setMapping={csv.setMapping} />
          <div className="text-[11px] text-muted-foreground px-1">{csv.dataRows.length} rows detected in file</div>
          <button disabled={busy} onClick={runPreview} className="w-full rounded-full bg-primary text-primary-foreground font-bold py-3 text-sm disabled:opacity-60">
            {busy ? "Checking…" : "Preview"}
          </button>
        </>
      )}
      {preview && (
        <>
          <PreviewSummary valid={preview.valid.length} duplicates={preview.duplicates} invalid={preview.invalid} samples={preview.invalidSamples} />
          {progress ? (
            <ProgressBar done={progress.done} total={progress.total} label="Importing patients…" />
          ) : (
            <button disabled={busy || !preview.valid.length} onClick={doImport} className="w-full rounded-full bg-success text-success-foreground font-bold py-3.5 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
              <CheckCircle2 className="h-4 w-4" /> Import {preview.valid.length} patients
            </button>
          )}
        </>
      )}
    </div>
  );
}

function VisitHistoryImportTab() {
  const fields: FieldDef[] = [
    { key: "mobile", label: "Mobile (to match patient)", required: true },
    { key: "visit_date", label: "Visit date (YYYY-MM-DD)", required: true },
    { key: "chief_complaint", label: "Complaint / diagnosis" },
    { key: "amount_charged", label: "Amount charged" },
    { key: "amount_received", label: "Amount received" },
    { key: "payment_mode", label: "Payment mode" },
  ];
  const csv = useCSVImport(fields);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewVisitHistoryImport>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedPatients, setFailedPatients] = useState<{ id: string; name: string; patient_code: string | null }[]>([]);
  const [showFailed, setShowFailed] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: "visits" | "totals" } | null>(null);

  const runPreview = async () => {
    setBusy(true);
    try {
      const rows = csv.mappedRows as unknown as ImportVisitRow[];
      setPreview(await previewVisitHistoryImport(rows));
    } catch (e: any) {
      toast.error("Preview fail: " + (e?.message ?? "unknown error"));
    } finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!preview || !preview.valid.length) return;
    if (!window.confirm(`${preview.valid.length} visit records import karein? Patient ki lifetime revenue/visits automatically update hongi.`)) return;
    setBusy(true);
    setProgress({ done: 0, total: preview.valid.length, phase: "visits" });
    const batchId = newImportBatchId();
    try {
      const res = await commitVisitHistoryImport(preview.valid, batchId, (done, total, phase) => setProgress({ done, total, phase }));
      await recordImportBatch({ batchId, type: "Visit History", count: res.visitsImported });
      toast.success(`${res.visitsImported} visits, ${res.paymentsImported} payments imported — ${res.patientsUpdated} patients ki totals update hui`);
      if (res.totalsFailedFor.length > 0) {
        toast.error(`${res.totalsFailedFor.length} patients ki totals update NAHI hui (visits/payments phir bhi import ho gaye) — neeche list dekho`);
        setFailedPatients(await fetchPatientsByIds(res.totalsFailedFor));
        setShowFailed(true);
      } else {
        setFailedPatients([]);
      }
      csv.reset(); setPreview(null);
    } catch (e: any) {
      toast.error("Import fail: " + (e?.message ?? "unknown error"));
    } finally { setBusy(false); setProgress(null); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-accent/20 border border-accent/40 p-3 text-[12px] text-primary">
        Yeh Patients import ke <b>baad</b> chalao — mobile se match karke patient dhoonda jaata hai. Mobile match nahi mila toh row "unmatched" mein chala jaayega.
      </div>
      <FilePicker onFile={csv.onFile} fileName={csv.fileName} />
      {csv.headers.length > 0 && (
        <>
          <ColumnMapper fields={fields} headers={csv.headers} mapping={csv.mapping} setMapping={csv.setMapping} />
          <div className="text-[11px] text-muted-foreground px-1">{csv.dataRows.length} rows detected in file</div>
          <button disabled={busy} onClick={runPreview} className="w-full rounded-full bg-primary text-primary-foreground font-bold py-3 text-sm disabled:opacity-60">
            {busy ? "Checking…" : "Preview"}
          </button>
        </>
      )}
      {preview && (
        <>
          <PreviewSummary valid={preview.valid.length} extraLabel="Unmatched" extraCount={preview.unmatched} samples={preview.unmatchedSamples} />
          {progress ? (
            <ProgressBar
              done={progress.done}
              total={progress.total}
              label={progress.phase === "visits" ? "Importing visits/payments…" : "Updating patient totals…"}
            />
          ) : (
            <button disabled={busy || !preview.valid.length} onClick={doImport} className="w-full rounded-full bg-success text-success-foreground font-bold py-3.5 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
              <CheckCircle2 className="h-4 w-4" /> Import {preview.valid.length} visits
            </button>
          )}
        </>
      )}
      {failedPatients.length > 0 && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3">
          <button onClick={() => setShowFailed((v) => !v)} className="w-full flex items-center justify-between text-[12px] font-bold text-destructive">
            <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {failedPatients.length} patients need manual verification</span>
            <span>{showFailed ? "Hide" : "Show"}</span>
          </button>
          {showFailed && (
            <ul className="mt-2 space-y-1">
              {failedPatients.map((p) => (
                <li key={p.id} className="text-[12px] text-primary">
                  {p.name} {p.patient_code && <span className="text-muted-foreground">({p.patient_code})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RecentBatches() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["import-batches"], queryFn: fetchImportBatches });
  const [undoing, setUndoing] = useState<string | null>(null);

  const undo = async (batchId: string) => {
    if (!window.confirm("Is poore import ko undo karein? Sirf isi batch ke rows delete honge, kuch aur touch nahi hoga.")) return;
    setUndoing(batchId);
    try {
      const res = await rollbackImportBatch(batchId);
      toast.success(`Undo ho gaya — ${res.patients} patients, ${res.leads} leads, ${res.visits} visits, ${res.payments} payments hataye`);
      qc.invalidateQueries({ queryKey: ["import-batches"] });
    } catch (e: any) {
      toast.error("Undo fail: " + (e?.message ?? "unknown error"));
    } finally { setUndoing(null); }
  };

  if (!data || data.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">Recent imports</div>
      <ul className="space-y-2">
        {data.map((b) => (
          <li key={b.batchId} className="rounded-xl bg-surface border border-border p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-primary flex items-center gap-1.5">
                {b.type} <Badge tone="primary">{b.count}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground">{new Date(b.date).toLocaleString("en-IN")}</div>
            </div>
            <button
              disabled={undoing === b.batchId}
              onClick={() => undo(b.batchId)}
              className="shrink-0 rounded-full bg-destructive/10 text-destructive text-[11px] font-bold px-3 py-1.5 inline-flex items-center gap-1 disabled:opacity-60"
            >
              <Undo2 className="h-3.5 w-3.5" /> {undoing === b.batchId ? "…" : "Undo"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TABS = ["Leads", "Patients", "Visit History"] as const;

function ImportPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Leads");

  return (
    <RoleShell wide title="Bulk Import" subtitle="Old data + leads" nav={OWNER_NAV}>
      <div className="rounded-2xl bg-primary text-primary-foreground p-3.5 flex items-start gap-2 mb-3">
        <Upload className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-[12px]">Har import pehle sirf preview karta hai (kuch likhta nahi). Commit karne ke baad bhi "Undo" se poora batch turant wapas ho sakta hai.</span>
      </div>

      <div className="flex gap-1.5 mb-3 rounded-full bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("flex-1 rounded-full py-2 text-[12px] font-bold transition", tab === t ? "bg-surface text-primary shadow-sm" : "text-muted-foreground")}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Leads" && <LeadsImportTab />}
      {tab === "Patients" && <PatientsImportTab />}
      {tab === "Visit History" && <VisitHistoryImportTab />}

      <RecentBatches />
    </RoleShell>
  );
}
