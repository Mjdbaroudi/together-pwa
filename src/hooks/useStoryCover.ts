"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { signMediaPath } from "@/lib/together/media";
import { localCalendarDate } from "@/lib/story";
import type { CoupleProfile, MemoryItem } from "@/lib/types";
export function useStoryDay(){const make=()=>({utc:new Date().toISOString().slice(0,10),local:localCalendarDate()});const [day,setDay]=useState(make);useEffect(()=>{const update=()=>{if(document.visibilityState!=="visible")return;const next=make();setDay(old=>old.utc===next.utc&&old.local===next.local?old:next);};const timer=setInterval(update,60000);window.addEventListener("pageshow",update);document.addEventListener("visibilitychange",update);return()=>{clearInterval(timer);window.removeEventListener("pageshow",update);document.removeEventListener("visibilitychange",update);};},[]);return day;}
export function useStoryCover(profile:CoupleProfile,memories:MemoryItem[],day:string){
  const [cover,setCover]=useState<{owner:string;day:string;url?:string;path?:string;error?:string}>({owner:"",day:""});
  const owner=`${profile.myUserId}:${profile.coupleId}`,config=JSON.stringify([profile.storyCoverMode,profile.storyCoverMemoryIds,profile.storyCoverPaths,profile.storyPhotoPath]);
  useEffect(()=>{let cancelled=false;const supabase=getSupabaseBrowser();if(!supabase||!profile.myUserId||!profile.coupleId||!profile.storyCoverMode)return;
    void (async()=>{try{const session=(await supabase.auth.getSession()).data.session;if(session?.user.id!==profile.myUserId)return;const {data,error}=await supabase.rpc("story_cover_for_day",{p_couple_id:profile.coupleId,p_day:day});if(error)throw error;const path=(data as {media_path:string}[]|null)?.[0]?.media_path;const url=await signMediaPath(path);if(!cancelled)setCover({owner,day,path,url});}catch(error){if(!cancelled)setCover({owner,day,error:error instanceof Error?error.message:"Could not load today's cover."});}})();return()=>{cancelled=true;};
  },[owner,config,day,memories.length,profile.coupleId,profile.myUserId,profile.storyCoverMode]);
  const current=cover.owner===owner&&cover.day===day?cover:undefined;
  const fallback=profile.storyPhotoUrl||memories.find(m=>m.kind!=="video")?.src;
  return {url:current?.url||fallback,path:current?.path||profile.storyPhotoPath,error:current?.error};
}
