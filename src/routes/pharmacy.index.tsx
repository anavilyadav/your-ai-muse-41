import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pill, Package, BookOpen } from "lucide-react";
import { RoleShell, Stat, Badge, type NavItem } from "@/components/yhc/RoleShell";
import { PHARMA_QUEUE } from "@/lib/yhc-pharmacy";

export const Route = createFileRoute("/pharmacy/")({
  head: () => ({ meta: [{ title: "Pharmacy Queue — YHC" }, { name: "robots", content: "noindex" }] }),
  component: PharmacyQueue,
});

export const PHARMACY_NAV: NavItem[] = [
  { to: "/pharmacy", label: "Queue", icon: Pill, exact: true },
  { to: "/pharmacy/inventory", label: "Inventory", icon: Package },
  { to: "/pharmacy/master", label: "Master", icon: BookOpen },
];

function PharmacyQueue() {
  const navigate = useNavigate();
  return (
    <RoleShell title="Pharmacy Queue" subtitle="Yadav Homeo Clinic • Jaipur" nav={PHARMACY_NAV}>
      <div className="flex gap-2">
        <Stat v={3} l="To Dispense" tone="accent" />
        <Stat v={14} l="Done Today" tone="success" />
        <Stat v={2} l="Low Stock" tone="destructive" />
      </div>
      <ul className="mt-4 space-y-2.5">
        {PHARMA_QUEUE.map((p) => (
          <li key={p.token}>
            <button
              onClick={() => navigate({ to: "/pharmacy/dispense/$token", params: { token: p.token } })}
              className="w-full text-left rounded-2xl bg-surface border border-border p-3.5 hover:border-primary/40 active:scale-[0.99] transition"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Badge tone="primary">{p.token}</Badge>
                  <span className="font-bold text-[15px] text-primary">{p.name}</span>
                </div>
                <Badge tone={p.status === "Preparing" ? "primary" : "warn"}>{p.status}</Badge>
              </div>
              <div className="text-[12px] text-muted-foreground mt-1">{p.branch}</div>
              <div className="mt-2 space-y-1">
                {p.rx.map((r, i) => (
                  <div key={i} className="text-[13px] text-primary bg-accent/25 rounded-lg px-2.5 py-1.5">
                    {r.med} {r.potency !== "—" && r.potency} • {r.qty} {r.form} • {r.freq}
                  </div>
                ))}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </RoleShell>
  );
}
