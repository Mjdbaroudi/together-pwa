"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { Overlay } from "@/components/common/Overlay";
import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, X } from "lucide-react";
import { PRAYER_CITIES, PRAYER_METHODS, validTimezone, type PrayerSettings } from "@/lib/faith/prayers";
import { savePrayerSettings } from "@/lib/faith/storage";
import { errorMessage } from "@/lib/errors";
export default function PrayerSettingsDialog({ current, userId, onSave, onClose }: { current: PrayerSettings | null; userId: string; onSave: (settings: PrayerSettings | null) => void; onClose: () => void }) {
  const { t: uiText } = useLanguage();

  const [location, setLocation] = useState(current);
  const [method, setMethod] = useState(current?.method || 3), [school, setSchool] = useState<0 | 1>(current?.school || 0), [highLatitude, setHighLatitude] = useState<1 | 2 | 3>(current?.highLatitude || 3);
  const [gpsBusy, setGpsBusy] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const preset = PRAYER_CITIES.find(city => city.latitude === location?.latitude && city.longitude === location.longitude)?.id || "";
  function choose(id: string) {
    const city = PRAYER_CITIES.find(c => c.id === id);
    if (city) { setLocation({ ...city, method, school, highLatitude }); setError(""); }
  }
  function locate() {
    if (gpsBusy) return;
    if (!navigator.geolocation) { setError("تحديد الموقع غير متاح. اختر مدينة من القائمة."); return; }
    setGpsBusy(true); setError("");
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!validTimezone(timezone)) { setError("تعذّر معرفة المنطقة الزمنية. اختر مدينة من القائمة."); setGpsBusy(false); return; }
      setLocation({ label: "موقعي الحالي", latitude: Math.round(position.coords.latitude * 100) / 100, longitude: Math.round(position.coords.longitude * 100) / 100, timezone, method, school, highLatitude }); setGpsBusy(false);
    }, () => { if (mounted.current) { setError("لم نتمكّن من تحديد الموقع. اسمح به أو اختر مدينة من القائمة."); setGpsBusy(false); } }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }
  function save() {
    if (!location) { setError("اختر مدينتك أو استخدم تحديد الموقع أولًا."); return; }
    const settings = { ...location, method, school, highLatitude };
    try { savePrayerSettings(userId, settings); onSave(settings); }
    catch (error: unknown) { setError(errorMessage(error)); }
  }
  function clear() { try { savePrayerSettings(userId, null); onSave(null); } catch (error: unknown) { setError(errorMessage(error)); } }
  return <Overlay className="faith-dialog-backdrop"><section className="modal faith-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="prayer-settings-title" ><header className="faith-dialog-heading"><div><span className="faith-kicker"><MapPin size={14}/>{uiText("حسب موقعك")}</span><h2 id="prayer-settings-title">{uiText("مواقيت الصلاة")}</h2></div><button aria-label={uiText("Close")} onClick={onClose}><X size={20}/></button></header><p className="faith-dialog-intro">{uiText("إعداداتك مستقلة على هذا الجهاز. اختر المدينة التي تصلي فيها.")}</p>{error && <p className="notice error" role="alert">{uiText(error)}</p>}<label htmlFor="faith-city">{uiText("المدينة")}</label><select id="faith-city" className="input" value={preset} onChange={e => choose(e.target.value)} disabled={gpsBusy}><option value="">{location && !preset ? uiText("موقعي الحالي") : uiText("اختر مدينة")}</option>{PRAYER_CITIES.map(city => <option key={city.id} value={city.id}>{uiText(city.label)}</option>)}</select><button className="faith-gps-button" onClick={locate} disabled={gpsBusy}><LocateFixed size={18}/>{gpsBusy ? uiText("جارٍ تحديد الموقع…") : uiText("استخدم موقعي الحالي")}</button><p className="faith-setting-hint">{uiText("لمدينة أخرى، استخدم موقعك. يُستخدم لحساب المواقيت ولا يُشارك مع الحساب الآخر.")}</p>{location && <p className="faith-location-preview"><MapPin size={14}/>{uiText(location.label)}<span dir="ltr">{location.timezone}</span></p>}<label htmlFor="faith-method">{uiText("طريقة حساب المواقيت")}</label><select id="faith-method" className="input" value={method} onChange={e => setMethod(Number(e.target.value))}>{PRAYER_METHODS.map(m => <option key={m.id} value={m.id}>{uiText(m.label)}</option>)}</select><details className="faith-calculation-details"><summary>{uiText("إعدادات حساب إضافية")}</summary><label htmlFor="faith-school">{uiText("حساب وقت العصر")}</label><select id="faith-school" className="input" value={school} onChange={e => setSchool(Number(e.target.value) as 0 | 1)}><option value={0}>{uiText("الجمهور")}</option><option value={1}>{uiText("الحنفي")}</option></select><label htmlFor="faith-latitude">{uiText("تقدير الفجر والعشاء في خطوط العرض العالية")}</label><select id="faith-latitude" className="input" value={highLatitude} onChange={e => setHighLatitude(Number(e.target.value) as 1 | 2 | 3)}><option value={3}>{uiText("بحسب زاوية الشفق")}</option><option value={1}>{uiText("منتصف الليل")}</option><option value={2}>{uiText("سُبع الليل")}</option></select><p className="faith-setting-hint">{uiText("مفيد لشمال السويد. اختر الطريقة المعتمدة في مسجدك.")}</p></details><div className="faith-dialog-actions"><button className="faith-primary" onClick={save} disabled={gpsBusy}>{uiText("حفظ المواقيت")}</button><button className="faith-secondary sheet-cancel" onClick={onClose}>{uiText("إلغاء")}</button></div>{current && <button className="faith-remove-location" onClick={clear}>{uiText("إزالة الموقع المحفوظ")}</button>}</section></Overlay>;
}
