import type { CallSummary } from "@/lib/calls/journal";
export type ChatConnectionState = "connected" | "connecting" | "offline";

export type MessageKind = "text" | "image" | "voice" | "video" | "system" | "call";
export type MessageDeliveryStatus = "sending" | "sent" | "delivered" | "read" | "failed";
export type MessageReaction = { emoji: string; userId?: string; mine?: boolean };
export type Message = {
  id: string;
  sender: "me" | "partner";
  senderId?: string;
  type: MessageKind;
  body?: string;
  mediaUrl?: string;
  mediaPath?: string;
  duration?: number;
  callSummary?: CallSummary;
  createdAt: string;
  seen?: boolean;
  delivered?: boolean;
  readByMe?: boolean;
  edited?: boolean;
  deliveredAt?: string;
  readAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  replyTo?: { id: string; body: string; kind?: MessageKind } | null;
  reactions?: string[];
  reactionDetails?: MessageReaction[];
  starred?: boolean;
  pending?: boolean;
  failed?: boolean;
  pinned?: boolean;
};

export type MemoryItem = {
  id: string;
  src: string;
  caption: string;
  date: string;
  favorite: boolean;
  kind?: "image" | "video";
  mediaPath?: string;
};

export type ImportantDate = {
  id: string;
  title: string;
  date: string;
  kind: "milestone" | "date" | "trip" | "anniversary";
  notes?: string;
  localDate?: string;
  repeatsYearly?: boolean;
  specialType?: "engagement" | "wedding" | "first_meeting" | "birthday" | "other";
  photoPath?: string;
};

export type CoupleProfile = {
  coupleId: string;
  paired: boolean;
  inviteCode?: string;
  myUserId?: string;
  partnerUserId?: string;
  myName: string;
  partnerName: string;
  myNickname: string;
  partnerNickname: string;
  partnerContactName?: string;
  myAvatarUrl?: string;
  myAvatarPath?: string;
  partnerAvatarUrl?: string;
  partnerAvatarPath?: string;
  anniversary?: string;
  storyPhotoUrl?: string;
  storyPhotoPath?: string;
  storyCoverMode?: "fixed" | "memories" | "selected";
  storyCoverMemoryIds?: string[];
  storyCoverPaths?: string[];
  partnerOnline: boolean;
  lastSeen?: string;
  myLastSeen?: string;
  presenceError?: string;
};
