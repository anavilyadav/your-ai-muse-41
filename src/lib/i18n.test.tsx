// #16 Hinglish/English toggle — the core contract: an untranslated string
// (no dictionary entry yet) must render unchanged rather than going blank,
// since translation coverage grows screen-by-screen and most of the app
// isn't covered yet.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageProvider, useLanguage, useT } from "./i18n";

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function Probe() {
  const { lang, setLang } = useLanguage();
  const t = useT();
  return (
    <div>
      <span data-testid="known">{t("Queue load ho rahi hai…")}</span>
      <span data-testid="unknown">{t("Kal subah dobara check karna")}</span>
      <button onClick={() => setLang(lang === "hi" ? "en" : "hi")}>toggle</button>
    </div>
  );
}

describe("i18n", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeMemoryStorage());
  });

  it("defaults to Hinglish and returns strings unchanged", () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("known").textContent).toBe("Queue load ho rahi hai…");
    expect(screen.getByTestId("unknown").textContent).toBe("Kal subah dobara check karna");
  });

  it("switches a translated string to English but leaves an untranslated one unchanged", () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("known").textContent).toBe("Loading queue…");
    expect(screen.getByTestId("unknown").textContent).toBe("Kal subah dobara check karna");
  });

  it("persists the choice to localStorage and a fresh mount picks it up", () => {
    const { unmount } = render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("known").textContent).toBe("Loading queue…");
    unmount();

    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("known").textContent).toBe("Loading queue…");
  });
});
