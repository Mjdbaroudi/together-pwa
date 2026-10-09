import { latestCallSummary, parseCallSummary } from "@/lib/calls/journal";
import { coverFields } from "@/lib/together/storyCovers";
import type { Dispatch, SetStateAction } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { ChatConnectionState, CoupleProfile, ImportantDate, MemoryItem, Message } from "@/lib/types";
import { mapImportantDate, mapMemory } from "@/lib/together/mappers";
import { resolveMediaReference, signMediaPath } from "@/lib/together/media";
import { upsertMessage } from "@/lib/together/messageStore";
import type {
  CoupleRow,
  ImportantDateRow,
  MemoryRow,
  MessageReadChangeRow,
  MessageDeliveryChangeRow,
  MessageHideChangeRow,
  MessageStarChangeRow,
  MessageRow,
  ProfileRow,
  ReactionChangeRow,
} from "@/lib/together/types";

type RealtimeOptions = {
  supabase: SupabaseClient;
  coupleId: string;
  userId: string;
  partnerId: string;
  hydrateMessage: (row: MessageRow, myUserId?: string) => Promise<Message>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setMemories: Dispatch<SetStateAction<MemoryItem[]>>;
  setDates: Dispatch<SetStateAction<ImportantDate[]>>;
  setProfile: Dispatch<SetStateAction<CoupleProfile>>;
  setTheme: Dispatch<SetStateAction<string>>;
  setPartnerTyping: Dispatch<SetStateAction<boolean>>;
  markDelivered: (ids: string[]) => Promise<void>;
  deliveriesEnabled: boolean;
  hidesEnabled: boolean;
  starsEnabled: boolean;
  onDataChange?:()=>void;
  onConnectionChange?: (state: ChatConnectionState) => void;
  onSubscribed?: () => void;
  onStarChange?: (messageId: string, starred: boolean) => void;
  onContactChange?: () => void;
};

