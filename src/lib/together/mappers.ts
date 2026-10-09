import { parseCallSummary } from "@/lib/calls/journal";
import type { ImportantDate, MemoryItem, Message } from "@/lib/types";
import type { ImportantDateRow, MemoryRow, MessageRow } from "@/lib/together/types";

export function mapMessage(row: MessageRow, myUserId?: string, signedUrl?: string): Message {
  const partnerRead = row.message_reads?.find(read => read.user_id !== row.sender_id);
  const partnerDelivery = row.message_deliveries?.find(delivery => delivery.user_id !== row.sender_id);
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    sender: row.sender_id === myUserId ? "me" : "partner",
    senderId: row.sender_id,
    type: row.type,
    callSummary: deleted ? undefined : parseCallSummary(row.call_summary),
    body: deleted ? undefined : (row.body || undefined),
    mediaUrl: deleted ? undefined : signedUrl,
    mediaPath: deleted ? undefined : (row.media_path || undefined),
    duration: deleted ? undefined : (row.duration_seconds || undefined),
    createdAt: row.created_at,
    seen: Boolean(partnerRead),
    delivered: Boolean(partnerDelivery),
    deliveredAt: partnerDelivery?.delivered_at,
    readAt: partnerRead?.seen_at,
    readByMe: row.message_reads?.some(read => read.user_id === myUserId) ?? false,
    edited: Boolean(row.edited_at),
    deletedAt: row.deleted_at || undefined,
    deletedBy: row.deleted_by || undefined,
    replyTo: row.reply_snapshot || null,
    reactions: deleted ? [] : row.reactions?.map(reaction => reaction.emoji),
    reactionDetails: deleted ? [] : row.reactions?.map(reaction => ({ emoji: reaction.emoji, userId: reaction.user_id, mine: reaction.user_id === myUserId })),
    pinned: deleted ? false : Boolean(row.pinned),
  };
}

export function mapMemory(row: MemoryRow, signedUrl = ""): MemoryItem {
  return {
    id: row.id,
    src: signedUrl,
    caption: row.caption || "Untitled memory",
    date: row.taken_at || row.created_at,
    favorite: Boolean(row.favorite),
    kind: row.kind || "image",
    mediaPath: row.media_path,
  };
}

export function mapImportantDate(row: ImportantDateRow): ImportantDate {
  return { id: row.id, title: row.title, date: row.date, kind: row.kind, notes: row.notes || undefined, localDate: row.local_date || undefined, repeatsYearly: row.repeats_yearly || false, specialType: row.special_type || undefined, photoPath: row.photo_path || undefined };
}
