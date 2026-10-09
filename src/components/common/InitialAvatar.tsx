"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { useEffect, useState } from "react";

export function InitialAvatar({ name, src, size = 54, className = "" }: { name?: string; src?: string; size?: number; className?: string }) {
  const { t: uiText } = useLanguage();

  const clean = (name || "?").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : clean.slice(0, 2)).toUpperCase();
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  return <div className={`initial-avatar ${className}`} style={{ width: size, height: size, fontSize: Math.max(13, Math.round(size * .3)) }} aria-label={clean}>
    {src && !failed ? <img src={src} alt={uiText("{0} profile", [clean])} onError={() => setFailed(true)}/> : (initials || "?")}
  </div>;
}
