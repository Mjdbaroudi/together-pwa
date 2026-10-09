"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { useState } from "react";
import { Overlay } from "@/components/common/Overlay";
import { useVoiceCalls } from "@/components/calls/VoiceCallsProvider";
import { X } from "lucide-react";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { useTogether } from "@/components/providers/TogetherProvider";
import { partnerLabel } from "@/lib/together/contactPreferences";
import { errorMessage } from "@/lib/errors";
import { PresenceLabel } from "@/components/common/PresenceLabel";

export function PartnerContactDialog({ onClose }: { onClose: () => void }) {
  const { t: uiText } = useLanguage();

  const { profile, setPartnerContactName, contactPreferencesError, refreshPartnerContact } = useTogether();
  const calls = useVoiceCalls();
  const [name, setName] = useState(profile.partnerContactName || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = partnerLabel(profile);
  async function save(value: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { await setPartnerContactName(value); onClose(); }
    catch (error: unknown) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  if (typeof document === "undefined") return null;
  return <Overlay><section className="modal partner-contact-modal" role="dialog" aria-modal="true" aria-label={uiText("Your partner")}>
    <button className="dialog-close" aria-label={uiText("Close")} disabled={busy} onClick={onClose}><X size={21}/></button>
    <div className="partner-contact-heading"><ProfileAvatar name={label} src={profile.partnerAvatarUrl} path={profile.partnerAvatarPath} size={88}/><span className="eyebrow">{uiText("YOUR PARTNER")}</span><h2 dir="auto">{label}</h2><p className="hint" dir="auto">{uiText("Their profile name: ")}{profile.partnerNickname || profile.partnerName}</p></div>
    <div className="partner-last-seen"><PresenceLabel online={profile.partnerOnline} lastSeen={profile.lastSeen} error={profile.presenceError}/></div>
    <div className="partner-call-actions"><button className="soft-btn partner-voice-call" disabled={busy} onClick={() => { onClose(); calls.start(); }}>{uiText("Voice call")}</button><button className="soft-btn secondary partner-voice-call" disabled={busy} onClick={() => { onClose(); calls.start("video"); }}>{uiText("Video call")}</button></div>
    <form onSubmit={event => { event.preventDefault(); void save(name); }}>
      <label className="field-label" htmlFor="partner-contact-name">{uiText("Name shown to you")}</label>
      <input id="partner-contact-name" className="input" autoComplete="off" dir="auto" value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder={profile.partnerNickname || profile.partnerName} aria-describedby="partner-name-help"/>
      <p id="partner-name-help" className="hint partner-name-help">{uiText("Only you see this name. It syncs across your signed-in devices. Leave it empty to use their profile name.")}</p>
      {(error || contactPreferencesError) && <p className="notice error" role="alert">{error || contactPreferencesError}{contactPreferencesError && <button type="button" className="text-button" disabled={busy} onClick={() => void refreshPartnerContact()}>{uiText("Retry")}</button>}</p>}
      {profile.partnerContactName && <button type="button" className="text-button" disabled={busy} onClick={() => void save("")}>{uiText("Use their profile name")}</button>}
      <div className="modal-actions"><button type="button" className="soft-btn secondary" disabled={busy} onClick={onClose}>{uiText("Cancel")}</button><button className="soft-btn" disabled={busy}>{busy ? uiText("Saving…") : uiText("Save name")}</button></div>
    </form>
  </section></Overlay>;
}
