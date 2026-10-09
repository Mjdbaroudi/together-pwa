"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

// Video elements are always silent. Remote audio uses the persistent audio
// element in the provider, so a layout change cannot duplicate or stop sound.
export function CallVideo({ stream, label, mirror = false }: { stream: MediaStream | null; label: string; mirror?: boolean }) {
  const { t: uiText } = useLanguage();

  const ref = useRef<HTMLVideoElement>(null), [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current; if (!video) return;
    let active = true;
    video.srcObject = stream; video.muted = true;
    if (stream) void video.play().then(() => { if (active) setBlocked(false); }).catch(() => { if (active) setBlocked(true); });
    return () => { active = false; video.pause(); video.srcObject = null; };
  }, [stream]);
  return <><video ref={ref} autoPlay playsInline muted aria-label={label} className={mirror ? "mirrored" : ""}/>{blocked && <button className="video-play" onClick={() => { void ref.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); }}><Play size={18}/>{uiText("Play video")}</button>}</>;
}
