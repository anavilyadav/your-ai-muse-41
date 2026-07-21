import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Activity } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { CONTROLS } from "@/lib/yhc-owner";
import { OWNER_NAV } from "./owner.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/control")({
  head: () => ({ meta: [{ title: "Control Centre — Owner" }, { name: "robots", content: "noindex" }] }),
  component: ControlPage,
});

function ControlPage() {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    CONTROLS.forEach((sec) => sec.items.forEach((it) => (s[it.k] = it.on)));
    return s;
  });
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
                    onClick={() => setState((p) => ({ ...p, [it.k]: !p[it.k] }))}
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
      <div className="mt-4 rounded-xl bg-destructive/10 text-destructive p-3 text-[12px]">
        ⚠ Prototype mein toggles refresh pe reset honge — backend connect ke baad permanently save honge
      </div>
    </RoleShell>
  );
}
