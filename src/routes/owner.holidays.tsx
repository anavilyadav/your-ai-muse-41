import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { RoleShell } from "@/components/yhc/RoleShell";
import { AuthGate, LoadingBlock, EmptyBlock } from "@/components/yhc/AuthGate";
import { fetchHolidays, saveHoliday, deleteHoliday, type Holiday } from "@/lib/db";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/owner/holidays")({
  head: () => ({ meta: [{ title: "Holiday Greetings — Owner" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AuthGate allow={["OWNER"]}>
      <HolidaysPage />
    </AuthGate>
  ),
});

function HolidayModal({
  holiday,
  onClose,
  onSaved,
}: {
  holiday: Partial<Holiday> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(holiday?.name ?? "");
  const [date, setDate] = useState(holiday?.date ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() || !date) { toast.error("Naam aur date dono chahiye"); return; }
    setSaving(true);
    const res = await saveHoliday({ id: holiday?.id, name: name.trim(), date, active: holiday?.active ?? true });
    setSaving(false);
    if (!res.success) { toast.error("Save nahi hua: " + res.error); return; }
    toast.success("Holiday save ho gaya");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center">
      <div className="w-full max-w-[430px] bg-background rounded-t-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-extrabold text-primary text-lg">{holiday?.id ? "Edit Holiday" : "Naya Holiday"}</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Naam</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase">Is saal ki date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm" />
          </div>
          <p className="text-[11px] text-muted-foreground">Har saal date badalti hai, isliye har saal ek baar update karna padega.</p>
          <button onClick={save} disabled={saving} className="mt-2 w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HolidaysPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["holidays"], queryFn: fetchHolidays });
  const holidays = data ?? [];
  const [editHoliday, setEditHoliday] = useState<Partial<Holiday> | null | "new">(null);

  const reload = () => qc.invalidateQueries({ queryKey: ["holidays"] });

  const remove = async (id: string) => {
    if (!window.confirm("Ye holiday delete karein?")) return;
    const res = await deleteHoliday(id);
    if (!res.success) { toast.error("Delete nahi hua: " + res.error); return; }
    toast.success("Holiday delete ho gaya");
    reload();
  };

  return (
    <RoleShell title="Holiday Greetings" subtitle="Sabhi consented patients ko broadcast" showBack>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">Is date pe sabko automatic greeting jayegi.</p>
        <button
          onClick={() => setEditHoliday("new")}
          className="shrink-0 flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-bold"
        >
          <Plus className="h-3.5 w-3.5" /> Naya
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : holidays.length === 0 ? (
        <EmptyBlock label="Koi holiday add nahi kiya abhi tak." />
      ) : (
        <div className="space-y-1.5">
          {holidays.map((h) => (
            <div key={h.id} className={cn("flex items-center justify-between rounded-xl border border-border p-3", h.active ? "bg-surface" : "bg-muted/50 opacity-60")}>
              <div className="text-sm">
                <span className="font-semibold">{h.name}</span>
                <span className="text-muted-foreground text-xs"> — {new Date(h.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setEditHoliday(h)} className="h-7 w-7 grid place-items-center rounded-full bg-accent/20 text-accent-foreground">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => remove(h.id)} className="h-7 w-7 grid place-items-center rounded-full bg-destructive/15 text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editHoliday && (
        <HolidayModal
          holiday={editHoliday === "new" ? null : editHoliday}
          onClose={() => setEditHoliday(null)}
          onSaved={reload}
        />
      )}
    </RoleShell>
  );
}
