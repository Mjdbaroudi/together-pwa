"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { CalendarDays, Image as ImageIcon, Link2, Mic, Pin, Play, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { useSignedMedia } from "@/hooks/useSignedMedia";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Message } from "@/lib/types";
import type { ChatSearchInput } from "@/lib/together/types";
import { VoiceBubble } from "./VoiceBubble";

type Mode = "search" | "media" | "links" | "voice" | "saved";
type SearchFilter = "all" | "text" | "image" | "voice" | "video" | "links";
type SenderFilter = "all" | "me" | "partner";

type Props = {
  messages: Message[];
  partnerName: string;
  initialMode?: Mode;
  hasOlderMessages?: boolean;
  loadingOlderMessages?: boolean;
  onLoadOlder?: () => Promise<number>;
  onSearch?: (input: ChatSearchInput) => Promise<Message[]>;
  onJumpToDate?: (date: string) => Promise<boolean>;
  onLoadSaved?: () => Promise<Message[]>;
  onOpenMedia?: (id: string, gallery?: Message[]) => void;
  onClose: () => void;
  onJump: (id: string) => void;
};

const urlPattern = /(https?:\/\/[^\s]+)/i;

function label(message: Message) {
  if (message.deletedAt) return "Deleted message";
  if (message.body) return message.body;
  if (message.type === "image") return "Photo";
  if (message.type === "voice") return "Voice note";
  return "Message";
}

