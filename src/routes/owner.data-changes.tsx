import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronRight, CopyX, CreditCard, FilePlus, Globe, History, IdCard, Merge, Phone, Search, UserPen, UserPlus, Users, Wallet } from "lucide-react";
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
// changed, before -> after, and open the patient from there). 2 Nov 2026
// ("DATA CHANGES PAGE ME SAB DIKHAO"): + new patients, sheet visits added,
// R2 card changes, every merge, double entries, family links, AY PAYTM.

function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  return new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const rupees = (n: number | null | undefined) => `₹${Math.round(Number(n ?? 0)).toLocaleString("en-IN")}`;

// Bundle order for the filter chips — the order they were applied.
const BUNDLE_ORDER = ["B4 HIGH", "B4 MEDIUM", "B2", "B3", "B1", "B6", "M1", "R1", "R2", "R2 MEDIUM", "R3", "R3 MEDIUM", "R3 CHECK", "R4", "R4 B", "R4 C", "R4 D", "R4 E", "NAYA PATIENT", "R5", "R5 MEDIUM", "M1 MEDIUM", "R6", "AY PAYTM", "App se"];

const CARD_KIND: Record<string, string> = {
  NEW_CARD_SAME_PERSON: "Naya card, wahi insaan",
  OLD_RECORD: "Purana record, naya card",
  TYPO: "Sheet me alag likha card — purane cards me joda",
  EXTRA_CARD: "Ek insaan ke 2 card — purane cards me joda",
  B_CARD: "Purane A card ki jagah 2023 ka B card diya",
};

function PatientLink({ id, name, card }: { id: string; name: string; card?: string | null }) {
  return (
    <Link to="/patient/$id" params={{ id }} className="font-semibold text-primary underline-offset-2 hover:underline">
      {name || "(no name)"}
      {card ? <span className="ml-1 text-[11px] font-bold text-muted-foreground">[{card.replace(/^YHC-/, "SYS-")}]</span> : null}
    </Link>
  );
}

