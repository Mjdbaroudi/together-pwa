"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Heart, Home, Image as ImageIcon, MessageCircle, Settings2, type LucideIcon } from "lucide-react";
import { partnerLabel } from "@/lib/together/contactPreferences";
import { useTogether } from "@/components/providers/TogetherProvider";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/memories", label: "Memories", icon: ImageIcon },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/moments", label: "Moments", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

function UnreadBadge({ count }: { count: number }) {
  const { t: uiText } = useLanguage();

  if (!count) return null;
  return <span className="nav-unread-badge" aria-label={uiText("{0} unread messages", [count])}>{count > 99 ? "99+" : count}</span>;
}

export function BottomNav() {
  const { t: uiText } = useLanguage();

  const pathname = usePathname();
  const { unreadCount,profile } = useTogether();
  return <nav className="bottom-nav" aria-label={uiText("Main navigation")}>
    <div className="rail-brand"><span><Heart size={24}/></span><b>{uiText("Together")}</b><small>{uiText("JUST YOU AND ME")}</small></div>
    {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
      const active = pathname.startsWith(href);
      return <Link key={href} href={href} aria-current={active?"page":undefined} className={`nav-item ${active ? "active" : ""}`}>
        <Icon size={20}/>
        <span>{uiText(label)}</span>
        {href==="/chat"&&<UnreadBadge count={unreadCount}/>}
      </Link>;
    })}
    <div className="rail-footer"><span className={`presence-dot ${profile.partnerOnline?"online":""}`}/><div><b>{partnerLabel(profile)}</b><small>{profile.partnerOnline?uiText("Online now"):uiText("Your private space")}</small></div></div>
  </nav>;
}
