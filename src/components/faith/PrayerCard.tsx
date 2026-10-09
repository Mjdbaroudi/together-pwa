"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useEffect, useState } from "react";
import { ChevronLeft, MapPin, RefreshCw, Settings2, Sunrise } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { countdown, prayerTime, PRAYERS, PRAYER_METHODS, settingsKey, upcomingPrayer, validSchedule, zonedDay, type PrayerSchedule, type PrayerSettings } from "@/lib/faith/prayers";
import { readPrayerCache, savePrayerCache } from "@/lib/faith/storage";
import { errorMessage } from "@/lib/errors";
export function PrayerCard({ userId, settings, ready, now, onConfigure }: { userId: string; settings: PrayerSettings | null; ready: boolean; now: number; onConfigure: () => void }) {
  const { t: uiText, locale } = useLanguage();

  const date = zonedDay(new Date(now), settings?.timezone), key = settings ? settingsKey(settings) : "";
  const [result, setResult] = useState<{ key: string; date: string; schedule: PrayerSchedule } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready || !settings) return;
    const config = settings;
    let cancelled = false;
    const controller = new AbortController();
    const cached = readPrayerCache(userId, config, date);
    setResult(cached ? { key, date, schedule: cached } : null); setError("");
    if (cached && cached.tomorrow.complete && attempt === 0) { setLoading(false); return; }
    setLoading(true);
    async function load() {
      try {
        const session = (await getSupabaseBrowser()?.auth.getSession())?.data.session;
        if (!session?.access_token || session.user.id !== userId) throw new Error("سجّل الدخول لعرض مواقيت الصلاة.");
        const query = new URLSearchParams({ latitude: String(config.latitude), longitude: String(config.longitude), timezone: config.timezone, method: String(config.method), school: String(config.school), highLatitude: String(config.highLatitude), date });
        const response = await fetch(`/api/faith/prayers?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal });
        const payload: unknown = await response.json();
        if (!response.ok || !validSchedule(payload, date, config)) throw new Error("تعذّر تحميل المواقيت. تحقّق من الاتصال أو إعدادات الموقع.");
        if (cancelled) return;
        savePrayerCache(userId, config, date, payload); setResult({ key, date, schedule: payload });
      } catch (error: unknown) { if (!cancelled) setError(errorMessage(error, "تعذّر تحميل المواقيت. حاول مجددًا.")); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
    // The key includes every calculation option, so no unrelated Home update reloads times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key, date, ready, attempt]);
  useEffect(() => { const reconnect = () => { if (error && navigator.onLine) setAttempt(n => n + 1); }; window.addEventListener("online", reconnect); return () => window.removeEventListener("online", reconnect); }, [error]);
  const schedule = result?.key === key && result.date === date ? result.schedule : null;
  const next = schedule ? upcomingPrayer(schedule, now) : null;
  return <article className="faith-prayer-card">
    <header><span className="faith-card-label"><Sunrise size={18}/>{uiText("الصلاة القادمة")}</span><button aria-label={uiText("إعداد مواقيت الصلاة")} onClick={onConfigure}><Settings2 size={18}/></button></header>
    {!settings ? <div className="faith-prayer-empty"><span className="faith-prayer-arch" aria-hidden="true"><MoonShape/></span><h3>{uiText("صلاتك، في وقتها")}</h3><p>{uiText("اختر مدينتك لعرض الصلاة القادمة ومواقيت يومك.")}</p><button className="faith-primary" onClick={onConfigure} disabled={!ready}><MapPin size={16}/>{uiText("اختيار المدينة")}<ChevronLeft size={16}/></button></div> : <>
      <button className="faith-city" onClick={onConfigure}><MapPin size={13}/>{uiText(settings.label)}<ChevronLeft size={13}/></button>
      {next ? <div className="faith-next-prayer"><div><span>{next.date !== date ? uiText("غدًا") : uiText("موعدك القادم")}</span><h3>{uiText(next.label)}</h3><p>{countdown(next.at, now, locale)}</p></div><time dir="ltr" dateTime={next.at}>{prayerTime(next.at, settings.timezone, locale)}</time></div> : <div className="faith-prayer-status" role="status">{loading ? uiText("جارٍ تحميل المواقيت…") : schedule ? uiText("بعض المواقيت غير متاحة لهذا الموقع. راجع إعدادات الحساب.") : uiText(error) || uiText("المواقيت غير متاحة الآن.")}</div>}
      {schedule && <><div className="faith-prayer-timetable">{PRAYERS.map(p => <div key={p.key} className={next?.key === p.key && next.date === date ? "next" : ""}><span>{uiText(p.label)}</span><time dir="ltr" dateTime={schedule.today.timings[p.key] || undefined}>{prayerTime(schedule.today.timings[p.key], settings.timezone, locale)}</time></div>)}</div><p className="faith-prayer-source">{schedule.today.sunrise && <>{uiText("الشروق ")}{prayerTime(schedule.today.sunrise, settings.timezone, locale)} · </>}{uiText(PRAYER_METHODS.find(m => m.id === settings.method)?.label || "")}</p></>}
      {error && schedule && <p className="faith-feedback" role="status">{uiText("تعذّر التحديث؛ تُعرض مواقيت اليوم المحفوظة.")}</p>}
      <footer className="faith-prayer-footer"><a href="https://aladhan.com/calculation-methods" target="_blank" rel="noopener noreferrer">{uiText("المصدر: AlAdhan")}</a><button disabled={loading} onClick={() => setAttempt(n => n + 1)} aria-label={uiText("تحديث مواقيت الصلاة")}><RefreshCw size={13}/>{loading ? uiText("تحميل…") : uiText("تحديث")}</button></footer>
      <p className="faith-prayer-note">{uiText("المواقيت حسب الإعدادات المختارة؛ طابقها مع تقويم مسجدك.")}</p>
    </>}
  </article>;
}
function MoonShape() { return <span>☾</span>; }
