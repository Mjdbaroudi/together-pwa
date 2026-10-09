"use client";

import { ExternalLink, Link2 } from "lucide-react";

const urlRegex = /(https?:\/\/[^\s]+)/gi;

function safeUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch { return null; }
}

export function RichMessageText({ text }: { text: string }) {
  const parts = text.split(urlRegex);
  const firstLink = parts.reduce<URL | null>((found, part) => found ?? safeUrl(part), null);
  return <>
    <span className="bubble-text rich-message-text" dir="auto">
      {parts.map((part, index) => {
        const url = safeUrl(part);
        if (!url) return <span key={index}>{part}</span>;
        return <a key={index} href={url.href} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>{part}</a>;
      })}
    </span>
    {firstLink && <a className="link-preview-card" href={firstLink.href} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
      <span className="link-preview-icon"><Link2 size={15}/></span>
      <span className="link-preview-copy"><b>{firstLink.hostname.replace(/^www\./, "")}</b><small>{firstLink.pathname === "/" ? firstLink.href : `${firstLink.origin}${firstLink.pathname}`}</small></span>
      <ExternalLink size={14}/>
    </a>}
  </>;
}
