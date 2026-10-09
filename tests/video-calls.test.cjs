const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 class Stream {constructor(tracks=[]){this.tracks=[...tracks];}getTracks(){return [...this.tracks];}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}addTrack(track){this.tracks.push(track);}removeTrack(track){this.tracks=this.tracks.filter(t=>t!==track);}}
 const tracks=[],requests=[],pcs=[];
 function stream(kind){const track={kind,enabled:true,readyState:'live',onended:null,stop(){this.readyState='ended';}};tracks.push(track);return new Stream([track]);}
 function combined(){const audio=stream('audio');audio.addTrack(stream('video').getVideoTracks()[0]);return audio;}
 let getMedia=async constraints=>constraints.video&&constraints.audio?combined():stream(constraints.video?'video':'audio'),current=null;
 const call={id:id(20),couple_id:id(3),caller_id:id(1),callee_id:id(2),caller_device:id(10),callee_device:null,media_kind:'video',state:'ringing',created_at:new Date().toISOString(),accepted_at:null,started_at:null,ended_at:null};
 class Sender {constructor(track){this.track=track;}async replaceTrack(track){this.track=track;}setStreams(){}getParameters(){return {encodings:[{}]};}async setParameters(){}}
 class PC {constructor(){this.connectionState='new';this.signalingState='stable';this.senders=[];this.transceivers=[];pcs.push(this);}addTrack(track){const s=new Sender(track);this.senders.push(s);return s;}addTransceiver(track){const sender=new Sender(typeof track==='string'?null:track);const t={sender,receiver:{track:{kind:'video'}},direction:'sendrecv'};this.transceivers.push(t);this.senders.push(sender);return t;}getSenders(){return this.senders;}getTransceivers(){return this.transceivers;}createDataChannel(label){return {label,readyState:'open',send(){},close(){}};}close(){this.connectionState='closed';}}
 const transport={userId:id(1),coupleId:id(3),deviceId:id(10),ice:async()=>({iceServers:[],iceTransportPolicy:'relay',expiresAt:Date.now()+7200000}),start:async(uuid,kind)=>(current={...call,id:uuid,media_kind:kind}),current:async()=>current,get:async()=>current,action:async(uuid,action)=>{current={...current,state:action==='accept'?'accepted':action==='end'?'ended':current.state,callee_device:action==='accept'?transport.deviceId:current.callee_device};return current;},signals:async()=>[],send:async()=>{},notify:async()=>undefined,watch:()=>()=>{},leave:()=>{}};
 const {VoiceCallEngine}=load('lib/calls/engine.ts',{Error,DOMException,MediaStream:Stream,window:{isSecureContext:true},document:{visibilityState:'hidden'},navigator:{vibrate(){},mediaDevices:{getUserMedia:constraints=>{requests.push(constraints);return getMedia(constraints);}}},AudioContext:class{constructor(){throw new Error('No tone');}},RTCPeerConnection:PC,setTimeout,clearTimeout,setInterval,clearInterval,Date});
 const engine=new VoiceCallEngine(transport,{srcObject:null,play:async()=>{},pause(){}},()=>{});
 return {engine,transport,call,tracks,requests,pcs,stream,combined,setMedia(fn){getMedia=fn;},setCurrent(c){current=c;},getCurrent:()=>current};
}
test('combined video capture denied before dial opens no partial stream and creates no call',async()=>{
 const f=fixture();await f.engine.prepareConnection();f.setMedia(async()=>{throw new DOMException('denied','NotAllowedError');});
 await f.engine.start('video');assert.equal(f.engine.view.phase,'finished');assert.equal(f.getCurrent(),null);assert.match(f.engine.view.error,/Microphone or camera access was blocked/);assert.equal(f.engine.view.permissionBlocked,true);assert.equal(f.tracks.length,0);assert.equal(f.requests.length,1);assert.ok(f.requests[0].audio&&f.requests[0].video);f.engine.dispose();
});
test('cancel while combined video permission waits stops every late microphone and camera track',async()=>{
 const f=fixture();await f.engine.prepareConnection();let resolve;f.setMedia(()=>new Promise(done=>resolve=done));
 const pending=f.engine.start('video');while(!resolve)await new Promise(done=>setImmediate(done));await f.engine.end();assert.equal(f.tracks.length,0);resolve(f.combined());await pending;assert.ok(f.tracks.every(t=>t.readyState==='ended'));assert.equal(f.getCurrent(),null);f.engine.dispose();
});
test('audio-only acceptance of video invitation requests no camera',async()=>{
 const f=fixture();f.transport.userId=id(2);f.transport.deviceId=id(11);await f.engine.prepareConnection();f.setCurrent(f.call);await f.engine.refresh();assert.equal(f.requests.length,0);await f.engine.accept(false);assert.equal(f.engine.view.mediaKind,'video');assert.ok(f.requests.every(c=>c.video===false));assert.equal(f.engine.view.cameraOn,false);await f.engine.end();f.engine.dispose();
});
test('camera disable and replacement preserve microphone, mute and peer connection',async()=>{
 const f=fixture();await f.engine.prepareConnection();await f.engine.start('video');f.setCurrent({...f.getCurrent(),state:'accepted',callee_device:id(11)});await f.engine.refresh();f.engine.toggleMute();const microphone=f.tracks[0],pc=f.pcs[0],old=f.tracks[1];await f.engine.toggleCamera();assert.equal(old.readyState,'ended');assert.equal(microphone.readyState,'live');assert.equal(microphone.enabled,false);assert.equal(f.engine.view.cameraOn,false);await f.engine.toggleCamera();assert.equal(f.engine.view.cameraOn,true);assert.equal(microphone.enabled,false);assert.equal(f.pcs[0],pc);await f.engine.end();assert.ok(f.tracks.every(t=>t.readyState==='ended'));f.engine.dispose();
});
test('ending during camera switch rejects late track and preserves no media resources',async()=>{
 const f=fixture();await f.engine.prepareConnection();await f.engine.start('video');f.setCurrent({...f.getCurrent(),state:'accepted',callee_device:id(11)});await f.engine.refresh();let resolve;f.setMedia(()=>new Promise(done=>resolve=done));const pending=f.engine.switchCamera();while(!resolve)await new Promise(done=>setImmediate(done));await f.engine.end();resolve(f.stream('video'));await pending;assert.ok(f.tracks.every(t=>t.readyState==='ended'));assert.equal(f.engine.view.localVideo,null);assert.equal(f.engine.view.phase,'finished');f.engine.dispose();
});
