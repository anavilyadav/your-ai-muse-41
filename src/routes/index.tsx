import { DayHeader } from "@/components/yhc/DayHeader";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, PhoneCall, MessageCircle, CheckCircle2, Clock, XCircle, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { FlowBar } from "@/components/yhc/FlowBar";
import { PatientApptBar, usePatientAppointments } from "@/components/yhc/PatientApptBar";
import { VisitStatusBar } from "@/components/yhc/VisitStatusBar";
import { AdvancePaymentModal } from "@/components/yhc/AdvancePaymentModal";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchTodayQueue, fetchQueueForDate, fetchBackfilledEntries, fetchBackfilledWithoutPayment, fetchAdvanceByVisit, fetchAppointments, updateAppointmentStatus, branchLabel, statusLabel, normalizeBranchKey, formatCardNumber, apptTypeLabel, type ApptType, systemIdLabel } from "@/lib/db";
import { today as todayStr } from "@/lib/supabase";
import { useAuth, useEffectiveRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useAppointmentActions } from "@/hooks/use-appointment-actions";
import { RescheduleModal } from "./appointments";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today's Queue — YHC Jaipur" },
      { name: "description", content: "Reception queue for Yadav Homeo Clinic Jaipur." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QueuePageGated,
});

function QueuePageGated() {
  return (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]} permKey="queue">
      <QueuePage />
    </AuthGate>
  );
}

const filters = ["All", "Waiting", "Consultation", "Pharmacy", "Done"] as const;
type Filter = (typeof filters)[number];

const statusStyles: Record<string, string> = {
  Waiting: "bg-accent/25 text-accent-foreground border-accent/60",
  "Case Taking": "bg-accent/25 text-accent-foreground border-accent/60",
  Prescribed: "bg-success/20 text-success border-success/50",
  Pharmacy: "bg-accent/25 text-accent-foreground border-accent/60",
  "Pay Due": "bg-destructive/15 text-destructive border-destructive/40",
  Done: "bg-muted text-muted-foreground border-border",
};

