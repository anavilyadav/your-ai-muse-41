import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, PhoneCall, MessageCircle, CheckCircle2, Clock, XCircle, CalendarClock } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { AuthGate, LoadingBlock, EmptyBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { fetchTodayQueue, fetchAppointments, branchLabel, statusLabel, normalizeBranchKey, formatCardNumber, apptTypeLabel, type ApptType } from "@/lib/db";
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
  const { markArrived, cancelAppointment } = useAppointmentActions([["today-queue"]]);
  const [rescheduling, setRescheduling] = useState<any | null>(null);

  const upcoming = (data?.rows ?? []).filter(
    (a: any) => (a.status === "Confirmed" || a.status === "Tentative") && (!branchScope || a.branch === branchScope),
  );

  if (upcoming.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5" /> Aaj ke Appointments ({upcoming.length})
      </div>
      <ul className="space-y-2">
        {upcoming.map((a: any) => (
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
              <button onClick={() => markArrived(a)} className="rounded-lg bg-primary text-primary-foreground py-1.5 flex flex-col items-center gap-0.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="text-[9px] font-bold leading-none">Arrived</span>
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
        ))}
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

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["today-queue", branchScope ?? "all"],
    queryFn: () => fetchTodayQueue(branchScope),
    refetchInterval: 15_000,
  });


  const rows = data ?? [];
  const stats = useMemo(() => {
    const waiting = rows.filter((r) => ["REGISTERED", "WAITING", "CASE_TAKING", "WAITING_DOCTOR"].includes(r.visit_status)).length;
    const done = rows.filter((r) => r.visit_status === "DONE").length;
    return { total: rows.length, waiting, done };
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
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Total", value: stats.total, tone: "primary" },
          { label: "Waiting", value: stats.waiting, tone: "accent" },
          { label: "Done", value: stats.done, tone: "success" },
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
        <EmptyBlock label={t("Aaj koi patient nahi mila.")} />
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
                  <li className="pt-1 first:pt-0">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground px-1">
                      {r.visit_date === todayStr()
                        ? "Aaj"
                        : new Date(r.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </div>
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
                        <span className="shrink-0 text-[10px] text-muted-foreground">{r.patient?.patient_code ?? ""}</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{r.chief_complaint || "—"}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{branchLabel(r.branch)}</span>
                      <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", statusStyles[s] ?? "bg-muted text-muted-foreground border-border")}>
                        {s}
                      </span>
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
              </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </MobileShell>
  );
}
