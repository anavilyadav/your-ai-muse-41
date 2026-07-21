import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, CalendarDays, CheckCircle2, ChevronRight, Circle, Crown, PhoneCall, Pill, Stethoscope, Truck, Users } from "lucide-react";
import { useState } from "react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  head: () => ({ meta: [{ title: "Reception Tasks — YHC Jaipur" }] }),
  component: TasksPage,
});

const seedTasks = [
  { id: 1, label: "Call back Priya Nair for pending payment (T-04)", tone: "due" },
  { id: 2, label: "Confirm tomorrow's pre-booked appointments (WhatsApp)", tone: "normal" },
  { id: 3, label: "Restock consultation slips at Bajaj Nagar", tone: "normal" },
  { id: 4, label: "Follow-up: Aarav Gupta courier delivery status", tone: "normal" },
  { id: 5, label: "Send birthday wish to 2 patients (see reminders)", tone: "normal" },
] as const;

function TasksPage() {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (id: number) => {
    setDone((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  return (
    <MobileShell title="Reception Tasks" subtitle="Today" showBack>
      {/* Shortcuts */}
      <div className="space-y-2">
        <ShortcutLink to="/appointments" icon={CalendarDays} title="Appointments" sub="Today's schedule • Confirm / Arrived" />
        <ShortcutLink to="/follow-up" icon={PhoneCall} title="Follow-up Calls" sub="CRM • Call, WhatsApp, Mark Done" />
        <ShortcutLink to="/leads" icon={Users} title="Lead CRM" sub="Enquiries • HOT / Warm / Convert" />
        <ShortcutLink to="/delivery" icon={Truck} title="Delivery Tracking" sub="Packed → Dispatched → Delivered" />
        <ShortcutLink to="/summary" icon={BarChart3} title="Day Summary" sub="Revenue • Modes • Sources" />
        <ShortcutLink to="/doctor" icon={Stethoscope} title="Doctor App" sub="Open prescribing / case-taking workspace" />
      </div>

      <div className="mt-4 text-[10px] uppercase tracking-wider text-muted-foreground px-1">
        Today's Checklist
      </div>
      <ul className="mt-2 space-y-2">
        {seedTasks.map((t) => {
          const checked = done.has(t.id);
          return (
            <li key={t.id}>
              <button
                onClick={() => toggle(t.id)}
                className={cn(
                  "w-full rounded-xl border p-3 flex items-start gap-3 text-left transition",
                  checked ? "bg-muted border-border opacity-70" : "bg-surface border-border",
                  t.tone === "due" && !checked && "border-destructive/40",
                )}
              >
                {checked ? (
                  <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <span
                  className={cn(
                    "text-sm text-foreground",
                    checked && "line-through text-muted-foreground",
                  )}
                >
                  {t.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </MobileShell>
  );
}

function ShortcutLink({
  to,
  icon: Icon,
  title,
  sub,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl bg-primary text-primary-foreground p-3.5 shadow-sm"
    >
      <span className="h-10 w-10 rounded-full bg-accent text-accent-foreground grid place-items-center">
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-[11px] opacity-80">{sub}</span>
      </span>
      <ChevronRight className="h-5 w-5 opacity-80" />
    </Link>
  );
}
