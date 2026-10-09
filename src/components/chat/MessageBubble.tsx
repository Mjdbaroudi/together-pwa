"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import Image from "next/image";
import { Check, CheckCheck, CircleAlert, Clock3, Copy, Info, Pencil, Pin, Play, Reply, RotateCcw, Star, Trash2 } from "lucide-react";
import { useSignedMedia } from "@/hooks/useSignedMedia";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Message } from "@/lib/types";
import { VoiceBubble } from "./VoiceBubble";
import { RichMessageText } from "./RichMessageText";

type GroupPosition = "single" | "first" | "middle" | "last";
const reactions = ["♥", "🥰", "😘", "😂", "👍"];
const LONG_PRESS_MS = 360;
const MOVE_CANCEL_PX = 12;
const SWIPE_REPLY_PX = 52;
const MAX_SWIPE_PX = 74;
const DOUBLE_TAP_MS = 285;

type MessageBubbleProps = {
  message: Message;
  onReply: () => void;
  onReact: (emoji?: string) => void | Promise<void>;
  onEdit: (body: string) => void | Promise<void>;
  onDelete: (scope: "me" | "everyone") => void | Promise<void>;
  onPin: () => void | Promise<void>;
  onStar: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onJumpToReply?: (id: string) => void;
  onOpenMedia?: () => void;
  groupPosition?: GroupPosition;
  showMeta?: boolean;
  partnerName?: string;
  animateEntrance?: boolean;
};

type Gesture = { pointerId: number; x: number; y: number; dx: number; dy: number; swiping: boolean };

