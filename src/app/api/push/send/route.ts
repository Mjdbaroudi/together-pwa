import { NextRequest, NextResponse } from "next/server";
import { configureWebPush, deliverPush, getSupabaseRestConfig, type PushSubscriptionRow } from "@/lib/push/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = await request.json().catch(() => null) as { messageId?: unknown } | null;
  const messageId = input?.messageId;
  if (messageId !== undefined && (typeof messageId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId))) return NextResponse.json({ error: "Invalid message." }, { status: 400 });

  const supabase = getSupabaseRestConfig();
  if (!supabase) return NextResponse.json({ error: "Supabase server configuration is missing." }, { status: 503 });

  const webPush = configureWebPush();
  if (!webPush.ok) {
    return NextResponse.json({ error: webPush.error, vapidDiagnostics: webPush.vapid.diagnostics }, { status: 503 });
  }

  const response = await fetch(`${supabase.url}/rest/v1/rpc/${messageId ? "get_message_push_subscriptions" : "get_partner_push_subscriptions"}`, {
    method: "POST",
    headers: {
      apikey: supabase.key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: messageId ? JSON.stringify({ p_message: messageId }) : "{}",
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 220);
    const unauthorized = response.status === 401 || response.status === 403;
    return NextResponse.json(
      { error: `Push database/auth request failed (HTTP ${response.status}).${detail ? ` ${detail}` : ""}` },
      { status: unauthorized ? 401 : 503 },
    );
  }

  const subscriptions = (await response.json()) as PushSubscriptionRow[];
  const result = await deliverPush(subscriptions || [], {
    title: "Together ♥",
    body: "You have a new private message.",
    url: "/chat",
  }, { TTL: 30 });

  return NextResponse.json({ ok: result.delivered > 0 || !subscriptions?.length, ...result });
}

export async function GET() {
  const webPush = configureWebPush();
  return NextResponse.json({
    configured: webPush.ok,
    vapidDiagnostics: webPush.vapid.diagnostics,
  });
}
