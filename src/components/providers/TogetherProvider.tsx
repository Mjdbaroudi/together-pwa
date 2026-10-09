"use client";

import { olderFilter, richMessageSelect, type RowCursor } from "@/lib/together/pagination";
import { coverFields, saveStoryCovers } from "@/lib/together/storyCovers";
import { validateMemoryFile, type StoryCoverSettings } from "@/lib/story";
import { collectPages } from "@/lib/together/collectPages";
import { flushOwnedQueue } from "@/lib/together/outboxEngine";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
import type { ChatConnectionState, CoupleProfile, ImportantDate, MemoryItem, Message } from "@/lib/types";
import { mapImportantDate, mapMemory, mapMessage } from "@/lib/together/mappers";
import { saveImportantDate, cleanupDatePhoto } from "@/lib/together/datePhotos";
import { mediaExtension, prepareProfilePhoto, resolveMediaReference, signMediaPath, storagePath, uploadChatMedia } from "@/lib/together/media";
import { createQueuedText, pendingMessage, readOutbox, writeOutbox } from "@/lib/together/outbox";
import { CHAT_PAGE_SIZE, mergeMessageGroups, reconcileRecentMessages, upsertMessage } from "@/lib/together/messageStore";
import { createCoupleRealtime } from "@/lib/together/realtime";
import { applyAppPresence, samePresenceOwner, startAppPresence } from "@/lib/together/presence";
import { readContactName, saveContactName, type ContactOwner } from "@/lib/together/contactPreferences";
import { EMPTY_PROFILE, type ChatSearchInput, type CoupleRow, type ImportantDateRow, type MediaSendOptions, type MemoryRow, type MessageRow, type ProfileRow, type ProfileUpdate, type ReplyDraft } from "@/lib/together/types";