function fullTime(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function replyLabel(message: Message["replyTo"]) {
  if (!message) return "Reply";
  if (message.kind === "image") return "Photo";
  if (message.kind === "voice") return "Voice note";
  return message.body;
}

export function MessageBubble({
  message,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onPin,
  onStar,
  onRetry,
  onJumpToReply,
  onOpenMedia,
  groupPosition = "single",
  showMeta = true,
  partnerName = "Partner",
  animateEntrance = false,
}: MessageBubbleProps) {
  const { t: uiText } = useLanguage();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [infoMode, setInfoMode] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body || "");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [reactionPulse, setReactionPulse] = useState(false);
  const [entranceActive, setEntranceActive] = useState(animateEntrance);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const lastTapAtRef = useRef(0);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const previousReactionTextRef = useRef<string | null>(null);
  const initialEntranceMotionRef = useRef(animateEntrance);
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const media=useSignedMedia(message.mediaUrl,message.mediaPath);
  const isMine = message.sender === "me";
  const isUnsent = Boolean(message.pending || message.failed);
  const isDeleted = Boolean(message.deletedAt);

  function cancelLongPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  function resetBubbleTransform() {
    const element = bubbleRef.current;
    if (!element) return;
    element.parentElement?.classList.remove("is-swiping");
    element.style.transition = "transform 170ms cubic-bezier(.2,.8,.2,1)";
    element.style.transform = "translate3d(0,0,0)";
    window.setTimeout(() => { if (bubbleRef.current) bubbleRef.current.style.transition = ""; }, 190);
  }

  function resetGesture() {
    cancelLongPress();
    gestureRef.current = null;
    resetBubbleTransform();
  }

  useEffect(() => () => cancelLongPress(), []);

  useEffect(() => {
    if (!initialEntranceMotionRef.current) return;
    const timer = window.setTimeout(() => setEntranceActive(false), 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    document.body.classList.add("message-sheet-active");
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setSheetOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("message-sheet-active");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [sheetOpen, busy]);

  function openSheet() {
    resetGesture();
    setEditMode(false);
    setDeleteMode(false);
    setInfoMode(false);
    setEditDraft(message.body || "");
    setActionError("");
    setSheetOpen(true);
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function beginPress(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button,a,input,textarea,audio")) return;
    cancelLongPress();
    gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, swiping: false };
    // Keep vertical scrolling on the browser's native compositor path.
    // Pointer capture is requested only after a horizontal reply swipe is confirmed.
    pressTimer.current = setTimeout(openSheet, LONG_PRESS_MS);
  }

  function movePress(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    gesture.dx = dx; gesture.dy = dy;

    if (!gesture.swiping && Math.abs(dy) > MOVE_CANCEL_PX && Math.abs(dy) > Math.abs(dx) * 1.08) {
      // A vertical pan belongs entirely to the native scroll container. Stop
      // tracking this gesture so React does no more work for this finger.
      cancelLongPress();
      gestureRef.current = null;
      return;
    }

    if (!isDeleted && dx > 10 && Math.abs(dx) > Math.abs(dy) * 1.28) {
      cancelLongPress();
      gesture.swiping = true;
      gesture.dx = Math.min(MAX_SWIPE_PX, dx);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* browser may own gesture */ }
      const element = bubbleRef.current;
      if (element) {
        element.parentElement?.classList.add("is-swiping");
        element.style.transition = "none";
        element.style.transform = `translate3d(${gesture.dx}px,0,0)`;
      }
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) cancelLongPress();
  }

  function endPress(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    cancelLongPress();
    if (gesture?.swiping && gesture.dx >= SWIPE_REPLY_PX && !isDeleted) {
      if (navigator.vibrate) navigator.vibrate(10);
      onReply();
    } else if (gesture && Math.hypot(gesture.dx, gesture.dy) < 9 && !isDeleted && !isUnsent) {
      const now = performance.now();
      if (now - lastTapAtRef.current <= DOUBLE_TAP_MS) {
        lastTapAtRef.current = 0;
        if (navigator.vibrate) navigator.vibrate(8);
        void Promise.resolve(onReact("♥")).catch(error=>{setActionError(error instanceof Error?error.message:"Could not react.");setSheetOpen(true);});
      } else lastTapAtRef.current = now;
    }
    gestureRef.current = null;
    resetBubbleTransform();
  }

  async function runAndClose(fn: () => void | Promise<void>) {
    setBusy(true);
    setActionError("");
    try { await fn(); setSheetOpen(false); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not complete this action."); }
    finally { setBusy(false); }
  }

  async function saveEdit() {
    const clean = editDraft.trim();
    if (!clean) { setActionError("Message cannot be empty."); return; }
    if (clean === (message.body || "").trim()) { setSheetOpen(false); return; }
    await runAndClose(() => onEdit(clean));
  }

  async function copyMessage() {
    const text = message.body || (message.type === "image" ? "Photo" : message.type === "voice" ? "Voice note" : "");
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const field = document.createElement("textarea"); field.value = text; field.style.position = "fixed"; field.style.opacity = "0";
      document.body.appendChild(field); field.select(); document.execCommand("copy"); field.remove();
    }
    setSheetOpen(false);
  }

  const reactionGroups = Array.from((message.reactionDetails?.length
    ? message.reactionDetails
    : (message.reactions || []).map(emoji => ({ emoji })))
    .reduce((map, reaction) => map.set(reaction.emoji, (map.get(reaction.emoji) || 0) + 1), new Map<string, number>())
    .entries());
  const reactionText = reactionGroups.map(([emoji, count]) => `${emoji}${count > 1 ? ` ${count}` : ""}`).join("  ");
  const myReaction = message.reactionDetails?.find(reaction => reaction.mine)?.emoji;

  useEffect(() => {
    const previous = previousReactionTextRef.current;
    previousReactionTextRef.current = reactionText;
    if (previous === null || previous === reactionText || !reactionText) return;
    setReactionPulse(false);
    const frame = requestAnimationFrame(() => setReactionPulse(true));
    const timer = window.setTimeout(() => setReactionPulse(false), 380);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [reactionText]);
  const reactionSummary = (message.reactionDetails || []).map(reaction => `${reaction.mine ? "You" : partnerName} ${reaction.emoji}`).join(" · ");
  if (message.type === "system") return <div className="system-message" dir="auto">{message.body}</div>;

  const sheet = sheetOpen && typeof document !== "undefined" ? createPortal(
    <div className="message-sheet-backdrop" onClick={() => !busy && setSheetOpen(false)}>
      <div className="message-sheet" role="dialog" aria-modal="true" aria-label={uiText("Message actions")} onClick={event => event.stopPropagation()}>
        <div className="message-sheet-handle"/>
        <div className="message-sheet-preview">
          <span className="message-sheet-owner">{isMine ? uiText("You") : partnerName}</span>
          <span dir="auto">{isDeleted ? uiText("This message was deleted") : message.body || (message.type === "image" ? uiText("Photo") : message.type === "video" ? uiText("Video") : uiText("Voice note"))}</span>
        </div>

        {infoMode ? <div className="message-info-panel">
          <div className="message-info-title"><Info size={17}/><strong>{uiText("Message info")}</strong></div>
          <InfoRow label={uiText("Sent")} value={fullTime(message.createdAt)}/>
          <InfoRow label={uiText("Delivered")} value={isMine ? fullTime(message.deliveredAt) : "—"} active={Boolean(message.deliveredAt)}/>
          <InfoRow label={uiText("Read")} value={isMine ? fullTime(message.readAt) : "—"} active={Boolean(message.readAt)}/>
          {message.edited && <InfoRow label={uiText("Edited")} value="Yes" active/>}
          {message.deletedAt && <InfoRow label={uiText("Deleted")} value={fullTime(message.deletedAt)} active/>}
          <button className="sheet-cancel" onClick={() => setInfoMode(false)}>{uiText("Back")}</button>
        </div> : editMode ? <div className="message-edit-panel">
          <label htmlFor={`edit-${message.id}`}>{uiText("Edit message")}</label>
          <textarea id={`edit-${message.id}`} autoFocus dir="auto" value={editDraft} maxLength={4000} onChange={event => setEditDraft(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void saveEdit(); }}/>
          {actionError && <p className="message-action-error">{uiText(actionError)}</p>}
          <div className="message-sheet-confirm-actions"><button disabled={busy} onClick={() => { setEditMode(false); setActionError(""); }}>{uiText("Cancel")}</button><button className="primary" disabled={busy || !editDraft.trim()} onClick={() => void saveEdit()}>{busy ? uiText("Saving…") : uiText("Save")}</button></div>
        </div> : deleteMode ? <div className="message-delete-panel">
          <strong>{uiText("Delete message")}</strong>
          <p>{uiText("Choose where you want this message removed.")}</p>
          {actionError && <p className="message-action-error">{uiText(actionError)}</p>}
          <div className="message-delete-choices">
            <button disabled={busy} onClick={() => void runAndClose(() => onDelete("me"))}><Trash2 size={18}/><span><b>{uiText("Delete for me")}</b><small>{uiText("Only hide it from this account")}</small></span></button>
            {isMine && !isUnsent && !isDeleted && <button className="danger" disabled={busy} onClick={() => void runAndClose(() => onDelete("everyone"))}><Trash2 size={18}/><span><b>{uiText("Delete for everyone")}</b><small>{uiText("Remove it from both accounts")}</small></span></button>}
          </div>
          <button className="sheet-cancel" disabled={busy} onClick={() => setDeleteMode(false)}>{uiText("Back")}</button>
        </div> : <>
          {!isUnsent && !isDeleted && <div className="quick-reactions" aria-label={uiText("Quick reactions")}>{reactions.map(emoji => <button key={emoji} className={myReaction === emoji ? "active" : ""} aria-pressed={myReaction === emoji} disabled={busy} onClick={() => void runAndClose(() => onReact(emoji))}>{emoji}</button>)}</div>}
          {reactionSummary && <div className="reaction-sheet-summary">{reactionSummary}</div>}
          {actionError && <p className="message-action-error">{uiText(actionError)}</p>}
          <div className="message-sheet-actions">
            {!isDeleted && <button disabled={busy} onClick={() => { setSheetOpen(false); onReply(); }}><Reply size={19}/><span>{uiText("Reply")}</span></button>}
            {!isDeleted && message.type === "text" && <button disabled={busy} onClick={() => void copyMessage()}><Copy size={19}/><span>{uiText("Copy")}</span></button>}
            {!isUnsent && !isDeleted && <button disabled={busy} onClick={() => void runAndClose(onPin)}><Pin size={19} fill={message.pinned ? "currentColor" : "none"}/><span>{message.pinned ? uiText("Unpin") : uiText("Pin")}</span></button>}
            {!isUnsent && !isDeleted && <button disabled={busy} onClick={() => void runAndClose(onStar)}><Star size={19} fill={message.starred ? "currentColor" : "none"}/><span>{message.starred ? uiText("Unstar") : uiText("Star")}</span></button>}
            {message.failed && onRetry && <button disabled={busy} onClick={() => void runAndClose(onRetry)}><RotateCcw size={19}/><span>{uiText("Retry")}</span></button>}
            {isMine && !isDeleted && message.type === "text" && <button disabled={busy} onClick={() => { setEditDraft(message.body || ""); setActionError(""); setEditMode(true); }}><Pencil size={19}/><span>{uiText("Edit")}</span></button>}
            {isMine && !isUnsent && <button disabled={busy} onClick={() => setInfoMode(true)}><Info size={19}/><span>{uiText("Message info")}</span></button>}
            <button className="danger" disabled={busy} onClick={() => { setActionError(""); setDeleteMode(true); }}><Trash2 size={19}/><span>{uiText("Delete")}</span></button>
          </div>
          <button className="sheet-cancel" disabled={busy} onClick={() => setSheetOpen(false)}>{uiText("Cancel")}</button>
        </>}
      </div>
    </div>, document.body,
  ) : null;

  return <>
    <div className={`bubble-row ${isMine ? "me" : "partner"} group-${groupPosition} ${entranceActive ? "motion-new-message" : ""}`} data-message-id={message.id}>
      {!isDeleted && <div className="swipe-reply-hint" aria-hidden="true"><Reply size={15}/></div>}
      <div className="message-bubble-stack">
        <div
          ref={bubbleRef}
          className={`bubble ${isMine ? "me" : "partner"} ${(message.type === "image"||message.type === "video") ? "image" : ""} ${message.failed ? "failed" : ""} ${isDeleted ? "deleted" : ""} group-${groupPosition}`}
          onPointerDown={beginPress}
          onPointerMove={movePress}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onContextMenu={event => { event.preventDefault(); openSheet(); }}
          onDragStart={event => event.preventDefault()}
          tabIndex={0}
          role="group"
          aria-haspopup="dialog"
          aria-label={uiText("{0} {1} message. Press Enter for actions.", [isMine?"Your":"Partner’s", message.type])}
          onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==="Enter"||event.key===" "){event.preventDefault();openSheet();}}}
        >
        {message.pinned && !isDeleted && <div className="pin-mark"><Pin size={10} fill="currentColor"/>{uiText(" Pinned")}</div>}

        {message.replyTo && !isDeleted && <button className="reply-snapshot reply-snapshot-pro" dir="auto" onClick={() => onJumpToReply?.(message.replyTo!.id)}>
          <span className="reply-label">{uiText("Reply")}</span><span>{replyLabel(message.replyTo).slice(0, 92)}</span>
        </button>}

        {isDeleted ? <div className="deleted-message"><Trash2 size={14}/><em>{uiText("This message was deleted")}</em></div> : <>
          {message.type === "image" && media.url && <button className="chat-image-button" onClick={onOpenMedia} aria-label={uiText("Open photo")}><div className="chat-image-wrap"><Image src={media.url} alt={message.body || uiText("Shared image")} width={1000} height={1000} unoptimized loading="lazy" onError={()=>void media.retry()}/></div></button>}
          {message.type === "image" && message.body && <div className="caption" dir="auto">{message.body}</div>}
          {message.type === "video"&&media.url&&<button className="chat-video-card" onClick={onOpenMedia} aria-label={uiText("Open video")}>
            <video src={media.url} muted playsInline preload="none" onError={()=>void media.retry()}/>
            <span className="chat-video-play"><Play size={23} fill="currentColor"/></span>
            <span className="chat-video-label">{uiText("Video ")}<small>{uiText("Tap to watch")}</small></span>
          </button>}
          {message.type === "video" && message.body && <div className="caption" dir="auto">{message.body}</div>}
          {message.type === "voice" && <VoiceBubble src={media.url} path={message.mediaPath} duration={message.duration}/>} 
          {media.error&&<p role="alert" className="hint">{media.error}</p>}
          {message.type === "text" && message.body && <RichMessageText text={message.body}/>} 
        </>}

        {showMeta && <div className="bubble-meta bubble-meta-pro">
          {message.starred && !isDeleted && <Star className="message-star-mark" size={9} fill="currentColor"/>}
          {message.edited && !isDeleted && <span className="edited-label">{uiText("edited")}</span>}
          <span>{time}</span>
          {isMine && <MessageStatus pending={Boolean(message.pending)} failed={Boolean(message.failed)} delivered={Boolean(message.delivered)} seen={Boolean(message.seen)} onRetry={onRetry}/>} 
        </div>}

        </div>
        {reactionText && !isDeleted && <button className={`reaction-badge reaction-badge-pro ${reactionPulse ? "reaction-pop" : ""}`} onClick={openSheet} aria-label={uiText("{0} message reactions", [reactionGroups.reduce((sum, [, count]) => sum + count, 0)])}>{reactionText}</button>}
      </div>
    </div>
    {sheet}
  </>;
}

function InfoRow({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  const { t: uiText } = useLanguage();
  return <div className={`message-info-row ${active ? "active" : ""}`}><span>{uiText(label)}</span><b>{uiText(value)}</b></div>;
}

function MessageStatus({ pending, failed, delivered, seen, onRetry }: { pending: boolean; failed: boolean; delivered: boolean; seen: boolean; onRetry?: () => void | Promise<void> }) {
  const { t: uiText } = useLanguage();

  if (failed) return <button className="message-status failed" title={uiText("Could not send — tap to retry")} onClick={event => { event.stopPropagation(); void onRetry?.(); }}><CircleAlert size={12}/></button>;
  if (pending) return <span className="message-status pending" title={uiText("Sending")}><Clock3 size={11}/></span>;
  if (seen) return <span className="message-status read" title={uiText("Read")}><CheckCheck size={13}/></span>;
  if (delivered) return <span className="message-status delivered" title={uiText("Delivered")}><CheckCheck size={13}/></span>;
  return <span className="message-status sent" title={uiText("Sent")}><Check size={12}/></span>;
}
