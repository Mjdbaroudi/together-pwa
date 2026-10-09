"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";


import { useState } from "react";
import { InitialAvatar } from "@/components/common/InitialAvatar";
import { ProfilePhotoViewer } from "@/components/common/ProfilePhotoViewer";

export function ProfileAvatar({ name, src, path, size = 54 }: { name: string; src?: string; path?: string; size?: number }) {
  const { t: uiText } = useLanguage();

  const [open, setOpen] = useState(false);
  if (!src && !path) return <InitialAvatar name={name} size={size}/>;
  return <><button className="profile-avatar-button" style={{ width: size, height: size }} aria-label={uiText("View {0} profile photo", [name])} aria-haspopup="dialog" onClick={() => setOpen(true)}><InitialAvatar name={name} src={src} size={size}/></button>{open && <ProfilePhotoViewer name={name} src={src} path={path} onClose={() => setOpen(false)}/>}</>;
}
