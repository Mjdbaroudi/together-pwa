"use client";
import type { CallHistoryItem, CallHistoryQuery } from "@/lib/calls/journal";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTogether } from "@/components/providers/TogetherProvider";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { createCallTransport } from "@/lib/calls/transport";
import { VoiceCallEngine } from "@/lib/calls/engine";
import { emptyCallView, isLiveCall, type CallMediaKind, type VoiceView } from "@/lib/calls/types";
import { VoiceCallPanel } from "@/components/calls/VoiceCallPanel";

type CallsContext = {
  view: VoiceView; minimized: boolean; devices: MediaDeviceInfo[]; outputSupported: boolean;
  start: (kind?: CallMediaKind) => void; accept: (withVideo?: boolean) => void; end: () => void; mute: () => void; play: () => void;
  camera: () => void; switchCamera: () => void;
  continuePermission: () => void;
  minimize: () => void; expand: () => void; dismiss: () => void;
  microphone: (id: string) => Promise<void>; output: (id: string) => Promise<void>;
  history: (query?: CallHistoryQuery) => Promise<CallHistoryItem[]>;
};
const Context = createContext<CallsContext | null>(null);
const blank = emptyCallView();

export function VoiceCallsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const { profile } = useTogether();
  const audio = useRef<HTMLAudioElement>(null), engine = useRef<VoiceCallEngine | null>(null);
  const [view, setView] = useState<VoiceView>(blank), [minimized, setMinimized] = useState(false), [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [outputSupported, setOutputSupported] = useState(false);
  const refreshDevices = useCallback(async () => { try { setDevices((await navigator.mediaDevices?.enumerateDevices()) || []); } catch {} }, []);
  useEffect(() => {
    if (!enabled || !profile.myUserId || !profile.coupleId || !audio.current) { setView(blank); return; }
    let active = true;
    const instance = new VoiceCallEngine(createCallTransport(getSupabaseBrowser()!, profile.myUserId, profile.coupleId), audio.current, next => { if (active) setView(next); });
    engine.current = instance; setOutputSupported("setSinkId" in audio.current); instance.begin();
    const refresh = () => { if (document.visibilityState === "visible") { void instance.refresh(); void instance.prepareConnection().catch(() => undefined); } };
    const enableSound = () => instance.enableSound();
    const push = (event: MessageEvent) => { if (event.data?.type === "TOGETHER_CALL_PUSH") void instance.refresh(); };
    const leave = () => { const call = instance.view.call; if (call && isLiveCall(call) && instance.view.phase !== "incoming" && instance.view.phase !== "elsewhere") instance.transport.leave(call.id); };
    window.addEventListener("pointerdown", enableSound, { once: true }); window.addEventListener("keydown", enableSound, { once: true });
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); window.addEventListener("pagehide", leave); document.addEventListener("visibilitychange", refresh); navigator.serviceWorker?.addEventListener("message", push); navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => { active = false; instance.dispose(); engine.current = null; window.removeEventListener("pointerdown", enableSound); window.removeEventListener("keydown", enableSound); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", refresh); navigator.serviceWorker?.removeEventListener("message", push); navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices); };
  }, [enabled, profile.myUserId, profile.coupleId, refreshDevices]);

  useEffect(() => { if (["incoming", "ringing", "preparing", "permission", "finished"].includes(view.phase)) setMinimized(false); if (["connecting", "connected"].includes(view.phase)) void refreshDevices(); }, [view.phase, refreshDevices]);
  useEffect(() => {
    const visible = minimized && ["connected", "reconnecting", "elsewhere"].includes(view.phase);
    document.body.classList.toggle("voice-call-minimized", visible);
    return () => document.body.classList.remove("voice-call-minimized");
  }, [minimized, view.phase]);
  useEffect(() => {
    if (view.call && !isLiveCall(view.call)) { void navigator.serviceWorker?.ready.then(registration => (navigator.serviceWorker.controller || registration.active)?.postMessage({ type: "TOGETHER_CLOSE_CALL_NOTIFICATION", callId: view.call!.id })).catch(() => undefined); }
  }, [view.call]);
  useEffect(() => {
    if (view.phase !== "connected" || !("wakeLock" in navigator)) return;
    let released = false, lock: WakeLockSentinel | null = null;
    const keepAwake = async () => { if (document.visibilityState !== "visible" || released) return; try { lock = await navigator.wakeLock.request("screen"); if (released) await lock.release(); } catch {} };
    void keepAwake(); document.addEventListener("visibilitychange", keepAwake);
    return () => { released = true; void lock?.release().catch(() => undefined); document.removeEventListener("visibilitychange", keepAwake); };
  }, [view.phase]);
  const value: CallsContext = {
    view, minimized, devices, outputSupported,
    start: (kind = "audio") => { setMinimized(false); void engine.current?.start(kind); }, accept: (withVideo = true) => void engine.current?.accept(withVideo), end: () => void engine.current?.end(), mute: () => engine.current?.toggleMute(), play: () => void engine.current?.playAudio(),
    camera: () => void engine.current?.toggleCamera(), switchCamera: () => void engine.current?.switchCamera(),
    continuePermission: () => void engine.current?.continuePermission(),
    minimize: () => setMinimized(true), expand: () => setMinimized(false), dismiss: () => engine.current?.dismiss(),
    microphone: async id => { await engine.current?.changeMicrophone(id); }, output: async id => { await engine.current?.output(id); },
    history: async query => { if (engine.current) return engine.current.transport.history(query); const supabase = getSupabaseBrowser(); if (!enabled || !supabase || !profile.myUserId || !profile.coupleId) throw new Error("Unlock the app and sign in to see your calls."); return createCallTransport(supabase, profile.myUserId, profile.coupleId).history(query); },
  };
  return <Context.Provider value={value}>{children}<audio ref={audio} autoPlay hidden/><VoiceCallPanel/></Context.Provider>;
}
export function useVoiceCalls() { const context = useContext(Context); if (!context) throw new Error("VoiceCallsProvider is required."); return context; }
