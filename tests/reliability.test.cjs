const test=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const created_at='2026-10-07T10:00:00.000Z';
const message=(n,extra={})=>({id:id(n),createdAt:created_at,sender:'me',type:'text',body:'text',...extra});
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
test('outbox is isolated by both account and pair; unowned legacy stays untouched',()=>{
  const localStorage=storage(),box=load('lib/together/outbox.ts',{window:{},localStorage});
  const a={userId:'a',coupleId:'pair'},b={userId:'b',coupleId:'pair'};
  localStorage.setItem('together_outbox_v3','legacy');
  const item=box.createQueuedText('hello',null);box.writeOutbox([item],a);
  assert.equal(box.readOutbox(a)[0].body,'hello');assert.equal(box.readOutbox(b).length,0);
  assert.equal(box.readOutbox({...a,coupleId:'another'}).length,0);
  assert.equal(localStorage.getItem('together_outbox_v3'),'legacy');
  localStorage.setItem('together_outbox_v4:a:pair','{broken');assert.equal(box.readOutbox(a).length,0);
});
test('draft ownership, bounded selection and malformed storage',()=>{
  const localStorage=storage(),draft=load('lib/together/draft.ts',{window:{},localStorage});
  draft.writeChatDraft('pair','a','hello',-8,999);
  assert.deepEqual(plain(draft.readChatDraft('pair','a')),{text:'hello',selectionStart:0,selectionEnd:5});
  assert.equal(draft.readChatDraft('pair','b').text,'');
  localStorage.setItem('together_chat_draft_v3:a:pair','[]');assert.equal(draft.readChatDraft('pair','a').text,'');
});
test('empty authoritative reactions remove old reaction; missing relation preserves it',()=>{
  const {upsertMessage}=load('lib/together/messageStore.ts');
  assert.deepEqual(plain(upsertMessage([message(1,{reactions:['♥']})],message(1,{reactions:[]}))[0].reactions),[]);
  assert.deepEqual(plain(upsertMessage([message(1,{reactions:['♥']})],message(1))[0].reactions),['♥']);
});
test('reconnect removes deleted tail but preserves inserts concurrent with query',()=>{
  const {reconcileRecentMessages}=load('lib/together/messageStore.ts');
  const current=[message(1),message(2),message(3)];
  const result=reconcileRecentMessages(current,[message(1)],new Set(),60,false,new Set([id(1),id(2)]));
  assert.deepEqual(Array.from(result,row=>row.id),[id(1),id(3)]);
  assert.equal(reconcileRecentMessages(current,[],new Set(),60,false).length,0);
});
test('mapping never exposes deleted body or media',()=>{
  const {mapMessage}=load('lib/together/mappers.ts');
  const row=mapMessage({id:id(1),sender_id:'a',type:'image',created_at,body:'private',media_path:'path',deleted_at:created_at,reactions:[{emoji:'♥'}]},'a','signed');
  assert.equal(row.body,undefined);assert.equal(row.mediaUrl,undefined);assert.equal(row.mediaPath,undefined);assert.equal(row.reactions.length,0);
});
test('compound cursor includes tie-breaker and rejects injected filter',()=>{
  const {olderFilter}=load('lib/together/pagination.ts');
  assert.match(olderFilter({id:id(1),created_at}),/id\.lt\.00000000/);
  assert.throws(()=>olderFilter({id:'x),or(secret)',created_at}));
});
test('export collector reads beyond 1000 with same timestamp and aborts stalled cursors',async()=>{
  const {collectPages}=load('lib/together/collectPages.ts');
  const rows=Array.from({length:1234},(_,n)=>({id:id(1234-n),created_at}));
  const all=await collectPages(async(cursor,limit)=>rows.filter(row=>!cursor||row.id<cursor.id).slice(0,limit));
  assert.equal(all.length,1234);assert.equal(new Set(all.map(row=>row.id)).size,1234);
  await assert.rejects(()=>collectPages(async()=>rows.slice(0,500)),/did not advance/);
});
function fixture(initial){
  let queue=initial.map(row=>({...row}));const server=new Map(),acks=[],removed=[],failed=[];
  const io={active:()=>true,read:()=>queue,write:items=>{queue=items;},save:async item=>{const row={id:item.tempId,body:item.body};server.set(row.id,row);return row;},find:async id=>server.get(id)||null,update:async(id,body)=>{const row={id,body};server.set(id,row);return row;},remove:async id=>{server.delete(id);},acknowledge:async row=>{acks.push({...row});},removed:id=>removed.push(id),failed:id=>failed.push(id)};
  return {io,server,acks,removed,failed,queue:()=>queue,edit:body=>{queue[0]={...queue[0],body};},cancel:()=>{queue[0]={...queue[0],cancelled:true};}};
}
const queued=n=>({tempId:id(n),body:'original',createdAt:created_at,replyTo:null});
test('queue reconciles edit during network insert without duplicate UUID',async()=>{
  const {flushOwnedQueue}=load('lib/together/outboxEngine.ts'),f=fixture([queued(1)]),save=f.io.save;
  f.io.save=async item=>{const row=await save(item);f.edit('edited');return row;};
  await flushOwnedQueue(f.io);assert.equal(f.server.size,1);assert.equal(f.server.get(id(1)).body,'edited');assert.equal(f.queue().length,0);
});
test('queue honours cancellation during acknowledgement hydration',async()=>{
  const {flushOwnedQueue}=load('lib/together/outboxEngine.ts'),f=fixture([queued(1)]);
  f.io.acknowledge=async()=>f.cancel();await flushOwnedQueue(f.io);
  assert.equal(f.server.size,0);assert.equal(f.queue().length,0);assert.equal(f.removed.length,1);
});
test('edit during acknowledgement is persisted before removing queue item',async()=>{
  const {flushOwnedQueue}=load('lib/together/outboxEngine.ts'),f=fixture([queued(1)]);let once=true;
  f.io.acknowledge=async()=>{if(once){once=false;f.edit('late edit');}};
  await flushOwnedQueue(f.io);assert.equal(f.server.get(id(1)).body,'late edit');assert.equal(f.queue().length,0);
});
test('failed first message does not block later sends',async()=>{
  const {flushOwnedQueue}=load('lib/together/outboxEngine.ts'),f=fixture([queued(1),queued(2)]),save=f.io.save;
  f.io.save=async item=>{if(item.tempId===id(1))throw new Error('failure');return save(item);};
  await flushOwnedQueue(f.io);assert.equal(f.queue().length,1);assert.equal(f.queue()[0].attempts,1);assert.equal(f.server.has(id(2)),true);
});
test('ambiguous network error recovers committed row',async()=>{
  const {flushOwnedQueue}=load('lib/together/outboxEngine.ts'),f=fixture([queued(1)]),save=f.io.save;
  f.io.save=async item=>{await save(item);throw new Error('lost response');};
  await flushOwnedQueue(f.io);assert.equal(f.server.size,1);assert.equal(f.queue().length,0);
});
test('account switch in-flight never consumes former account queue',async()=>{
  const {flushOwnedQueue}=load('lib/together/outboxEngine.ts'),f=fixture([queued(1)]),save=f.io.save;let active=true;
  f.io.active=()=>active;f.io.save=async item=>{const row=await save(item);active=false;return row;};
  await flushOwnedQueue(f.io);assert.equal(f.queue().length,1);assert.equal(f.acks.length,0);
});
test('failed cancellation tombstones remain durable for retry',async()=>{
  const {flushOwnedQueue}=load('lib/together/outboxEngine.ts'),f=fixture([{...queued(1),cancelled:true}]);
  f.io.remove=async()=>{throw new Error('offline');};await flushOwnedQueue(f.io);
  assert.equal(f.queue()[0].cancelled,true);assert.equal(f.queue()[0].attempts,1);
  f.io.remove=async()=>{};await flushOwnedQueue(f.io);assert.equal(f.queue().length,0);
});
