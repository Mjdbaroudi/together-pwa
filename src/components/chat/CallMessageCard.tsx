"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useState } from "react";
import { Video, ArrowDownLeft, ArrowUpRight, ChevronRight, Phone, PhoneMissed } from "lucide-react";
import { useVoiceCalls } from "@/components/calls/VoiceCallsProvider";
import { useTogether } from "@/components/providers/TogetherProvider";
import { CallDetailsDialog } from "@/components/calls/CallDetailsDialog";
import { callLabel, callRecordedDuration } from "@/lib/calls/journal";
import { isLiveCall } from "@/lib/calls/types";
import type { Message } from "@/lib/types";

export function CallMessageCard({ message }: { message: Message }) {
  const { t: uiText, locale } = useLanguage();

  const { profile } = useTogether(), calls = useVoiceCalls(), [details, setDetails] = useState(false);
  const call = message.callSummary;
  if (!call) return <div className="call-message-unavailable" data-message-id={message.id}>{uiText("Voice call · Details unavailable")}</div>;
  const incoming = call.callee_id === profile.myUserId, missed = incoming && call.state === "missed", duration = callRecordedDuration(call), live = isLiveCall(call);
  return <div className={`call-message ${message.sender} ${missed ? "missed" : ""}`} id={`call-${message.id}`} data-message-id={message.id}>
    <button className="call-message-summary" onClick={() => setDetails(true)} aria-label={uiText("{0}. View call details", [uiText(callLabel(call, profile.myUserId))])}>
      <span className={`call-message-symbol ${live ? "live" : ""}`} aria-hidden="true">{missed ? <PhoneMissed size={23}/> : call.media_kind === "video" ? <Video size={23}/> : <Phone size={23}/>}</span>
      <span className="call-message-copy"><strong>{uiText(callLabel(call, profile.myUserId))}</strong><span>{incoming ? <ArrowDownLeft size={13}/> : <ArrowUpRight size={13}/>}<span>{duration || (live ? uiText("Tap for details") : uiText("Not connected"))}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time></span></span><ChevronRight size={16} aria-hidden="true"/>
    </button>
    {!live && <button className="call-message-redial" disabled={calls.view.phase === "preparing" || isLiveCall(calls.view.call)} onClick={() => calls.start(call.media_kind || "audio")}>{call.media_kind === "video" ? <Video size={14}/> : <Phone size={14}/>}{incoming ? uiText("Call back") : uiText("Call again")}</button>}
    {details && <CallDetailsDialog item={{ messageId: message.id, createdAt: message.createdAt, call }} inChat onClose={() => setDetails(false)}/>}
  </div>;
}
