"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { Video, ArrowDownLeft, ArrowUpRight, Phone, PhoneMissed, RefreshCw } from "lucide-react";
import { useVoiceCalls } from "@/components/calls/VoiceCallsProvider";
import { useTogether } from "@/components/providers/TogetherProvider";
import { CallDetailsDialog } from "@/components/calls/CallDetailsDialog";
import { PageHeading } from "@/components/common/PageHeading";
import { partnerLabel } from "@/lib/together/contactPreferences";
import { callLabel, callRecordedDuration, type CallHistoryItem, type CallHistoryQuery } from "@/lib/calls/journal";
import { isLiveCall } from "@/lib/calls/types";
import { dayKey, dayLabel } from "@/lib/date";

export default function CallsPage() {
  const { t: uiText, locale } = useLanguage();

  const calls = useVoiceCalls(), { profile, messages } = useTogether();
  const [rows, setRows] = useState<CallHistoryItem[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [filter, setFilter] = useState<NonNullable<CallHistoryQuery["filter"]>>("all"), [more, setMore] = useState(false), [details, setDetails] = useState<string | null>(null);
  const identity = `${profile.myUserId}:${profile.coupleId}`;
  const [owner, setOwner] = useState(identity);
  const ownedRows = owner === identity ? rows : [];
  const request = useRef(0), history = useRef(calls.history), currentRows = useRef(rows), loadRef = useRef<(append?: boolean, quiet?: boolean) => Promise<void>>(async () => {});
  history.current = calls.history; currentRows.current = ownedRows;
  const revision = messages.filter(message => message.type === "call").map(message => `${message.id}:${message.callSummary?.state}`).join("|");
  useEffect(() => {
    let alive = true;
    setOwner(identity); currentRows.current = []; setRows([]); setDetails(null); setMore(false);
    async function load(append = false, quiet = false) {
      const ticket = ++request.current, previous = currentRows.current, last = append ? previous.at(-1) : undefined;
      if (!quiet) setLoading(true); setError("");
      try {
        let result = await history.current({ filter, before: last ? { createdAt: last.createdAt, id: last.messageId } : undefined });
        if (!alive || ticket !== request.current) return;
        const page = result.slice(0, 30);
        let hasMore = result.length > 30;
        // Refresh all pages already visible, including hides made on another device.
        if (!append) {
          while (hasMore && page.length < previous.length) {
            const cursor = page.at(-1)!;
            result = await history.current({ filter, before: { createdAt: cursor.createdAt, id: cursor.messageId } });
            if (!alive || ticket !== request.current) return;
            const older = result.slice(0, 30).filter(item => !page.some(row => row.messageId === item.messageId));
            if (!older.length && result.length > 30) throw new Error("Could not load earlier calls. Please retry.");
            page.push(...older); hasMore = result.length > 30;
          }
        }
        setRows(old => append ? [...old, ...page.filter(item => !old.some(row => row.messageId === item.messageId))] : page);
        setMore(hasMore);
      } catch (error: unknown) { if (alive && ticket === request.current) setError(error instanceof Error ? error.message : "Could not load calls."); }
      finally { if (alive && ticket === request.current) setLoading(false); }
    }
    loadRef.current = load; void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(false, true); };
    const poll = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; ++request.current; window.clearInterval(poll); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [filter, profile.myUserId, profile.coupleId]);
  useEffect(() => { void loadRef.current(false, true); }, [revision, calls.view.call?.state]);
  const selected = ownedRows.find(item => item.messageId === details), busy = calls.view.phase === "preparing" || isLiveCall(calls.view.call);
  return <div className="calls-history"><PageHeading eyebrow={uiText("A LITTLE CLOSER")} title={uiText("Your calls.")} description={uiText("Every hello, right here.")} action={<button className="round-btn" aria-label={uiText("Refresh calls")} disabled={loading} onClick={() => void loadRef.current()}><RefreshCw size={20}/></button>}/>
    <button className="calls-start" disabled={busy} onClick={() => calls.start()}><Phone size={23}/><span>{uiText("Call ")}<b dir="auto">{partnerLabel(profile)}</b></span></button><button className="calls-start video" disabled={busy} onClick={() => calls.start("video")}><Video size={23}/><span>{uiText("Video call ")}<b dir="auto">{partnerLabel(profile)}</b></span></button><Link className="text-button" href="/chat">{uiText("Back to your conversation")}</Link>
    <div className="call-history-filters" role="group" aria-label={uiText("Filter calls")}>{(["all", "missed", "incoming", "outgoing"] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{uiText(value[0].toUpperCase() + value.slice(1))}</button>)}</div>
    {error && <p className="notice error" role="alert">{uiText(error)}<button className="text-button" onClick={() => void loadRef.current()}>{uiText("Retry")}</button></p>}
    {(loading || owner !== identity) && !ownedRows.length ? <p role="status">{uiText("Loading your calls…")}</p> : !ownedRows.length && !error ? <div className="experience-empty"><Phone size={34}/><h2>{filter === "all" ? uiText("Your first call starts here.") : uiText("No calls here yet.")}</h2><p>{filter === "missed" ? uiText("Missed incoming calls will appear here.") : uiText("Say hello, share your day, or stay a little longer.")}</p></div> : <ul className="voice-history-list call-journal-list">{ownedRows.map((item, index) => {
      const call = item.call, incoming = call.callee_id === profile.myUserId, missed = incoming && call.state === "missed", duration = callRecordedDuration(call);
      return <Fragment key={item.messageId}>{(!index || dayKey(ownedRows[index - 1].createdAt) !== dayKey(item.createdAt)) && <li className="call-history-day">{dayLabel(item.createdAt,new Date(),locale)}</li>}<li>
        <button className="call-history-row" onClick={() => setDetails(item.messageId)} aria-label={uiText("{0}. View call details", [uiText(callLabel(call, profile.myUserId))])}><span className={`voice-history-icon ${missed ? "missed" : ""}`} aria-hidden="true">{missed ? <PhoneMissed size={19}/> : incoming ? <ArrowDownLeft size={19}/> : <ArrowUpRight size={19}/>}</span><span className="call-history-row-copy"><strong dir="auto">{partnerLabel(profile)}</strong><span>{uiText(callLabel(call, profile.myUserId))}{duration ? ` · ${duration}` : ""}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time></span></button>
        <button className="round-btn" disabled={busy} aria-label={`${call.media_kind === "video" ? "Video call" : "Call"} ${partnerLabel(profile)}`} onClick={() => calls.start(call.media_kind || "audio")}>{call.media_kind === "video" ? <Video size={20}/> : <Phone size={20}/>}</button></li></Fragment>;
    })}</ul>}
    {more && <button className="soft-btn secondary call-history-more" disabled={loading} onClick={() => void loadRef.current(true)}>{loading ? uiText("Loading…") : uiText("Load earlier calls")}</button>}
    {selected && <CallDetailsDialog item={selected} onClose={() => setDetails(null)}/>}
  </div>;
}
