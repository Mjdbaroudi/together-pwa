import type { CoupleProfile, ImportantDate } from "@/lib/types";
import { orderedSpecialDates, specialDateStatus, validCalendarDate } from "@/lib/story";

export type TodayOccasion = {
  id: string;
  title: string;
  originalDate: string;
  years: number;
  photoPath?: string;
  photoUrl?: string;
  story: boolean;
};

export function todayOccasions(dates: readonly ImportantDate[], profile: CoupleProfile, today: string): TodayOccasion[] {
  if (!validCalendarDate(today)) return [];
  const occasions: TodayOccasion[] = [];
  for (const date of orderedSpecialDates(dates)) {
    const status = specialDateStatus(date, today);
    if (status?.days === 0) occasions.push({ id: date.id, title: date.title, originalDate: date.localDate!, years: status.years, photoPath: date.photoPath, story: false });
  }
  const originalDate = profile.anniversary;
  if (originalDate && validCalendarDate(originalDate) && !occasions.some(item => item.originalDate === originalDate)) {
    const status = specialDateStatus({ id: "story", title: "", date: originalDate, kind: "anniversary", localDate: originalDate, repeatsYearly: true }, today);
    if (status?.days === 0) occasions.push({ id: "story-anniversary", title: "", originalDate, years: status.years, photoPath: profile.storyPhotoPath, photoUrl: profile.storyPhotoUrl, story: true });
  }
  return occasions;
}

type StorageAccess = Pick<Storage, "getItem" | "setItem">;
const shownDays = new Map<string, string>();

// One small record per account/pair; blocked storage still suppresses repeats in this tab.
export function claimDailyCelebration(storage: StorageAccess | undefined, userId: string, coupleId: string, day: string) {
  if (!userId || !coupleId || !validCalendarDate(day)) return false;
  const key = `together_celebration_v1:${userId}:${coupleId}`;
  if (shownDays.get(key) === day) return false;
  try {
    if (storage?.getItem(key) === day) { shownDays.set(key, day); return false; }
    storage?.setItem(key, day);
  } catch { /* Keep the page usable when this browser blocks persistence. */ }
  shownDays.set(key, day);
  return true;
}
