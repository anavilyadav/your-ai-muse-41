import { createFileRoute } from "@tanstack/react-router";
import { AuthGate, ErrorBlock } from "@/components/yhc/AuthGate";
import { useEffectiveRole } from "@/lib/auth";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, Clock, MessageCircle, PhoneCall, XCircle, Plus, X, Settings, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";
import {
  fetchAppointments,
  createAppointment,
  updateAppointmentStatus,
  searchPatients,
  fetchSlotAvailability,
  fetchSlotConfig,
  saveSlotConfig,
  fetchVipSlots,
  addVipSlot,
  removeVipSlot,
  DEFAULT_SLOT_CONFIG,
  branchLabel,
  BRANCH_KEYS,
  APPT_TYPES,
  apptTypeLabel,
  type ApptBranch,
  type ApptType,
  type SlotConfig,
} from "@/lib/db";
import { sendWhatsApp } from "@/lib/whatsapp";
import { today } from "@/lib/supabase";

export const Route = createFileRoute("/appointments")({
  head: () => ({ meta: [{ title: "Appointments — YHC Jaipur" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="appointments">
      <AppointmentsPage />
    </AuthGate>
  ),
});

const branches: ("All" | ApptBranch)[] = ["All", ...BRANCH_KEYS];

const statusStyle: Record<string, string> = {
  Confirmed: "bg-success/15 text-success border-success/40",
  Tentative: "bg-accent/25 text-accent-foreground border-accent/50",
  Cancelled: "bg-destructive/15 text-destructive border-destructive/40",
  Arrived: "bg-primary/15 text-primary border-primary/40",
};

function SlotPicker({
  date, branch, type, value, onChange, isOwner,
}: {
  date: string; branch: ApptBranch; type: ApptType; value: string; onChange: (t: string) => void; isOwner: boolean;
}) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["slot-availability", date, branch, type],
    queryFn: () => fetchSlotAvailability(date, branch, type),
  });

  if (isLoading) return <div className="text-center text-xs text-muted-foreground py-4">Slots load ho rahe hain…</div>;
  if (!data || data.length === 0) return <div className="text-center text-xs text-muted-foreground py-4">Is branch ke liye slot hours set nahi hain — Owner Settings se set karo.</div>;
  if (data[0]?.capReached) {
    return (
      <div className="text-center text-xs text-destructive py-4">
        Aaj ke liye {apptTypeLabel(type)} appointments ki daily limit puri ho gayi.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto py-1">
      {data.map((s) => {
        const isVip = s.vip;
        const blocked = s.full || (isVip && !isOwner);
        const selected = value === s.time;
        return (
          <button
            key={s.time}
            type="button"
            disabled={blocked}
            onClick={() => onChange(s.time)}
            className={cn(
              "rounded-lg border py-2 text-[11.5px] font-semibold flex flex-col items-center gap-0.5",
              selected ? "bg-primary text-primary-foreground border-primary" :
              blocked ? "bg-muted text-muted-foreground border-border opacity-60 cursor-not-allowed" :
              isVip ? "bg-accent/20 text-accent-foreground border-accent/50" :
              "bg-surface text-primary border-border",
            )}
          >
            <span>{s.time}</span>
            {isVip ? (
              <span className="inline-flex items-center gap-0.5 text-[9px]"><Star className="h-2.5 w-2.5" /> VIP</span>
            ) : (
              <span className="text-[9px] opacity-80">{s.booked}/{s.capacity}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function NewAppointmentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const role = useEffectiveRole();
  const isOwner = role === "OWNER";
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [patientId, setPatientId] = useState<string | undefined>(undefined);
  const [waConsent, setWaConsent] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("");
  const [type, setType] = useState<ApptType>("FOLLOWUP");
  const [branch, setBranch] = useState<ApptBranch>("BAJAJ_NAGAR");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const debouncedName = useDebouncedValue(name, 300);
  const patientSearch = useQuery({
    queryKey: ["appt-patient-search", debouncedName],
    queryFn: () => searchPatients(debouncedName),
    enabled: !patientId && debouncedName.trim().length >= 2,
  });

  const submit = async () => {
    if (!name.trim() || !time.trim()) { toast.error("Naam aur slot chuno"); return; }
    setSaving(true);
    const cfg = await fetchSlotConfig();
    const res = await createAppointment({
      patient_id: patientId,
      patient_name: name.trim(),
      mobile: mobile.replace(/\D/g, ""),
      appointment_date: date,
      appointment_time: time,
      slot_minutes: cfg.typeConfig[type]?.slotMinutes ?? DEFAULT_SLOT_CONFIG.typeConfig[type].slotMinutes,
      appointment_type: type,
      branch,
      reason: reason.trim() || undefined,
    });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Appointment ban gaya");
    if (waConsent && mobile.replace(/\D/g, "").length === 10) {
      const waRes = await sendWhatsApp({
        campaignName: "APPOINTMENT_REMINDER",
        destination: mobile.replace(/\D/g, ""),
        userName: name.trim(),
        templateParams: [name.trim(), date, time],
        patientId,
      });
      // Appointment itself already saved — this is a separate notice so
      // reception knows to manually confirm with the patient if the
      // WhatsApp message didn't go out, not a reason to undo the booking.
      if (!waRes.success) toast.warning("Appointment ban gaya, par WhatsApp reminder nahi bheja ja saka");
    }
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">New Appointment</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-1.5">
            {APPT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setType(t); setTime(""); }}
                className={cn(
                  "rounded-xl border py-2.5 text-[13px] font-bold",
                  type === t ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground",
                )}
              >
                {apptTypeLabel(t)}
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setPatientId(undefined); setWaConsent(false); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Naam, mobile ya card number — existing patient search hoga"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
            />
            {showSuggestions && !patientId && (patientSearch.data?.length ?? 0) > 0 && (
              <ul className="absolute z-10 w-full mt-1 rounded-xl border border-border bg-background shadow-lg max-h-40 overflow-y-auto">
                {patientSearch.data!.map((p: any) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={() => {
                        setName(p.name);
                        setMobile(p.mobile ?? "");
                        setPatientId(p.id);
                        setWaConsent(!!p.wa_consent);
                        setShowSuggestions(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-accent/15"
                    >
                      {p.name} — {p.mobile}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {patientId && (
              <div className={cn("mt-1 text-[11px] font-semibold", waConsent ? "text-success" : "text-muted-foreground")}>
                ✓ Existing patient selected {waConsent ? "· WhatsApp reminder will be sent" : "· No WhatsApp consent on file — reminder won't be sent"}
              </div>
            )}
          </div>
          <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" maxLength={10} placeholder="Mobile" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          <div className="flex gap-1.5">
            {[...BRANCH_KEYS].map((b) => (
              <button key={b} onClick={() => { setBranch(b); setTime(""); }} className={cn("rounded-full px-3 py-1.5 text-[12px] font-bold", branch === b ? "bg-primary text-primary-foreground" : "bg-surface border border-border text-muted-foreground")}>{branchLabel(b)}</button>
            ))}
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              {apptTypeLabel(type)} slot {time && <span className="normal-case font-semibold text-primary">— {time} selected</span>}
            </div>
            <SlotPicker date={date} branch={branch} type={type} value={time} onChange={setTime} isOwner={isOwner} />
            {!isOwner && (
              <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                <Star className="h-2.5 w-2.5" /> VIP-reserved slots sirf Owner book kar sakta hai
              </div>
            )}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm" />
          <button onClick={submit} disabled={saving} className="mt-1 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Create Appointment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SlotSettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const cfgQuery = useQuery({ queryKey: ["slot-config"], queryFn: fetchSlotConfig });
  const vipQuery = useQuery({ queryKey: ["vip-slots"], queryFn: fetchVipSlots });
  const [cfg, setCfg] = useState<SlotConfig>(DEFAULT_SLOT_CONFIG);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);

  useEffect(() => {
    if (cfgQuery.data && !loadedOnce) {
      setCfg(cfgQuery.data);
      setLoadedOnce(true);
    }
  }, [cfgQuery.data, loadedOnce]);

  const [vDate, setVDate] = useState(today());
  const [vBranch, setVBranch] = useState<ApptBranch>("BAJAJ_NAGAR");
  const [vTime, setVTime] = useState("");
  const [vNote, setVNote] = useState("");
  const [addingVip, setAddingVip] = useState(false);

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      await saveSlotConfig(cfg);
      qc.invalidateQueries({ queryKey: ["slot-config"] });
      qc.invalidateQueries({ queryKey: ["slot-availability"] });
      toast.success("Slot settings saved");
    } catch (e: any) {
      toast.error("Save nahi hua: " + (e?.message ?? "unknown error"));
    } finally {
      setSavingCfg(false);
    }
  };

  const addVip = async () => {
    if (!vTime) { toast.error("Time chuno"); return; }
    setAddingVip(true);
    try {
      await addVipSlot({ branch: vBranch, date: vDate, time: vTime, note: vNote.trim() || undefined });
      qc.invalidateQueries({ queryKey: ["vip-slots"] });
      qc.invalidateQueries({ queryKey: ["slot-availability"] });
      toast.success("VIP slot reserved");
      setVTime(""); setVNote("");
    } catch (e: any) {
      toast.error("Reserve nahi hua: " + (e?.message ?? "unknown error"));
    } finally {
      setAddingVip(false);
    }
  };

  const removeVip = async (id: string) => {
    try {
      await removeVipSlot(id);
      qc.invalidateQueries({ queryKey: ["vip-slots"] });
      qc.invalidateQueries({ queryKey: ["slot-availability"] });
      toast.success("VIP reservation hataayi");
    } catch (e: any) {
      toast.error("Hata nahi paaya: " + (e?.message ?? "unknown error"));
    }
  };

  const vipSlotOptions = useMemo(() => {
    const hours = cfg.hours[vBranch] ?? DEFAULT_SLOT_CONFIG.hours[vBranch];
    const out: string[] = [];
    let [h, m] = hours.start.split(":").map(Number);
    const [eh, em] = hours.end.split(":").map(Number);
    let guard = 0;
    while ((h < eh || (h === eh && m < em)) && guard < 500) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      m += cfg.slotMinutes;
      while (m >= 60) { m -= 60; h += 1; }
      guard++;
    }
    return out;
  }, [cfg, vBranch]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Appointment Slot Settings</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="rounded-2xl bg-surface border border-border p-3.5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Slot length & capacity</div>
          {APPT_TYPES.map((t) => (
            <div key={t} className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-primary">{apptTypeLabel(t)} duration</span>
              <select
                className="rounded-lg border border-border bg-background text-[12px] px-2 py-1.5"
                value={cfg.typeConfig[t].slotMinutes}
                onChange={(e) =>
                  setCfg({ ...cfg, typeConfig: { ...cfg.typeConfig, [t]: { ...cfg.typeConfig[t], slotMinutes: Number(e.target.value) } } })
                }
              >
                {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-primary">Patients per slot</span>
            <input
              type="number" min={1} max={20}
              className="w-16 rounded-lg border border-border bg-background text-[12px] px-2 py-1.5 text-center"
              value={cfg.capacityPerSlot}
              onChange={(e) => setCfg({ ...cfg, capacityPerSlot: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          {[...BRANCH_KEYS].map((b) => (
            <div key={b}>
              <div className="text-[12px] font-bold text-primary mb-1">{branchLabel(b)} hours</div>
              <div className="flex gap-2">
                <input type="time" value={cfg.hours[b].start} onChange={(e) => setCfg({ ...cfg, hours: { ...cfg.hours, [b]: { ...cfg.hours[b], start: e.target.value } } })} className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-[12px]" />
                <span className="self-center text-muted-foreground text-xs">to</span>
                <input type="time" value={cfg.hours[b].end} onChange={(e) => setCfg({ ...cfg, hours: { ...cfg.hours, [b]: { ...cfg.hours[b], end: e.target.value } } })} className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-[12px]" />
              </div>
            </div>
          ))}
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground pt-1">
            Daily limit (khaali = unlimited)
          </div>
          {APPT_TYPES.map((t) => (
            <div key={t} className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-primary">{apptTypeLabel(t)}</span>
              <div className="flex gap-2">
                {[...BRANCH_KEYS].map((b) => (
                  <div key={b} className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">{branchLabel(b)}</span>
                    <input
                      type="number" min={0}
                      placeholder="—"
                      className="w-14 rounded-lg border border-border bg-background text-[12px] px-2 py-1.5 text-center"
                      value={cfg.typeConfig[t].dailyCap[b] ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = raw.trim() === "" ? null : Math.max(0, Number(raw) || 0);
                        setCfg({
                          ...cfg,
                          typeConfig: { ...cfg.typeConfig, [t]: { ...cfg.typeConfig[t], dailyCap: { ...cfg.typeConfig[t].dailyCap, [b]: n } } },
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button disabled={savingCfg} onClick={saveCfg} className="w-full rounded-full bg-primary text-primary-foreground font-bold py-2.5 text-sm disabled:opacity-60">
            {savingCfg ? "Saving…" : "Save slot settings"}
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-surface border border-border p-3.5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Star className="h-3 w-3" /> Reserve a VIP slot
          </div>
          <input type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px]" />
          <div className="flex gap-1.5">
            {[...BRANCH_KEYS].map((b) => (
              <button key={b} onClick={() => { setVBranch(b); setVTime(""); }} className={cn("flex-1 rounded-full py-1.5 text-[11px] font-bold border", vBranch === b ? "bg-primary text-primary-foreground border-primary" : "bg-background text-primary border-border")}>{branchLabel(b)}</button>
            ))}
          </div>
          <select className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px]" value={vTime} onChange={(e) => setVTime(e.target.value)}>
            <option value="">— time chuno —</option>
            {vipSlotOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={vNote} onChange={(e) => setVNote(e.target.value)} placeholder="Note (e.g. patient/family name)" className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px]" />
          <button disabled={addingVip} onClick={addVip} className="w-full rounded-full bg-accent text-accent-foreground font-bold py-2.5 text-sm disabled:opacity-60">
            {addingVip ? "Reserving…" : "Reserve this slot"}
          </button>

          {(vipQuery.data?.length ?? 0) > 0 && (
            <div className="pt-1 space-y-1.5">
              <div className="text-[10px] uppercase text-muted-foreground font-bold">Current VIP reservations</div>
              {vipQuery.data!.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg bg-accent/10 border border-accent/30 px-2.5 py-1.5">
                  <div className="text-[11px] text-primary min-w-0">
                    <span className="font-bold">{v.date} • {v.time}</span> — {branchLabel(v.branch)}
                    {v.note && <span className="text-muted-foreground"> ({v.note})</span>}
                  </div>
                  <button onClick={() => removeVip(v.id)} className="shrink-0 h-6 w-6 grid place-items-center rounded-full bg-destructive/10 text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AppointmentsPage() {
  const role = useEffectiveRole();
  const isOwner = role === "OWNER";
  const [selectedDate, setSelectedDate] = useState(today());
  // Was previously fetchAppointments() with no date at all — pulled every
  // appointment ever booked (past + future, unbounded) despite the page
  // saying "Today's schedule". Now genuinely scoped to a date, defaulting
  // to today, with a picker so reception can still check other days.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["appointments", selectedDate],
    queryFn: () => fetchAppointments(selectedDate),
  });
  const queryClient = useQueryClient();
  const appts = (data?.rows ?? []) as any[];
  const apptsTruncated = data?.truncated ?? false;
  const [branch, setBranch] = useState<(typeof branches)[number]>("All");
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const filtered = useMemo(
    () => (branch === "All" ? appts : appts.filter((a) => a.branch === branch)),
    [appts, branch],
  );

  const stats = useMemo(() => {
    const confirmed = appts.filter((a) => a.status === "Confirmed" || a.status === "Arrived").length;
    const arrived = appts.filter((a) => a.status === "Arrived").length;
    const cancelled = appts.filter((a) => a.status === "Cancelled").length;
    return { confirmed, arrived, cancelled };
  }, [appts]);

  const setStatus = async (a: any, status: string) => {
    const res = await updateAppointmentStatus(a.id, status);
    if (res.success) {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      status === "Arrived" ? toast.success(`${a.patient_name} marked arrived`) : toast.error(`${a.patient_name} cancelled`);
    } else {
      toast.error("Update nahi hua: " + res.error);
    }
  };

  return (
    <MobileShell
      title="Appointments"
      subtitle={selectedDate === today() ? "Today's schedule" : `Schedule for ${selectedDate}`}
      showBack
      right={
        <div className="flex items-center gap-1.5">
          {isOwner && (
            <button onClick={() => setShowSettings(true)} className="h-8 w-8 grid place-items-center rounded-full bg-white/15" aria-label="Slot settings">
              <Settings className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => setShowNew(true)} className="rounded-full bg-accent text-accent-foreground text-[11px] font-bold px-3 py-1.5 inline-flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>
      }
    >
      {showNew && <NewAppointmentModal onClose={() => setShowNew(false)} onAdded={() => queryClient.invalidateQueries({ queryKey: ["appointments"] })} />}
      {showSettings && <SlotSettingsModal onClose={() => setShowSettings(false)} />}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Confirmed" value={stats.confirmed} tone="success" />
        <StatCard label="Arrived" value={stats.arrived} />
        <StatCard label="Cancelled" value={stats.cancelled} tone="destructive" />
      </div>
      {apptsTruncated && (
        <div className="mt-2 text-[11px] text-muted-foreground text-center">
          Is din ke sirf pehle 500 appointments dikh rahe hain.
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm"
        />
        {selectedDate !== today() && (
          <button onClick={() => setSelectedDate(today())} className="shrink-0 rounded-full bg-muted text-[11px] font-bold px-3 py-2">
            Today
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {branches.map((b) => (
          <button
            key={b}
            onClick={() => setBranch(b)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition",
              branch === b
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-surface text-foreground border-border",
            )}
          >
            {b === "All" ? "All" : branchLabel(b)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-8">Loading…</div>
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : (
      <ul className="mt-3 space-y-2">
        {filtered.length === 0 && (
          <li className="text-center text-sm text-muted-foreground py-8">No appointments.</li>
        )}
        {filtered.map((a) => (
          <li
            key={a.id}
            className={cn(
              "rounded-xl bg-surface border border-border border-l-4 p-3",
              a.status === "Arrived" && "border-l-primary",
              a.status === "Confirmed" && "border-l-success",
              a.status === "Tentative" && "border-l-accent",
              a.status === "Cancelled" && "border-l-destructive opacity-70",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <Clock className="h-3.5 w-3.5" /> {a.appointment_time}
                  {a.slot_minutes && (
                    <span className="text-[10px] font-normal text-muted-foreground">
                      ({a.slot_minutes} min)
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-sm truncate">{a.patient_name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                      (a.appointment_type ?? "FOLLOWUP") === "NEW" ? "bg-accent/25 text-accent-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {apptTypeLabel((a.appointment_type ?? "FOLLOWUP") as ApptType)}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {a.doctor ?? "Dr. Yadav"} • {branchLabel(a.branch)}
                </div>
                {a.reason && <div className="text-[11px] text-foreground/70 mt-1 truncate">{a.reason}</div>}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  statusStyle[a.status] ?? statusStyle.Confirmed,
                )}
              >
                {a.status}
              </span>
            </div>

            {a.status !== "Cancelled" && a.status !== "Arrived" && (
              <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                <a
                  href={`tel:${a.mobile}`}
                  className="rounded-lg bg-success text-success-foreground py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <PhoneCall className="h-3 w-3" /> Call
                </a>
                <a
                  href={`https://wa.me/91${a.mobile}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-accent text-accent-foreground py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <MessageCircle className="h-3 w-3" /> WA
                </a>
                <button
                  onClick={() => setStatus(a, "Arrived")}
                  className="rounded-lg bg-primary text-primary-foreground py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <CheckCircle2 className="h-3 w-3" /> Arrived
                </button>
                <button
                  onClick={() => {
                    if (!window.confirm(`${a.patient_name ?? "Ye"} appointment cancel karein?`)) return;
                    setStatus(a, "Cancelled");
                  }}
                  className="rounded-lg bg-surface border border-destructive/40 text-destructive py-1.5 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                >
                  <XCircle className="h-3 w-3" /> Cancel
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      )}

      <div className="mt-6 rounded-xl bg-primary/5 border border-primary/20 p-3 flex items-center gap-2 text-[11px] text-primary">
        <CalendarCheck className="h-4 w-4 shrink-0" />
        Tap "Arrived" to mark them in for today.
      </div>
    </MobileShell>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "destructive";
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <div
        className={cn(
          "text-lg font-bold",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
