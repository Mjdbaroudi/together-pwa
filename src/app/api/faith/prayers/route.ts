import { NextResponse } from "next/server";
import { authenticateCall, CallServerError } from "@/lib/calls/server";
import { nextDay, parseProviderDay, parseSettings, validDay } from "@/lib/faith/prayers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
export async function GET(request: Request) {
  try {
    await authenticateCall(request);
    const q = new URL(request.url).searchParams;
    const settings = parseSettings({ label: "الموقع المختار", latitude: Number(q.get("latitude")), longitude: Number(q.get("longitude")), timezone: q.get("timezone"), method: Number(q.get("method")), school: Number(q.get("school")), highLatitude: Number(q.get("highLatitude")) });
    const date = q.get("date") || "";
    if (!q.has("latitude") || !q.has("longitude") || !settings || !validDay(date) || Math.abs(Date.parse(`${date}T12:00:00Z`) - Date.now()) > 3 * 86400000) return NextResponse.json({ error: "تحقّق من إعدادات المدينة والتاريخ." }, { status: 400, headers });
    async function fetchDay(day: string) {
      const [year, month, d] = day.split("-");
      const url = new URL(`https://api.aladhan.com/v1/timings/${d}-${month}-${year}`);
      for (const [key, value] of Object.entries({ latitude: settings!.latitude, longitude: settings!.longitude, method: settings!.method, school: settings!.school, latitudeAdjustmentMethod: settings!.highLatitude, timezonestring: settings!.timezone, iso8601: "true" })) url.searchParams.set(key, String(value));
      const response = await fetch(url, { next: { revalidate: 21600 }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("تعذّر تحميل المواقيت الآن. حاول بعد قليل.");
      return parseProviderDay(await response.json(), day, settings!);
    }
    const [today, tomorrow] = await Promise.all([fetchDay(date), fetchDay(nextDay(date))]);
    return NextResponse.json({ today, tomorrow }, { headers });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof CallServerError ? (error.status === 401 ? "سجّل الدخول لعرض مواقيت الصلاة." : "تعذّر التحقق من الحساب. حاول مجددًا.") : "تعذّر التحقق من مواقيت هذا الموقع الآن. حاول مجددًا أو غيّر إعدادات الموقع." }, { status: error instanceof CallServerError ? error.status : 503, headers });
  }
}
