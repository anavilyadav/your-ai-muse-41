import { cn } from "@/lib/utils";

interface Props<T extends string> {
  options: readonly T[];
  value: T | "";
  onChange: (v: T) => void;
  size?: "sm" | "md";
}

export function ChipSelect<T extends string>({ options, value, onChange, size = "md" }: Props<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            type="button"
            key={opt}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-full border transition-all font-medium",
              size === "sm" ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
              active
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-surface text-foreground border-border hover:border-primary/40",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
