import { getSupabaseBrowser } from "@/lib/supabase/client";
import { normalizeVapidBase64Url } from "@/lib/push/vapid";
import { errorMessage } from "@/lib/errors";

export const PUSH_STATE_EVENT = "together:push-state";
// Stable across releases, scoped to this account and this installed browser.
const PREFERENCE_PREFIX = "together:notifications:";
type PushPreference = { enabled: boolean; endpoint?: string };
function readPreference(userId: string): PushPreference | null {
  try {
    const raw = localStorage.getItem(PREFERENCE_PREFIX + userId);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && "enabled" in value && typeof value.enabled === "boolean") {
      return { enabled: value.enabled, endpoint: "endpoint" in value && typeof value.endpoint === "string" ? value.endpoint : undefined };
    }
  } catch {}
  return null;
}
function writePreference(userId: string, value: PushPreference) {
  try { localStorage.setItem(PREFERENCE_PREFIX + userId, JSON.stringify(value)); }
  catch { throw new Error("Could not save your notification choice on this device. Allow site storage, then try again."); }
  announceState();
}
function announceState() { window.dispatchEvent(new Event(PUSH_STATE_EVENT)); }

// Recovery, settings and sign-out must not mutate a subscription concurrently.
let operation: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = operation.then(work, work);
  operation = next.catch(() => undefined);
  return next;
}
function supported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
function urlBase64ToUint8Array(value: string) {
  const normalized = normalizeVapidBase64Url(value);
  if (!normalized) throw new Error("The VAPID public key is empty.");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const raw = window.atob((normalized + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function hasMatchingKey(subscription: PushSubscription, key: string) {
  const existing = subscription.options.applicationServerKey;
  const expected = urlBase64ToUint8Array(key);
  return Boolean(existing && new Uint8Array(existing).length === expected.length && new Uint8Array(existing).every((value, index) => value === expected[index]));
}
async function account() {
  const supabase = getSupabaseBrowser();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in again before changing notifications.");
  return { supabase, user: data.user };
}
async function activeRegistration() {
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration?.active) return registration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The app is still updating. Your choice is saved; try Restore notifications shortly.")), 10000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
export type PushState = {
  supported: boolean;
  configured: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  standalone: boolean;
  requested: boolean;
  needsRepair: boolean;
  verificationFailed: boolean;
};
export async function getPushState(expectedUserId?: string): Promise<PushState> {
  const state: PushState = { supported: supported(), configured: Boolean(normalizeVapidBase64Url(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)), permission: supported() ? Notification.permission : "unsupported", subscribed: false, standalone: isStandalone(), requested: false, needsRepair: false, verificationFailed: false };
  if (expectedUserId) state.requested = readPreference(expectedUserId)?.enabled === true;
  if (!state.supported) return state;
  try {
    const { supabase, user } = await account();
    if (expectedUserId && user.id !== expectedUserId) return { ...state, requested: false, verificationFailed: true };
    const preference = readPreference(user.id);
    state.requested = preference?.enabled === true;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        const { data, error } = await supabase.from("push_subscriptions").select("endpoint").eq("endpoint", subscription.endpoint).eq("user_id", user.id).maybeSingle();
        if (error) throw error;
        state.subscribed = Boolean(data) && hasMatchingKey(subscription, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "");
        // Migrate working subscriptions from older releases, never another account.
        if (!preference && state.subscribed && state.permission === "granted") {
          writePreference(user.id, { enabled: true, endpoint: subscription.endpoint });
          state.requested = true;
        }
      }
    } catch { state.verificationFailed = true; }
  } catch { state.verificationFailed = true; }
  state.needsRepair = state.requested && !state.verificationFailed && (!state.subscribed || state.permission !== "granted");
  return state;
}
async function saveSubscription(subscription: PushSubscription, userId: string, supabase: NonNullable<ReturnType<typeof getSupabaseBrowser>>) {
  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys.auth) throw new Error("The browser returned an incomplete push subscription.");
  const { error } = await supabase.from("push_subscriptions").upsert({ endpoint: subscription.endpoint, user_id: userId, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent }, { onConflict: "endpoint" });
  // A temporary network/database failure must not destroy a working subscription.
  if (error) throw error;
}
export async function enablePush() {
  if (!supported()) throw new Error("Push notifications are not supported in this browser.");
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !isStandalone()) throw new Error("On iPhone, install Together to the Home Screen first, then open the installed app and enable notifications.");
  const publicKey = normalizeVapidBase64Url(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  if (!publicKey) throw new Error("Notifications need one-time setup. Configure VAPID keys, then redeploy.");
  // Start permission request directly in the user's tap, never during recovery.
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Notifications are blocked in your device/browser settings." : "Notification permission was not granted.");
  return serialize(async () => {
    const { supabase, user } = await account();
    const previous = readPreference(user.id);
    writePreference(user.id, { ...previous, enabled: true });
    const registration = await activeRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const { data, error } = await supabase.from("push_subscriptions").select("endpoint").eq("endpoint", subscription.endpoint).eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      const knownOwner = Boolean(data) || previous?.endpoint === subscription.endpoint;
      if (!knownOwner || !hasMatchingKey(subscription, publicKey)) {
        if (!await subscription.unsubscribe()) throw new Error("Could not reset notifications. Try again.");
        subscription = null;
      }
    }
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    // Record ownership before uploading so an interrupted upload can be retried safely.
    writePreference(user.id, { enabled: true, endpoint: subscription.endpoint });
    try { await saveSubscription(subscription, user.id, supabase); }
    finally { announceState(); }
    return true;
  });
}
export async function recoverPush(expectedUserId: string) {
  if (!supported() || Notification.permission !== "granted") { announceState(); return; }
  return serialize(async () => {
    const { supabase, user } = await account();
    if (user.id !== expectedUserId) return;
    const preference = readPreference(user.id);
    if (preference?.enabled === false) return;
    const key = normalizeVapidBase64Url(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
    if (!key) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    // WebKit may require a tap to create a new subscription. Never prompt on launch.
    if (!subscription || !hasMatchingKey(subscription, key)) { announceState(); return; }
    const { data, error } = await supabase.from("push_subscriptions").select("endpoint").eq("endpoint", subscription.endpoint).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!data && (!preference?.enabled || preference.endpoint !== subscription.endpoint)) return;
    writePreference(user.id, { enabled: true, endpoint: subscription.endpoint });
    try { await saveSubscription(subscription, user.id, supabase); }
    finally { announceState(); }
  });
}
export async function disablePush() {
  return serialize(async () => {
    const { supabase, user } = await account();
    if ("serviceWorker" in navigator && "PushManager" in window) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        // Unsubscribe locally first: a failed server cleanup cannot leave alerts active.
        if (!await subscription.unsubscribe()) throw new Error("Could not disable notifications on this device. Try again.");
        const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", user.id);
        if (error) console.warn("Subscription row cleanup failed", error.message);
      }
    }
    writePreference(user.id, { enabled: false });
    return true;
  });
}
export async function signOutSafely() {
  await disablePush();
  const { error } = await getSupabaseBrowser()!.auth.signOut();
  if (error) throw error;
  sessionStorage.removeItem("together_unlocked");
}

export async function sendTestPush() {
  const supabase = getSupabaseBrowser();
  if (!supabase) throw new Error("Supabase is not configured.");
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) throw new Error("Sign in again before testing notifications.");

  let response: Response;
  try {
    response = await fetch(`/api/push/test?ts=${Date.now()}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (error: unknown) {
    throw new Error(`The test request did not reach the server: ${errorMessage(error, "network request failed")}`);
  }

  const raw = await response.text();
  let result: { delivered?: number; failed?: number; subscriptions?: number; errors?: string[]; error?: string } = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { result = {}; }

  if (!response.ok) {
    const fallback = raw ? raw.slice(0, 220).replace(/\s+/g, " ") : "empty response";
    throw new Error(result?.error || `Push test HTTP ${response.status}: ${fallback}`);
  }
  if (!result?.delivered) {
    const details = Array.isArray(result?.errors) && result.errors.length ? ` ${result.errors[0]}` : "";
    throw new Error(`Push reached the server but was not delivered.${details}`);
  }
  return result as { subscriptions: number; delivered: number; failed: number; errors?: string[] };
}
