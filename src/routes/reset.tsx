import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/reset")({
  head: () => ({ meta: [{ title: "App Reset — YHC Jaipur" }, { name: "robots", content: "noindex" }] }),
  component: ResetPage,
});

// Recovery page for an installed app (MacBook / iPhone home screen) that is
// stuck on an old version or the wrong screen (Dr. Yadav, 23 Oct 2026).
// It drops everything the browser cached for this app — service workers,
// cached files, the saved preview and sign-in — then opens the login page
// fresh. It deliberately keeps yhc_offline_queue_v1: entries saved while
// offline and not yet sent must survive a reset.
const KEEP_KEYS = ["yhc_offline_queue_v1"];

function ResetPage() {
  const [step, setStep] = useState("Saaf kar rahe hain…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await supabase.auth.signOut({ scope: "local" }); } catch {}
      try {
        const regs = await navigator.serviceWorker?.getRegistrations?.();
        await Promise.all((regs ?? []).map((r) => r.unregister()));
      } catch {}
      try {
        const keys = await caches?.keys?.();
        await Promise.all((keys ?? []).map((k) => caches.delete(k)));
      } catch {}
      try {
        const kept = KEEP_KEYS.map((k) => [k, localStorage.getItem(k)] as const);
        localStorage.clear();
        sessionStorage.clear();
        kept.forEach(([k, v]) => { if (v !== null) localStorage.setItem(k, v); });
      } catch {}
      if (cancelled) return;
      setStep("Ho gaya — login page khul raha hai…");
      setTimeout(() => window.location.replace("/login"), 800);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen w-full bg-background grid place-items-center px-6">
      <div className="text-center max-w-xs">
        <div className="text-sm font-semibold text-foreground mb-1">App reset</div>
        <div className="text-xs text-muted-foreground animate-pulse">{step}</div>
      </div>
    </div>
  );
}
