import { NextResponse } from "next/server";
import { authenticateCall, CallServerError, callUuid } from "@/lib/calls/server";
import { configureWebPush, deliverPush, type PushSubscriptionRow } from "@/lib/push/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const account = await authenticateCall(request);
    const input = await request.json().catch(() => null) as { callId?: string; deviceId?: string } | null;
    if (!callUuid(input?.callId) || !callUuid(input?.deviceId)) throw new CallServerError("Invalid call.", 400);
    const callResponse = await fetch(`${account.config.url}/rest/v1/voice_calls?select=created_at,media_kind&couple_id=eq.${account.coupleId}&id=eq.${input.callId}&caller_id=eq.${account.userId}&caller_device=eq.${input.deviceId}&state=eq.ringing`, { headers: account.headers, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!callResponse.ok) throw new CallServerError("Could not verify the call. Apply database update 009.", 503);
    const calls = await callResponse.json() as { created_at: string; media_kind?: string }[];
    if (calls.length !== 1) throw new CallServerError("Call is no longer ringing.", 409);
    const expiresAt = new Date(calls[0].created_at).getTime() + 45000;
    if (expiresAt <= Date.now()) throw new CallServerError("Call has expired.", 409);
    if (!configureWebPush().ok) return NextResponse.json({ warning: "Call is ringing in the app. Push notifications are not configured." });
    const response = await fetch(`${account.config.url}/rest/v1/rpc/claim_voice_call_push`, { method: "POST", headers: account.headers, body: JSON.stringify({ p_call: input.callId, p_device: input.deviceId }), cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new CallServerError("Could not notify your partner.", 503);
    const subscriptions = await response.json() as PushSubscriptionRow[];
    const result = await deliverPush(subscriptions, { title: "Together — Incoming call", body: `Incoming ${calls[0].media_kind === "video" ? "video" : "voice"} call. Open Together to answer.`, url: `/chat?call=${input.callId}`, type: "voice-call", callId: input.callId, expiresAt }, { TTL: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) });
    return NextResponse.json({ ...result, warning: result.delivered ? undefined : "Call is ringing in the app. Your partner may need to open Together; no push alert was delivered." });
  } catch (error: unknown) { return NextResponse.json({ error: error instanceof CallServerError ? error.message : "Could not send the incoming-call alert." }, { status: error instanceof CallServerError ? error.status : 503 }); }
}
