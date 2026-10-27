import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { isDuplicateCardNumber, normalizeCardParts, savePatientCardNumber } from "@/lib/db";
import { cn } from "@/lib/utils";

// Card number given straight from a list (Case Board), without finishing the
// whole case first (Dr. Yadav, 27 Oct 2026: the card number is given by the
// case-taking doctor and must then show next to the patient everywhere).
// Series are the ones he makes — A, AA, B, K — or any other typed.
export function CardNumberModal({
  patient,
  onClose,
  onSaved,
}: {
  patient: { id: string; name?: string | null; card_series?: string | null; card_register?: string | null; card_number?: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [series, setSeries] = useState(patient.card_series ?? "");
  const [register, setRegister] = useState(patient.card_register ?? "");
  const [number, setNumber] = useState(patient.card_number ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const c = normalizeCardParts(series, register, number);
    const noRegister = /T$/i.test(c.series); // 1T-5T have no register
    if (!c.series || !c.number || (!c.register && !noRegister)) {
      toast.error("Series, Register aur Number teeno bharo (jaise B - 78 - 50)");
      return;
    }
    setSaving(true);
    if (await isDuplicateCardNumber(c.series, c.register, c.number, patient.id)) {
      setSaving(false);
      toast.error(`Card ${[c.series, c.register, c.number].filter(Boolean).join("-")} kisi aur patient ke paas hai — number dobara dekho`);
      return;
    }
    const res = await savePatientCardNumber(patient.id, c.series, c.register, c.number);
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success(`${patient.name ?? "Patient"} — card ${[c.series, c.register, c.number].filter(Boolean).join("-")} save ho gaya`);
    onSaved();
    onClose();
  };

  const input = "rounded-lg bg-surface border border-input px-3 py-2.5 text-sm";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[clamp(430px,90vw,640px)] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-primary text-lg">Card number — {patient.name}</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-3">Series - Register - Number, jaise B-78-50. Save hote hi ye number patient ke naam ke saath poore app me dikhega.</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {["A", "AA", "B", "K"].map((sr) => (
            <button
              key={sr}
              type="button"
              onClick={() => setSeries(series === sr ? "" : sr)}
              className={cn("rounded-full px-3.5 py-1.5 text-xs font-bold border", series === sr ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-foreground border-border")}
            >
              {sr}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="Series" value={series} maxLength={3} onChange={(e) => setSeries(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} className={cn(input, "uppercase")} aria-label="Card series" />
          <input placeholder="Register" inputMode="numeric" value={register} maxLength={3} onChange={(e) => setRegister(e.target.value.replace(/\D/g, ""))} className={input} aria-label="Card register" />
          <input placeholder="Number" value={number} maxLength={4} onChange={(e) => setNumber(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ""))} className={input} aria-label="Card number" />
        </div>
        <button onClick={save} disabled={saving} className="mt-3 w-full rounded-full bg-accent text-accent-foreground font-bold py-3 text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Card number save karo"}
        </button>
      </div>
    </div>
  );
}
