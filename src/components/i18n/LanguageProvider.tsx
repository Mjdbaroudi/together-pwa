"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LANGUAGE_KEY, isLanguage, preferredLanguage, translate, type AppLanguage } from "@/lib/i18n";

type LanguageContext = { language: AppLanguage; locale: string; setLanguage: (language: AppLanguage) => void; t: (text: string, values?: readonly (string | number | undefined)[]) => string };
const Context = createContext<LanguageContext>({ language: "en", locale: "en-GB", setLanguage: () => undefined, t: (text, values) => translate("en", text, values) });
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setState] = useState<AppLanguage>("en");
  const setLanguage = useCallback((value: AppLanguage) => { if (!isLanguage(value)) return; setState(value); try { localStorage.setItem(LANGUAGE_KEY, value); } catch {} }, []);
  useEffect(() => { let saved: string | null = null; try { saved = localStorage.getItem(LANGUAGE_KEY); } catch {} setState(preferredLanguage(saved, navigator.language)); }, []);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === "ar" ? "rtl" : "ltr"; }, [language]);
  useEffect(() => { const sync = (event: StorageEvent) => { if (event.key === LANGUAGE_KEY && isLanguage(event.newValue)) setState(event.newValue); }; window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync); }, []);
  const value = useMemo<LanguageContext>(() => ({ language, locale: language === "ar" ? "ar" : "en-GB", setLanguage, t: (text, values) => translate(language, text, values) }), [language, setLanguage]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useLanguage = () => useContext(Context);
