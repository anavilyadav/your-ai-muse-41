import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RoleShell, Stat } from "@/components/yhc/RoleShell";
import { LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { PHARMACY_NAV } from "./pharmacy.index";
import { fetchInventory } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pharmacy/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Pharmacy" }, { name: "robots", content: "noindex" }] }),
  component: InventoryPage,
});

function isLow(row: any): boolean {
  const stock = Number(row.stock_drams ?? row.stock ?? 0);
  const low = Number(row.reorder_level ?? row.low ?? 20);
  return stock <= low;
}

function InventoryPage() {
  const [f, setF] = useState<"All" | "Low Stock">("All");
  const { data, isLoading } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const rows = (data ?? []) as any[];
  const list = f === "Low Stock" ? rows.filter(isLow) : rows;

  return (
    <RoleShell
      title="Inventory"
      subtitle="Current stock levels"
      nav={PHARMACY_NAV}
      right={
        <button
          onClick={() => toast("Add stock entry")}
          className="rounded-full bg-accent text-accent-foreground text-[12px] font-bold px-3 py-1.5"
        >
          + Stock
        </button>
      }
    >
      <div className="flex gap-2">
        <Stat v={rows.length} l="Total Items" />
        <Stat v={rows.filter(isLow).length} l="Low Stock" tone="destructive" />
      </div>
      <div className="mt-3 flex gap-2">
        {(["All", "Low Stock"] as const).map((x) => (
          <button
            key={x}
            onClick={() => setF(x)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12px] font-semibold border",
              f === x ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-primary border-border",
            )}
          >
            {x}
          </button>
        ))}
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyBlock label="Inventory khaali hai." />
      ) : (
        <ul className="mt-4 space-y-2.5">
          {list.map((i, idx) => {
            const low = isLow(i);
            const stock = Number(i.stock_drams ?? i.stock ?? 0);
            const unit = i.unit ?? "drams";
            return (
              <li
                key={i.id ?? idx}
                className={cn(
                  "rounded-2xl bg-surface border border-border border-l-[4px] p-3.5 flex justify-between items-center",
                  low ? "border-l-destructive" : "border-l-success",
                )}
              >
                <div>
                  <div className="font-bold text-primary text-[15px]">
                    {i.medicine_name ?? i.med} {i.potency && i.potency !== "—" && i.potency}
                  </div>
                  {low && <div className="text-[12px] text-destructive font-semibold mt-0.5">⚠ Low stock — reorder soon</div>}
                </div>
                <div className="text-right">
                  <div className={cn("text-lg font-extrabold", low ? "text-destructive" : "text-primary")}>{stock}</div>
                  <div className="text-[11px] text-muted-foreground">{unit}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </RoleShell>
  );
}
