import type { CoupleProfile, ImportantDate, MessageKind } from "@/lib/types";

export type ReplyDraft = { id: string; body: string; kind?: MessageKind } | null;
export type ProfileUpdate = { displayName: string; nickname: string; anniversary?: string };
export type MediaSendOptions = { onProgress?: (percent: number) => void; signal?: AbortSignal };
export type QueuedText = { tempId: string; body: string; createdAt: string; replyTo: ReplyDraft; attempts?: number; lastError?: string; cancelled?: boolean };

export type ReadRow = { user_id: string; seen_at?: string };
export type DeliveryRow = { user_id: string; delivered_at?: string };
export type ReactionRow = { emoji: string; user_id?: string };
export type MessageRow = {
  id: string;
  sender_id: string;
  type: MessageKind;
  body?: string | null;
  media_path?: string | null;
  duration_seconds?: number | null;
  call_summary?: unknown;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  reply_snapshot?: ReplyDraft;
  pinned?: boolean | null;
  message_reads?: ReadRow[];
  message_deliveries?: DeliveryRow[];
  reactions?: ReactionRow[];
};

export type MemoryRow = {
  id: string;
  media_path: string;
  caption?: string | null;
  taken_at?: string | null;
  created_at: string;
  favorite?: boolean | null;
  kind?: "image" | "video" | null;
};

export type ImportantDateRow = {
  id: string;
  title: string;
  date: string;
  kind: ImportantDate["kind"];
  notes?: string | null;
  local_date?: string | null;
  repeats_yearly?: boolean;
  special_type?: ImportantDate["specialType"] | null;
  photo_path?: string | null;
};

export type ProfileRow = {
  user_id: string;
  display_name?: string | null;
  nickname?: string | null;
  avatar_url?: string | null;
  last_seen?: string | null;
};

export type CoupleRow = {
  id: string;
  user_a: string;
  user_b?: string | null;
  invite_code?: string | null;
  anniversary_date?: string | null;
  cover_media_path?: string | null;
  story_cover_mode?: "fixed" | "memories" | "selected";
  story_cover_memory_ids?: string[];
  story_cover_paths?: string[];
  theme?: string | null;
};

export const EMPTY_PROFILE: CoupleProfile = {
  coupleId: "",
  paired: false,
  myName: "",
  partnerName: "",
  myNickname: "",
  partnerNickname: "",
  anniversary: undefined,
  partnerOnline: false,
};

export type ReactionChangeRow = { message_id: string; emoji?: string };
export type MessageReadChangeRow = { message_id: string; user_id: string; seen_at?: string };
export type MessageDeliveryChangeRow = { message_id: string; user_id: string; delivered_at?: string };

export type MessageHideChangeRow = { message_id: string; user_id: string };
export type MessageStarChangeRow = { message_id: string; user_id: string; starred_at?: string };

export type ChatSearchInput = {
  before?: {created_at:string;id:string};
  query?: string;
  type?: "all" | "text" | "image" | "voice" | "video" | "media" | "links";
  sender?: "all" | "me" | "partner";
  date?: string;
};
