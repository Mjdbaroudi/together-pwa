"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { partnerLabel } from "@/lib/together/contactPreferences";

import { Camera, ImagePlus, Mic, Pause, Play, Plus, Send, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTogether } from "@/components/providers/TogetherProvider";
import { VoiceBubble } from "@/components/chat/VoiceBubble";
import { errorMessage } from "@/lib/errors";
import { readChatDraft, writeChatDraft } from "@/lib/together/draft";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type ComposerProps = {
  onFocus?: () => void;
  onBlur?: () => void;
};

const TYPING_IDLE_MS = 1350;
const TYPING_HEARTBEAT_MS = 1600;
const TYPING_START_DELAY_MS = 70;
const MIN_TEXTAREA_HEIGHT = 38;
const MAX_TEXTAREA_HEIGHT = 92;
const RECORD_WAVE_BARS = 22;
const MAX_VOICE_SECONDS = 10 * 60;

function preferredVoiceMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
}

export function Composer({ onFocus, onBlur }: ComposerProps) {
  const { t: uiText } = useLanguage();

  const { sendText, sendMedia, setTyping, replyDraft, setReplyDraft, profile } = useTogether();
  // Keep text entry uncontrolled so Android IMEs stay on the browser's native fast path.
  const [hasText, setHasText] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordPaused, setRecordPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [voiceDraft, setVoiceDraft] = useState<{ file: File; url: string; duration: number } | null>(null);
  const [recordWaveform, setRecordWaveform] = useState<number[]>(() => Array.from({ length: RECORD_WAVE_BARS }, () => 6));

  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordAudioContextRef = useRef<AudioContext | null>(null);
  const recordAnalyserRef = useRef<AnalyserNode | null>(null);
  const recordMeterFrameRef = useRef<number | null>(null);
  const recordMeterLastPaintRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartedAtRef = useRef(0);
  const recordAccumulatedMsRef = useRef(0);
  const recordRunningStartedAtRef = useRef(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordSwipeStartRef = useRef<number | null>(null);
  const mediaUploadAbortRef = useRef<AbortController | null>(null);

  const previewUrlRef = useRef("");
  const voiceDraftUrlRef = useRef("");
  const latestTextRef = useRef("");
  const hasTextRef = useRef(false);
  const keepKeyboardAfterSendRef = useRef(false);
  const loadedDraftForRef = useRef("");
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingHeartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingActiveRef = useRef(false);
  const resizeFrameRef = useRef<number | null>(null);
  const supportsNativeFieldSizingRef = useRef(false);

  useEffect(() => { previewUrlRef.current = previewUrl; }, [previewUrl]);

  useEffect(() => {
    supportsNativeFieldSizingRef.current = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content") === true;
  }, []);

  useEffect(() => {
    if (!profile.coupleId || loadedDraftForRef.current === `${profile.myUserId}:${profile.coupleId}`) return;
    loadedDraftForRef.current = `${profile.myUserId}:${profile.coupleId}`;
    const saved = readChatDraft(profile.coupleId,profile.myUserId||"");
    restoreNativeDraft(saved.text,false,saved.selectionStart,saved.selectionEnd);
  }, [profile.coupleId,profile.myUserId]);

  useEffect(() => () => {
    const input = textRef.current;
    if (profile.coupleId) writeChatDraft(profile.coupleId,profile.myUserId||"", latestTextRef.current, input?.selectionStart ?? latestTextRef.current.length, input?.selectionEnd ?? latestTextRef.current.length);
  }, [profile.coupleId,profile.myUserId]);

  useEffect(() => {
    if (recording) return;
    const input = textRef.current;
    if (!input || input.value === latestTextRef.current) return;
    input.value = latestTextRef.current;
    scheduleFallbackResize(true);
  }, [recording]);

  useEffect(() => () => {
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    if (typingStartTimerRef.current) clearTimeout(typingStartTimerRef.current);
    if (typingHeartbeatTimerRef.current) clearInterval(typingHeartbeatTimerRef.current);
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (typingActiveRef.current) setTyping(false);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (voiceDraftUrlRef.current) URL.revokeObjectURL(voiceDraftUrlRef.current);
    if (recordMeterFrameRef.current !== null) cancelAnimationFrame(recordMeterFrameRef.current);
    void recordAudioContextRef.current?.close().catch(() => undefined);
    recordAudioContextRef.current = null;
    recordAnalyserRef.current = null;
    recorderRef.current?.stream?.getTracks().forEach(track => track.stop());
    mediaUploadAbortRef.current?.abort();
  }, [setTyping]);

  function scheduleFallbackResize(forceShrink = false) {
    if (supportsNativeFieldSizingRef.current) return;
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const target = textRef.current;
      if (!target) return;
      if (forceShrink) target.style.height = "auto";
      const nextHeight = Math.min(MAX_TEXTAREA_HEIGHT, Math.max(MIN_TEXTAREA_HEIGHT, target.scrollHeight));
      const currentHeight = Math.round(target.getBoundingClientRect().height);
      if (Math.abs(currentHeight - nextHeight) > 1) target.style.height = `${nextHeight}px`;
    });
  }

  function startTypingSignal() {
    if (typingActiveRef.current) return;
    typingActiveRef.current = true;
    setTyping(true);
    if (typingHeartbeatTimerRef.current) clearInterval(typingHeartbeatTimerRef.current);
    typingHeartbeatTimerRef.current = setInterval(() => {
      if (typingActiveRef.current) setTyping(true);
    }, TYPING_HEARTBEAT_MS);
  }

  function stopTypingSignal() {
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    if (typingStartTimerRef.current) clearTimeout(typingStartTimerRef.current);
    if (typingHeartbeatTimerRef.current) clearInterval(typingHeartbeatTimerRef.current);
    typingIdleTimerRef.current = null;
    typingStartTimerRef.current = null;
    typingHeartbeatTimerRef.current = null;
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      setTyping(false);
    }
  }

  function scheduleTypingSignal(hasDraft: boolean) {
    if (!hasDraft) { stopTypingSignal(); return; }
    if (!typingActiveRef.current && !typingStartTimerRef.current) {
      typingStartTimerRef.current = setTimeout(() => {
        typingStartTimerRef.current = null;
        if (latestTextRef.current.trim()) startTypingSignal();
      }, TYPING_START_DELAY_MS);
    }
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = setTimeout(() => {
      typingIdleTimerRef.current = null;
      stopTypingSignal();
    }, TYPING_IDLE_MS);
  }

  function scheduleDraftSave(value: string, selectionStart?: number | null, selectionEnd?: number | null) {
    if (!profile.coupleId) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const start = selectionStart ?? value.length;
    const end = selectionEnd ?? start;
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      writeChatDraft(profile.coupleId,profile.myUserId||"", value, start, end);
    }, 180);
  }

  function restoreComposerFocus() {
    const input = textRef.current;
    if (!input) return;
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
  }

  function syncHasText(value: string) {
    const next = Boolean(value.trim());
    if (next !== hasTextRef.current) {
      hasTextRef.current = next;
      setHasText(next);
    }
    return next;
  }

  function clearNativeDraft() {
    latestTextRef.current = "";
    if (profile.coupleId) writeChatDraft(profile.coupleId,profile.myUserId||"", "");
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    if (textRef.current) textRef.current.value = "";
    syncHasText("");
    scheduleFallbackResize(true);
  }

  function restoreNativeDraft(body: string, persist = true, selectionStart = body.length, selectionEnd = selectionStart) {
    latestTextRef.current = body;
    if (textRef.current) {
      textRef.current.value = body;
      try { textRef.current.setSelectionRange(selectionStart, selectionEnd); } catch { /* no-op */ }
    }
    syncHasText(body);
    scheduleFallbackResize(true);
    scheduleTypingSignal(Boolean(body.trim()));
    if (persist && profile.coupleId) writeChatDraft(profile.coupleId,profile.myUserId||"", body, selectionStart, selectionEnd);
  }

  async function submit() {
    const body = latestTextRef.current.trim();
    if (!body) return;

    const keepKeyboard = keepKeyboardAfterSendRef.current || document.activeElement === textRef.current;
    keepKeyboardAfterSendRef.current = false;
    setError("");
    setAttachOpen(false);
    stopTypingSignal();
    clearNativeDraft();

    if (keepKeyboard) {
      restoreComposerFocus();
      requestAnimationFrame(restoreComposerFocus);
    }

    try {
      // sendText is optimistic in v2.0 and returns as soon as the message is queued locally.
      await sendText(body);
      if (navigator.vibrate) navigator.vibrate(10);
    } catch (caught: unknown) {
      if (!latestTextRef.current.trim()) restoreNativeDraft(body);
      setError(errorMessage(caught, "Could not queue this message."));
    } finally {
      if (keepKeyboard) requestAnimationFrame(restoreComposerFocus);
    }
  }

  function handleInput(value: string, inputType?: string, selectionStart?: number | null, selectionEnd?: number | null) {
    const previous = latestTextRef.current;
    latestTextRef.current = value;
    const nextHasText = syncHasText(value);
    scheduleTypingSignal(nextHasText);
    scheduleDraftSave(value, selectionStart, selectionEnd);
    const shrinking = value.length < previous.length || inputType?.startsWith("delete") === true;
    scheduleFallbackResize(shrinking);
  }

  function chooseFile(file?: File) {
    if (!file) return;
    setAttachOpen(false);
    setError("");
    if (file.size > 15 * 1024 * 1024) { setError("This photo is larger than the 15 MB limit."); return; }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreview = URL.createObjectURL(file);
    previewUrlRef.current = nextPreview;
    setPendingFile(file);
    setPreviewUrl(nextPreview);
  }

  function clearPendingFile() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
    setPendingFile(null);
    if (galleryRef.current) galleryRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  function cancelMediaUpload(kind: "image" | "voice") {
    mediaUploadAbortRef.current?.abort();
    mediaUploadAbortRef.current = null;
    setUploadProgress(null);
    setBusy(false);
    if (kind === "image") clearPendingFile();
    else clearVoiceDraft();
  }

  async function sendPendingFile() {
    if (!pendingFile || busy) return;
    const controller = new AbortController();
    mediaUploadAbortRef.current = controller;
    setBusy(true);
    setUploadProgress(0);
    setError("");
    try {
      await sendMedia(pendingFile,pendingFile.type.startsWith("video/")?"video":"image", undefined, { signal: controller.signal, onProgress: setUploadProgress });
      clearPendingFile();
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(errorMessage(caught, "Could not send this photo."));
    } finally {
      if (mediaUploadAbortRef.current === controller) mediaUploadAbortRef.current = null;
      setUploadProgress(null);
      setBusy(false);
    }
  }

  function stopRecordMeter() {
    if (recordMeterFrameRef.current !== null) cancelAnimationFrame(recordMeterFrameRef.current);
    recordMeterFrameRef.current = null;
    recordAnalyserRef.current = null;
    const context = recordAudioContextRef.current;
    recordAudioContextRef.current = null;
    if (context) void context.close().catch(() => undefined);
    setRecordWaveform(Array.from({ length: RECORD_WAVE_BARS }, () => 6));
  }

  function startRecordMeter(stream: MediaStream) {
    stopRecordMeter();
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = .72;
      context.createMediaStreamSource(stream).connect(analyser);
      recordAudioContextRef.current = context;
      recordAnalyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);
      const draw = (time: number) => {
        recordMeterFrameRef.current = requestAnimationFrame(draw);
        if (time - recordMeterLastPaintRef.current < 72) return;
        recordMeterLastPaintRef.current = time;
        if (recorderRef.current?.state === "paused") {
          setRecordWaveform(current => current.map(value => Math.max(5, Math.round(value * .72))));
          return;
        }
        analyser.getByteTimeDomainData(data);
        const block = Math.max(1, Math.floor(data.length / RECORD_WAVE_BARS));
        const next = Array.from({ length: RECORD_WAVE_BARS }, (_, index) => {
          const start = index * block;
          const end = Math.min(data.length, start + block);
          let peak = 0;
          for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs((data[i] - 128) / 128));
          return Math.round(5 + Math.min(1, peak * 2.1) * 21);
        });
        setRecordWaveform(next);
      };
      recordMeterFrameRef.current = requestAnimationFrame(draw);
    } catch {
      stopRecordMeter();
    }
  }

  function recordedMs() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") return recordAccumulatedMsRef.current + Math.max(0, Date.now() - recordRunningStartedAtRef.current);
    return recordAccumulatedMsRef.current;
  }

  function stopRecording(discard = false) {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    discardRecordingRef.current = discard;
    if (recorder.state === "recording") {
      recordAccumulatedMsRef.current += Math.max(0, Date.now() - recordRunningStartedAtRef.current);
    }
    recorder.stop();
    setRecording(false);
    setRecordPaused(false);
  }

  async function toggleRecording() {
    if (recording) {
      stopRecording(false);
      return;
    }

    try {
      setAttachOpen(false);
      setError("");
      stopTypingSignal();
      discardRecordingRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredVoiceMimeType();
      const nextRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      nextRecorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      nextRecorder.onstop = () => {
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
        stream.getTracks().forEach(track => track.stop());
        stopRecordMeter();
        const shouldDiscard = discardRecordingRef.current;
        discardRecordingRef.current = false;
        const duration = Math.max(1, Math.round(recordAccumulatedMsRef.current / 1000));
        setElapsed(0);
        setRecordPaused(false);
        recorderRef.current = null;
        if (shouldDiscard) { chunksRef.current = []; return; }

        const blob = new Blob(chunksRef.current, { type: (nextRecorder.mimeType || "audio/webm").split(";")[0] });
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("mpeg") ? "mp3" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type });
        if (voiceDraftUrlRef.current) URL.revokeObjectURL(voiceDraftUrlRef.current);
        const url = URL.createObjectURL(blob);
        voiceDraftUrlRef.current = url;
        setVoiceDraft({ file, url, duration });
        if (navigator.vibrate) navigator.vibrate(12);
      };
      nextRecorder.start(250);
      recordStartedAtRef.current = Date.now();
      recordAccumulatedMsRef.current = 0;
      recordRunningStartedAtRef.current = Date.now();
      recorderRef.current = nextRecorder;
      startRecordMeter(stream);
      setRecording(true);
      setRecordPaused(false);
      setElapsed(0);
      recordTimerRef.current = setInterval(() => {
        const seconds = Math.floor(recordedMs() / 1000);
        setElapsed(seconds);
        if (seconds >= MAX_VOICE_SECONDS) stopRecording(false);
      }, 250);
      if (navigator.vibrate) navigator.vibrate(16);
    } catch {
      stopRecordMeter();
      setError("Microphone permission is required to record a voice note.");
    }
  }

  function toggleRecordingPause() {
    const recorder = recorderRef.current;
    if (!recorder || !recording) return;
    if (recorder.state === "recording") {
      recordAccumulatedMsRef.current += Math.max(0, Date.now() - recordRunningStartedAtRef.current);
      recorder.pause();
      setRecordPaused(true);
      setElapsed(Math.floor(recordAccumulatedMsRef.current / 1000));
    } else if (recorder.state === "paused") {
      recorder.resume();
      recordRunningStartedAtRef.current = Date.now();
      setRecordPaused(false);
    }
  }

  function cancelRecording() {
    if (!recording) return;
    stopRecording(true);
  }

  function clearVoiceDraft() {
    if (voiceDraftUrlRef.current) URL.revokeObjectURL(voiceDraftUrlRef.current);
    voiceDraftUrlRef.current = "";
    setVoiceDraft(null);
  }

  async function sendVoiceDraft() {
    if (!voiceDraft || busy) return;
    const controller = new AbortController();
    mediaUploadAbortRef.current = controller;
    setBusy(true);
    setUploadProgress(0);
    setError("");
    try {
      await sendMedia(voiceDraft.file, "voice", voiceDraft.duration, { signal: controller.signal, onProgress: setUploadProgress });
      clearVoiceDraft();
      if (navigator.vibrate) navigator.vibrate(14);
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(errorMessage(caught, "Could not send this voice note."));
    } finally {
      if (mediaUploadAbortRef.current === controller) mediaUploadAbortRef.current = null;
      setUploadProgress(null);
      setBusy(false);
    }
  }

  const partner = partnerLabel(profile);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return <div className="composer-wrap composer-wrap-pro" dir="ltr">
    {error && <div className="composer-error"><span>{uiText(error)}</span><button onClick={() => setError("")} aria-label={uiText("Dismiss")}><X size={14}/></button></div>}
    {replyDraft && <div className="reply-banner reply-banner-pro"><div><strong>{uiText("Replying")}</strong><span dir="auto">{replyDraft.body.slice(0, 90)}</span></div><button onClick={() => setReplyDraft(null)} aria-label={uiText("Cancel reply")}><X size={15}/></button></div>}

    {voiceDraft && <div className="voice-draft-card">
      <div className="voice-draft-preview"><VoiceBubble src={voiceDraft.url} duration={voiceDraft.duration}/>{busy && uploadProgress !== null && <UploadProgress value={uploadProgress}/>}</div>
      <button className="voice-draft-delete" onClick={() => busy ? cancelMediaUpload("voice") : clearVoiceDraft()} aria-label={busy ? uiText("Cancel upload") : uiText("Discard voice note")}><Trash2 size={17}/></button>
      <button className="voice-draft-send" onClick={() => void sendVoiceDraft()} disabled={busy} aria-label={uiText("Send voice note")}><Send size={17}/></button>
    </div>}

    {pendingFile && previewUrl && <div className="media-draft-card">
      {pendingFile.type.startsWith("video/")?<video src={previewUrl} controls playsInline style={{width:64,height:64,objectFit:"cover"}}/>:<img src={previewUrl} alt={uiText("Photo preview")}/>}
      <div className="media-draft-copy"><strong>{busy ? (uploadProgress === 100 ? uiText("Finishing…") : uiText("Uploading…")) : uiText("Ready to send")}</strong><span>{pendingFile.name || uiText("Photo")} · {formatSize(pendingFile.size)}{busy && uploadProgress !== null ? ` · ${uploadProgress}%` : ""}</span>{busy && uploadProgress !== null && <UploadProgress value={uploadProgress}/>}</div>
      <button className="media-draft-cancel" onClick={() => busy ? cancelMediaUpload("image") : clearPendingFile()} aria-label={busy ? uiText("Cancel upload") : uiText("Remove photo")}><X size={18}/></button>
      <button className="media-draft-send" onClick={() => void sendPendingFile()} disabled={busy} aria-label={uiText("Send photo")}><Send size={17}/></button>
    </div>}

    {attachOpen && !recording && !pendingFile && !voiceDraft && <div className="attachment-tray" role="group" aria-label={uiText("Attachment options")}>
      <button onClick={() => galleryRef.current?.click()}><span><ImagePlus size={20}/></span><b>{uiText("Photos & videos")}</b></button>
      <button onClick={() => cameraRef.current?.click()}><span><Camera size={20}/></span><b>{uiText("Camera")}</b></button>
    </div>}

    <div className={`composer composer-pro ${recording ? "recording" : ""}`}>
      <input ref={galleryRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden onChange={event => chooseFile(event.target.files?.[0])}/>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={event => chooseFile(event.target.files?.[0])}/>

      {recording ? <>
        <button className="record-cancel" onClick={cancelRecording} aria-label={uiText("Discard recording")}><X size={18}/></button>
        <button className="record-pause" onClick={toggleRecordingPause} aria-label={recordPaused ? uiText("Resume recording") : uiText("Pause recording")}>{recordPaused ? <Play size={16} fill="currentColor"/> : <Pause size={16}/>}</button>
        <div className={`recording-state recording-state-v2 ${recordPaused ? "paused" : ""}`}
          onPointerDown={event => { recordSwipeStartRef.current = event.clientX; }}
          onPointerMove={event => {
            if (recordSwipeStartRef.current !== null && recordSwipeStartRef.current - event.clientX > 72) {
              recordSwipeStartRef.current = null;
              cancelRecording();
              if (navigator.vibrate) navigator.vibrate(18);
            }
          }}
          onPointerUp={() => { recordSwipeStartRef.current = null; }}
          onPointerCancel={() => { recordSwipeStartRef.current = null; }}>
          <span className="recording-dot"/>
          <div className="live-record-wave" aria-hidden="true">{recordWaveform.map((height, index) => <i key={index} style={{ height }}/>)}</div>
          <span>{recordPaused ? uiText("Paused") : uiText("Recording · slide left to cancel")}</span><b>{mm}:{ss}</b>
        </div>
      </> : <button className={`composer-icon attach-toggle ${attachOpen ? "active" : ""}`} onClick={() => setAttachOpen(value => !value)} aria-expanded={attachOpen} aria-label={uiText("Add attachment")} disabled={busy || Boolean(pendingFile) || Boolean(voiceDraft)}><Plus size={22}/></button>}

      {!recording && <textarea
        ref={textRef}
        className="native-fast-textarea"
        dir="auto"
        rows={1}
        onInput={event => {
          const nativeEvent = event.nativeEvent as InputEvent;
          handleInput(event.currentTarget.value, nativeEvent.inputType, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
        }}
        onSelect={event => scheduleDraftSave(latestTextRef.current, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
        onFocus={() => { setAttachOpen(false); onFocus?.(); }}
        onBlur={() => onBlur?.()}
        onKeyDown={event => {
          const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
          if (event.key === "Enter" && !event.shiftKey && !coarse && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={uiText("Message {0}…", [partner])}
        aria-label={uiText("Message {0}", [partner])}
        enterKeyHint="send"
        autoComplete="off"
        autoCapitalize="sentences"
        spellCheck
      />}

      {hasText && !recording ? <button
        className="send send-pro"
        type="button"
        onPointerDown={event => {
          if (document.activeElement === textRef.current) {
            keepKeyboardAfterSendRef.current = true;
            event.preventDefault();
          }
        }}
        onClick={() => void submit()}
        aria-label={uiText("Send")}
      ><Send size={18}/></button> : <button className={recording ? "send stop-recording" : "composer-icon mic-button"} onClick={() => void toggleRecording()} disabled={busy || Boolean(pendingFile) || Boolean(voiceDraft)} aria-label={recording ? uiText("Stop recording") : uiText("Record voice note")}>{recording ? <Square size={16} fill="currentColor"/> : <Mic size={22}/>}</button>}
    </div>
  </div>;
}
function UploadProgress({ value }: { value: number }) {
  const { t: uiText } = useLanguage();

  return <div className="media-upload-progress" role="progressbar" aria-label={uiText("Upload progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{ width: `${value}%` }}/></div>;
}
