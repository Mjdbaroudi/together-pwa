"use client";
import { Download, LoaderCircle, Share2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Overlay } from "@/components/common/Overlay";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useImageGestures } from "@/hooks/useImageGestures";
import { signMediaPath } from "@/lib/together/media";
import { downloadPhotoFile, loadDatePhotoFile } from "@/lib/together/photoFile";
import { dateOnlyLabel } from "@/lib/story";
import { errorMessage } from "@/lib/errors";

export function DatePhotoViewer({ path, title, day, onClose }: { path:string; title:string; day?:string; onClose:()=>void }) {
  const { t, locale } = useLanguage();
  const [url,setUrl]=useState<string>(),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [file,setFile]=useState<File>(),[busy,setBusy]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const lifecycle=useRef({alive:false,retried:false,request:undefined as AbortController|undefined,busy:false,generation:0});
  const gestures=useImageGestures(url,Boolean(url),()=>undefined);
  useEffect(()=>{
    const state=lifecycle.current, generation=++state.generation;state.alive=true;state.retried=false;state.busy=false;
    setUrl(undefined);setLoaded(false);setFile(undefined);setError('');setNotice('');setBusy(false);
    void signMediaPath(path).then(value=>{if(!state.alive||generation!==state.generation)return;if(value)setUrl(value);else setError('This photo is unavailable. Please try again.');}).catch(()=>{if(state.alive&&generation===state.generation)setError('This photo is unavailable. Please try again.');});
    return()=>{state.alive=false;++state.generation;state.request?.abort();};
  },[path]);
  async function retry(force=false){
    const state=lifecycle.current,generation=state.generation;if(!force&&state.retried){setLoaded(false);setError('Could not display this photo. Try again or download the image.');return;}
    state.retried=true;setLoaded(false);setError('');setAttempt(value=>value+1);
    try{const next=await signMediaPath(path,true);if(!state.alive||generation!==state.generation)return;if(next)setUrl(next);else setError('This photo is unavailable. Please try again.');}
    catch{if(state.alive&&generation===state.generation)setError('This photo is unavailable. Please try again.');}
  }
  async function prepare(download:boolean){
    const state=lifecycle.current;if(state.busy)return;state.busy=true;setBusy(true);setError('');setNotice('');
    const generation=state.generation,controller=new AbortController();state.request=controller;
    try{
      const prepared=file||await loadDatePhotoFile(path,day,controller.signal);
      if(!state.alive||generation!==state.generation||controller.signal.aborted)return;
      setFile(prepared);
      if(download){downloadPhotoFile(prepared);setNotice('Download requested. You can also use Save or share.');}
      else setNotice('Photo ready. Tap Save or share to choose where to save it.');
    }catch(reason){if(state.alive&&generation===state.generation&&!controller.signal.aborted)setError(errorMessage(reason,'Could not prepare this photo. Check your connection and try again.'));}
    finally{if(state.alive&&generation===state.generation){state.busy=false;setBusy(false);state.request=undefined;}}
  }
  function share(){
    if(busy)return;setError('');setNotice('');
    if(!navigator.share||!navigator.canShare){setNotice('File sharing is unavailable here. Use Download photo instead.');return;}
    if(!file){void prepare(false);return;}
    if(!navigator.canShare({files:[file]})){setNotice('File sharing is unavailable here. Use Download photo instead.');return;}
    // A ready File is shared synchronously from this fresh click: no network await on iOS.
    try{const state=lifecycle.current,generation=state.generation;void navigator.share({files:[file],title}).catch(reason=>{if(state.alive&&generation===state.generation&&!(reason instanceof DOMException&&reason.name==='AbortError'))setError('Could not share this photo. You can still download it.');});}
    catch{setError('Could not share this photo. You can still download it.');}
  }
  return <Overlay className="date-photo-overlay"><section className="date-photo-viewer" role="dialog" aria-modal="true" aria-label={t('Full photo for {0}',[title])}>
    <header className="date-viewer-header"><button type="button" data-dialog-close onClick={onClose} aria-label={t('Close')}><X size={22}/></button><div><span>{t('A CHAPTER TO KEEP')}</span><h2 dir="auto">{title}</h2>{day&&<time dateTime={day}>{dateOnlyLabel(day,locale)}</time>}</div></header>
    <div ref={gestures.stageRef} className="date-viewer-stage photo-gesture-stage" onPointerDown={gestures.onPointerDown} onPointerMove={gestures.onPointerMove} onPointerUp={gestures.onPointerUp} onPointerCancel={gestures.onPointerCancel} onLostPointerCapture={gestures.onLostPointerCapture}>
      {url&&<img ref={gestures.imageRef} key={`${url}:${attempt}`} src={url} alt={title} draggable={false} decoding="async" onLoad={()=>{gestures.onLoad();setLoaded(true);setError('');}} onError={()=>void retry()}/>}
      {!loaded&&!error&&<span className="date-viewer-loading" role="status"><LoaderCircle size={22}/>{t('Loading photo…')}</span>}
      {!loaded&&error&&<button type="button" className="date-viewer-retry" onClick={()=>void retry(true)}>{t('Try again')}</button>}
    </div>
    {(error||notice)&&<p className={`date-viewer-status ${error?'is-error':''}`} role={error?'alert':'status'}>{t(error||notice)}</p>}
    <footer className="date-viewer-footer"><div className="date-viewer-zoom" role="group" aria-label={t('Photo zoom')}><button type="button" onClick={()=>gestures.zoomTo(gestures.scale-.5)} disabled={!loaded||gestures.scale<=1} aria-label={t('Zoom out')}><ZoomOut size={19}/></button><button type="button" onClick={()=>gestures.zoomTo(1)} disabled={!loaded} aria-label={t('Reset zoom')}><output ref={gestures.labelRef} aria-label={t('Zoom level')}>100%</output></button><button type="button" onClick={()=>gestures.zoomTo(gestures.scale+.5)} disabled={!loaded||gestures.scale>=5} aria-label={t('Zoom in')}><ZoomIn size={19}/></button><span>{t('Pinch to zoom · drag to explore')}</span></div>
      <div className="date-viewer-actions"><button type="button" onClick={()=>void prepare(true)} disabled={busy||!url}><Download size={18}/><span>{t(busy?'Preparing photo…':'Download photo')}</span></button><button type="button" onClick={share} disabled={busy||!url}><Share2 size={18}/><span>{t(file?'Save or share':'Prepare sharing')}</span></button></div>
    </footer>
  </section></Overlay>;
}
