"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { Download, Share2, SquarePlus, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeading } from "@/components/common/PageHeading";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function InstallPage() {
  const { t: uiText } = useLanguage();

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return <>
    <PageHeading eyebrow={uiText("ALWAYS A LITTLE CLOSER")} title={uiText("Take Together with you.")} description={uiText("Your own space, one tap from your Home Screen.")}/>

    {installed && <div className="notice success">{uiText("Together is already running in standalone app mode on this device.")}</div>}
    {installPrompt && <button className="soft-btn" style={{ width: "100%", margin: "12px 0" }} onClick={() => void install()}><Download size={18} style={{ display: "inline", marginRight: 6 }}/>{uiText("Install app")}</button>}

    <div className="card glass" style={{ marginTop: 14 }}>
      <h2 className="mini-title">{uiText("iPhone / iPad")}</h2>
      <div className="install-step"><b>1</b><p>{uiText("Open Together in Safari using your deployed HTTPS address.")}</p></div>
      <div className="install-step"><b>2</b><p>{uiText("Tap ")}<Share2 size={15} style={{ display: "inline" }}/>{uiText(" Share.")}</p></div>
      <div className="install-step"><b>3</b><p>{uiText("Choose ")}<SquarePlus size={15} style={{ display: "inline" }}/>{uiText(" Add to Home Screen, then confirm.")}</p></div>
    </div>

    <div className="card glass" style={{ marginTop: 12 }}>
      <h2 className="mini-title">{uiText("Android / Chrome")}</h2>
      <p className="hint">{uiText("Use the install button above when available, or Chrome menu → Add to Home screen / Install app.")}</p>
    </div>

    <div className="card glass" style={{ marginTop: 12 }}>
      <h2 className="mini-title"><WifiOff size={18} style={{ display: "inline", marginRight: 6 }}/>{uiText("Offline behavior")}</h2>
      <p className="hint">{uiText("Reconnect to sync your conversation and media. Text messages queued while the app is open will send when your connection returns.")}</p>
    </div>
  </>;
}
