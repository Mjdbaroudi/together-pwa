"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/types";

type ScrollBehaviorMode = "auto" | "smooth";

const NEAR_BOTTOM_PX = 112;
const FOCUS_SETTLE_MS = 700;

/**
 * Owns chat scroll state without putting scrollTop in React state.
 *
 * Rules:
 * - opening/focusing the composer always reveals the latest message;
 * - viewport/composer/content resizes keep the bottom pinned only when the user
 *   was already at the bottom;
 * - reading older messages is never interrupted by incoming messages;
 * - programmatic scrolling is protected from being mistaken for user scrolling.
 */
export function useChatAutoScroll(messages: Message[]) {
  const listRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const stickyToBottomRef = useRef(true);
  const forceBottomUntilRef = useRef(0);
  const programmaticUntilRef = useRef(0);
  const settleTimersRef = useRef<number[]>([]);
  const viewportFrameRef = useRef<number | null>(null);
  const previousRef = useRef({ count: 0, lastId: "" });
  const initializedRef = useRef(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newBelowCount, setNewBelowCount] = useState(0);

  const clearSettleTimers = useCallback(() => {
    settleTimersRef.current.forEach(window.clearTimeout);
    settleTimersRef.current = [];
  }, []);

  const isForced = useCallback(() => Date.now() < forceBottomUntilRef.current, []);

  const setSticky = useCallback((value: boolean) => {
    stickyToBottomRef.current = value;
    setAwayFromBottom(!value);
    if (value) setNewBelowCount(0);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehaviorMode = "auto") => {
    if(document.documentElement.dataset.reduceMotion==="true"||window.matchMedia("(prefers-reduced-motion: reduce)").matches)behavior="auto";
    const list = listRef.current;
    if (!list) return;

    stickyToBottomRef.current = true;
    programmaticUntilRef.current = Date.now() + (behavior === "smooth" ? 650 : 180);
    setAwayFromBottom(false);
    setNewBelowCount(0);

    if (behavior === "smooth") {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    } else {
      // scrollTop is more reliable than scrollIntoView while the iOS keyboard
      // is changing the VisualViewport height.
      list.scrollTop = list.scrollHeight;
    }
  }, []);

  const settleToLatest = useCallback(() => {
    clearSettleTimers();
    scrollToLatest("auto");

    requestAnimationFrame(() => scrollToLatest("auto"));
    for (const delay of [70, 170, 340]) {
      const id = window.setTimeout(() => {
        if (stickyToBottomRef.current || isForced()) scrollToLatest("auto");
      }, delay);
      settleTimersRef.current.push(id);
    }
  }, [clearSettleTimers, isForced, scrollToLatest]);

  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    if (Date.now() < programmaticUntilRef.current || isForced()) {
      stickyToBottomRef.current = true;
      return;
    }

    const distance = Math.max(0, list.scrollHeight - list.scrollTop - list.clientHeight);
    setSticky(distance <= NEAR_BOTTOM_PX);
  }, [isForced, setSticky]);

  const onComposerFocus = useCallback(() => {
    forceBottomUntilRef.current = Date.now() + FOCUS_SETTLE_MS;
    stickyToBottomRef.current = true;
    setAwayFromBottom(false);
    setNewBelowCount(0);
    settleToLatest();
  }, [settleToLatest]);

  const onComposerBlur = useCallback(() => {
    // Do not change sticky state here. When the keyboard closes the list grows;
    // ResizeObserver will preserve the bottom only if the user was already there.
    forceBottomUntilRef.current = Math.min(forceBottomUntilRef.current, Date.now() + 80);
  }, []);

  useEffect(() => {
    const count = messages.length;
    const last = count ? messages[count - 1] : undefined;
    const lastId = last?.id || "";
    const previous = previousRef.current;

    if (!count) {
      previousRef.current = { count: 0, lastId: "" };
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      previousRef.current = { count, lastId };
      settleToLatest();
      return;
    }

    const appended = count > previous.count && lastId !== previous.lastId;
    const tailChanged = lastId !== previous.lastId;

    if (appended) {
      if (stickyToBottomRef.current || isForced() || last?.sender === "me") {
        settleToLatest();
      } else {
        setNewBelowCount(count => count + 1);
      }
    } else if (tailChanged && stickyToBottomRef.current) {
      // Covers optimistic temp-message replacement and deletion of the tail.
      scrollToLatest("auto");
    }

    previousRef.current = { count, lastId };
  }, [messages, isForced, scrollToLatest, settleToLatest]);

  useEffect(() => {
    const list = listRef.current;
    const stream = streamRef.current;
    if (!list || !stream || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (stickyToBottomRef.current || isForced()) scrollToLatest("auto");
    });
    observer.observe(list);
    observer.observe(stream);
    return () => observer.disconnect();
  }, [isForced, scrollToLatest]);

  useEffect(() => {
    const onViewport = () => {
      if (!stickyToBottomRef.current && !isForced()) return;
      if (viewportFrameRef.current !== null) cancelAnimationFrame(viewportFrameRef.current);
      viewportFrameRef.current = requestAnimationFrame(() => {
        viewportFrameRef.current = null;
        scrollToLatest("auto");
      });
    };

    window.addEventListener("together:viewport", onViewport);
    return () => {
      window.removeEventListener("together:viewport", onViewport);
      if (viewportFrameRef.current !== null) cancelAnimationFrame(viewportFrameRef.current);
      clearSettleTimers();
    };
  }, [clearSettleTimers, isForced, scrollToLatest]);

  return {
    listRef,
    streamRef,
    newBelow: newBelowCount > 0,
    newBelowCount,
    awayFromBottom,
    onScroll,
    onComposerFocus,
    onComposerBlur,
    scrollToLatest,
  };
}
