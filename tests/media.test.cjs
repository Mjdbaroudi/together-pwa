const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
test('signed media cache expires before URL and is isolated by account',async()=>{
  let now=0,user='a',calls=0;
  const supabase={auth:{getSession:async()=>({data:{session:{user:{id:user}}}})},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:`url-${++calls}`},error:null})})}};
  const media=load('lib/together/media.ts',{Date:{now:()=>now}},{'@/lib/supabase/client':{getSupabaseBrowser:()=>supabase}});
  assert.equal(await media.signMediaPath('pair/a/photo'),'url-1');assert.equal(await media.signMediaPath('pair/a/photo'),'url-1');
  now=23*60*60*1000+1;assert.equal(await media.signMediaPath('pair/a/photo'),'url-2');
  user='b';assert.equal(await media.signMediaPath('pair/a/photo'),'url-3');
  assert.equal(await media.signMediaPath('pair/a/photo',true),'url-4');
});
