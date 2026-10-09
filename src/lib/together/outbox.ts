import type { Message } from "@/lib/types";
import type { QueuedText } from "@/lib/together/types";
export type OutboxOwner = { userId: string; coupleId: string };
function key(owner: OutboxOwner) {
  if (!owner.userId || !owner.coupleId) throw new Error("A signed-in account and pair are required.");
  return `together_outbox_v4:${owner.userId}:${owner.coupleId}`;
}
export function createQueuedText(body: string, replyTo: QueuedText["replyTo"]): QueuedText {
  return { tempId:crypto.randomUUID(), body, createdAt:new Date().toISOString(), replyTo, attempts:0 };
}
// Legacy queues have no owner. Preserve their bytes; never auto-send as the next account.
export function readOutbox(owner: OutboxOwner): QueuedText[] {
  if (typeof window === "undefined" || !owner.userId || !owner.coupleId) return [];
  try {
    const items: unknown=JSON.parse(localStorage.getItem(key(owner)) || "[]");
    if (!Array.isArray(items)) return [];
    return items.filter((item): item is QueuedText => {
      if (!item || typeof item !== "object") return false;
      const row=item as Partial<QueuedText>;
      return typeof row.tempId === "string" && /^[0-9a-f-]{36}$/i.test(row.tempId) && typeof row.body === "string" && Boolean(row.body.trim()) && typeof row.createdAt === "string";
    });
  } catch { return []; }
}
export function writeOutbox(items: QueuedText[], owner: OutboxOwner) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key(owner),JSON.stringify(items));
}
export function pendingMessage(item: QueuedText): Message {
  return {id:item.tempId,sender:"me",type:"text",body:item.body,createdAt:item.createdAt,pending:!item.lastError,failed:Boolean(item.lastError),replyTo:item.replyTo};
}
