"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Heart, MessageCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { claimDailyCelebration, todayOccasions } from "@/lib/celebration";
import { dateOnlyLabel } from "@/lib/story";
import type { CoupleProfile, ImportantDate } from "@/lib/types";
import { DatePhoto } from "./DatePhoto";

export function TodayCelebration({ dates, profile, day }: { dates: ImportantDate[]; profile: CoupleProfile; day: string }) {
  const { t, locale } = useLanguage();
  const occasions = useMemo(() => todayOccasions(dates, profile, day), [dates, profile.anniversary, profile.storyPhotoPath, profile.storyPhotoUrl, day]);
  const [activeId, setActiveId] = useState("");
  const [burstFor, setBurstFor] = useState("");
  const owner = `${profile.myUserId || ""}:${profile.coupleId}`;
  const burstKey = `${owner}:${day}`;
  const hasOccasions = occasions.length > 0;

  useEffect(() => {
    if (!hasOccasions) return;
    function start() {
      if (document.visibilityState !== "visible") return;
      let storage: Storage | undefined;
      try { storage = localStorage; } catch {}
      if (!claimDailyCelebration(storage, profile.myUserId || "", profile.coupleId, day)) return;
      let savedReducedMotion = false;
      try { savedReducedMotion = storage?.getItem("together_reduce_motion_v1") === "1"; } catch {}
      const reduced = document.documentElement.dataset.reduceMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || savedReducedMotion;
      if (reduced) return;
      setBurstFor(burstKey);
    }
    start();
    document.addEventListener("visibilitychange", start);
    return () => { document.removeEventListener("visibilitychange", start); };
  }, [hasOccasions, profile.myUserId, profile.coupleId, day, burstKey]);

  useEffect(() => {
    if (!burstFor) return;
    const timer = setTimeout(() => setBurstFor(""), 3600);
    return () => clearTimeout(timer);
  }, [burstFor]);

  if (!occasions.length) return null;
  const index = Math.max(0, occasions.findIndex(item => item.id === activeId));
  const item = occasions[index];
  const title = item.story ? t("Where our story began") : item.title;
  const years = new Intl.NumberFormat(locale, { style: "unit", unit: "year", unitDisplay: "long" }).format(item.years);
  function move(step: number) { setActiveId(occasions[(index + step + occasions.length) % occasions.length].id); }

  return <section className="today-celebration" aria-labelledby="celebration-title">
    {burstFor === burstKey && <div className="celebration-hearts" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={index} className={`celebration-heart celebration-heart-${index}`}><Heart size={12 + index % 3 * 4} fill="currentColor" /></span>)}</div>}
    <div className="celebration-card">
      <div className="celebration-photo"><DatePhoto key={`${owner}:${item.id}`} path={item.photoPath} src={item.photoUrl} alt={t("Photo for {0}", [title])} large /><span aria-hidden="true" className="celebration-photo-heart"><Heart size={16} /></span></div>
      <div className="celebration-copy">
        <span className="celebration-eyebrow"><Sparkles size={14} aria-hidden="true" />{t("TODAY IS YOURS")}</span>
        <h2 id="celebration-title" dir="auto">{title}</h2>
        <p className="celebration-years">{item.years === 0 ? t("The first chapter of a beautiful memory") : t("{0} of beautiful memories", [years])}</p>
        <time dateTime={day} className="celebration-day">{dateOnlyLabel(day, locale)}</time>
        <Link className="celebration-message" href="/chat" aria-label={t("Write a message for {0}", [title])}><MessageCircle size={16} aria-hidden="true" />{t("Write a message")}</Link>
      </div>
    </div>
    {occasions.length > 1 && <div className="celebration-switcher"><p>{t("{0} special moments today", [new Intl.NumberFormat(locale).format(occasions.length)])}</p><div><button type="button" onClick={() => move(-1)} aria-label={t("Previous occasion")}><ChevronLeft size={18} /></button><span aria-live="polite" aria-atomic="true">{t("Occasion {0} of {1}", [new Intl.NumberFormat(locale).format(index + 1), new Intl.NumberFormat(locale).format(occasions.length)])}</span><button type="button" onClick={() => move(1)} aria-label={t("Next occasion")}><ChevronRight size={18} /></button></div></div>}
  </section>;
}
