"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import { useSignedMedia } from "@/hooks/useSignedMedia";

export function ProfilePhotoViewer({ name, src, path, onClose }: { name: string; src?: string; path?: string; onClose: () => void }) {
  const { t: uiText } = useLanguage();

  const { url, error, retry } = useSignedMedia(src, path);
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => { setZoomed(false); setLoaded(false); setFailure(""); }, [url]);
  useEffect(() => { if (!src && path) void retry().catch(() => setFailure("This photo is unavailable. Try reopening it.")); }, [src, path, retry]);
  if (typeof document === "undefined") return null;
  const unavailable = error || failure || (!src && !path ? "No profile photo yet." : "");
  return createPortal(<div className="profile-photo-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="profile-photo-viewer" role="dialog" aria-modal="true" aria-label={uiText("{0} profile photo", [name])}>
      <header><div><span>{uiText("PROFILE PHOTO")}</span><h2 dir="auto">{name}</h2></div><div className="profile-viewer-actions"><button aria-label={zoomed ? uiText("Zoom out") : uiText("Zoom in")} aria-pressed={zoomed} disabled={!loaded || Boolean(unavailable)} onClick={() => setZoomed(value => !value)}>{zoomed ? <ZoomOut size={22}/> : <ZoomIn size={22}/>}</button><button aria-label={uiText("Close")} onClick={onClose}><X size={23}/></button></div></header>
      <div className={`profile-photo-stage ${zoomed ? "zoomed" : ""}`}>
        {!loaded && !unavailable && <p role="status">{uiText("Loading photo…")}</p>}
        {unavailable ? <div className="profile-photo-error" role="alert"><p>{unavailable}</p><button className="soft-btn secondary" onClick={onClose}>{uiText("Close photo")}</button></div> : url && <img key={url} src={url} alt={uiText("{0} full profile photo", [name])} onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); void retry().catch(() => setFailure("This photo is unavailable. Try reopening it.")); }}/>} 
      </div>
    </section>
  </div>, document.body);
}
