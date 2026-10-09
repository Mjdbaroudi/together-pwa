"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { Overlay } from "@/components/common/Overlay";
import { useSignedMedia } from "@/hooks/useSignedMedia";
import { Download, Heart, Share2, Trash2, X } from "lucide-react";
import type { MemoryItem } from "@/lib/types";
import {useState} from "react";
import {ConfirmDialog} from "@/components/common/ConfirmDialog";
import {errorMessage} from "@/lib/errors";

export function MemoryViewer({memory,onClose,onFavorite,onDelete}:{memory:MemoryItem;onClose:()=>void;onFavorite:()=>Promise<void>;onDelete:()=>Promise<void>}){
  const { t: uiText } = useLanguage();

 const [deleting,setDeleting]=useState(false);
 const [actionError,setActionError]=useState("");
 const media=useSignedMedia(memory.src,memory.mediaPath);
 async function share(){
  setActionError("");
  try{
   if(navigator.share){
    const res=await fetch(media.url||memory.src);if(!res.ok)throw new Error("Could not load this memory for sharing."); const blob=await res.blob(); const ext=blob.type.split("/")[1]||"jpg"; const file=new File([blob],`together-memory.${ext}`,{type:blob.type});
    if(navigator.canShare?.({files:[file]})) await navigator.share({title:"Together memory",text:memory.caption,files:[file]});
    else await navigator.share({title:"Together memory",text:memory.caption});
   }else setActionError("Sharing is not available here. Use Download to save this memory.");
  }catch(error:unknown){if(!(error instanceof DOMException&&error.name==="AbortError"))setActionError(errorMessage(error,"Could not share this memory."));}
 }
 async function favorite(){setActionError("");try{await onFavorite();}catch(error:unknown){setActionError(errorMessage(error,"Could not save your favorite."));}}
 function download(){const a=document.createElement("a");a.href=media.url||memory.src;a.download=`together-${memory.id}.${memory.kind==="video"?"mp4":"jpg"}`;a.target="_blank";a.click()}
 return <><Overlay style={{placeItems:"center"}}><div className="memory-viewer-dialog" role="dialog" aria-modal="true" aria-label={uiText("Memory viewer")} style={{width:"min(760px,100%)",maxHeight:"92dvh",background:"#21131e",borderRadius:30,overflow:"hidden",color:"white",boxShadow:"0 30px 100px rgba(0,0,0,.4)"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px"}}><div><strong>{memory.caption}</strong><div style={{fontSize:11,opacity:.65}}>{new Date(memory.date).toLocaleDateString()}</div></div><button className="round-btn" aria-label={uiText("Close")} onClick={onClose} style={{color:"white",background:"rgba(255,255,255,.1)",border:0}}><X size={19}/></button></div>
  {memory.kind==="video"?<video src={media.url||memory.src} onError={()=>void media.retry()} controls style={{display:"block",width:"100%",maxHeight:"65dvh",background:"black"}}/>:<img src={media.url||memory.src} onError={()=>void media.retry()} alt={memory.caption} style={{display:"block",width:"100%",maxHeight:"65dvh",objectFit:"contain",background:"black"}}/>}
  {actionError&&<p role="alert" className="notice error" style={{margin:"10px 14px"}}>{uiText(actionError)}</p>}
  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,padding:14}}><button className="soft-btn secondary" onClick={download} style={{padding:0}} aria-label={uiText("Download memory")}><Download size={18}/></button><button className="soft-btn secondary" onClick={share} style={{padding:0}} aria-label={uiText("Share memory")}><Share2 size={18}/></button><button className="soft-btn secondary" onClick={()=>void favorite()} style={{padding:0,color:"var(--rose2)"}} aria-label={memory.favorite?uiText("Remove favorite"):uiText("Add favorite")} aria-pressed={memory.favorite}><Heart size={18} fill={memory.favorite?"currentColor":"none"}/></button><button className="soft-btn secondary" onClick={()=>setDeleting(true)} style={{padding:0}} aria-label={uiText("Delete memory")}><Trash2 size={18}/></button></div>
 </div></Overlay>{deleting&&<ConfirmDialog title={uiText("Delete this memory?")} description={uiText("This photo or video will be removed from your shared album for both of you.")} onClose={()=>setDeleting(false)} onConfirm={onDelete}/>}</>;
}
