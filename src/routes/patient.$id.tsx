import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Cake, Calendar, MapPin, MessageCircle, PhoneCall, Pill, Wallet } from "lucide-react";
import { MobileShell } from "@/components/yhc/MobileShell";
import { getPatientById, getVisitsForPatient } from "@/lib/yhc-store";

export const Route = createFileRoute("/patient/$id")({
  head: ({ params }) => ({
    meta: [{ title: `Patient ${params.id} — YHC Jaipur` }],
  }),
  notFoundComponent: () => (
    <MobileShell title="Patient not found" showBack>
      <p className="text-sm text-muted-foreground">
        This patient record doesn't exist. <Link to="/" className="text-primary underline">Back to Queue</Link>
      </p>
    </MobileShell>
  ),
  loader: ({ params }) => {
    const p = getPatientById(params.id);
    if (!p) throw notFound();
    return { patient: p };
  },
  component: PatientProfilePage,
});

function PatientProfilePage() {
  const { id } = Route.useParams();
  const patient = getPatientById(id);
  if (!patient) return null;
  const visits = getVisitsForPatient(id);
  const totalSpent = visits.reduce((s, v) => s + v.amount, 0);

  return (
    <MobileShell title={patient.name} subtitle={`${patient.id} • ${patient.token}`} showBack>
      {/* Identity card */}
      <div className="rounded-2xl bg-primary text-primary-foreground p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-accent text-accent-foreground grid place-items-center text-xl font-bold">
            {patient.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="font-bold truncate">{patient.name}</div>
            <div className="text-[11px] opacity-80">
              {patient.age} yrs • {patient.gender} • {patient.branch}
            </div>
            <div className="text-[11px] opacity-80 mt-0.5">{patient.chiefComplaint}</div>
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

      {/* Stats */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat icon={Calendar} label="Visits" value={String(visits.length)} />
        <Stat icon={Wallet} label="Lifetime" value={`₹${totalSpent}`} />
        <Stat icon={Pill} label="Status" value={patient.status} />
      </div>

      {/* Contact block */}
      <div className="mt-4 rounded-xl bg-surface border border-border p-3 text-xs space-y-1.5">
        <Row icon={PhoneCall} label="Mobile" value={patient.mobile} />
        <Row icon={MapPin} label="Branch" value={patient.branch} />
        <Row icon={Cake} label="Source" value={patient.source} />
      </div>

      {/* Visit history */}
      <div className="mt-5">
        <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-2">
          Visit History
        </h2>
        {visits.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">No previous visits recorded.</p>
        ) : (
          <ul className="space-y-2">
            {visits.map((v) => (
              <li key={v.id} className="rounded-xl bg-surface border border-border border-l-4 border-l-primary p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">
                    {new Date(v.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                  <span className="text-[11px] font-bold text-success">₹{v.amount}</span>
                </div>
                <p className="text-sm mt-1">{v.reason}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Pill className="h-3 w-3" /> {v.prescription}
                </p>
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