// "Aaj ke Appointments" (24 Sep 2026, Dr. Yadav) — Reception used to have
// to check a completely separate /appointments screen to see who's
// scheduled today, then come BACK here to actually work the real queue.
// Same Arrive/Reschedule/Cancel actions as the standalone Appointments
// page (via the shared useAppointmentActions hook + RescheduleModal),
// just a more compact card since this sits above an already-busy Queue.
// Hidden entirely once nothing's left to act on (arrived/cancelled
// appointments drop out), not just empty.
function TodaysAppointmentsSection({ branchScope }: { branchScope?: string }) {
  const qc = useQueryClient();
  const apptDate = todayStr();
  const { data } = useQuery({
    queryKey: ["appointments", apptDate],
    queryFn: () => fetchAppointments(apptDate),
    refetchInterval: 30_000,
  });
  const { markArrived, markStarted, markCompleted, cancelAppointment } = useAppointmentActions([["today-queue"]]);
  const [rescheduling, setRescheduling] = useState<any | null>(null);
  // Today's queue (same query/cache the Queue below uses) — to tell which
  // appointment patients already have a token, and where they are now.
  const { data: queueToday } = useQuery({
    queryKey: ["today-queue", branchScope ?? "all"],
    queryFn: () => fetchTodayQueue(branchScope),
    refetchInterval: 15_000,
  });
  const digits = (m: unknown) => String(m ?? "").replace(/\D/g, "").slice(-10);
  // An appointment not tied to a patient (booked for a new caller) is matched
  // to today's visit by mobile number, so it still shows token and stage.
  const visitFor = (a: any) =>
    (queueToday ?? []).find(
      (v) =>
        v.visit_date === apptDate &&
        (a.patient_id ? v.patient_id === a.patient_id : digits(a.mobile).length === 10 && digits((v as any).patient?.mobile) === digits(a.mobile)),
    );

  const inScope = (data?.rows ?? []).filter((a: any) => !branchScope || a.branch === branchScope);
  const upcoming = inScope.filter((a: any) => a.status === "Confirmed" || a.status === "Tentative");
  // Arrived appointments used to vanish from here, so once a patient who
  // booked by phone walked in there was nothing to say she is sitting in the
  // waiting area (Dr. Yadav, 23 Oct 2026). They stay, with their token and
  // current stage.
  const arrived = inScope.filter((a: any) => a.status === "Arrived" || a.status === "Started");

  // Already has a token today (e.g. checked in through Register instead of
  // Arrived): just close the appointment — checking in again would give a
  // second token.
  const closeWithoutCheckIn = async (a: any) => {
    const res = await updateAppointmentStatus(a.id, "Arrived");
    if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };

  if (upcoming.length === 0 && arrived.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5" /> Aaj ke Appointments ({upcoming.length + arrived.length})
      </div>
      <ul className="space-y-2">
        {arrived.map((a: any) => {
          const v = visitFor(a);
          const stage = v ? statusLabel(v.visit_status) : null;
          return (
            <li key={a.id} className="rounded-xl bg-success/10 border border-success/40 p-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <span className="shrink-0 text-[11px] font-bold text-primary">{a.appointment_time}</span>
                  <span className="truncate text-sm font-semibold text-primary">{a.patient_name}</span>
                </div>
                <span className="shrink-0 text-[11px] font-bold text-success">
                  {a.status === "Started"
                    ? `▶ ${a.appointment_type === "CALL_BACK" ? "Call" : "Consultation"} chal rahi hai`
                    : "✅ Aa gaye"}
                  {v ? ` • ${v.token_number ?? "token"}` : ""}{stage ? ` • ${stage}` : ""}
                </span>
              </div>
              <div className="mt-1.5 flex gap-1.5 flex-wrap">
                {a.status === "Arrived" && (
                  <button onClick={() => markStarted(a)} className="rounded-full bg-success text-success-foreground px-3 py-1 text-[11px] font-bold">
                    ▶ Consultation shuru
                  </button>
                )}
                {a.status === "Arrived" && (
                  <>
                    <button onClick={() => setRescheduling(a)} className="rounded-full border border-primary/40 bg-surface text-primary px-3 py-1 text-[11px] font-bold">
                      🔁 Reschedule
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`${a.patient_name ?? "Ye"} ka Arrived galti se mark hua? Wapas "Confirmed" kar dein?`)) return;
                        const res = await updateAppointmentStatus(a.id, "Confirmed");
                        if (!res.success) { toast.error("Update nahi hua: " + res.error); return; }
                        qc.invalidateQueries({ queryKey: ["appointments"] });
                      }}
                      className="rounded-full border border-border bg-surface text-muted-foreground px-3 py-1 text-[11px] font-bold"
                    >
                      ↩ Galti se Arrived
                    </button>
                    <button
                      onClick={() => { if (window.confirm(`${a.patient_name ?? "Ye"} appointment cancel karein?`)) cancelAppointment(a); }}
                      className="rounded-full border border-destructive/40 bg-surface text-destructive px-3 py-1 text-[11px] font-bold"
                    >
                      ✖ Cancel
                    </button>
                  </>
                )}
                {a.status === "Started" && (
                  <button onClick={() => markCompleted(a)} className="rounded-full border border-success/50 bg-surface text-success px-3 py-1 text-[11px] font-bold">
                    ✓ Ho gaya
                  </button>
                )}
              </div>
              {stage === "Waiting" && (
                <div className="text-[11px] text-muted-foreground mt-1">Waiting area me baithe hain — doctor ko bhejna baaki.</div>
              )}
            </li>
          );
        })}
        {upcoming.map((a: any) => {
          const v = visitFor(a);
          return (
          <li key={a.id} className="rounded-xl bg-surface border border-border p-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="shrink-0 text-[11px] font-bold text-primary inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {a.appointment_time}
                </span>
                <span className="truncate text-sm font-semibold text-primary">{a.patient_name}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {apptTypeLabel((a.appointment_type ?? "FOLLOWUP") as ApptType)} • {branchLabel(a.branch)}
              </span>
            </div>
            {v && (
              <div className="mt-1 text-[11px] font-semibold text-success">
                ✅ Queue me pehle se hain — {v.token_number ?? "token"} • {statusLabel(v.visit_status)}
              </div>
            )}
            {/* Text labels added (25 Sep 2026) — Dr. Yadav: icon-only
                buttons here were confusing ("symbol se nahi likh kr
                batao"). Icon + tiny label, still compact enough for 5
                columns on a phone. */}
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              <a href={`tel:${a.mobile}`} className="rounded-lg bg-success text-success-foreground py-1.5 flex flex-col items-center gap-0.5">
                <PhoneCall className="h-3.5 w-3.5" />
                <span className="text-[9px] font-bold leading-none">Call</span>
              </a>
              <a href={`https://wa.me/91${a.mobile}`} target="_blank" rel="noreferrer" className="rounded-lg bg-accent text-accent-foreground py-1.5 flex flex-col items-center gap-0.5">
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="text-[9px] font-bold leading-none">WA</span>
              </a>
              <button
                onClick={() => (a.appointment_type === "CALL_BACK" ? markStarted(a) : v ? closeWithoutCheckIn(a) : markArrived(a))}
                className="rounded-lg bg-primary text-primary-foreground py-1.5 flex flex-col items-center gap-0.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="text-[9px] font-bold leading-none">
                  {a.appointment_type === "CALL_BACK" ? "Call shuru" : v ? "Done" : "Arrived"}
                </span>
              </button>
              <button onClick={() => setRescheduling(a)} className="rounded-lg bg-surface border border-primary/40 text-primary py-1.5 flex flex-col items-center gap-0.5">
                <CalendarClock className="h-3.5 w-3.5" />
                <span className="text-[9px] font-bold leading-none">Reschedule</span>
              </button>
              <button
                onClick={() => { if (!window.confirm(`${a.patient_name ?? "Ye"} appointment cancel karein?`)) return; cancelAppointment(a); }}
                className="rounded-lg bg-surface border border-destructive/40 text-destructive py-1.5 flex flex-col items-center gap-0.5"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span className="text-[9px] font-bold leading-none">Cancel</span>
              </button>
            </div>
          </li>
          );
        })}
      </ul>
      {rescheduling && (
        <RescheduleModal
          appt={rescheduling}
          onClose={() => setRescheduling(null)}
          onRescheduled={() => qc.invalidateQueries({ queryKey: ["appointments"] })}
        />
      )}
    </div>
  );
}

