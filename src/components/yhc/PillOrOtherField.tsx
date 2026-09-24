import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  otherPlaceholder?: string;
}

// UX pass (24 Sep 2026, Dr. Yadav: "typing least honi chaiye dropdown
// vagerah se ho kaam") — pills for the common values, zero typing for
// those, with an "Other" pill that reveals a free-text field so an
// uncommon value is never blocked.
export function PillOrOtherField({ options, value, onChange, otherPlaceholder = "Likho" }: Props) {
  const isPreset = options.includes(value);
  const [showOther, setShowOther] = useState(value !== "" && !isPreset);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            type="button"
            key={opt}
            onClick={() => { onChange(opt); setShowOther(false); }}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold border transition",
              !showOther && value === opt
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-surface border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {opt}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setShowOther(true); if (isPreset) onChange(""); }}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold border transition",
            showOther ? "bg-primary text-primary-foreground border-primary" : "bg-surface border-border text-muted-foreground hover:border-primary/40",
          )}
        >
          Other
        </button>
      </div>
      {showOther && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          className="w-full rounded-lg bg-surface border border-input px-3 py-2.5 text-sm"
        />
      )}
    </div>
  );
}
