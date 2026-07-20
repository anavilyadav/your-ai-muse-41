import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { CASE_BOARD, useDoctorSession } from "@/lib/yhc-doctor";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/doctor/case/")({
  head: () => ({ meta: [{ title: "Case Board — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: CaseBoardPage,
});

const statusStyle: Record<string, string> = {
  Pending: "bg-accent/25 text-accent-foreground border-accent/50",
  "In Progress": "bg-primary/10 text-primary border-primary/30",
  Submitted: "bg-success/15 text-success border-success/40",
};

function CaseBoardPage() {
  const session = useDoctorSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (session === null) return;
    if (session.role !== "case") navigate({ to: "/doctor" });
  }, [session, navigate]);

  return (
    <DoctorShell title="My Cases" subtitle="Contact details hidden" showLogout nav="case">
      <div className="grid grid-cols-3 gap-2">
        <Stat v={4} l="Assigned" />
        <Stat v={1} l="Submitted" tone="success" />
        <Stat v={2} l="Remaining" tone="accent" />
      </div>

      <div className="mt-3 rounded-xl bg-accent/20 border border-accent/40 p-3 text-[12px] text-primary flex gap-2">
        <Lock className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Mobile and contact details are hidden. Name, age, marital status and job are visible. Take a fresh case —
          previous prescriptions will not appear.
        </span>
      </div>

      <ul className="mt-3 space-y-2.5">
        {CASE_BOARD.map((c) => {
          const clickable = c.status !== "Submitted";
          return (
            <li key={c.token}>
              <button
                disabled={!clickable}
                onClick={() => navigate({ to: "/doctor/case/form/$token", params: { token: c.token } })}
                className={
                  "w-full text-left rounded-2xl bg-surface border border-border p-3.5 shadow-sm transition " +
                  (clickable ? "hover:border-primary/40 active:scale-[0.99]" : "opacity-60 cursor-not-allowed")
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-primary text-primary-foreground text-[11px] font-bold px-2.5 py-1">
                      {c.token}
                    </span>
                    <span className="font-bold text-[15px] text-primary">{c.name}</span>
                  </div>
                  <span className={"rounded-full text-[11px] font-bold px-2.5 py-1 border " + statusStyle[c.status]}>
                    {c.status}
                  </span>
                </div>
                <div className="text-[12px] text-muted-foreground mt-1.5">
                  {c.age}y • {c.gender} • {c.marital} • {c.job}
                </div>
                <div className="text-[13px] text-primary mt-0.5">{c.complaint}</div>
              </button>
            </li>
          );
        })}
      </ul>
    </DoctorShell>
  );
}

function Stat({ v, l, tone }: { v: number | string; l: string; tone?: "success" | "accent" }) {
  return (
    <div className="rounded-xl bg-surface border border-border px-2 py-2.5 text-center">
      <div
        className={
          "text-base font-bold leading-tight " +
          (tone === "success" ? "text-success" : tone === "accent" ? "text-accent-foreground" : "text-primary")
        }
      >
        {v}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{l}</div>
    </div>
  );
}
