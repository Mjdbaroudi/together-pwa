const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const document=new EventTarget(),window=new EventTarget();document.visibilityState='visible';const navigator={onLine:true};
  const timers=new Map(),intervals=new Map(),calls=[],updates=[],statuses=[];let serial=0,removed=0;
  const row={user_id:'partner',online:true,last_seen:'2026-10-08T10:00:00.000Z',server_now:'2026-10-08T10:00:00.000Z',valid_until:'2026-10-08T10:01:15.000Z'};
  let error=null,authUser='me',authWait=null;
  const supabase={auth:{getSession:async()=>{if(authWait)await authWait;return {data:{session:{user:{id:authUser},access_token:'test-token'}}};}},rpc:(name,input)=>({abortSignal:async()=>{calls.push({name,...input});return {data:name==='read_app_presence'?[{...row}]:row.last_seen,error};}}),channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:async()=>{removed++;}};
  const globals={document,window,navigator,AbortController,setInterval:fn=>{const id=++serial;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
  const api=load('lib/together/presence.ts',globals,{'@/lib/supabase/client':{getPublicSupabaseConfig:()=>null}});
  const start=()=>api.startAppPresence(supabase,'me','pair',rows=>updates.push(rows),value=>statuses.push(value));
  return {api,start,calls,updates,statuses,timers,intervals,document,window,navigator,row,get removed(){return removed;},setError:value=>error=value,setAuth:value=>authUser=value,holdAuth:value=>authWait=value,hide:()=>{document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));},show:()=>{document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));}};
}
test('last seen formats today, yesterday, older dates, invalid and previous years using the device timezone',()=>{
  const {api}=fixture(),now=new Date(2026,9,8,12,30);assert.match(api.lastSeenLabel(new Date(2026,9,8,10,15).toISOString(),now),/^Last seen today at /);assert.match(api.lastSeenLabel(new Date(2026,9,7,23,59).toISOString(),now),/^Last seen yesterday at /);assert.match(api.lastSeenLabel(new Date(2025,8,4,10).toISOString(),now),/2025/);assert.equal(api.lastSeenLabel('invalid',now),'Last seen unavailable');
});
test('online deadline is relative to server time, bounded, and immune to client clock skew',()=>{
  const {api,row}=fixture();assert.equal(api.presenceDeadline(row,100),75100);assert.equal(api.presenceDeadline({...row,online:false},100),0);assert.equal(api.presenceDeadline({...row,server_now:'invalid'},100),0);assert.equal(api.presenceDeadline({...row,valid_until:'2026-10-09T10:00:00Z'},100),75100);
});
test('partner display uses its user ID regardless of row order; my activity never changes its last seen',()=>{
  const {api,row}=fixture(),owner={myUserId:'me',partnerUserId:'partner',coupleId:'pair'};
  const profile={...owner,myLastSeen:'old-me',lastSeen:'old-partner',partnerOnline:false};
  const me={...row,user_id:'me',last_seen:'2026-10-08T12:48:00Z'};
  for(const rows of [[row,me],[me,row],[{...me,user_id:'stranger'},me,row]]){
    const next=api.applyAppPresence(profile,owner,rows);
    assert.equal(next.lastSeen,row.last_seen);assert.equal(next.myLastSeen,me.last_seen);assert.equal(next.partnerOnline,true);
  }
  const partnerProfile={myUserId:'partner',partnerUserId:'me',coupleId:'pair',lastSeen:row.last_seen};
  assert.equal(api.applyAppPresence(partnerProfile,partnerProfile,[row,me]).lastSeen,me.last_seen);
});
test('an explicit null partner activity clears the bogus cached time in the shared home and chat profile',()=>{
  const {api,row}=fixture(),profile={myUserId:'me',partnerUserId:'partner',coupleId:'pair',lastSeen:'2026-10-08T12:48:00Z',partnerOnline:true};
  const next=api.applyAppPresence(profile,profile,[{...row,last_seen:null,online:false}]);
  assert.equal(next.lastSeen,undefined);assert.equal(next.partnerOnline,false);
  assert.equal(api.applyAppPresence(profile,profile,[]).lastSeen,profile.lastSeen,'a failed read does not erase a known genuine timestamp');
});
test('stale account, partner and couple callbacks cannot change the active profiles presence',()=>{
  const {api,row}=fixture(),profile={myUserId:'me',partnerUserId:'partner',coupleId:'pair',lastSeen:'unchanged'};
  for(const owner of [{...profile,myUserId:'other'},{...profile,partnerUserId:'old-partner'},{...profile,coupleId:'old-pair'}]){
    assert.equal(api.applyAppPresence(profile,owner,[row]),profile);
    assert.equal(api.samePresenceOwner(profile,owner),false);
  }
});
test('a missing partner or self-mapped partner never displays my activity as partner last seen',()=>{
  const {api,row}=fixture();
  for(const partnerUserId of [undefined,'me']){
    const profile={myUserId:'me',partnerUserId,coupleId:'pair',lastSeen:'wrong',partnerOnline:true};
    const next=api.applyAppPresence(profile,profile,[{...row,user_id:'me'}]);
    assert.equal(next.lastSeen,undefined);assert.equal(next.partnerOnline,false);
  }
});
test('opening and returning records presence; hidden heartbeats never refresh foreground activity',async()=>{
  const f=fixture(),stop=f.start();await flush();assert.equal(f.calls[0].p_visible,true);assert.ok(f.updates.at(-1).some(r=>r.user_id==='partner'));f.hide();await flush();assert.equal(f.calls.at(-1).p_visible,false);const before=f.calls.length;for(const tick of f.intervals.values())tick();await flush();assert.equal(f.calls.length,before);f.show();await flush();assert.equal(f.calls.filter(c=>c.name==='touch_app_presence').at(-1).p_visible,true);stop();await flush();assert.equal(f.removed,1);assert.equal(f.intervals.size,0);assert.equal(f.timers.size,0);
});
test('late authentication gets an older sequence than hide; account switches never write as the previous user',async()=>{
  const f=fixture();let resume;f.holdAuth(new Promise(resolve=>resume=resolve));const stop=f.start();f.hide();await flush();resume();await flush();const touches=f.calls.filter(c=>c.name==='touch_app_presence');assert.equal(touches[0].p_visible,false);assert.ok(touches[0].p_sequence>touches[1].p_sequence);stop();await flush();const other=fixture();other.setAuth('new-account');const cleanup=other.start();await flush();assert.equal(other.calls.length,0);cleanup();await flush();
});
test('missing migration reports an actionable error; successful retry clears it and disposal drops callbacks',async()=>{
  const f=fixture();f.setError({code:'PGRST202'});const stop=f.start();await flush();assert.match(f.statuses.at(-1),/012/);f.setError(null);f.window.dispatchEvent(new Event('focus'));await flush();assert.equal(f.statuses.at(-1),undefined);const count=f.updates.length;stop();f.show();await flush();assert.equal(f.updates.length,count);
});
test('lost network clears online without inventing a last seen; reconnect records a fresh activity',async()=>{
  const f=fixture(),stop=f.start();await flush();f.navigator.onLine=false;f.window.dispatchEvent(new Event('offline'));await flush();assert.equal(f.updates.at(-1)[0].last_seen,null);assert.equal(f.updates.at(-1)[0].online,false);const before=f.calls.length;f.show();await flush();assert.equal(f.calls.length,before);f.navigator.onLine=true;f.window.dispatchEvent(new Event('online'));await flush();assert.equal(f.statuses.at(-1),undefined);stop();await flush();
});
