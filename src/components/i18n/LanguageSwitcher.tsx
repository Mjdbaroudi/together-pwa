"use client";
import { Languages } from "lucide-react";
import { useLanguage } from "./LanguageProvider";
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useLanguage();
  return <section className={compact ? "language-compact" : "settings-row language-setting"} aria-label={t("Language")}>
    {!compact && <><span className="icon-chip"><Languages size={21}/></span><div className="grow"><h3>{t("Language")}</h3><p>{t("Choose the language for this device")}</p></div></>}
    <div className="language-options" role="group" aria-label={t("Language")}><button type="button" aria-pressed={language === "ar"} onClick={() => setLanguage("ar")} lang="ar" dir="rtl">العربية</button><button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")} lang="en" dir="ltr">English</button></div>
  </section>;
}
