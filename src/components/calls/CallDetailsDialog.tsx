"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import Link from "next/link";
import { Overlay } from "@/components/common/Overlay";
import { Video, Phone, X } from "lucide-react";
import { useTogether } from "@/components/providers/TogetherProvider";
import { useVoiceCalls } from "@/components/calls/VoiceCallsProvider";
import { partnerLabel } from "@/lib/together/contactPreferences";
import { callLabel, callRecordedDuration, type CallHistoryItem } from "@/lib/calls/journal";
import { isLiveCall } from "@/lib/calls/types";

export function CallDetailsDialog({ item, onClose, inChat = false }: { item: CallHistoryItem; onClose: () => void; inChat?: boolean }) {
  const { t: uiText, locale } = useLanguage();

  const { profile } = useTogether(), calls = useVoiceCalls();
  const call = item.call, duration = callRecordedDuration(call);
  const stamp = (value: string) => new Date(value).toLocaleString(locale, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (typeof document === "undefined") return null;
  return <Overlay onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal call-details-dialog" role="dialog" aria-modal="true" aria-label={uiText("Call details")}>
    <button className="dialog-close" aria-label={uiText("Close")} title={uiText("Close call details")} onClick={onClose}><X size={21}/></button>
    <span className="call-detail-emblem">{call.media_kind === "video" ? <Video size={28}/> : <Phone size={28}/>}</span><span className="eyebrow">{call.media_kind === "video" ? uiText("VIDEO CALL") : uiText("VOICE CALL")}</span><h2 dir="auto">{partnerLabel(profile)}</h2><p className="call-detail-outcome">{uiText(callLabel(call, profile.myUserId))}</p>
    <dl className="call-detail-facts"><div><dt>{uiText("Direction")}</dt><dd>{call.callee_id === profile.myUserId ? uiText("Incoming") : uiText("Outgoing")}</dd></div><div><dt>{uiText("Started")}</dt><dd><time dateTime={call.created_at}>{stamp(call.created_at)}</time></dd></div>{call.started_at && <div><dt>{uiText("Connected")}</dt><dd><time dateTime={call.started_at}>{stamp(call.started_at)}</time></dd></div>}{call.ended_at && <div><dt>{uiText("Ended")}</dt><dd><time dateTime={call.ended_at}>{stamp(call.ended_at)}</time></dd></div>}<div><dt>{uiText("Duration")}</dt><dd>{duration || (call.state === "active" ? uiText("In progress") : uiText("Not connected"))}</dd></div></dl>
    <button className="soft-btn call-detail-redial" disabled={calls.view.phase === "preparing" || isLiveCall(calls.view.call)} onClick={() => { onClose(); calls.start(call.media_kind || "audio"); }}>{call.media_kind === "video" ? <Video size={17}/> : <Phone size={17}/>}{uiText("Call again")}</button>
    <Link className="text-button" href={inChat ? "/calls" : `/chat#call-${item.messageId}`} onClick={onClose}>{inChat ? uiText("View call history") : uiText("View in conversation")}</Link>
  </section></Overlay>;
}
