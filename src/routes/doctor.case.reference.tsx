import { createFileRoute } from "@tanstack/react-router";
import { DoctorShell } from "@/components/yhc/DoctorShell";

export const Route = createFileRoute("/doctor/case/reference")({
  head: () => ({ meta: [{ title: "Reference — Doctor App" }, { name: "robots", content: "noindex" }] }),
  component: ReferencePage,
});

const rubrics: [string, string][] = [
  ["Anxiety, health about", "Ars, Phos, Calc, Nit-ac"],
  ["Fear, dark", "Stram, Phos, Puls, Calc"],
  ["Irritability", "Nux-v, Cham, Bry, Staph"],
  ["Weeping, consolation agg", "Nat-m, Sil, Ign"],
  ["Chilly patient", "Sil, Calc, Ars, Nux-v"],
];

function ReferencePage() {
  return (
    <DoctorShell title="Reference" subtitle="Read only" nav="case">
      <div className="rounded-2xl bg-surface border border-border p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Common rubrics cheat sheet
        </div>
        {rubrics.map(([r, m]) => (
          <div key={r} className="py-2.5 border-b border-border last:border-b-0">
            <div className="text-[13.5px] font-bold text-primary">{r}</div>
            <div className="text-[12.5px] text-muted-foreground">{m}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-2xl bg-surface border border-border p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Generals quick reference
        </div>
        <div className="text-[13px] text-primary leading-relaxed space-y-1">
          <p><b>Thermals:</b> Chilly = feels cold · Hot = feels warm</p>
          <p><b>Thirst:</b> Quantity, temperature preference — note both</p>
          <p><b>Modalities:</b> Time, temperature, position, motion</p>
          <p><b>Mentals rank highest</b> in remedy selection</p>
        </div>
      </div>
    </DoctorShell>
  );
}