type TogetherContextValue = {
  configured: boolean;
  loading: boolean;
  pairReady: boolean;
  profile: CoupleProfile;
  messages: Message[];
  unreadCount: number;
  loadError: string;
  exportAllData: () => Promise<object>;
  hasOlderMemories: boolean;
  loadingOlderMemories: boolean;
  loadOlderMemories: () => Promise<void>;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  chatConnection: ChatConnectionState;
  memories: MemoryItem[];
  dates: ImportantDate[];
  theme: string;
  replyDraft: ReplyDraft;
  setReplyDraft: (reply: ReplyDraft) => void;
  sendText: (body: string) => Promise<void>;
  retryMessage: (id: string) => Promise<void>;
  loadOlderMessages: () => Promise<number>;
  resyncMessages: () => Promise<void>;
  sendMedia: (file: File, kind: "image" | "voice" | "video", duration?: number, options?: MediaSendOptions) => Promise<void>;
  reactToMessage: (id: string, emoji?: string) => Promise<void>;
  editMessage: (id: string, body: string) => Promise<void>;
  deleteMessage: (id: string, scope?: "me" | "everyone") => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  searchChat: (input: ChatSearchInput) => Promise<Message[]>;
  loadDate: (date: string) => Promise<string | null>;
  loadSavedMessages: () => Promise<Message[]>;
  ensureMessageLoaded: (id: string) => Promise<boolean>;
  setTyping: (value: boolean) => void;
  markMessagesRead: (ids:string[]) => Promise<void>;
  addMemory: (file: File, caption?: string, id?: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  addDate: (date: Omit<ImportantDate, "id">, photo?:File, id?:string) => Promise<void>;
  updateDate: (id: string, date: Omit<ImportantDate, "id">, photo?:File) => Promise<void>;
  deleteDate: (id: string) => Promise<void>;
  updateProfile: (input: ProfileUpdate) => Promise<void>;
  setPartnerContactName: (name: string) => Promise<void>;
  contactPreferencesError: string;
  refreshPartnerContact: () => Promise<void>;
  setProfilePhoto: (file: File) => Promise<void>;
  removeProfilePhoto: () => Promise<void>;
  updateFirstMeetingDate: (date?: string) => Promise<void>;
  setStoryPhoto: (file: File) => Promise<void>;
  removeStoryPhoto: () => Promise<void>;
  saveStoryCoverSettings: (settings: StoryCoverSettings, files?: File[]) => Promise<void>;
  setTheme: (theme: string) => void;
  refresh: () => Promise<void>;
};



const LOCAL_HIDDEN_PREFIX = "together:hidden-messages:";
const LOCAL_HIDDEN_LIMIT = 4000;

function readLocalHiddenMessageIds(userId: string) {
  if (typeof window === "undefined" || !userId) return new Set<string>();
  try {
    const raw = window.localStorage.getItem(`${LOCAL_HIDDEN_PREFIX}${userId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function rememberLocalHiddenMessage(userId: string, messageId: string) {
  if (typeof window === "undefined" || !userId || !messageId) return;
  try {
    const ids = Array.from(readLocalHiddenMessageIds(userId));
    const next = ids.filter(id => id !== messageId);
    next.push(messageId);
    window.localStorage.setItem(`${LOCAL_HIDDEN_PREFIX}${userId}`, JSON.stringify(next.slice(-LOCAL_HIDDEN_LIMIT)));
  } catch {
    // A privacy/storage restriction must never prevent the visible delete action.
  }
}

const LOCAL_STARRED_PREFIX = "together:starred-messages:";
const LOCAL_STARRED_LIMIT = 4000;

function readLocalStarredMessageIds(userId: string) {
  if (typeof window === "undefined" || !userId) return new Set<string>();
  try {
    const raw = window.localStorage.getItem(`${LOCAL_STARRED_PREFIX}${userId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function writeLocalStarredMessageIds(userId: string, ids: Set<string>) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(`${LOCAL_STARRED_PREFIX}${userId}`, JSON.stringify(Array.from(ids).slice(-LOCAL_STARRED_LIMIT)));
  } catch {
    // Storage restrictions should not break chat actions.
  }
}

async function recordDeliveries(supabase: SupabaseClient, userId: string, ids: string[]) {
  if (!ids.length) return;
  const deliveredAt = new Date().toISOString();
  const rows = ids.map(messageId => ({ message_id: messageId, user_id: userId, delivered_at: deliveredAt }));
  const { error } = await supabase.from("message_deliveries").upsert(rows, { onConflict: "message_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

async function removeHiddenMessages(supabase: SupabaseClient, userId: string, rows: MessageRow[], hidesEnabled: boolean) {
  if (!rows.length) return rows;

  // Local persistence is the compatibility floor. It keeps “Delete for me”
  // stable even on databases that never received the optional V2.2 table.
  const hidden = readLocalHiddenMessageIds(userId);
  let visible = rows.filter(row => !hidden.has(row.id));
  if (!visible.length || !hidesEnabled) return visible;

  const ids = visible.map(row => row.id);
  for(let offset=0;offset<ids.length;offset+=100){
    const {data,error}=await supabase.from("message_hides").select("message_id").eq("user_id",userId).in("message_id",ids.slice(offset,offset+100));
    if(error)throw error;
    for(const row of data||[])hidden.add(String(row.message_id));
  }
  visible = visible.filter(row => !hidden.has(row.id));
  return visible;
}

async function fetchMessagePage(
  supabase: SupabaseClient,
  coupleId: string,
  userId: string,
  deliveriesEnabled: boolean,
  hidesEnabled: boolean,
  before?: RowCursor,
  limit = CHAT_PAGE_SIZE,
) {
  // Fetch one extra server row so pagination does not depend on how many rows
  // remain visible after per-user hides are applied. This prevents older history
  // from being mistaken as complete when some recent messages are hidden.
  const fetchLimit = limit + 1;
  let raw: MessageRow[];

  if (deliveriesEnabled) {
    const base = supabase.from("messages")
      .select("*, reactions(emoji,user_id), message_reads(user_id,seen_at), message_deliveries(user_id,delivered_at)")
      .eq("couple_id", coupleId);
    const scoped = before ? base.or(olderFilter(before)) : base;
    const result = await scoped.order("created_at", { ascending: false }).order("id",{ascending:false}).limit(fetchLimit);
    if (result.error) {
      console.warn("Rich message query failed; retrying core message load", result.error);
      throw result.error;
    } else {
      raw = (result.data || []) as unknown as MessageRow[];
    }
  } else {
    const base = supabase.from("messages")
      .select("*, reactions(emoji,user_id), message_reads(user_id,seen_at)")
      .eq("couple_id", coupleId);
    const scoped = before ? base.or(olderFilter(before)) : base;
    const result = await scoped.order("created_at", { ascending: false }).order("id",{ascending:false}).limit(fetchLimit);
    if (result.error) {
      console.warn("Rich message query failed; retrying core message load", result.error);
      throw result.error;
    } else {
      raw = (result.data || []) as unknown as MessageRow[];
    }
  }

  const hasMore = raw.length > limit;
  const rawPage = raw.slice(0, limit);
  const nextBefore = rawPage.length ? {created_at:rawPage[rawPage.length-1].created_at,id:rawPage[rawPage.length-1].id} : before;
  const pageRows = rawPage.reverse();
  return { rows: await removeHiddenMessages(supabase, userId, pageRows, hidesEnabled), hasMore, nextBefore };
}
const TogetherContext = createContext<TogetherContextValue | null>(null);
const PartnerTypingContext = createContext(false);

export function TogetherProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [loadError,setLoadError]=useState("");
  const [unreadCount,setUnreadCount]=useState(0);
  const [hasOlderMemories,setHasOlderMemories]=useState(false);
  const [loadingOlderMemories,setLoadingOlderMemories]=useState(false);
  const memoryCursorRef=useRef<RowCursor|undefined>(undefined);
  const memoryLoadingRef=useRef(false);
  const loadGenerationRef=useRef(0);
  const activeUserRef=useRef<string|undefined>(undefined);
  const [profile, setProfile] = useState<CoupleProfile>(EMPTY_PROFILE);
  const [contactPreferencesError, setContactPreferencesError] = useState("");
  const contactRequestRef = useRef(0);
  const contactSavingRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [chatConnection, setChatConnection] = useState<ChatConnectionState>("connecting");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [dates, setDates] = useState<ImportantDate[]>([]);
  const [typing, setPartnerTyping] = useState(false);
  const [theme, setThemeState] = useState("rose");
  const [replyDraft, setReplyDraft] = useState<ReplyDraft>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const flushInFlightRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const olderInFlightRef = useRef(false);
  const olderCursorRef = useRef<RowCursor | undefined>(undefined);
  const deliveriesEnabledRef = useRef(false);
  const hidesEnabledRef = useRef(false);
  const starsEnabledRef = useRef(false);
  const starredIdsRef = useRef<Set<string>>(new Set());
  const profileRef = useRef(profile);
  const messagesRef = useRef(messages);

  profileRef.current = profile;
  messagesRef.current = messages;

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const ownsContact = (owner: ContactOwner) => {
    const current = profileRef.current;
    return current.myUserId === owner.myUserId && current.coupleId === owner.coupleId && current.partnerUserId === owner.partnerUserId;
  };

  const refreshPartnerContact = useCallback(async () => {
    const current = profileRef.current, supabase = getSupabaseBrowser();
    if (!supabase || !current.myUserId || !current.coupleId || !current.partnerUserId || contactSavingRef.current) return;
    const owner = { myUserId: current.myUserId, coupleId: current.coupleId, partnerUserId: current.partnerUserId };
    const request = ++contactRequestRef.current;
    try {
      const name = await readContactName(supabase, owner);
      if (!ownsContact(owner) || request !== contactRequestRef.current) return;
      setProfile(previous => previous.partnerContactName === name ? previous : { ...previous, partnerContactName: name });
      setContactPreferencesError("");
    } catch (error: unknown) {
      if (ownsContact(owner) && request === contactRequestRef.current) setContactPreferencesError(error instanceof Error ? error.message : "Could not load your private contact name.");
    }
  }, []);

  const setPartnerContactName = async (value: string) => {
    const current = profileRef.current, supabase = getSupabaseBrowser();
    if (!supabase || !current.myUserId || !current.coupleId || !current.partnerUserId) throw new Error("Pair your accounts before naming your partner.");
    if (contactSavingRef.current) throw new Error("Your contact name is already being saved.");
    const owner = { myUserId: current.myUserId, coupleId: current.coupleId, partnerUserId: current.partnerUserId };
    contactSavingRef.current = true; ++contactRequestRef.current;
    try {
      const name = await saveContactName(supabase, owner, value);
      if (ownsContact(owner)) { setProfile(previous => ({ ...previous, partnerContactName: name })); setContactPreferencesError(""); }
    } finally { ++contactRequestRef.current; contactSavingRef.current = false; }
  };

  const hydrateMessage = useCallback(async (row: MessageRow, myUserId?: string) => {
    const url = await signMediaPath(row.media_path);
    const message = mapMessage(row, myUserId, url);
    return { ...message, starred: starredIdsRef.current.has(row.id) };
  }, []);

  const refreshUnreadFor=useCallback(async (supabase:SupabaseClient,coupleId:string,userId:string) => {
    const {data,error}=await supabase.rpc("count_unread_messages",{p_couple:coupleId});
    if (error) throw new Error("Could not load the unread count. Apply the v2.5 database update, then retry.");
    if (profileRef.current.myUserId===userId && profileRef.current.coupleId===coupleId) setUnreadCount(Number(data)||0);
  },[]);

  const readMemoryPage=useCallback(async (supabase:SupabaseClient,coupleId:string,before?:RowCursor) => {
    let query=supabase.from("memories").select("*").eq("couple_id",coupleId);
    if (before) query=query.or(olderFilter(before));
    const {data,error}=await query.order("created_at",{ascending:false}).order("id",{ascending:false}).limit(101);
    if (error) throw error;
    const rows=(data||[]) as MemoryRow[],page=rows.slice(0,100),last=page[page.length-1];
    const items=await Promise.all(page.map(async row=>mapMemory(row,(await signMediaPath(row.media_path))||"")));
    return {items,more:rows.length>100,cursor:last ? {id:last.id,created_at:last.created_at}:before};
  },[]);

  const loadOlderMemories=useCallback(async () => {
    const owner=profileRef.current,supabase=getSupabaseBrowser();
    if (!supabase || !owner.paired || memoryLoadingRef.current || !hasOlderMemories) return;
    memoryLoadingRef.current=true;setLoadingOlderMemories(true);
    try {
      const page=await readMemoryPage(supabase,owner.coupleId,memoryCursorRef.current);
      if (profileRef.current.myUserId!==owner.myUserId || profileRef.current.coupleId!==owner.coupleId) return;
      memoryCursorRef.current=page.cursor;setHasOlderMemories(page.more);
      setMemories(current=>[...new Map([...current,...page.items].map(item=>[item.id,item])).values()]);
    } finally {memoryLoadingRef.current=false;setLoadingOlderMemories(false);}
  },[hasOlderMemories,readMemoryPage]);

  const syncRecentFor = useCallback(async (supabase: SupabaseClient, coupleId: string, userId: string, deliveriesEnabled: boolean) => {
    if (syncInFlightRef.current || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    syncInFlightRef.current = true;
    try {
      const snapshotIds=new Set(messagesRef.current.filter(message=>!message.pending && !message.failed).map(message=>message.id));
      const page = await fetchMessagePage(supabase, coupleId, userId, deliveriesEnabled, hidesEnabledRef.current);
      const latest = await Promise.all(page.rows.map(row => hydrateMessage(row, userId)));
      const queued = readOutbox({userId,coupleId});
      const queuedIds = new Set(queued.map(item => item.tempId));
      if (profileRef.current.myUserId!==userId || profileRef.current.coupleId!==coupleId) return;
      setMessages(current=>reconcileRecentMessages(current,latest,queuedIds,CHAT_PAGE_SIZE,page.hasMore,snapshotIds));
      const surviving=new Set<string>(),ids=[...snapshotIds];
      for (let offset=0;offset<ids.length;offset+=100) {
        const {data,error}=await supabase.from("messages").select("id").eq("couple_id",coupleId).in("id",ids.slice(offset,offset+100));
        if (error) throw error;
        const visible=await removeHiddenMessages(supabase,userId,(data||[]) as MessageRow[],hidesEnabledRef.current);
        visible.forEach(row=>surviving.add(row.id));
      }
      if (profileRef.current.myUserId!==userId || profileRef.current.coupleId!==coupleId) return;
      setMessages(current=>current.filter(message=>!snapshotIds.has(message.id)||surviving.has(message.id)||queuedIds.has(message.id)));
      await refreshUnreadFor(supabase,coupleId,userId);
      setLoadError("");

      if (deliveriesEnabled) {
        const incomingIds = latest.filter(message => message.sender === "partner" && !message.delivered).map(message => message.id);
        if (incomingIds.length) void recordDeliveries(supabase, userId, incomingIds).catch(() => undefined);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not synchronize messages. Retry.");
    } finally {
      syncInFlightRef.current = false;
    }
  }, [hydrateMessage,refreshUnreadFor]);

  const resyncMessages = useCallback(async () => {
    const current = profileRef.current;
    if (!current.paired || !current.coupleId || !current.myUserId) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    await syncRecentFor(supabase, current.coupleId, current.myUserId, deliveriesEnabledRef.current);
  }, [syncRecentFor]);

  const loadOlderMessages = useCallback(async () => {
    const currentProfile = profileRef.current;
    if (olderInFlightRef.current || !hasOlderMessages || !currentProfile.paired || !currentProfile.coupleId || !currentProfile.myUserId) return 0;
    const supabase = getSupabaseBrowser();
    if (!supabase) return 0;

    const before = olderCursorRef.current;
    if (!before) {
      setHasOlderMessages(false);
      return 0;
    }

    olderInFlightRef.current = true;
    setLoadingOlderMessages(true);
    try {
      const page = await fetchMessagePage(supabase, currentProfile.coupleId, currentProfile.myUserId, deliveriesEnabledRef.current, hidesEnabledRef.current, before);
      if (profileRef.current.myUserId!==currentProfile.myUserId) return 0;
      olderCursorRef.current = page.nextBefore;
      const older = await Promise.all(page.rows.map(row => hydrateMessage(row, currentProfile.myUserId)));
      if (profileRef.current.myUserId!==currentProfile.myUserId || profileRef.current.coupleId!==currentProfile.coupleId) return 0;
      setMessages(current => mergeMessageGroups(older, current));
      setHasOlderMessages(page.hasMore);
      return older.length;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load earlier messages. Retry.");
      return 0;
    } finally {
      olderInFlightRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [hasOlderMessages, hydrateMessage]);

  const refreshSharedStory=useCallback(async()=>{
    const owner=profileRef.current,supabase=getSupabaseBrowser();
    if(!supabase||!owner.myUserId||!owner.coupleId||!owner.paired)return;
    const [pair,result]=await Promise.all([supabase.from("couples").select("*").eq("id",owner.coupleId).maybeSingle(),supabase.from("important_dates").select("*").eq("couple_id",owner.coupleId).order("date",{ascending:true})]);
    if(pair.error||result.error||!pair.data)return;
    const row=pair.data as CoupleRow,storyPhotoUrl=await signMediaPath(row.cover_media_path);
    if(profileRef.current.myUserId!==owner.myUserId||profileRef.current.coupleId!==owner.coupleId)return;
    setProfile(prev=>({...prev,...coverFields(row),anniversary:row.anniversary_date||undefined,storyPhotoPath:row.cover_media_path||undefined,storyPhotoUrl}));
    setDates(((result.data||[]) as ImportantDateRow[]).map(mapImportantDate));
  },[]);

  useEffect(()=>{
    let inFlight=false;
    const update=()=>{if(document.visibilityState!=="visible"||!navigator.onLine||inFlight)return;inFlight=true;void refreshSharedStory().catch(()=>undefined).finally(()=>{inFlight=false;});};
    document.addEventListener("visibilitychange",update);window.addEventListener("online",update);
    return()=>{document.removeEventListener("visibilitychange",update);window.removeEventListener("online",update);};
  },[refreshSharedStory,profile.myUserId,profile.coupleId]);

  const loadSupabase=useCallback(async () => {
    const generation=++loadGenerationRef.current;
    const supabase=getSupabaseBrowser();
    if (!supabase) {setLoading(false);return;}
    setLoading(true);setLoadError("");
    try {
      const session=(await supabase.auth.getSession()).data.session;
      if (generation!==loadGenerationRef.current) return;
      const user=session?.user;
      if (activeUserRef.current!==user?.id) {
        activeUserRef.current=user?.id;profileRef.current=EMPTY_PROFILE;
        ++contactRequestRef.current;setContactPreferencesError("");
        setProfile(EMPTY_PROFILE);setMessages([]);setMemories([]);setDates([]);setUnreadCount(0);setReplyDraft(null);
        starredIdsRef.current=new Set();olderCursorRef.current=undefined;memoryCursorRef.current=undefined;
        setHasOlderMessages(false);setHasOlderMemories(false);
        if (channelRef.current) {void supabase.removeChannel(channelRef.current);channelRef.current=null;}
      }
      if (!user) return;
      const fallbackName=String(user.user_metadata?.display_name||user.email?.split("@")[0]||"User");
      const profileInsert=await supabase.from("profiles").upsert({user_id:user.id,display_name:fallbackName,nickname:fallbackName},{onConflict:"user_id",ignoreDuplicates:true});
      if (profileInsert.error) throw profileInsert.error;
      const pairResult=await supabase.from("couples").select("*").or(`user_a.eq.${user.id},user_b.eq.${user.id}`).maybeSingle();
      if (pairResult.error) throw pairResult.error;
      const couple=pairResult.data as CoupleRow|null;
      const partnerId=couple ? (couple.user_a===user.id ? couple.user_b : couple.user_a):undefined;
      const profileResult=await supabase.from("profiles").select("user_id,display_name,nickname,avatar_url,last_seen").in("user_id",partnerId ? [user.id,partnerId]:[user.id]);
      if (profileResult.error) throw profileResult.error;
      const profiles=(profileResult.data||[]) as ProfileRow[],me=profiles.find(row=>row.user_id===user.id),partner=profiles.find(row=>row.user_id===partnerId);
      const [myAvatarUrl,partnerAvatarUrl,storyPhotoUrl]=await Promise.all([resolveMediaReference(me?.avatar_url),resolveMediaReference(partner?.avatar_url),signMediaPath(couple?.cover_media_path)]);
      const nextProfile:CoupleProfile={...EMPTY_PROFILE,coupleId:couple?.id||"",paired:Boolean(partnerId),myUserId:user.id,partnerUserId:partnerId||undefined,
        partnerOnline:profileRef.current.myUserId===user.id&&profileRef.current.partnerUserId===partnerId?profileRef.current.partnerOnline:false,
        presenceError:profileRef.current.myUserId===user.id&&profileRef.current.coupleId===couple?.id?profileRef.current.presenceError:undefined,
        partnerContactName:profileRef.current.myUserId===user.id&&profileRef.current.coupleId===couple?.id&&profileRef.current.partnerUserId===partnerId?profileRef.current.partnerContactName:undefined,
        inviteCode:couple?.invite_code||undefined,myName:me?.display_name||fallbackName,myNickname:me?.nickname||me?.display_name||fallbackName,
        myAvatarPath:me?.avatar_url||undefined,myAvatarUrl,partnerName:partner?.display_name||"",partnerNickname:partner?.nickname||partner?.display_name||"",
        partnerAvatarPath:partner?.avatar_url||undefined,partnerAvatarUrl,storyPhotoPath:couple?.cover_media_path||undefined,storyPhotoUrl,
        ...(couple?coverFields(couple):{}),anniversary:couple?.anniversary_date||undefined,lastSeen:profileRef.current.partnerUserId===partnerId?profileRef.current.lastSeen||partner?.last_seen||undefined:partner?.last_seen||undefined,myLastSeen:profileRef.current.myUserId===user.id?profileRef.current.myLastSeen||me?.last_seen||undefined:me?.last_seen||undefined};
      if (generation!==loadGenerationRef.current) return;
      profileRef.current=nextProfile;setProfile(nextProfile);setThemeState(couple?.theme||"rose");
      if (!couple || !partnerId) return;
      await refreshPartnerContact();
      if (generation!==loadGenerationRef.current) return;
      const [deliveryProbe,hideProbe,starProbe]=await Promise.all([supabase.from("message_deliveries").select("message_id").limit(1),supabase.from("message_hides").select("message_id").limit(1),supabase.from("message_stars").select("message_id").limit(1)]);
      deliveriesEnabledRef.current=!deliveryProbe.error;hidesEnabledRef.current=!hideProbe.error;starsEnabledRef.current=!starProbe.error;
      let stars=readLocalStarredMessageIds(user.id);
      if (starsEnabledRef.current) {
        const {data,error}=await supabase.from("message_stars").select("message_id").eq("user_id",user.id).limit(LOCAL_STARRED_LIMIT);
        if (error) throw error;
        stars=new Set((data||[]).map(row=>String(row.message_id)));
      }
      const [page,memoryPage,dateResult]=await Promise.all([fetchMessagePage(supabase,couple.id,user.id,deliveriesEnabledRef.current,hidesEnabledRef.current),readMemoryPage(supabase,couple.id),supabase.from("important_dates").select("*").eq("couple_id",couple.id).order("date",{ascending:true})]);
      if (dateResult.error) throw dateResult.error;
      const live=await Promise.all(page.rows.map(row=>hydrateMessage(row,user.id)));
      if (generation!==loadGenerationRef.current) return;
      starredIdsRef.current=stars;writeLocalStarredMessageIds(user.id,stars);
      setMessages(mergeMessageGroups(readOutbox({userId:user.id,coupleId:couple.id}).filter(row=>!row.cancelled).map(pendingMessage),live.map(row=>({...row,starred:stars.has(row.id)}))));
      olderCursorRef.current=page.nextBefore;setHasOlderMessages(page.hasMore);
      memoryCursorRef.current=memoryPage.cursor;setMemories(memoryPage.items);setHasOlderMemories(memoryPage.more);
      setDates(((dateResult.data||[]) as ImportantDateRow[]).map(mapImportantDate));
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
      channelRef.current=createCoupleRealtime({supabase,coupleId:couple.id,userId:user.id,partnerId,hydrateMessage,
        setMessages:action=>{if(profileRef.current.myUserId===user.id&&profileRef.current.coupleId===couple.id)setMessages(action);},
        setMemories:action=>{if(profileRef.current.myUserId===user.id&&profileRef.current.coupleId===couple.id)setMemories(action);},
        setDates:action=>{if(profileRef.current.myUserId===user.id&&profileRef.current.coupleId===couple.id)setDates(action);},
        setProfile:action=>{if(profileRef.current.myUserId===user.id&&profileRef.current.coupleId===couple.id)setProfile(action);},
        setTheme:action=>{if(profileRef.current.myUserId===user.id)setThemeState(action);},
        setPartnerTyping:action=>{if(profileRef.current.myUserId===user.id)setPartnerTyping(action);},
        deliveriesEnabled:deliveriesEnabledRef.current,hidesEnabled:hidesEnabledRef.current,starsEnabled:starsEnabledRef.current,
        markDelivered:ids=>recordDeliveries(supabase,user.id,ids).catch(()=>undefined),onConnectionChange:setChatConnection,
        onDataChange:()=>{void refreshUnreadFor(supabase,couple.id,user.id).catch(error=>setLoadError(String(error.message||error)));},
        onStarChange:(id,starred)=>{const next=new Set(starredIdsRef.current);if(starred)next.add(id);else next.delete(id);starredIdsRef.current=next;writeLocalStarredMessageIds(user.id,next);},
        onSubscribed:()=>{void syncRecentFor(supabase,couple.id,user.id,deliveriesEnabledRef.current);void refreshSharedStory().catch(()=>undefined);},
        onContactChange:()=>{void refreshPartnerContact();}
      });
      const incoming=live.filter(row=>row.sender==="partner"&&!row.delivered).map(row=>row.id);
      if (deliveriesEnabledRef.current) void recordDeliveries(supabase,user.id,incoming).catch(()=>undefined);
      await refreshUnreadFor(supabase,couple.id,user.id);
    } catch(error:unknown) {
      if (generation===loadGenerationRef.current) setLoadError(error instanceof Error ? error.message : "Could not load your private space. Retry.");
    } finally {if(generation===loadGenerationRef.current)setLoading(false);}
  },[hydrateMessage,readMemoryPage,refreshUnreadFor,syncRecentFor,refreshPartnerContact,refreshSharedStory]);

  useEffect(() => {
    void loadSupabase();
    const supabase = getSupabaseBrowser();
    const sub = supabase?.auth.onAuthStateChange((_event,session) => {
      if (activeUserRef.current!==session?.user.id) {
        ++loadGenerationRef.current;profileRef.current=EMPTY_PROFILE;
        ++contactRequestRef.current;setContactPreferencesError("");
        setProfile(EMPTY_PROFILE);setMessages([]);setMemories([]);setDates([]);setUnreadCount(0);setReplyDraft(null);
        if(channelRef.current){void supabase?.removeChannel(channelRef.current);channelRef.current=null;}
      }
      setTimeout(()=>void loadSupabase(),0);
    });
    return () => { if (supabase && channelRef.current) supabase.removeChannel(channelRef.current); sub?.data.subscription.unsubscribe(); };
  }, [loadSupabase]);

  useEffect(() => {
    if (!configured || !profile.myUserId) return;
    const supabase=getSupabaseBrowser();if(!supabase)return;
    const userId=profile.myUserId,partnerId=profile.partnerUserId,coupleId=profile.coupleId;
    const owner={myUserId:userId,partnerUserId:partnerId,coupleId};
    return startAppPresence(supabase,userId,coupleId||undefined,rows=>{
      setProfile(previous=>applyAppPresence(previous,owner,rows));
    },error=>{
      setProfile(previous=>samePresenceOwner(previous,owner)?{...previous,presenceError:error}:previous);
    });
  },[configured,profile.myUserId,profile.partnerUserId,profile.coupleId]);

  useEffect(() => {
    if (!configured || !profile.myUserId) return;
    const touch = () => {
      if (document.visibilityState === "hidden") return;
      if (navigator.onLine) { void resyncMessages(); void refreshPartnerContact(); }
    };
    const poll=window.setInterval(()=>{if(document.visibilityState==="visible"&&navigator.onLine){void resyncMessages();void refreshPartnerContact();}},25000);
    document.addEventListener("visibilitychange", touch);
    window.addEventListener("focus", touch);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", touch);
      window.removeEventListener("focus", touch);
    };
  }, [configured, profile.myUserId, resyncMessages, refreshPartnerContact]);

  const memoriesRef=useRef(memories);memoriesRef.current=memories;
  useEffect(()=>{
    let cancelled=false,inFlight=false;
    const renew=async()=>{
      const owner=profileRef.current;
      if(inFlight||!owner.myUserId||!owner.paired||!navigator.onLine)return;
      inFlight=true;
      try{
        const oldMessages=messagesRef.current,oldMemories=memoriesRef.current;
        const [renewedMessages,renewedMemories,myAvatarUrl,partnerAvatarUrl,storyPhotoUrl]=await Promise.all([
          Promise.all(oldMessages.map(async item=>({...item,mediaUrl:item.mediaPath?(await signMediaPath(item.mediaPath))||item.mediaUrl:item.mediaUrl}))),
          Promise.all(oldMemories.map(async item=>({...item,src:item.mediaPath?(await signMediaPath(item.mediaPath))||item.src:item.src}))),
          resolveMediaReference(owner.myAvatarPath),resolveMediaReference(owner.partnerAvatarPath),signMediaPath(owner.storyPhotoPath)]);
        if(cancelled||profileRef.current.myUserId!==owner.myUserId)return;
        const messageUrls=new Map(renewedMessages.map(item=>[item.id,item.mediaUrl])),memoryUrls=new Map(renewedMemories.map(item=>[item.id,item.src]));
        setMessages(current=>current.some(item=>messageUrls.has(item.id)&&messageUrls.get(item.id)!==item.mediaUrl)?current.map(item=>messageUrls.has(item.id)?{...item,mediaUrl:messageUrls.get(item.id)}:item):current);
        setMemories(current=>current.some(item=>memoryUrls.has(item.id)&&memoryUrls.get(item.id)!==item.src)?current.map(item=>memoryUrls.has(item.id)?{...item,src:memoryUrls.get(item.id)!}:item):current);
        setProfile(current=>current.myAvatarUrl===myAvatarUrl&&current.partnerAvatarUrl===partnerAvatarUrl&&current.storyPhotoUrl===storyPhotoUrl?current:{...current,myAvatarUrl,partnerAvatarUrl,storyPhotoUrl});
      }finally{inFlight=false;}
    };
    const onVisible=()=>{if(document.visibilityState==="visible")void renew().catch(()=>undefined);};
    const timer=window.setInterval(onVisible,30*60*1000);window.addEventListener("focus",onVisible);document.addEventListener("visibilitychange",onVisible);
    return ()=>{cancelled=true;window.clearInterval(timer);window.removeEventListener("focus",onVisible);document.removeEventListener("visibilitychange",onVisible);};
  },[profile.myUserId]);

  const notifyPartner = useCallback(async (messageId: string) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return;
    fetch("/api/push/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messageId }) }).catch(() => undefined);
  }, []);

  const flushQueue=useCallback(async () => {
    const profile=profileRef.current,supabase=getSupabaseBrowser();
    if (!supabase||flushInFlightRef.current||!profile.paired||!profile.myUserId||!profile.coupleId||!navigator.onLine) return;
    const owner={userId:profile.myUserId,coupleId:profile.coupleId};
    const active=()=>navigator.onLine&&profileRef.current.myUserId===owner.userId&&profileRef.current.coupleId===owner.coupleId;
    if ((await supabase.auth.getSession()).data.session?.user.id!==owner.userId || !active()) return;
    flushInFlightRef.current=true;
    try {
      await flushOwnedQueue({active,read:()=>readOutbox(owner),write:items=>writeOutbox(items,owner),
        save:async item=>{const {data,error}=await supabase.from("messages").upsert({id:item.tempId,couple_id:owner.coupleId,sender_id:owner.userId,type:"text",body:item.body,reply_to:item.replyTo?.id||null,reply_snapshot:item.replyTo},{onConflict:"id"}).select().single();if(error)throw error;return data as MessageRow;},
        find:async id=>{const {data,error}=await supabase.from("messages").select("*").eq("id",id).eq("sender_id",owner.userId).maybeSingle();if(error)throw error;return data as MessageRow|null;},
        update:async(id,body)=>{const {data,error}=await supabase.from("messages").update({body,edited_at:new Date().toISOString()}).eq("id",id).eq("sender_id",owner.userId).select().single();if(error)throw error;return data as MessageRow;},
        remove:async id=>{const {error}=await supabase.from("messages").delete().eq("id",id).eq("sender_id",owner.userId);if(error)throw error;},
        acknowledge:async row=>{const hydrated=await hydrateMessage(row,owner.userId);if(!active())return;setMessages(previous=>upsertMessage(previous,{...hydrated,pending:false,failed:false}));void notifyPartner(row.id);},
        removed:id=>setMessages(previous=>previous.filter(row=>row.id!==id)),
        failed:id=>{setMessages(previous=>previous.map(row=>row.id===id?{...row,pending:false,failed:true}:row));setLoadError("A queued action failed. Retry or delete that message; other messages can still send.");}
      });
    } finally {flushInFlightRef.current=false;}
  },[profile.paired,profile.coupleId,profile.myUserId,hydrateMessage,notifyPartner]);

  useEffect(() => {
    const online = () => {
      setChatConnection("connecting");
      void flushQueue();
      void resyncMessages();
    };
    const offline = () => setChatConnection("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    if (!navigator.onLine) offline();
    else void flushQueue();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [flushQueue, resyncMessages]);

  const sendText = async (body: string) => {
    const clean = body.trim();
    if (!clean || !profile.paired || !profile.myUserId || !profile.coupleId) return;
    const queued = createQueuedText(clean, replyDraft);
    setReplyDraft(null);
    writeOutbox([...readOutbox({userId:profile.myUserId||"",coupleId:profile.coupleId}),queued],{userId:profile.myUserId,coupleId:profile.coupleId});
    setMessages(previous => upsertMessage(previous, pendingMessage(queued)));
    // Optimistic send: resolve immediately so the composer never waits on the network.
    if (typeof navigator !== "undefined" && navigator.onLine) void flushQueue();
  };

  const retryMessage = async (id: string) => {
    const queue = readOutbox({userId:profile.myUserId||"",coupleId:profile.coupleId});
    const index = queue.findIndex(item => item.tempId === id);
    if (index < 0) return;
    queue[index] = { ...queue[index], lastError: undefined };
    writeOutbox(queue,{userId:profile.myUserId||"",coupleId:profile.coupleId});
    setMessages(previous => previous.map(message => message.id === id ? { ...message, pending: true, failed: false } : message));
    await flushQueue();
  };

  const sendMedia = async (file: File, kind: "image" | "voice" | "video", duration?: number, options?: MediaSendOptions) => {
    if (!profile.paired || !profile.myUserId || !profile.coupleId) return;
    if (file.size > 15 * 1024 * 1024) throw new Error("File is larger than the 15 MB limit.");
    const supabase = getSupabaseBrowser()!;
    const mediaReply = replyDraft;
    setReplyDraft(null);
    const fallbackExt = kind === "voice" ? (file.type.includes("mp4") ? "m4a" : "webm") : kind === "video" ? "mp4" : "jpg";
    const ext = mediaExtension(file, fallbackExt);
    const path = storagePath(profile.coupleId, profile.myUserId, "messages", ext);
    const messageId=crypto.randomUUID();
    let uploaded = false;
    let committed=false;
    let safeCleanup=true;

    try {
      await uploadChatMedia(path, file, options?.onProgress, options?.signal);
      uploaded = true;
      if (options?.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
      let { data, error } = await supabase.from("messages").insert({
        id:messageId,
        couple_id: profile.coupleId,
        sender_id: profile.myUserId,
        type: kind,
        media_path: path,
        duration_seconds: duration || null,
        reply_to: mediaReply?.id || null,
        reply_snapshot: mediaReply,
      }).select().single();
      if(error){
        const recovery=await supabase.from("messages").select("*").eq("id",messageId).maybeSingle();
        safeCleanup=!recovery.error&&!recovery.data;
        if(!recovery.data)throw error;
        data=recovery.data;error=null;
      }
      committed=true;
      if (options?.signal?.aborted) {
        const deletion=await supabase.from("messages").delete().eq("id",messageId).eq("sender_id",profile.myUserId);
        if(deletion.error)throw deletion.error;
        committed=false;safeCleanup=true;
        throw new DOMException("Upload cancelled", "AbortError");
      }
      const hydrated = await hydrateMessage(data as MessageRow, profile.myUserId);
      if(profileRef.current.myUserId!==profile.myUserId||profileRef.current.coupleId!==profile.coupleId)return;
      setMessages(previous => upsertMessage(previous, hydrated));
      void notifyPartner(hydrated.id);
    } catch (error) {
      if (uploaded && !committed && safeCleanup) {
        try { await supabase.storage.from("couple-media").remove([path]); } catch { /* best-effort cleanup */ }
      }
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      if (mediaReply && !cancelled && profileRef.current.myUserId===profile.myUserId) setReplyDraft(current => current || mediaReply);
      throw error;
    }
  };

  const reactToMessage = async (id: string, emoji = "♥") => {
    const supabase = getSupabaseBrowser()!; if (!profile.myUserId) return;
    const { data: existing,error:readError } = await supabase.from("reactions").select("emoji").eq("message_id", id).eq("user_id", profile.myUserId).maybeSingle();
    if(readError)throw readError;
    if (existing?.emoji === emoji) {
      const {error}=await supabase.from("reactions").delete().eq("message_id", id).eq("user_id", profile.myUserId);
      if(error)throw error;
    } else if (existing) {
      const {error}=await supabase.from("reactions").update({ emoji }).eq("message_id", id).eq("user_id", profile.myUserId);
      if(error)throw error;
    } else {
      const {error}=await supabase.from("reactions").insert({ message_id: id, user_id: profile.myUserId, emoji });
      if(error)throw error;
    }
  };

  const editMessage = async (id: string, body: string) => {
    const clean = body.trim(); if (!clean || !profile.myUserId) return;
    const target = messages.find(message => message.id === id);
    if (!target || target.sender !== "me" || target.type !== "text") throw new Error("Only your text messages can be edited.");

    const queue = readOutbox({userId:profile.myUserId||"",coupleId:profile.coupleId});
    const queuedIndex = queue.findIndex(item => item.tempId === id);
    if (queuedIndex >= 0) {
      queue[queuedIndex] = { ...queue[queuedIndex], body: clean };
      writeOutbox(queue,{userId:profile.myUserId||"",coupleId:profile.coupleId});
      setMessages(previous => previous.map(message => message.id === id ? { ...message, body: clean, edited: true } : message));
      if (typeof navigator !== "undefined" && navigator.onLine) void flushQueue();
      return;
    }

    setMessages(previous => previous.map(message => message.id === id ? { ...message, body: clean, edited: true } : message));
    const { error } = await getSupabaseBrowser()!.from("messages").update({ body: clean, edited_at: new Date().toISOString() }).eq("id", id).eq("sender_id", profile.myUserId);
    if (error) {
      setMessages(previous => previous.map(message => message.id === id ? target : message));
      throw error;
    }
  };

  const deleteMessage = async (id: string, scope: "me" | "everyone" = "me") => {
    if (!profile.myUserId) return;
    const target = messages.find(message => message.id === id);
    if (!target) return;

    const queue = readOutbox({userId:profile.myUserId||"",coupleId:profile.coupleId});
    if (queue.some(item => item.tempId === id)) {
      writeOutbox(queue.map(item=>item.tempId===id ? {...item,cancelled:true,lastError:undefined}:item),{userId:profile.myUserId,coupleId:profile.coupleId});
      setMessages(previous => previous.filter(message => message.id !== id));
      if(navigator.onLine)void flushQueue();
      return;
    }

    const supabase = getSupabaseBrowser()!;

    if (scope === "me") {
      // Make the action deterministic first. The local hide survives app reloads
      // on this device and is also mirrored to Supabase when V2.2 storage exists.
      rememberLocalHiddenMessage(profile.myUserId, id);
      setMessages(previous => previous.filter(message => message.id !== id));

      if (hidesEnabledRef.current) {
        const { error } = await supabase
          .from("message_hides")
          .upsert({ message_id: id, user_id: profile.myUserId }, { onConflict: "message_id,user_id", ignoreDuplicates: true });
        if (error) {
          console.warn("Server hide unavailable; keeping local Delete for me", error.message);
          hidesEnabledRef.current = false;
        }
      }
      return;
    }

    if (target.type === "call") throw new Error("Call history cannot be deleted for everyone.");
    if (target.sender !== "me") throw new Error("Only the sender can delete a message for everyone.");

    // V2.2.6 deliberately uses the original hard-delete path. The base schema
    // already grants senders DELETE on their own messages, so this works without
    // deleted_at/deleted_by columns, helper RPCs, or PostgREST schema refreshes.
    setMessages(previous => previous.filter(message => message.id !== id));
    const { data: removed, error } = await supabase
      .from("messages")
      .delete()
      .eq("id", id)
      .eq("sender_id", profile.myUserId)
      .select("id")
      .maybeSingle();

    if (error || !removed) {
      setMessages(previous => upsertMessage(previous, target));
      throw new Error(error?.message || "Could not delete this message for everyone.");
    }

    if (target.mediaPath) {
      const { error: storageError } = await supabase.storage.from("couple-media").remove([target.mediaPath]);
      if (storageError) console.warn("Message deleted, but media cleanup failed", storageError.message);
    }
  };

  const togglePin = async (id: string) => {
    const target = messages.find(m => m.id === id); if (!target) return;
    const { error } = await getSupabaseBrowser()!.rpc("set_message_pin", { p_message: id, p_pinned: !target.pinned });
    if (error) throw error;
    setMessages(prev => prev.map(m => m.id === id ? { ...m, pinned: !target.pinned } : m));
  };

  const toggleStar = async (id: string) => {
    if (!profile.myUserId) return;
    const target = messages.find(message => message.id === id);
    if (!target || target.pending || target.failed) return;
    const next = !target.starred;
    const previousIds = new Set(starredIdsRef.current);
    const nextIds = new Set(previousIds);
    if (next) nextIds.add(id); else nextIds.delete(id);
    starredIdsRef.current = nextIds;
    writeLocalStarredMessageIds(profile.myUserId, nextIds);
    setMessages(current => current.map(message => message.id === id ? { ...message, starred: next } : message));

    if (!starsEnabledRef.current) return;
    const supabase = getSupabaseBrowser()!;
    const result = next
      ? await supabase.from("message_stars").upsert({ message_id: id, user_id: profile.myUserId }, { onConflict: "message_id,user_id", ignoreDuplicates: true })
      : await supabase.from("message_stars").delete().eq("message_id", id).eq("user_id", profile.myUserId);
    if (result.error) {
      starredIdsRef.current = previousIds;
      writeLocalStarredMessageIds(profile.myUserId, previousIds);
      setMessages(current => current.map(message => message.id === id ? { ...message, starred: Boolean(target.starred) } : message));
      throw result.error;
    }
  };

  const searchChat = useCallback(async (input: ChatSearchInput) => {
    const current = profileRef.current;
    if (!current.paired || !current.coupleId || !current.myUserId) return [] as Message[];
    const supabase = getSupabaseBrowser();
    if (!supabase) return [] as Message[];

    const result:Message[]=[];let cursor=input.before;
    while(result.length<160){
      let query=supabase.from("messages").select(richMessageSelect(deliveriesEnabledRef.current)).eq("couple_id",current.coupleId);
      const text=(input.query||"").trim();
      if(text)query=query.ilike("body",`%${text.replace(/[\\%_]/g,value=>`\\${value}`)}%`);
      if(input.type&&input.type!=="all"&&input.type!=="links"&&input.type!=="media")query=query.eq("type",input.type);
      if(input.type==="links")query=query.eq("type","text").or("body.ilike.%http://%,body.ilike.%https://%");
      if(input.type==="media")query=query.in("type",["image","video"]);
      if(cursor)query=query.or(olderFilter(cursor));
      if(input.sender==="me")query=query.eq("sender_id",current.myUserId);
      if(input.sender==="partner"&&current.partnerUserId)query=query.eq("sender_id",current.partnerUserId);
      if(input.date){const start=new Date(`${input.date}T00:00:00`),end=new Date(start);end.setDate(end.getDate()+1);if(!Number.isNaN(start.getTime()))query=query.gte("created_at",start.toISOString()).lt("created_at",end.toISOString());}
      const {data,error}=await query.order("created_at",{ascending:false}).order("id",{ascending:false}).limit(160);
      if(error)throw error;
      if(profileRef.current.myUserId!==current.myUserId)throw new Error("Account changed. Search cancelled.");
      const raw=(data||[]) as unknown as MessageRow[];
      const visible=await removeHiddenMessages(supabase,current.myUserId,raw,hidesEnabledRef.current);
      result.push(...await Promise.all(visible.map(row=>hydrateMessage(row,current.myUserId))));
      if(raw.length<160)break;
      const last=raw[raw.length-1];cursor={id:last.id,created_at:last.created_at};
    }
    return result.slice(0,160);
  }, [hydrateMessage]);

  const loadDate = useCallback(async (date: string) => {
    if (!date) return null;
    const current=profileRef.current,supabase=getSupabaseBrowser();
    if(!supabase||!current.myUserId||!current.coupleId)return null;
    const start=new Date(`${date}T00:00:00`),end=new Date(start);end.setDate(end.getDate()+1);
    let offset=0;
    while(true){
      const {data,error}=await supabase.from("messages").select("*").eq("couple_id",current.coupleId).gte("created_at",start.toISOString()).lt("created_at",end.toISOString()).order("created_at",{ascending:true}).order("id",{ascending:true}).range(offset,offset+159);
      if(error)throw error;
      const raw=(data||[]) as MessageRow[],visible=await removeHiddenMessages(supabase,current.myUserId,raw,hidesEnabledRef.current);
      if(visible.length)return visible[0].id;
      if(raw.length<160)return null;offset+=160;
    }
  }, [searchChat]);

  const loadSavedMessages = useCallback(async () => {
    const current = profileRef.current;
    if (!current.paired || !current.coupleId || !current.myUserId) return [] as Message[];
    const supabase = getSupabaseBrowser();
    if (!supabase) return [] as Message[];

    const rows:MessageRow[]=[];
    const starIds=[...starredIdsRef.current];
    for(let offset=0;offset<starIds.length;offset+=100){
      const {data,error}=await supabase.from("messages").select(richMessageSelect(deliveriesEnabledRef.current)).eq("couple_id",current.coupleId).in("id",starIds.slice(offset,offset+100));
      if(error)throw error;rows.push(...(data||[]) as unknown as MessageRow[]);
    }
    const pins=await collectPages(async(cursor,limit)=>{
      let query=supabase.from("messages").select(richMessageSelect(deliveriesEnabledRef.current)).eq("couple_id",current.coupleId).eq("pinned",true);
      if(cursor)query=query.or(olderFilter(cursor));
      const {data,error}=await query.order("created_at",{ascending:false}).order("id",{ascending:false}).limit(limit);
      if(error)throw error;return (data||[]) as unknown as MessageRow[];
    });
    rows.push(...pins);
    const unique = [...new Map<string, MessageRow>(rows.map(row => [row.id, row] as const)).values()];
    const visible = await removeHiddenMessages(supabase, current.myUserId, unique, hidesEnabledRef.current);
    const hydrated = await Promise.all(visible.map(row => hydrateMessage(row, current.myUserId)));
    return hydrated;
  }, [hydrateMessage]);

  const ensureMessageLoaded = useCallback(async (id: string) => {
    if (!id) return false;
    if (messagesRef.current.some(message => message.id === id)) return true;
    const current = profileRef.current;
    if (!current.paired || !current.coupleId || !current.myUserId) return false;
    const supabase = getSupabaseBrowser();
    if (!supabase) return false;
    const { data: targetData, error } = await supabase.from("messages").select(richMessageSelect(deliveriesEnabledRef.current)).eq("couple_id", current.coupleId).eq("id", id).maybeSingle();
    if (error || !targetData) return false;
    const target = targetData as unknown as MessageRow;
    const [beforeResult, afterResult] = await Promise.all([
      supabase.from("messages").select(richMessageSelect(deliveriesEnabledRef.current)).eq("couple_id", current.coupleId).lt("created_at", target.created_at).order("created_at", { ascending: false }).limit(12),
      supabase.from("messages").select(richMessageSelect(deliveriesEnabledRef.current)).eq("couple_id", current.coupleId).gt("created_at", target.created_at).order("created_at", { ascending: true }).limit(12),
    ]);
    if(beforeResult.error)throw beforeResult.error;if(afterResult.error)throw afterResult.error;
    const contextRows = [
      ...((beforeResult.data || []) as unknown as MessageRow[]).reverse(),
      target,
      ...((afterResult.data || []) as unknown as MessageRow[]),
    ];
    const visible = await removeHiddenMessages(supabase, current.myUserId, contextRows, hidesEnabledRef.current);
    if (!visible.some(row => row.id === id)) return false;
    const hydrated = await Promise.all(visible.map(row => hydrateMessage(row, current.myUserId)));
    setMessages(existing => hydrated.reduce((acc, message) => upsertMessage(acc, message), existing));
    return true;
  }, [hydrateMessage]);

  const setTyping = useCallback((value: boolean) => {
    if (channelRef.current && profile.myUserId) {
      void channelRef.current.send({ type: "broadcast", event: "typing", payload: { userId: profile.myUserId, typing: value } });
    }
  }, [profile.myUserId]);

  const markMessagesRead = useCallback(async (ids:string[]) => {
    if (!profile.myUserId || !profile.coupleId) return;
    const visibleIds=new Set(ids);
    const targets = messages.filter(m => visibleIds.has(m.id) && m.sender === "partner" && !m.readByMe && !m.pending && !m.id.startsWith("temp-"));
    if (!targets.length) return;
    const seenAt = new Date().toISOString();
    setMessages(prev => prev.map(m => targets.some(t => t.id === m.id) ? { ...m, readByMe: true } : m));
    const rows = targets.map(m => ({ message_id: m.id, user_id: profile.myUserId!, seen_at: seenAt }));
    const { error } = await getSupabaseBrowser()!.from("message_reads").upsert(rows, { onConflict: "message_id,user_id", ignoreDuplicates: true });
    if (error) {
      setMessages(prev => prev.map(m => targets.some(t => t.id === m.id) ? { ...m, readByMe: false } : m));
      setLoadError("Could not save read receipts. Retry synchronization.");
      throw error;
    }
    await refreshUnreadFor(getSupabaseBrowser()!,profile.coupleId,profile.myUserId);
  }, [messages, profile.coupleId, profile.myUserId,refreshUnreadFor]);

  const addMemory = async (file: File, caption?: string, stableId?: string) => {
    if (!profile.paired || !profile.myUserId) throw new Error("Pair your accounts before adding memories.");
    const invalid=validateMemoryFile(file);if(invalid)throw new Error(invalid);
    const supabase = getSupabaseBrowser()!;
    if((await supabase.auth.getSession()).data.session?.user.id!==profile.myUserId)throw new Error("Your account changed. Reopen the upload window.");
    const memoryId=stableId||crypto.randomUUID();
    if(stableId){const existing=await supabase.from("memories").select("*").eq("id",memoryId).eq("couple_id",profile.coupleId).maybeSingle();if(existing.error)throw existing.error;if(existing.data){const item=mapMemory(existing.data as MemoryRow,(await signMediaPath(existing.data.media_path))||"");if(profileRef.current.myUserId===profile.myUserId)setMemories(prev=>prev.some(m=>m.id===item.id)?prev:[item,...prev]);return;}}
    const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
    const ext = mediaExtension(file, kind === "video" ? "mp4" : "jpg");
    const path = `${profile.coupleId}/${profile.myUserId}/memories/${memoryId}.${ext}`;
    const { error: upErr } = await supabase.storage.from("couple-media").upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr && (!stableId || !["409","400"].includes(String(upErr.statusCode)) || !/exist|duplicate/i.test(upErr.message))) throw upErr;
    const label = (caption || file.name.replace(/\.[^.]+$/, "") || "Untitled memory").trim();
    let { data, error } = await supabase.from("memories").insert({ id:memoryId,couple_id: profile.coupleId, media_path: path, caption: label, taken_at: new Date().toISOString(), created_by: profile.myUserId, favorite: false, kind }).select().single();
    if(error){
      const recovery=await supabase.from("memories").select("*").eq("id",memoryId).maybeSingle();
      if(recovery.data){data=recovery.data;error=null;}
      else{if(!recovery.error){const cleanup=await supabase.storage.from("couple-media").remove([path]);if(cleanup.error)console.warn("Memory cleanup failed",cleanup.error.message);}throw error;}
    }
    const item: MemoryItem = { id: data.id, src: (await signMediaPath(path)) || "", caption: label, date: data.taken_at, favorite: false, kind, mediaPath: path };
    if(profileRef.current.myUserId!==profile.myUserId||profileRef.current.coupleId!==profile.coupleId)return;
    setMemories(prev => prev.some(m => m.id === item.id) ? prev : [item, ...prev]);
  };

  const toggleFavorite = async (id: string) => {
    const target = memories.find(m => m.id === id); if (!target) return;
    setMemories(prev => prev.map(m => m.id === id ? { ...m, favorite: !m.favorite } : m));
    const { error } = await getSupabaseBrowser()!.from("memories").update({ favorite: !target.favorite }).eq("id", id);
    if (error) { setMemories(prev => prev.map(m => m.id === id ? { ...m, favorite: target.favorite } : m)); throw error; }
  };

  const deleteMemory = async (id: string) => {
    const target = memories.find(m => m.id === id); if (!target) return;
    const supabase = getSupabaseBrowser()!;
    const { error } = await supabase.from("memories").delete().eq("id", id);
    if (error) throw error;
    if (target.mediaPath) await supabase.storage.from("couple-media").remove([target.mediaPath]);
    setMemories(prev => prev.filter(m => m.id !== id));
  };

  const addDate = async (input: Omit<ImportantDate, "id">,photo?:File,id=crypto.randomUUID()) => {
    if (!profile.paired || !profile.myUserId) throw new Error("Pair your accounts before adding a date.");
    const data=await saveImportantDate(getSupabaseBrowser()!,{userId:profile.myUserId,coupleId:profile.coupleId},id,input,false,photo);
    const item=mapImportantDate(data as ImportantDateRow);
    if(profileRef.current.myUserId===profile.myUserId&&profileRef.current.coupleId===profile.coupleId)setDates(prev => prev.some(d => d.id === item.id) ? prev : [...prev, item]);
  };

  const updateDate=async(id:string,input:Omit<ImportantDate,"id">,photo?:File)=>{
    if(!profile.myUserId||!profile.paired)throw new Error("Pair your accounts before adding a date.");
    const previous=dates.find(d=>d.id===id)?.photoPath,client=getSupabaseBrowser()!;
    const data=await saveImportantDate(client,{userId:profile.myUserId,coupleId:profile.coupleId},id,input,true,photo);
    if(profileRef.current.myUserId===profile.myUserId&&profileRef.current.coupleId===profile.coupleId)setDates(prev=>prev.map(d=>d.id===id?mapImportantDate(data as ImportantDateRow):d));
    if(previous!==data.photo_path)void cleanupDatePhoto(client,previous,profile.coupleId).catch(()=>undefined);
  };

  const deleteDate = async (id: string) => {
    if(!profile.myUserId||!profile.paired)throw new Error("Pair your accounts before adding a date.");
    const previous=dates.find(d=>d.id===id)?.photoPath,client=getSupabaseBrowser()!;
    const { error } = await client.from("important_dates").delete().eq("id", id).eq("couple_id",profile.coupleId);
    if (error) throw error;
    if(profileRef.current.myUserId===profile.myUserId&&profileRef.current.coupleId===profile.coupleId)setDates(prev => prev.filter(d => d.id !== id));
    void cleanupDatePhoto(client,previous,profile.coupleId).catch(()=>undefined);
  };

  const updateProfile = async ({ displayName, nickname, anniversary }: ProfileUpdate) => {
    if (!profile.myUserId) return;
    const supabase = getSupabaseBrowser()!;
    const name = displayName.trim(); const nick = nickname.trim();
    if (!name) throw new Error("Display name is required.");
    const { error: profileError } = await supabase.from("profiles").update({ display_name: name, nickname: nick || name }).eq("user_id", profile.myUserId);
    if (profileError) throw profileError;
    if (profile.coupleId) {
      const { error: coupleError } = await supabase.from("couples").update({ anniversary_date: anniversary || null }).eq("id", profile.coupleId);
      if (coupleError) throw coupleError;
    }
    setProfile(prev => ({ ...prev, myName: name, myNickname: nick || name, anniversary: anniversary || undefined }));
  };

  const setProfilePhoto = async (file: File) => {
    if (!profile.paired || !profile.myUserId || !profile.coupleId) throw new Error("Pair your accounts before adding a profile photo.");
    const supabase = getSupabaseBrowser()!;
    const prepared = await prepareProfilePhoto(file);
    const extension = mediaExtension(prepared, "jpg");
    const path = storagePath(profile.coupleId, profile.myUserId, "profile", extension);
    const { error: uploadError } = await supabase.storage.from("couple-media").upload(path, prepared, { contentType: prepared.type || "image/jpeg", upsert: false });
    if (uploadError) throw uploadError;

    const previous = profile.myAvatarPath;
    const { error: updateError } = await supabase.from("profiles").update({ avatar_url: path }).eq("user_id", profile.myUserId);
    if (updateError) {
      await supabase.storage.from("couple-media").remove([path]);
      throw updateError;
    }

    const myAvatarUrl = await resolveMediaReference(path);
    setProfile(current => ({ ...current, myAvatarPath: path, myAvatarUrl }));
    if (previous && previous !== path && !/^https?:\/\//i.test(previous)) {
      await supabase.storage.from("couple-media").remove([previous]).catch(() => undefined);
    }
  };

  const removeProfilePhoto = async () => {
    if (!profile.myUserId) return;
    const supabase = getSupabaseBrowser()!;
    const previous = profile.myAvatarPath;
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("user_id", profile.myUserId);
    if (error) throw error;
    setProfile(current => ({ ...current, myAvatarPath: undefined, myAvatarUrl: undefined }));
    if (previous && !/^https?:\/\//i.test(previous)) {
      await supabase.storage.from("couple-media").remove([previous]).catch(() => undefined);
    }
  };

  const updateFirstMeetingDate = async (date?: string) => {
    if (!profile.coupleId) return;
    const { error } = await getSupabaseBrowser()!.from("couples").update({ anniversary_date: date || null }).eq("id", profile.coupleId);
    if (error) throw error;
    setProfile(prev => ({ ...prev, anniversary: date || undefined }));
  };

  const setStoryPhoto = async (file: File) => {
    if (!profile.paired || !profile.myUserId || !profile.coupleId) return;
    if (!file.type.startsWith("image/")) throw new Error("Choose an image for your shared story photo.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Story photo must be smaller than 10 MB.");
    const supabase = getSupabaseBrowser()!;
    const ext = mediaExtension(file, "jpg");
    const path = storagePath(profile.coupleId, profile.myUserId, "story", ext);
    const { error: uploadError } = await supabase.storage.from("couple-media").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
    if (uploadError) throw uploadError;
    const previous = profile.storyPhotoPath;
    const { error: updateError } = await supabase.from("couples").update({ cover_media_path: path }).eq("id", profile.coupleId);
    if (updateError) {
      await supabase.storage.from("couple-media").remove([path]);
      throw updateError;
    }
    const storyPhotoUrl = await signMediaPath(path);
    setProfile(prev => ({ ...prev, storyPhotoPath: path, storyPhotoUrl }));
    if (previous && previous !== path) await supabase.storage.from("couple-media").remove([previous]);
  };

  const removeStoryPhoto = async () => {
    if (!profile.coupleId) return;
    const previous = profile.storyPhotoPath;
    const supabase = getSupabaseBrowser()!;
    const { error } = await supabase.from("couples").update({ cover_media_path: null }).eq("id", profile.coupleId);
    if (error) throw error;
    setProfile(prev => ({ ...prev, storyPhotoPath: undefined, storyPhotoUrl: undefined }));
    if (previous) await supabase.storage.from("couple-media").remove([previous]);
  };

  const setTheme=(next:string)=>{
    const previous=theme;setThemeState(next);
    if(profile.coupleId)void getSupabaseBrowser()!.from("couples").update({theme:next}).eq("id",profile.coupleId).then(({error})=>{if(error){setThemeState(previous);setLoadError("Could not save the shared theme. Retry.");}});
  };

  const saveStoryCoverSettings=async(settings:StoryCoverSettings,files:File[]=[])=>{
    const row=await saveStoryCovers(profile,settings,files);
    setProfile(prev=>prev.myUserId===profile.myUserId&&prev.coupleId===profile.coupleId?{...prev,...coverFields(row)}:prev);
  };

  const exportAllData=useCallback(async () => {
    const owner=profileRef.current,supabase=getSupabaseBrowser();
    if(!supabase||!owner.myUserId||!owner.coupleId)throw new Error("Sign in and pair your accounts first.");
    const cutoff=new Date().toISOString();
    const collect=async(table:"messages"|"memories"|"important_dates") => {
      const all=await collectPages(async(cursor,limit)=>{
        let query=supabase.from(table).select(table==="messages"?richMessageSelect(deliveriesEnabledRef.current):"*").eq("couple_id",owner.coupleId).lte("created_at",cutoff);
        if(cursor)query=query.or(olderFilter(cursor));
        const {data,error}=await query.order("created_at",{ascending:false}).order("id",{ascending:false}).limit(limit);
        if(error)throw error;
        if(profileRef.current.myUserId!==owner.myUserId)throw new Error("Account changed. Export cancelled.");
        return (data||[]) as unknown as (RowCursor&Record<string,unknown>)[];
      });
      return table==="messages" ? await removeHiddenMessages(supabase,owner.myUserId!,all as unknown as MessageRow[],hidesEnabledRef.current):all;
    };
    const [allMessages,allMemories,allDates]=await Promise.all([collect("messages"),collect("memories"),collect("important_dates")]);
    const {myAvatarUrl,partnerAvatarUrl,storyPhotoUrl,...metadata}=owner;
    void myAvatarUrl;void partnerAvatarUrl;void storyPhotoUrl;
    if(profileRef.current.myUserId!==owner.myUserId||profileRef.current.coupleId!==owner.coupleId)throw new Error("Account changed. Export cancelled.");
    const safeMessages=allMessages.map(row=>{const {media_url,...rest}=row as MessageRow&{media_url?:string};void media_url;return rest;});
    return {exportedAt:cutoff,scope:"Complete visible history and metadata; media files are not included. Concurrent edits may be reflected during export.",profile:metadata,messages:safeMessages,memories:allMemories,dates:allDates};
  },[]);

  const pairReady = Boolean(profile.paired && profile.coupleId && profile.myUserId && profile.partnerUserId);
  const value = useMemo(() => ({ configured, loading, loadError, exportAllData, hasOlderMemories, loadingOlderMemories, loadOlderMemories, pairReady, profile, messages, unreadCount, hasOlderMessages, loadingOlderMessages, chatConnection, memories, dates, theme, replyDraft, setReplyDraft, sendText, retryMessage, loadOlderMessages, resyncMessages, sendMedia, reactToMessage, editMessage, deleteMessage, togglePin, toggleStar, searchChat, loadDate, loadSavedMessages, ensureMessageLoaded, setTyping, markMessagesRead, addMemory, toggleFavorite, deleteMemory, addDate, updateDate, deleteDate, updateProfile, setPartnerContactName, contactPreferencesError, refreshPartnerContact, setProfilePhoto, removeProfilePhoto, updateFirstMeetingDate, setStoryPhoto, removeStoryPhoto, saveStoryCoverSettings, setTheme, refresh: loadSupabase }), [configured, loading, loadError, contactPreferencesError, refreshPartnerContact, exportAllData, hasOlderMemories, loadingOlderMemories, loadOlderMemories, pairReady, profile, messages, unreadCount, hasOlderMessages, loadingOlderMessages, chatConnection, memories, dates, theme, replyDraft, loadOlderMessages, resyncMessages, searchChat, loadDate, loadSavedMessages, ensureMessageLoaded, loadSupabase, markMessagesRead, setTyping]);
  return <TogetherContext.Provider value={value}><PartnerTypingContext.Provider value={typing}>{children}</PartnerTypingContext.Provider></TogetherContext.Provider>;
}

export function useTogether() {
  const ctx = useContext(TogetherContext);
  if (!ctx) throw new Error("useTogether must be used within TogetherProvider");
  return ctx;
}

export function usePartnerTyping() {
  return useContext(PartnerTypingContext);
}
