import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { MASTER } from "@/lib/yhc-pharmacy";
import { PHARMACY_NAV } from "./pharmacy.index";

export const Route = createFileRoute("/pharmacy/master")({
  head: () => ({ meta: [{ title: "Medicine Master — Pharmacy" }, { name: "robots", content: "noindex" }] }),
  component: MasterPage,
});

function MasterPage() {
  const [q, setQ] = useState("");
  const list = q ? MASTER.filter((m) => m.med.toLowerCase().includes(q.toLowerCase())) : MASTER;
  return (
    <RoleShell
      title="Medicine Master"
      subtitle="Reference list"
      nav={PHARMACY_NAV}
      right={
        <button
          onClick={() => toast("Add new medicine")}
          className="rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5"
        >
          + Add
        </button>
      }
    >
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search medicine"
          className="w-full rounded-full bg-surface border-2 border-accent pl-10 pr-4 py-3 text-sm text-primary outline-none"
        />
      </div>
      <ul className="mt-4 space-y-2.5">
        {list.map((m, i) => (
          <li key={i} className="rounded-2xl bg-surface border border-border p-3.5">
            <div className="font-bold text-primary text-[15px]">{m.med}</div>
            <div className="text-[12px] text-muted-foreground mt-0.5">Potencies: {m.potencies}</div>
            <div className="text-[12px] text-muted-foreground">{m.type}</div>
          </li>
        ))}
      </ul>
    </RoleShell>
  );
}
