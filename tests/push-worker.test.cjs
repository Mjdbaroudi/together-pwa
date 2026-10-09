const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function push(client,hint,payload={},options={}){
  const listeners={},notifications=[],messages=[];
  const self={addEventListener:(name,fn)=>listeners[name]=fn,location:{origin:'https://together.example'},clients:{matchAll:async()=>{if(options.enumerationFails)throw new Error('client API failed');return client?[{...client,postMessage:message=>{if(options.bridgeFails)throw new Error('closed window');messages.push(message);}}]:[];}},registration:{showNotification:async(...args)=>notifications.push(args)}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/sw.js'),'utf8'),{self,URL,console,Date,Map,fetch:()=>{throw new Error('not called');}});
  if(hint)listeners.message({source:{id:'device'},data:{type:'TOGETHER_CLIENT_STATE',ts:Date.now(),...hint}});
  let done;listeners.push({data:{json:()=>payload},waitUntil:promise=>done=promise});await done;return {notifications,messages};
}
const client={id:'device',url:'https://together.example/chat',visibilityState:'visible',focused:true};
test('focused visible chat shows required notification and notifies conversation',async()=>{const result=await push(client);assert.equal(result.notifications.length,1);assert.equal(result.messages.length,1);});
test('background chat receives notification',async()=>assert.equal((await push({...client,visibilityState:'hidden',focused:false})).notifications.length,1));
test('visible but unfocused chat receives notification',async()=>assert.equal((await push({...client,focused:false})).notifications.length,1));
test('no open clients receives notification',async()=>assert.equal((await push(null)).notifications.length,1));
test('fresh locked-state hint overrides stale browser focus',async()=>assert.equal((await push(client,{pathname:'/chat',visible:false,focused:false})).notifications.length,1));
test('fresh focused hint still displays a notification with missing Safari client fields',async()=>assert.equal((await push({...client,visibilityState:undefined,focused:undefined},{pathname:'/chat',visible:true,focused:true})).notifications.length,1));
const incoming=()=>({type:'voice-call',callId:'fixture-call',expiresAt:Date.now()+45000,url:'/chat?call=fixture-call'});
test('incoming call alerts background recipient with unique call tag',async()=>{const result=await push({...client,visibilityState:'hidden',focused:false},null,incoming());assert.equal(result.messages[0].type,'TOGETHER_CALL_PUSH');assert.equal(result.notifications[0][1].tag,'together-call-fixture-call');});
test('foreground call panel receives event and user-visible notification',async()=>{const result=await push(client,{pathname:'/chat',visible:false,callVisible:true,focused:true},incoming());assert.equal(result.notifications.length,1);assert.equal(result.messages.length,1);});
test('late or malformed call push shows a quiet update without ringing an expired call',async()=>{for(const payload of [{...incoming(),expiresAt:Date.now()-1},{...incoming(),expiresAt:'invalid'},{...incoming(),callId:null}]){const result=await push(null,null,payload);assert.equal(result.notifications.length,1);assert.equal(result.messages.length,0);assert.equal(result.notifications[0][1].data.url,'/calls');}});

test('failed client enumeration still shows a required user-visible notification',async()=>{const result=await push(client,null,{}, {enumerationFails:true});assert.equal(result.notifications.length,1);});
test('a closed foreground window cannot prevent the visible notification',async()=>{for(const payload of [{},incoming()]){const result=await push(client,null,payload,{bridgeFails:true});assert.equal(result.notifications.length,1);}});
