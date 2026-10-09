"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

import { Overlay } from "@/components/common/Overlay";

import Link from "next/link";
import { Bell, CalendarHeart, Camera, ChevronRight, Cloud, Heart, Lock, LogOut, Palette, Phone, Sparkles, Trash2, UserRoundPen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/common/PageHeading";
import { MOTION_KEY } from "@/components/common/ExperiencePreferences";
import { ProfileAvatar } from "@/components/common/ProfileAvatar";
import { PartnerContactDialog } from "@/components/common/PartnerContactDialog";
import { lastSeenLabel } from "@/lib/together/presence";
import { partnerLabel } from "@/lib/together/contactPreferences";
import { useTogether } from "@/components/providers/TogetherProvider";
import { clearLocalPin, hasLocalPin, lockSession, setLocalPin } from "@/lib/security/pin";
import { PUSH_STATE_EVENT, signOutSafely, disablePush, enablePush, getPushState, sendTestPush, type PushState } from "@/lib/push/client";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";

const themeItems = [{ id: "rose", c: "#D95F86" }, { id: "lavender", c: "#9D6AB7" }, { id: "sunset", c: "#D77A6D" }, { id: "plum", c: "#7B3A70" }];

export default function SettingsPage() {
  const { t: uiText, locale, language } = useLanguage();

  const { profile, theme, setTheme, messages, memories, dates, exportAllData, updateProfile, setProfilePhoto, removeProfilePhoto } = useTogether();
  const [exportBusy,setExportBusy]=useState(false);
  const [profileBusy,setProfileBusy]=useState(false);
  const [reduceMotion,setReduceMotion]=useState(false);
  useEffect(()=>{try{setReduceMotion(localStorage.getItem(MOTION_KEY)==="1");}catch{}},[]);
  function toggleMotion(){const next=!reduceMotion;setReduceMotion(next);document.documentElement.dataset.reduceMotion=String(next);try{localStorage.setItem(MOTION_KEY,next?"1":"0");}catch{}}
  const [notifications, setNotifications] = useState(false);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);
  const [pinOn, setPinOn] = useState(false);
  const [pinModal, setPinModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [partnerContactOpen, setPartnerContactOpen] = useState(false);
  const partner = partnerLabel(profile);
  const [photoBusy, setPhotoBusy] = useState(false);
  const profilePhotoInput = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [displayName, setDisplayName] = useState(profile.myName);
  const [nickname, setNickname] = useState(profile.myNickname);
  const [anniversary, setAnniversary] = useState(profile.anniversary || "");

  const pushReadSequence = useRef(0);
  const refreshPush = useCallback(async () => {
    const sequence = ++pushReadSequence.current;
    const state = await getPushState(profile.myUserId);
    if (sequence !== pushReadSequence.current) return;
    setPushState(state);
    setNotifications(state.requested);
  }, [profile.myUserId]);
  useEffect(() => { setPinOn(hasLocalPin()); }, []);
  useEffect(() => {
    setPushState(null);
    const refresh = () => { if (document.visibilityState === "visible") void refreshPush(); };
    void refreshPush();
    window.addEventListener(PUSH_STATE_EVENT, refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { ++pushReadSequence.current; window.removeEventListener(PUSH_STATE_EVENT, refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [refreshPush]);
  useEffect(() => { setDisplayName(profile.myName); setNickname(profile.myNickname); setAnniversary(profile.anniversary || ""); }, [profile.myName, profile.myNickname, profile.anniversary]);

  async function configurePin() {
    try { await setLocalPin(pin); setPinOn(true); setPinModal(false); setPin(""); setMsg("PIN lock enabled on this device."); }
    catch (error: unknown) { setMsg(errorMessage(error)); }
  }

  async function exportData(){
    if(exportBusy)return;setExportBusy(true);setMsg("");
    try{const data=await exportAllData(),blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`together-export-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);setMsg("Complete visible history exported. Media files are not included.");}
    catch(error:unknown){setMsg(errorMessage(error,"Could not export the full history. Try again."));}
    finally{setExportBusy(false);}
  }

  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true); setMsg("");
    try {
      if (notifications) {
        await disablePush();
        setNotifications(false);
        setMsg("Notifications disabled on this device.");
      } else {
        await enablePush();
        setNotifications(true);
        setMsg("Notifications enabled on this device.");
      }
      await refreshPush();
    } catch (error: unknown) { setMsg(errorMessage(error, "Could not change notification settings.")); }
    finally { await refreshPush(); setPushBusy(false); }
  }

  async function restorePush() {
    if (pushBusy) return;
    setPushBusy(true); setMsg("");
    try { await enablePush(); setMsg("Notifications restored on this device."); }
    catch (error: unknown) { setMsg(errorMessage(error, "Your choice is saved. Could not restore notifications yet.")); }
    finally { await refreshPush(); setPushBusy(false); }
  }

  async function testPush() {
    if (pushTesting) return;
    setPushTesting(true);
    setMsg("");
    try {
      const result = await sendTestPush();
      setMsg(`Test notification sent. Delivered: ${result.delivered}, failed: ${result.failed}.`);
    } catch (error: unknown) {
      setMsg(errorMessage(error, "Could not send a test notification."));
    } finally {
      setPushTesting(false);
    }
  }

  function pushSubtitle() {
    if (!pushState) return "Checking notification support…";
    if (!pushState.supported) return "Not supported by this browser/device";
    if (!pushState.configured) return "One-time push setup required";
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !pushState.standalone) return "Install Together to Home Screen first";
    if (pushState.permission === "denied") return "Blocked in device/browser settings";
    if (pushState.verificationFailed) return notifications ? "Your choice is saved. Waiting to verify the connection…" : "Could not verify notifications. Check your connection.";
    if (pushState.needsRepair) return "Your choice is saved. Tap Restore notifications to reconnect this device.";
    if (notifications && pushState.subscribed) return "Enabled on this device · stays saved after updates";
    return "Get an alert when your partner sends a message";
  }

  async function uploadProfilePhoto(file?: File) {
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    setMsg("");
    try {
      await setProfilePhoto(file);
      setMsg("Profile photo updated.");
    } catch (error: unknown) {
      setMsg(errorMessage(error, "Could not update your profile photo."));
    } finally {
      setPhotoBusy(false);
      if (profilePhotoInput.current) profilePhotoInput.current.value = "";
    }
  }

  async function clearProfilePhoto() {
    if (!profile.myAvatarUrl || photoBusy) return;
    setPhotoBusy(true);
    setMsg("");
    try {
      await removeProfilePhoto();
      setMsg("Profile photo removed.");
    } catch (error: unknown) {
      setMsg(errorMessage(error, "Could not remove your profile photo."));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveProfile() {
    if(profileBusy)return;setProfileBusy(true);
    try { await updateProfile({ displayName, nickname, anniversary }); setProfileModal(false); setMsg("Profile updated."); }
    catch (error: unknown) { setMsg(errorMessage(error, "Could not update your profile.")); }
    finally{setProfileBusy(false);}
  }

  async function signOut() {
    try{await signOutSafely();location.href="/login";}catch(error:unknown){setMsg(errorMessage(error,"Could not safely sign out. Try again."));}
  }

  return <div className="settings-experience">
    <PageHeading eyebrow={uiText("MAKE IT YOURS")} title={uiText("Your space, your way.")} description={uiText("Profile, appearance, notifications, and privacy.")}/>
    <div className="card glass profile-card"><div className="overlap-avatars"><ProfileAvatar name={profile.myNickname || profile.myName} src={profile.myAvatarUrl} path={profile.myAvatarPath} size={76}/><ProfileAvatar name={partner} src={profile.partnerAvatarUrl} path={profile.partnerAvatarPath} size={76}/></div><div><h2 className="mini-title" style={{ fontSize: 24, marginBottom: 3 }}>{profile.myNickname || profile.myName} & {partner} ♥</h2><p className="hint">{profile.anniversary ? uiText("Together since {0}", [new Date(`${profile.anniversary}T00:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })]) : uiText("First meeting date not set yet")}</p><span className="pill"><Heart size={14} fill="currentColor" color="var(--rose)"/>{uiText(" Private pair")}</span></div></div>
    {msg && <div className={msg.toLowerCase().includes("enabled") || msg.toLowerCase().includes("updated") ? "notice success" : "notice"} style={{ marginBottom: 10 }}>{uiText(msg)}</div>}

    <h2 className="settings-section-label">{uiText("Profile & appearance")}</h2>
    {profile.myLastSeen&&<p className="own-activity" title={new Date(profile.myLastSeen).toLocaleString()}>{lastSeenLabel(profile.myLastSeen,new Date(),locale).replace(language === "ar" ? "آخر ظهور" : "Last seen", language === "ar" ? "آخر نشاط لك:" : "Your latest activity:")}</p>}
    {profile.presenceError&&<p className="own-activity" role="status">{profile.presenceError}</p>}
    <p className="own-activity">{uiText("Together 3.6.5 · Every photo, in full")}</p>
    <div className="settings-list">
      <LanguageSwitcher/>
      <button className="settings-row settings-button" onClick={() => setProfileModal(true)}><div className="icon-chip"><UserRoundPen size={21}/></div><div className="grow"><h3>{uiText("My profile")}</h3><p>{profile.myName}{uiText(" · nickname: ")}{profile.myNickname || profile.myName}</p></div><ChevronRight size={18}/></button>
      <button className="settings-row settings-button" onClick={() => setPartnerContactOpen(true)}><div className="icon-chip"><UserRoundPen size={21}/></div><div className="grow"><h3>{uiText("Your partner")}</h3><p dir="auto">{partner}{uiText(" · choose the name shown to you")}</p></div><ChevronRight size={18}/></button>
      <div className="settings-row"><div className="icon-chip"><Palette size={21}/></div><div className="grow"><h3>{uiText("Theme")}</h3><p>{uiText("Shared visual theme")}</p></div><div className="swatches">{themeItems.map(t => <button key={t.id} aria-label={uiText("{0} theme", [uiText(t.id)])} aria-pressed={theme===t.id} className="swatch" onClick={() => setTheme(t.id)} style={{ background: t.c, outline: theme === t.id ? "2px solid var(--plum)" : "none", outlineOffset: 2 }}/>)}</div></div>
      <div className="settings-row"><div className="icon-chip"><Sparkles size={21}/></div><div className="grow"><h3>{uiText("Reduce motion")}</h3><p>{uiText("Gentler transitions on this device")}</p></div><button className={`toggle ${reduceMotion?"on":""}`} role="switch" aria-checked={reduceMotion} aria-label={uiText("Reduce motion")} onClick={toggleMotion}/></div>
    </div><h2 className="settings-section-label">{uiText("Notifications & privacy")}</h2><div className="settings-list">
      <div className="settings-row notification-setting"><div className="icon-chip"><Bell size={21}/></div><div className="grow"><h3>{uiText("Notifications")}</h3><p>{uiText(pushSubtitle())}</p>{pushState?.needsRepair && pushState.permission !== "denied" && <button className="push-test-link" disabled={pushBusy} onClick={() => void restorePush()}>{pushBusy ? uiText("Restoring…") : uiText("Restore notifications")}</button>}{notifications && pushState?.subscribed && pushState.permission === "granted" && <button className="push-test-link" disabled={pushTesting} onClick={() => void testPush()}>{pushTesting ? uiText("Sending in 5 seconds…") : uiText("Send test notification")}</button>}</div><button role="switch" aria-checked={notifications} aria-label={notifications ? uiText("Disable notifications") : uiText("Enable notifications")} disabled={pushBusy || !pushState} className={`toggle ${notifications ? "on" : ""}`} onClick={() => void togglePush()}><span/></button></div>
      <div className="settings-row"><div className="icon-chip"><Lock size={21}/></div><div className="grow"><h3>{uiText("Privacy Lock")}</h3><p>{uiText("Local PIN convenience lock for this device")}</p></div>{pinOn ? <><button className="soft-btn secondary" style={{ height: 36, padding: "0 10px" }} onClick={() => { lockSession(); location.reload(); }}>{uiText("Lock")}</button><button className="soft-btn secondary" style={{ height: 36, padding: "0 10px" }} onClick={() => { clearLocalPin(); setPinOn(false); setMsg("Local PIN removed."); }}>{uiText("Off")}</button></> : <button className="soft-btn secondary" style={{ height: 36 }} onClick={() => setPinModal(true)}>{uiText("Set PIN")}</button>}</div>
    </div><h2 className="settings-section-label">{uiText("Your shared space")}</h2><div className="settings-list">
      <Link href="/calls" className="settings-row"><div className="icon-chip"><Phone size={21}/></div><div className="grow"><h3>{uiText("Voice & video calls")}</h3><p>{uiText("Call history, details and missed calls")}</p></div><ChevronRight size={18}/></Link>
      <Link href="/moments" className="settings-row"><div className="icon-chip"><CalendarHeart size={21}/></div><div className="grow"><h3>{uiText("Shared dates")}</h3><p>{dates.length}{uiText(" saved dates and milestones")}</p></div><ChevronRight size={18}/></Link>
      <button className="settings-row settings-button" disabled={exportBusy} onClick={()=>void exportData()}><div className="icon-chip"><Cloud size={21}/></div><div className="grow"><h3>{exportBusy?uiText("Exporting…"):uiText("Export complete metadata")}</h3><p>{uiText("All visible history; media files excluded")}</p></div><ChevronRight size={18}/></button>
      <Link href="/install" className="settings-row"><div className="icon-chip"><Cloud size={21}/></div><div className="grow"><h3>{uiText("Install Together")}</h3><p>{uiText("Add the PWA to the Home Screen")}</p></div><ChevronRight size={18}/></Link>
    </div><h2 className="settings-section-label">{uiText("Account")}</h2><div className="settings-list">
      <button className="settings-row settings-button danger-row" onClick={() => void signOut()}><div className="icon-chip"><LogOut size={21}/></div><div className="grow"><h3>{uiText("Sign out")}</h3><p>{uiText("Close this account on this device")}</p></div></button>
    </div>

    <p className="settings-footer">{uiText("Only your paired accounts can access your shared space. The PIN adds a local device lock; it does not provide end-to-end encryption.")}</p>

    {partnerContactOpen && <PartnerContactDialog onClose={() => setPartnerContactOpen(false)}/>}

    {pinModal && <Overlay><div className="modal"><h2>{uiText("Create local PIN")}</h2><p className="hint">{uiText("Choose 4–8 digits to lock this app on this device.")}</p><input aria-label={uiText("New PIN")} className="input" inputMode="numeric" type="password" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))}/><div className="modal-actions"><button className="soft-btn secondary" onClick={() => setPinModal(false)}>{uiText("Cancel")}</button><button className="soft-btn" onClick={() => void configurePin()}>{uiText("Enable")}</button></div></div></Overlay>}

    {profileModal && <Overlay><div className="modal"><h2>{uiText("Edit your profile")}</h2><div className="profile-photo-editor"><ProfileAvatar name={profile.myNickname || profile.myName} src={profile.myAvatarUrl} path={profile.myAvatarPath} size={94}/><div className="profile-photo-actions"><button className="soft-btn secondary" disabled={photoBusy} onClick={() => profilePhotoInput.current?.click()}><Camera size={16}/>{photoBusy ? uiText("Uploading…") : profile.myAvatarUrl ? uiText("Change photo") : uiText("Add photo")}</button>{profile.myAvatarUrl && <button className="profile-photo-remove" disabled={photoBusy} onClick={() => void clearProfilePhoto()}><Trash2 size={15}/>{uiText("Remove")}</button>}</div><input ref={profilePhotoInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={e => void uploadProfilePhoto(e.target.files?.[0])}/></div><div className="form-stack"><label className="field-label" htmlFor="profile-name">{uiText("Display name")}</label><input id="profile-name" className="input" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={uiText("Your name")}/><label className="field-label" htmlFor="profile-nickname">{uiText("Nickname shown to your partner")}</label><input id="profile-nickname" className="input" value={nickname} onChange={e => setNickname(e.target.value)} placeholder={uiText("Nickname")}/><label className="field-label" htmlFor="profile-anniversary">{uiText("First meeting date")}</label><input id="profile-anniversary" className="input" type="date" value={anniversary} onChange={e => setAnniversary(e.target.value)}/></div><div className="modal-actions"><button className="soft-btn secondary" onClick={() => setProfileModal(false)}>{uiText("Cancel")}</button><button className="soft-btn" disabled={profileBusy} onClick={() => void saveProfile()}>{profileBusy?uiText("Saving…"):uiText("Save changes")}</button></div></div></Overlay>}
  </div>;
}
