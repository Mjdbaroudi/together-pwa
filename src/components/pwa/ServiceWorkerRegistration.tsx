"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const STATE_MESSAGE = "TOGETHER_CLIENT_STATE";

function postClientState(worker?: ServiceWorker | null, pathname = window.location.pathname) {
  worker?.postMessage({
    type: STATE_MESSAGE,
    pathname,
    visible: document.visibilityState === "visible" && !document.querySelector('[aria-modal="true"]'),
    callVisible: document.visibilityState === "visible" && Boolean(document.querySelector('.voice-call-panel,.voice-call-mini,.video-call-fullscreen')),
    focused: typeof document.hasFocus === "function" ? document.hasFocus() : true,
    ts: Date.now(),
  });
}

export function ServiceWorkerRegistration() {
  const pathname = usePathname();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;

    let cancelled = false;
    let timer: number | undefined;

    async function publishState() {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (cancelled) return;
        postClientState(navigator.serviceWorker.controller || registration.active, pathname);
      } catch {
        // The app remains usable even if service-worker state sync is unavailable.
      }
    }

    async function boot() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await registration.update().catch(() => undefined);
        if (!cancelled) postClientState(navigator.serviceWorker.controller || registration.active, pathname);
      } catch {
        // PWA install/push is optional; core chat should continue to work.
      }
    }

    const onStateChange = () => { void publishState(); };
    const dialogs=new MutationObserver(onStateChange);
    dialogs.observe(document.body,{childList:true,subtree:true});

    void boot();
    document.addEventListener("visibilitychange", onStateChange);
    window.addEventListener("focus", onStateChange);
    window.addEventListener("blur", onStateChange);
    window.addEventListener("pageshow", onStateChange);
    window.addEventListener("pagehide", onStateChange);
    navigator.serviceWorker.addEventListener("controllerchange", onStateChange);

    timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void publishState();
    }, 15_000);

    return () => {
      cancelled = true;
      dialogs.disconnect();
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onStateChange);
      window.removeEventListener("focus", onStateChange);
      window.removeEventListener("blur", onStateChange);
      window.removeEventListener("pageshow", onStateChange);
      window.removeEventListener("pagehide", onStateChange);
      navigator.serviceWorker.removeEventListener("controllerchange", onStateChange);
    };
  }, [pathname]);

  return null;
}
