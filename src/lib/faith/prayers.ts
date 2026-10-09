export const PRAYERS = [{ key: "Fajr", label: "الفجر" }, { key: "Dhuhr", label: "الظهر" }, { key: "Asr", label: "العصر" }, { key: "Maghrib", label: "المغرب" }, { key: "Isha", label: "العشاء" }] as const;
export const PRAYER_METHODS = [{ id: 3, label: "رابطة العالم الإسلامي" }, { id: 2, label: "أمريكا الشمالية — ISNA" }, { id: 4, label: "أم القرى — مكة" }, { id: 5, label: "الهيئة المصرية للمساحة" }, { id: 12, label: "اتحاد المنظمات الإسلامية في فرنسا" }] as const;
// City centers from GeoNames. No account is assigned a location automatically.
export const PRAYER_CITIES = [
  { id: "umea", label: "أوميو — Umeå، السويد", latitude: 63.8284, longitude: 20.2597, timezone: "Europe/Stockholm" },
  { id: "stockholm", label: "ستوكهولم، السويد", latitude: 59.329, longitude: 18.069, timezone: "Europe/Stockholm" },
  { id: "gothenburg", label: "غوتنبرغ، السويد", latitude: 57.707, longitude: 11.967, timezone: "Europe/Stockholm" },
  { id: "malmo", label: "مالمو، السويد", latitude: 55.606, longitude: 13.001, timezone: "Europe/Stockholm" },
  { id: "damascus", label: "دمشق، سوريا", latitude: 33.5102, longitude: 36.2913, timezone: "Asia/Damascus" },
  { id: "aleppo", label: "حلب، سوريا", latitude: 36.2012, longitude: 37.1612, timezone: "Asia/Damascus" },
] as const;
export type PrayerSettings = { label: string; latitude: number; longitude: number; timezone: string; method: number; school: 0 | 1; highLatitude: 1 | 2 | 3 };
export type PrayerKey = typeof PRAYERS[number]["key"];
export type PrayerDay = { date: string; timezone: string; timings: Record<PrayerKey, string | null>; sunrise: string | null; complete: boolean };
export type PrayerSchedule = { today: PrayerDay; tomorrow: PrayerDay };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
export function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 70) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}
export function parseSettings(value: unknown): PrayerSettings | null {
  const v = object(value);
  if (typeof v.label !== "string" || !v.label.trim() || v.label.length > 80 || typeof v.latitude !== "number" || !Number.isFinite(v.latitude) || Math.abs(v.latitude) > 90 || typeof v.longitude !== "number" || !Number.isFinite(v.longitude) || Math.abs(v.longitude) > 180 || !validTimezone(v.timezone) || !PRAYER_METHODS.some(m => m.id === v.method) || (v.school !== 0 && v.school !== 1) || (v.highLatitude !== 1 && v.highLatitude !== 2 && v.highLatitude !== 3)) return null;
  return { label: v.label.trim(), latitude: v.latitude, longitude: v.longitude, timezone: v.timezone, method: v.method as number, school: v.school, highLatitude: v.highLatitude };
}
export function settingsKey(s: PrayerSettings) { return JSON.stringify([s.latitude, s.longitude, s.timezone, s.method, s.school, s.highLatitude]); }
export function zonedDay(now = new Date(), timezone?: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (key: string) => parts.find(p => p.type === key)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function validDay(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day; }
export function nextDay(day: string) { return new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10); }
function validInstant(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
export function parseProviderDay(payload: unknown, date: string, settings: PrayerSettings): PrayerDay {
  const body = object(payload), data = object(body.data), meta = object(data.meta), method = object(meta.method), timings = object(data.timings);
  const gregorian = object(object(data.date).gregorian);
  const [year, month, day] = date.split("-");
  if (body.code !== 200 || gregorian.date !== `${day}-${month}-${year}` || meta.timezone !== settings.timezone || method.id !== settings.method || typeof meta.latitude !== "number" || typeof meta.longitude !== "number" || Math.abs(meta.latitude - settings.latitude) > 0.05 || Math.abs(meta.longitude - settings.longitude) > 0.05) throw new Error("لم يتم التحقق من مواقيت هذا الموقع. حاول مرة أخرى.");
  const school = settings.school === 1 ? "HANAFI" : "STANDARD";
  const highLatitude = { 1: "MIDDLE_OF_THE_NIGHT", 2: "ONE_SEVENTH", 3: "ANGLE_BASED" }[settings.highLatitude];
  if (meta.school !== school || meta.latitudeAdjustmentMethod !== highLatitude) throw new Error("لم يطابق مصدر المواقيت إعدادات الحساب المختارة.");
  const result = Object.fromEntries(PRAYERS.map(p => [p.key, validInstant(timings[p.key]) ? timings[p.key] : null])) as Record<PrayerKey, string | null>;
  const instants = PRAYERS.map(p => result[p.key]);
  const complete = instants.every((time, i) => time && zonedDay(new Date(time), settings.timezone) === date && (i === 0 || Date.parse(time) > Date.parse(instants[i - 1]!)));
  return { date, timezone: settings.timezone, timings: result, sunrise: validInstant(timings.Sunrise) ? timings.Sunrise : null, complete: Boolean(complete) };
}
export function validSchedule(value: unknown, date: string, settings: PrayerSettings): value is PrayerSchedule {
  const v = object(value);
  return ["today", "tomorrow"].every((key, index) => {
    const d = object(v[key]), timings = object(d.timings), expected = index ? nextDay(date) : date;
    if (d.date !== expected || d.timezone !== settings.timezone || typeof d.complete !== "boolean" || !(d.sunrise === null || validInstant(d.sunrise))) return false;
    const times = PRAYERS.map(p => timings[p.key]);
    if (!times.every(t => t === null || validInstant(t))) return false;
    return !d.complete || times.every((t, i) => validInstant(t) && zonedDay(new Date(t), settings.timezone) === expected && (i === 0 || Date.parse(t) > Date.parse(times[i - 1] as string)));
  });
}
export function upcomingPrayer(schedule: PrayerSchedule, now: number) {
  if (!schedule.today.complete) return null;
  const days = schedule.tomorrow.complete ? [schedule.today, schedule.tomorrow] : [schedule.today];
  const events = days.flatMap(day => PRAYERS.map(p => ({ ...p, at: day.timings[p.key]!, date: day.date, timezone: day.timezone })));
  return events.find(event => Date.parse(event.at) >= now - 60000) || null;
}
export function countdown(at: string, now: number, locale = "ar") {
  const minutes = Math.ceil((Date.parse(at) - now) / 60000);
  if (!locale.startsWith("ar")) return minutes <= 0 ? "Time for prayer" : minutes >= 60 ? `In ${Math.floor(minutes / 60)}h ${minutes % 60}m` : `In ${minutes} minutes`;
  if (minutes <= 0) return "حان وقت الصلاة";
  return minutes >= 60 ? `بعد ${Math.floor(minutes / 60)} س و${minutes % 60} د` : `بعد ${minutes} دقيقة`;
}
export function prayerTime(at: string | null, timezone: string, locale = "ar") {
  return at ? new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at)) : locale.startsWith("ar") ? "غير متاح" : "Unavailable";
}
