import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MapPin, Package, Truck } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { cn } from "@/lib/utils";
import {
  DELIVERY_STEPS,
  updateDelivery,
  useDeliveries,
  type DeliveryStatus,
} from "@/lib/yhc-store";
import { toast } from "sonner";

export const Route = createFileRoute("/delivery")({
  head: () => ({ meta: [{ title: "Delivery Tracking — YHC Jaipur" }] }),
  component: DeliveryPage,
});

const partnerIcon = {
  Swiggy: Truck,
  Porter: Truck,
  Courier: Package,
  "Self-pickup": Package,
} as const;

function DeliveryPage() {
  const deliveries = useDeliveries();

  const stats = useMemo(() => {
    const active = deliveries.filter(
      (d) => d.status !== "Delivered" && d.status !== "Issue",
    ).length;
    const delivered = deliveries.filter((d) => d.status === "Delivered").length;
    const issues = deliveries.filter((d) => d.status === "Issue").length;
    return { active, delivered, issues };
  }, [deliveries]);

  return (
    <MobileShell title="Delivery Tracking" subtitle="Active orders" showBack>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Delivered" value={stats.delivered} tone="success" />
        <StatCard label="Issues" value={stats.issues} tone="destructive" />
      </div>

      <ul className="mt-4 space-y-3">
        {deliveries.map((d) => (
          <DeliveryCard key={d.id} d={d} />
        ))}
      </ul>
    </MobileShell>
  );
}

function DeliveryCard({
  d,
}: {
  d: ReturnType<typeof useDeliveries>[number];
}) {
  const [note, setNote] = useState(d.note ?? "");
  const Icon = partnerIcon[d.partner];
  const isIssue = d.status === "Issue";

  const currentIdx = DELIVERY_STEPS.indexOf(d.status as DeliveryStatus);

  return (
    <li className="rounded-xl bg-surface border border-border p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{d.patientName}</span>
            <span className="text-[10px] font-bold text-accent-foreground bg-accent rounded-full px-1.5 py-0.5">
              {d.token}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Icon className="h-3.5 w-3.5" /> {d.partner}
            <span className="mx-1">•</span>
            <MapPin className="h-3 w-3" /> {d.area}
          </div>
        </div>
        {isIssue && (
          <span className="shrink-0 flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/15 text-destructive px-2 py-0.5 text-[10px] font-semibold">
            <AlertTriangle className="h-3 w-3" /> Issue
          </span>
        )}
      </div>

      {/* Status steps */}
      <div className="mt-3 flex items-center gap-1">
        {DELIVERY_STEPS.map((step, i) => {
          const active = !isIssue && i === currentIdx;
          const done = !isIssue && i < currentIdx;
          const complete = !isIssue && d.status === "Delivered";
          return (
            <div key={step} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={cn(
                  "h-1.5 w-full rounded-full transition-colors",
                  active && "bg-accent",
                  done && "bg-success",
                  complete && "bg-success",
                  !active && !done && !complete && "bg-muted",
                )}
              />
              <span
                className={cn(
                  "text-[9px] leading-tight text-center",
                  active && "text-accent-foreground font-semibold",
                  done && "text-success",
                  !active && !done && "text-muted-foreground",
                )}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => updateDelivery(d.id, { note })}
        placeholder="Tracking note (AWB, driver, etc.)"
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            updateDelivery(d.id, { status: "Delivered", note });
            toast.success(`${d.patientName} — marked delivered`);
          }}
          disabled={d.status === "Delivered"}
          className="flex items-center justify-center gap-1 rounded-lg bg-success text-success-foreground py-2 text-xs font-semibold disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Mark Delivered
        </button>
        <button
          onClick={() => {
            updateDelivery(d.id, { status: "Issue", note });
            toast.error(`${d.patientName} — issue flagged`);
          }}
          className="flex items-center justify-center gap-1 rounded-lg bg-destructive text-destructive-foreground py-2 text-xs font-semibold"
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Issue / Return
        </button>
      </div>
    </li>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive" | "success";
}) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <div
        className={cn(
          "text-lg font-bold",
          tone === "destructive" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