function QueuePage() {
  const navigate = useNavigate();
  const t = useT();
  const { user } = useAuth();
  const effectiveRole = useEffectiveRole();
  // Owner sees every branch; branch-scoped staff (RECP1/RECP2) only see
  // their own branch's queue. normalizeBranchKey guards against
  // users.branch ever drifting back into the label format ("Bajaj Nagar")
  // instead of the key ("BAJAJ_NAGAR") visits.branch actually uses — that
  // exact mismatch silently emptied every non-Owner login's queue until
  // fixed at the source (22 Sep 2026); this is the belt-and-suspenders.
  const branchScope = effectiveRole === "OWNER" ? undefined : normalizeBranchKey(user?.branch) || undefined;
  const [filter, setFilter] = useState<Filter>("All");
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }));
  }, []);

  // Any day can be opened; today also lists still-open visits from the
  // last 30 days, which are counted separately so the day's own totals
  // stay right.
  const [date, setDate] = useState(() => todayStr());
  const isToday = date === todayStr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: isToday ? ["today-queue", branchScope ?? "all"] : ["day-queue", branchScope ?? "all", date],
    queryFn: () => (isToday ? fetchTodayQueue(branchScope) : fetchQueueForDate(date, branchScope)),
    refetchInterval: isToday ? 15_000 : false,
  });

  // Entries made today/yesterday for OLDER dates ("Purani Tareekh Se Entry")
  // belong to their real visit date, so they are not in today's list —
  // Dr. Yadav (23 Oct 2026): "kal aur aaj entry hui hai lekin queue me nahi
  // dikh rahi". Listed here by the date they were entered, each date one tap away.
  const yesterdayStr = useMemo(() => {
    const d = new Date(`${todayStr()}T00:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("en-CA");
  }, []);
  const backfillToday = useQuery({ queryKey: ["backfilled", todayStr()], queryFn: () => fetchBackfilledEntries(todayStr()), staleTime: 60_000 });
  const backfillYesterday = useQuery({ queryKey: ["backfilled", yesterdayStr], queryFn: () => fetchBackfilledEntries(yesterdayStr), staleTime: 60_000 });
  const noPayment = useQuery({ queryKey: ["backfill-no-payment"], queryFn: fetchBackfilledWithoutPayment, staleTime: 5 * 60_000 });
  const noPaymentCount = noPayment.data?.length ?? 0;
  const backfillGroups = useMemo(() => {
    const groups: { label: string; total: number; dates: { date: string; n: number }[] }[] = [];
    for (const [label, rowsB] of [["Aaj", backfillToday.data], ["Kal", backfillYesterday.data]] as const) {
      if (!rowsB || rowsB.length === 0) continue;
      const m = new Map<string, number>();
      for (const r of rowsB) m.set(r.visit_date, (m.get(r.visit_date) ?? 0) + 1);
      groups.push({ label, total: rowsB.length, dates: Array.from(m, ([d, n]) => ({ date: d, n })).sort((a, b) => b.date.localeCompare(a.date)) });
    }
    return groups;
  }, [backfillToday.data, backfillYesterday.data]);

  // Patients who booked an appointment for today — shown on their queue row
  // ("📞 Appt 17:00"), so staff can tell who came after a phone booking.
  const { data: apptToday } = useQuery({
    queryKey: ["appointments", todayStr()],
    queryFn: () => fetchAppointments(todayStr()),
    refetchInterval: 30_000,
  });
  const apptByPatient = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of apptToday?.rows ?? []) {
      if (a.status === "Cancelled") continue;
      // Linked appointments by patient; unlinked ones (new callers) by mobile.
      if (a.patient_id) m.set(a.patient_id, a);
      else if (String(a.mobile ?? "").replace(/\D/g, "").length >= 10) m.set("m:" + String(a.mobile).replace(/\D/g, "").slice(-10), a);
    }
    return m;
  }, [apptToday]);
  const apptForRow = (r: any) =>
    apptByPatient.get(r.patient_id) ?? apptByPatient.get("m:" + String(r.patient?.mobile ?? "").replace(/\D/g, "").slice(-10));

  const rows = data ?? [];
  // Appointment / Reschedule buttons under each of today's patients.
  const apptByPatientNext = usePatientAppointments(
    rows.filter((r) => r.visit_date === todayStr()).map((r) => r.patient_id),
  ).data;
  // Advance already paid by patients still in the queue, and the modal to take one.
  const advanceByVisit = useQuery({
    queryKey: ["advance-by-visit", rows.filter((r) => r.visit_status !== "DONE").map((r) => r.id).sort()],
    queryFn: () => fetchAdvanceByVisit(rows.filter((r) => r.visit_status !== "DONE").map((r) => r.id)),
    enabled: rows.length > 0,
    refetchInterval: 30_000,
  }).data;
  const [advanceFor, setAdvanceFor] = useState<{ visitId: string; name: string } | null>(null);
  const stats = useMemo(() => {
    const day = rows.filter((r) => r.visit_date === date);
    const waiting = day.filter((r) => ["REGISTERED", "WAITING", "CASE_TAKING", "WAITING_DOCTOR"].includes(r.visit_status)).length;
    const done = day.filter((r) => r.visit_status === "DONE").length;
    const online = day.filter((r) => r.visit_type === "VIDEO").length;
    return { total: day.length, waiting, done, online, oldPending: rows.length - day.length };
  }, [rows, date]);
  const countsByDate = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const r of rows) {
      const c = m.get(r.visit_date) ?? { total: 0, done: 0 };
      c.total++;
      if (r.visit_status === "DONE") c.done++;
      m.set(r.visit_date, c);
    }
    return m;
  }, [rows]);

  const filtered = rows.filter((r) => {
    const s = statusLabel(r.visit_status);
    if (filter === "All") return true;
    if (filter === "Waiting") return s === "Waiting" || s === "Case Taking";
    if (filter === "Consultation") return s === "Prescribed";
    if (filter === "Pharmacy") return s === "Pharmacy" || s === "Pay Due";
    if (filter === "Done") return s === "Done";
    return true;
  });

  return (
    <MobileShell
      title="Yadav Homeo Clinic"
      subtitle={today ? `Jaipur • ${today}` : "Jaipur"}
      right={
        <Link
          to="/register"
          className="h-9 px-3 rounded-full bg-accent text-accent-foreground text-xs font-bold inline-flex items-center gap-1 shadow-sm"
        >
          {/* Was "+ New" — read as "new patients only", so Reception
              couldn't tell this same button/screen also checks in a
              returning/follow-up patient (mobile number auto-detects
              them). Found live 22 Sep 2026. */}
          <Plus className="h-4 w-4" /> Register
        </Link>
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="flex-1 rounded-lg bg-surface border border-input px-3 py-2 text-sm"
          aria-label="Kis din ki queue dekhni hai"
        />
        {!isToday && (
          <button onClick={() => setDate(todayStr())} className="rounded-full border border-border bg-surface px-3 py-2 text-xs font-semibold text-primary">
            Aaj
          </button>
        )}
      </div>
      <FlowBar branch={branchScope} />
      {noPaymentCount > 0 && (
        <Link
          to="/backfill-payments"
          className="mb-2 block rounded-xl bg-destructive/10 border border-destructive/30 p-2.5 text-[12px] font-semibold text-destructive"
        >
          💰 {noPaymentCount} purani entry me payment darj nahi hai — daalne ke liye dabao →
        </Link>
      )}
      {backfillGroups.length > 0 && (
        <div className="mb-2 rounded-xl bg-accent/20 border border-accent/40 p-2.5">
          <div className="text-[11px] font-bold text-primary mb-1.5">📝 Purani tareekh ki entries — queue me unki visit ki date pe milengi</div>
          {backfillGroups.map((g) => (
            <div key={g.label} className="mb-1 last:mb-0">
              <div className="text-[11px] text-muted-foreground mb-1">{g.label} {g.total} entry hui:</div>
              <div className="flex flex-wrap gap-1.5">
                {g.dates.map((d) => (
                  <button
                    key={d.date}
                    onClick={() => setDate(d.date)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                      date === d.date ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border",
                    )}
                  >
                    {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} • {d.n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] font-semibold text-muted-foreground px-1 mb-1">
        {isToday ? "Aaj ke" : new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + " ke"} patient
        {isToday && stats.oldPending > 0 ? ` • purane pending alag: ${stats.oldPending}` : ""}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Total", value: stats.total, tone: "primary" },
          { label: "Waiting", value: stats.waiting, tone: "accent" },
          { label: "Done", value: stats.done, tone: "success" },
          { label: "Online", value: stats.online, tone: "primary" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-surface border border-border px-2 py-2.5 text-center">
            <div
              className={cn(
                "text-base font-bold leading-tight",
                s.tone === "success" && "text-success",
                s.tone === "accent" && "text-accent-foreground",
                s.tone === "primary" && "text-primary",
              )}
            >
              {s.value}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Second quick action — Reception asked for this to be visible from
          the same hub as Register, not buried inside a specific patient's
          profile (the only place LogInteractionModal was reachable from
          before). Found live 22 Sep 2026. */}
      <Link
        to="/complaint-call"
        className="mt-3 w-full rounded-xl bg-surface border border-border px-3 py-2.5 text-[12px] font-bold text-primary flex items-center justify-center gap-1.5"
      >
        📞 Complaint / Support Call
      </Link>

      <TodaysAppointmentsSection branchScope={branchScope} />

      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {filters.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition",
                active ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-foreground border-border",
              )}
            >
              {f}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <LoadingBlock label={t("Queue load ho rahi hai…")} />
      ) : isError ? (
        <ErrorBlock error={error} onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyBlock label={isToday ? t("Aaj koi patient nahi mila.") : "Is din koi patient nahi mila."} />
      ) : (
        <ul className="mt-3 space-y-2">
          {filtered.map((r, i) => {
            const s = statusLabel(r.visit_status);
            const due = Number(r.patient?.current_balance ?? 0);
            const daysOld = r.visit_status !== "DONE" && r.visit_date !== todayStr()
              ? Math.max(0, Math.floor((Date.parse(todayStr()) - Date.parse(r.visit_date)) / 86_400_000))
              : 0;
            // Date headers (25 Sep 2026) — Dr. Yadav: "token date wise
            // nahi hai" — the list was already sorted newest-date-first,
            // but with no visible date label, just a relative "Xd
            // pending" pill per token, it wasn't obvious at a glance
            // which calendar date a group belonged to.
            const showDateHeader = i === 0 || filtered[i - 1].visit_date !== r.visit_date;
            return (
              <Fragment key={r.id}>
                {showDateHeader && (
                  <li className="first:pt-0">
                    <DayHeader
                      date={r.visit_date}
                      label={(() => {
                        const c = countsByDate.get(r.visit_date);
                        if (!c) return undefined;
                        return r.visit_date === date
                          ? `${c.total} patient • ${c.done} done`
                          : `${c.total - c.done} pending`;
                      })()}
                    />
                  </li>
                )}
              <li>
                <button
                  onClick={() => {
                    // PAYMENT (Pay Due) or DONE (view receipt / no-op) → payment screen.
                    // Everything else (REGISTERED/WAITING/CASE_TAKING/WAITING_DOCTOR/PRESCRIBED/PHARMACY)
                    // → patient profile so reception can see clinical context, not a forced pay screen.
                    const status = r.visit_status;
                    if (status === "PAYMENT" || status === "DONE") {
                      navigate({ to: "/pay/$id", params: { id: r.id } });
                    } else {
                      navigate({ to: "/patient/$id", params: { id: r.patient_id } });
                    }
                  }}
                  className="w-full text-left rounded-xl bg-surface border border-border p-3 flex items-center gap-3 shadow-sm hover:border-primary/40 active:scale-[0.99] transition"
                >

                  <div className="shrink-0 h-12 w-12 rounded-xl bg-primary text-primary-foreground grid place-items-center">
                    <div className="text-[9px] uppercase opacity-70 leading-none">Token</div>
                    <div className="text-sm font-bold leading-tight">{r.token_number ?? "—"}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="truncate font-semibold text-sm text-primary">{r.patient?.name ?? "Unknown"}</p>
                      {formatCardNumber(r.patient?.card_series, r.patient?.card_register, r.patient?.card_number) ? (
                        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                          {formatCardNumber(r.patient?.card_series, r.patient?.card_register, r.patient?.card_number)}
                        </span>
                      ) : (
                        // Card number is the real identifier now (Dr. Yadav:
                        // "MERE WALE NUMBER HI CARD NUMBER HAI") — the
                        // auto-generated YHC-code only ever shows as a
                        // fallback for the few patients with no card yet.
                        <span className="shrink-0 text-[10px] text-muted-foreground">{systemIdLabel(r.patient?.patient_code)}</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{r.chief_complaint || "—"}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{branchLabel(r.branch)}</span>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusStyles[s] ?? "bg-muted text-muted-foreground border-border")}>
                        {s}
                      </span>
                      {r.visit_date === todayStr() && apptForRow(r) && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/30">
                          📞 Appt {apptForRow(r).appointment_time}
                        </span>
                      )}
                      {daysOld > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/30">
                          {daysOld}d pending
                        </span>
                      )}
                      {due > 0 && (
                        <span className="text-[10px] font-semibold text-destructive">₹{due} due</span>
                      )}
                    </div>
                  </div>
                </button>
                {/* Aa gaya / Reschedule / Cancel under EVERY patient entry, plus the
                    appointment's own steps (call / consultation shuru) when there
                    is one — outside the row's button, buttons can't nest. */}
                {r.visit_status !== "DONE" && r.patient && (
                  <div className="px-1 mt-1.5 space-y-1.5">
                    <VisitStatusBar
                      visit={r}
                      patient={{ id: r.patient_id, name: r.patient.name, mobile: r.patient.mobile, branch: r.patient.branch, wa_consent: r.patient.wa_consent }}
                      appt={apptByPatientNext?.get(r.patient_id)}
                      extra={
                        <button
                          type="button"
                          onClick={() => setAdvanceFor({ visitId: r.id, name: r.patient?.name ?? "Patient" })}
                          className="rounded-full border border-primary/40 bg-surface px-2.5 py-1 text-[11px] font-bold text-primary"
                        >
                          💰 Advance payment
                        </button>
                      }
                    />
                    {r.visit_date === todayStr() && (
                      <PatientApptBar
                        hideCommon
                        patient={{ id: r.patient_id, name: r.patient.name, mobile: r.patient.mobile, branch: r.patient.branch, wa_consent: r.patient.wa_consent }}
                        appt={apptByPatientNext?.get(r.patient_id)}
                      />
                    )}
                  </div>
                )}
                {r.visit_status !== "DONE" && (advanceByVisit?.get(r.id) ?? 0) > 0 && (
                  <div className="px-1 mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">
                      💰 Advance ₹{(advanceByVisit?.get(r.id) ?? 0).toLocaleString("en-IN")} diya — consultation baaki
                    </span>
                  </div>
                )}
              </li>
              </Fragment>
            );
          })}
        </ul>
      )}
      {advanceFor && (
        <AdvancePaymentModal visitId={advanceFor.visitId} patientName={advanceFor.name} onClose={() => setAdvanceFor(null)} />
      )}
    </MobileShell>
  );
}
