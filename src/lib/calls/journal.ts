import { callDuration, type VoiceCall, type VoiceState } from "@/lib/calls/types";

export type CallSummary = Pick<VoiceCall, "id" | "couple_id" | "caller_id" | "callee_id" | "state" | "created_at" | "accepted_at" | "started_at" | "ended_at" | "media_kind"> & { updated_at: string };
export type CallHistoryItem = { messageId: string; call: CallSummary; createdAt: string };
export type CallHistoryQuery = { filter?: "all" | "missed" | "incoming" | "outgoing"; before?: { createdAt: string; id: string } };
const states: VoiceState[] = ["ringing", "accepted", "active", "ended", "declined", "cancelled", "missed", "failed"];
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function date(value: unknown) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
export function parseCallSummary(value: unknown): CallSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (!["id", "couple_id", "caller_id", "callee_id"].every(key => typeof row[key] === "string" && uuid.test(row[key] as string))) return;
  if (row.media_kind !== undefined && !["audio", "video"].includes(row.media_kind as string)) return;
  if (row.caller_id === row.callee_id || !states.includes(row.state as VoiceState) || !date(row.created_at) || !date(row.updated_at)) return;
  if (!["accepted_at", "started_at", "ended_at"].every(key => row[key] === null || date(row[key]))) return;
  return { media_kind: row.media_kind === "video" ? "video" : "audio", id: row.id as string, couple_id: row.couple_id as string, caller_id: row.caller_id as string, callee_id: row.callee_id as string, state: row.state as VoiceState, created_at: row.created_at as string, updated_at: row.updated_at as string, accepted_at: row.accepted_at as string | null, started_at: row.started_at as string | null, ended_at: row.ended_at as string | null };
}
export function latestCallSummary(existing?: CallSummary, incoming?: CallSummary) {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.id !== incoming.id) return existing;
  const progress = (state: VoiceState) => state === "ringing" ? 0 : state === "accepted" ? 1 : state === "active" ? 2 : 3;
  if (progress(incoming.state) < progress(existing.state)) return existing;
  const difference = Date.parse(incoming.updated_at) - Date.parse(existing.updated_at);
  if (difference) return difference > 0 ? incoming : existing;
  // PostgreSQL timestamps retain microseconds, while Date.parse truncates them.
  const fraction = (stamp: string) => (stamp.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || "").padEnd(9, "0");
  return fraction(incoming.updated_at) >= fraction(existing.updated_at) ? incoming : existing;
}
export function callLabel(call: CallSummary, userId?: string) {
  const incoming = call.callee_id === userId, kind = call.media_kind === "video" ? "video" : "voice";
  return ({ ringing: incoming ? `Incoming ${kind} call` : "Calling…", accepted: "Connecting…", active: `${kind === "video" ? "Video" : "Voice"} call in progress`, ended: incoming ? `Incoming ${kind} call` : `Outgoing ${kind} call`, missed: incoming ? `Missed ${kind} call` : "No answer", declined: incoming ? "Call declined by you" : "Call declined", cancelled: incoming ? "Cancelled incoming call" : "Call cancelled", failed: call.started_at ? "Call disconnected" : "Call could not connect" })[call.state];
}
export function callRecordedDuration(call: CallSummary) {
  if (!call.started_at || !call.ended_at) return null;
  const seconds = (Date.parse(call.ended_at) - Date.parse(call.started_at)) / 1000;
  return Number.isFinite(seconds) ? callDuration(Math.max(0, seconds)) : null;
}
