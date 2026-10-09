"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";

export function StartupLoading() {
  const { t } = useLanguage();

  return <section className="startup-loading" aria-labelledby="startup-brand">
    <div className="startup-content">
      <p className="startup-eyebrow">{t("JUST YOU & ME")}</p>
      <div className="startup-emblem" aria-hidden="true">
        <span className="startup-orbit" />
        <svg viewBox="0 0 160 132" fill="none" focusable="false">
          <path className="startup-heart-back" d="M62 101 25 66C1 43 30 12 52 31L62 40 72 31C94 12 123 43 99 66Z" />
          <path className="startup-heart-front" d="M98 113 61 78C37 55 66 24 88 43L98 52 108 43C130 24 159 55 135 78Z" />
        </svg>
        <span className="startup-spark startup-spark-one" />
        <span className="startup-spark startup-spark-two" />
      </div>
      <h1 id="startup-brand" className="startup-brand" lang="en" dir="ltr">Together<span>.</span></h1>
      <p className="startup-tagline">{t("A little closer, every day.")}</p>
      <div className="startup-status" role="status" aria-live="polite" aria-atomic="true">
        <span className="startup-dots" aria-hidden="true"><i /><i /><i /></span>
        <p>{t("Opening your shared space…")}</p>
      </div>
    </div>
    <p className="startup-footer">{t("Your conversations. Your memories. Your story.")}</p>
  </section>;
}
