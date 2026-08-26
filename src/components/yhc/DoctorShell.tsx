import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, ClipboardList, Clock, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { writeDoctorSession } from "@/lib/yhc-doctor";

interface Props {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  right?: ReactNode;
  showLogout?: boolean;
  nav?: "rx" | "case" | "none";
  children: ReactNode;
}

const rxNav = [
  { to: "/doctor/rx", label: "Queue", icon: ClipboardList, exact: true },
  { to: "/doctor/rx/history", label: "History", icon: Clock, exact: false },
  { to: "/doctor/rx/dashboard", label: "Dashboard", icon: BarChart3, exact: false },
] as const;

const caseNav = [
  { to: "/doctor/case", label: "Cases", icon: ClipboardList, exact: true },
  { to: "/doctor/case/reference", label: "Reference", icon: BarChart3, exact: false },
] as const;

export function DoctorShell({ title, subtitle, showBack, right, showLogout, nav = "none", children }: Props) {
  const router = useRouter();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const logout = () => {
    writeDoctorSession(null);
    navigate({ to: "/doctor" });
  };

  const items = nav === "rx" ? rxNav : nav === "case" ? caseNav : [];

  const sidebarNav = items.length > 0 && (
    <aside className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1 lg:border-r lg:border-border lg:bg-surface/60 lg:px-3 lg:py-6">
      <div className="flex items-center gap-2 px-3 pb-6">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">Y</div>
        <span className="text-sm font-bold text-primary">YHC-OS</span>
      </div>
      {items.map(({ to, label, icon: Icon, exact }) => {
        const active = exact ? pathname === to : pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </Link>
        );
      })}
      {showLogout && (
        <button
          onClick={logout}
          className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          <LogOut className="h-[18px] w-[18px]" /> Logout
        </button>
      )}
    </aside>
  );

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[clamp(430px,94vw,720px)] min-h-screen bg-background flex flex-col shadow-[0_0_60px_-20px_rgba(26,42,65,0.35)] lg:max-w-none lg:flex-row lg:shadow-none">
        {sidebarNav}

        <div className="flex min-w-0 flex-1 flex-col lg:min-h-screen">
          <header className="sticky top-0 z-20 bg-primary text-primary-foreground px-4 md:px-6 pt-4 pb-4 rounded-b-2xl lg:rounded-none lg:px-8">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              {showBack ? (
                <button
                  onClick={() => router.history.back()}
                  className="shrink-0 h-9 w-9 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 transition lg:hidden"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              ) : (
                <div className="shrink-0 h-9 w-9 grid place-items-center rounded-full bg-accent text-accent-foreground font-bold text-sm lg:hidden">
                  Y
                </div>
              )}
              <div className="min-w-0">
                <h1 className="truncate text-base font-bold tracking-tight">{title}</h1>
                {subtitle && <p className="truncate text-[11px] text-primary-foreground/70">{subtitle}</p>}
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {right}
                {showLogout && (
                  <button
                    onClick={logout}
                    className="h-9 px-3 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold inline-flex items-center gap-1 lg:hidden"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Logout
                  </button>
                )}
              </div>
            </div>
          </header>

          <main
            className={cn(
              "flex-1 px-4 md:px-6 pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300",
              items.length ? "pb-28" : "pb-8",
              "lg:mx-auto lg:w-full lg:max-w-[1100px] lg:px-8 lg:pb-10 lg:pt-6",
            )}
          >
            {children}
          </main>

          {items.length > 0 && (
            <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[clamp(430px,94vw,720px)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
              <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
                {items.map(({ to, label, icon: Icon, exact }) => {
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
    </div>
  );
}
