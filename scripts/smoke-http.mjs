import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const port=process.env.TOGETHER_SMOKE_PORT||'3185';
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',port],{stdio:['ignore','pipe','pipe']});
let log='';
child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    if(child.exitCode!==null)throw new Error('Local production server exited before readiness.');
    try{ready=(await fetch(`${base}/offline`)).ok;}catch{}
    if(ready)break;
    await delay(100);
  }
  assert.equal(ready,true,'production server readiness');
  for(const route of ['/login','/offline','/chat','/home','/memories','/settings','/calls','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/sw.js','/api/push/send','/api/push/test']){
    const response=await fetch(`${base}${route}`);assert.equal(response.status,200,route);
    console.log(`PASS GET ${route}: 200`);
    if(route==='/manifest.webmanifest'){const manifest=await response.json();assert.ok(manifest.icons.length>=2);}
  }
  const prayers=await fetch(`${base}/api/faith/prayers`);assert.equal(prayers.status,401);console.log('PASS GET /api/faith/prayers without auth: 401');
  const ice=await fetch(`${base}/api/calls/ice`);assert.equal(ice.status,401);console.log('PASS GET /api/calls/ice without auth: 401');
  for(const route of ['/api/push/send','/api/push/test','/api/calls/notify']){
    const response=await fetch(`${base}${route}`,{method:'POST'});assert.equal(response.status,401,route);
    console.log(`PASS POST ${route} without auth: 401`);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
  child.kill('SIGTERM');
  if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));
  void log;
}
