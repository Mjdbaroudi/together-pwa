"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import Link from "next/link";
import dynamic from "next/dynamic";
import { Video, Phone, ArrowDown, ArrowLeft, Heart, MoreHorizontal, Pin } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { PartnerContactDialog } from "@/components/common/PartnerContactDialog";
import { PresenceLabel } from "@/components/common/PresenceLabel";
import { ChatOptionsMenu } from "@/components/chat/ChatOptionsMenu";
import { partnerLabel as contactLabel } from "@/lib/together/contactPreferences";
import { useTogether } from "@/components/providers/TogetherProvider";
import { CallMessageCard } from "@/components/chat/CallMessageCard";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Composer } from "@/components/chat/Composer";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ChatToolsPanel } from "@/components/chat/ChatToolsPanel";
import { useChatAutoScroll } from "@/hooks/useChatAutoScroll";
import type { Message } from "@/lib/types";
import { useVoiceCalls } from "@/components/calls/VoiceCallsProvider";
import { useReadingActive } from "@/hooks/useReadingActive";
import { usePushReadingState } from "@/hooks/usePushReadingState";
import { dayKey, dayLabel } from "@/lib/date";

const GROUP_WINDOW_MS = 3 * 60 * 1000;
const NEW_MESSAGE_MOTION_WINDOW_MS = 30_000;
const ChatMediaViewer=dynamic(()=>import("@/components/chat/ChatMediaViewer").then(module=>module.ChatMediaViewer));
type ToolMode = "search" | "media" | "links" | "voice" | "saved";

