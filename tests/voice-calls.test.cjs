const test=require('node:test'),assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {load}=require('./load-ts.cjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config={TURN_URLS:'turn:relay.example:3478?transport=udp,turns:relay.example:443?transport=tcp',TURN_SHARED_SECRET:'fixture-secret'};
const server=()=>load('lib/calls/server.ts',{}, {'@/lib/push/server':{getSupabaseRestConfig:()=>null}});
test('TURN REST credentials expire, bind to caller, and keep shared secret on server',()=>{
  const {voiceIceConfig}=server(),now=1800000000000;
  const ice=voiceIceConfig(id(1),config,now);
  assert.equal(ice.expiresAt,now+7200000);assert.equal(ice.iceTransportPolicy,'relay');
  const username=`${now/1000+7200}:${id(1)}`;
  assert.equal(ice.iceServers[0].username,username);
  assert.equal(ice.iceServers[0].credential,createHmac('sha1',config.TURN_SHARED_SECRET).update(username).digest('base64'));
  assert.ok(!JSON.stringify(ice).includes(config.TURN_SHARED_SECRET));
  assert.notEqual(voiceIceConfig(id(2),config,now).iceServers[0].credential,ice.iceServers[0].credential);
});
test('TURN configuration fails clearly without relay credentials and supports managed provider',()=>{
  const {voiceIceConfig}=server();
  for(const env of [{},{TURN_URLS:'stun:relay.example:3478'},{TURN_URLS:'turn:relay.example:3478?bad=1'},{TURN_URLS:'turn:relay.example:99999'},{TURN_URLS:'turn:relay.example:3478'}])assert.throws(()=>voiceIceConfig(id(1),env),error=>error.status===503);
  const ice=voiceIceConfig(id(1),{TURN_URLS:'turns:relay.example:443?transport=tcp',TURN_USERNAME:'managed',TURN_CREDENTIAL:'fixture-password'});
  assert.equal(ice.iceServers[0].username,'managed');assert.equal(ice.iceTransportPolicy,'relay');
});
test('call API verifies bearer identity and exactly one paired account using caller RLS',async()=>{
  const requests=[];let pairReady=true;
  const {authenticateCall}=load('lib/calls/server.ts',{AbortSignal,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.includes('/auth/')?{id:id(1)}:pairReady?[{id:id(3),user_a:id(1),user_b:id(2)}]:[]};}},{'@/lib/push/server':{getSupabaseRestConfig:()=>({url:'https://fixture.invalid',key:'publishable-fixture'})}});
  const request={headers:new Headers({authorization:'Bearer fixture-token'})};
  const account=await authenticateCall(request);assert.equal(account.userId,id(1));assert.equal(account.coupleId,id(3));
  assert.equal(requests.length,2);assert.equal(requests[1].options.headers.Authorization,'Bearer fixture-token');assert.equal(requests[1].options.headers.apikey,'publishable-fixture');assert.match(requests[1].url,/limit=2/);
  pairReady=false;await assert.rejects(()=>authenticateCall(request),error=>error.status===403);
  await assert.rejects(()=>authenticateCall({headers:new Headers()}),error=>error.status===401);
});
test('actual Supabase SDK call transport handles composite rows, empty current call and missing migration',async()=>{
  const {createClient}=require('@supabase/supabase-js');let empty=false,missing=false;const requests=[];
  const call={id:id(5),couple_id:id(3),caller_id:id(1),callee_id:id(2),caller_device:id(10),callee_device:null,state:'ringing',created_at:'2026-10-07T12:00:00Z',updated_at:'2026-10-07T12:00:00Z',accepted_at:null,started_at:null,ended_at:null};
  const supabase=createClient('https://fixture.invalid','publishable-fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,options)=>{requests.push({url:String(url),options});if(missing)return new Response(JSON.stringify({code:'PGRST202',message:'function not found'}),{status:404});return new Response(JSON.stringify(String(url).includes('/rpc/current_voice_call')&&empty?{id:null}:String(url).includes('/rpc/voice_call_history')?[{message_id:id(6),call_summary:call,created_at:call.created_at}]:String(url).includes('/voice_call_signals')?[]:String(url).includes('/voice_calls')?[call]:call),{headers:{'Content-Type':'application/json'}});}}});
  const {createCallTransport}=load('lib/calls/transport.ts',{AbortController,setTimeout,clearTimeout},{'@/lib/supabase/client':{getPublicSupabaseConfig:()=>null}});
  const transport=createCallTransport(supabase,id(1),id(3));
  assert.equal((await transport.start(id(5))).id,id(5));assert.equal((await transport.current()).id,id(5));
  empty=true;assert.equal(await transport.current(),null);
  assert.equal((await transport.get(id(5))).id,id(5));assert.equal((await transport.history()).length,1);assert.equal((await transport.signals(id(5),0)).length,0);
  assert.ok(requests.every(request=>request.options.signal));
  const startBody=JSON.parse(requests[0].options.body);assert.equal(startBody.p_device,transport.deviceId);assert.equal(startBody.p_couple,id(3));
  const cursor={createdAt:call.created_at,id:id(6)};await transport.history({filter:'incoming',before:cursor});const body=JSON.parse(requests.at(-1).options.body);assert.equal(body.p_filter,'incoming');assert.equal(body.p_before_id,id(6));assert.equal(body.p_limit,31);
  await transport.start(id(5),'video');assert.ok(requests.at(-1).url.includes('/rpc/start_video_call'));assert.equal(JSON.parse(requests.at(-1).options.body).p_device,transport.deviceId);
  missing=true;await assert.rejects(()=>transport.start(id(5),'video'),/database update 011/);await assert.rejects(()=>transport.current(),/database update 009/);await assert.rejects(()=>transport.history(),/database update 010/);
});
function fixture(){
  const track={kind:'audio',enabled:true,readyState:'live',onended:null,stop(){this.readyState='ended';}};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const call={id:id(5),couple_id:id(3),caller_id:id(1),callee_id:id(2),caller_device:id(10),callee_device:null,state:'ringing',created_at:new Date().toISOString(),accepted_at:null,started_at:null,ended_at:null};
  let current=null;const actions=[],leaves=[],pcs=[];
  const transport={userId:id(1),coupleId:id(3),deviceId:id(10),ice:async()=>({iceServers:[],iceTransportPolicy:'relay',expiresAt:Date.now()+7200000}),start:async uuid=>(current={...call,id:uuid}),current:async()=>current,get:async()=>current,action:async(uuid,action)=>{actions.push(action);current={...current,state:action==='accept'?'accepted':action==='end'?'ended':current.state,callee_device:action==='accept'?transport.deviceId:current.callee_device};return current;},signals:async()=>[],send:async()=>{},notify:async()=>undefined,watch:()=>()=>{},history:async()=>[],leave:uuid=>leaves.push(uuid)};
  let getMedia=async()=>stream;
  class PC{constructor(){this.signalingState='stable';this.connectionState='new';pcs.push(this);}addTrack(){}close(){this.connectionState='closed';}}
  const audio={srcObject:null,play:async()=>{},pause:()=>{}};
  const {VoiceCallEngine}=load('lib/calls/engine.ts',{Error,DOMException,window:{isSecureContext:true},document:{visibilityState:'hidden'},navigator:{vibrate:()=>{},mediaDevices:{getUserMedia:()=>getMedia()}},AudioContext:class{constructor(){throw new Error('No speaker fixture');}},RTCPeerConnection:PC,setTimeout,clearTimeout,setInterval,clearInterval,Date});
  const engine=new VoiceCallEngine(transport,audio,()=>{});
  return {engine,transport,call,track,stream,pcs,actions,leaves,setCurrent:value=>{current=value;},getCurrent:()=>current,setMedia:fn=>{getMedia=fn;}};
}
test('cancel while microphone permission is pending stops late stream without creating call',async()=>{
  const f=fixture();await f.engine.prepareConnection();let resolve;
  f.setMedia(()=>new Promise(done=>{resolve=done;}));const pending=f.engine.start();
  while(!resolve)await new Promise(done=>setImmediate(done));await f.engine.end();resolve(f.stream);await pending;
  assert.equal(f.track.readyState,'ended');assert.equal(f.getCurrent(),null);assert.equal(f.engine.view.phase,'finished');f.engine.dispose();
});
test('missing TURN never opens microphone',async()=>{
  const f=fixture();let microphones=0;f.transport.ice=async()=>{throw new Error('TURN setup required');};f.setMedia(async()=>{microphones++;return f.stream;});
  await f.engine.start();assert.equal(microphones,0);assert.equal(f.engine.view.phase,'finished');assert.match(f.engine.view.error,/TURN/);f.engine.dispose();
});
test('ambiguous start response recovers same committed call and releases microphone on end',async()=>{
  const f=fixture(),start=f.transport.start;await f.engine.prepareConnection();f.transport.start=async uuid=>{await start(uuid);throw new Error('response lost');};
  await f.engine.start();assert.equal(f.engine.view.call.id,f.getCurrent().id);assert.equal(f.engine.view.phase,'ringing');assert.equal(f.track.readyState,'live');assert.equal(f.pcs.length,0);
  await f.engine.end();assert.equal(f.track.readyState,'ended');assert.equal(f.engine.view.call.state,'ended');f.engine.dispose();
});
test('recipient cannot open microphone until answer; ambiguous acceptance recovers own device',async()=>{
  const f=fixture();f.transport.userId=id(2);f.transport.deviceId=id(11);await f.engine.prepareConnection();f.setCurrent(f.call);await f.engine.refresh();
  assert.equal(f.engine.view.phase,'incoming');assert.equal(f.pcs.length,0);
  const action=f.transport.action;f.transport.action=async(uuid,kind)=>{const call=await action(uuid,kind);if(kind==='accept')throw new Error('response lost');return call;};
  await f.engine.accept();assert.equal(f.engine.view.phase,'connecting');assert.equal(f.pcs.length,1);
  f.engine.toggleMute();assert.equal(f.track.enabled,false);f.engine.toggleMute();assert.equal(f.track.enabled,true);
  await f.engine.end();assert.equal(f.track.readyState,'ended');assert.equal(f.pcs[0].connectionState,'closed');f.engine.dispose();
});
test('accepted call on another recipient device never starts microphone or takes over',async()=>{
  const f=fixture();f.transport.userId=id(2);f.transport.deviceId=id(12);f.setCurrent({...f.call,state:'active',callee_device:id(11)});let microphones=0;f.setMedia(async()=>{microphones++;return f.stream;});
  await f.engine.refresh();await f.engine.accept();assert.equal(f.engine.view.phase,'elsewhere');assert.equal(microphones,0);assert.equal(f.pcs.length,0);f.engine.dispose();assert.deepEqual(f.leaves,[]);
});
test('late refresh snapshot cannot revive a call cancelled while the request was pending',async()=>{
  const f=fixture();await f.engine.prepareConnection();await f.engine.start();const stale={...f.engine.view.call};let resolve;
  f.transport.current=()=>new Promise(done=>{resolve=done;});const read=f.engine.refresh();
  while(!resolve)await new Promise(done=>setImmediate(done));await f.engine.end();resolve(stale);await read;
  assert.equal(f.engine.view.phase,'finished');assert.equal(f.engine.view.call.state,'ended');assert.equal(f.track.readyState,'ended');f.engine.dispose();
});
test('an ended call remains terminal even when a subsequent refresh returns an older ringing row',async()=>{
  const f=fixture();await f.engine.prepareConnection();await f.engine.start();const stale={...f.engine.view.call};await f.engine.end();
  f.transport.current=async()=>stale;await f.engine.refresh();assert.equal(f.engine.view.phase,'finished');assert.equal(f.engine.view.call.state,'ended');assert.equal(f.track.readyState,'ended');f.engine.dispose();
});
