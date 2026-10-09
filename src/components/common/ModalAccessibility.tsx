"use client";
import { useEffect } from "react";

// One shared manager covers portal dialogs and inline dialogs alike.
export function ModalAccessibility() {
  useEffect(()=>{
    let dialog:HTMLElement|null=null,previous:HTMLElement|null=null;
    let lastOutside:HTMLElement|null=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const remember=(event:Event)=>{const target=event.target;if(target instanceof HTMLElement&&!target.closest('[aria-modal="true"],.modal,.chat-tools-panel,.chat-media-viewer'))lastOutside=target.closest<HTMLElement>('button,a,input,textarea,select,[tabindex]')||target;};
    let inertNodes:{node:HTMLElement;previous:boolean}[]=[];
    let scrollLocks:{node:HTMLElement;overflow:string}[]=[];
    const focusables=()=>dialog ? [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]')].filter(node=>node.getClientRects().length && !node.closest('[inert]')):[];
    const restore=()=>{inertNodes.forEach(item=>{item.node.inert=item.previous;});inertNodes=[];scrollLocks.forEach(item=>{item.node.style.overflow=item.overflow;});scrollLocks=[];};
    const update=()=>{
      // Annotate older inline modals without changing their React markup.
      document.querySelectorAll<HTMLElement>('.modal,.chat-media-viewer,.chat-tools-panel').forEach(node=>{
        node.setAttribute("role","dialog");node.setAttribute("aria-modal","true");
        if(!node.hasAttribute("aria-label"))node.setAttribute("aria-label",node.querySelector('h2')?.textContent||"Dialog");
      });
      const dialogs=[...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')];
      const next=dialogs[dialogs.length-1]||null;
      if(next===dialog)return;
      restore();
      const old=dialog;dialog=next;
      if(!next){if(previous?.isConnected)previous.focus({preventScroll:true});previous=null;return;}
      [document.body,...document.querySelectorAll<HTMLElement>('.app-scroll')].forEach(node=>{scrollLocks.push({node,overflow:node.style.overflow});node.style.overflow="hidden";});
      if(!old)previous=next.contains(document.activeElement)?lastOutside:document.activeElement instanceof HTMLElement?document.activeElement:lastOutside;
      let branch:HTMLElement=next;
      while(branch.parentElement && branch.parentElement!==document.documentElement){
        [...branch.parentElement.children].forEach(sibling=>{
          if(sibling!==branch && sibling instanceof HTMLElement){inertNodes.push({node:sibling,previous:sibling.inert});sibling.inert=true;}
        });
        branch=branch.parentElement;
      }
      next.tabIndex=-1;
      if(!next.contains(document.activeElement))(focusables()[0]||next).focus({preventScroll:true});
    };
    const key=(event:KeyboardEvent)=>{
      if(!dialog)return;
      if(event.key==="Escape"){
        const close=dialog.querySelector<HTMLElement>('[data-dialog-close],[aria-label="Close"],[aria-label="إغلاق"],.sheet-cancel') || [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>["Cancel","إلغاء"].includes(button.textContent?.trim()||""));
        if(close){event.preventDefault();close.click();}
      }
      if(event.key!=="Tab")return;
      const nodes=focusables(),first=nodes[0],last=nodes[nodes.length-1];
      if(!first){event.preventDefault();dialog.focus();return;}
      if(event.shiftKey && (document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey && (document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    const observer=new MutationObserver(update);observer.observe(document.body,{subtree:true,childList:true});
    document.addEventListener("keydown",key,true);update();
    document.addEventListener("pointerdown",remember,true);document.addEventListener("focusin",remember,true);
    return ()=>{observer.disconnect();document.removeEventListener("keydown",key,true);document.removeEventListener("pointerdown",remember,true);document.removeEventListener("focusin",remember,true);restore();};
  },[]);
  return null;
}
