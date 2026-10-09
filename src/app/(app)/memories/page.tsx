"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import {Heart,Image as ImageIcon,Plus,Search,Video as VideoIcon,X} from "lucide-react";
import {useRef,useState} from "react";
import {MemoryViewer} from "@/components/memories/MemoryViewer";
import {MemoryUploadDialog} from "@/components/memories/MemoryUploadDialog";
import {PageHeading} from "@/components/common/PageHeading";
import {useTogether} from "@/components/providers/TogetherProvider";
import {errorMessage} from "@/lib/errors";
import {MAX_MEMORY_BATCH,validateMemoryFile} from "@/lib/story";
export default function MemoriesPage(){
  const { t: uiText, locale } = useLanguage();

 const {profile,memories,toggleFavorite,deleteMemory,hasOlderMemories,loadingOlderMemories,loadOlderMemories}=useTogether();
 const [selected,setSelected]=useState<string|null>(null),[tab,setTab]=useState<"all"|"photos"|"videos"|"favorites">("all"),[query,setQuery]=useState(""),[error,setError]=useState("");
 const [pending,setPending]=useState<{owner?:string;files:File[]}|null>(null);const input=useRef<HTMLInputElement>(null);
 const shown=memories.filter(m=>(tab==="all"||tab==="favorites"&&m.favorite||tab==="videos"&&m.kind==="video"||tab==="photos"&&m.kind!=="video")&&m.caption.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const groups=shown.reduce<Record<string,typeof shown>>((acc,m)=>{const key=new Date(m.date).toLocaleDateString(locale,{month:"long",year:"numeric"});(acc[key]??=[]).push(m);return acc;},{});
 function choose(files:File[]){if(!files.length)return;if(files.length>MAX_MEMORY_BATCH){setError(`Choose up to ${MAX_MEMORY_BATCH} files per batch.`);return;}const invalid=files.find(f=>validateMemoryFile(f));if(invalid){setError(`${invalid.name}: ${validateMemoryFile(invalid)}`);return;}setError("");setPending({owner:profile.myUserId,files});}
 const current=memories.find(m=>m.id===selected);
 return <div className="memories-experience">
  <PageHeading eyebrow={uiText("YOUR SHARED ALBUM")} title={uiText("Good moments, kept.")} description={uiText("Photos, videos, and little things worth remembering.")} action={<button className="soft-btn compact-action" aria-label={uiText("Add memory")} onClick={()=>input.current?.click()}><Plus size={18}/><span>{uiText("Add memories")}</span></button>}/>
  <input ref={input} hidden type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime" onChange={e=>{choose(Array.from(e.target.files||[]));e.target.value="";}}/>
  {error&&<p className="notice error" role="alert">{uiText(error)}</p>}
  <div className="album-toolbar"><div className="experience-segments" aria-label={uiText("Album filter")}>{([['all','All'],['photos','Photos'],['videos','Videos'],['favorites','Favorites']] as const).map(([id,label])=><button key={id} aria-pressed={tab===id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{uiText(label)}</button>)}</div><label className="experience-search"><Search size={18}/><input aria-label={uiText("Search memories")} value={query} onChange={e=>setQuery(e.target.value)} placeholder={uiText("Find a memory")}/>{query&&<button onClick={()=>setQuery("")} aria-label={uiText("Clear search")}><X size={16}/></button>}</label></div>
  {Object.entries(groups).map(([month,items])=><section key={month}><div className="experience-section-heading"><h2>{month}</h2><span>{items.length} {items.length===1?uiText("moment"):uiText("moments")}</span></div><div className="experience-gallery">{items.map(m=><article className="album-tile" key={m.id}><button className="album-open" onClick={()=>setSelected(m.id)} aria-label={uiText("Open {0}", [m.caption])}>{m.kind==="video"?<><video src={m.src} muted playsInline preload="metadata"/><span className="album-video"><VideoIcon size={16}/>{uiText("Video")}</span></>:<img src={m.src} alt={m.caption} loading="lazy"/>}<div className="album-caption"><strong dir="auto">{m.caption}</strong><small>{new Date(m.date).toLocaleDateString(locale,{month:"short",day:"numeric"})}</small></div></button><button className={`album-favorite ${m.favorite?"active":""}`} aria-label={m.favorite?uiText("Remove favorite"):uiText("Add favorite")} aria-pressed={m.favorite} onClick={()=>void toggleFavorite(m.id).catch(error=>setError(errorMessage(error)))}><Heart size={18} fill={m.favorite?"currentColor":"none"}/></button></article>)}</div></section>)}
  {!shown.length&&<div className="experience-empty"><span className="empty-icon"><ImageIcon size={30}/></span><h2>{memories.length?uiText("No matching moments"):uiText("Every story starts somewhere.")}</h2><p>{memories.length?uiText("Try another filter or search, or load earlier memories."):uiText("Keep your first photo or video in one place, together.")}</p><button className="soft-btn" onClick={()=>{if(memories.length){setQuery("");setTab("all");}else input.current?.click();}}>{memories.length?uiText("Show all memories"):uiText("Add your first memories")}</button></div>}
  {hasOlderMemories&&<button className="soft-btn secondary load-more-button" disabled={loadingOlderMemories} onClick={()=>void loadOlderMemories().catch(error=>setError(errorMessage(error)))}>{loadingOlderMemories?uiText("Loading…"):uiText("Load earlier memories")}</button>}
  {pending&&pending.owner===profile.myUserId&&<MemoryUploadDialog key={pending.owner} files={pending.files} onClose={()=>setPending(null)}/>}
  {current&&<MemoryViewer memory={current} onClose={()=>setSelected(null)} onFavorite={()=>toggleFavorite(current.id)} onDelete={async()=>{await deleteMemory(current.id);setSelected(null);}}/>}
 </div>;
}
