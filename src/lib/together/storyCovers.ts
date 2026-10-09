import { getSupabaseBrowser } from "@/lib/supabase/client";
import { mediaExtension, prepareProfilePhoto, storagePath } from "@/lib/together/media";
import type { CoupleProfile } from "@/lib/types";
import type { CoupleRow } from "@/lib/together/types";
import type { StoryCoverSettings } from "@/lib/story";
export function coverFields(row:CoupleRow){return {storyCoverMode:row.story_cover_mode,storyCoverMemoryIds:row.story_cover_memory_ids||[],storyCoverPaths:row.story_cover_paths||[]};}
export async function saveStoryCovers(owner:CoupleProfile,settings:StoryCoverSettings,files:File[]=[]){
  const supabase=getSupabaseBrowser();
  if(!supabase||!owner.myUserId||!owner.coupleId||!owner.paired)throw new Error("Pair your accounts before changing your story cover.");
  const session=(await supabase.auth.getSession()).data.session;
  if(session?.user.id!==owner.myUserId)throw new Error("Your account changed. Reopen the cover settings.");
  if(!["fixed","selected","memories"].includes(settings.mode)||settings.memoryIds.length>60||settings.paths.length+files.length>20)throw new Error("Choose up to 60 album photos and 20 uploaded covers.");
  if(files.some(f=>!f.type.startsWith("image/")||!f.size||f.size>10*1024*1024))throw new Error("Choose cover images smaller than 10 MB each.");
  const uploaded:string[]=[];
  try{
    for(const file of files){const prepared=await prepareProfilePhoto(file);const path=storagePath(owner.coupleId,owner.myUserId,"story",mediaExtension(prepared,"jpg"));const {error}=await supabase.storage.from("couple-media").upload(path,prepared,{contentType:prepared.type,upsert:false});if(error)throw error;uploaded.push(path);}
  }catch(error){if(uploaded.length)await supabase.storage.from("couple-media").remove(uploaded);throw error;}
  const input={story_cover_mode:settings.mode,story_cover_memory_ids:[...new Set(settings.memoryIds)],story_cover_paths:[...new Set([...settings.paths,...uploaded])]};
  let {data,error}=await supabase.from("couples").update(input).eq("id",owner.coupleId).select("*").single();
  if(error){
    // Do not delete newly uploaded bytes if an update may have committed.
    const recovery=await supabase.from("couples").select("*").eq("id",owner.coupleId).maybeSingle();
    const row=recovery.data as CoupleRow|null;
    if(row&&row.story_cover_mode===input.story_cover_mode&&JSON.stringify(row.story_cover_memory_ids)===JSON.stringify(input.story_cover_memory_ids)&&JSON.stringify(row.story_cover_paths)===JSON.stringify(input.story_cover_paths)){data=row;error=null;}
    else{if(!recovery.error&&row){const unused=uploaded.filter(p=>!row.story_cover_paths?.includes(p)&&row.cover_media_path!==p);if(unused.length)await supabase.storage.from("couple-media").remove(unused);}throw new Error(error.message?.includes("story_cover")?"Apply database update 014, then retry.":error.message);}
  }
  return data as CoupleRow;
}
