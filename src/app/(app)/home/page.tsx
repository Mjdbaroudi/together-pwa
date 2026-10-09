"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { callLabel, callRecordedDuration } from "@/lib/calls/journal";
import Link from "next/link";
import {useMemo,useState} from "react";
import {ArrowRight,CalendarHeart,Camera,Heart,MessageCircle,Pin,Sparkles,X} from "lucide-react";
import {ProfileAvatar} from "@/components/common/ProfileAvatar";
import {PresenceLabel} from "@/components/common/PresenceLabel";
import {partnerLabel} from "@/lib/together/contactPreferences";
import {PageHeading} from "@/components/common/PageHeading";
import {useTogether} from "@/components/providers/TogetherProvider";
import {daysSince,formatDateOnly,nextAnniversary} from "@/lib/date";
import {errorMessage} from "@/lib/errors";
import dynamic from "next/dynamic";
import {Overlay} from "@/components/common/Overlay";
import {SpecialDatesSection} from "@/components/story/SpecialDatesSection";
import {TodayCelebration} from "@/components/story/TodayCelebration";
import {useStoryCover,useStoryDay} from "@/hooks/useStoryCover";
const StoryCoverDialog=dynamic(()=>import("@/components/story/StoryCoverDialog"));
import {FaithSection} from "@/components/faith/FaithSection";
import type {Message} from "@/lib/types";
function preview(message:Message|undefined,t:(text:string)=>string){if(!message)return t("A little hello can make their day.");if(message.deletedAt)return t("This message was deleted");if(message.callSummary){const call=message.callSummary;return `${t(callLabel(call,message.sender === "partner" ? call.callee_id : call.caller_id))}${callRecordedDuration(call) ? ` · ${callRecordedDuration(call)}` : ""}`;}return message.body||t(message.type==="image"?"Photo":message.type==="video"?"Video":message.type==="voice"?"Voice note":"Message");}
export default function HomePage(){
  const { t: uiText, locale } = useLanguage();

 const {profile,memories,dates,messages,unreadCount,updateFirstMeetingDate,removeStoryPhoto}=useTogether();
 const [open,setOpen]=useState(false),[meetingDate,setMeetingDate]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [coverOpen,setCoverOpen]=useState(false);
 const storyDay=useStoryDay();
 const partner=partnerLabel(profile),me=profile.myNickname||profile.myName||"you";
 const last=messages[messages.length-1],pinned=[...messages].reverse().find(m=>m.pinned&&!m.deletedAt);
 const next=useMemo(()=>[...dates].filter(item=>!item.specialType&&new Date(item.date).getTime()>=Date.now()).sort((a,b)=>+new Date(a.date)-+new Date(b.date))[0],[dates,storyDay.local]);
 const days=daysSince(profile.anniversary),anniversary=nextAnniversary(profile.anniversary);
 const cover=useStoryCover(profile,memories,storyDay.utc),photo=cover.url;
 async function saveDate(){setBusy(true);setError("");try{await updateFirstMeetingDate(meetingDate||undefined);setOpen(false);}catch(error:unknown){setError(errorMessage(error));}finally{setBusy(false);}}
 async function removePhoto(){setBusy(true);setError("");try{await removeStoryPhoto();}catch(error:unknown){setError(errorMessage(error));}finally{setBusy(false);}}
 return <div className="home-experience">
  <PageHeading eyebrow={uiText("YOUR PRIVATE SPACE")} title={uiText("Hello, {0}.", [me])} description={uiText("A place for everything that brings you closer.")} action={<span className="home-heart" aria-hidden="true"><Heart size={24}/></span>}/>
  {error&&!open&&<p className="notice error" role="alert">{uiText(error)}</p>}
  <TodayCelebration key={`celebration-${profile.myUserId}:${profile.coupleId}`} dates={dates} profile={profile} day={storyDay.local}/>
  <section className="conversation-hero" aria-label={uiText("Your conversation")}>
   <div className="conversation-hero-top"><span className="eyebrow">{uiText("YOUR CONVERSATION")}</span><span className="hero-presence"><PresenceLabel online={profile.partnerOnline} lastSeen={profile.lastSeen} error={profile.presenceError}/></span></div>
   <div className="conversation-hero-person"><ProfileAvatar name={partner} src={profile.partnerAvatarUrl} path={profile.partnerAvatarPath} size={58}/><Link href="/chat" className="conversation-hero-link"><h2 dir="auto">{partner}</h2><p dir="auto">{preview(last,uiText)}</p></Link>{unreadCount>0&&<span className="hero-unread">{unreadCount>99?"99+":unreadCount}</span>}</div>
   <Link href="/chat" className="conversation-hero-bottom"><span><MessageCircle size={18}/>{unreadCount?uiText("{0} unread {1}", [unreadCount, uiText(unreadCount===1?"message":"messages")]):uiText("Open your conversation")}</span><ArrowRight size={21}/></Link>
  </section>
  <div className="home-content-grid">
   <section className="story-card"><div className="story-card-photo">{photo?<><img src={photo} alt={uiText("Your shared story")}/>{profile.storyCoverMode&&profile.storyCoverMode!=="fixed"&&<span className="story-cover-info">{uiText("A photo for today")}</span>}</>:<div className="story-placeholder"><Heart size={40}/><span>{uiText("Your story,")}<br/>{uiText("your favorite photo.")}</span></div>}<button className="story-photo-button" disabled={busy} onClick={()=>setCoverOpen(true)} aria-label={uiText("Choose story cover")}><Camera size={18}/></button></div><div className="story-card-copy"><span className="eyebrow">{uiText("OUR STORY")}</span><strong>{days??"—"}</strong><span>{uiText("days together")}</span><button className="text-button" onClick={()=>{setMeetingDate(profile.anniversary||"");setError("");setOpen(true);}}><CalendarHeart size={15}/>{profile.anniversary?formatDateOnly(profile.anniversary,locale):uiText("Set your first date")}</button>{anniversary&&<small>{anniversary.days===0?uiText("Happy anniversary ♥"):uiText("{0} days to your anniversary", [anniversary.days])}</small>}</div></section>
   <section className="home-next-section"><div className="experience-section-heading"><h2>{uiText("Something to look forward to")}</h2><Link href="/moments">{uiText("View all ")}<ArrowRight size={14}/></Link></div><Link href="/moments" className="next-moment-card"><span className="icon-chip"><CalendarHeart size={24}/></span><div><span className="eyebrow">{next?uiText("UP NEXT"):uiText("MAKE A PLAN")}</span><h3>{next?.title||uiText("Your next little adventure")}</h3><p>{next?new Date(next.date).toLocaleDateString(locale,{weekday:"long",month:"short",day:"numeric"}):uiText("Dinner, a call, or a day together.")}</p></div><ArrowRight size={19}/></Link></section>
  </div>
  <SpecialDatesSection key={`special-${profile.myUserId}`} compact/>
  <section><div className="experience-section-heading"><h2>{uiText("Keep the good moments")}</h2><Link href="/memories">{uiText("Your album ")}<ArrowRight size={14}/></Link></div>{memories.length?<div className="home-album-strip">{memories.slice(0,3).map(item=><Link href="/memories" key={item.id} className="home-album-item">{item.kind==="video"?<video src={item.src} muted playsInline preload="metadata"/>:<img src={item.src} alt={item.caption} loading="lazy"/>}<span dir="auto">{item.caption}</span></Link>)}</div>:<Link href="/memories" className="album-empty-card"><span className="icon-chip"><Sparkles size={23}/></span><div><h3>{uiText("Your first memory belongs here.")}</h3><p>{uiText("Add a photo or video to your shared album.")}</p></div><ArrowRight size={20}/></Link>}</section>
  {pinned&&<Link href="/chat" className="home-pinned"><Pin size={17}/><div><span className="eyebrow">{uiText("KEPT CLOSE")}</span><p dir="auto">{preview(pinned,uiText)}</p></div><ArrowRight size={17}/></Link>}
  <FaithSection/>
  {coverOpen&&<StoryCoverDialog key={`cover-${profile.myUserId}`} onClose={()=>setCoverOpen(false)}/>}
  {open&&<Overlay><section className="modal"><button className="dialog-close" aria-label={uiText("Close")} disabled={busy} onClick={()=>setOpen(false)}><X size={20}/></button><span className="eyebrow">{uiText("OUR STORY")}</span><h2>{uiText("Where it all began")}</h2><p className="hint">{uiText("Choose the date that starts your days-together counter.")}</p>{error&&<p className="notice error" role="alert">{uiText(error)}</p>}<label className="field-label" htmlFor="meeting-date">{uiText("First meeting date")}</label><input id="meeting-date" className="input" type="date" value={meetingDate} max={new Date().toISOString().slice(0,10)} onChange={e=>setMeetingDate(e.target.value)}/>{profile.storyPhotoUrl&&<button className="text-button" disabled={busy} onClick={()=>void removePhoto()}>{uiText("Remove shared photo")}</button>}<div className="modal-actions"><button className="soft-btn secondary" disabled={busy} onClick={()=>setOpen(false)}>{uiText("Cancel")}</button><button className="soft-btn" disabled={busy} onClick={()=>void saveDate()}>{busy?uiText("Saving…"):uiText("Save date")}</button></div></section></Overlay>}
 </div>;
}
