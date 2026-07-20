import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { DOCTOR_CONFIG, useDoctorSession, writeDoctorSession } from "@/lib/yhc-doctor";
import { Stethoscope, FileText } from "lucide-react";

export const Route = createFileRoute("/doctor/")({
  head: () => ({
    meta: [
      { title: "Doctor App — Yadav Homeo Clinic, Jaipur" },
      { name: "description", content: "Doctor login for Yadav Homeo Clinic — prescribing and case-taking workflow." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DoctorLogin,
});

function DoctorLogin() {
  const navigate = useNavigate();
  const session = useDoctorSession();

  // If already logged in, jump to their landing.
  useEffect(() => {
    if (session?.role === "rx") navigate({ to: "/doctor/rx" });
    if (session?.role === "case") navigate({ to: "/doctor/case" });
  }, [session, navigate]);

  const pick = (role: "rx" | "case", name: string) => {
    writeDoctorSession({ role, name });
    navigate({ to: role === "rx" ? "/doctor/rx" : "/doctor/case" });
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[430px] min-h-screen bg-background flex flex-col shadow-[0_0_60px_-20px_rgba(26,42,65,0.35)]">
        <div className="bg-primary text-primary-foreground px-5 pt-8 pb-7 rounded-b-3xl text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-accent text-accent-foreground grid place-items-center font-extrabold text-2xl">
            Y
          </div>
          <h1 className="mt-3 text-xl font-extrabold">Yadav Homeo Clinic</h1>
          <p className="text-xs text-primary-foreground/70 mt-1">Doctor App • Jaipur</p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
          <div className="text-[11px] font-bold tracking-widest text-muted-foreground">
            PRESCRIBING DOCTORS
          </div>
          {DOCTOR_CONFIG.prescribingDoctors.map((d) => (
            <button
              key={d.id}
              onClick={() => pick("rx", d.name)}
              className="w-full text-left rounded-2xl bg-primary text-primary-foreground p-4 flex justify-between items-center shadow-sm hover:bg-primary/95 transition"
            >
              <div className="flex items-center gap-3">
                <Stethoscope className="h-5 w-5 text-accent" />
                <div>
                  <div className="font-extrabold text-base leading-tight">{d.name}</div>
                  <div className="text-[11px] text-primary-foreground/60 mt-0.5">Prescribing authority</div>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-accent text-accent-foreground text-[11px] font-bold">
                {d.tag}
              </span>
            </button>
          ))}

          <div className="text-[11px] font-bold tracking-widest text-muted-foreground pt-3">
            CASE TAKING
          </div>
          <button
            onClick={() => pick("case", "Case Taking Doctor")}
            className="w-full text-left rounded-2xl bg-accent text-accent-foreground p-4 flex items-center gap-3 shadow-sm hover:brightness-95 transition"
          >
            <FileText className="h-5 w-5" />
            <div>
              <div className="font-extrabold text-base leading-tight">Case Taking Doctor</div>
              <div className="text-[11px] opacity-80 mt-0.5">Case notes only — cannot prescribe</div>
            </div>
          </button>

          <p className="text-center text-[11px] text-muted-foreground pt-4">
            Prototype — passwords come later. Doctor list is owner-editable.
          </p>
        </div>
      </div>
    </div>
  );
}