function BundleChip({ b }: { b: string }) {
  return <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{b}</span>;
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
  const [bundle, setBundle] = useState("");
  const t = term.trim().toLowerCase();
  const hit = (...xs: (string | null | undefined)[]) => !t || xs.some((x) => (x ?? "").toLowerCase().includes(t));
  const inB = (b: string | null | undefined) => !bundle || b === bundle;

  // Visit moves grouped per (from -> to) patient pair, so 1,000+ moves read as
  // "Rachna soni -> Nitin Soni: 21 visits" instead of one line per visit.
  const visitGroups = useMemo(() => {
    const m = new Map<string, { from_id: string; from_name: string; from_card: string | null; to_id: string; to_name: string; to_card: string | null; dates: string[]; bundle: string }>();
    for (const v of q.data?.visits ?? []) {
      if (!inB(v.bundle)) continue;
      const k = `${v.from_id}>${v.to_id}>${v.bundle}`;
      const g = m.get(k) ?? { from_id: v.from_id, from_name: v.from_name, from_card: v.from_card, to_id: v.to_id, to_name: v.to_name, to_card: v.to_card, dates: [], bundle: v.bundle };
      g.dates.push(v.visit_date);
      m.set(k, g);
    }
    return Array.from(m.values()).sort((a, b) => b.dates.length - a.dates.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, bundle]);

  // Sheet visits added, grouped per patient (and bundle).
  const importGroups = useMemo(() => {
    const m = new Map<string, { patient_id: string; name: string; card: string | null; bundle: string; dates: string[]; amount: number }>();
    for (const v of q.data?.imports ?? []) {
      if (!inB(v.bundle)) continue;
      const k = `${v.patient_id}>${v.bundle}`;
      const g = m.get(k) ?? { patient_id: v.patient_id, name: v.name, card: v.card, bundle: v.bundle, dates: [], amount: 0 };
      g.dates.push(v.visit_date);
      g.amount += Number(v.amount ?? 0);
      m.set(k, g);
    }
    return Array.from(m.values()).sort((a, b) => b.dates.length - a.dates.length || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, bundle]);

  if (q.isLoading) return <RoleShell wide title="Data Changes" nav={OWNER_NAV}><LoadingBlock /></RoleShell>;
  if (q.isError) return <RoleShell wide title="Data Changes" nav={OWNER_NAV}><ErrorBlock error={q.error} onRetry={() => void q.refetch()} /></RoleShell>;
  const r = q.data!;
  const imports = r.imports ?? [];
  const newPatients = r.new_patients ?? [];
  const cardChanges = r.card_changes ?? [];
  const merges0 = r.merges ?? [];
  const doubles0 = r.double_entries ?? [];
  const family0 = r.family_links ?? [];
  const ay0 = r.ay_paytm ?? [];

  const bundles = (() => {
    const s = new Set<string>(["B2", "B3", "B1", "B6"]);
    r.visits.forEach((x) => s.add(x.bundle));
    imports.forEach((x) => s.add(x.bundle));
    newPatients.forEach((x) => s.add(x.bundle));
    cardChanges.forEach((x) => s.add(x.bundle));
    merges0.forEach((x) => x.bundle && s.add(x.bundle));
    if (doubles0.length || family0.length) s.add("R3 CHECK");
    if (ay0.length) s.add("AY PAYTM");
    return Array.from(s).sort((a, b) => (BUNDLE_ORDER.indexOf(a) + 1 || 99) - (BUNDLE_ORDER.indexOf(b) + 1 || 99));
  })();

  const vg = visitGroups.filter((g) => hit(g.from_name, g.from_card, g.to_name, g.to_card));
  const ig = importGroups.filter((g) => hit(g.name, g.card));
  const np = newPatients.filter((x) => inB(x.bundle) && hit(x.name, x.card, x.mobile));
  const cc = cardChanges.filter((x) => inB(x.bundle) && hit(x.name, x.card, x.sheet_card, x.before_card, ...(x.old_cards ?? [])));
  const names = inB("B2") ? r.names.filter((x) => hit(x.old_name, x.new_name, x.card)) : [];
  const cards = inB("B3") ? r.cards.filter((x) => hit(x.name, x.card)) : [];
  const mobiles = inB("B1") ? r.mobiles.filter((x) => hit(x.name, x.mobile, x.card)) : [];
  const flags = inB("B6") ? r.flags.filter((x) => hit(x.name, x.card)) : [];
  const merges = merges0.filter((x) => inB(x.bundle ?? "M1") && hit(x.primary_name, x.primary_card, x.duplicate_name, x.duplicate_card));
  const doubles = inB("R3 CHECK") ? doubles0.filter((x) => hit(x.name, x.card, x.slip, x.copy_on_name)) : [];
  const family = inB("R3 CHECK") ? family0.filter((x) => hit(x.name, x.card, x.related_name, x.related_card)) : [];
  const ay = inB("AY PAYTM") ? ay0.filter((x) => hit(x.name, x.card)) : [];

  const importedAmount = imports.reduce((s, x) => s + Number(x.amount ?? 0), 0);

  return (
    <RoleShell wide title="Data Changes" subtitle="Daily sheet se jo sudhaar kiye — pehle → ab" nav={OWNER_NAV}>
      <div className="rounded-2xl bg-primary text-primary-foreground p-3.5 mb-3 text-[12px]">
        Ye sab badlav aapke "YES" ke baad daily sheet aur master sheet se cross-check karke kiye gaye. Har patient ke naam pe tap karke uski profile khulegi.
        Kuch bhi galat lage to batao — har badlav ka purana record rakha hai, wapas kiya ja sakta hai.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-3">
        {[
          ["Visits sahi patient pe", r.visits.length],
          ["Sheet se visit jodi", imports.length],
          ["Naye patient", newPatients.length],
          ["Card badla", cardChanges.length],
          ["Poora naam", r.names.length],
          ["Card bhara", r.cards.length],
          ["Mobile bhara", r.mobiles.length],
          ["Online / Courier", r.flags.length],
          ["Duplicate merge", merges0.length],
          ["Double entry", doubles0.length],
          ["Family joda", family0.length],
          ["AY PAYTM patient", ay0.length],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-xl bg-surface border border-border p-2.5 text-center">
            <div className="text-lg font-extrabold text-primary">{n as number}</div>
            <div className="text-[10.5px] text-muted-foreground">{label as string}</div>
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 rounded-xl bg-surface border border-input px-3 py-2 mb-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Naam ya card number se dhundo" className="flex-1 bg-transparent text-sm outline-none" />
      </label>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {["", ...bundles].map((b) => (
          <button
            key={b || "all"}
            onClick={() => setBundle(b)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${bundle === b ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-muted-foreground border-border"}`}
          >
            {b || "Sab bundle"}
          </button>
        ))}
      </div>

      <div className="space-y-2.5 pb-6">
        <Section icon={History} title="Visits sahi patient pe gayi" hint="Visit kisi aur ke record pe judi thi — daily sheet me us din jiska card likha tha, uske record pe le gaye (payments bhi saath)" count={vg.length}>
          {vg.map((g) => (
            <div key={`${g.from_id}>${g.to_id}>${g.bundle}`} className="rounded-xl bg-background border border-border p-2.5 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <PatientLink id={g.from_id} name={g.from_name} card={g.from_card} />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                <PatientLink id={g.to_id} name={g.to_name} card={g.to_card} />
                <BundleChip b={g.bundle} />
                <span className="ml-auto rounded-full bg-accent/30 px-2 py-0.5 text-[11px] font-bold text-accent-foreground">{g.dates.length} visit</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {g.dates.slice(0, 6).map(fmtDate).join(", ")}{g.dates.length > 6 ? ` +${g.dates.length - 6}` : ""}
              </div>
            </div>
          ))}
        </Section>

        <Section icon={FilePlus} title="Sheet se visit jodi (app me nahi thi)" hint={`Daily sheet me visit thi par app me nahi — payment ke saath jodi (kul ${imports.length} visit, ${rupees(importedAmount)})`} count={ig.length}>
          {ig.map((g) => (
            <div key={`${g.patient_id}>${g.bundle}`} className="rounded-xl bg-background border border-border p-2.5 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <PatientLink id={g.patient_id} name={g.name} card={g.card} />
                <BundleChip b={g.bundle} />
                <span className="ml-auto rounded-full bg-accent/30 px-2 py-0.5 text-[11px] font-bold text-accent-foreground">{g.dates.length} visit · {rupees(g.amount)}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {g.dates.slice(0, 6).map(fmtDate).join(", ")}{g.dates.length > 6 ? ` +${g.dates.length - 6}` : ""}
              </div>
            </div>
          ))}
        </Section>

        <Section icon={UserPlus} title="Naye patient bane" hint="Daily sheet me the par app me record hi nahi tha — naya record banaya (notes: 'Daily sheet se bana'). SYS- wale ko card number bharna hai" count={np.length}>
          {np.map((x) => (
            <div key={x.patient_id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <PatientLink id={x.patient_id} name={x.name} card={x.card} />
              {x.mobile ? <span className="text-[11px] text-muted-foreground">{x.mobile}</span> : null}
              <BundleChip b={x.bundle} />
              {x.merged ? <span className="text-[11px] text-muted-foreground">(baad me merge hua)</span> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">{x.visits} visit</span>
            </div>
          ))}
        </Section>

        <Section icon={IdCard} title="Card badla / purana card joda" hint="Naya card mila to naya card aage, purana card 'purane cards' me rakha — search me dono se milega" count={cc.length}>
          {cc.map((x) => (
            <div key={x.patient_id + x.sheet_card} className="rounded-xl bg-background border border-border p-2.5 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <PatientLink id={x.patient_id} name={x.name} card={x.card} />
                <BundleChip b={x.bundle} />
                <span className="ml-auto text-[11px] text-muted-foreground">{CARD_KIND[x.kind] ?? x.kind}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                <span className="text-muted-foreground">pehle</span>
                <span className="font-bold">{x.before_card ?? "—"}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">ab</span>
                <span className="font-bold text-primary">{(x.card ?? "").replace(/^YHC-/, "SYS-")}</span>
                {x.old_cards?.length ? <span className="text-muted-foreground">· purane: {x.old_cards.join(", ")}</span> : null}
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

        <Section icon={Merge} title="Duplicate record merge" hint="Ek hi insaan ke 2 record the — dono ek kiye, saari visits ek jagah (dusra record MERGED mark hua, delete nahi; uska card 'purane cards' me)" count={merges.length}>
          {merges.map((x) => (
            <div key={x.primary_id + x.duplicate_name + x.duplicate_card} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-muted-foreground line-through">{x.duplicate_name} [{(x.duplicate_card ?? "").replace(/^YHC-/, "SYS-")}]</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <PatientLink id={x.primary_id} name={x.primary_name} card={x.primary_card} />
              {x.bundle ? <BundleChip b={x.bundle} /> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(x.applied_at)}</span>
            </div>
          ))}
        </Section>

        <Section icon={CopyX} title="Double entry theek ki" hint="Sheet ki ek hi line app me 2 baar thi — copy ko patient ki apni sheet line se sahi kiya, ya faltu copy hata di (total me 2 baar gin rahi thi)" count={doubles.length}>
          {doubles.map((x, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <PatientLink id={x.patient_id} name={x.name} card={x.card} />
              <span className="text-[11px] text-muted-foreground">{fmtDate(x.visit_date)}{x.slip ? ` · slip ${x.slip}` : ""} · {rupees(x.amount)}</span>
              <span className="ml-auto text-[11px] font-bold text-muted-foreground">
                {x.action === "DELETE" ? `faltu copy hatayi${x.copy_on_name && x.copy_on_id !== x.patient_id ? ` (${x.copy_on_name} pe thi)` : ""}` : "apni slip se sahi ki"}
              </span>
            </div>
          ))}
        </Section>

        <Section icon={Users} title="Family joda" hint="Ek hi mobile wale parivaar ko family me joda (aapke bataye rishte)" count={family.length}>
          {family.map((x) => (
            <div key={x.patient_id + x.related_id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <PatientLink id={x.patient_id} name={x.name} card={x.card} />
              <span className="text-muted-foreground">ke {x.relationship}:</span>
              <PatientLink id={x.related_id} name={x.related_name} card={x.related_card} />
            </div>
          ))}
        </Section>

        <Section icon={Wallet} title="AY PAYTM alag kiya" hint="Purani AY PAYTM payments CASH me gini thi — ab AY PAYTM ki apni line me (amount wahi)" count={ay.length}>
          {ay.map((x) => (
            <div key={x.patient_id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <PatientLink id={x.patient_id} name={x.name} card={x.card} />
              <span className="text-[11px] text-muted-foreground">{x.old_mode} → {x.new_mode.replace(/_/g, " ")}</span>
              <span className="ml-auto text-[11px] font-bold text-muted-foreground">{x.count} payment · {rupees(x.amount)}</span>
            </div>
          ))}
        </Section>
      </div>
    </RoleShell>
  );
}
