import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { updatePatientContactInfo } from "@/lib/db";

// Spelling mistakes in patient names are common on a real bulk-imported
// sheet — this is the lightweight, name-only fix available wherever staff
// actually notice one (Doctor's Rx Consult screen doesn't have access to
// the full Patient Profile edit form Reception uses), instead of needing
// to hand it off to Owner/Reception every time.
export function EditPatientNameModal({
  patientId,
  currentName,
  onClose,
  onSaved,
}: {
  patientId: string;
  currentName: string;
  onClose: () => void;
  onSaved: (newName: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Naam khaali nahi ho sakta"); return; }
    setSaving(true);
    const res = await updatePatientContactInfo(patientId, { name: trimmed });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Naam update ho gaya");
    onSaved(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">Naam Sahi Karo</h2>
          <button onClick={onClose} aria-label="Band karo" className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Poora naam"
          className="w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
        />
        <button
          disabled={saving}
          onClick={submit}
          className="mt-4 w-full rounded-full bg-primary text-primary-foreground font-bold py-3 text-sm disabled:opacity-60"
        >
          {saving ? "Save ho raha hai…" : "Save Karo"}
        </button>
      </div>
    </div>
  );
}
