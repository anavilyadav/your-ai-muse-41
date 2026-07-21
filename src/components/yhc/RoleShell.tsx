import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
};

interface Props {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  right?: ReactNode;
  nav?: NavItem[];
  children: ReactNode;
}

export function RoleShell({ title, subtitle, showBack, right, nav = [], children }: Props) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[430px] min-h-screen bg-background flex flex-col shadow-[0_0_60px_-20px_rgba(26,42,65,0.35)]">
        <header className="sticky top-0 z-20 bg-primary text-primary-foreground px-4 pt-4 pb-4 rounded-b-2xl">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            {showBack ? (
              <button
                onClick={() => router.history.back()}
                className="shrink-0 h-9 w-9 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 transition"
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : (
              <div className="shrink-0 h-9 w-9 grid place-items-center rounded-full bg-accent text-accent-foreground font-bold text-sm">
                Y
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight">{title}</h1>
              {subtitle && <p className="truncate text-[11px] text-primary-foreground/70">{subtitle}</p>}
            </div>
            <div className="shrink-0 flex items-center gap-2">{right}</div>
          </div>
        </header>

        <main className={cn("flex-1 px-4 pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300", nav.length ? "pb-28" : "pb-8")}>
          {children}
        </main>

        {nav.length > 0 && (
          <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-30 border-t border-border bg-surface/95 backdrop-blur">
            <ul
              className={cn(
                "grid",
                nav.length === 2 && "grid-cols-2",
                nav.length === 3 && "grid-cols-3",
                nav.length === 4 && "grid-cols-4",
                nav.length === 5 && "grid-cols-5",
              )}
            >
              {nav.map(({ to, label, icon: Icon, exact }) => {
                const active = exact ? pathname === to : pathname.startsWith(to);
                return (
                  <li key={to}>
                    <Link
                      to={to}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                        active ? "text-primary" : "text-muted-foreground hover:text-primary",
                      )}
                    >
                      <span
                        className={cn(
                          "h-9 w-9 grid place-items-center rounded-full transition-colors",
                          active ? "bg-accent text-accent-foreground" : "bg-transparent",
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}

export function Stat({ v, l, tone }: { v: React.ReactNode; l: string; tone?: "accent" | "success" | "destructive" | "primary" }) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "accent"
          ? "text-accent-foreground"
          : "text-primary";
  return (
    <div className="flex-1 rounded-xl bg-surface border border-border px-2 py-2.5 text-center">
      <div className={cn("text-lg font-bold leading-tight", color)}>{v}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{l}</div>
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "success" | "warn" | "primary" | "destructive" }) {
  const cls =
    tone === "success"
      ? "bg-success/15 text-success"
      : tone === "warn"
        ? "bg-accent/25 text-accent-foreground"
        : tone === "primary"
          ? "bg-primary text-primary-foreground"
          : tone === "destructive"
            ? "bg-destructive/15 text-destructive"
            : "bg-muted text-muted-foreground";
  return <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", cls)}>{children}</span>;
}
