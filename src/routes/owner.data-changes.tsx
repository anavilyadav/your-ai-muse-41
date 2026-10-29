import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronRight, CreditCard, Globe, History, Merge, Phone, Search, UserPen } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, ErrorBlock } from "@/components/yhc/AuthGate";
import { OWNER_NAV } from "./owner.index";
import { fetchDataChangesReport } from "@/lib/db";

export const Route = createFileRoute("/owner/data-changes")({
  head: () => ({ meta: [{ title: "Data Changes — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <DataChangesPage />
    </AuthGate>
  ),
});

// Every correction made from the daily-sheet cross-check (Dr. Yadav, 29 Oct
// 2026: "app me to kuch samaj nahi aaya changes" — one place to see what was
// changed, before -> after, and open the patient from there).

function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  return new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function PatientLink({ id, name, card }: { id: string; name: string; card?: string | null }) {
  return (
    <Link to="/patient/$id" params={{ id }} className="font-semibold text-primary underline-offset-2 hover:underline">
      {name || "(no name)"}
      {card ? <span className="ml-1 text-[11px] font-bold text-muted-foreground">[{card.replace(/^YHC-/, "SYS-")}]</span> : null}
    </Link>
  );
}

function Section({ icon: Icon, title, hint, count, children }: { icon: any; title: string; hint: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-surface border border-border overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2.5 p-3.5 text-left">
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-primary">{title}</div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 text-primary text-[11px] font-bold px-2 py-1">{count}</span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border p-3 space-y-2">{count === 0 ? <p className="text-[12px] text-muted-foreground">Kuch nahi mila.</p> : children}</div>}
    </div>
  );
}

function DataChangesPage() {
  const q = useQuery({ queryKey: ["data-changes"], queryFn: fetchDataChangesReport });
  const [term, setTerm] = useState("");
  const t = term.trim().toLowerCase();
  const hit = (...xs: (string | null | undefined)[]) => !t || xs.some((x) => (x ?? "").toLowerCase().includes(t));

  // Visit moves grouped per (from -> to) patient pair, so 1,000+ moves read as
  // "Rachna soni -> Nitin Soni: 21 visits" instead of one line per visit.
  const visitGroups = useMemo(() => {
    const m = new Map<string, { from_id: string; from_name: string; from_card: string | null; to_id: string; to_name: string; to_card: string | null; dates: string[]; bundle: string }>();
    for (const v of q.data?.visits ?? []) {
      const k = `${v.from_id}>${v.to_id}`;
      const g = m.get(k) ?? { from_id: v.from_id, from_name: v.from_name, from_card: v.from_card, to_id: v.to_id, to_name: v.to_name, to_card: v.to_card, dates: [], bundle: v.bundle };
      g.dates.push(v.visit_date);
      m.set(k, g);
    }
    return Array.from(m.values()).sort((a, b) => b.dates.length - a.dates.length);
  }, [q.data]);

  if (q.isLoading) return <RoleShell wide title="Data Changes" nav={OWNER_NAV}><LoadingBlock /></RoleShell>;
  if (q.isError) return <RoleShell wide title="Data Changes" nav={OWNER_NAV}><ErrorBlock error={q.error} onRetry={() => void q.refetch()} /></RoleShell>;
  const r = q.data!;
  const vg = visitGroups.filter((g) => hit(g.from_name, g.from_card, g.to_name, g.to_card));
  const names = r.names.filter((x) => hit(x.old_name, x.new_name, x.card));
  const cards = r.cards.filter((x) => hit(x.name, x.card));
  const mobiles = r.mobiles.filter((x) => hit(x.name, x.mobile, x.card));
  const flags = r.flags.filter((x) => hit(x.name, x.card));
  const merges = (r.merges ?? []).filter((x) => hit(x.primary_name, x.primary_card, x.duplicate_name, x.duplicate_card));

  return (
    <RoleShell wide title="Data Changes" subtitle="Daily sheet se jo sudhaar kiye — pehle → ab" nav={OWNER_NAV}>
      <div className="rounded-2xl bg-primary text-primary-foreground p-3.5 mb-3 text-[12px]">
        Ye sab badlav aapke "YES" ke baad daily sheet aur master sheet se cross-check karke kiye gaye. Har patient ke naam pe tap karke uski profile khulegi.
        Kuch bhi galat lage to batao — har badlav ka purana record rakha hai, wapas kiya ja sakta hai.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-3">
        {[
          ["Visits sahi patient pe", r.visits.length],
          ["Poora naam", r.names.length],
          ["Card bhara", r.cards.length],
          ["Mobile bhara", r.mobiles.length],
          ["Online / Courier", r.flags.length],
          ["Duplicate merge", (r.merges ?? []).length],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-xl bg-surface border border-border p-2.5 text-center">
            <div className="text-lg font-extrabold text-primary">{n as number}</div>
            <div className="text-[10.5px] text-muted-foreground">{label as string}</div>
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 rounded-xl bg-surface border border-input px-3 py-2 mb-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Naam ya card number se dhundo" className="flex-1 bg-transparent text-sm outline-none" />
      </label>

      <div className="space-y-2.5 pb-6">
        <Section icon={History} title="Visits sahi patient pe gayi" hint="Visit kisi aur ke record pe judi thi — daily sheet me us din jiska card likha tha, uske record pe le gaye (payments bhi saath)" count={vg.length}>
          {vg.map((g) => (
            <div key={`${g.from_id}>${g.to_id}`} className="rounded-xl bg-background border border-border p-2.5 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <PatientLink id={g.from_id} name={g.from_name} card={g.from_card} />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <PatientLink id={g.to_id} name={g.to_name} card={g.to_card} />
                <span className="ml-auto rounded-full bg-accent/30 px-2 py-0.5 text-[11px] font-bold text-accent-foreground">{g.dates.length} visit</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {g.dates.slice(0, 6).map(fmtDate).join(", ")}{g.dates.length > 6 ? ` +${g.dates.length - 6}` : ""}
              </div>
            </div>
          ))}
        </Section>

        <Section icon={UserPen} title="Poora naam (surname)" hint="App me sirf pehla naam tha — daily sheet wala poora naam rakha" count={names.length}>
          {names.map((x) => (
            <div key={x.patient_id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-muted-foreground line-through">{x.old_name}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <PatientLink id={x.patient_id} name={x.new_name} card={x.card} />
            </div>
          ))}
        </Section>

        <Section icon={CreditCard} title="Card number bhara" hint="Card khaali tha — is patient ki visits pe daily sheet me jo card likha tha wo bhara" count={cards.length}>
          {cards.map((x) => (
            <div key={x.patient_id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <PatientLink id={x.patient_id} name={x.name} />
              <span className="text-muted-foreground">khaali</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-bold text-primary">{x.card}</span>
            </div>
          ))}
        </Section>

        <Section icon={Phone} title="Mobile bhara" hint="Mobile khaali tha — daily sheet wala number bhara (Number unconfirmed — patient se confirm karna)" count={mobiles.length}>
          {mobiles.map((x) => (
            <div key={x.patient_id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <PatientLink id={x.patient_id} name={x.name} card={x.card} />
              <span className="text-muted-foreground">khaali</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-bold text-primary">{x.mobile}</span>
            </div>
          ))}
        </Section>

        <Section icon={Globe} title="Online / Courier tag" hint="Online/courier wala amount (2700, 5200 …) UPI se diya, kabhi cash nahi — dono tag lagaye" count={flags.length}>
          {flags.map((x) => (
            <div key={x.patient_id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <PatientLink id={x.patient_id} name={x.name} card={x.card} />
              <span className="ml-auto text-[11px] text-muted-foreground">saboot: {x.source}</span>
            </div>
          ))}
        </Section>

        <Section icon={Merge} title="Duplicate record merge" hint="Ek hi insaan ke 2 record the — bina card wala record card wale me mila diya (duplicate MERGED mark hua, delete nahi)" count={merges.length}>
          {merges.map((x) => (
            <div key={x.primary_id + x.duplicate_name} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-muted-foreground line-through">{x.duplicate_name} [{(x.duplicate_card ?? "").replace(/^YHC-/, "SYS-")}]</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <PatientLink id={x.primary_id} name={x.primary_name} card={x.primary_card} />
            </div>
          ))}
        </Section>
      </div>
    </RoleShell>
  );
}
