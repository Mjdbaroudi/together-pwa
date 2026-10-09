import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportantDate } from "@/lib/types";
import { prepareProfilePhoto, mediaExtension } from "@/lib/together/media";
import { validDatePhoto } from "@/lib/story";
import type { ImportantDateRow } from "@/lib/together/types";

export function datePayload(input:Omit<ImportantDate,"id">){
  return {title:input.title,date:input.date,kind:input.kind,notes:input.notes||null,...(input.specialType?{local_date:input.localDate,repeats_yearly:Boolean(input.repeatsYearly),special_type:input.specialType}:{}),...(input.photoPath!==undefined?{photo_path:input.photoPath||null}:{})};
}
export async function cleanupDatePhoto(client:SupabaseClient,path:string|undefined,coupleId:string){
  if(!path||path.split('/')[0]!==coupleId||path.split('/')[2]!=="dates"||path.includes('..'))return;
  const {data,error}=await client.from("important_dates").select("id").eq("photo_path",path).limit(1);
  if(!error&&data&&!data.length)await client.storage.from("couple-media").remove([path]).catch(()=>undefined);
}
export async function saveImportantDate(client:SupabaseClient,owner:{userId:string;coupleId:string},id:string,input:Omit<ImportantDate,"id">,editing:boolean,file?:File){
  const user=(await client.auth.getSession()).data.session?.user.id;
  if(user!==owner.userId)throw new Error("Your account changed. Reopen the date window.");
  const payload=datePayload(input);let uploaded:string|undefined;
  if(file){
    if(!validDatePhoto(file))throw new Error("Choose an image smaller than 15 MB.");
    const prepared=await prepareProfilePhoto(file),extension=mediaExtension(prepared,"jpg").replace(/[^a-z0-9]/g,'').slice(0,10)||"jpg";
    uploaded=`${owner.coupleId}/${owner.userId}/dates/${id}-${crypto.randomUUID()}.${extension}`;
    const {error}=await client.storage.from("couple-media").upload(uploaded,prepared,{contentType:prepared.type,upsert:false});if(error)throw error;
    payload.photo_path=uploaded;
  }
  if((await client.auth.getSession()).data.session?.user.id!==owner.userId){if(uploaded)await cleanupDatePhoto(client,uploaded,owner.coupleId);throw new Error("Your account changed. Reopen the date window.");}
  const mutation=editing?client.from("important_dates").update(payload).eq("id",id).eq("couple_id",owner.coupleId):client.from("important_dates").insert({...payload,id,couple_id:owner.coupleId,created_by:owner.userId});
  const {data,error}=await mutation.select("*").single();
  if(!error&&data)return data as ImportantDateRow;
  // Recover a committed write with a lost acknowledgement using the stable ID.
  const recovered=await client.from("important_dates").select("*").eq("id",id).eq("couple_id",owner.coupleId).maybeSingle();
  const row=recovered.data as ImportantDateRow|null;
  const matches=row&&Object.entries(payload).every(([key,value])=>key==='date'?Date.parse(row.date)===Date.parse(String(value)):(row as unknown as Record<string,unknown>)[key]===value);
  if(!recovered.error&&matches)return row!;
  // Never remove media when persistence is unknown, or when another row uses it.
  if(uploaded&&!recovered.error)await cleanupDatePhoto(client,uploaded,owner.coupleId);
  throw error||new Error("Could not save this date. Please retry.");
}
