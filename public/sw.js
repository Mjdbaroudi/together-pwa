const CACHE="together-shell-v28";
// Active-chat message pushes are filtered per device by migration 016 before sending.
// Still show every received push: WebKit requires a visible notification, including late deliveries.
const SHELL=["/offline","/icons/icon-192.png","/icons/icon-512.png"];

// Foreground state hints sent by the currently open PWA window.
// iOS does not always report WindowClient.focused/visibilityState consistently,
// so this is used as an additional signal rather than the only source of truth.
const clientState=new Map();

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("together-shell-")&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message",event=>{
  if(event.data?.type==="TOGETHER_CLOSE_CALL_NOTIFICATION"){
    event.waitUntil(self.registration.getNotifications({tag:`together-call-${event.data.callId}`}).then(items=>items.forEach(item=>item.close())));
    return;
  }
  if(event.data?.type!=="TOGETHER_CLIENT_STATE") return;
  const source=event.source;
  if(!source?.id) return;
  clientState.set(source.id,{
    pathname:String(event.data.pathname||"/"),
    visible:Boolean(event.data.visible),
    callVisible:Boolean(event.data.callVisible),
    focused:Boolean(event.data.focused),
    ts:Number(event.data.ts||Date.now())
  });
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;

  if(req.mode==="navigate"){
    event.respondWith(fetch(req).catch(()=>caches.match("/offline")));
    return;
  }

  if(url.pathname.startsWith("/_next/static/")||url.pathname.startsWith("/icons/")){
    event.respondWith(
      caches.open(CACHE).then(async cache=>{
        const hit=await cache.match(req);
        if(hit)return hit;
        const res=await fetch(req);
        if(res.ok)cache.put(req,res.clone());
        return res;
      })
    );
  }
});

function isChatPath(pathname){
  return pathname==="/chat"||pathname.startsWith("/chat/");
}

self.addEventListener("push",event=>{
  event.waitUntil((async()=>{
    let data={title:"Together ♥",body:"You have a new private message.",url:"/chat"};
    try{data={...data,...event.data.json()}}catch{}

    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true}).catch(()=>[]);
    const now=Date.now();

    if(data.type==="voice-call"){
      if(!data.callId || !Number.isFinite(data.expiresAt) || data.expiresAt<=now){
        // Even a delayed push must be visible; do not ring an expired call.
        await self.registration.showNotification("Together ♥",{body:"Open Together to check your calls.",icon:"/icons/icon-192.png",badge:"/icons/icon-192.png",data:{url:"/calls"},tag:"together-call-update"});
        return;
      }
      for(const client of windows){
        try{client.postMessage({type:"TOGETHER_CALL_PUSH",payload:data});}catch{}
      }
      await self.registration.showNotification(data.title,{body:data.body,icon:"/icons/icon-192.png",badge:"/icons/icon-192.png",data:{url:data.url},tag:`together-call-${data.callId}`});
      return;
    }

    const chatIsForeground=windows.some(client=>{
      let path="/";
      try{path=new URL(client.url).pathname}catch{}

      // Unknown visibility never proves that chat is in the foreground.
      const visibility=client.visibilityState;
      const visibleByClientApi=isChatPath(path) && visibility==="visible" && client.focused===true;

      const hint=clientState.get(client.id);
      const hintFresh=hint && (now-hint.ts)<30000;

      return hintFresh ? Boolean(hint.visible && hint.focused && isChatPath(hint.pathname)) : visibleByClientApi;
    });

    if(chatIsForeground){
      // Keep the foreground bridge, but also fulfill userVisibleOnly.
      // WebKit can revoke subscriptions when pushes do not show a notification.
      for(const client of windows){
        try{
          const path=new URL(client.url).pathname;
          if(isChatPath(path)) client.postMessage({type:"TOGETHER_PUSH_RECEIVED_IN_CHAT",payload:data});
        }catch{}
      }
    }

    await self.registration.showNotification(data.title,{
      body:data.body,
      icon:"/icons/icon-192.png",
      badge:"/icons/icon-192.png",
      data:{url:data.url},
      tag:"together-message"
    });
  })());
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
      for(const c of list){
        if("focus" in c){
          c.navigate(event.notification.data?.url||"/chat");
          return c.focus();
        }
      }
      return clients.openWindow(event.notification.data?.url||"/chat");
    })
  );
});
