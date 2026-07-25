import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { LoadingBlock } from "@/components/yhc/AuthGate";
import { fetchSettings, upsertSetting } from "@/lib/db";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/control")({
  head: () => ({ meta: [{ title: "Control Centre — Owner" }, { name: "robots", content: "noindex" }] }),
  component: ControlPage,
});

const CONTROLS: { section: string; items: { k: string; on: boolean }[] }[] = [
  {
    section: "Clinic Operations",
    items: [
      { k: "Online booking", on: true },
      { k: "Walk-in registration", on: true },
      { k: "Courier delivery", on: true },
      { k: "Home visits", on: false },
    ],
  },
  {
    section: "Feature Modules",
    items: [
      { k: "Lead CRM", on: true },
      { k: "Follow-up CRM", on: true },
      { k: "WhatsApp automation", on: true },
      { k: "Marketing module", on: false },
    ],
  },
  {
    section: "Privacy & Access",
    items: [
      { k: "Hidden Identity Mode", on: true },
      { k: "Case-DR patient access", on: false },
      { k: "Backup doctor access", on: false },
    ],
  },
  {
    section: "Payment & Delivery",
    items: [
      { k: "Advance payment", on: false },
      { k: "COD delivery", on: true },
      { k: "Partial payment", on: true },
    ],
  },
];

function ControlPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [state, setState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const map: Record<string, boolean> = {};
    CONTROLS.forEach((sec) => sec.items.forEach((it) => (map[it.k] = it.on)));
    (data ?? []).forEach((r: any) => {
      if (r.key in map || CONTROLS.some((s) => s.items.some((i) => i.k === r.key))) {
        map[r.key] = r.value === "true" || r.value === true;
      }
    });
    setState(map);
  }, [data]);

  const toggle = async (k: string) => {
    const next = !state[k];
    setState((p) => ({ ...p, [k]: next }));
    try {
      await upsertSetting(k, String(next));
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: any) {
      setState((p) => ({ ...p, [k]: !next }));
      toast.error(e?.message ?? "Failed to save");
    }
  };

  return (
    <RoleShell
      title="Owner Control Centre"
      subtitle="Master switches"
      nav={OWNER_NAV}
      right={
        <Link
          to="/owner/health"
          className="rounded-full bg-white/15 text-primary-foreground text-[11px] px-3 py-1.5 font-semibold inline-flex items-center gap-1"
        >
          <Activity className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          {CONTROLS.map((sec) => (
            <div key={sec.section}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                {sec.section}
              </div>
              <div className="rounded-2xl bg-surface border border-border p-1.5">
                {sec.items.map((it, i) => (
                  <div
                    key={it.k}
                    className={cn(
                      "flex justify-between items-center px-3 py-3",
                      i < sec.items.length - 1 && "border-b border-border",
                    )}
                  >
                    <span className="text-sm text-primary">{it.k}</span>
                    <button
                      onClick={() => toggle(it.k)}
                      className={cn(
                        "relative h-7 w-12 rounded-full transition",
                        state[it.k] ? "bg-success" : "bg-border",
                      )}
                      aria-pressed={state[it.k]}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all",
                          state[it.k] ? "left-[22px]" : "left-0.5",
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 rounded-xl bg-success/10 text-success p-3 text-[12px]">
        ✅ Toggles ab live — settings table mein permanently save ho rahe hain
      </div>
    </RoleShell>
  );
}
