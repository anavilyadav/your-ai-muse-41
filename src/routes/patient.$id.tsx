import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Cake, Calendar, MapPin, MessageCircle, PhoneCall, Pill, Wallet } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { fetchPatientById, fetchPatientHistory, type DBPatient } from "@/lib/db";

export const Route = createFileRoute("/patient/$id")({
  head: ({ params }) => ({
    meta: [{ title: `Patient ${params.id} — YHC Jaipur` }],
  }),
  component: PatientProfilePage,
});

function PatientProfilePage() {
  const { id } = Route.useParams();
  const [patient, setPatient] = useState<DBPatient | null>(null);
  const [visits, setVisits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [p, vs] = await Promise.all([fetchPatientById(id), fetchPatientHistory(id, 20)]);
      if (cancelled) return;
      setPatient(p);
      setVisits(vs);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <MobileShell title="Loading…" showBack>
        <p className="text-sm text-muted-foreground text-center py-8">Loading patient…</p>
      </MobileShell>
    );
  }

  if (!patient) {
    return (
      <MobileShell title="Patient not found" showBack>
        <p className="text-sm text-muted-foreground">
          This patient record doesn't exist.{" "}
          <Link to="/" className="text-primary underline">Back to Queue</Link>
        </p>
      </MobileShell>
    );
  }

  const totalSpent = Number(patient.lifetime_revenue ?? 0);
  const branchLabel = patient.branch === "BAJAJ_NAGAR" ? "Bajaj Nagar" : patient.branch === "JAGATPURA" ? "Jagatpura" : patient.branch ?? "";

  return (
    <MobileShell title={patient.name} subtitle={patient.patient_code ?? patient.id.slice(0, 8)} showBack>
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-accent text-accent-foreground grid place-items-center text-xl font-bold">
            {patient.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="font-bold truncate">{patient.name}</div>
            <div className="text-[11px] opacity-80">
              {patient.age ?? "?"} yrs • {patient.gender ?? "—"} • {branchLabel}
            </div>
            <div className="text-[11px] opacity-80 mt-0.5">{patient.primary_disease ?? ""}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a href={`tel:${patient.mobile}`} className="rounded-lg bg-success text-success-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1">
            <PhoneCall className="h-3.5 w-3.5" /> Call
          </a>
          <a href={`https://wa.me/91${patient.mobile}`} target="_blank" rel="noreferrer" className="rounded-lg bg-accent text-accent-foreground py-2 text-xs font-bold inline-flex items-center justify-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat icon={Calendar} label="Visits" value={String(patient.lifetime_visits ?? visits.length)} />
        <Stat icon={Wallet} label="Lifetime" value={`₹${totalSpent}`} />
        <Stat icon={Pill} label="Balance" value={`₹${Number(patient.current_balance ?? 0)}`} />
      </div>

      <div className="mt-4 rounded-xl bg-surface border border-border p-3 text-xs space-y-1.5">
        <Row icon={PhoneCall} label="Mobile" value={patient.mobile} />
        <Row icon={MapPin} label="Branch" value={branchLabel} />
        <Row icon={Cake} label="City" value={patient.city ?? "—"} />
      </div>

      <div className="mt-5">
        <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-2">
          Visit History
        </h2>
        {visits.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">No previous visits recorded.</p>
        ) : (
          <ul className="space-y-2">
            {visits.map((v: any) => (
              <li key={v.id} className="rounded-xl bg-surface border border-border border-l-4 border-l-primary p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">
                    {new Date(v.visit_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                  <span className="text-[11px] font-bold text-success">{v.visit_status}</span>
                </div>
                {v.chief_complaint && <p className="text-sm mt-1">{v.chief_complaint}</p>}
                {v.prescriptions && v.prescriptions.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Pill className="h-3 w-3" />{" "}
                    {v.prescriptions.map((r: any) => `${r.medicine_name} ${r.potency ?? ""}`.trim()).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </MobileShell>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface border border-border p-2.5 text-center">
      <Icon className="h-4 w-4 mx-auto text-primary" />
      <div className="text-sm font-bold mt-1 truncate">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-16">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}
