"use client";
import { useLanguage } from "@/components/i18n/LanguageProvider";

import { Overlay } from "@/components/common/Overlay";
import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { errorMessage } from "@/lib/errors";
export function ConfirmDialog({title,description,onConfirm,onClose}:{title:string;description:string;onConfirm:()=>Promise<void>;onClose:()=>void}) {
  const { t: uiText } = useLanguage();

  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function confirm(){if(busy)return;setBusy(true);setError("");try{await onConfirm();onClose();}catch(error:unknown){setError(errorMessage(error,"Could not delete. Try again."));}finally{setBusy(false);}}
  return <Overlay><section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button className="dialog-close" aria-label={uiText("Close")} disabled={busy} onClick={onClose}><X size={20}/></button><span className="confirm-icon"><Trash2 size={24}/></span><h2 id="confirm-title">{title}</h2><p className="hint">{description}</p>{error&&<p className="notice error" role="alert">{uiText(error)}</p>}<div className="modal-actions"><button className="soft-btn secondary" disabled={busy} onClick={onClose} autoFocus>{uiText("Keep it")}</button><button className="soft-btn danger-button" disabled={busy} onClick={()=>void confirm()}>{busy?uiText("Deleting…"):uiText("Delete")}</button></div></section></Overlay>;
}
