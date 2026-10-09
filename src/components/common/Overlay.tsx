"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Body-level portals escape animated route stacking/containing blocks. */
export function Overlay({ children, className = "", style, onClick }: { children: ReactNode; className?: string; style?: CSSProperties; onClick?: React.MouseEventHandler<HTMLDivElement> }) {
  const [mounted, setMounted] = useState(false);
  const [viewport, setViewport] = useState<CSSProperties>({});
  useEffect(() => {
    setMounted(true);
    const visual = window.visualViewport;
    const update = () => setViewport(visual ? { inset: "auto", top: visual.offsetTop, left: visual.offsetLeft, width: visual.width, height: visual.height, "--overlay-height": `${visual.height}px` } as CSSProperties : {});
    update(); visual?.addEventListener("resize", update); visual?.addEventListener("scroll", update); window.addEventListener("resize", update);
    return () => { visual?.removeEventListener("resize", update); visual?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  return mounted ? createPortal(<div className={`modal-backdrop app-overlay ${className}`} style={{ ...viewport, ...style }} onClick={onClick}>{children}</div>, document.body) : null;
}

export function AppDialog({ title, eyebrow, children, footer, onClose, busy = false, className = "" }: { title: string; eyebrow?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const { t: uiText } = useLanguage();

  return <Overlay><section className={`modal app-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}><header className="app-dialog-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="icon-button" aria-label={uiText("Close")} disabled={busy} onClick={onClose}><X size={20}/></button></header><div className="app-dialog-body">{children}</div>{footer && <footer className="app-dialog-footer">{footer}</footer>}</section></Overlay>;
}
