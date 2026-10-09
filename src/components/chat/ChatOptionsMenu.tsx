"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import Link from "next/link";
import { Overlay } from "@/components/common/Overlay";
import { Images,Phone,Search,Star,UserRound,X,ChevronRight } from "lucide-react";
export function ChatOptionsMenu({ onClose,onTool,onPartner }: { onClose:()=>void;onTool:(mode:"search"|"media"|"saved")=>void;onPartner:()=>void }) {
  const { t: uiText } = useLanguage();

  return <Overlay className="chat-options-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose();}}><section className="chat-options-sheet" role="dialog" aria-modal="true" aria-label={uiText("Chat options")}><header><div><h2>{uiText("Conversation")}</h2><p>{uiText("Everything you share, in one place.")}</p></div><button aria-label={uiText("Close")} onClick={onClose}><X size={22}/></button></header><div className="chat-options-items">
    <Link href="/calls" onClick={onClose} aria-label={uiText("Call history")}><Phone size={21}/><span><strong>{uiText("Call history")}</strong><small>{uiText("Voice, video and missed calls")}</small></span><ChevronRight size={18}/></Link>
    <button aria-label={uiText("Shared media")} onClick={()=>{onClose();onTool("media");}}><Images size={21}/><span><strong>{uiText("Shared media")}</strong><small>{uiText("Photos and videos")}</small></span><ChevronRight size={18}/></button>
    <button aria-label={uiText("Search chat")} onClick={()=>{onClose();onTool("search");}}><Search size={21}/><span><strong>{uiText("Search chat")}</strong><small>{uiText("Find a message or jump to a date")}</small></span><ChevronRight size={18}/></button>
    <button aria-label={uiText("Saved messages")} onClick={()=>{onClose();onTool("saved");}}><Star size={21}/><span><strong>{uiText("Saved messages")}</strong><small>{uiText("Starred and pinned messages")}</small></span><ChevronRight size={18}/></button>
    <button aria-label={uiText("Partner details")} onClick={()=>{onClose();onPartner();}}><UserRound size={21}/><span><strong>{uiText("Partner details")}</strong><small>{uiText("Last seen, profile and private name")}</small></span><ChevronRight size={18}/></button>
  </div></section></Overlay>;
}
