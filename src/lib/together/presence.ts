import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/supabase/client";
import type { CoupleProfile } from "@/lib/types";
export type AppPresence = { user_id: string; last_seen: string | null; online: boolean; valid_until: string | null; server_now: string };
type PresenceOwner = Pick<CoupleProfile,"myUserId"|"partnerUserId"|"coupleId">;
type PresenceProfile = PresenceOwner & Pick<CoupleProfile,"lastSeen"|"myLastSeen"|"partnerOnline">;
export function samePresenceOwner(profile: PresenceOwner, owner: PresenceOwner) {
  return profile.myUserId===owner.myUserId && profile.partnerUserId===owner.partnerUserId && profile.coupleId===owner.coupleId;
}
export function applyAppPresence<T extends PresenceProfile>(profile: T, owner: PresenceOwner, rows: AppPresence[]): T {
  if (!samePresenceOwner(profile,owner)) return profile;
  const me=rows.find(row=>row.user_id===owner.myUserId);
  const partner=owner.partnerUserId && owner.partnerUserId!==owner.myUserId ? rows.find(row=>row.user_id===owner.partnerUserId) : undefined;
  return {...profile,myLastSeen:me?.last_seen||profile.myLastSeen,
    lastSeen:!owner.partnerUserId || owner.partnerUserId===owner.myUserId ? undefined : partner ? partner.last_seen||undefined : profile.lastSeen,
    partnerOnline:Boolean(partner?.online)};
}
export function presenceDeadline(row: AppPresence, receivedAt: number) {
  if (!row.online || !row.valid_until) return 0;
  const remaining = Date.parse(row.valid_until) - Date.parse(row.server_now);
  return Number.isFinite(remaining) ? receivedAt + Math.max(0, Math.min(75000, remaining)) : 0;
}
export function lastSeenLabel(value?: string, now = new Date(), locale = "en") {
  const arabic = /^ar(?:-|$)/i.test(locale);
  if (!value || !Number.isFinite(Date.parse(value))) return arabic ? "آخر ظهور غير متاح" : "Last seen unavailable";
  const date = new Date(value), today = new Date(now.getFullYear(),now.getMonth(),now.getDate()), yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const day = date >= today ? (arabic ? "اليوم" : "today") : date >= yesterday ? (arabic ? "أمس" : "yesterday") : date.toLocaleDateString(locale,{day:"numeric",month:"short",...(date.getFullYear()!==now.getFullYear()?{year:"numeric"}: {})});
  const time=date.toLocaleTimeString(locale,{hour:"2-digit",minute:"2-digit"});
  return arabic ? `آخر ظهور ${day} الساعة ${time}` : `Last seen ${day} at ${time}`;
}
// Server-owned sequence numbers reject delayed foreground writes after a hide.
// A foreground lease expires even when a mobile OS kills the page silently.
export function startAppPresence(supabase: SupabaseClient, userId: string, coupleId: string | undefined, changed: (rows: AppPresence[]) => void, status: (error?: string) => void = () => undefined) {
  const sessionId=crypto.randomUUID();let sequence=0,disposed=false,reading=false,readAgain=false,token="";
  let expiry:ReturnType<typeof setTimeout>|undefined;
  async function request<T>(name:string,input:object) {const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try {const {data,error}=await supabase.rpc(name,input).abortSignal(controller.signal);if(error)throw error;return data as T;}finally{clearTimeout(timer);}}
  function markHidden(keepalive=false) {
    const input={p_session:sessionId,p_visible:false,p_sequence:++sequence};
    const config=getPublicSupabaseConfig();
    if(keepalive&&token&&config)void fetch(`${config.url}/rest/v1/rpc/touch_app_presence`,{method:"POST",headers:{apikey:config.key,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(input),keepalive:true}).catch(()=>undefined);
    else void request("touch_app_presence",input).catch(()=>undefined);
  }
  async function read() {
    if(disposed||document.visibilityState!=="visible"||!navigator.onLine)return;
    if(reading){readAgain=true;return;}reading=true;
    try {const rows=await request<AppPresence[]>("read_app_presence",{p_couple:coupleId||null});if(disposed)return;const receivedAt=Date.now();
      const safe=rows.filter(row=>row.user_id===userId||row.user_id!==userId&&Boolean(coupleId));status();changed(safe);
      if(expiry)clearTimeout(expiry);const deadlines=safe.map(row=>presenceDeadline(row,receivedAt)).filter(d=>d>receivedAt);
      if(deadlines.length)expiry=setTimeout(()=>{if(!disposed){changed(safe.map(row=>presenceDeadline(row,receivedAt)<=Date.now()?{...row,online:false,valid_until:null}:row));void read();}},Math.min(...deadlines)-receivedAt+20);
    } catch(error:unknown) {if(!disposed){const code=error&&typeof error==="object"&&"code" in error?String(error.code):"";status(["PGRST202","42P01","42883"].includes(code)?"Apply database update 012, then reopen Together.":"Last seen sync delayed. Check your connection; it will retry automatically.");changed([{user_id:userId,last_seen:null,online:false,valid_until:null,server_now:new Date().toISOString()}]);}}
    finally{reading=false;if(readAgain&&!disposed){readAgain=false;void read();}}
  }
  async function touch() {
    if(disposed)return;
    if(document.visibilityState!=="visible"){markHidden(true);return;}
    if(!navigator.onLine)return;
    const input={p_session:sessionId,p_visible:true,p_sequence:++sequence};
    try {const session=(await supabase.auth.getSession()).data.session;if(disposed||session?.user.id!==userId)return;token=session.access_token;await request("touch_app_presence",input);if(!disposed)await read();}catch {void read();}
  }
  const visibility=()=>{if(document.visibilityState==="hidden")markHidden(true);else void touch();};
  const pagehide=()=>markHidden(true),online=()=>void touch(),offline=()=>{status("You are offline. Last seen updates when you reconnect.");changed([{user_id:userId,last_seen:null,online:false,valid_until:null,server_now:new Date().toISOString()}]);};
  const channel=supabase.channel(`app-activity:${sessionId}`).on("postgres_changes",{event:"*",schema:"public",table:"app_presence"},()=>void read()).subscribe(status=>{if(status==="SUBSCRIBED")void read();});
  const timer=setInterval(()=>{if(document.visibilityState==="visible")void touch();},20000);
  document.addEventListener("visibilitychange",visibility);window.addEventListener("focus",online);window.addEventListener("online",online);window.addEventListener("offline",offline);window.addEventListener("pagehide",pagehide);window.addEventListener("pageshow",online);void touch();
  return ()=>{disposed=true;markHidden(true);clearInterval(timer);if(expiry)clearTimeout(expiry);void supabase.removeChannel(channel);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("focus",online);window.removeEventListener("online",online);window.removeEventListener("offline",offline);window.removeEventListener("pagehide",pagehide);window.removeEventListener("pageshow",online);};
}
