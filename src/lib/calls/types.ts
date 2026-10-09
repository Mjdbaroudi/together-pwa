import type { CallHistoryItem, CallHistoryQuery } from "@/lib/calls/journal";
export type VoiceState = "ringing" | "accepted" | "active" | "ended" | "declined" | "cancelled" | "missed" | "failed";
export type CallMediaKind = "audio" | "video";
export type VoiceCall = {
  id: string; couple_id: string; caller_id: string; callee_id: string;
  caller_device: string; callee_device: string | null; state: VoiceState;
  media_kind: CallMediaKind;
  created_at: string; accepted_at: string | null; started_at: string | null; ended_at: string | null;
};
export type VoiceSignal = { seq: number; id: string; sender_id: string; kind: "description" | "candidate"; payload: RTCSessionDescriptionInit | RTCIceCandidateInit };
export type VoiceAction = "accept" | "decline" | "ping" | "connected" | "end" | "fail";
export type IceConfig = { iceServers: RTCIceServer[]; iceTransportPolicy: RTCIceTransportPolicy; expiresAt: number };
export type CallPhase = "idle" | "preparing" | "permission" | "incoming" | "ringing" | "connecting" | "connected" | "reconnecting" | "elsewhere" | "finished";
export type VoiceView = { phase: CallPhase; call: VoiceCall | null; muted: boolean; error: string; notice: string; playbackBlocked: boolean; quality: "unknown" | "good" | "weak"; connectedAt: number | null;
  permissionBlocked: boolean; mediaKind: CallMediaKind; cameraOn: boolean; cameraBusy: boolean; cameraFacing: "user" | "environment"; cameraError: string; localVideo: MediaStream | null; remoteVideo: MediaStream | null; remoteCameraOn: boolean;
};
export const emptyCallView = (): VoiceView => ({ phase: "idle", call: null, muted: false, error: "", notice: "", permissionBlocked: false, playbackBlocked: false, quality: "unknown", connectedAt: null, mediaKind: "audio", cameraOn: false, cameraBusy: false, cameraFacing: "user", cameraError: "", localVideo: null, remoteVideo: null, remoteCameraOn: false });
export interface CallTransport {
  userId: string; coupleId: string; deviceId: string;
  ice(): Promise<IceConfig>;
  start(id: string, kind?: CallMediaKind): Promise<VoiceCall>;
  current(): Promise<VoiceCall | null>;
  get(id: string): Promise<VoiceCall | null>;
  action(id: string, action: VoiceAction): Promise<VoiceCall>;
  signals(id: string, after: number): Promise<VoiceSignal[]>;
  send(id: string, signal: Omit<VoiceSignal, "seq" | "sender_id">): Promise<void>;
  notify(id: string): Promise<string | undefined>;
  watch(onChange: () => void): () => void;
  history(query?: CallHistoryQuery): Promise<CallHistoryItem[]>;
  leave(id: string): void;
}
export const isLiveCall = (call?: Pick<VoiceCall, "state"> | null) => Boolean(call && ["ringing", "accepted", "active"].includes(call.state));
export function callOutcome(call: VoiceCall | null) {
  if (!call) return "Call ended";
  return ({ ended: "Call ended", declined: "Call declined", cancelled: "Call cancelled", missed: "No answer", failed: "Call disconnected", ringing: "Calling…", accepted: "Connecting…", active: "Call ended" })[call.state];
}
export function callDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
