import webpush from "web-push";
import { normalizeVapidBase64Url, normalizeVapidSubject, vapidDiagnostics } from "@/lib/push/vapid";

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };

export function getSupabaseRestConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export function getVapidConfig() {
  const rawPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const rawPrivate = process.env.VAPID_PRIVATE_KEY;
  return {
    publicKey: normalizeVapidBase64Url(rawPublic),
    privateKey: normalizeVapidBase64Url(rawPrivate),
    subject: normalizeVapidSubject(process.env.VAPID_SUBJECT),
    diagnostics: vapidDiagnostics(rawPublic, rawPrivate),
  };
}

export function configureWebPush() {
  const vapid = getVapidConfig();
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) {
    return { ok: false as const, error: "Push keys are not configured.", vapid };
  }
  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    return { ok: true as const, vapid };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown VAPID error";
    return { ok: false as const, error: `VAPID configuration is invalid after normalization: ${message}`, vapid };
  }
}

export function pushErrorMessage(error: unknown) {
  const value = error as { statusCode?: number; body?: unknown; message?: unknown };
  const status = value?.statusCode ? `HTTP ${value.statusCode}` : "Push error";
  const body = typeof value?.body === "string" ? value.body.slice(0, 240) : "";
  const message = typeof value?.message === "string" ? value.message : "Unknown error";
  return body ? `${status}: ${body}` : `${status}: ${message}`;
}

export async function deliverPush(subscriptions: PushSubscriptionRow[], payload: { title: string; body: string; url: string; type?: string; callId?: string; expiresAt?: number }, options?: { TTL: number }) {
  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        options,
      );
      delivered += 1;
    } catch (error: unknown) {
      failed += 1;
      const message = pushErrorMessage(error);
      errors.push(message);
      console.error("Together push delivery failed", message);
    }
  }

  return { subscriptions: subscriptions.length, delivered, failed, errors };
}
