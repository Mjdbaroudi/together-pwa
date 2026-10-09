const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
function fixture(responses=[new Response('photo',{headers:{'content-type':'image/png'}})]){
 const signed=[],fetched=[],anchors=[],revoked=[],timers=[];
 const api=load('lib/together/photoFile.ts',{Response,File,DOMException,fetch:async(url,options)=>{fetched.push({url,options});return responses.shift();},document:{createElement:()=>{const a={click(){a.clicked=true;},remove(){a.removed=true;}};anchors.push(a);return a;},body:{appendChild:a=>a.appended=true}},URL:{createObjectURL:()=> 'blob:private-fixture',revokeObjectURL:u=>revoked.push(u)},setTimeout:(fn,time)=>timers.push({fn,time})},{'@/lib/together/media':{signMediaPath:async(path,force=false)=>{signed.push({path,force});return force?'https://private.test/fresh':'https://private.test/cached';}}});
 return {api,signed,fetched,anchors,revoked,timers};
}
test('date photo filenames respect MIME and never include signed paths or user title',()=>{
 const {api}=fixture();assert.equal(api.datePhotoFilename('2024-07-14','image/png','pair/user/dates/photo.jpg'),'together-date-2024-07-14.png');assert.equal(api.datePhotoFilename(undefined,'image/webp','p/q.jpg'),'together-date-photo.webp');assert.equal(api.datePhotoFilename('../private','image/jpeg','x'),'together-date-photo.jpg');assert.equal(api.datePhotoFilename('2024-07-14','image/custom','p/q.avif'),'together-date-2024-07-14.avif');assert.equal(api.datePhotoFilename(undefined,'image/custom','p/q.invalid'),'together-date-photo.img');
});
test('private photo is fetched on demand with the abort signal and preserved as a real file',async()=>{
 const f=fixture(),controller=new AbortController();const file=await f.api.loadDatePhotoFile('pair/user/dates/photo.png','2024-07-14',controller.signal);assert.equal(file.type,'image/png');assert.equal(file.name,'together-date-2024-07-14.png');assert.equal(await file.text(),'photo');assert.equal(f.fetched[0].options.signal,controller.signal);assert.equal(f.signed.length,1);
});
test('expired private URLs refresh once without changing Storage permissions',async()=>{
 for(const status of [401,403]){const f=fixture([new Response('',{status}),new Response('fresh',{headers:{'content-type':'image/webp'}})]);const file=await f.api.loadDatePhotoFile('pair/user/dates/photo.webp');assert.equal(await file.text(),'fresh');assert.equal(f.signed.at(-1).force,true);assert.equal(f.fetched.at(-1).url,'https://private.test/fresh');assert.equal(f.fetched.length,2);}
});
test('an HEIC photo can be saved intact even when the browser cannot decode it for display',async()=>{
 const f=fixture([new Response('original-heic-bytes',{headers:{'content-type':'image/heic'}})]);const file=await f.api.loadDatePhotoFile('pair/user/dates/photo.heic','2024-07-14');assert.equal(file.type,'image/heic');assert.equal(file.name,'together-date-2024-07-14.heic');assert.equal(await file.text(),'original-heic-bytes');
});
test('persistent authorization failure and network/server failures do not download error documents',async()=>{
 for(const responses of [[new Response('',{status:403}),new Response('',{status:403})],[new Response('',{status:500})],[new Response('<html>error</html>',{headers:{'content-type':'text/html'}})]]){const f=fixture(responses);await assert.rejects(f.api.loadDatePhotoFile('pair/user/dates/photo.png'));assert.equal(f.anchors.length,0);}
});
test('empty images and excessive downloads are rejected before creating a file',async()=>{
 for(const response of [new Response('',{headers:{'content-type':'image/png'}}),new Response('image',{headers:{'content-type':'image/png','content-length':String(51*1024*1024)}})]){const f=fixture([response]);await assert.rejects(f.api.loadDatePhotoFile('pair/user/dates/photo.png'));}
});
test('closing while private signing waits prevents the later fetch',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.api.loadDatePhotoFile('pair/user/dates/photo.png',undefined,controller.signal),e=>e.name==='AbortError');assert.equal(f.fetched.length,0);
});
test('closing while response bytes wait never retains a late file',async()=>{
 const controller=new AbortController();const response={ok:true,status:200,headers:new Headers(),blob:async()=>{controller.abort();return new Blob(['image'],{type:'image/png'});}};const f=fixture([response]);await assert.rejects(f.api.loadDatePhotoFile('pair/user/dates/photo.png',undefined,controller.signal),e=>e.name==='AbortError');
});
test('download uses a blob with the true filename and delayed cleanup, not the cross-origin signed URL',()=>{
 const f=fixture();const file=new File(['photo'],'together-date-2024-07-14.png',{type:'image/png'});f.api.downloadPhotoFile(file);assert.equal(f.anchors[0].href,'blob:private-fixture');assert.equal(f.anchors[0].download,file.name);assert.ok(f.anchors[0].appended&&f.anchors[0].clicked&&f.anchors[0].removed);assert.equal(f.revoked.length,0);assert.equal(f.timers[0].time,60000);f.timers[0].fn();assert.deepEqual(f.revoked,['blob:private-fixture']);
});
