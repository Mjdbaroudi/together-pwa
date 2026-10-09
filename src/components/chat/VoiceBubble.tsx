"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { useSignedMedia } from "@/hooks/useSignedMedia";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

function fmt(value: number) {
  const safe = Math.max(0, Math.round(value || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

const fallbackBars = [8,16,11,24,18,12,22,14,27,18,10,21,12,17,25,15,20,9,14,22,16,25,13,19,10,17,23,12];
const waveformCache = new Map<string, number[]>();

async function decodeWaveform(src: string, bars = 28) {
  const cached = waveformCache.get(src);
  if (cached) return cached;
  if (typeof AudioContext === "undefined") return fallbackBars;
  const response = await fetch(src, { cache: "force-cache" });
  if (!response.ok) throw new Error("Could not load voice waveform");
  const buffer = await response.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const channel = decoded.getChannelData(0);
    if (!channel.length) return fallbackBars;
    const block = Math.max(1, Math.floor(channel.length / bars));
    const amplitudes = Array.from({ length: bars }, (_, index) => {
      const start = index * block;
      const end = Math.min(channel.length, start + block);
      let peak = 0;
      for (let i = start; i < end; i += Math.max(1, Math.floor(block / 180))) peak = Math.max(peak, Math.abs(channel[i] || 0));
      return peak;
    });
    const max = Math.max(...amplitudes, 0.001);
    const normalized = amplitudes.map(value => Math.round(7 + (value / max) * 21));
    if(waveformCache.size>100)waveformCache.clear();
    waveformCache.set(src, normalized);
    return normalized;
  } finally {
    void context.close().catch(() => undefined);
  }
}

export function VoiceBubble({src:initialSrc,path,duration=18}:{src?:string;path?:string;duration?:number}) {
  const { t: uiText } = useLanguage();

  const media=useSignedMedia(initialSrc,path),src=media.url;
  const [playError,setPlayError]=useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef(`voice-${Math.random().toString(36).slice(2)}`);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [knownDuration, setKnownDuration] = useState(duration);
  const [rate, setRate] = useState(1);
  const [waveform, setWaveform] = useState<number[]>(fallbackBars);

  useEffect(() => {
    const pauseForOther = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail;
      if (detail?.source === instanceRef.current) return;
      if (audio.current && !audio.current.paused) {
        audio.current.pause();
        setPlaying(false);
      }
    };
    window.addEventListener("together:voice-play", pauseForOther);
    return () => {
      window.removeEventListener("together:voice-play", pauseForOther);
      audio.current?.pause();
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    if (!src || !rootRef.current) return;
    let cancelled = false;
    const load = () => { void decodeWaveform(src).then(next => { if (!cancelled) setWaveform(next); }).catch(() => undefined); };
    if (typeof IntersectionObserver === "undefined") { load(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    }, { rootMargin: "180px" });
    observer.observe(rootRef.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [src]);

  useEffect(()=>{audio.current?.pause();audio.current=null;setPlaying(false);setCurrent(0);setPlayError("");},[src]);

  function ensureAudio() {
    if (!src) return null;
    if (!audio.current) {
      const el = new Audio(src);
      audio.current = el;
      el.preload = "metadata";
      el.onended = () => { setPlaying(false); setCurrent(0); };
      el.ontimeupdate = () => setCurrent(el.currentTime || 0);
      el.onloadedmetadata = () => { if (Number.isFinite(el.duration)) setKnownDuration(el.duration); };
      el.playbackRate = rate;
    }
    return audio.current;
  }

  async function toggle() {
    const el = ensureAudio();
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else {
      window.dispatchEvent(new CustomEvent("together:voice-play", { detail: { source: instanceRef.current } }));
      try{await el.play();setPlaying(true);setPlayError("");}
      catch{setPlaying(false);setPlayError("Could not play this voice note. Try again.");void media.retry();}
    }
  }

  function seek(event: ReactPointerEvent<HTMLDivElement>) {
    const el = ensureAudio();
    const target = waveRef.current;
    if (!el || !target || !knownDuration) return;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    el.currentTime = ratio * knownDuration;
    setCurrent(el.currentTime);
  }

  function cycleRate(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  }

  const progress = knownDuration > 0 ? Math.min(1, current / knownDuration) : 0;
  const bars = useMemo(() => waveform.length ? waveform : fallbackBars, [waveform]);

  return <div className="voice voice-pro" ref={rootRef}>
    <button className="voice-play" onClick={toggle} aria-label={playing ? uiText("Pause") : uiText("Play")}>{playing ? <Pause size={16}/> : <Play size={16} fill="currentColor"/>}</button>
    <div className="wave wave-pro" ref={waveRef} onPointerDown={seek} aria-label={uiText("Voice note progress")}>
      {bars.map((height, index) => <i key={index} className={(index / bars.length) <= progress ? "played" : ""} style={{ height }}/>) }
    </div>
    {(playError||media.error)&&<span className="hint" role="alert">{playError||media.error}</span>}
    <div className="voice-tail"><span className="voice-time">{fmt(playing ? current : knownDuration)}</span><button className="voice-speed" onClick={cycleRate}>{rate}×</button></div>
  </div>;
}
