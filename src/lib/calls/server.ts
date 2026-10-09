import { createHmac } from "node:crypto";
import { getSupabaseRestConfig } from "@/lib/push/server";

export const callUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export class CallServerError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function authenticateCall(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new CallServerError("Unauthorized", 401);
  const config = getSupabaseRestConfig();
  if (!config) throw new CallServerError("Call server configuration is missing.", 503);
  const headers = { apikey: config.key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userResponse = await fetch(`${config.url}/auth/v1/user`, { headers, cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!userResponse.ok) throw new CallServerError("Unauthorized", 401);
  const user = await userResponse.json() as { id?: string };
  if (!callUuid(user.id)) throw new CallServerError("Unauthorized", 401);
  const response = await fetch(`${config.url}/rest/v1/couples?select=id,user_a,user_b&or=(user_a.eq.${user.id},user_b.eq.${user.id})&limit=2`, { headers, cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new CallServerError("Could not verify your paired account.", 503);
  const pairs = await response.json() as { id: string; user_a: string; user_b: string | null }[];
  if (pairs.length !== 1 || !pairs[0].user_b || ![pairs[0].user_a, pairs[0].user_b].includes(user.id)) throw new CallServerError("Pair your accounts before calling.", 403);
  return { userId: user.id, coupleId: pairs[0].id, config, headers };
}

export function voiceIceConfig(userId: string, env: Record<string, string | undefined>, now = Date.now()) {
  const urls = (env.TURN_URLS || "").split(",").map(url => url.trim()).filter(Boolean);
  const validUrl = (url: string) => { const match = url.match(/^turns?:(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(?:\?transport=(?:udp|tcp))?$/i); return Boolean(match && (!match[1] || (Number(match[1]) > 0 && Number(match[1]) <= 65535))); };
  if (!urls.length || urls.some(url => !validUrl(url))) throw new CallServerError("Voice calls need a one-time TURN setup. See the v2.8 setup guide.", 503);
  const expires = Math.floor(now / 1000) + 7200;
  let username = env.TURN_USERNAME, credential = env.TURN_CREDENTIAL;
  if (env.TURN_SHARED_SECRET) {
    username = `${expires}:${userId}`;
    credential = createHmac("sha1", env.TURN_SHARED_SECRET).update(username).digest("base64");
  }
  if (!username || !credential) throw new CallServerError("Voice calls need TURN credentials. See the v2.8 setup guide.", 503);
  return { iceServers: [{ urls, username, credential }], iceTransportPolicy: env.CALLS_RELAY_ONLY === "false" ? "all" as const : "relay" as const, expiresAt: expires * 1000 };
}
