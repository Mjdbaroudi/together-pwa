"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { signMediaPath } from "@/lib/together/media";
export function useSignedMedia(src?:string,path?:string){
  const [url,setUrl]=useState(src),[error,setError]=useState("");
  const retryRef=useRef(false),generationRef=useRef(0);
  useEffect(()=>{++generationRef.current;setUrl(src);setError("");retryRef.current=false;},[src,path]);
  const retry=useCallback(async()=>{
    if(!path||retryRef.current){setError("This media could not be loaded.");return;}
    retryRef.current=true;const generation=generationRef.current;
    const next=await signMediaPath(path,true);
    if(generation!==generationRef.current)return;
    if(next){setUrl(next);setError("");}else setError("This media is unavailable. Try reopening it.");
  },[path]);
  return {url,error,retry};
}
