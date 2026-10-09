"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { InitialAvatar } from "@/components/common/InitialAvatar";
import { usePartnerTyping } from "@/components/providers/TogetherProvider";

/** A fixed-height live-status lane so typing never changes chat scroll height. */
export function TypingIndicator({ partnerName, partnerAvatarUrl }: { partnerName: string; partnerAvatarUrl?: string }) {
  const { t: uiText } = useLanguage();

  const typing = usePartnerTyping();

  return <div className="chat-live-status" aria-live="polite" aria-atomic="true">
    <div className={`typing-inline ${typing ? "is-visible" : ""}`} aria-hidden={!typing}>
      <InitialAvatar name={partnerName} src={partnerAvatarUrl} size={20}/>
      <div className="typing-inline-dots" aria-label={uiText("{0} is typing", [partnerName])}><i/><i/><i/></div>
      <span>{partnerName}{uiText(" is typing")}</span>
    </div>
  </div>;
}
