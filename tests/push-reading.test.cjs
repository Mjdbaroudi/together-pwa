const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
 const windowEvents=new Map(),documentEvents=new Map(),workerEvents=new Map(),timers=new Set(),rpc=[],keepalive=[],states=[];
 let user='a',endpoint='https://push.test/a',deferSession,error;
 const document={visibilityState:'visible',hasFocus:()=>focused,querySelector:()=>modal,addEventListener:(k,v)=>documentEvents.set(k,v),removeEventListener:k=>documentEvents.delete(k)};
 let focused=true,modal=false;
 const supabase={auth:{getSession:async()=>deferSession?await deferSession:{data:{session:{user:{id:user},access_token:'private-test-token'}}}},rpc:(name,input)=>{rpc.push({...input});return {abortSignal:async()=>({error})};}};
 const globals={document,navigator:{onLine:true,serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>endpoint?{endpoint}:null}}),addEventListener:(k,v)=>workerEvents.set(k,v),removeEventListener:k=>workerEvents.delete(k)}},window:{addEventListener:(k,v)=>windowEvents.set(k,v),removeEventListener:k=>windowEvents.delete(k)},AbortController,fetch:async(url,options)=>{keepalive.push({url,...options,data:JSON.parse(options.body)});return {ok:true};},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),setTimeout,clearTimeout};
 const api=load('lib/push/reading.ts',globals,{'@/lib/supabase/client':{getPublicSupabaseConfig:()=>({url:'https://db.test',key:'public-test-key'})}});
 const service=api.startPushReading(supabase,'a',state=>states.push(state));
 return {service,rpc,keepalive,states,globals,events:windowEvents,documentEvents,timers,workerEvents,setUser:v=>user=v,setEndpoint:v=>endpoint=v,setFocus:v=>focused=v,setModal:v=>modal=v,setError:v=>error=v,defer:v=>deferSession=v};
}
test('chat activates only the owned existing subscription without changing notification settings',async()=>{
 const f=fixture();try{f.service.setReading(true);await flush();assert.equal(f.rpc.length,1);assert.equal(f.rpc[0].p_endpoint,'https://push.test/a');assert.equal(f.rpc[0].p_reading,true);assert.ok(f.rpc[0].p_client);for(const tick of f.timers)tick();await flush();assert.equal(f.rpc.length,2);assert.ok(f.rpc[1].p_sequence>f.rpc[0].p_sequence);}finally{f.service.stop();}
});
test('hiding, losing focus and leaving chat release with keepalive before awaiting authentication',async()=>{
 const f=fixture();try{f.service.setReading(true);await flush();f.defer(new Promise(()=>{}));f.globals.document.visibilityState='hidden';f.documentEvents.get('visibilitychange')();assert.equal(f.keepalive[0].keepalive,true);assert.equal(f.keepalive[0].data.p_reading,false);assert.ok(f.keepalive[0].data.p_sequence>f.rpc[0].p_sequence);f.events.get('blur')();f.service.setReading(false);assert.ok(f.keepalive.every(r=>r.data.p_reading===false));}finally{f.service.stop();}
 assert.equal(f.timers.size,0);assert.equal(f.events.size,0);assert.equal(f.workerEvents.size,0);
});
test('a late subscription/auth discovery never starts a lease after leaving or account change',async()=>{
 for(const action of ['leave','stop','account']){const f=fixture();let resolve;f.defer(new Promise(r=>resolve=r));try{f.service.setReading(true);if(action==='leave')f.service.setReading(false);if(action==='stop')f.service.stop();resolve({data:{session:{user:{id:action==='account'?'b':'a'},access_token:'token'}}});await flush();assert.equal(f.rpc.length,0);}finally{f.service.stop();}}
});
test('pagehide freezes renewal until pageshow even if browser visibility remains stale',async()=>{
 const f=fixture();try{f.service.setReading(true);await flush();const before=f.rpc.length;f.events.get('pagehide')();f.events.get('focus')();f.events.get('online')();for(const tick of f.timers)tick();await flush();assert.equal(f.rpc.length,before);assert.equal(f.keepalive.at(-1).data.p_reading,false);f.events.get('pageshow')();await flush();assert.equal(f.rpc.length,before+1);assert.equal(f.rpc.at(-1).p_reading,true);}finally{f.service.stop();}
});
test('background, unfocused and offline states never refresh a reading lease',async()=>{
 for(const action of ['hidden','blur','offline']){const f=fixture();try{if(action==='hidden')f.globals.document.visibilityState='hidden';if(action==='blur')f.setFocus(false);if(action==='offline')f.globals.navigator.onLine=false;f.service.setReading(true);for(const tick of f.timers)tick();await flush();assert.equal(f.rpc.length,0);}finally{f.service.stop();}}
});
test('in-chat gallery or search dialogs keep suppressing notifications without changing read receipts',async()=>{
 const f=fixture();try{f.setModal(true);f.service.setReading(true);await flush();assert.equal(f.rpc.length,1);assert.equal(f.rpc[0].p_reading,true);f.service.stop();assert.equal(f.keepalive.at(-1).data.p_reading,false);}finally{f.service.stop();}
});
test('subscription replacement releases only the old endpoint and activates the new one',async()=>{
 const f=fixture();try{f.service.setReading(true);await flush();f.setEndpoint('https://push.test/new');f.events.get('together:push-state')();await flush();assert.equal(f.keepalive[0].data.p_endpoint,'https://push.test/a');assert.equal(f.rpc.at(-1).p_endpoint,'https://push.test/new');f.setEndpoint(null);f.events.get('together:push-state')();await flush();assert.equal(f.keepalive.at(-1).data.p_endpoint,'https://push.test/new');}finally{f.service.stop();}
});
test('missing SQL reports an actionable localized key and clears after a successful retry',async()=>{
 const f=fixture();try{f.setError({code:'PGRST202'});f.service.setReading(true);await flush();assert.match(f.states.at(-1),/016/);f.setError(null);for(const tick of f.timers)tick();await flush();assert.equal(f.states.at(-1),undefined);}finally{f.service.stop();}
});
