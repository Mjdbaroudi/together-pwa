"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeft, Video, VideoOff, Mic, MicOff, Minimize2, Phone, PhoneOff, Volume2, Waves, X } from "lucide-react";
import { useVoiceCalls } from "@/components/calls/VoiceCallsProvider";
import { useTogether } from "@/components/providers/TogetherProvider";
import { InitialAvatar } from "@/components/common/InitialAvatar";
import { partnerLabel } from "@/lib/together/contactPreferences";
import { VideoCallScreen } from "@/components/calls/VideoCallScreen";
import { callDuration } from "@/lib/calls/types";

export function VoiceCallPanel() {
  const { t: uiText } = useLanguage();

  const calls = useVoiceCalls(), { profile } = useTogether(), { view } = calls;
  const [now, setNow] = useState(Date.now()), [deviceError, setDeviceError] = useState("");
  useEffect(() => { if (!view.connectedAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [view.connectedAt]);
  useEffect(() => setDeviceError(""), [view.call?.id]);
  if (view.phase === "idle" || typeof document === "undefined") return null;
  const video = view.mediaKind === "video", mediaName = video ? "video" : "voice";
  const name = partnerLabel(profile), active = ["connected", "reconnecting"].includes(view.phase), incoming = view.phase === "incoming", finished = view.phase === "finished", elsewhere = view.phase === "elsewhere", permission = view.phase === "permission";
  const seconds = view.connectedAt ? Math.max(0, ((view.call?.ended_at ? new Date(view.call.ended_at).getTime() : now) - view.connectedAt) / 1000) : 0;
  const label = incoming ? `Incoming ${mediaName} call` : permission ? "Ready — tap below to allow access" : view.phase === "ringing" ? "Calling…" : view.phase === "preparing" ? "Getting your call ready…" : view.phase === "connecting" ? "Connecting your audio…" : view.phase === "reconnecting" ? "Reconnecting…" : elsewhere ? "Call open on another device" : finished ? view.notice || "Call ended" : callDuration(seconds);
  async function change(kind: "microphone" | "output", id: string) { setDeviceError(""); try { await calls[kind](id); } catch (error: unknown) { setDeviceError(error instanceof Error ? error.message : "Could not change this device."); } }
  if (calls.minimized && (active || elsewhere)) return createPortal(<div className="voice-call-mini" role="region" aria-label={uiText("Active {0} call", [uiText(mediaName)])}><button onClick={calls.expand}><span className="voice-mini-dot"/>{video && (view.cameraOn ? <Video size={17} aria-label={uiText("Camera is on")}/> : <VideoOff size={17} aria-label={uiText("Camera is off")}/>)}<span dir="auto">{name}</span><b>{elsewhere ? uiText("On another device") : view.phase === "reconnecting" ? uiText("Reconnecting…") : callDuration(seconds)}</b>{view.muted && <MicOff size={16}/>}</button>{!elsewhere && <button aria-label={uiText("End call")} onClick={calls.end}><PhoneOff size={19}/></button>}</div>, document.body);
  if (video && active) return <VideoCallScreen label={label}/>;
  return createPortal(<div className="voice-call-backdrop"><section className="voice-call-panel" role="dialog" aria-modal="true" aria-label={incoming ? uiText("Incoming {0} call", [uiText(mediaName)]) : video ? uiText("Video call") : uiText("Voice call")}>
    <header><span>{video ? <Video size={18}/> : <Waves size={18}/>} {video ? uiText("TOGETHER VIDEO") : uiText("TOGETHER VOICE")}</span>{active && <button aria-label={uiText("Close")} title={uiText("Minimize call")} onClick={calls.minimize}><Minimize2 size={21}/></button>}{(finished || elsewhere) && <button aria-label={uiText("Close")} onClick={elsewhere ? calls.minimize : calls.dismiss}><X size={22}/></button>}</header>
    <div className="voice-call-panel-body">
    <div className={`voice-call-person ${incoming || view.phase === "ringing" ? "ringing" : ""}`}><InitialAvatar name={name} src={profile.partnerAvatarUrl} size={112}/><h2 dir="auto">{name}</h2><p role="status" className="voice-call-status">{uiText(label)}</p>{active && <div className={`voice-call-wave ${view.muted ? "muted" : ""}`} aria-hidden="true">{[1,2,3,4,5].map(index => <i key={index}/>)}</div>}<span className="voice-call-private">{video ? uiText("Private video") : uiText("Private audio")}{uiText(" · no recording")}</span></div>
    {view.cameraError && <p className="voice-call-notice error" role="alert">{uiText(view.cameraError)}</p>}
    {view.error && <p className="voice-call-notice error" role="alert">{uiText(view.error)}</p>}
    {view.permissionBlocked && <details className="call-permission-help"><summary>{uiText("كيف أفعّل الميكروفون والكاميرا؟")}</summary><p>{uiText("على الآيفون: افتح رابط التطبيق نفسه في Safari، ومن قائمة الصفحة افتح إعدادات الموقع واجعل الميكروفون والكاميرا «سماح» أو «سؤال». راجع أيضًا إعدادات الجهاز ← التطبيقات ← Safari. بعدها أغلق التطبيق وافتحه وجرّب مجددًا، دون حذف بياناته.")}</p><p>{uiText("على أندرويد: افتح أذونات الموقع في Chrome وتأكد من السماح بالميكروفون والكاميرا. إذا كان الرابط مفتوحًا داخل تطبيق آخر، افتحه مباشرة في Safari أو Chrome.")}</p><p>{uiText("التطبيق لا يستطيع تجاوز إذن محظور من إعدادات الجهاز. للفيديو يمكنك الرد بالصوت فقط.")}</p></details>}
    {permission && <p className="voice-call-notice" role="status">{uiText("Your connection is ready. Access starts only when you tap Continue. Nothing is recorded.")}</p>}
    {view.notice && !finished && <p className="voice-call-notice" role="status">{uiText(view.notice)}</p>}
    {view.playbackBlocked && <button className="voice-play-audio" onClick={calls.play}><Volume2 size={19}/>{uiText("Tap to hear your partner")}</button>}
    {active && <div className="voice-call-devices">{view.quality !== "unknown" && <span className={`voice-quality ${view.quality}`}>{view.quality === "good" ? uiText("Connection good") : uiText("Connection weak")}</span>}<div>{calls.devices.filter(device => device.kind === "audioinput").length > 1 && <label>{uiText("Microphone")}<select aria-label={uiText("Microphone")} defaultValue="default" onChange={event => void change("microphone", event.target.value)}>{calls.devices.filter(device => device.kind === "audioinput").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || uiText("Microphone {0}", [index + 1])}</option>)}</select></label>}{calls.outputSupported && calls.devices.some(device => device.kind === "audiooutput") ? <label>{uiText("Audio output")}<select aria-label={uiText("Audio output")} defaultValue="default" onChange={event => void change("output", event.target.value)}>{calls.devices.filter(device => device.kind === "audiooutput").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || uiText("Output {0}", [index + 1])}</option>)}</select></label> : <p>{uiText("Use your device controls for speaker or Bluetooth.")}</p>}</div>{deviceError && <p role="alert">{uiText(deviceError)}</p>}</div>}
    </div>
    <div className="voice-call-actions">
      {permission ? <><button className="voice-done" onClick={calls.continuePermission}>{uiText("Continue · allow access")}</button><button className="voice-done" onClick={calls.end}>{uiText("Cancel")}</button></> : incoming ? <>
        <button className="voice-action decline" onClick={calls.end}><span><PhoneOff size={27}/></span>{uiText("Decline")}</button>
        <button className="voice-action accept" onClick={() => calls.accept()}><span>{video ? <Video size={27}/> : <Phone size={27}/>}</span>{video ? uiText("Answer video") : uiText("Answer")}</button>
      </> : finished ? <>{view.error && !view.call && <button className="voice-done" onClick={() => calls.start(view.mediaKind)}>{uiText("Retry")}</button>}<button className="voice-done" onClick={calls.dismiss}>{uiText("Done")}</button></> : elsewhere ? <p>{uiText("Your call will stay on that device.")}</p> : <>
        {active && <button className={`voice-action mute ${view.muted ? "selected" : ""}`} aria-pressed={view.muted} onClick={calls.mute}><span>{view.muted ? <MicOff size={25}/> : <Mic size={25}/>}</span>{view.muted ? uiText("Unmute") : uiText("Mute")}</button>}
        <button className="voice-action decline" onClick={calls.end}><span><PhoneOff size={27}/></span>{["preparing", "ringing"].includes(view.phase) ? uiText("Cancel") : uiText("End call")}</button>
      </>}
    </div>
    {incoming && video && <button className="voice-answer-audio" onClick={() => calls.accept(false)}><Phone size={17}/>{uiText("Answer with audio only")}</button>}
    {incoming && <p className="voice-call-footer"><ArrowDownLeft size={15}/>{video ? uiText("Camera access starts only when you answer with video.") : uiText("Microphone access starts when you answer.")}</p>}
  </section></div>, document.body);
}
