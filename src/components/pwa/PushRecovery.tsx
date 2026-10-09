"use client";

import { useEffect } from "react";
import { useTogether } from "@/components/providers/TogetherProvider";
import { recoverPush } from "@/lib/push/client";

/** Repair the existing subscription on reopen/update without requesting permission. */
export function PushRecovery() {
  const { profile } = useTogether();
  useEffect(() => {
    const userId = profile.myUserId;
    if (!userId || !("serviceWorker" in navigator)) return;
    let cancelled = false, running = false, lastAttempt = 0, retries = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function run(force = false) {
      if (cancelled || running || !navigator.onLine || document.visibilityState !== "visible") return;
      if (!force && Date.now() - lastAttempt < 30000) return;
      if (retry) { clearTimeout(retry); retry = undefined; }
      running = true; lastAttempt = Date.now();
      try { await recoverPush(userId!); retries = 0; }
      catch {
        // Preserve the saved choice through temporary authentication/network errors.
        if (!cancelled && retries++ < 2) retry = setTimeout(() => void run(true), 15000);
      } finally { running = false; }
    }
    const resume = () => void run();
    const reconnect = () => void run(true);
    void navigator.serviceWorker.ready.then(() => run(true)).catch(() => undefined);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", resume);
    navigator.serviceWorker.addEventListener("controllerchange", reconnect);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", resume);
      navigator.serviceWorker.removeEventListener("controllerchange", reconnect);
    };
  }, [profile.myUserId]);
  return null;
}
