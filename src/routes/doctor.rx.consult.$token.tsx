import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { AuthGate, LoadingBlock } from "@/components/yhc/AuthGate";
import { LogInteractionModal } from "@/components/yhc/LogInteractionModal";
import {
  fetchVisit,
  fetchPatientHistory,
  fetchInStockMedicines,
  submitPrescription,
  branchLabel,
  saveRxDraft,
  fetchNextVisitOptions,
  DEFAULT_NEXT_VISIT_OPTIONS,
  fetchSlxInstructions,
  DEFAULT_SLX_INSTRUCTIONS,
  addMedicineToCatalog,
  type RxRow,
  type RxDraft,
  type NextVisitOption,
} from "@/lib/db";
import { downloadPrescriptionPdf } from "@/lib/prescription-pdf";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { PhotoTimeline } from "@/components/yhc/PhotoTimeline";

export const Route = createFileRoute("/doctor/rx/consult/$token")({
  head: () => ({ meta: [{ title: "Write Rx — Doctor" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["DOCTOR", "OWNER"]} permKey="rxConsult">
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
  // Sequenced/staggered dosing (item D) -- OFF by default so nothing
  // changes for anyone who doesn't touch this: all medicines still start
  // the same day, exactly like before.
  const [sequenced, setSequenced] = useState(false);
  const [notes, setNotes] = useState("");
  const [nextVisit, setNextVisit] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const draftHydrated = useRef(false);

  const { data: nextVisitOptions } = useQuery({
    queryKey: ["next-visit-options"],
    queryFn: fetchNextVisitOptions,
  });
  const { data: slxInstructions } = useQuery({
    queryKey: ["slx-instructions"],
    queryFn: fetchSlxInstructions,
  });

  useEffect(() => {
    if (visit?.doctor_notes) setNotes(visit.doctor_notes);
  }, [visit?.doctor_notes]);

  // Rx Autosave (item B) — restore a draft exactly once, the first time
  // this visit's data arrives, and only if the doctor hasn't already
  // started typing (rows still the pristine single empty row). Guards
  // against clobbering fresh input if this effect somehow re-fires.
  useEffect(() => {
    if (draftHydrated.current || !visit) return;
    draftHydrated.current = true;
    const draft = visit.rx_draft;
    if (!draft || !draft.rows) return;
    const untouched = rows.length === 1 && !rows[0].medicine_name.trim() && nextVisit === "";
    if (!untouched) return;
    setRows(draft.rows.length ? draft.rows.map((r) => ({ ...r })) : [emptyRow()]);
    setSlxOn(draft.slxOn);
    setSequenced(!!draft.sequenced);
    setNextVisit(draft.nextVisit || "");
    if (draft.notes) setNotes(draft.notes);
    toast.info("Pichla draft wapas load ho gaya");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit]);

  // TASK 3 — warn before an in-progress Rx is thrown away by a back-swipe,
  // bottom-nav tap or tab close. "Dirty" = anything actually typed: a
  // medicine name, notes the doctor changed, or a next-visit date. Cleared
  // once the Rx is submitted so the post-save redirect doesn't prompt.
  const isDirty =
    !submitted &&
    (rows.some((r) => r.medicine_name.trim().length > 0) ||
      notes.trim() !== (visit?.doctor_notes ?? "").trim() ||
      nextVisit !== "");
  useUnsavedChanges(isDirty, "Prescription abhi save nahi hui. Bahar jaana hai?");

  useEffect(() => {
    if (submitted) navigate({ to: "/doctor/rx" });
  }, [submitted, navigate]);

  // Rx Autosave (item B) — write the draft back a moment after typing
  // stops, so a dropped connection mid-consultation never wipes 10
  // minutes of prescription work. Debounced (not on every keystroke) to
  // avoid hammering the DB; skipped until hydration has run once and
  // while there's nothing worth saving yet (isDirty).
  const draftKey = JSON.stringify({ rows, slxOn, sequenced, notes, nextVisit });
  const debouncedDraftKey = useDebouncedValue(draftKey, 1500);
  useEffect(() => {
    if (!visit || !draftHydrated.current || submitted || !isDirty) return;
    const savedAt = new Date().toISOString();
    const draft: RxDraft = {
      rows: rows.map((r) => ({
        medicine_name: r.medicine_name,
        potency: r.potency,
        dose: r.dose,
        frequency: r.frequency,
        duration_num: r.duration_num,
        duration_unit: r.duration_unit,
      })),
      slxOn,
      sequenced,
      notes,
      nextVisit,
      savedAt,
    };
    saveRxDraft(visit.id, draft).then((ok) => {
      if (ok) setDraftSavedAt(savedAt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDraftKey]);

  const setNextInDays = (d: number) => {
    const n = new Date();
    n.setDate(n.getDate() + d);
    setNextVisit(n.toISOString().slice(0, 10));
  };

  const updateRow = (i: number, patch: Partial<EditableRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // Mirrors buildFinalRows' cumulative logic below, just keyed to display
  // index instead of collapsed into the final submit payload — so the
  // "Day X se" label on each card always matches what actually gets saved.
  const rowOffsets = (() => {
    let cursor = 0;
    return rows.map((r) => {
      const off = cursor;
      if (r.medicine_name.trim()) cursor += toDays(r.duration_num, r.duration_unit);
      return off;
    });
  })();

  const buildFinalRows = (): RxRow[] => {
    const valid = rows.filter((r) => r.medicine_name.trim());
    const finalRows: RxRow[] = [];
    // Sequenced dosing (item D) — when ON, each medicine starts the day
    // after the previous one's duration ends (cumulative offset). When
    // OFF (default), every row starts day 0, exactly like before.
    let cursor = 0;
    for (const r of valid) {
      const days = toDays(r.duration_num, r.duration_unit);
      const offset = sequenced ? cursor : 0;
      finalRows.push({
        medicine_name: r.medicine_name.trim(),
        potency: r.potency,
        dose: `${r.dose} Globule`,
        frequency: r.frequency,
        duration_days: days,
        is_slx: false,
        start_offset_days: offset,
      });
      if (slxOn) {
        // SLX shows as just "SLX" now (item E) — which real medicine it
        // pairs with goes in remarks instead of being stuffed into the
        // name, so it no longer reads like a second fake medicine on the
        // pharmacy/patient-history screens.
        finalRows.push({
          medicine_name: "SLX",
          potency: "—",
          dose: "1 Globule",
          frequency: "TDS",
          duration_days: days,
          is_slx: true,
          start_offset_days: offset,
          remarks: `For ${r.medicine_name.trim()}`,
        });
      }
      if (sequenced) cursor += days;
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
      slxInstructions: slxInstructions || DEFAULT_SLX_INSTRUCTIONS,
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
      // Drop the unsaved-changes guard BEFORE navigating away, otherwise a
      // successful save would still pop the "leave page?" confirm. The
      // navigation itself runs from an effect once `submitted` has actually
      // rendered, so the blocker is genuinely disabled by then.
      setSubmitted(true);
      toast.success("Rx saved — pharmacy queue update ho gayi");
    } catch (e: any) {
      toast.error(e?.message || "Rx save fail hua");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <DoctorShell title="Write Rx" showBack><LoadingBlock /></DoctorShell>;
  if (!visit) return <DoctorShell title="Write Rx" showBack><div className="py-10 text-center text-sm text-muted-foreground">Visit nahi mila.</div></DoctorShell>;

  return (
    <DoctorShell title="Write Prescription" subtitle={`${visit.token_number ?? ""} • ${branchLabel(visit.branch)}`} showBack>
      {showLogModal && visit.patient_id && (
        <LogInteractionModal patientId={visit.patient_id} onClose={() => setShowLogModal(false)} onLogged={() => {}} />
      )}
      {/* Single column below lg (Task 1 fix — the old `md:grid` broke here
          because DoctorShell capped content at 430px regardless of the
          actual browser width, crushing both columns to ~200px). Now that
          DoctorShell drops that cap at lg+, this becomes a real 2-column
          desktop layout: patient summary pinned left, Rx form on the
          right, exactly as it should have worked originally. */}
      <div className="lg:grid lg:grid-cols-[360px_1fr] lg:items-start lg:gap-6">

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

          {visit.patient_id && <PhotoTimeline patientId={visit.patient_id} />}

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

          {visit.patient_id && (
            <button
              onClick={() => setShowLogModal(true)}
              className="w-full rounded-xl bg-surface border border-border p-3 text-xs font-bold text-primary text-center"
            >
              + Log Interaction (verbal advice / dose change)
            </button>
          )}
        </section>

        {/* RIGHT: write rx */}
        <section className="mt-4 space-y-3 lg:mt-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase text-primary">Prescription</div>
            {draftSavedAt && !submitted && (
              <span className="text-[10px] text-muted-foreground">
                Draft saved {new Date(draftSavedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
            <label className="flex items-center gap-2 text-xs">
              <span>Sequence dawaiyan</span>
              <button
                type="button"
                onClick={() => setSequenced((v) => !v)}
                className={cn(
                  "h-6 w-11 rounded-full border relative transition",
                  sequenced ? "bg-success border-success" : "bg-muted border-border",
                )}
              >
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", sequenced ? "left-[22px]" : "left-0.5")} />
              </button>
            </label>
          </div>
          {slxOn && (
            <p className="text-[11px] text-muted-foreground -mt-1">{slxInstructions || DEFAULT_SLX_INSTRUCTIONS}</p>
          )}
          {sequenced && (
            <p className="text-[11px] text-muted-foreground -mt-1">
              Ek medicine khatam hone ke baad agli shuru hogi — har card pe start day dikh raha hai.
            </p>
          )}

          <ul className="space-y-3">
            {rows.map((r, i) => (
              <RxRowEditor
                key={i}
                row={r}
                branch={visit.branch}
                startOffsetDays={sequenced ? rowOffsets[i] : undefined}
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
            <div className="mt-1 flex flex-wrap gap-2 items-center">
              {(nextVisitOptions ?? DEFAULT_NEXT_VISIT_OPTIONS).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setNextInDays(o.days)}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold"
                >
                  {o.label}
                </button>
              ))}
              <input
                type="date"
                value={nextVisit}
                onChange={(e) => setNextVisit(e.target.value)}
                className="flex-1 min-w-[140px] rounded-lg bg-surface border border-input px-2 py-1.5 text-xs"
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
    </DoctorShell>
  );
}

function RxRowEditor({
  row,
  branch,
  startOffsetDays,
  onChange,
  onDelete,
}: {
  row: EditableRow;
  branch: string;
  startOffsetDays?: number;
  onChange: (p: Partial<EditableRow>) => void;
  onDelete?: () => void;
}) {
  const qc = useQueryClient();
  const [term, setTerm] = useState(row.medicine_name);
  const debouncedTerm = useDebouncedValue(term, 300);
  const [open, setOpen] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  // In-stock only (05 Aug 2026) — a doctor should never be able to pick a
  // medicine+potency+branch combo that isn't actually on the shelf right
  // now. fetchInventorySearch (used elsewhere, e.g. Pharmacy's Add Stock
  // autocomplete) intentionally still shows zero-stock rows too — that's a
  // different, correct need (finding an existing item to top up).
  const { data: inv, isFetching: invLoading } = useQuery({
    queryKey: ["inv-in-stock", debouncedTerm, branch],
    queryFn: () => fetchInStockMedicines(debouncedTerm, branch),
    enabled: open && debouncedTerm.length > 0,
  });

  useEffect(() => setTerm(row.medicine_name), [row.medicine_name]);

  // "Medicine list mein nahi mila to add karo" (item C) — autosuggest
  // already existed; this was the missing half. Shows only once a search
  // has actually completed and genuinely found nothing, so it never
  // flashes while results are still loading or before typing starts.
  const showAddNew =
    open && debouncedTerm.trim().length > 1 && !invLoading && (!inv || inv.length === 0);

  const addAsNewMedicine = async () => {
    // Registers the name in the Medicine Master catalog only — not a
    // phantom 0-stock inventory row like before (that cluttered Inventory
    // with entries that were never actually physical stock). This Rx line
    // still uses whatever text the doctor typed either way; the catalog
    // entry just means Pharmacy can find it by name next time they stock it.
    const name = debouncedTerm.trim();
    if (!name || addingNew) return;
    setAddingNew(true);
    const res = await addMedicineToCatalog(name);
    setAddingNew(false);
    if (!res.success) {
      toast.error(res.error || "Medicine add nahi ho paya");
      return;
    }
    onChange({ medicine_name: res.medicine?.name ?? name });
    setTerm(res.medicine?.name ?? name);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["inv-in-stock"] });
    toast.success(`"${name}" Medicine Master mein add ho gaya — Pharmacy ko is potency ka stock bharna hoga`);
  };

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
          {showAddNew && (
            <div className="absolute z-10 mt-1 w-full rounded-lg bg-surface border border-dashed border-accent shadow-lg">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addAsNewMedicine(); }}
                disabled={addingNew}
                className="w-full text-left px-3 py-2 text-sm text-accent-foreground font-semibold disabled:opacity-60"
              >
                {addingNew ? "Add ho raha hai…" : `+ "${debouncedTerm.trim()}" ko naya medicine add karo`}
              </button>
            </div>
          )}
        </div>
        {onDelete && (
          <button onClick={onDelete} className="h-9 w-9 grid place-items-center rounded-lg border border-border text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {typeof startOffsetDays === "number" && (
        <div className="text-[11px] font-semibold text-accent-foreground">
          {startOffsetDays === 0 ? "Day 1 se shuru" : `Day ${startOffsetDays + 1} se shuru`}
        </div>
      )}

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
