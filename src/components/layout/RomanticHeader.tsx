"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { Heart } from "lucide-react";
export function RomanticHeader({ compact=false }: { compact?: boolean }) {
  const { t: uiText } = useLanguage();

  return <div className={`brand ${compact ? "brand-compact" : ""}`}>
    <div className="brand-heart"><Heart size={compact ? 15 : 18} fill="currentColor" style={{margin:"auto"}}/></div>
    <div className="brand-title">{uiText("Together")}</div>
    <div className="brand-sub">{uiText("JUST YOU AND ME")}</div>
  </div>;
}
