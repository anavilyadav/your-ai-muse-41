import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import {
  fetchVisit,
  fetchPatientHistory,
  fetchInventorySearch,
  submitPrescription,
  branchLabel,
  type RxRow,
} from "@/lib/db";
import { downloadPrescriptionPdf } from "@/lib/prescription-pdf";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export const Route = createFileRoute("/doctor/rx/consult/$token")({
  head: () => ({ meta: [{ title: "Write Rx — Doctor" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["DOCTOR", "OWNER"]}>
      <RxWrite />
    </AuthGate>
  ),
});

const POTENCIES = ["6C", "30C", "200C", "1M", "10M", "50M"];
const FREQS = ["OD", "BD", "TDS", "QID", "weekly", "monthly"];
const DUR_UNITS = ["days", "weeks", "months"] as const;

interface EditableRow {
  medicine_name: string;
  potency: string;
  dose: string;
  frequency: string;
  duration_num: number;
  duration_unit: (typeof DUR_UNITS)[number];
}

const emptyRow = (): EditableRow => ({
  medicine_name: "",
  potency: "30C",
  dose: "2",
  frequency: "TDS",
  duration_num: 7,
  duration_unit: "days",
});

function toDays(n: number, u: EditableRow["duration_unit"]): number {
  return u === "days" ? n : u === "weeks" ? n * 7 : n * 30;
}

function RxWrite() {
  const { token: visitId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: visit, isLoading } = useQuery({
    queryKey: ["visit", visitId],
    queryFn: () => fetchVisit(visitId),
  });

  const { data: history } = useQuery({
    queryKey: ["patient-history", visit?.patient_id],
    queryFn: () => fetchPatientHistory(visit!.patient_id, 3),
    enabled: !!visit?.patient_id,
  });

  const [rows, setRows] = useState<EditableRow[]>([emptyRow()]);
  const [slxOn, setSlxOn] = useState(true);
  const [notes, setNotes] = useState("");
  const [nextVisit, setNextVisit] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visit?.doctor_notes) setNotes(visit.doctor_notes);
  }, [visit?.doctor_notes]);

  const setNextInDays = (d: number) => {
    const n = new Date();
    n.setDate(n.getDate() + d);
    setNextVisit(n.toISOString().slice(0, 10));
  };

  const updateRow = (i: number, patch: Partial<EditableRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const buildFinalRows = (): RxRow[] => {
    const valid = rows.filter((r) => r.medicine_name.trim());
    const finalRows: RxRow[] = [];
    for (const r of valid) {
      finalRows.push({
        medicine_name: r.medicine_name.trim(),
        potency: r.potency,
        dose: `${r.dose} Globule`,
        frequency: r.frequency,
        duration_days: toDays(r.duration_num, r.duration_unit),
        is_slx: false,
      });
      if (slxOn) {
        finalRows.push({
          medicine_name: `SLX (${r.medicine_name.trim()})`,
          potency: "—",
          dose: "1 Globule",
          frequency: "TDS",
          duration_days: toDays(r.duration_num, r.duration_unit),
          is_slx: true,
        });
      }
    }
    return finalRows;
  };

  const downloadPdf = () => {
    const finalRows = buildFinalRows();
    if (finalRows.length === 0) return toast.error("At least one medicine daalo pehle");
    downloadPrescriptionPdf({
      branch: branchLabel(visit!.branch),
      patientName: visit!.patient?.name ?? "",
      age: visit!.patient?.age,
      gender: visit!.patient?.gender,
      patientCode: visit!.patient?.patient_code,
      tokenNumber: visit!.token_number,
      chiefComplaint: visit!.chief_complaint,
      doctorNotes: notes,
      nextVisitDate: nextVisit || null,
      rows: finalRows,
    });
  };

  const submit = async () => {
    if (!visit) return;
    const valid = rows.filter((r) => r.medicine_name.trim());
    if (valid.length === 0) return toast.error("At least one medicine daalo");

    const finalRows = buildFinalRows();

    setBusy(true);
    try {
      await submitPrescription({
        visit_id: visit.id,
        patient_id: visit.patient_id,
        rows: finalRows,
        doctor_notes: notes,
        next_visit_date: nextVisit || null,
      });
      qc.invalidateQueries({ queryKey: ["today-queue"] });
      toast.success("Rx saved — pharmacy queue update ho gayi");
      navigate({ to: "/doctor/rx" });
    } catch (e: any) {
      toast.error(e?.message || "Rx save fail hua");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <MobileShell title="Write Rx" showBack><LoadingBlock /></MobileShell>;
  if (!visit) return <MobileShell title="Write Rx" showBack><div className="py-10 text-center text-sm text-muted-foreground">Visit nahi mila.</div></MobileShell>;

  return (
    <MobileShell title="Write Prescription" subtitle={`${visit.token_number ?? ""} • ${branchLabel(visit.branch)}`} showBack>
      {/* Single column on purpose. DoctorShell caps content at a fixed
          430px phone width, so the old `md:grid md:grid-cols-2` never got
          the room it needed — it just crushed both columns to ~200px and
          broke the Rx rows. */}
      <div>

        {/* LEFT: patient summary */}
        <section className="space-y-3">
          <div className="rounded-2xl bg-primary text-primary-foreground p-4">
            <div className="text-xs opacity-70">Token {visit.token_number}</div>
            <div className="text-xl font-black">{visit.patient?.name}</div>
            <div className="text-xs opacity-80 mt-0.5">
              {visit.patient?.age ? `${visit.patient.age}y` : ""} • {visit.patient?.gender ?? ""} • {visit.patient?.patient_code}
            </div>
            <div className="mt-2 text-sm">{visit.chief_complaint || "—"}</div>
          </div>

          {visit.doctor_notes && (
            <div className="rounded-xl bg-surface border border-border p-3">
              <div className="text-[11px] font-bold uppercase text-muted-foreground">Case notes (Case-DR)</div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{visit.doctor_notes}</p>
            </div>
          )}

          <div className="rounded-xl bg-surface border border-border p-3">
            <div className="text-[11px] font-bold uppercase text-muted-foreground mb-1">Last 3 visits</div>
            {history && history.length > 0 ? (
              <ul className="space-y-2">
                {history.map((v: any) => (
                  <li key={v.id} className="text-xs border-l-2 border-primary/40 pl-2">
                    <div className="font-semibold">{v.visit_date}</div>
                    <div className="text-muted-foreground">{v.chief_complaint || "—"}</div>
                    {v.prescriptions?.length > 0 && (
                      <div className="mt-0.5 text-muted-foreground">
                        {v.prescriptions.filter((p: any) => !p.is_slx).map((p: any) => `${p.medicine_name} ${p.potency ?? ""}`).join(", ")}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted-foreground">Koi previous visits nahi.</div>
            )}
          </div>
        </section>

        {/* RIGHT: write rx */}
        <section className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase text-primary">Prescription</div>
            <label className="flex items-center gap-2 text-xs">
              <span>SLX auto-add</span>
              <button
                type="button"
                onClick={() => setSlxOn((v) => !v)}
                className={cn(
                  "h-6 w-11 rounded-full border relative transition",
                  slxOn ? "bg-success border-success" : "bg-muted border-border",
                )}
              >
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", slxOn ? "left-[22px]" : "left-0.5")} />
              </button>
            </label>
          </div>

          <ul className="space-y-3">
            {rows.map((r, i) => (
              <RxRowEditor
                key={i}
                row={r}
                branch={visit.branch}
                onChange={(p) => updateRow(i, p)}
                onDelete={rows.length > 1 ? () => setRows((rs) => rs.filter((_, idx) => idx !== i)) : undefined}
              />
            ))}
          </ul>

          <button
            onClick={() => setRows((rs) => [...rs, emptyRow()])}
            className="w-full rounded-lg border border-dashed border-primary/40 py-2.5 text-sm font-semibold text-primary flex items-center justify-center gap-1"
          >
            <Plus className="h-4 w-4" /> Add Medicine
          </button>

          <div>
            <label className="text-xs font-bold uppercase text-primary">Doctor notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
              placeholder="Follow-up advice, dietary rules, etc."
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-primary">Next visit</label>
            <div className="mt-1 flex gap-2 items-center">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setNextInDays(d)}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold"
                >
                  {d}d
                </button>
              ))}
              <input
                type="date"
                value={nextVisit}
                onChange={(e) => setNextVisit(e.target.value)}
                className="flex-1 rounded-lg bg-surface border border-input px-2 py-1.5 text-xs"
              />
            </div>
          </div>

          <button
            onClick={downloadPdf}
            type="button"
            className="w-full rounded-xl border border-primary/40 text-primary py-2.5 text-sm font-bold"
          >
            🖨️ Print / Download PDF
          </button>

          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-xl bg-success text-success-foreground py-3.5 text-sm font-bold disabled:opacity-60"
          >
            {busy ? "Saving…" : "Submit Rx & Send to Pharmacy"}
          </button>
        </section>
      </div>
    </MobileShell>
  );
}

function RxRowEditor({
  row,
  branch,
  onChange,
  onDelete,
}: {
  row: EditableRow;
  branch: string;
  onChange: (p: Partial<EditableRow>) => void;
  onDelete?: () => void;
}) {
  const [term, setTerm] = useState(row.medicine_name);
  const debouncedTerm = useDebouncedValue(term, 300);
  const [open, setOpen] = useState(false);
  const { data: inv } = useQuery({
    queryKey: ["inv-search", debouncedTerm, branch],
    queryFn: () => fetchInventorySearch(debouncedTerm, branch),
    enabled: open && debouncedTerm.length > 0,
  });

  useEffect(() => setTerm(row.medicine_name), [row.medicine_name]);

  return (
    <li className="rounded-xl border border-border bg-surface p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 relative">
          <input
            value={term}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => { setTerm(e.target.value); onChange({ medicine_name: e.target.value }); }}
            placeholder="Medicine name"
            className="w-full rounded-lg bg-background border border-input px-3 py-2 text-sm"
          />
          {open && inv && inv.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full max-h-40 overflow-auto rounded-lg bg-surface border border-border shadow-lg">
              {inv.slice(0, 8).map((m: any) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onMouseDown={() => { onChange({ medicine_name: m.medicine_name }); setTerm(m.medicine_name); setOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-primary/10"
                  >
                    {m.medicine_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {onDelete && (
          <button onClick={onDelete} className="h-9 w-9 grid place-items-center rounded-lg border border-border text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={row.potency}
          onChange={(e) => onChange({ potency: e.target.value })}
          className="rounded-lg bg-background border border-input px-2 py-1.5 text-xs"
        >
          {POTENCIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input
            inputMode="numeric"
            value={row.dose}
            onChange={(e) => onChange({ dose: e.target.value.replace(/\D/g, "") || "0" })}
            className="w-14 rounded-lg bg-background border border-input px-2 py-1.5 text-xs"
          />
          <span className="text-xs text-muted-foreground">Globule</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={row.frequency}
          onChange={(e) => onChange({ frequency: e.target.value })}
          className="rounded-lg bg-background border border-input px-2 py-1.5 text-xs"
        >
          {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input
            inputMode="numeric"
            value={row.duration_num}
            onChange={(e) => onChange({ duration_num: Number(e.target.value.replace(/\D/g, "")) || 0 })}
            className="w-14 rounded-lg bg-background border border-input px-2 py-1.5 text-xs"
          />
          <select
            value={row.duration_unit}
            onChange={(e) => onChange({ duration_unit: e.target.value as EditableRow["duration_unit"] })}
            className="flex-1 rounded-lg bg-background border border-input px-2 py-1.5 text-xs"
          >
            {DUR_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
    </li>
  );
}
