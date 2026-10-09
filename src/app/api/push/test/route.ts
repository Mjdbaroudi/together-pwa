import { NextRequest, NextResponse } from "next/server";
import { configureWebPush, deliverPush, getSupabaseRestConfig, type PushSubscriptionRow } from "@/lib/push/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseRestConfig();
  const webPush = configureWebPush();
  return NextResponse.json({
    ok: true,
    route: "/api/push/test",
    supabaseConfigured: Boolean(supabase),
    vapidPublicConfigured: webPush.vapid.diagnostics.publicConfigured,
    vapidPrivateConfigured: webPush.vapid.diagnostics.privateConfigured,
    vapidSubjectConfigured: Boolean(webPush.vapid.subject),
    vapidDiagnostics: webPush.vapid.diagnostics,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "No session token was sent. Sign out and sign in again." }, { status: 401 });

    const supabase = getSupabaseRestConfig();
    if (!supabase) return NextResponse.json({ error: "Supabase server configuration is missing." }, { status: 503 });

    const webPush = configureWebPush();
    if (!webPush.ok) {
      return NextResponse.json({ error: webPush.error, vapidDiagnostics: webPush.vapid.diagnostics }, { status: 503 });
    }

    const response = await fetch(`${supabase.url}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth`, {
      headers: { apikey: supabase.key, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      const unauthorized = response.status === 401 || response.status === 403;
      return NextResponse.json(
        {
          error: unauthorized
            ? `Session authentication failed (HTTP ${response.status}). Sign out of Together, sign back in, then try again.`
            : `Could not read this device subscription (HTTP ${response.status}).${detail ? ` ${detail}` : ""}`,
        },
        { status: unauthorized ? 401 : 500 },
      );
    }

    const subscriptions = (await response.json()) as PushSubscriptionRow[];
    if (!subscriptions.length) {
      return NextResponse.json(
        { error: "No push subscription is saved for this account. Turn Notifications off and on again in Together settings." },
        { status: 409 },
      );
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
    const result = await deliverPush(subscriptions, {
      title: "Together ♥",
      body: "Test notification — push is working on this device.",
      url: "/settings",
    });

    return NextResponse.json({ ok: result.delivered > 0, ...result, vapidDiagnostics: webPush.vapid.diagnostics });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error("Together push test route crashed", error);
    return NextResponse.json({ error: `Push test route crashed: ${message}` }, { status: 500 });
  }
}
