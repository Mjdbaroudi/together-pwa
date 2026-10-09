const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
  let now=Date.now(),gesture=false,mediaFailure=null,current=null,iceCount=0;
  const requests=[],tracks=[],starts=[],actions=[];
  class Clock extends Date {static now(){return now;}}
  class Stream {constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}}
  const makeStream=video=>new Stream((video?['audio','video']:['audio']).map(kind=>{const track={kind,readyState:'live',enabled:true,stop(){this.readyState='ended';}};tracks.push(track);return track;}));
  const call={id:id(5),couple_id:id(3),caller_id:id(1),callee_id:id(2),caller_device:id(10),callee_device:null,media_kind:'video',state:'ringing',created_at:new Date().toISOString()};
  const transport={userId:id(1),coupleId:id(3),deviceId:id(10),ice:async()=>{iceCount++;gesture=false;return {iceServers:[],iceTransportPolicy:'relay',expiresAt:now+7200000};},start:async(uuid,kind)=>{starts.push(uuid);return current={...call,id:uuid,media_kind:kind};},current:async()=>current,get:async()=>current,action:async(uuid,action)=>{actions.push(action);current={...current,state:action==='accept'?'accepted':action==='end'?'ended':current.state,callee_device:transport.deviceId};return current;},notify:async()=>{},leave(){},signals:async()=>[],watch:()=>()=>{}};
  const window={isSecureContext:true};
  const navigator={vibrate(){},mediaDevices:{getUserMedia:constraints=>{requests.push({constraints,gesture});if(!gesture)return Promise.reject(new DOMException('No user gesture','NotAllowedError'));return mediaFailure?Promise.reject(mediaFailure):Promise.resolve(makeStream(Boolean(constraints.video)));}}};
  const {VoiceCallEngine}=load('lib/calls/engine.ts',{Date:Clock,Error,DOMException,MediaStream:Stream,window,navigator,document:{visibilityState:'hidden'},AudioContext:class{constructor(){throw new Error('No tone');}},RTCPeerConnection:class{addTrack(){}close(){}},setTimeout,clearTimeout,setInterval,clearInterval});
  const engine=new VoiceCallEngine(transport,{play:async()=>{},pause(){}},()=>{});
  return {engine,transport,requests,tracks,starts,actions,call,window,navigator,makeStream,get iceCount(){return iceCount;},tap(fn){gesture=true;const promise=fn();gesture=false;return promise;},advance(ms){now+=ms;},fail(error){mediaFailure=error;},incoming(){transport.userId=id(2);transport.deviceId=id(11);current=call;}};
}
test('cold connection preparation never captures after network awaits; Continue uses a fresh gesture',async()=>{
  const f=fixture();await f.tap(()=>f.engine.start('video'));assert.equal(f.engine.view.phase,'permission');assert.equal(f.requests.length,0);assert.equal(f.starts.length,0);
  await f.tap(()=>f.engine.continuePermission());assert.equal(f.engine.view.phase,'ringing');assert.equal(f.requests.length,1);assert.equal(f.requests[0].gesture,true);assert.ok(f.requests[0].constraints.audio&&f.requests[0].constraints.video);await f.engine.end();assert.ok(f.tracks.every(t=>t.readyState==='ended'));f.engine.dispose();
});
test('warm connection requests both video permissions synchronously in the initial click',async()=>{
  const f=fixture();await f.engine.prepareConnection();assert.equal(f.requests.length,0);
  const pending=f.tap(()=>f.engine.start('video'));assert.equal(f.requests.length,1);assert.equal(f.requests[0].gesture,true);await pending;assert.equal(f.iceCount,1);await f.engine.end();f.engine.dispose();
});
test('denial does not dial or loop prompts; a fresh Retry can recover without reload',async()=>{
  const f=fixture();await f.engine.prepareConnection();f.fail(new DOMException('denied','NotAllowedError'));await f.tap(()=>f.engine.start());assert.equal(f.engine.view.permissionBlocked,true);assert.equal(f.engine.view.phase,'finished');assert.equal(f.starts.length,0);assert.equal(f.requests.length,1);
  await f.engine.refresh();assert.equal(f.requests.length,1);f.fail(null);await f.tap(()=>f.engine.start());assert.equal(f.engine.view.phase,'ringing');assert.equal(f.engine.view.permissionBlocked,false);assert.equal(f.starts.length,1);await f.engine.end();f.engine.dispose();
});
test('cold incoming audio-only answer retains the choice across refresh and Continue',async()=>{
  const f=fixture();f.incoming();await f.engine.refresh();await f.tap(()=>f.engine.accept(false));assert.equal(f.engine.view.phase,'permission');assert.equal(f.requests.length,0);assert.equal(f.actions.length,0);
  await f.engine.refresh();assert.equal(f.engine.view.phase,'permission');await f.tap(()=>f.engine.continuePermission());assert.equal(f.engine.view.phase,'connecting');assert.equal(f.requests[0].constraints.video,false);assert.equal(f.requests[0].gesture,true);assert.equal(f.actions.filter(a=>a==='accept').length,1);assert.equal(f.actions[0],'accept');await f.engine.end();f.engine.dispose();
});
test('denied incoming answer can retry and never accepts before permission',async()=>{
  const f=fixture();f.incoming();await f.engine.prepareConnection();await f.engine.refresh();f.fail(new DOMException('denied','NotAllowedError'));await f.tap(()=>f.engine.accept(false));assert.equal(f.engine.view.phase,'incoming');assert.equal(f.engine.view.permissionBlocked,true);assert.equal(f.actions.length,0);
  f.fail(null);await f.tap(()=>f.engine.accept(false));assert.equal(f.engine.view.permissionBlocked,false);assert.equal(f.actions.filter(a=>a==='accept').length,1);assert.equal(f.actions[0],'accept');await f.engine.end();f.engine.dispose();
});
test('relay credential warming coalesces requests and expires within five minutes',async()=>{
  const f=fixture();await Promise.all([f.engine.prepareConnection(),f.engine.prepareConnection()]);assert.equal(f.iceCount,1);f.advance(300001);await f.tap(()=>f.engine.start());assert.equal(f.iceCount,2);assert.equal(f.requests.length,0);assert.equal(f.engine.view.phase,'permission');await f.engine.end();f.engine.dispose();
});
test('expired relay credentials fail before asking for capture',async()=>{
  const f=fixture();f.transport.ice=async()=>({iceServers:[],iceTransportPolicy:'relay',expiresAt:0});await f.tap(()=>f.engine.start());assert.equal(f.engine.view.phase,'finished');assert.match(f.engine.view.error,/expired/);assert.equal(f.requests.length,0);f.engine.dispose();
});
test('cancel while relay preparation waits never reopens permission UI or dials',async()=>{
  const f=fixture();let resolve;f.transport.ice=()=>new Promise(done=>resolve=done);const pending=f.tap(()=>f.engine.start());await f.engine.end();resolve({iceServers:[],iceTransportPolicy:'relay',expiresAt:Date.now()+7200000});await pending;assert.equal(f.engine.view.phase,'finished');assert.equal(f.requests.length,0);assert.equal(f.starts.length,0);f.engine.dispose();
});
test('cancel while combined capture waits stops every late track',async()=>{
  const f=fixture();await f.engine.prepareConnection();let resolve;f.navigator.mediaDevices.getUserMedia=()=>new Promise(done=>resolve=done);const pending=f.tap(()=>f.engine.start('video'));await f.engine.end();resolve(f.makeStream(true));await pending;assert.ok(f.tracks.every(t=>t.readyState==='ended'));assert.equal(f.starts.length,0);f.engine.dispose();
});
test('unsupported contexts and busy devices are not mislabeled as a saved permission denial',async()=>{
  const f=fixture();await f.engine.prepareConnection();f.window.isSecureContext=false;await f.tap(()=>f.engine.start());assert.match(f.engine.view.error,/HTTPS/);assert.equal(f.engine.view.permissionBlocked,false);assert.equal(f.requests.length,0);
  f.window.isSecureContext=true;f.fail(new DOMException('busy','NotReadableError'));await f.tap(()=>f.engine.start('video'));assert.match(f.engine.view.error,/busy/);assert.equal(f.engine.view.permissionBlocked,false);f.engine.dispose();
});
test('disposed account never captures or retains late relay credentials',async()=>{
  const f=fixture();let resolve;f.transport.ice=()=>new Promise(done=>resolve=done);const warming=f.engine.prepareConnection();f.engine.dispose();resolve({iceServers:[],iceTransportPolicy:'relay',expiresAt:Date.now()+7200000});await assert.rejects(()=>warming,/closed/);assert.equal(f.requests.length,0);assert.equal(f.starts.length,0);
});
