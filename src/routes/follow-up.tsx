import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/yhc/MobileShell";
import { useFollowUps, updateFollowUp, type FollowUpStatus } from "@/lib/yhc-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/follow-up")({
  head: () => ({ meta: [{ title: "Follow-up Calls — YHC Jaipur" }] }),
  component: FollowUpPage,
});

const filters = ["All", "Overdue", "Called", "Pending"] as const;
type Filter = (typeof filters)[number];

function toneFor(days: number, status: FollowUpStatus) {
  if (status === "Called" || status === "Done") return "green";
  if (days >= 7) return "red";
  if (days >= 1) return "amber";
  return "green";
}

function FollowUpPage() {
  const list = useFollowUps();
  const [filter, setFilter] = useState<Filter>("All");

  // Compute "today" client-side to avoid SSR hydration mismatch on days.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);

  const withDays = useMemo(() => {
    if (now === null) return [];
    return list.map((f) => ({ ...f, days: Math.floor((now - f.lastVisit) / 86_400_000) }));
  }, [list, now]);

  const stats = useMemo(() => {
    const dueToday = withDays.filter((f) => f.status === "Pending" && f.days >= 1 && f.days < 7).length;
    const overdue = withDays.filter((f) => f.status === "Pending" && f.days >= 7).length;
    const done = withDays.filter((f) => f.status === "Done" || f.status === "Called").length;
    return { dueToday, overdue, done };
  }, [withDays]);

  const filtered = withDays.filter((f) => {
    if (filter === "All") return true;
    if (filter === "Overdue") return f.status === "Pending" && f.days >= 7;
    if (filter === "Called") return f.status === "Called";
    if (filter === "Pending") return f.status === "Pending";
    return true;
  });

  return (
    <MobileShell title="Follow-up Calls" subtitle="Today" showBack>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Due Today" value={stats.dueToday} tone="accent" />
        <Stat label="Overdue" value={stats.overdue} tone="destructive" />
        <Stat label="Done" value={stats.done} tone="success" />
      </div>

      {/* Filters */}
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

      <ul className="mt-3 space-y-2">
        {now === null && (
          <li className="text-center text-sm text-muted-foreground py-6">Loading…</li>
        )}
        {now !== null && filtered.length === 0 && (
          <li className="text-center text-sm text-muted-foreground py-10">No follow-ups here.</li>
        )}
        {filtered.map((f) => {
          const tone = toneFor(f.days, f.status);
          const borderClass =
            tone === "red" ? "border-l-destructive" :
            tone === "amber" ? "border-l-accent" :
            "border-l-success";
          return (
            <li
              key={f.id}
              className={cn(
                "rounded-xl bg-surface border border-border border-l-4 p-3",
                borderClass,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-sm text-primary">{f.patientName}</p>
                  <p className="truncate text-xs text-muted-foreground">{f.disease}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Last visit {f.days}d ago
                    {f.status === "Pending" && f.days >= 7 && (
                      <span className="ml-2 text-destructive font-semibold">
                        {f.days - 7}d overdue
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                    f.status === "Called" && "bg-success/15 text-success border-success/40",
                    f.status === "Done" && "bg-muted text-muted-foreground border-border",
                    f.status === "Pending" && "bg-accent/25 text-accent-foreground border-accent/60",
                  )}
                >
                  {f.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <a
                  href={`tel:${f.mobile}`}
                  onClick={() => updateFollowUp(f.id, "Called")}
                  className="rounded-lg bg-success text-success-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1"
                >
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
                <a
                  href={`https://wa.me/91${f.mobile}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => updateFollowUp(f.id, "Called")}
                  className="rounded-lg bg-accent text-accent-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
                <button
                  onClick={() => {
                    updateFollowUp(f.id, "Done");
                    toast.success(`${f.patientName} marked done`);
                  }}
                  className="rounded-lg bg-surface border border-border text-primary py-2 text-xs font-bold inline-flex items-center justify-center gap-1"
                >
                  <Check className="h-3.5 w-3.5" /> Done
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </MobileShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "accent" | "destructive" | "success" }) {
  return (
    <div className="rounded-xl bg-surface border border-border px-2 py-3 text-center">
      <div
        className={cn(
          "text-xl font-bold leading-tight",
          tone === "destructive" && "text-destructive",
          tone === "accent" && "text-accent-foreground",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}
