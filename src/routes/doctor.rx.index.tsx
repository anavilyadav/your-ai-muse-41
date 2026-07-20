import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { DoctorShell } from "@/components/yhc/DoctorShell";
import { RX_QUEUE, useDoctorSession } from "@/lib/yhc-doctor";
import { Star } from "lucide-react";

export const Route = createFileRoute("/doctor/rx/")({
  head: () => ({ meta: [{ title: "OPD Queue — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: RxQueuePage,
});

function RxQueuePage() {
  const session = useDoctorSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (session === null) return; // still loading
    if (session.role !== "rx") navigate({ to: "/doctor" });
  }, [session, navigate]);

  const doctorName = session?.name ?? "Doctor";

  return (
    <DoctorShell
      title="OPD Queue"
      subtitle={`${doctorName} • Case done, Rx pending`}
      showLogout
      nav="rx"
    >
      <div className="grid grid-cols-3 gap-2">
        {[
          { v: 4, l: "Rx Pending", tone: "accent" },
          { v: 7, l: "Done Today", tone: "success" },
          { v: "6 min", l: "Avg / patient", tone: "primary" },
        ].map((s) => (
          <div key={s.l} className="rounded-xl bg-surface border border-border px-2 py-2.5 text-center">
            <div
              className={
                "text-base font-bold leading-tight " +
                (s.tone === "success" ? "text-success" : s.tone === "accent" ? "text-accent-foreground" : "text-primary")
              }
            >
              {s.v}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>

      <ul className="mt-4 space-y-2.5">
        {RX_QUEUE.map((p) => (
          <li key={p.token}>
            <button
              onClick={() => navigate({ to: "/doctor/rx/consult/$token", params: { token: p.token } })}
              className="w-full text-left rounded-2xl bg-surface border border-border p-3.5 shadow-sm hover:border-primary/40 active:scale-[0.99] transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary text-primary-foreground text-[11px] font-bold px-2.5 py-1">
                    {p.token}
                  </span>
                  <span className="font-bold text-[15px] text-primary">{p.name}</span>
                  {p.vip && (
                    <span className="rounded-full bg-destructive/15 text-destructive text-[10px] font-bold px-2 py-0.5 inline-flex items-center gap-1">
                      <Star className="h-3 w-3" /> VIP
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground">{p.age}y • {p.gender}</span>
              </div>
              <div className="text-sm text-primary mt-1.5">{p.complaint}</div>
              <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
                <span>Case: {p.caseBy}</span>
                <span>Visit #{p.visit}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Last Rx: {p.lastRx}</div>
            </button>
          </li>
        ))}
      </ul>
    </DoctorShell>
  );
}
