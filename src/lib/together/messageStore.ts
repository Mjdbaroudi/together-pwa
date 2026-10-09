import { latestCallSummary } from "@/lib/calls/journal";
import type { Message } from "@/lib/types";

export const CHAT_PAGE_SIZE = 60;

function messageTime(message: Message) {
  const value = new Date(message.createdAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

/**
 * Merge message snapshots by id and keep a deterministic chronological order.
 * Later groups win, so a hydrated server row can safely replace its optimistic
 * copy without producing duplicate bubbles.
 */
export function mergeMessageGroups(...groups: Message[][]) {
  const byId = new Map<string, Message>();
  for (const group of groups) {
    for (const message of group) {
      const existing = byId.get(message.id);
      byId.set(message.id, message.type === "call" ? { ...message, callSummary: message.deletedAt ? undefined : latestCallSummary(existing?.callSummary, message.callSummary) } : message);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const difference = messageTime(a) - messageTime(b);
    return difference || a.id.localeCompare(b.id);
  });
}

export function upsertMessage(previous: Message[], incoming: Message) {
  const existing = previous.find(message => message.id === incoming.id);
  const safeIncoming = existing ? {
    ...incoming,
    seen: Boolean(existing.seen || incoming.seen),
    delivered: Boolean(existing.delivered || incoming.delivered),
    readByMe: Boolean(existing.readByMe || incoming.readByMe),
    reactions: incoming.reactions ?? existing.reactions,
    reactionDetails: incoming.reactionDetails ?? existing.reactionDetails,
    starred: incoming.starred ?? existing.starred,
  } : incoming;
  return mergeMessageGroups(previous, [safeIncoming]);
}

/**
 * Reconcile the most recent server page after reconnect/focus.
 * Older already-loaded history is preserved, while the fetched recent window
 * becomes authoritative. This also removes messages that were deleted on the
 * other device while this client was asleep.
 */
export function reconcileRecentMessages(
  current: Message[],
  latest: Message[],
  queuedIds: Set<string>,
  pageSize = CHAT_PAGE_SIZE,
  hasOlderOnServer?: boolean,
  snapshotIds = new Set(current.map(message => message.id)),
) {
  if (!latest.length) {
    // If the server reports that older history still exists, an empty visible
    // page can simply mean that this page was hidden for this user. Never wipe
    // already-loaded history in that case.
    if (hasOlderOnServer) return current;
    return current.filter(message => !snapshotIds.has(message.id) || queuedIds.has(message.id) || message.pending || message.failed);
  }

  const latestIds = new Set(latest.map(message => message.id));
  const oldestFetched = messageTime(latest[0]);
  const completeHistory = hasOlderOnServer === undefined ? latest.length < pageSize : !hasOlderOnServer;

  const preserved = current.filter(message => {
    if (queuedIds.has(message.id) || message.pending || message.failed) {
      return !latestIds.has(message.id);
    }

    const time = messageTime(message);
    // A realtime insert may land after the sync query snapshot. Keep it.
    if (!snapshotIds.has(message.id)) return true;
    // When only the newest page was fetched, keep older paginated history.
    if (!completeHistory && time < oldestFetched) return true;
    // Everything else inside the authoritative window must exist in `latest`.
    return false;
  });

  return mergeMessageGroups(preserved, latest);
}
