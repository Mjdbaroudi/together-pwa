import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/supabase/client";

export const PUSH_READING_HEARTBEAT_MS = 7000;

export function startPushReading(supabase: SupabaseClient, userId: string, status: (error?: string) => void = () => undefined) {
  const clientId = crypto.randomUUID();
  let sequence = 0, reading = false, stopped = false, suspended = false;
  let cached: { endpoint: string; token: string } | undefined;
  // Chat's mounted lifetime includes its gallery/search dialogs. The privacy lock unmounts it.
  const visible = () => !suspended && document.visibilityState === "visible" && document.hasFocus();

  function input(active: boolean, number: number) { return { p_endpoint: cached!.endpoint, p_client: clientId, p_reading: active, p_sequence: number }; }
  function release() {
    const number = ++sequence, config = getPublicSupabaseConfig();
    if (!cached || !config) return;
    // Capture cached identity now: a frozen page cannot await token/subscription discovery.
    void fetch(`${config.url}/rest/v1/rpc/touch_push_chat`, { method: "POST", headers: { apikey: config.key, Authorization: `Bearer ${cached.token}`, "Content-Type": "application/json" }, body: JSON.stringify(input(false, number)), keepalive: true }).catch(() => undefined);
  }
  async function publish() {
    if (stopped || !reading || !visible() || !navigator.onLine) return;
    const number = ++sequence;
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (stopped || !reading || number !== sequence || session?.user.id !== userId) return;
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (stopped || !reading || number !== sequence || !visible()) return;
      if (!subscription) { if (cached) release(); cached = undefined; status(); return; }
      if (cached && cached.endpoint !== subscription.endpoint) release();
      cached = { endpoint: subscription.endpoint, token: session.access_token };
      const current = ++sequence;
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const { error } = await supabase.rpc("touch_push_chat", input(true, current)).abortSignal(controller.signal);
        if (stopped || current !== sequence) return;
        if (error) throw error;
        status();
      } finally { clearTimeout(timeout); }
    } catch (error) {
      if (stopped) return;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (["PGRST202", "42883", "42P01"].includes(code)) status("Apply database update 016, then reopen Together to stop message notifications while reading chat.");
      // Connection failure expires the short server lease; never silence background alerts indefinitely.
    }
  }
  const retry = () => { if (!stopped && reading) void publish(); };
  const hide = () => { if (document.visibilityState === "hidden") release(); else retry(); };
  const pagehide = () => { suspended = true; release(); };
  const pageshow = () => { suspended = false; retry(); };
  const blur = () => release();
  const timer = setInterval(retry, PUSH_READING_HEARTBEAT_MS);
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", pageshow);
  window.addEventListener("blur", blur);
  window.addEventListener("focus", retry);
  window.addEventListener("online", retry);
  window.addEventListener("together:push-state", retry);
  navigator.serviceWorker.addEventListener("controllerchange", retry);
  return {
    setReading(active: boolean) { if (stopped || active === reading) return; reading = active; if (active) void publish(); else release(); },
    stop() { if (stopped) return; stopped = true; reading = false; release(); clearInterval(timer); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", pagehide); window.removeEventListener("pageshow", pageshow); window.removeEventListener("blur", blur); window.removeEventListener("focus", retry); window.removeEventListener("online", retry); window.removeEventListener("together:push-state", retry); navigator.serviceWorker.removeEventListener("controllerchange", retry); },
  };
}