export function createCoupleRealtime({
  supabase,
  coupleId,
  userId,
  partnerId,
  hydrateMessage,
  setMessages,
  setMemories,
  setDates,
  setProfile,
  setTheme,
  setPartnerTyping,
  markDelivered,
  deliveriesEnabled,
  hidesEnabled,
  starsEnabled,
  onDataChange,
  onConnectionChange,
  onSubscribed,
  onStarChange,
  onContactChange,
}: RealtimeOptions): RealtimeChannel {
  const channel = supabase.channel(`couple:${coupleId}`, { config: { presence: { key: userId } } });
  let typingExpiry: ReturnType<typeof setTimeout> | null = null;
  let profileRequest = 0;

  // Names are owner-only under RLS. Re-read instead of applying unscoped payloads.
  channel.on("postgres_changes", { event: "*", schema: "public", table: "partner_contact_preferences", filter: `owner_id=eq.${userId}` }, () => onContactChange?.());

  channel
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `couple_id=eq.${coupleId}` }, async payload => {
      const row = payload.new as unknown as MessageRow;
      const hydrated = await hydrateMessage(row, userId);
      setMessages(previous => upsertMessage(previous, { ...hydrated, pending: false, failed: false }));
      if (row.sender_id !== userId) void markDelivered([row.id]);
      onDataChange?.();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `couple_id=eq.${coupleId}` }, payload => {
      const row = payload.new as unknown as MessageRow;
      const deleted = Boolean(row.deleted_at);
      setMessages(previous => previous.map(message => message.id === row.id
        ? {
            ...message,
            callSummary: deleted ? undefined : latestCallSummary(message.callSummary, parseCallSummary(row.call_summary)),
            body: deleted ? undefined : (row.body || undefined),
            mediaPath: deleted ? undefined : (row.media_path || message.mediaPath),
            mediaUrl: deleted ? undefined : message.mediaUrl,
            duration: deleted ? undefined : (row.duration_seconds || message.duration),
            edited: deleted ? false : Boolean(row.edited_at),
            pinned: deleted ? false : Boolean(row.pinned),
            replyTo:row.reply_snapshot||null,
            deletedAt: row.deleted_at || undefined,
            deletedBy: row.deleted_by || undefined,
            reactions: deleted ? [] : message.reactions,
            pending: false,
            failed: false,
          }
        : message));
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages", filter: `couple_id=eq.${coupleId}` }, payload => {
      const row = payload.old as unknown as Partial<MessageRow>;
      setMessages(previous => previous.filter(message => message.id !== row.id));
      onDataChange?.();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, async payload => {
      const next = payload.new as unknown as Partial<ReactionChangeRow>;
      const previous = payload.old as unknown as Partial<ReactionChangeRow>;
      const messageId = next.message_id || previous.message_id;
      if (!messageId) return;
      const { data } = await supabase.from("reactions").select("emoji,user_id").eq("message_id", messageId);
      setMessages(messages => messages.map(message => message.id === messageId
        ? {
            ...message,
            reactions: (data || []).map(row => row.emoji),
            reactionDetails: (data || []).map(row => ({ emoji: row.emoji, userId: row.user_id, mine: row.user_id === userId })),
          }
        : message));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reads" }, payload => {
      const next = payload.new as unknown as Partial<MessageReadChangeRow>;
      const previous = payload.old as unknown as Partial<MessageReadChangeRow>;
      const row = next.message_id ? next : previous;
      if (!row.message_id || !row.user_id) return;
      onDataChange?.();
      const seenAt = (next as Partial<MessageReadChangeRow>).seen_at || undefined;
      setMessages(messages => messages.map(message => message.id === row.message_id
        ? (row.user_id === userId ? { ...message, readByMe: true } : { ...message, seen: true, readAt: seenAt || message.readAt })
        : message));
    });

  if (deliveriesEnabled) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "message_deliveries" }, payload => {
      const next = payload.new as unknown as Partial<MessageDeliveryChangeRow>;
      const previous = payload.old as unknown as Partial<MessageDeliveryChangeRow>;
      const row = next.message_id ? next : previous;
      if (!row.message_id || !row.user_id || row.user_id === userId) return;
      setMessages(messages => messages.map(message => message.id === row.message_id ? { ...message, delivered: true, deliveredAt: row.delivered_at || message.deliveredAt } : message));
    });
  }

  if (hidesEnabled) {
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "message_hides", filter: `user_id=eq.${userId}` }, payload => {
      const row = payload.new as unknown as MessageHideChangeRow;
      if (!row.message_id || row.user_id !== userId) return;
      setMessages(previous => previous.filter(message => message.id !== row.message_id));
      onDataChange?.();
    });
  }

  if (starsEnabled) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "message_stars", filter: `user_id=eq.${userId}` }, payload => {
      const next = payload.new as unknown as Partial<MessageStarChangeRow>;
      const previous = payload.old as unknown as Partial<MessageStarChangeRow>;
      const row = next.message_id ? next : previous;
      if (!row.message_id || row.user_id !== userId) return;
      const starred = payload.eventType !== "DELETE";
      onStarChange?.(row.message_id, starred);
      setMessages(messages => messages.map(message => message.id === row.message_id ? { ...message, starred } : message));
    });
  }

  channel
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "memories", filter: `couple_id=eq.${coupleId}` }, async payload => {
      const row = payload.new as unknown as MemoryRow;
      const item = mapMemory(row, (await signMediaPath(row.media_path)) || "");
      setMemories(previous => previous.some(memory => memory.id === item.id) ? previous : [item, ...previous]);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "memories", filter: `couple_id=eq.${coupleId}` }, payload => {
      const row = payload.new as unknown as MemoryRow;
      setMemories(previous => previous.map(memory => memory.id === row.id ? mapMemory(row, memory.src) : memory));
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "memories", filter: `couple_id=eq.${coupleId}` }, payload => {
      const row = payload.old as unknown as Partial<MemoryRow>;
      setMemories(previous => previous.filter(memory => memory.id !== row.id));
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "important_dates", filter: `couple_id=eq.${coupleId}` }, payload => {
      const item = mapImportantDate(payload.new as unknown as ImportantDateRow);
      setDates(previous => previous.some(date => date.id === item.id) ? previous : [...previous, item]);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "important_dates", filter: `couple_id=eq.${coupleId}` }, payload => {
      const row = payload.old as unknown as Partial<ImportantDateRow>;
      setDates(previous => previous.filter(date => date.id !== row.id));
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "important_dates", filter: `couple_id=eq.${coupleId}` }, payload => {
      const item=mapImportantDate(payload.new as unknown as ImportantDateRow);
      setDates(previous=>previous.some(d=>d.id===item.id)?previous.map(d=>d.id===item.id?item:d):[...previous,item]);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "couples", filter: `id=eq.${coupleId}` }, async payload => {
      const row = payload.new as unknown as CoupleRow;
      setTheme(row.theme || "rose");
      const storyPhotoPath = row.cover_media_path || undefined;
      const storyPhotoUrl = storyPhotoPath ? await signMediaPath(storyPhotoPath) : undefined;
      setProfile(previous => ({ ...previous,...coverFields(row), anniversary: row.anniversary_date || undefined, storyPhotoPath, storyPhotoUrl }));
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, async payload => {
      const changed = payload.new as unknown as ProfileRow;
      if (![userId, partnerId].includes(changed.user_id)) return;
      const request = ++profileRequest;
      const { data, error } = await supabase.from("profiles").select("user_id,display_name,nickname,avatar_url,last_seen").in("user_id", [userId, partnerId]);
      if (error) return;
      const rows = (data || []) as ProfileRow[];
      const me = rows.find(row => row.user_id === userId);
      const partner = rows.find(row => row.user_id === partnerId);
      const [myAvatarUrl, partnerAvatarUrl] = await Promise.all([
        resolveMediaReference(me?.avatar_url),
        resolveMediaReference(partner?.avatar_url),
      ]);
      if (request !== profileRequest) return;
      setProfile(previous => ({
        ...previous,
        myName: me?.display_name || previous.myName,
        myNickname: me?.nickname || me?.display_name || previous.myNickname,
        myAvatarPath: me?.avatar_url || undefined,
        myAvatarUrl,
        partnerName: partner?.display_name || previous.partnerName,
        partnerNickname: partner?.nickname || partner?.display_name || previous.partnerNickname,
        partnerAvatarPath: partner?.avatar_url || undefined,
        partnerAvatarUrl,
      }));
    })
    .on("broadcast", { event: "typing" }, event => {
      const payload = event.payload as { userId?: string; typing?: boolean } | undefined;
      if (payload?.userId === userId) return;

      if (typingExpiry) {
        clearTimeout(typingExpiry);
        typingExpiry = null;
      }

      const isTyping = Boolean(payload?.typing);
      setPartnerTyping(isTyping);
      if (isTyping) {
        typingExpiry = setTimeout(() => {
          typingExpiry = null;
          setPartnerTyping(false);
        }, 2400);
      }
    })
    .subscribe(async status => {
      if (status === "SUBSCRIBED") {
        onConnectionChange?.("connected");
        onSubscribed?.();
        return;
      }
      if (["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
        onConnectionChange?.(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "connecting");
        if (typingExpiry) clearTimeout(typingExpiry);
        typingExpiry = null;
        setPartnerTyping(false);
        return;
      }
      onConnectionChange?.("connecting");
    });

  return channel;
}
