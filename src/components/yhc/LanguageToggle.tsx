import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Placed in both MobileShell and RoleShell's header, right next to Logout
// — visible on every screen in the app, not just the ones translated so
// far, so it's always there once the rest are done too.
export function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  return (
    <div className="flex items-center rounded-full bg-white/10 p-0.5 text-[10px] font-bold shrink-0">
      <button
        onClick={() => setLang("hi")}
        className={cn("px-2 py-1 rounded-full transition", lang === "hi" ? "bg-white/25" : "opacity-60")}
        aria-label="Hinglish"
      >
        हि
      </button>
      <button
        onClick={() => setLang("en")}
        className={cn("px-2 py-1 rounded-full transition", lang === "en" ? "bg-white/25" : "opacity-60")}
        aria-label="English"
      >
        EN
      </button>
    </div>
  );
}