function prefersReducedMotion() {
  return typeof window !== "undefined" && (document.documentElement.dataset.reduceMotion==="true"||window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function closeEnough(a?: Message, b?: Message) {
  if (!a || !b || a.type === "call" || b.type === "call" || a.sender !== b.sender || dayKey(a.createdAt) !== dayKey(b.createdAt)) return false;
  return Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) <= GROUP_WINDOW_MS;
}

export default function ChatPage() {
  const { t: uiText, locale } = useLanguage();

  const { profile, messages, hasOlderMessages, loadingOlderMessages, chatConnection, loadOlderMessages, setReplyDraft, reactToMessage, editMessage, deleteMessage, togglePin, toggleStar, searchChat, loadDate, loadSavedMessages, ensureMessageLoaded, retryMessage, markMessagesRead } = useTogether();
  const readingActive=useReadingActive();
  const pushReadingError=usePushReadingState(true);
  const calls = useVoiceCalls();
  const [optionsOpen,setOptionsOpen]=useState(false);
  const unreadCaptured = useRef(false);
  const revealedCall = useRef("");
  const historyLoadRef = useRef(false);
  const historySentinelRef = useRef<HTMLDivElement | null>(null);
  const previousScrollTopRef = useRef(Number.POSITIVE_INFINITY);
  const knownMotionIdsRef = useRef<Set<string>>(new Set());
  const motionReadyRef = useRef(false);
  const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode | null>(null);
  const [mediaViewerId, setMediaViewerId] = useState<string | null>(null);
  const [mediaGallery,setMediaGallery]=useState<Message[]|null>(null);
  const [pinnedCursor, setPinnedCursor] = useState(0);
  const [navigationError,setNavigationError]=useState("");
  const [partnerContactOpen, setPartnerContactOpen] = useState(false);
  const partnerLabel = contactLabel(profile);
  const pinned = useMemo(() => messages.filter(message => message.pinned && !message.deletedAt).slice(-6), [messages]);
  const activePinned = pinned.length ? pinned[pinnedCursor % pinned.length] : null;
  const {
    listRef,
    streamRef,
    newBelowCount,
    awayFromBottom,
    onScroll,
    onComposerFocus,
    onComposerBlur,
    scrollToLatest,
  } = useChatAutoScroll(messages);

  const loadEarlierPreservingScroll = useCallback(async () => {
    if (historyLoadRef.current || loadingOlderMessages || !hasOlderMessages) return;
    const list = listRef.current;
    const anchorId = messages[0]?.id;
    if (!list || !anchorId) return;

    const anchorBefore = list.querySelector<HTMLElement>(`[data-message-id="${anchorId}"]`);
    const listTopBefore = list.getBoundingClientRect().top;
    const anchorTopBefore = anchorBefore ? anchorBefore.getBoundingClientRect().top - listTopBefore : null;

    historyLoadRef.current = true;
    try {
      const added = await loadOlderMessages();
      if (!added || anchorTopBefore === null) {
        historyLoadRef.current = false;
        return;
      }

      requestAnimationFrame(() => {
        const current = listRef.current;
        if (current) {
          const anchorAfter = current.querySelector<HTMLElement>(`[data-message-id="${anchorId}"]`);
          if (anchorAfter) {
            const nextTop = anchorAfter.getBoundingClientRect().top - current.getBoundingClientRect().top;
            const delta = nextTop - anchorTopBefore;
            if (Math.abs(delta) > 0.5) current.scrollTop += delta;
            previousScrollTopRef.current = current.scrollTop;
          }
        }
        historyLoadRef.current = false;
      });
    } catch (error) {
      historyLoadRef.current = false;
      throw error;
    }
  }, [hasOlderMessages, listRef, loadOlderMessages, loadingOlderMessages, messages]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = historySentinelRef.current;
    if (!root || !sentinel || !hasOlderMessages) return;

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !loadingOlderMessages) {
        void loadEarlierPreservingScroll();
      }
    }, { root, rootMargin: "140px 0px 0px 0px", threshold: 0 });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlderMessages, listRef, loadEarlierPreservingScroll, loadingOlderMessages]);

  const handleScroll = useCallback(() => {
    onScroll();
    const list = listRef.current;
    if (!list) return;

    const currentTop = list.scrollTop;
    const scrollingUp = currentTop < previousScrollTopRef.current - 1;
    previousScrollTopRef.current = currentTop;

    // Start pagination only at the real top edge and only while the user is
    // moving upward. This avoids network/layout work during ordinary scrolling.
    if (scrollingUp && currentTop < 56 && hasOlderMessages && !loadingOlderMessages) {
      void loadEarlierPreservingScroll();
    }
  }, [hasOlderMessages, listRef, loadEarlierPreservingScroll, loadingOlderMessages, onScroll]);

  useEffect(() => {
    if (!messages.length) return;
    const known = knownMotionIdsRef.current;
    if (!motionReadyRef.current) {
      messages.forEach(message => known.add(message.id));
      motionReadyRef.current = true;
      return;
    }
    messages.forEach(message => known.add(message.id));
  }, [messages]);

  useEffect(() => {
    if (!unreadCaptured.current && messages.length) {
      const firstUnread = messages.find(message => message.sender === "partner" && !message.readByMe);
      if (firstUnread) setUnreadAnchorId(firstUnread.id);
      unreadCaptured.current = true;
    }
  }, [messages]);

  useEffect(()=>{
    const root=listRef.current;if(!root||!readingActive)return;
    const visible=new Set<string>();let timer:number|undefined;
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const id=(entry.target as HTMLElement).dataset.messageId;if(!id)continue;if(entry.isIntersecting&&entry.intersectionRatio>=0.5)visible.add(id);else visible.delete(id);}
      if(timer)window.clearTimeout(timer);
      timer=window.setTimeout(()=>{if(document.visibilityState==="visible"&&document.hasFocus()&&!document.querySelector('[aria-modal="true"]'))void markMessagesRead([...visible]).catch(()=>undefined);},400);
    },{root,threshold:[0,0.5,1]});
    root.querySelectorAll<HTMLElement>('[data-message-id]').forEach(element=>observer.observe(element));
    return ()=>{observer.disconnect();if(timer)window.clearTimeout(timer);};
  },[readingActive,messages,markMessagesRead,listRef]);

  function jumpToMessage(id: string) {
    setToolMode(null);
    void (async () => {
      await ensureMessageLoaded(id);
      let attempts = 0;
      const reveal = () => {
        const element = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
        if (!element && attempts < 7) {
          attempts += 1;
          window.setTimeout(reveal, 70);
          return;
        }
        if (!element) return;
        element.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
        element.classList.remove("message-highlight");
        requestAnimationFrame(() => element.classList.add("message-highlight"));
        window.setTimeout(() => element.classList.remove("message-highlight"), 1500);
      };
      window.setTimeout(reveal, 40);
    })().catch(()=>setNavigationError("Could not open that message. Please try again."));
  }

  useEffect(() => {
    const reveal = () => {
      const match = /^#call-([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.exec(window.location.hash);
      if (!match || revealedCall.current === match[1]) return;
      revealedCall.current = match[1]; jumpToMessage(match[1]);
    };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [ensureMessageLoaded]);

  async function jumpToDate(date: string) {
    const id = await loadDate(date);
    if (id) jumpToMessage(id);
    return Boolean(id);
  }

  function openMedia(id: string, gallery?: Message[]) {
    void ensureMessageLoaded(id).then(found => { if (found) {setMediaGallery(gallery||null);setMediaViewerId(id);} }).catch(()=>setNavigationError("Could not open this media. Please try again."));
  }

  return <>
    {partnerContactOpen && <PartnerContactDialog onClose={() => setPartnerContactOpen(false)}/>}
    {optionsOpen&&<ChatOptionsMenu onClose={()=>setOptionsOpen(false)} onTool={setToolMode} onPartner={()=>setPartnerContactOpen(true)}/>}
    <div className="chat-head chat-head-pro">
      <div className="contact-card contact-card-pro glass">
        <Link href="/home" className="chat-back" aria-label={uiText("Back to Home")}><ArrowLeft size={21}/></Link>
        <ProfileAvatar name={partnerLabel} src={profile.partnerAvatarUrl} path={profile.partnerAvatarPath} size={46}/>
        <div className="contact-copy">
          <h1 className="contact-name"><button className="contact-name-button" title={uiText("Partner details and name")} aria-haspopup="dialog" onClick={() => setPartnerContactOpen(true)}><span dir="auto">{partnerLabel}</span> <span className="contact-heart" aria-hidden="true">♥</span></button></h1>
          <div className="status"><PresenceLabel online={profile.partnerOnline} lastSeen={profile.lastSeen} error={profile.presenceError}/></div>
        </div>
        <div className="contact-actions chat-contact-actions">
          <button className="chat-head-action video-call-shortcut" onClick={() => calls.start("video")} aria-label={uiText("Video call")}><Video size={19}/></button>
          <button className="chat-head-action voice-call-shortcut" onClick={() => calls.start()} aria-label={uiText("Voice call")}><Phone size={19}/></button>
          <button className="chat-head-action saved-shortcut" onClick={() => setOptionsOpen(true)} aria-label={uiText("Chat tools and saved messages")} aria-haspopup="dialog"><MoreHorizontal size={22}/></button>
        </div>
      </div>
      {chatConnection !== "connected" && <div className={`chat-connection-state ${chatConnection}`}><span/>{chatConnection === "offline" ? uiText("Offline — messages will send when you reconnect") : uiText("Reconnecting…")}</div>}
      {activePinned && <button className="chat-pinned-strip" onClick={() => { jumpToMessage(activePinned.id); if (pinned.length > 1) setPinnedCursor(value => (value + 1) % pinned.length); }}><Pin size={12} fill="currentColor"/><span dir="auto">{activePinned.body || (activePinned.type === "image" ? uiText("Pinned photo") : uiText("Pinned voice note"))}</span>{pinned.length > 1 && <b>{(pinnedCursor % pinned.length) + 1}/{pinned.length}</b>}</button>}
    </div>

    {navigationError&&<div className="notice error" role="alert">{uiText(navigationError)}<button className="text-button" onClick={()=>setNavigationError("")}>{uiText("Dismiss")}</button></div>}
    {pushReadingError&&<div className="notice error" role="alert">{uiText(pushReadingError)}</div>}
    <div className="chat-list chat-list-pro" ref={listRef} onScroll={handleScroll}>
      <div className={`chat-stream chat-stream-pro ${messages.length ? "has-messages" : ""}`} ref={streamRef}>
        <div ref={historySentinelRef} className="chat-history-sentinel" aria-hidden="true"/>
        {loadingOlderMessages && <div className="chat-history-state loading"><span/>{uiText("Loading earlier messages…")}</div>}
        {!loadingOlderMessages && !hasOlderMessages && messages.length > 0 && <div className="chat-history-state">{uiText("Beginning of your conversation")}</div>}
        {!messages.length && <div className="empty-state chat-empty"><HeartCopy/><span className="eyebrow">{uiText("JUST THE TWO OF YOU")}</span><h2>{uiText("A little closer,")}<br/>{uiText("one message at a time.")}</h2><p>{uiText("Say hello to ")}{partnerLabel}{uiText(". Your conversation starts here.")}</p></div>}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const next = messages[index + 1];
          const joinsPrevious = closeEnough(previous, message);
          const joinsNext = closeEnough(message, next);
          const position = joinsPrevious ? (joinsNext ? "middle" : "last") : (joinsNext ? "first" : "single");
          const showDate = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);

          return <Fragment key={message.id}>
            {showDate && <div className="day-chip day-chip-pro">{dayLabel(message.createdAt,new Date(),locale)}</div>}
            {unreadAnchorId === message.id && <div className="unread-divider"><span>{uiText("New messages")}</span></div>}
            {message.type === "call" ? <CallMessageCard message={message}/> : <MessageBubble
              message={message}
              groupPosition={position}
              animateEntrance={motionReadyRef.current && !knownMotionIdsRef.current.has(message.id) && index >= Math.max(0, messages.length - 3) && Math.abs(Date.now() - new Date(message.createdAt).getTime()) <= NEW_MESSAGE_MOTION_WINDOW_MS}
              showMeta={!joinsNext || Boolean(message.pending) || Boolean(message.failed)}
              partnerName={partnerLabel}
              onReply={() => setReplyDraft({ id: message.id, body: message.body || (message.type === "image" ? "Photo" : message.type === "video" ? "Video" : message.type === "voice" ? "Voice note" : "Message"), kind: message.type })}
              onReact={emoji => reactToMessage(message.id, emoji)}
              onEdit={body => editMessage(message.id, body)}
              onDelete={scope => deleteMessage(message.id, scope)}
              onPin={() => togglePin(message.id)}
              onStar={() => toggleStar(message.id)}
              onRetry={() => retryMessage(message.id)}
              onJumpToReply={jumpToMessage}
              onOpenMedia={(message.type === "image"||message.type === "video") ? () => openMedia(message.id) : undefined}
            />}
          </Fragment>;
        })}
      </div>
    </div>

    <TypingIndicator partnerName={partnerLabel} partnerAvatarUrl={profile.partnerAvatarUrl}/>
    {awayFromBottom && <button className="new-message-jump" onClick={() => scrollToLatest(prefersReducedMotion() ? "auto" : "smooth")}><ArrowDown size={15}/><span>{newBelowCount > 0 ? uiText("{0} new", [newBelowCount]) : uiText("Latest")}</span></button>}
    <Composer onFocus={onComposerFocus} onBlur={onComposerBlur}/>
    {toolMode && <ChatToolsPanel
      messages={messages}
      partnerName={partnerLabel}
      initialMode={toolMode}
      hasOlderMessages={hasOlderMessages}
      loadingOlderMessages={loadingOlderMessages}
      onLoadOlder={loadOlderMessages}
      onSearch={searchChat}
      onJumpToDate={jumpToDate}
      onLoadSaved={loadSavedMessages}
      onOpenMedia={openMedia}
      onClose={() => setToolMode(null)}
      onJump={jumpToMessage}
    />}
    {mediaViewerId && <ChatMediaViewer messages={mediaGallery||messages} activeId={mediaViewerId} partnerName={partnerLabel} onChange={setMediaViewerId} onJump={jumpToMessage} onClose={() => {setMediaViewerId(null);setMediaGallery(null);}}/>}
  </>;
}

function HeartCopy() {
  return <span style={{ fontSize: 34, color: "var(--rose)" }}>♥</span>;
}
