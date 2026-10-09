import type { QueuedText, MessageRow } from "@/lib/together/types";
type QueueIO = {
  active:()=>boolean;
  read:()=>QueuedText[];
  write:(items:QueuedText[])=>void;
  save:(item:QueuedText)=>Promise<MessageRow>;
  find:(id:string)=>Promise<MessageRow|null>;
  update:(id:string,body:string)=>Promise<MessageRow>;
  remove:(id:string)=>Promise<void>;
  acknowledge:(row:MessageRow)=>Promise<void>;
  removed:(id:string)=>void;
  failed:(id:string,message:string)=>void;
};
// Failed items do not block later messages. Tombstones persist until server deletion succeeds.
export async function flushOwnedQueue(io:QueueIO) {
  const attempted=new Set<string>();
  while (io.active()) {
    const item=io.read().find(row=>!attempted.has(row.tempId) && (!row.lastError || row.cancelled));
    if (!item) break;
    attempted.add(item.tempId);
    try {
      let saved:MessageRow|null=null;
      if (!item.cancelled) {
        try { saved=await io.save(item); }
        catch(error) { if (!io.active()) break; saved=await io.find(item.tempId); if (!saved) throw error; }
      }
      if (!io.active()) break;
      while(io.active()) {
        const current=io.read().find(row=>row.tempId===item.tempId);
        if(!current || current.cancelled) { await io.remove(item.tempId); if(io.active())io.removed(item.tempId); break; }
        if(!saved)break;
        if(current.body!==saved.body){saved=await io.update(item.tempId,current.body);continue;}
        await io.acknowledge(saved);
        if(!io.active())break;
        const latest=io.read().find(row=>row.tempId===item.tempId);
        if(!latest || latest.cancelled || latest.body!==saved.body)continue;
        break;
      }
      if (!io.active()) break;
      io.write(io.read().filter(row=>row.tempId!==item.tempId));
    } catch(error:unknown) {
      if (!io.active()) break;
      const message=error instanceof Error ? error.message : "Could not send message.";
      io.write(io.read().map(row=>row.tempId===item.tempId ? {...row,attempts:(row.attempts||0)+1,lastError:message}:row));
      io.failed(item.tempId,message);
    }
  }
}
