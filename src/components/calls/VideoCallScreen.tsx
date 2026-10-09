"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useEffect,useRef,useState } from "react";
import { createPortal } from "react-dom";
import { Mic,MicOff,Minimize2,PhoneOff,Settings2,SwitchCamera,Video,VideoOff,X,Maximize2,Move } from "lucide-react";
import { useVoiceCalls } from "@/components/calls/VoiceCallsProvider";
import { useTogether } from "@/components/providers/TogetherProvider";
import { InitialAvatar } from "@/components/common/InitialAvatar";
import { partnerLabel } from "@/lib/together/contactPreferences";
import { CallVideo } from "@/components/calls/CallVideo";

export function VideoCallScreen({ label }: { label:string }) {
  const { t: uiText } = useLanguage();

  const calls=useVoiceCalls(),{profile}=useTogether(),{view}=calls;
  const [visible,setVisible]=useState(true),[settings,setSettings]=useState(false),[fit,setFit]=useState(false),[corner,setCorner]=useState(0),[interaction,setInteraction]=useState(0),[deviceError,setDeviceError]=useState("");
  const tools=useRef<HTMLDivElement>(null),surface=useRef<HTMLButtonElement>(null),settingsButton=useRef<HTMLButtonElement>(null);
  const warning=view.cameraError||view.error||view.notice||view.playbackBlocked;
  function reveal(){setVisible(true);setInteraction(value=>value+1);}
  function toggle(){if(!settings&&!warning){setVisible(value=>!value);setInteraction(value=>value+1);}}
  function closeSettings(){setSettings(false);reveal();setTimeout(()=>settingsButton.current?.focus({preventScroll:true}),0);}
  useEffect(()=>{if(warning)reveal();},[warning]);
  useEffect(()=>{
    if(!visible||settings||warning)return;
    let timer:ReturnType<typeof setTimeout>;
    const hide=()=>{if(tools.current?.contains(document.activeElement)){timer=setTimeout(hide,2000);return;}setVisible(false);};
    timer=setTimeout(hide,5000);return ()=>clearTimeout(timer);
  },[visible,settings,interaction,warning]);
  useEffect(()=>{
    const meta=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'),old=meta?.content;if(meta)meta.content="#101016";
    return ()=>{if(meta&&old!==undefined)meta.content=old;};
  },[]);
  async function device(kind:"microphone"|"output",id:string){setDeviceError("");try{await calls[kind](id);}catch(error){setDeviceError(error instanceof Error?error.message:"Could not change this device.");}}
  const name=partnerLabel(profile);
  return createPortal(<section className={`video-call-fullscreen ${visible?"controls-visible":""} ${fit?"fit-video":""}`} role="dialog" aria-modal="true" aria-label={uiText("Video call")}>
    <div className={`fullscreen-remote ${view.remoteCameraOn?"":"camera-off"}`}><CallVideo stream={view.remoteVideo} label={uiText("Partner video")}/>{(!view.remoteVideo||!view.remoteCameraOn)&&<div className="fullscreen-camera-placeholder"><InitialAvatar name={name} src={profile.partnerAvatarUrl} size={104}/><h2 dir="auto">{name}</h2><p>{uiText("Partner camera is off")}</p></div>}</div>
    <button ref={surface} className="video-touch-surface" aria-label={visible?uiText("Hide call controls"):uiText("Show call controls")} onClick={toggle}/>
    <div className={`fullscreen-self corner-${corner}`}><CallVideo stream={view.localVideo} label={uiText("Your video")} mirror={view.cameraFacing==="user"}/>{!view.cameraOn&&<span><VideoOff size={22}/>{uiText("Camera off")}</span>}<small>{uiText("You")}</small><button aria-label={uiText("Move your preview")} onClick={()=>{setCorner(value=>(value+1)%4);reveal();}}><Move size={14}/></button></div>
    <div ref={tools} className="video-call-controls" aria-hidden={!visible} inert={!visible} onPointerDown={reveal} onKeyDown={reveal}>
      <header className="fullscreen-call-header"><button aria-label={uiText("Close")} title={uiText("Minimize call")} onClick={calls.minimize}><Minimize2 size={22}/></button><div><h2 dir="auto">{name}</h2><p role="status">{uiText(label)}{view.muted&&<MicOff size={12}/>}</p></div><button ref={settingsButton} aria-label={uiText("Call settings")} aria-expanded={settings} onClick={()=>setSettings(true)}><Settings2 size={22}/></button></header>
      <div className="fullscreen-call-bottom">
        {warning&&<div className="fullscreen-call-warning" role={view.error||view.cameraError?"alert":"status"}>{uiText(view.cameraError||view.error||view.notice)}{view.playbackBlocked&&<button onClick={calls.play}>{uiText("Tap to hear your partner")}</button>}</div>}
        <span className={`fullscreen-call-quality ${view.quality}`}>{view.phase==="reconnecting"?uiText("Reconnecting…"):view.quality==="weak"?uiText("Connection weak"):view.quality==="good"?uiText("Connection good"):uiText("Private video · no recording")}</span>
        <div className="fullscreen-call-actions"><button aria-pressed={view.muted} onClick={calls.mute}><span>{view.muted?<MicOff size={25}/>:<Mic size={25}/>}</span>{view.muted?uiText("Unmute"):uiText("Mute")}</button><button aria-pressed={view.cameraOn} disabled={view.cameraBusy} onClick={calls.camera}><span>{view.cameraOn?<Video size={25}/>:<VideoOff size={25}/>}</span>{view.cameraBusy?uiText("Opening…"):view.cameraOn?uiText("Camera off"):uiText("Camera on")}</button><button disabled={!view.cameraOn||view.cameraBusy} onClick={calls.switchCamera}><span><SwitchCamera size={25}/></span>{uiText("Switch camera")}</button><button className="fullscreen-end" onClick={calls.end}><span><PhoneOff size={26}/></span>{uiText("End call")}</button></div>
      </div>
    </div>
    {!visible&&<span className="video-tap-hint" aria-hidden="true">{uiText("Tap to show controls")}</span>}
    {settings&&<div className="video-settings-backdrop" onClick={event=>{if(event.target===event.currentTarget)closeSettings();}}><section className="video-settings-sheet" role="dialog" aria-modal="true" aria-label={uiText("Call settings")}><header><h2>{uiText("Call settings")}</h2><button aria-label={uiText("Close")} onClick={closeSettings}><X size={22}/></button></header><button className="video-fit-control" aria-pressed={fit} onClick={()=>setFit(value=>!value)}><Maximize2 size={20}/><span>{fit?uiText("Fill screen"):uiText("Fit entire video")}<small>{fit?uiText("Fill the screen, cropping the edges"):uiText("Show the whole image without cropping")}</small></span></button>
      {calls.devices.filter(d=>d.kind==="audioinput").length>1&&<label>{uiText("Microphone")}<select aria-label={uiText("Microphone")} defaultValue="default" onChange={event=>void device("microphone",event.target.value)}>{calls.devices.filter(d=>d.kind==="audioinput").map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||uiText("Microphone {0}", [i+1])}</option>)}</select></label>}
      {calls.outputSupported&&calls.devices.some(d=>d.kind==="audiooutput")?<label>{uiText("Audio output")}<select aria-label={uiText("Audio output")} defaultValue="default" onChange={event=>void device("output",event.target.value)}>{calls.devices.filter(d=>d.kind==="audiooutput").map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||uiText("Output {0}", [i+1])}</option>)}</select></label>:<p>{uiText("Use your device controls for speaker or Bluetooth.")}</p>}
      {deviceError&&<p role="alert">{uiText(deviceError)}</p>}<p className="video-settings-note">{uiText("Only your paired partner receives your camera. Turning it off releases the camera; your microphone stays available.")}</p>
    </section></div>}
  </section>,document.body);
}
