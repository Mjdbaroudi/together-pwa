export type ChatDraft = {text:string;selectionStart:number;selectionEnd:number};
function key(coupleId:string,userId:string) { return `together_chat_draft_v3:${userId}:${coupleId}`; }
function position(value:unknown,limit:number) { const number=Number(value); return Number.isFinite(number) ? Math.min(limit,Math.max(0,number)) : limit; }
export function readChatDraft(coupleId:string,userId:string):ChatDraft {
  const empty={text:"",selectionStart:0,selectionEnd:0};
  if (!coupleId || !userId || typeof window === "undefined") return empty;
  try {
    const parsed=JSON.parse(localStorage.getItem(key(coupleId,userId)) || "null") as Partial<ChatDraft> | null;
    if (!parsed) return empty;
    const text=typeof parsed.text === "string" ? parsed.text : "";
    const selectionStart=position(parsed.selectionStart,text.length);
    return {text,selectionStart,selectionEnd:Math.max(selectionStart,position(parsed.selectionEnd,text.length))};
  } catch { return empty; }
}
export function writeChatDraft(coupleId:string,userId:string,value:string,selectionStart=value.length,selectionEnd=selectionStart) {
  if (!coupleId || !userId || typeof window === "undefined") return;
  try {
    if (!value) localStorage.removeItem(key(coupleId,userId));
    else localStorage.setItem(key(coupleId,userId),JSON.stringify({text:value,selectionStart:position(selectionStart,value.length),selectionEnd:Math.max(position(selectionStart,value.length),position(selectionEnd,value.length))}));
  } catch { /* Storage restrictions must not prevent editing. */ }
}
