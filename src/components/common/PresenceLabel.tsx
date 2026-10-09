"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useEffect,useState } from "react";
import { lastSeenLabel } from "@/lib/together/presence";
export function PresenceLabel({ online,lastSeen,error }: { online:boolean;lastSeen?:string;error?:string }) {
  const { t: uiText, locale } = useLanguage();

  const [now,setNow]=useState(()=>new Date());useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),60000);return ()=>clearInterval(timer);},[]);
  return <span className={`presence-label ${online?"is-online":""}`} title={error||(lastSeen?new Date(lastSeen).toLocaleString(locale):undefined)}>{online?<><i aria-hidden="true"/>{uiText("Online now")}</>:lastSeen?<time dateTime={lastSeen}>{lastSeenLabel(lastSeen,now,locale)}</time>:<span>{error?.includes("012")?uiText("Last seen needs update 012"):error?uiText("Last seen temporarily unavailable"):uiText("Last seen not recorded yet")}</span>}</span>;
}
