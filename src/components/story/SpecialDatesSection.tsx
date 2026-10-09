"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import Link from "next/link";
import { ArrowRight,CalendarHeart,Camera,Expand,ImagePlus,Plus,Pencil,Search,Trash2,X } from "lucide-react";
import { useEffect,useMemo,useRef,useState } from "react";
import { AppDialog } from "@/components/common/Overlay";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useTogether } from "@/components/providers/TogetherProvider";
import { errorMessage } from "@/lib/errors";
import { SPECIAL_TYPES,dateOnlyLabel,localCalendarDate,orderedSpecialDates,specialDateLabel,validCalendarDate,validDatePhoto,type SpecialType } from "@/lib/story";
import type { ImportantDate } from "@/lib/types";
import { DatePhoto } from "./DatePhoto";
import dynamic from "next/dynamic";
const DatePhotoViewer=dynamic(()=>import("./DatePhotoViewer").then(module=>module.DatePhotoViewer),{ssr:false});

export function SpecialDatesSection({compact=false}:{compact?:boolean}){
  const {t:uiText,locale}=useLanguage();
  const {dates,memories,hasOlderMemories,loadingOlderMemories,loadOlderMemories,addDate,updateDate,deleteDate,profile}=useTogether();
  const [open,setOpen]=useState(false),[editing,setEditing]=useState<ImportantDate|null>(null),[deleting,setDeleting]=useState<ImportantDate|null>(null),[viewing,setViewing]=useState<ImportantDate|null>(null);
  const owner=`${profile.myUserId||''}:${profile.coupleId}`;
  const [photoViewing,setPhotoViewing]=useState<{item:ImportantDate;owner:string}|null>(null);
  const activePhoto=photoViewing?.owner===owner?dates.find(item=>item.id===photoViewing.item.id&&item.photoPath===photoViewing.item.photoPath):undefined;
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[query,setQuery]=useState("");
  const [type,setType]=useState<SpecialType>("engagement"),[title,setTitle]=useState(""),[date,setDate]=useState(""),[notes,setNotes]=useState(""),[repeat,setRepeat]=useState(true),[today,setToday]=useState(localCalendarDate);
  const [file,setFile]=useState<File|undefined>(),[photoPath,setPhotoPath]=useState(""),[preview,setPreview]=useState(""),[albumOpen,setAlbumOpen]=useState(false),[draftId,setDraftId]=useState("");
  const fileInput=useRef<HTMLInputElement>(null),saving=useRef(false);
  useEffect(()=>{const update=()=>{if(document.visibilityState==="visible")setToday(localCalendarDate());};const timer=setInterval(update,60000);document.addEventListener("visibilitychange",update);return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",update);};},[]);
  useEffect(()=>{if(!file){setPreview("");return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  const special=useMemo(()=>orderedSpecialDates(dates),[dates]);
  const filtered=useMemo(()=>{const needle=query.trim().toLocaleLowerCase();return needle?special.filter(d=>[d.title,d.notes,d.localDate].some(value=>value?.toLocaleLowerCase().includes(needle))):special;},[special,query]);
  const shown=compact?special.slice(0,3):filtered;
  const photos=memories.filter(m=>m.kind==='image'&&m.mediaPath);
  function show(item?:ImportantDate){setViewing(null);setEditing(item||null);setDraftId(item?.id||crypto.randomUUID());setType(item?.specialType||"engagement");setTitle(item?.title||"");setDate(item?.localDate||"");setNotes(item?.notes||"");setRepeat(item?Boolean(item.repeatsYearly):true);setPhotoPath(item?.photoPath||"");setFile(undefined);setAlbumOpen(false);setError("");setOpen(true);}
  function close(){if(saving.current)return;setOpen(false);setFile(undefined);}
  async function save(){
    if(saving.current)return;if(!validCalendarDate(date)){setError("Choose a valid date.");return;}
    saving.current=true;setBusy(true);setError("");
    const input:Omit<ImportantDate,"id">={title:title.trim()||uiText(SPECIAL_TYPES.find(t=>t.id===type)!.label),date:`${date}T12:00:00Z`,kind:"milestone",notes:notes.trim()||undefined,localDate:date,repeatsYearly:repeat,specialType:type,photoPath};
    try{if(editing)await updateDate(editing.id,input,file);else await addDate(input,file,draftId);setOpen(false);setFile(undefined);}
    catch(error){const text=errorMessage(error);setError(/photo_path|local_date|special_type|repeats_yearly|schema cache/i.test(text)?"Apply database update 015, then try again.":text);}
    finally{saving.current=false;setBusy(false);}
  }
  function chooseFile(value?:File){if(!value)return;if(!validDatePhoto(value)){setError("Choose an image smaller than 15 MB.");return;}setError("");setFile(value);setAlbumOpen(false);}
  function openPhoto(item:ImportantDate){if(item.photoPath)setPhotoViewing({item,owner});else setViewing(item);}
  function card(item:ImportantDate){return <article className="special-date-card timeline-date-card" key={item.id} data-date={item.localDate}>
    <button className={`date-card-photo ${item.photoPath?'has-photo':''}`} onClick={()=>openPhoto(item)} aria-label={uiText(item.photoPath?"Open full photo for {0}":"View {0}",[item.title])}><DatePhoto path={item.photoPath} alt=""/>{item.photoPath&&<span className="date-photo-expand" aria-hidden="true"><Expand size={13}/></span>}</button>
    <div className="date-card-copy"><span className="kind-label">{uiText(SPECIAL_TYPES.find(t=>t.id===item.specialType)!.label)}</span><h3><button dir="auto" onClick={()=>setViewing(item)}>{item.title}</button></h3><time dateTime={item.localDate}>{dateOnlyLabel(item.localDate!,locale)}</time><strong>{specialDateLabel(item,today,locale)}</strong>{!compact&&item.notes&&<p className="date-card-note" dir="auto">{item.notes}</p>}</div>
    <div className="special-date-actions"><button aria-label={uiText("Edit {0}",[item.title])} onClick={()=>show(item)}><Pencil size={16}/></button><button aria-label={uiText("Delete {0}",[item.title])} onClick={()=>setDeleting(item)}><Trash2 size={16}/></button></div>
  </article>;}
  return <section className={`special-dates-section dates-v36 ${compact?'is-compact':'is-full'}`} id="our-dates" aria-labelledby="our-dates-heading">
    <div className="experience-section-heading"><div><span className="eyebrow">{uiText("CHAPTERS OF US")}</span><h2 id="our-dates-heading">{uiText("Our special dates")}</h2></div><button className="text-button" onClick={()=>show()}><Plus size={17}/>{uiText("Add a special date")}</button></div>
    {!compact&&<><p className="date-timeline-intro">{uiText("From our first chapter to the next. Oldest to newest.")}</p>{special.length>3&&<label className="date-timeline-search"><Search size={17}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={uiText("Find a date, a year, or a memory…")} aria-label={uiText("Search our dates")}/>{query&&<button aria-label={uiText("Clear search")} onClick={()=>setQuery("")}><X size={17}/></button>}</label>}</>}
    {shown.length?(compact?<div className="special-date-list">{shown.map(card)}</div>:<div className="date-timeline">{Array.from(new Set(shown.map(d=>d.localDate!.slice(0,4)))).map(year=><section className="date-year-group" key={year} aria-label={uiText("Year {0}",[year])}><h3 className="date-year">{year}</h3><div className="special-date-list">{shown.filter(d=>d.localDate!.startsWith(year)).map(card)}</div></section>)}</div>):special.length?<p className="date-no-results">{uiText("No dates match this search.")}</p>:<button className="album-empty-card date-empty" onClick={()=>show()}><span className="icon-chip"><CalendarHeart size={25}/></span><div><h3>{uiText("Every date tells a part of our story")}</h3><p>{uiText("Keep your engagement, wedding, first meeting, and the days that matter.")}</p></div><Plus size={20}/></button>}
    {compact&&special.length>0&&<Link className="date-view-all" href="/moments#our-dates"><span>{uiText("View all dates")}<small>{special.length}</small></span><ArrowRight size={18}/></Link>}
    {open&&<AppDialog key={`${profile.myUserId}-${draftId}`} title={editing?uiText("Edit this memory"):uiText("A date worth remembering")} eyebrow={uiText("OUR SPECIAL DATES")} busy={busy} onClose={close} footer={<><button className="soft-btn secondary" disabled={busy} onClick={close}>{uiText("Cancel")}</button><button className="soft-btn" type="submit" form="special-date-form" disabled={busy}>{busy?uiText("Saving…"):uiText("Save date")}</button></>}>
      <form id="special-date-form" className="milestone-form" onSubmit={e=>{e.preventDefault();void save();}}>{error&&<p className="notice error" role="alert">{uiText(error)}</p>}
      <div className="date-photo-editor"><DatePhoto path={file?undefined:photoPath} src={preview} alt={uiText("Date photo preview")}/><div><strong>{uiText("A photo for this chapter")}</strong><p>{uiText("Choose from Memories or upload a photo. Your album stays unchanged.")}</p><div className="date-photo-buttons"><button type="button" disabled={busy} onClick={()=>fileInput.current?.click()}><Camera size={16}/>{uiText("Upload photo")}</button><button type="button" disabled={busy} onClick={()=>setAlbumOpen(v=>!v)} aria-expanded={albumOpen}><ImagePlus size={16}/>{uiText("Choose from Memories")}</button>{(file||photoPath)&&<button type="button" disabled={busy} onClick={()=>{setFile(undefined);setPhotoPath("");}}>{uiText("Remove photo")}</button>}</div></div></div>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={e=>{chooseFile(e.target.files?.[0]);e.target.value="";}}/>
      {albumOpen&&<div className="date-album-picker" role="group" aria-label={uiText("Choose a date photo")}>{photos.length?<div className="story-cover-grid">{photos.map(m=><button key={m.id} type="button" className="story-cover-choice" aria-label={uiText("Choose {0}",[m.caption])} aria-pressed={photoPath===m.mediaPath&&!file} onClick={()=>{setPhotoPath(m.mediaPath!);setFile(undefined);setAlbumOpen(false);}}><DatePhoto path={m.mediaPath} src={m.src} alt=""/><span dir="auto">{m.caption}</span></button>)}</div>:<p className="hint">{uiText("No album photos yet. Upload a photo instead.")}</p>}{hasOlderMemories&&<button type="button" className="text-button" disabled={loadingOlderMemories} onClick={()=>void loadOlderMemories().catch(e=>setError(errorMessage(e)))}>{loadingOlderMemories?uiText("Loading…"):uiText("Load earlier memories")}</button>}</div>}
      <label className="field-label" htmlFor="special-type">{uiText("Memory type")}</label><select id="special-type" className="input" value={type} disabled={busy} onChange={e=>setType(e.target.value as SpecialType)}>{SPECIAL_TYPES.map(t=><option key={t.id} value={t.id}>{uiText(t.label)}</option>)}</select>
      <label className="field-label" htmlFor="special-title">{uiText("A name for this date (optional)")}</label><input id="special-title" className="input" value={title} disabled={busy} maxLength={160} placeholder={uiText(SPECIAL_TYPES.find(t=>t.id===type)!.label)} onChange={e=>setTitle(e.target.value)}/>
      <label className="field-label" htmlFor="special-day">{uiText("Date")}</label><input id="special-day" className="input" type="date" required disabled={busy} value={date} onChange={e=>setDate(e.target.value)}/>
      <label className="milestone-repeat"><input type="checkbox" disabled={busy} checked={repeat} onChange={e=>setRepeat(e.target.checked)}/>{uiText("Celebrate this anniversary every year")}</label><p className="hint">{uiText("Shared between you. The original date never changes with your timezone.")}</p>
      <label className="field-label" htmlFor="special-notes">{uiText("Notes (optional)")}</label><textarea id="special-notes" className="input" rows={3} disabled={busy} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></form>
    </AppDialog>}
    {viewing&&<AppDialog title={viewing.title} eyebrow={uiText(SPECIAL_TYPES.find(t=>t.id===viewing.specialType)!.label)} onClose={()=>setViewing(null)} footer={<><button className="soft-btn secondary" onClick={()=>setViewing(null)}>{uiText("Close")}</button><button className="soft-btn" onClick={()=>show(viewing)}>{uiText("Edit")}</button></>}><div className="date-detail">{viewing.photoPath?<button type="button" className="date-detail-photo" onClick={()=>openPhoto(viewing)} aria-label={uiText("Open full photo for {0}",[viewing.title])}><DatePhoto large path={viewing.photoPath} alt=""/><span><Expand size={15}/>{uiText("Open full photo")}</span></button>:<DatePhoto large alt=""/>}<time dateTime={viewing.localDate}>{dateOnlyLabel(viewing.localDate!,locale)}</time><strong>{specialDateLabel(viewing,today,locale)}</strong>{viewing.notes&&<p dir="auto">{viewing.notes}</p>}</div></AppDialog>}
    {activePhoto?.photoPath&&<DatePhotoViewer key={`${owner}:${activePhoto.id}:${activePhoto.photoPath}`} path={activePhoto.photoPath} title={activePhoto.title} day={activePhoto.localDate} onClose={()=>setPhotoViewing(null)}/>}
    {deleting&&<ConfirmDialog title={uiText("Delete this date?")} description={uiText("“{0}” will be removed from your shared moments.",[deleting.title])} onClose={()=>setDeleting(null)} onConfirm={()=>deleteDate(deleting.id)}/>}
  </section>;
}
