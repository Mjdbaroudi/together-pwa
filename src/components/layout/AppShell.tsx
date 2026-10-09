"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { Overlay } from "@/components/common/Overlay";
import { StartupLoading } from "@/components/common/StartupLoading";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BottomNav } from "@/components/navigation/BottomNav";
import { useTogether } from "@/components/providers/TogetherProvider";
import { hasLocalPin, isSessionUnlocked, verifyLocalPin } from "@/lib/security/pin";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useAppVisualViewport } from "@/hooks/useAppVisualViewport";
import { VoiceCallsProvider } from "@/components/calls/VoiceCallsProvider";

export function AppShell({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const { t: uiText } = useLanguage();

  const { configured, loading, pairReady, unreadCount, loadError, refresh } = useTogether();
  const router = useRouter();
  const path = usePathname();
  const isChat = path.startsWith("/chat");
  const [locked, setLocked] = useState(true);
  const [lockReady,setLockReady]=useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) Together` : "Together — Just You and Me";
  }, [unreadCount]);

  useEffect(() => {
    setLocked(hasLocalPin() && !isSessionUnlocked());setLockReady(true);
    if (!configured) { router.replace("/login"); return; }
    getSupabaseBrowser()?.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else if (!loading && !pairReady && !loadError) router.replace("/login");
    });
  }, [configured, loading, pairReady, loadError, path, router]);

  useAppVisualViewport();

  async function unlock() {
    if (await verifyLocalPin(pin)) { setLocked(false); setError(""); setPin(""); }
    else setError("Wrong PIN. Try again.");
  }

  const mainClass = [scroll ? "app-scroll" : "", isChat ? "app-scroll-chat" : "", "route-enter-motion"].filter(Boolean).join(" ");

  return <VoiceCallsProvider enabled={lockReady&&!locked&&!loading&&pairReady}><div className="app-outer"><div className={`app-frame experience-v26 ${isChat ? "chat-route" : ""} ${loading ? "shell-starting" : ""}`}>
    <a className="skip-link" href="#app-main">{uiText("Skip to content")}</a>
    <main id="app-main" key={path} className={mainClass}>{loading ? <StartupLoading /> : lockReady&&!locked?<>{loadError&&<div className="notice error shell-error" role="alert">{uiText(loadError)}<button className="text-button" onClick={()=>void refresh()}>{uiText("Retry")}</button></div>}{children}</>:null}</main>
    {!loading&&lockReady&&!locked&&<BottomNav />}
    {lockReady&&locked && <Overlay><div className="modal" role="dialog" aria-modal="true" aria-label={uiText("Private lock")}>
      <h2>{uiText("Private lock 🔒")}</h2><p className="hint">{uiText("Enter your local PIN to open Together on this device.")}</p>
      <input className="input" type="password" inputMode="numeric" autoFocus maxLength={8} value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === "Enter" && unlock()} placeholder={uiText("PIN")}/>
      {error && <p className="error" style={{ padding: 8, borderRadius: 12 }}>{uiText(error)}</p>}
      <div className="modal-actions"><button className="soft-btn" onClick={unlock}>{uiText("Unlock")}</button></div>
    </div></Overlay>}
  </div></div></VoiceCallsProvider>;
}
