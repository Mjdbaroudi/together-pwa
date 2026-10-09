"use client";
import { useEffect,useRef,useState } from "react";
import { CalendarHeart } from "lucide-react";
import { signMediaPath } from "@/lib/together/media";
export function DatePhoto({path,src,alt="",large=false}:{path?:string;src?:string;alt?:string;large?:boolean}){
  const [url,setUrl]=useState(src),[failed,setFailed]=useState(false);
  const generation=useRef(0);
  useEffect(()=>{const current=++generation.current;setUrl(src);setFailed(false);if(path&&!src)void signMediaPath(path).then(value=>{if(current===generation.current)setUrl(value);}).catch(()=>undefined);return()=>{generation.current++;};},[path,src]);
  async function recover(){if(failed){setUrl(undefined);return;}setFailed(true);const current=generation.current;try{const next=path?await signMediaPath(path,true):undefined;if(current===generation.current)setUrl(next);}catch{if(current===generation.current)setUrl(undefined);}}
  return <span className={`date-photo ${large?'large':''}`}>{url?<img src={url} alt={alt} loading="lazy" decoding="async" onError={()=>void recover()}/>:<CalendarHeart size={large?42:28} aria-hidden="true"/>}</span>;
}
