import { useEffect } from "react";
import { toast } from "sonner";

// Installed apps (MacBook / iPhone home screen) stay alive in the background
// and keep running the code they first loaded — after a deploy they never
// picked up fixes until fully closed (Dr. Yadav, 22 Oct 2026: the installed
// app kept opening the Reception view while the browser was fine). sw.js
// doesn't change between deploys, so its controllerchange prompt in
// InstallPrompt never fires for them.
//
// Every deploy changes the hashed /assets/index-*.js the page loads, so the
// app compares that name with the one the server sends now:
// - back in the foreground after more than AWAY_RELOAD_MS: reload straight
//   away (nobody is mid-form after that long);
// - otherwise (still open, or only briefly away — e.g. switched to WhatsApp
//   to copy a number): offer a Reload button, never wipe a half-filled form.
const CHECK_EVERY_MS = 10 * 60 * 1000;
const AWAY_RELOAD_MS = 5 * 60 * 1000;
const ENTRY_RE = /\/assets\/index-[\w-]+\.js/;

function loadedEntry(): string | null {
  for (const el of Array.from(document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[href]"))) {
    const url = (el as HTMLScriptElement).src || (el as HTMLLinkElement).href || "";
    const m = url.match(ENTRY_RE);
    if (m) return m[0];
  }
  return null;
}

async function servedEntry(): Promise<string | null> {
  try {
    const res = await fetch("/", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.text()).match(ENTRY_RE)?.[0] ?? null;
  } catch {
    return null;
  }
}

export function UpdateChecker() {
  useEffect(() => {
    if (!import.meta.env.PROD || typeof window === "undefined") return;
    const current = loadedEntry();
    if (!current) return;

    // An app left open for days still holds the old page, whose other
    // screens' files no longer exist on the server after a deploy (404) —
    // opening one hangs the app. Vite reports that as "vite:preloadError";
    // reload once to get the current files (guard: never loop).
    const onPreloadError = (e: Event) => {
      e.preventDefault();
      try {
        const last = Number(sessionStorage.getItem("yhc_chunk_reload") ?? 0);
        if (Date.now() - last < 30_000) return;
        sessionStorage.setItem("yhc_chunk_reload", String(Date.now()));
      } catch {}
      window.location.reload();
    };
    window.addEventListener("vite:preloadError", onPreloadError);

    let hiddenAt: number | null = null;
    let prompted = false;

    const check = async (canReloadNow: boolean) => {
      const served = await servedEntry();
      if (!served || served === current) return;
      if (canReloadNow) {
        window.location.reload();
        return;
      }
      if (prompted) return;
      prompted = true;
      toast("Naya version aa gaya hai", {
        description: "Reload karo latest changes ke liye",
        duration: Infinity,
        action: { label: "Reload", onClick: () => window.location.reload() },
        cancel: { label: "Baad mein", onClick: () => { prompted = false; } },
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      void check(away > AWAY_RELOAD_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void check(false);
    }, CHECK_EVERY_MS);
    return () => {
      window.removeEventListener("vite:preloadError", onPreloadError);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, []);

  return null;
}
