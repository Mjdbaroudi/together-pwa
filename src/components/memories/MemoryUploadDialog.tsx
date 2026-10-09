"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useEffect, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { AppDialog } from "@/components/common/Overlay";
import { useTogether } from "@/components/providers/TogetherProvider";
import { errorMessage } from "@/lib/errors";
import { MAX_MEMORY_BATCH, validateMemoryFile } from "@/lib/story";
type Entry={id:string;file:File;caption:string;status:"ready"|"uploading"|"done"|"error";error?:string};
function Preview({file}:{file:File}){
  const { t: uiText } = useLanguage();
const [url,setUrl]=useState("");useEffect(()=>{const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);},[file]);return file.type.startsWith("video/")?<video src={url} muted playsInline preload="metadata"/>:<img src={url} loading="lazy" alt={uiText("Selected memory preview")}/>;}
export function MemoryUploadDialog({files,onClose}:{files:File[];onClose:()=>void}){
  const { t: uiText } = useLanguage();

  const {addMemory,profile}=useTogether();
  const [entries,setEntries]=useState<Entry[]>(()=>files.map(file=>({id:crypto.randomUUID(),file,caption:file.name.replace(/\.[^.]+$/,""),status:"ready"})));
  const [busy,setBusy]=useState(false),[error,setError]=useState("");const input=useRef<HTMLInputElement>(null),working=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function append(files:File[]){if(working.current)return;if(entries.length+files.length>MAX_MEMORY_BATCH){setError(`Choose up to ${MAX_MEMORY_BATCH} files per batch.`);return;}const invalid=files.find(f=>validateMemoryFile(f));if(invalid){setError(`${invalid.name}: ${validateMemoryFile(invalid)}`);return;}setError("");setEntries(prev=>[...prev,...files.filter(f=>!prev.some(e=>e.file.name===f.name&&e.file.size===f.size&&e.file.lastModified===f.lastModified)).map(file=>({id:crypto.randomUUID(),file,caption:file.name.replace(/\.[^.]+$/,""),status:"ready" as const}))]);}
  async function save(){if(working.current)return;working.current=true;setBusy(true);setError("");let failures=0;const owner=profile.myUserId;
    try{for(const item of entries.filter(e=>e.status!=="done")){if(!alive.current)break;setEntries(prev=>prev.map(e=>e.id===item.id?{...e,status:"uploading",error:undefined}:e));try{await addMemory(item.file,item.caption.trim(),item.id);if(alive.current)setEntries(prev=>prev.map(e=>e.id===item.id?{...e,status:"done"}:e));}catch(error){failures++;if(alive.current)setEntries(prev=>prev.map(e=>e.id===item.id?{...e,status:"error",error:errorMessage(error)}:e));}}
      if(alive.current){if(!failures&&owner===profile.myUserId)onClose();else setError("Some files were not saved. Retry only the failed files; saved memories will not be duplicated.");}
    }finally{working.current=false;if(alive.current)setBusy(false);}
  }
  const done=entries.filter(e=>e.status==="done").length,pending=entries.length-done;
  return <AppDialog title={entries.length===1?uiText("A moment to keep"):uiText("Keep these moments")} eyebrow={uiText("ADD TO YOUR STORY")} busy={busy} onClose={onClose} className="memory-batch-dialog" footer={<><button className="soft-btn secondary" disabled={busy} onClick={onClose}>{done?uiText("Close"):uiText("Cancel")}</button><button className="soft-btn" disabled={busy||!pending} onClick={()=>void save()}>{busy?uiText("Saving… {0} / {1}", [done, entries.length]):done||entries.some(e=>e.status==="error")?uiText("Retry {0} remaining", [pending]):uiText("Save {0} {1}", [entries.length, uiText(entries.length===1?"memory":"memories")])}</button></>}>
    <p className="hint">{uiText("Up to 20 photos or videos · 15 MB per file · Shared with your partner")}</p>{error&&<p className="notice error" role="alert">{uiText(error)}</p>}<p className="upload-batch-status" role="status">{busy?uiText("Keep this window open while your memories upload."):uiText("{0} selected{1}", [entries.length, done?` · ${uiText("{0} saved",[done])}`:""])}</p><div className="upload-batch-list">{entries.map((item,index)=><div className="upload-batch-item" key={item.id} data-status={item.status}><Preview file={item.file}/><div><label className="field-label" htmlFor={`caption-${item.id}`}>{uiText("Caption ")}{index+1}</label><input id={`caption-${item.id}`} className="input" value={item.caption} maxLength={500} disabled={busy||item.status==="done"} onChange={e=>setEntries(prev=>prev.map(row=>row.id===item.id?{...row,caption:e.target.value}:row))}/><small>{(item.file.size/1048576).toFixed(1)}{uiText(" MB · ")}{item.status==="done"?uiText("Saved"):item.status==="uploading"?uiText("Uploading…"):item.file.name}</small>{item.error&&<small role="alert">{item.error}</small>}</div>{item.status==="done"?<Check size={18} aria-label={uiText("Saved")}/>:<button aria-label={uiText("Remove {0}", [item.file.name])} disabled={busy} onClick={()=>setEntries(prev=>prev.filter(row=>row.id!==item.id))}><X size={16}/></button>}</div>)}</div><button className="soft-btn secondary upload-batch-add" disabled={busy||entries.length>=MAX_MEMORY_BATCH} onClick={()=>input.current?.click()}><Plus size={17}/>{uiText("Add more files")}</button><input ref={input} hidden type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime" onChange={e=>{append(Array.from(e.target.files||[]));e.target.value="";}}/>
  </AppDialog>;
}
