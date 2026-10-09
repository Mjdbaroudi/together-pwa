"use client";
import { useEffect, useState } from "react";
export function useReadingActive() {
  const [active,setActive]=useState(false);
  useEffect(()=>{
    const update=()=>setActive(document.visibilityState==="visible" && document.hasFocus() && !document.querySelector('[aria-modal="true"]'));
    const observer=new MutationObserver(update);
    observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener("visibilitychange",update);
    window.addEventListener("focus",update);window.addEventListener("blur",update);
    update();
    return ()=>{observer.disconnect();document.removeEventListener("visibilitychange",update);window.removeEventListener("focus",update);window.removeEventListener("blur",update);};
  },[]);
  return active;
}
