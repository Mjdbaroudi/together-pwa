import { parseCallSummary, type CallHistoryItem } from "@/lib/calls/journal";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/supabase/client";
import type { CallTransport, IceConfig, VoiceCall, VoiceSignal } from "@/lib/calls/types";

export function createCallTransport(supabase: SupabaseClient, userId: string, coupleId: string): CallTransport {
  const deviceId = crypto.randomUUID();
  let lastToken = "";
  async function timedResult<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> { const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000); try { return await run(controller.signal); } finally { clearTimeout(timeout); } }
  async function timed<T>(query: { abortSignal(signal: AbortSignal): PromiseLike<T> }): Promise<T> { const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000); try { return await query.abortSignal(controller.signal); } finally { clearTimeout(timeout); } }
  async function token() { const session = (await supabase.auth.getSession()).data.session; if (!session) throw new Error("Sign in again to make a call."); lastToken = session.access_token; return lastToken; }
  async function api<T>(url: string, body?: object) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try { const response = await fetch(url, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: controller.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Call request failed. Try again."); return data as T; }
    finally { clearTimeout(timeout); }
  }
  async function rpc<T>(name: string, input: object) { const { data, error } = await timed(supabase.rpc(name, input)); if (error) { if (["PGRST202", "42P01"].includes(error.code)) throw new Error(name === "start_video_call" ? "Apply database update 011 to enable video calls." : "Apply database update 009 to enable voice calls."); throw new Error(error.message || "Could not update the call."); } return data as T; }
  return {
    userId, coupleId, deviceId,
    ice: () => api<IceConfig>("/api/calls/ice"),
    start: (id, kind = "audio") => kind === "video" ? rpc<VoiceCall>("start_video_call", { p_couple: coupleId, p_id: id, p_device: deviceId }) : rpc<VoiceCall>("start_voice_call", { p_couple: coupleId, p_id: id, p_device: deviceId }),
    current: async () => { const row = await rpc<VoiceCall | null>("current_voice_call", { p_couple: coupleId }); return row?.id ? row : null; },
    get: async id => { const { data, error } = await timedResult(signal => supabase.from("voice_calls").select("*").eq("couple_id", coupleId).eq("id", id).abortSignal(signal).maybeSingle()); if (error) throw new Error(error.message); return data as VoiceCall | null; },
    action: (id, action) => rpc<VoiceCall>("control_voice_call", { p_call: id, p_device: deviceId, p_action: action }),
    signals: async (id, after) => { const { data, error } = await timed(supabase.from("voice_call_signals").select("seq,id,sender_id,kind,payload").eq("call_id", id).gt("seq", after).order("seq", { ascending: true }).limit(100)); if (error) throw new Error(error.message); return (data || []) as VoiceSignal[]; },
    send: async (id, signal) => { await rpc<number>("send_voice_signal", { p_call: id, p_device: deviceId, p_id: signal.id, p_kind: signal.kind, p_payload: signal.payload }); },
    notify: async id => { const result = await api<{ warning?: string }>("/api/calls/notify", { callId: id, deviceId }); return result.warning; },
    watch: onChange => { const channel = supabase.channel(`voice:${coupleId}:${deviceId}`).on("postgres_changes", { event: "*", schema: "public", table: "voice_calls", filter: `couple_id=eq.${coupleId}` }, onChange).on("postgres_changes", { event: "INSERT", schema: "public", table: "voice_call_signals" }, onChange).subscribe(status => { if (status === "SUBSCRIBED") onChange(); }); return () => { void supabase.removeChannel(channel); }; },
    history: async (query = {}) => {
      const { data, error } = await timed(supabase.rpc("voice_call_history", { p_couple: coupleId, p_filter: query.filter || "all", p_before: query.before?.createdAt || null, p_before_id: query.before?.id || null, p_limit: 31 }));
      if (error) throw new Error("Could not load call history. Check your connection and apply database update 010, then retry.");
      return ((data || []) as { message_id: string; call_summary: unknown; created_at: string }[]).flatMap(row => {
        const call = parseCallSummary(row.call_summary);
        return call && call.couple_id === coupleId && [call.caller_id, call.callee_id].includes(userId) ? [{ messageId: row.message_id, call, createdAt: row.created_at } satisfies CallHistoryItem] : [];
      });
    },
    leave: id => { const config = getPublicSupabaseConfig(); if (!config || !lastToken) return; void fetch(`${config.url}/rest/v1/rpc/control_voice_call`, { method: "POST", headers: { apikey: config.key, Authorization: `Bearer ${lastToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_call: id, p_device: deviceId, p_action: "end" }), keepalive: true }).catch(() => undefined); },
  };
}
