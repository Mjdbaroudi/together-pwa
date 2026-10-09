"use client";
import { useEffect, useRef, useState } from "react";
import { useTogether } from "@/components/providers/TogetherProvider";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { startPushReading } from "@/lib/push/reading";

export function usePushReadingState(active: boolean) {
  const { profile } = useTogether();
  const [error, setError] = useState("");
  const service = useRef<ReturnType<typeof startPushReading> | undefined>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    setError("");
    if (!supabase || !profile.myUserId || !("serviceWorker" in navigator)) return;
    const current = startPushReading(supabase, profile.myUserId, text => setError(text || ""));
    service.current = current;
    current.setReading(activeRef.current);
    return () => { service.current = undefined; current.stop(); };
  }, [profile.myUserId, profile.coupleId]);
  useEffect(() => service.current?.setReading(active), [active]);
  return error;
}
