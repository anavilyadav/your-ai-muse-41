import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthGate } from "@/components/yhc/AuthGate";
import { BarChart3, CalendarDays, ChevronRight, IndianRupee, PhoneCall, Truck, Users } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";

export const Route = createFileRoute("/tasks")({
  head: () => ({ meta: [{ title: "Reception Tasks — YHC Jaipur" }] }),
  component: () => (
    <AuthGate allow={["RECP1", "RECP2", "OWNER"]}>
      <TasksPage />
    </AuthGate>
  ),
});

function TasksPage() {
  return (
    <MobileShell title="Reception Tasks" subtitle="Today" showBack>
      {/* Shortcuts */}
      <div className="space-y-2">
        <ShortcutLink to="/appointments" icon={CalendarDays} title="Appointments" sub="Today's schedule • Confirm / Arrived" />
        <ShortcutLink to="/follow-up" icon={PhoneCall} title="Follow-up Calls" sub="CRM • Call, WhatsApp, Mark Done" />
        <ShortcutLink to="/leads" icon={Users} title="Lead CRM" sub="Enquiries • HOT / Warm / Convert" />
        <ShortcutLink to="/delivery" icon={Truck} title="Delivery Tracking" sub="Packed → Dispatched → Delivered" />
        <ShortcutLink to="/summary" icon={BarChart3} title="Day Summary" sub="Revenue • Modes • Sources" />
        <ShortcutLink to="/outstanding" icon={IndianRupee} title="Outstanding Dues" sub="Pending payments — call/WhatsApp worklist" />
      </div>
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
