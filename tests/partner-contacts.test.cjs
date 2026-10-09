const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const contacts=load('lib/together/contactPreferences.ts');
test('private contact label supports Arabic and emoji and falls back to the current shared profile on reset',()=>{
  const profile={partnerName:'Sample User',partnerNickname:'Sample Nick',partnerContactName:'اسم تجريبي ❤️'};
  assert.equal(contacts.partnerLabel(profile),'اسم تجريبي ❤️');assert.equal(contacts.partnerLabel({...profile,partnerContactName:undefined}),'Sample Nick');assert.equal(contacts.normalizeContactName('  اسم تجريبي ❤️  '),'اسم تجريبي ❤️');assert.equal(contacts.normalizeContactName('  '),null);assert.equal(contacts.normalizeContactName('❤️'.repeat(40)),'❤️'.repeat(40));assert.throws(()=>contacts.normalizeContactName('😀'.repeat(81)),/80 characters/);assert.throws(()=>contacts.normalizeContactName('one\ntwo'),/single line/);
});
test('contact reads and upserts scope all three identities; reset persists null and missing migration is actionable',async()=>{
  const calls=[];let reply={data:{contact_name:'Private'},error:null};
  const builder={select(x){calls.push(['select',x]);return this;},eq(k,v){calls.push(['eq',k,v]);return this;},upsert(row,opts){calls.push(['upsert',row,opts]);return this;},maybeSingle:async()=>reply,single:async()=>reply};
  const supabase={from(table){calls.push(['from',table]);return builder;}},owner={coupleId:'pair',myUserId:'a',partnerUserId:'b'};
  assert.equal(await contacts.readContactName(supabase,owner),'Private');assert.deepEqual(calls.filter(c=>c[0]==='eq'),[['eq','couple_id','pair'],['eq','owner_id','a'],['eq','partner_id','b']]);
  calls.length=0;reply={data:{contact_name:null},error:null};assert.equal(await contacts.saveContactName(supabase,owner,''),undefined);assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c=>c[0]==='upsert'))),['upsert',{couple_id:'pair',owner_id:'a',partner_id:'b',contact_name:null},{onConflict:'couple_id,owner_id,partner_id'}]);
  reply={data:null,error:{code:'PGRST205'}};await assert.rejects(contacts.readContactName(supabase,owner),/database update 008/);reply={data:null,error:{code:'42501'}};await assert.rejects(contacts.saveContactName(supabase,owner,'new'),/try again/);
});
test('partner profile realtime updates and removed photos preserve the owner-only contact name',async()=>{
  const callbacks=[];let state={myName:'A',myNickname:'A',partnerName:'B',partnerNickname:'B',partnerContactName:'Only mine',partnerAvatarPath:'old',partnerAvatarUrl:'old-url'};
  let failed=false;
  const channel={on(event,filter,fn){callbacks.push({event,filter,fn});return this;},subscribe(){return this;}};
  const supabase={channel:()=>channel,from:()=>({select:()=>({in:async()=>({error:failed?{message:'offline'}:null,data:failed?null:[{user_id:'a',display_name:'A'},{user_id:'b',display_name:'New B',nickname:'New nick',avatar_url:null}]})})})};
  const {createCoupleRealtime}=load('lib/together/realtime.ts',{}, {'@/lib/together/media':{resolveMediaReference:async value=>value||undefined,signMediaPath:async()=>undefined}});
  let changes=0;createCoupleRealtime({supabase,coupleId:'pair',userId:'a',partnerId:'b',setProfile:fn=>{state=fn(state);},onContactChange:()=>changes++,deliveriesEnabled:false,hidesEnabled:false,starsEnabled:false});
  const handler=callbacks.find(c=>c.filter.table==='profiles').fn;await handler({new:{user_id:'b'}});assert.equal(state.partnerContactName,'Only mine');assert.equal(state.partnerNickname,'New nick');assert.equal(state.partnerAvatarUrl,undefined);
  const previous=state;failed=true;await handler({new:{user_id:'b'}});assert.equal(state,previous);
  const contact=callbacks.find(c=>c.filter.table==='partner_contact_preferences');assert.equal(contact.filter.filter,'owner_id=eq.a');contact.fn();assert.equal(changes,1);
});
