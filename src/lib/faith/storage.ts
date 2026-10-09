import { ADHKAR, type DhikrPeriod } from "@/lib/faith/content";
import { nextDay, parseSettings, PRAYERS, settingsKey, validDay, validSchedule, type PrayerSchedule, type PrayerSettings } from "@/lib/faith/prayers";
export type DhikrCounts = Record<string, number>;
export type DhikrProgress = { day: string; morning: DhikrCounts; evening: DhikrCounts };
const prefix = "together:faith:";
function read(key: string): unknown { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function write(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { throw new Error("تعذّر حفظ اختيارك على هذا الجهاز. اسمح للتطبيق بحفظ البيانات وحاول مجددًا."); } }
export function readPrayerSettings(userId: string) { return parseSettings(read(`${prefix}settings:${userId}`)); }
export function savePrayerSettings(userId: string, settings: PrayerSettings | null) {
  if (!userId) throw new Error("سجّل الدخول لحفظ اختيارك.");
  if (settings && !parseSettings(settings)) throw new Error("تحقّق من إعدادات الموقع.");
  write(`${prefix}settings:${userId}`, settings);
}
function normalizeCounts(value: unknown): DhikrCounts {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(ADHKAR.map(item => { const value = record[item.id]; return [item.id, typeof value === "number" && Number.isFinite(value) ? Math.min(item.count, Math.max(0, Math.floor(value))) : 0]; }));
}
export function readDhikrProgress(userId: string, day: string): DhikrProgress {
  const raw = read(`${prefix}adhkar:${userId}`);
  const v = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return { day, morning: normalizeCounts(v.day === day ? v.morning : null), evening: normalizeCounts(v.day === day ? v.evening : null) };
}
export function saveDhikrCount(userId: string, day: string, period: DhikrPeriod, id: string, count: number) {
  const item = ADHKAR.find(d => d.id === id);
  if (!userId || !item || !Number.isFinite(count)) throw new Error("تعذّر حفظ تقدّم الذكر.");
  const progress = readDhikrProgress(userId, day);
  progress[period][id] = Math.min(item.count, Math.max(0, Math.floor(count)));
  write(`${prefix}adhkar:${userId}`, progress);
  return progress;
}
export function readPrayerCache(userId: string, settings: PrayerSettings, date: string): PrayerSchedule | null {
  const raw = read(`${prefix}prayers:${userId}`);
  const v = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (v.key !== settingsKey(settings)) return null;
  if (v.date === date && validSchedule(v.schedule, date, settings)) return v.schedule;
  // Yesterday's fetched "tomorrow" is still a verified timetable after midnight.
  if (typeof v.date === "string" && validDay(v.date) && nextDay(v.date) === date && validSchedule(v.schedule, v.date, settings)) {
    return { today: v.schedule.tomorrow, tomorrow: { date: nextDay(date), timezone: settings.timezone, complete: false, sunrise: null, timings: Object.fromEntries(PRAYERS.map(p => [p.key, null])) as PrayerSchedule["today"]["timings"] } };
  }
  return null;
}
export function savePrayerCache(userId: string, settings: PrayerSettings, date: string, schedule: PrayerSchedule) {
  if (!validSchedule(schedule, date, settings)) return;
  try { write(`${prefix}prayers:${userId}`, { key: settingsKey(settings), date, schedule }); } catch { /* Optional network cache; saved preferences remain separate. */ }
}
