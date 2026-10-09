"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { BookOpen, Check, ChevronLeft, Moon, Share2, Sparkles, Sun } from "lucide-react";
import { useTogether } from "@/components/providers/TogetherProvider";
import { ADHKAR, verseForDay, type DhikrPeriod } from "@/lib/faith/content";
import { zonedDay, type PrayerSettings } from "@/lib/faith/prayers";
import { readDhikrProgress, readPrayerSettings, saveDhikrCount, type DhikrProgress } from "@/lib/faith/storage";
import { PrayerCard } from "@/components/faith/PrayerCard";
const AdhkarReader = dynamic(() => import("@/components/faith/AdhkarReader"));
const PrayerSettingsDialog = dynamic(() => import("@/components/faith/PrayerSettingsDialog"));
export function useFaithClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    const timer = window.setInterval(update, 30000);
    window.addEventListener("pageshow", update); document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); window.removeEventListener("pageshow", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  return now;
}
export function FaithSection() {
  const { profile } = useTogether();
  return profile.myUserId ? <AccountFaith key={profile.myUserId} userId={profile.myUserId}/> : null;
}
function AccountFaith({ userId }: { userId: string }) {
  const { t: uiText } = useLanguage();

  const [settings, setSettings] = useState<PrayerSettings | null>(null);
  const [ready, setReady] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const [reader, setReader] = useState<DhikrPeriod | null>(null), [sharing, setSharing] = useState(false), [shareMessage, setShareMessage] = useState("");
  const now = useFaithClock(), day = zonedDay(new Date(now), settings?.timezone);
  const [progress, setProgress] = useState<DhikrProgress>(() => ({ day: "", morning: {}, evening: {} }));
  useEffect(() => { setSettings(readPrayerSettings(userId)); setReady(true); }, [userId]);
  useEffect(() => {
    const update = () => setProgress(readDhikrProgress(userId, day));
    update();
    const storage = (event: StorageEvent) => {
      if (event.key === `together:faith:adhkar:${userId}` || event.key === null) update();
      if (event.key === `together:faith:settings:${userId}` || event.key === null) setSettings(readPrayerSettings(userId));
    };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, [userId, day]);
  const verse = verseForDay(day);
  const completed = (period: DhikrPeriod) => progress.day === day ? ADHKAR.filter(d => (progress[period][d.id] || 0) >= d.count).length : 0;
  function updateCount(period: DhikrPeriod, id: string, count: number) { setProgress(saveDhikrCount(userId, day, period, id, count)); }
  async function shareVerse() {
    if (sharing) return;
    setSharing(true); setShareMessage("");
    const text = `${verse.text}\n${uiText("سورة")} ${uiText(verse.surah)} · ${verse.key}\nhttps://quran.com/${verse.key}`;
    try {
      if (navigator.share) await navigator.share({ title: `${uiText("آية اليوم")} · ${uiText(verse.surah)}`, text });
      else { await navigator.clipboard.writeText(text); setShareMessage("تم نسخ الآية مع مرجعها."); }
    } catch (error: unknown) { if (!(error instanceof DOMException && error.name === "AbortError")) setShareMessage("تعذّرت المشاركة. يمكنك تحديد النص ونسخه."); }
    finally { setSharing(false); }
  }
  return <section className="faith-section"  aria-labelledby="faith-heading">
    <header className="faith-section-heading"><div><span className="faith-kicker"><Sparkles size={13}/>{uiText("معًا على خير")}</span><h2 id="faith-heading">{uiText("لحظة إيمان")}</h2><p>{uiText("فسحة صغيرة للذكر والسكينة")}</p></div><span className="faith-heading-mark" aria-hidden="true">✦</span></header>
    <div className="faith-grid">
      <PrayerCard userId={userId} settings={settings} ready={ready} now={now} onConfigure={() => setSettingsOpen(true)}/>
      <article className="faith-verse-card"><div className="faith-card-label"><BookOpen size={17}/><span>{uiText("آية اليوم")}</span><span className="faith-verse-theme">{uiText(verse.theme)}</span></div><blockquote className="faith-quran" lang="ar" dir="rtl">{verse.text}</blockquote><p className="faith-verse-reference">{uiText("سورة ")}{uiText(verse.surah)} <span dir="ltr">{verse.key}</span></p><details className="faith-tafsir"><summary>{uiText("المعنى باختصار ")}<ChevronLeft size={15}/></summary><p>{uiText(verse.meaning)}</p><a href={`https://quran.com/${verse.key}/tafsirs/ar-tafseer-al-saddi`} target="_blank" rel="noopener noreferrer">{uiText("بتصرّف من تفسير السعدي · اقرأ الأصل")}</a></details><footer><a href={`https://quran.com/${verse.key}`} target="_blank" rel="noopener noreferrer">{uiText("اقرأ في المصحف ")}<ChevronLeft size={14}/></a><button disabled={sharing} onClick={() => void shareVerse()}><Share2 size={15}/>{sharing ? uiText("جارٍ المشاركة…") : uiText("مشاركة الآية")}</button></footer>{shareMessage && <p className="faith-feedback" role="status">{uiText(shareMessage)}</p>}</article>
      <article className="faith-adhkar-card"><div className="faith-card-label"><Sun size={17}/><span>{uiText("ذكرٌ يرافق يومك")}</span></div><div className="faith-adhkar-actions">{(["morning", "evening"] as const).map(period => { const done = completed(period); return <button key={period} onClick={() => setReader(period)} aria-label={period === "morning" ? uiText("فتح أذكار الصباح") : uiText("فتح أذكار المساء")}><span className={`faith-period-icon ${period}`}>{period === "morning" ? <Sun size={23}/> : <Moon size={23}/>}</span><strong>{period === "morning" ? uiText("أذكار الصباح") : uiText("أذكار المساء")}</strong><small>{done === ADHKAR.length ? <><Check size={12}/>{uiText("اكتملت اليوم")}</> : uiText("{0} of {1} adhkar", [done, ADHKAR.length])}</small><ChevronLeft size={15}/></button>; })}</div><p className="faith-local-note">{uiText("تقدّمك محفوظ لك على هذا الجهاز")}</p></article>
    </div>
    {reader && <AdhkarReader period={reader} progress={progress.day === day ? progress[reader] : {}} onCount={(id, count) => updateCount(reader, id, count)} onClose={() => setReader(null)}/>}
    {settingsOpen && <PrayerSettingsDialog current={settings} userId={userId} onSave={value => { setSettings(value); setSettingsOpen(false); }} onClose={() => setSettingsOpen(false)}/>}
  </section>;
}
