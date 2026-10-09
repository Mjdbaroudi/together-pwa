import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoupleProfile } from "@/lib/types";

export type ContactOwner = { coupleId: string; myUserId: string; partnerUserId: string };

export function partnerLabel(profile: Pick<CoupleProfile, "partnerName" | "partnerNickname" | "partnerContactName">) {
  return profile.partnerContactName || profile.partnerNickname || profile.partnerName || "Your partner";
}

export function normalizeContactName(value: string): string | null {
  const name = value.trim();
  if ([...name].length > 80) throw new Error("Use 80 characters or fewer for this name.");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("Use a single line for this name.");
  return name || null;
}

function contactError(error: { code?: string; message?: string }) {
  if (["42P01", "PGRST205"].includes(error.code || "")) {
    return new Error("Apply database update 008 to enable private contact names, then retry.");
  }
  return new Error("Could not save or load your private contact name. Please try again.");
}

export async function readContactName(supabase: SupabaseClient, owner: ContactOwner) {
  const { data, error } = await supabase.from("partner_contact_preferences").select("contact_name")
    .eq("couple_id", owner.coupleId).eq("owner_id", owner.myUserId).eq("partner_id", owner.partnerUserId).maybeSingle();
  if (error) throw contactError(error);
  return (data?.contact_name as string | null | undefined) || undefined;
}

export async function saveContactName(supabase: SupabaseClient, owner: ContactOwner, value: string) {
  const name = normalizeContactName(value);
  const { data, error } = await supabase.from("partner_contact_preferences").upsert({
    couple_id: owner.coupleId, owner_id: owner.myUserId, partner_id: owner.partnerUserId, contact_name: name,
  }, { onConflict: "couple_id,owner_id,partner_id" }).select("contact_name").single();
  if (error) throw contactError(error);
  return (data?.contact_name as string | null | undefined) || undefined;
}
