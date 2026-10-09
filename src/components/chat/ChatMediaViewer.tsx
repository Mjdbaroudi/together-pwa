"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { useSignedMedia } from "@/hooks/useSignedMedia";
import { useImageGestures } from "@/hooks/useImageGestures";
import { ChevronLeft, ChevronRight, Download, MessageSquareText, Share2, X, ZoomIn, ZoomOut } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import type { Message } from "@/lib/types";

type Props = {
  messages: Message[];
  activeId: string;
  partnerName?: string;
  onChange: (id: string) => void;
  onJump?: (id: string) => void;
  onClose: () => void;
};

export function ChatMediaViewer({ messages, activeId, partnerName = "Partner", onChange, onJump, onClose }: Props) {
  const { t: uiText, locale } = useLanguage();

  const media = useMemo(() => messages.filter(message => (message.type === "image"||message.type === "video") && message.mediaUrl && !message.deletedAt), [messages]);
  const index = Math.max(0, media.findIndex(message => message.id === activeId));
  const current = media[index];
  const signed=useSignedMedia(current?.mediaUrl,current?.mediaPath);
  const gestures=useImageGestures(current?.id,current?.type==="image",delta=>{const next=media[index+delta];if(next)onChange(next.id);});
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onChange(media[index - 1].id);
      if (event.key === "ArrowRight" && index < media.length - 1) onChange(media[index + 1].id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, media, onChange, onClose]);

  if (!current || typeof document === "undefined") return null;

  const go = (delta: number) => {
    const next = media[index + delta];
    if (next) onChange(next.id);
  };

  async function share() {
    if (!signed.url) return;
    try {
      if (navigator.share) await navigator.share({ title: "Together photo", text: current.body || undefined, url: signed.url });
      else window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch { /* cancelled */ }
  }

  async function download() {
    if (!signed.url || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(signed.url);
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `together-${new Date(current.createdAt).toISOString().slice(0, 10)}.${blob.type.startsWith("video/") ? "mp4" : blob.type.includes("png") ? "png" : "jpg"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  const author = current.sender === "me" ? "You" : partnerName;
  const timestamp = new Date(current.createdAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return createPortal(<div className="chat-media-viewer media-viewer-v32" role="dialog" aria-modal="true" aria-label={uiText("Shared media")}>
    <div className="chat-media-topbar">
      <button onClick={onClose} aria-label={uiText("Close")}><X size={21}/></button>
      <div className="media-viewer-count"><b>{index + 1}<span> / {media.length}</span></b><small>{current.type==="video"?uiText("VIDEO"):uiText("SHARED PHOTO")}</small></div>
      <div className="chat-media-actions">
        <button onClick={() => void share()} aria-label={uiText("Share")}><Share2 size={19}/></button>
        <button onClick={() => void download()} aria-label={uiText("Download")} disabled={downloading}><Download size={19}/></button>
      </div>
    </div>
    <div ref={gestures.stageRef} className={`chat-media-stage ${current.type==="image"?"photo-gesture-stage":"video-media-stage"}`}
      onPointerDown={gestures.onPointerDown} onPointerMove={gestures.onPointerMove} onPointerUp={gestures.onPointerUp}
      onPointerCancel={gestures.onPointerCancel} onLostPointerCapture={gestures.onLostPointerCapture}>
      {current.type === "video"?<video key={current.id} src={signed.url} onError={()=>void signed.retry()} controls playsInline preload="metadata"/>:
        signed.url&&<img ref={gestures.imageRef} key={current.id} className="media-viewer-photo" src={signed.url} onLoad={gestures.onLoad} onError={()=>void signed.retry()} alt={current.body || uiText("Shared photo")} draggable={false}/>}
      {index > 0 && <button className="media-viewer-nav prev" onClick={() => go(-1)} aria-label={uiText("Previous photo")}><ChevronLeft size={25}/></button>}
      {index < media.length - 1 && <button className="media-viewer-nav next" onClick={() => go(1)} aria-label={uiText("Next photo")}><ChevronRight size={25}/></button>}
    </div>
    {signed.error&&<p role="alert" className="media-viewer-error">{signed.error}</p>}
    {current.type==="image"&&<div className="media-zoom-controls" role="group" aria-label={uiText("Photo zoom")}>
      <button onClick={()=>gestures.zoomTo(gestures.scale-.5)} aria-label={uiText("Zoom out")} disabled={gestures.scale<=1}><ZoomOut size={19}/></button>
      <button className="media-zoom-reset" onClick={()=>gestures.zoomTo(1)} aria-label={uiText("Reset zoom")}><output ref={gestures.labelRef} aria-label={uiText("Zoom level")}>100%</output></button>
      <button onClick={()=>gestures.zoomTo(gestures.scale+.5)} aria-label={uiText("Zoom in")} disabled={gestures.scale>=5}><ZoomIn size={19}/></button>
      <span>{uiText("Pinch to zoom · drag to explore")}</span>
    </div>}
    <div className="media-viewer-footer">
      <div><strong>{author}</strong><span>{timestamp}</span>{current.body && <p dir="auto">{current.body}</p>}</div>
      {onJump && <button aria-label={uiText("View in chat")} onClick={() => { onClose(); onJump(current.id); }}><MessageSquareText size={16}/><span>{uiText("View in chat")}</span></button>}
    </div>
  </div>, document.body);
}
