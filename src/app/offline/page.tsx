"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { Heart } from "lucide-react";
export default function OfflinePage() {
  const { t: uiText } = useLanguage();

  return <main className="standalone-center"><div className="empty-state"><Heart size={38} fill="currentColor"/><h1>{uiText("You’re offline")}</h1><p>{uiText("Together is still installed. Reconnect to sync private messages and media.")}</p></div></main>;
}
