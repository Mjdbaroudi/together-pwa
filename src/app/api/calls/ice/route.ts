import { NextResponse } from "next/server";
import { authenticateCall, CallServerError, voiceIceConfig } from "@/lib/calls/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
export async function GET(request: Request) {
  try { const account = await authenticateCall(request); return NextResponse.json(voiceIceConfig(account.userId, process.env), { headers }); }
  catch (error: unknown) { return NextResponse.json({ error: error instanceof CallServerError ? error.message : "Could not configure the call connection. Try again." }, { status: error instanceof CallServerError ? error.status : 503, headers }); }
}