function when(value: string, locale?: string) {
  const date = new Date(value);
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function monthKey(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function sameDate(message: Message, selectedDate: string) {
  if (!selectedDate) return true;
  const date = new Date(message.createdAt);
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return local === selectedDate;
}

function dedupeMessages(groups: Message[][]) {
  const map = new Map<string, Message>();
  for (const group of groups) for (const message of group) map.set(message.id, message);
  return [...map.values()];
}

export function ChatToolsPanel({ messages, partnerName, initialMode = "search", hasOlderMessages = false, loadingOlderMessages = false, onLoadOlder, onSearch, onJumpToDate, onLoadSaved, onOpenMedia, onClose, onJump }: Props) {
  const { t: uiText, locale } = useLanguage();

  const [toolError,setToolError]=useState("");
  const [moreResults,setMoreResults]=useState(false);
  const [moreHub,setMoreHub]=useState(false);
  const [loadingMore,setLoadingMore]=useState(false);
  const [retryTick,setRetryTick]=useState(0);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [mediaFilter,setMediaFilter]=useState<"all"|"image"|"video">("all");
  const [query, setQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<SearchFilter>("all");
  const [senderFilter, setSenderFilter] = useState<SenderFilter>("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [remoteResults, setRemoteResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [dateJumpState, setDateJumpState] = useState<"" | "loading" | "missing">("");
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubRemote, setHubRemote] = useState<Message[]>([]);
  const [savedRemote, setSavedRemote] = useState<Message[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRunRef = useRef(0);

  const visibleMessages = useMemo(() => messages.filter(message => !message.deletedAt), [messages]);

  useEffect(() => {
    if (mode !== "saved" || !onLoadSaved) return;
    let cancelled = false;
    setLoadingSaved(true);setToolError("");
    void onLoadSaved().then(result => { if (!cancelled) setSavedRemote(result); }).catch(error=>{if(!cancelled)setToolError(error instanceof Error?error.message:"Could not load saved messages.");}).finally(() => { if (!cancelled) setLoadingSaved(false); });
    return () => { cancelled = true; };
  }, [mode,onLoadSaved,retryTick]);

  useEffect(() => {
    if (!onSearch || !["media", "voice", "links"].includes(mode)) return;
    let cancelled = false;
    setHubLoading(true);setToolError("");setHubRemote([]);
    const type: ChatSearchInput["type"] = mode === "media" ? "media" : mode === "voice" ? "voice" : "links";
    void onSearch({ type }).then(result => { if(!cancelled){setHubRemote(result);setMoreHub(result.length===160);} }).catch(error=>{if(!cancelled)setToolError(error instanceof Error?error.message:"Could not load media history.");}).finally(() => { if (!cancelled) setHubLoading(false); });
    return () => { cancelled = true; };
  }, [mode,onSearch,retryTick]);

  useEffect(() => {
    if (mode !== "search" || !onSearch) return;
    const needle = query.trim();
    const meaningful = needle.length >= 2 || Boolean(selectedDate) || searchFilter !== "all" || senderFilter !== "all";
    if (!meaningful) {
      setRemoteResults([]);
      setSearching(false);
      return;
    }
    const runId = ++searchRunRef.current;
    setSearching(true);setToolError("");
    const timer = window.setTimeout(() => {
      void onSearch({ query: needle, type: searchFilter, sender: senderFilter, date: selectedDate }).then(result => {
        if(searchRunRef.current===runId){setRemoteResults(result);setMoreResults(result.length===160);}
      }).catch(error => {
        if(searchRunRef.current===runId){setRemoteResults([]);setToolError(error instanceof Error?error.message:"Search failed. Try again.");}
      }).finally(() => {
        if (searchRunRef.current === runId) setSearching(false);
      });
    }, 260);
    return ()=>{window.clearTimeout(timer);++searchRunRef.current;};
  }, [mode, onSearch, query, searchFilter, selectedDate, senderFilter,retryTick]);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle && !selectedDate && searchFilter === "all" && senderFilter === "all") return [];
    const combined = dedupeMessages([visibleMessages, remoteResults]);
    return combined.filter(message => {
      if (!sameDate(message, selectedDate)) return false;
      if (senderFilter !== "all" && message.sender !== senderFilter) return false;
      const hasLink = Boolean(message.body?.match(urlPattern));
      if (searchFilter === "text" && message.type !== "text") return false;
      if (searchFilter === "image" && message.type !== "image") return false;
      if (searchFilter === "voice" && message.type !== "voice") return false;
      if(searchFilter==="video"&&message.type!=="video")return false;
      if (searchFilter === "links" && !hasLink) return false;
      if (!needle) return true;
      return (message.body || label(message)).toLocaleLowerCase().includes(needle);
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [visibleMessages, remoteResults, query, searchFilter, selectedDate, senderFilter]);

  const hubMessages = useMemo(() => dedupeMessages([visibleMessages, hubRemote]), [visibleMessages, hubRemote]);
  const savedMessages = useMemo(() => dedupeMessages([savedRemote,visibleMessages]), [visibleMessages, savedRemote]);
  const media = useMemo(() => hubMessages.filter(message => (message.type === "image"||message.type === "video") && message.mediaUrl).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [hubMessages]);
  const voices = useMemo(() => hubMessages.filter(message => message.type === "voice" && message.mediaUrl).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [hubMessages]);
  const links = useMemo(() => hubMessages.flatMap(message => {
    const match = message.body?.match(urlPattern);
    return match ? [{ message, url: match[1] }] : [];
  }).sort((a, b) => new Date(b.message.createdAt).getTime() - new Date(a.message.createdAt).getTime()), [hubMessages]);
  const starred = useMemo(() => savedMessages.filter(message => message.starred).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [savedMessages]);
  const pinned = useMemo(() => savedMessages.filter(message => message.pinned).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [savedMessages]);

  const selectedMedia=useMemo(()=>media.filter(message=>mediaFilter==="all"||message.type===mediaFilter),[media,mediaFilter]);
  const groupedMedia = useMemo(() => {
    const map = new Map<string, Message[]>();
    for (const message of selectedMedia) {
      const key = monthKey(message.createdAt);
      const group=map.get(key);if(group)group.push(message);else map.set(key,[message]);
    }
    return Array.from(map.entries());
  }, [selectedMedia]);

  function switchMode(next: Mode) {
    ++searchRunRef.current;setMode(next);setToolError("");
    if (next === "search") requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function jumpToSelectedDate() {
    if (!selectedDate || !onJumpToDate) return;
    setDateJumpState("loading");
    try {
      const found = await onJumpToDate(selectedDate);
      if (!found) setDateJumpState("missing");
    } catch {
      setDateJumpState("missing");
    }
  }

  async function loadMoreResults(){
    if(!onSearch||loadingMore)return;
    const rows=mode==="search"?remoteResults:hubRemote,last=rows[rows.length-1];if(!last)return;
    const run=searchRunRef.current,requestedMode=mode;setLoadingMore(true);setToolError("");
    try{
      const result=await onSearch({query:requestedMode==="search"?query:undefined,type:requestedMode==="search"?searchFilter:requestedMode==="media"?"media":requestedMode==="voice"?"voice":"links",sender:requestedMode==="search"?senderFilter:undefined,date:requestedMode==="search"?selectedDate:undefined,before:{id:last.id,created_at:last.createdAt}});
      if(run!==searchRunRef.current)return;
      if(requestedMode==="search"){setRemoteResults(previous=>dedupeMessages([previous,result]));setMoreResults(result.length===160);}
      else{setHubRemote(previous=>dedupeMessages([previous,result]));setMoreHub(result.length===160);}
    }catch(error:unknown){setToolError(error instanceof Error?error.message:"Could not load more results.");}finally{setLoadingMore(false);}
  }

  const filtersActive = searchFilter !== "all" || senderFilter !== "all" || Boolean(selectedDate);
  const title = mode === "search" ? "Search chat" : mode === "media" ? "Shared moments" : mode === "links" ? "Shared links" : mode === "voice" ? "Voice notes" : "Saved messages";

  return <div className="chat-tools-panel chat-tools-panel-v23 chat-tools-v32" role="dialog" aria-modal="true" aria-label={uiText("Chat tools")}>
    <div className="chat-tools-header">
      <div><span className="chat-tools-eyebrow">{uiText("YOUR CONVERSATION")}</span><strong>{uiText(title)}</strong><span>{uiText("Between you and ")}<span dir="auto">{partnerName}</span></span></div>
      <button onClick={onClose} aria-label={uiText("Close")}><X size={19}/></button>
    </div>

    <div className="chat-tools-tabs chat-tools-tabs-v23" role="group" aria-label={uiText("Chat tools")}>
      <button aria-pressed={mode === "search"} className={mode === "search" ? "active" : ""} onClick={() => switchMode("search")}><Search size={16}/><span>{uiText("Search")}</span></button>
      <button aria-pressed={mode === "media"} className={mode === "media" ? "active" : ""} onClick={() => switchMode("media")}><ImageIcon size={16}/><span>{uiText("Media")}</span></button>
      <button aria-pressed={mode === "voice"} className={mode === "voice" ? "active" : ""} onClick={() => switchMode("voice")}><Mic size={16}/><span>{uiText("Voice")}</span></button>
      <button aria-pressed={mode === "links"} className={mode === "links" ? "active" : ""} onClick={() => switchMode("links")}><Link2 size={16}/><span>{uiText("Links")}</span></button>
      <button aria-pressed={mode === "saved"} className={mode === "saved" ? "active" : ""} onClick={() => switchMode("saved")}><Star size={16}/><span>{uiText("Saved")}</span></button>
    </div>

    {mode==="media"&&<div className="media-library-filters" role="group" aria-label={uiText("Media filter")}>
      {([['all','All'],['image','Photos'],['video','Videos']] as const).map(([value,name])=><button key={value} aria-pressed={mediaFilter===value} onClick={()=>setMediaFilter(value)}>{uiText(name)}<span>{value==='all'?media.length:media.filter(item=>item.type===value).length}</span></button>)}
    </div>}

    {mode === "search" && <>
      <div className="chat-search-box"><Search size={17}/><input ref={inputRef} autoFocus value={query} onChange={event => setQuery(event.target.value)} aria-label={uiText("Search conversation")} placeholder={uiText("Search the full conversation…")} autoComplete="off"/><button aria-expanded={showFilters} className={`search-filter-trigger ${filtersActive ? "active" : ""}`} onClick={() => setShowFilters(value => !value)} aria-label={uiText("Search filters")}><SlidersHorizontal size={15}/></button><span>{searching ? "…" : query.trim() || filtersActive ? searchResults.length : ""}</span></div>
      {showFilters && <div className="chat-search-filters chat-search-filters-v23">
        <div className="chat-filter-group"><b>{uiText("Type")}</b><div className="chat-filter-chips">{(["all","text","image","video","voice","links"] as SearchFilter[]).map(filter => <button key={filter} className={searchFilter === filter ? "active" : ""} onClick={() => setSearchFilter(filter)}>{filter === "image" ? uiText("Photos") : uiText(filter[0].toUpperCase() + filter.slice(1))}</button>)}</div></div>
        <div className="chat-filter-group"><b>{uiText("Sender")}</b><div className="chat-filter-chips">{(["all","me","partner"] as SenderFilter[]).map(sender => <button key={sender} className={senderFilter === sender ? "active" : ""} onClick={() => setSenderFilter(sender)}>{sender === "all" ? uiText("Anyone") : sender === "me" ? uiText("You") : partnerName}</button>)}</div></div>
        <label className="chat-date-filter"><CalendarDays size={15}/><input aria-label={uiText("Message date")} type="date" value={selectedDate} onChange={event => { setSelectedDate(event.target.value); setDateJumpState(""); }}/>{selectedDate && <><button className="date-jump-button" disabled={dateJumpState === "loading"} onClick={() => void jumpToSelectedDate()}>{dateJumpState === "loading" ? uiText("Finding…") : uiText("Jump")}</button><button onClick={() => { setSelectedDate(""); setDateJumpState(""); }}>{uiText("Clear")}</button></>}</label>
        {dateJumpState === "missing" && <p className="chat-search-note">{uiText("No messages were found on that date.")}</p>}
      </div>}
    </>}

    <div className="chat-tools-content">
      {toolError&&<div className="notice error" role="alert">{uiText(toolError)}<button onClick={()=>setRetryTick(value=>value+1)}>{uiText("Retry")}</button></div>}
      {hubLoading && mode !== "search" && mode !== "saved" && <div className="saved-loading"><span/>{uiText("Syncing shared history…")}</div>}
      {mode === "search" && (!query.trim() && !filtersActive ? <Empty icon="⌕" title={uiText("Find anything")} body={uiText("Search words, sender, message type, or jump to an exact date.")}/> : searchResults.length ? <div className="chat-result-list">{searchResults.map(message => <button key={message.id} onClick={() => onJump(message.id)}><span className="chat-result-author">{message.sender === "me" ? uiText("You") : partnerName}</span><b dir="auto">{message.deletedAt?uiText("Deleted message"):message.body||uiText(label(message))}</b><small>{when(message.createdAt,locale)}{message.edited ? uiText(" · edited") : ""}{message.starred ? " · ★" : ""}{message.pinned ? uiText(" · pinned") : ""}</small></button>)}</div> : searching ? <Empty icon="…" title={uiText("Searching")} body={uiText("Looking through your conversation history.")}/> : <Empty icon="⌕" title={uiText("No matches")} body={uiText("Try another word, sender, type, or date.")}/>)}

      {mode === "media" && (groupedMedia.length ? <div className="chat-media-months">{groupedMedia.map(([month, items]) => <section key={month}><h4>{month}<span>{items.length}</span></h4><div className="chat-media-grid">{items.map(message => <MediaTile key={message.id} message={message} onOpen={()=>onOpenMedia?.(message.id,selectedMedia)}/>)}</div></section>)}</div> : <Empty icon="▧" title={mediaFilter==='video'?uiText("No videos yet"):uiText("No photos yet")} body={uiText("Your shared photos and videos will appear here.")}/>)}

      {mode === "links" && (links.length ? <div className="chat-link-list">{links.map(({ message, url }) => <div key={message.id}><button className="chat-link-jump" onClick={() => onJump(message.id)}><span>{message.sender === "me" ? uiText("You") : partnerName} · {when(message.createdAt,locale)}</span><b dir="auto">{message.body}</b></button><a href={url} target="_blank" rel="noreferrer">{uiText("Open link")}</a></div>)}</div> : <Empty icon="↗" title={uiText("No links yet")} body={uiText("Links shared in chat will be collected here.")}/>)}

      {mode === "voice" && (voices.length ? <div className="chat-voice-list">{voices.map(message => <div key={message.id}><button className="chat-voice-meta" onClick={() => onJump(message.id)}><b>{message.sender === "me" ? uiText("You") : partnerName}</b><span>{when(message.createdAt,locale)}</span></button><VoiceBubble src={message.mediaUrl} path={message.mediaPath} duration={message.duration}/></div>)}</div> : <Empty icon="◉" title={uiText("No voice notes yet")} body={uiText("Voice messages will be easy to find here.")}/>)}

      {mode === "saved" && <div className="saved-messages-hub">
        {loadingSaved && <div className="saved-loading"><span/>{uiText("Loading saved messages…")}</div>}
        <SavedSection title={uiText("Starred")} icon={<Star size={14} fill="currentColor"/>} messages={starred} partnerName={partnerName} empty={uiText("Messages you star are private to your account.")} onJump={onJump}/>
        <SavedSection title={uiText("Pinned")} icon={<Pin size={14} fill="currentColor"/>} messages={pinned} partnerName={partnerName} empty={uiText("Pinned messages are shared between both of you.")} onJump={onJump}/>
      </div>}

      {mode!=="saved"&&(mode==="search"?moreResults:moreHub)&&<button className="chat-tools-load-older" disabled={loadingMore} onClick={()=>void loadMoreResults()}>{loadingMore?uiText("Loading…"):uiText("Load more results")}</button>}
      {mode !== "saved" && hasOlderMessages && <button className="chat-tools-load-older" disabled={loadingOlderMessages} onClick={() => void onLoadOlder?.()}>{loadingOlderMessages ? uiText("Loading earlier history…") : uiText("Load earlier history")}</button>}
    </div>
  </div>;
}

function MediaTile({message,onOpen}:{message:Message;onOpen:()=>void}) {
  const { t: uiText, locale } = useLanguage();

  const signed=useSignedMedia(message.mediaUrl,message.mediaPath);
  return <button className={`media-library-tile ${message.type==='video'?'is-video':''}`} onClick={onOpen} aria-label={uiText("Open {0}{1} · {2}", [uiText(message.type==='video'?'video':'photo'), message.body?`: ${message.body}`:'', when(message.createdAt,locale)])}>
    {message.type==='video'?<div className="media-library-video"><Play size={25} fill="currentColor"/><b>{uiText("Video")}</b></div>:<img src={signed.url} alt={message.body||uiText("Shared photo")} loading="lazy" decoding="async" onError={()=>void signed.retry()}/>}
    <span className="media-library-date">{when(message.createdAt,locale)}</span>
    {signed.error&&<span className="media-library-unavailable">{uiText("Unavailable")}</span>}
  </button>;
}

function SavedSection({ title, icon, messages, partnerName, empty, onJump }: { title: string; icon: ReactNode; messages: Message[]; partnerName: string; empty: string; onJump: (id: string) => void }) {
  const { t: uiText, locale } = useLanguage();

  return <section className="saved-message-section">
    <header>{icon}<strong>{uiText(title)}</strong><span>{messages.length}</span></header>
    {messages.length ? <div className="chat-result-list saved-result-list">{messages.map(message => <button key={message.id} onClick={() => onJump(message.id)}><span className="chat-result-author">{message.sender === "me" ? uiText("You") : partnerName}</span><b dir="auto">{message.deletedAt?uiText("Deleted message"):message.body||uiText(label(message))}</b><small>{when(message.createdAt,locale)}</small></button>)}</div> : <p>{uiText(empty)}</p>}
  </section>;
}

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  const { t: uiText, locale } = useLanguage();
  return <div className="chat-tools-empty"><span>{icon}</span><strong>{uiText(title)}</strong><p>{uiText(body)}</p></div>;
}
