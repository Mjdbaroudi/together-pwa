"use client";

import { useEffect } from "react";

export function useAppVisualViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    document.body.classList.add("app-mounted");

    const sync = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      root.style.setProperty("--app-vv-height", `${Math.round(height)}px`);
      root.style.setProperty("--app-vv-top", `${Math.round(top)}px`);
      window.dispatchEvent(new CustomEvent("together:viewport"));
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.matches(".composer textarea")) return;
      document.body.classList.add("keyboard-open");
      requestAnimationFrame(() => window.scrollTo(0, 0));
      setTimeout(sync, 40);
    };

    const onFocusOut = () => {
      setTimeout(() => {
        const activeComposer = document.activeElement instanceof HTMLTextAreaElement
          && document.activeElement.closest(".composer");
        if (!activeComposer) document.body.classList.remove("keyboard-open");
        sync();
      }, 40);
    };

    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.body.classList.remove("keyboard-open", "app-mounted");
    };
  }, []);
}
