// Hinglish/English toggle (#16, Dr. Yadav: "haan hinglish or english rakh
// lena toggle"). Per-device preference (localStorage), not per-user in the
// database — this is a UI display choice, not clinical data, and staff
// share devices at the counter, so "whatever this tablet is set to" is the
// right default rather than following a login.
//
// Translation pattern: the DICTIONARY key is the ACTUAL Hinglish string
// already visible in the app's JSX (not an invented key name) -- so a call
// site is just wrapping existing text in t("..."), never renaming
// anything. useT()'s t() returns the English value when the dictionary has
// one and the toggle is set to English, and returns the original string
// unchanged otherwise (Hinglish, or English with no entry yet) -- so a
// screen that hasn't been translated yet is never blank, just still
// Hinglish. This lets translation coverage grow screen-by-screen without
// ever touching this file's call sites again once a string's wrapped.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Language = "hi" | "en";

const STORAGE_KEY = "yhc_language";

interface LanguageContextValue {
  lang: Language;
  setLang: (l: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({ lang: "hi", setLang: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("hi");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "hi") setLangState(saved);
    } catch {
      // Private window / storage blocked — stays on the Hinglish default.
    }
  }, []);

  const setLang = (l: Language) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Preference just won't survive a reload — the toggle itself still works this session.
    }
  };

  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

// Grows one screen at a time. Add an entry here the same turn you wrap a
// new string in t("...") on some screen — duplicate Hinglish keys across
// screens only need one dictionary entry.
const DICTIONARY: Record<string, string> = {
  // ---- Shared chrome (MobileShell / RoleShell) ----
  "Logout": "Logout",

  // ---- index.tsx (Today's Queue / Home) ----
  "Queue load ho rahi hai…": "Loading queue…",
  "Aaj koi patient nahi mila.": "No patients found today.",

  // ---- login.tsx ----
  "Login ho raha hai...": "Logging in...",
  "Login ho gaya, connection slow hai": "Logged in, connection is slow",
  "Profile load nahi ho paya — network check karke dobara try karo.": "Couldn't load your profile — check your network and try again.",
  "Dobara try karo": "Try again",
  "YHC OS • Only registered staff. Bhool gaye PIN? Owner se milein.": "YHC OS • Only registered staff. Forgot your PIN? Ask the Owner.",

  // ---- register.tsx ----
  "Registration Successful": "Registration Successful",
  "Registered at YHC Jaipur": "Registered at YHC Jaipur",
  "Payment Collected": "Payment Collected",
  "Home": "Home",
  "Collect Payment": "Collect Payment",
  "New Patient": "New Patient",
  "Saved Offline": "Saved Offline",
  "ka data save ho gaya": "'s data has been saved",
  "Internet nahi hai abhi — registration (aur payment agar collect kiya tha) is device pe safe hai. Connection wapas aate hi automatically clinic ke system mein chala jaayega. Token/Patient ID tabhi milega.":
    "There's no internet right now — the registration (and payment, if collected) is safe on this device. It will sync to the clinic's system automatically once the connection is back. The Token/Patient ID will only be available then.",
  "Payment Collect Karo": "Collect Payment",
  "Amount galat hai? Change karo": "Wrong amount? Change it",
  "Split ya partial payment karna hai? Pay screen kholo": "Need a split or partial payment? Open the Pay screen",
  "New Patient Registration": "New Patient Registration",
  "⚠ Yeh number pehle se ek patient ke naam hai — neeche dekho.": "⚠ This number is already registered to a patient — see below.",
  "Country code chunkar number likho": "Pick a country code and enter the number",
};

export function useT() {
  const { lang } = useLanguage();
  return (hinglish: string): string => {
    if (lang === "en") {
      const translated = DICTIONARY[hinglish];
      if (translated) return translated;
    }
    return hinglish;
  };
}
