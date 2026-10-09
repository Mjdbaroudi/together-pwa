const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('PostgreSQL migrations, RLS and integrity integration',async t=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role authenticated;create role anon;
      create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
      create publication supabase_realtime;
      grant usage on schema public,auth,storage to authenticated,anon;
      grant select,insert,update,delete on all tables in schema storage to authenticated;
      alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
    `);
    const migrations=fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(file=>file.endsWith('.sql')).sort();
    const apply=async()=>{for(const file of migrations){const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8').replace('create extension if not exists pgcrypto;','');await db.exec(sql);}};
    await t.test('all sixteen migrations run and can be repeated',async()=>{assert.equal(migrations.length,16);await apply();await apply();});
    await db.exec(`insert into auth.users(id,email) values('${id(1)}','a@example.test'),('${id(2)}','b@example.test'),('${id(3)}','c@example.test'),('${id(4)}','d@example.test');
      insert into public.couples(id,user_a,user_b,invite_code) values('${id(10)}','${id(1)}','${id(2)}','PAIR1'),('${id(11)}','${id(3)}','${id(4)}','PAIR2');
      insert into public.messages(id,couple_id,sender_id,type,body) values('${id(100)}','${id(10)}','${id(1)}','text','secret one'),('${id(101)}','${id(11)}','${id(3)}','text','secret two');
      insert into storage.objects(bucket_id,name) values('couple-media','${id(10)}/${id(1)}/messages/photo.jpg'),('couple-media','${id(11)}/${id(3)}/messages/photo.jpg');`);
    async function asUser(user,fn){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id(user)}',false);`);try{return await fn();}finally{await db.exec('reset role;');}}
    const touch=(session,visible,sequence)=>db.query('select touch_app_presence($1,$2,$3) as seen',[id(session),visible,sequence]);
    const presence=()=>db.query('select * from read_app_presence($1)',[id(10)]);
    await t.test('opening my app never invents last seen for a partner with no recorded activity',async()=>{
      await asUser(1,async()=>{
        for(const [visible,sequence] of [[true,1],[false,2],[true,3]]){
          await touch(899,visible,sequence);
          const rows=(await presence()).rows,me=rows.find(r=>r.user_id===id(1)),partner=rows.find(r=>r.user_id===id(2));
          assert.ok(me.last_seen);assert.equal(partner.last_seen,null);assert.equal(partner.online,false);
          assert.equal(partner.valid_until,null);
        }
        await touch(899,false,4);
      });
      assert.equal((await db.query('select * from app_presence where user_id=$1',[id(2)])).rows.length,0);
    });
    await t.test('last seen is server-owned, survives hide and reload, and is readable only by the paired accounts',async()=>{
      const before=Date.now();await asUser(1,async()=>{const seen=(await touch(900,true,1)).rows[0].seen;assert.ok(Math.abs(Date.parse(seen)-before)<5000);assert.equal((await presence()).rows.find(r=>r.user_id===id(1)).online,true);await assert.rejects(db.exec(`update app_presence set last_seen=now()+interval '1 year'`),/permission denied/);await assert.rejects(db.query('select * from app_presence_sessions'),/permission denied/);});
      await asUser(2,async()=>{assert.ok((await presence()).rows.find(r=>r.user_id===id(1)).last_seen);assert.equal((await db.query('select * from app_presence')).rows.length,1);});
      await asUser(3,async()=>{assert.equal((await db.query('select * from app_presence')).rows.length,0);await assert.rejects(presence(),/Unauthorized/);await assert.rejects(touch(900,true,2),/another user/);});
      await asUser(1,async()=>{await touch(900,false,2);const row=(await presence()).rows.find(r=>r.user_id===id(1));assert.equal(row.online,false);assert.ok(row.last_seen);await touch(901,true,1);assert.equal((await presence()).rows.find(r=>r.user_id===id(1)).online,true);await touch(901,false,2);});
    });
    await t.test('multiple devices and delayed heartbeats cannot incorrectly revive a hidden device',async()=>{
      await asUser(1,async()=>{await touch(900,true,3);await touch(901,true,3);await touch(900,false,5);const stamp=(await presence()).rows.find(r=>r.user_id===id(1)).last_seen;await touch(900,true,4);assert.equal((await db.query('select active,sequence from app_presence_sessions where session_id=$1',[id(900)]).catch(()=>({rows:[]}))).rows.length,0);assert.equal((await presence()).rows.find(r=>r.user_id===id(1)).online,true);await touch(901,false,4);const row=(await presence()).rows.find(r=>r.user_id===id(1));assert.equal(row.online,false);assert.ok(Date.parse(row.last_seen)>=Date.parse(stamp));});
      const session=(await db.query('select active,sequence from app_presence_sessions where session_id=$1',[id(900)])).rows[0];assert.equal(session.active,false);assert.equal(Number(session.sequence),5);
    });
    await t.test('foreground leases expire without a close event, keeping the genuine last seen',async()=>{
      await asUser(2,async()=>touch(902,true,1));const stamp=(await db.query('select last_seen from app_presence where user_id=$1',[id(2)])).rows[0].last_seen;
      await db.query("update app_presence_sessions set touched_at=clock_timestamp()-interval '76 seconds' where session_id=$1",[id(902)]);
      await asUser(1,async()=>{const row=(await presence()).rows.find(r=>r.user_id===id(2));assert.equal(row.online,false);assert.equal(row.valid_until,null);assert.equal(Date.parse(row.last_seen),Date.parse(stamp));});
      await db.exec('set role anon;');try{await assert.rejects(presence(),/permission denied/);await assert.rejects(touch(903,true,1),/permission denied/);await assert.rejects(db.query('select * from app_presence'),/permission denied/);}finally{await db.exec('reset role;');}
    });
    await t.test('presence migration backfills clamped old activity and repeat execution preserves newer timestamps',async()=>{
      await db.query("update profiles set last_seen=clock_timestamp()+interval '1 year' where user_id=$1",[id(4)]);const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/012_v31_app_presence.sql'),'utf8');await db.exec(sql);
      const stamp=(await db.query('select last_seen from app_presence where user_id=$1',[id(4)])).rows[0].last_seen;assert.ok(Date.parse(stamp)<=Date.now()+1000);await db.exec(sql);assert.equal(Date.parse((await db.query('select last_seen from app_presence where user_id=$1',[id(4)])).rows[0].last_seen),Date.parse(stamp));
      await asUser(1,async()=>{await assert.rejects(touch(904,true,0),/Unauthorized/);await assert.rejects(touch(904,true,9007199254740992),/Unauthorized/);assert.deepEqual((await db.query('select user_id from read_app_presence(null)')).rows.map(r=>r.user_id),[id(1)]);});
    });
    await t.test('each account sees only its partners genuine last seen, unchanged by its own opening and closing',async()=>{
      const seen=async user=>Date.parse((await db.query('select last_seen from app_presence where user_id=$1',[id(user)])).rows[0].last_seen);
      for(const [viewer,partner,session] of [[1,2,905],[2,1,906]]){
        const before=await seen(partner);
        await asUser(viewer,async()=>{
          for(const [visible,sequence] of [[true,1],[false,2],[true,3],[false,4]]){
            await touch(session,visible,sequence);
            const row=(await presence()).rows.find(r=>r.user_id===id(partner));
            assert.equal(Date.parse(row.last_seen),before);
          }
        });
        assert.equal(await seen(partner),before);
      }
    });
    await t.test('013 repairs an already installed 012 without rewriting any recorded activity',async()=>{
      const timestamps=(await db.query('select user_id,last_seen from app_presence order by user_id')).rows;
      const fixed=fs.readFileSync(path.join(__dirname,'../supabase/migrations/012_v31_app_presence.sql'),'utf8');
      const old=fixed.replace('case when p.last_seen is not null then least(p.last_seen,v_now) end','least(p.last_seen,v_now)');
      await db.exec(old);
      await asUser(3,async()=>assert.notEqual((await db.query('select * from read_app_presence($1)',[id(11)])).rows.find(r=>r.user_id===id(3)).last_seen,null));
      const repair=fs.readFileSync(path.join(__dirname,'../supabase/migrations/013_v311_last_seen_fix.sql'),'utf8');
      await db.exec(repair);await db.exec(repair);
      await asUser(3,async()=>assert.equal((await db.query('select * from read_app_presence($1)',[id(11)])).rows.find(r=>r.user_id===id(3)).last_seen,null));
      assert.deepEqual((await db.query('select user_id,last_seen from app_presence order by user_id')).rows,timestamps);
    });
    await t.test('daily story covers rotate through the entire photo album for both partners, excluding videos',async()=>{
      for(let n=0;n<65;n++)await db.query("insert into memories(id,couple_id,media_path,kind,created_by,created_at) values($1,$2,$3,$4,$5,$6)",[id(2000+n),id(10),`${id(10)}/${id(1)}/memories/p${n}.jpg`,n===64?'video':'image',id(1),new Date(Date.UTC(2024,0,1+n))]);
      for(const user of [1,2])await asUser(user,async()=>{for(const [day,n] of [['2024-01-01',0],['2024-03-03',62],['2024-03-04',63],['2024-03-05',0]])assert.equal((await db.query('select * from story_cover_for_day($1,$2)',[id(10),day])).rows[0].media_path,`${id(10)}/${id(1)}/memories/p${n}.jpg`);});
    });
    await t.test('cover settings are shared, selected photo order is stable, and uploaded covers participate in rotation',async()=>{
      const path=`${id(10)}/${id(1)}/story/dedicated.jpg`;await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['couple-media',path]);
      await asUser(1,async()=>db.query("update couples set story_cover_mode='selected',story_cover_memory_ids=$1,story_cover_paths=$2 where id=$3",[[id(2003),id(2001)],[path],id(10)]));
      await asUser(2,async()=>{for(const [day,suffix] of [['2024-01-01','memories/p3.jpg'],['2024-01-02','memories/p1.jpg'],['2024-01-03','story/dedicated.jpg']])assert.equal((await db.query('select * from story_cover_for_day($1,$2)',[id(10),day])).rows[0].media_path,`${id(10)}/${id(1)}/${suffix}`);});
    });
    await t.test('outsiders cannot read a daily cover, modify cover settings or inject other-pair media',async()=>{
      await asUser(3,async()=>{assert.deepEqual((await db.query('select * from story_cover_for_day($1,$2)',[id(10),'2024-01-01'])).rows,[]);assert.equal((await db.query("update couples set story_cover_mode='memories' where id=$1 returning id",[id(10)])).rows.length,0);});
      await asUser(1,async()=>{await assert.rejects(db.query('update couples set story_cover_paths=$1 where id=$2',[[`${id(11)}/${id(3)}/messages/photo.jpg`],id(10)]),/Invalid shared cover/);await assert.rejects(db.query('update couples set story_cover_memory_ids=$1 where id=$2',[[id(2064)],id(10)]),/Choose photos/);await assert.rejects(db.query('update couples set story_cover_memory_ids=$1 where id=$2',[[id(99999)],id(10)]),/Choose photos/);});
    });
    await t.test('deleting a selected album photo prunes its cover reference without deleting other memories',async()=>{
      await asUser(2,async()=>db.query('delete from memories where id=$1',[id(2003)]));assert.deepEqual((await db.query('select story_cover_memory_ids from couples where id=$1',[id(10)])).rows[0].story_cover_memory_ids,[id(2001)]);assert.equal((await db.query('select count(*)::int n from memories where couple_id=$1',[id(10)])).rows[0].n,64);
    });
    await t.test('repeat migration preserves a chosen rotation even when a legacy fixed photo exists',async()=>{
      await db.query("update couples set cover_media_path=$1,story_cover_mode='memories' where id=$2",[`${id(10)}/${id(1)}/story/legacy.jpg`,id(10)]);const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/014_v34_story_and_special_dates.sql'),'utf8');await db.exec(sql);assert.equal((await db.query('select story_cover_mode from couples where id=$1',[id(10)])).rows[0].story_cover_mode,'memories');
    });
    await t.test('date-only special milestones persist, are editable by both partners, and enforce pair RLS',async()=>{
      await asUser(1,async()=>db.query("insert into important_dates(id,couple_id,title,date,kind,local_date,special_type,repeats_yearly,created_by) values($1,$2,'Our wedding','2027-04-10T12:00:00Z','milestone','2027-04-10','wedding',true,$3)",[id(2400),id(10),id(1)]));
      await asUser(2,async()=>{assert.equal((await db.query('select local_date::text from important_dates where id=$1',[id(2400)])).rows[0].local_date,'2027-04-10');await db.query("update important_dates set title='Wedding day',local_date='2027-04-11' where id=$1",[id(2400)]);});
      await asUser(3,async()=>{assert.equal((await db.query('select * from important_dates where id=$1',[id(2400)])).rows.length,0);assert.equal((await db.query('update important_dates set repeats_yearly=false where id=$1 returning id',[id(2400)])).rows.length,0);});
      await asUser(1,async()=>assert.rejects(db.query("update important_dates set special_type='invalid' where id=$1",[id(2400)]),/special_date_options_check/));
    });
    await t.test('date photos are private, shared between partners, and reject unrelated or other-pair objects',async()=>{
      const photo=`${id(10)}/${id(1)}/dates/wedding.jpg`,album=`${id(10)}/${id(1)}/memories/p1.jpg`;
      await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',['couple-media',photo,album]);
      await asUser(1,async()=>db.query('update important_dates set photo_path=$1 where id=$2',[photo,id(2400)]));
      await asUser(2,async()=>{assert.equal((await db.query('select photo_path from important_dates where id=$1',[id(2400)])).rows[0].photo_path,photo);await db.query('update important_dates set photo_path=$1 where id=$2',[album,id(2400)]);});
      await asUser(1,async()=>{for(const invalid of [`${id(11)}/${id(3)}/messages/photo.jpg`,`${id(10)}/${id(1)}/messages/photo.jpg`,`${id(10)}/${id(1)}/dates/missing.jpg`])await assert.rejects(db.query('update important_dates set photo_path=$1 where id=$2',[invalid,id(2400)]),/Choose a photo/);});
      await asUser(3,async()=>assert.equal((await db.query('select photo_path from important_dates where id=$1',[id(2400)])).rows.length,0));
      await asUser(2,async()=>db.query('update important_dates set photo_path=null where id=$1',[id(2400)]));
      await asUser(1,async()=>db.query("insert into important_dates(id,couple_id,title,date,kind,local_date,special_type,photo_path,created_by) values($1,$2,'Photo date','2024-01-01T12:00:00Z','milestone','2024-01-01','engagement',$3,$4)",[id(2401),id(10),album,id(1)]));
    });
    await t.test('album deletion clears linked date photos but preserves dates',async()=>{
      await asUser(2,async()=>db.query('delete from memories where id=$1',[id(2001)]));
      assert.equal((await db.query('select photo_path from important_dates where id=$1',[id(2401)])).rows[0].photo_path,null);
      assert.equal((await db.query('select count(*)::int n from important_dates where id=$1',[id(2401)])).rows[0].n,1);
    });
    await t.test('an empty album returns no invented cover and never divides by zero',async()=>{
      await asUser(3,async()=>assert.deepEqual((await db.query('select * from story_cover_for_day($1,$2)',[id(11),'2026-10-08'])).rows,[]));
    });
    await t.test('bulk deletion prunes all removed cover photos in one statement without breaking unrelated media',async()=>{
      await asUser(1,async()=>{await db.query("update couples set story_cover_mode='selected',story_cover_memory_ids=$1 where id=$2",[[id(2004),id(2005)],id(10)]);await db.query('delete from memories where id=any($1)',[[id(2004),id(2005)]]);});
      assert.deepEqual((await db.query('select story_cover_memory_ids from couples where id=$1',[id(10)])).rows[0].story_cover_memory_ids,[]);
      await asUser(2,async()=>assert.equal((await db.query('select * from story_cover_for_day($1,$2)',[id(10),'2026-10-08'])).rows[0].media_path,`${id(10)}/${id(1)}/story/dedicated.jpg`));
    });
    const callDevice=id(300),answerDevice=id(301),secondDevice=id(302);
    const startCall=(n=400)=>db.query('select (start_voice_call($1,$2,$3)).*',[id(10),id(n),callDevice]);
    const act=(n,device,action)=>db.query('select (control_voice_call($1,$2,$3)).*',[id(n),device,action]);
    async function ageCalls(){await db.exec("update voice_calls set created_at=now()-interval '2 minutes' where state not in('ringing','accepted','active')");}
    await t.test('voice calls are pair-private, RPC-only, idempotent, and limited to one active session',async()=>{
      await asUser(1,async()=>{assert.equal((await startCall()).rows[0].state,'ringing');assert.equal((await startCall()).rows[0].id,id(400));await assert.rejects(startCall(401),/already in progress/);await assert.rejects(db.exec(`insert into voice_calls(id,couple_id,caller_id,callee_id,caller_device) values('${id(500)}','${id(10)}','${id(1)}','${id(2)}','${callDevice}')`),/permission denied/);await assert.rejects(act(400,callDevice,'connected'),/Answer the call first/);});
      await asUser(2,async()=>{assert.equal((await db.query('select * from voice_calls')).rows.length,1);await assert.rejects(db.query('select start_voice_call($1,$2,$3)',[id(10),id(402),secondDevice]),/already in progress/);});
      await asUser(3,async()=>{assert.equal((await db.query('select * from voice_calls')).rows.length,0);await assert.rejects(db.query('select current_voice_call($1)',[id(10)]),/Unauthorized/);await assert.rejects(act(400,callDevice,'end'),/Unauthorized/);});
    });
    await t.test('only recipient answers once; wrong devices and invalid signaling are rejected',async()=>{
      await asUser(1,async()=>assert.rejects(act(400,callDevice,'accept'),/Only the recipient/));
      await asUser(2,async()=>{assert.equal((await act(400,answerDevice,'accept')).rows[0].callee_device,answerDevice);await assert.rejects(act(400,secondDevice,'accept'),/another device/);await assert.rejects(act(400,secondDevice,'end'),/another device/);});
      const send=(signal,device=callDevice,kind='description',payload={type:'offer',sdp:'v=0\r\n'})=>db.query('select send_voice_signal($1,$2,$3,$4,$5) as seq',[id(400),device,id(signal),kind,JSON.stringify(payload)]);
      await asUser(1,async()=>{const first=(await send(410)).rows[0].seq;assert.equal((await send(410)).rows[0].seq,first);await assert.rejects(send(411,secondDevice),/not available/);await assert.rejects(send(411,callDevice,'description',{type:'rollback'}),/Invalid description/);await assert.rejects(send(411,callDevice,'candidate',{candidate:'x'.repeat(4097)}),/Invalid candidate/);await assert.rejects(db.exec("update voice_call_signals set kind='candidate'"),/permission denied/);await act(400,callDevice,'connected');});
      await asUser(2,async()=>{assert.equal((await db.query('select * from voice_call_signals')).rows.length,1);await act(400,answerDevice,'end');assert.equal((await db.query('select * from voice_call_signals')).rows.length,0);});
      await asUser(3,async()=>assert.equal((await db.query('select * from voice_call_signals')).rows.length,0));await ageCalls();
    });
    await t.test('cancel, decline, missed ring and heartbeat timeout stop stale calls and cannot be revived',async()=>{
      await asUser(1,async()=>{await startCall(420);assert.equal((await act(420,callDevice,'end')).rows[0].state,'cancelled');});await ageCalls();
      await asUser(1,async()=>startCall(421));await asUser(2,async()=>assert.equal((await act(421,answerDevice,'end')).rows[0].state,'declined'));await ageCalls();
      await asUser(1,async()=>startCall(422));await db.exec(`update voice_calls set created_at=now()-interval '46 seconds' where id='${id(422)}'`);await asUser(2,async()=>{assert.equal((await act(422,answerDevice,'accept')).rows[0].state,'missed');});await ageCalls();
      await asUser(1,async()=>startCall(423));await asUser(2,async()=>act(423,answerDevice,'accept'));await asUser(1,async()=>act(423,callDevice,'connected'));await db.exec(`update voice_calls set caller_ping=now()-interval '61 seconds' where id='${id(423)}'`);await asUser(2,async()=>{await db.query('select current_voice_call($1)',[id(10)]);assert.equal((await act(423,answerDevice,'ping')).rows[0].state,'failed');});await ageCalls();
    });
    await t.test('incoming-call push is claimed once by the real caller and recipient subscriptions stay private',async()=>{
      await asUser(2,async()=>db.exec(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values('https://push.test/call-recipient','${id(2)}','key','auth')`));
      await asUser(1,async()=>{await startCall(430);assert.equal((await db.query('select * from claim_voice_call_push($1,$2)',[id(430),callDevice])).rows.length,1);assert.equal((await db.query('select * from claim_voice_call_push($1,$2)',[id(430),callDevice])).rows.length,0);await assert.rejects(db.query('select * from claim_voice_call_push($1,$2)',[id(430),secondDevice]),/Unauthorized/);await act(430,callDevice,'end');});
      await asUser(3,async()=>assert.rejects(db.query('select * from claim_voice_call_push($1,$2)',[id(430),callDevice]),/Unauthorized/));
      await asUser(2,async()=>db.exec("delete from push_subscriptions where endpoint='https://push.test/call-recipient'"));await ageCalls();
    });
    await t.test('call creation rate limit and anonymous access are enforced',async()=>{
      await asUser(1,async()=>{for(let n=440;n<445;n++){await startCall(n);await act(n,callDevice,'end');}await assert.rejects(startCall(445),/wait a minute/);});await ageCalls();
      await db.exec('set role anon;');try{await assert.rejects(db.query('select start_voice_call($1,$2,$3)',[id(10),id(450),callDevice]),/permission denied/);await assert.rejects(db.query('select * from voice_calls'),/permission denied/);}finally{await db.exec('reset role;');}
    });
    const journalSQL=fs.readFileSync(path.join(__dirname,'../supabase/migrations/010_v29_call_journal.sql'),'utf8');
    const journal=async n=>(await db.query('select * from messages where call_summary->>\'id\'=$1',[id(n)])).rows;
    const history=(filter='all',before=null,beforeId=null,limit=31)=>db.query('select * from voice_call_history($1,$2,$3,$4,$5)',[id(10),filter,before,beforeId,limit]);
    await t.test('every call has one server-owned event with the final outcome and no signaling or device secrets',async()=>{
      const rows=(await db.query("select * from messages where type='call'")).rows;
      assert.equal(rows.length,11);assert.equal(new Set(rows.map(r=>r.call_summary.id)).size,11);
      for(const row of rows){assert.equal(row.sender_id,id(1));assert.equal(row.call_summary.caller_id,id(1));assert.equal(row.call_summary.callee_id,id(2));assert.ok(row.call_summary.updated_at);for(const forbidden of ['caller_device','callee_device','sdp','candidate','credential'])assert.ok(!Object.hasOwn(row.call_summary,forbidden));}
      for(const [n,state] of [[400,'ended'],[420,'cancelled'],[421,'declined'],[422,'missed'],[423,'failed']])assert.equal((await journal(n))[0].call_summary.state,state);
      await asUser(2,async()=>{assert.equal((await history()).rows.length,11);assert.equal((await history('missed')).rows.length,1);assert.equal((await history('incoming')).rows.length,11);assert.equal((await history('outgoing')).rows.length,0);});
      await asUser(1,async()=>assert.equal((await history('missed')).rows.length,0));
      await asUser(3,async()=>assert.equal((await history()).rows.length,0));
    });
    await t.test('ringing, accepted, active and ended update one event; heartbeat does not rewrite it',async()=>{
      await asUser(1,async()=>startCall(460));const first=(await journal(460))[0];
      await asUser(2,async()=>act(460,answerDevice,'accept'));assert.equal((await journal(460))[0].call_summary.state,'accepted');
      await asUser(1,async()=>act(460,callDevice,'connected'));await db.exec(`update voice_calls set started_at=now()-interval '65 seconds' where id='${id(460)}'`);
      const active=(await journal(460))[0];await asUser(1,async()=>act(460,callDevice,'ping'));
      assert.equal((await journal(460))[0].call_summary.updated_at,active.call_summary.updated_at);
      await asUser(2,async()=>act(460,answerDevice,'end'));const final=(await journal(460))[0];
      assert.equal(final.id,first.id);assert.equal(+new Date(final.created_at),+new Date(first.created_at));assert.equal(final.call_summary.state,'ended');assert.ok((Date.parse(final.call_summary.ended_at)-Date.parse(final.call_summary.started_at))/1000>=65);
      assert.equal((await journal(460)).length,1);await ageCalls();
    });
    await t.test('ordinary message UUID collisions cannot hijack chat content',async()=>{
      await asUser(1,async()=>{await startCall(100);await act(100,callDevice,'end');});
      assert.notEqual((await journal(100))[0].id,id(100));assert.equal((await db.query('select body from messages where id=$1',[id(100)])).rows[0].body,'secret one');await ageCalls();
    });
    await t.test('clients cannot forge, edit, delete, convert or call privileged writers for call events',async()=>{
      const row=(await journal(460))[0];
      await asUser(1,async()=>{
        await assert.rejects(db.query('insert into messages(couple_id,sender_id,type,call_summary) values($1,$2,$3,$4)',[id(10),id(1),'call',JSON.stringify(row.call_summary)]),/row-level security/);
        await assert.rejects(db.query('update messages set type=\'call\',call_summary=$1 where id=$2',[JSON.stringify(row.call_summary),id(100)]),/row-level security/);
        assert.equal((await db.query('update messages set body=\'forged\' where id=$1 returning id',[row.id])).rows.length,0);
        assert.equal((await db.query('delete from messages where id=$1 returning id',[row.id])).rows.length,0);
        await assert.rejects(db.query('select delete_message_for_everyone($1)',[row.id]),/ordinary message/);
        await assert.rejects(db.query('select set_message_pin($1,true)',[row.id]),/access denied/);
        await assert.rejects(db.query('select write_voice_call_message(c) from voice_calls c limit 1'),/permission denied/);
      });
      await db.exec('set role anon;');try{await assert.rejects(history(),/permission denied/);}finally{await db.exec('reset role;');}
    });
    await t.test('history pagination is deterministic, pair-private and owner hides stay private across migration repeats',async()=>{
      const row=(await journal(421))[0];
      await asUser(2,async()=>{const all=(await history()).rows;const first=(await history('all',null,null,3)).rows;const last=first.at(-1);const rest=(await history('all',last.created_at,last.message_id,100)).rows;assert.deepEqual([...first,...rest].map(r=>r.message_id),all.map(r=>r.message_id));await db.query('select hide_message_for_me($1)',[row.id]);assert.ok(!(await history()).rows.some(r=>r.message_id===row.id));});
      await asUser(1,async()=>assert.ok((await history()).rows.some(r=>r.message_id===row.id)));
      await db.exec(journalSQL);await asUser(2,async()=>assert.ok(!(await history()).rows.some(r=>r.message_id===row.id)));
    });
    await t.test('call snapshot and duration survive cleanup of the signaling session',async()=>{
      const before=(await journal(400))[0];await db.query('delete from voice_calls where id=$1',[id(400)]);const after=(await journal(400))[0];
      assert.equal(after.call_id,null);assert.deepEqual(after.call_summary,before.call_summary);
      await asUser(2,async()=>assert.ok((await history()).rows.some(r=>r.message_id===before.id)));
    });
    await t.test('backfill restores existing v2.8 calls once without creating old unread badges',async()=>{
      await db.exec(`alter table voice_calls disable trigger voice_call_message_sync;insert into voice_calls(id,couple_id,caller_id,callee_id,caller_device,state,created_at,ended_at) values('${id(470)}','${id(10)}','${id(1)}','${id(2)}','${callDevice}','missed',now()-interval '1 day',now()-interval '1 day'+interval '45 seconds');alter table voice_calls enable trigger voice_call_message_sync;`);
      assert.equal((await journal(470)).length,0);await db.exec(journalSQL);const row=(await journal(470))[0];
      assert.equal(row.call_summary.state,'missed');assert.equal((await db.query('select * from message_reads where message_id=$1',[row.id])).rows.length,2);await db.exec(journalSQL);assert.equal((await journal(470)).length,1);
    });
    await t.test('an incoming call contributes one unread event; updates do not add duplicates',async()=>{
      await db.exec(`insert into message_reads(message_id,user_id) select id,'${id(2)}' from messages where type='call' on conflict do nothing`);
      const unread=async()=>Number((await db.query('select count_unread_messages($1) as n',[id(10)])).rows[0].n);
      const baseline=await asUser(2,unread);await asUser(1,async()=>startCall(480));assert.equal(await asUser(2,unread),baseline+1);
      await asUser(1,async()=>act(480,callDevice,'end'));assert.equal(await asUser(2,unread),baseline+1);await ageCalls();
      await db.exec(`insert into message_reads(message_id,user_id) select id,'${id(2)}' from messages where type='call' on conflict do nothing`);
    });
    await t.test('video creation keeps ownership, audio compatibility, private snapshots and one shared active call',async()=>{
      await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/011_v30_video_calls.sql'),'utf8'));
      const video=()=>db.query('select (start_video_call($1,$2,$3)).*',[id(10),id(890),callDevice]);
      await ageCalls();
      await asUser(1,async()=>{
        const row=(await video()).rows[0];assert.equal(row.media_kind,'video');assert.equal((await video()).rows[0].id,row.id);
        await assert.rejects(startCall(891),/already in progress/);
        await assert.rejects(startCall(890),/Unauthorized/);
        await assert.rejects(db.query('select start_media_call($1,$2,$3,$4)',[id(10),id(892),callDevice,'video']),/permission denied/);
        await assert.rejects(db.exec("update voice_calls set media_kind='audio'"),/permission denied/);
      });
      await asUser(3,async()=>{await assert.rejects(video(),/Pair your accounts/);assert.equal((await history()).rows.length,0);});
      await asUser(2,async()=>act(890,answerDevice,'accept'));await asUser(1,async()=>act(890,callDevice,'connected'));await asUser(2,async()=>act(890,answerDevice,'end'));
      const snapshot=(await journal(890))[0];assert.equal(snapshot.call_summary.media_kind,'video');assert.equal(snapshot.call_summary.state,'ended');assert.equal(snapshot.body,'Video call ended');assert.equal((await journal(890)).length,1);
      const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/011_v30_video_calls.sql'),'utf8');await db.exec(migration);assert.equal((await journal(890))[0].id,snapshot.id);assert.equal((await journal(890))[0].call_summary.media_kind,'video');
      await db.exec(`delete from voice_calls where id='${id(890)}'`);assert.equal((await journal(890))[0].call_summary.media_kind,'video');
      await ageCalls();await asUser(1,async()=>{assert.equal((await startCall(893)).rows[0].media_kind,'audio');await act(893,callDevice,'end');});await ageCalls();
      await db.exec(`insert into message_reads(message_id,user_id) select m.id,u.id from messages m cross join (values('${id(1)}'::uuid),('${id(2)}'::uuid)) u(id) where m.call_summary->>'id' in('${id(890)}','${id(893)}') on conflict do nothing`);
    });
    await t.test('each member saves an independent private name, resets it and cannot read or change the other member preference',async()=>{
      async function save(owner,partner,name){return db.query(`insert into partner_contact_preferences(couple_id,owner_id,partner_id,contact_name) values($1,$2,$3,$4) on conflict(couple_id,owner_id,partner_id) do update set contact_name=excluded.contact_name returning contact_name`,[id(10),id(owner),id(partner),name]);}
      await asUser(1,async()=>assert.equal((await save(1,2,'اسم تجريبي ❤️')).rows[0].contact_name,'اسم تجريبي ❤️'));
      await asUser(2,async()=>{assert.equal((await db.query('select * from partner_contact_preferences')).rows.length,0);await save(2,1,'My love');assert.equal((await db.query('select contact_name from partner_contact_preferences')).rows[0].contact_name,'My love');await assert.rejects(save(1,2,'hijacked'),/row-level security/);assert.equal((await db.query(`update partner_contact_preferences set contact_name='hijacked' where owner_id='${id(1)}' returning *`)).rows.length,0);assert.equal((await db.query(`delete from partner_contact_preferences where owner_id='${id(1)}' returning *`)).rows.length,0);});
      await asUser(3,async()=>{assert.equal((await db.query('select * from partner_contact_preferences')).rows.length,0);await assert.rejects(save(3,2,'foreign partner'),/row-level security/);});
      await asUser(1,async()=>{assert.equal((await db.query('select contact_name from partner_contact_preferences')).rows[0].contact_name,'اسم تجريبي ❤️');await assert.rejects(save(1,3,'foreign'),/row-level security/);await assert.rejects(save(1,1,'self'),/row-level security|contact_different_users/);await assert.rejects(db.exec(`update partner_contact_preferences set partner_id='${id(3)}'`),/row-level security/);await assert.rejects(save(1,2,'x'.repeat(81)),/contact_name_valid/);await assert.rejects(save(1,2,' leading'),/contact_name_valid/);await assert.rejects(save(1,2,'line\nbreak'),/contact_name_valid/);await save(1,2,null);assert.equal((await db.query('select contact_name from partner_contact_preferences')).rows[0].contact_name,null);});
      await db.exec('set role anon;');try{await assert.rejects(db.query('select * from partner_contact_preferences'),/permission denied/);}finally{await db.exec('reset role;');}
      assert.equal((await db.query(`select nickname from profiles where user_id='${id(2)}'`)).rows[0].nickname,'b');
    });
    await t.test('private messages and objects visible only to their pair',async()=>{
      await asUser(2,async()=>{assert.equal((await db.query("select * from messages where type<>'call'")).rows.length,1);const objects=(await db.query('select * from storage.objects')).rows;assert.equal(objects.length,4);assert.ok(objects.every(o=>o.name.startsWith(`${id(10)}/`)));});
      await asUser(3,async()=>assert.equal((await db.query(`select * from messages where id='${id(100)}'`)).rows.length,0));
    });
    await t.test('push upsert allowed for owner but foreign ownership is rejected',async()=>{
      await asUser(1,async()=>{await db.exec(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values('https://push.test/a','${id(1)}','key','auth') on conflict(endpoint) do update set p256dh=excluded.p256dh;`);await db.exec(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values('https://push.test/a','${id(1)}','new','auth') on conflict(endpoint) do update set p256dh=excluded.p256dh;`);});
      await asUser(2,async()=>{assert.equal((await db.query('select * from push_subscriptions')).rows.length,0);await assert.rejects(db.exec(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values('foreign','${id(1)}','key','auth')`),/row-level security/);await assert.rejects(db.exec(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values('https://push.test/a','${id(2)}','key','auth') on conflict(endpoint) do update set user_id=excluded.user_id`),/row-level security/);});
    });
    await t.test('video messages accepted and cross-pair replies rejected',async()=>{
      await asUser(1,async()=>{await db.exec(`insert into messages(id,couple_id,sender_id,type) values('${id(102)}','${id(10)}','${id(1)}','video')`);await assert.rejects(db.exec(`insert into messages(couple_id,sender_id,type,reply_to) values('${id(10)}','${id(1)}','text','${id(101)}')`),/Reply target/);});
    });
    await t.test('hard deletion redacts quoted content before FK clears target',async()=>{
      await asUser(2,async()=>db.exec(`insert into messages(id,couple_id,sender_id,type,reply_to,reply_snapshot) values('${id(103)}','${id(10)}','${id(2)}','text','${id(100)}','{"id":"${id(100)}","body":"secret one"}')`));
      await asUser(1,async()=>db.exec(`delete from messages where id='${id(100)}'`));
      const row=(await db.query(`select reply_to,reply_snapshot from messages where id='${id(103)}'`)).rows[0];assert.equal(row.reply_to,null);assert.equal(row.reply_snapshot.body,'Deleted message');
    });
    await t.test('soft deletion redacts quotes and invalidates new replies',async()=>{
      await asUser(2,async()=>db.exec(`insert into messages(id,couple_id,sender_id,type,reply_to,reply_snapshot) values('${id(104)}','${id(10)}','${id(2)}','text','${id(102)}','{"id":"${id(102)}","body":"private video"}')`));
      await asUser(1,async()=>db.exec(`select delete_message_for_everyone('${id(102)}')`));
      assert.equal((await db.query(`select reply_snapshot from messages where id='${id(104)}'`)).rows[0].reply_snapshot.body,'Deleted message');
      await asUser(2,async()=>assert.rejects(db.exec(`insert into messages(couple_id,sender_id,type,reply_to) values('${id(10)}','${id(2)}','text','${id(102)}')`),/Reply target/));
    });
    await t.test('unread count spans more than one UI page, excludes reads/hides/deleted/self',async()=>{
      await db.exec(`insert into messages(couple_id,sender_id,type,body) select '${id(10)}','${id(1)}','text','batch' from generate_series(1,75)`);
      await asUser(2,async()=>{assert.equal(Number((await db.query(`select count_unread_messages('${id(10)}') as n`)).rows[0].n),75);const rows=(await db.query("select id from messages where body='batch' limit 2")).rows;await db.exec(`insert into message_reads(message_id,user_id) values('${rows[0].id}','${id(2)}');select hide_message_for_me('${rows[1].id}')`);assert.equal(Number((await db.query(`select count_unread_messages('${id(10)}') as n`)).rows[0].n),73);assert.equal(Number((await db.query(`select count_unread_messages('${id(11)}') as n`)).rows[0].n),0);});
    });
    await t.test('read/reaction updates cannot move rows to another conversation',async()=>{
      const mid=(await db.query("select id from messages where body='batch' limit 1")).rows[0].id;
      await asUser(2,async()=>{await db.exec(`insert into reactions(message_id,user_id,emoji) values('${mid}','${id(2)}','heart')`);await assert.rejects(db.exec(`update reactions set message_id='${id(101)}' where message_id='${mid}'`),/row-level security/);await assert.rejects(db.exec(`update message_reads set message_id='${id(101)}'`),/row-level security/);});
    });
    await t.test('foreground message pushes exclude only the reading device, and resume immediately on exit',async()=>{
      await db.exec(`insert into push_subscriptions(endpoint,user_id,p256dh,auth) values('https://push.test/phone','${id(2)}','phone','auth'),('https://push.test/tablet','${id(2)}','tablet','auth');insert into messages(id,couple_id,sender_id,type,body) values('${id(980)}','${id(10)}','${id(1)}','text','push message');`);
      const targets=async()=>Array.from((await db.query('select * from get_message_push_subscriptions($1)',[id(980)])).rows,r=>r.endpoint).sort();
      await asUser(1,async()=>assert.deepEqual(await targets(),['https://push.test/phone','https://push.test/tablet']));
      await asUser(2,async()=>db.query('select touch_push_chat($1,$2,true,1)',['https://push.test/phone',id(981)]));
      await asUser(1,async()=>{assert.deepEqual(await targets(),['https://push.test/tablet']);assert.equal((await db.query('select * from get_partner_push_subscriptions()')).rows.filter(r=>r.endpoint==='https://push.test/phone').length,0);});
      await asUser(2,async()=>db.query('select touch_push_chat($1,$2,false,2)',['https://push.test/phone',id(981)]));
      await asUser(1,async()=>assert.deepEqual(await targets(),['https://push.test/phone','https://push.test/tablet']));
    });
    await t.test('late foreground writes cannot revive a hidden chat and separate windows cannot clear one another',async()=>{
      const touch=(client,reading,sequence)=>db.query('select touch_push_chat($1,$2,$3,$4)',['https://push.test/phone',id(client),reading,sequence]);
      await asUser(2,async()=>{await touch(981,true,1);await touch(982,true,1);});
      await asUser(1,async()=>assert.equal((await db.query('select * from get_message_push_subscriptions($1)',[id(980)])).rows.length,1));
      await asUser(2,async()=>{await touch(982,false,2);await touch(982,true,1);});
      await asUser(1,async()=>assert.equal((await db.query('select * from get_message_push_subscriptions($1)',[id(980)])).rows.length,2));
      await asUser(2,async()=>{await touch(981,true,3);await touch(982,true,3);await touch(981,false,4);});
      await asUser(1,async()=>assert.equal((await db.query('select * from get_message_push_subscriptions($1)',[id(980)])).rows.length,1));
    });
    await t.test('silent page termination expires the server lease and repeat migration preserves state',async()=>{
      await db.exec("update push_chat_sessions set updated_at=clock_timestamp()-interval '21 seconds' where endpoint='https://push.test/phone'");
      await asUser(1,async()=>assert.equal((await db.query('select * from get_message_push_subscriptions($1)',[id(980)])).rows.length,2));
      await asUser(2,async()=>db.query('select touch_push_chat($1,$2,true,5)',['https://push.test/phone',id(981)]));
      await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/016_v364_chat_push_presence.sql'),'utf8'));
      await asUser(1,async()=>assert.equal((await db.query('select * from get_message_push_subscriptions($1)',[id(980)])).rows.length,1));
    });
    await t.test('push reading sessions and message lookup reject foreign identities and protect device endpoints',async()=>{
      await asUser(1,async()=>assert.rejects(db.query('select touch_push_chat($1,$2,true,1)',['https://push.test/phone',id(983)]),/Unauthorized/));
      await asUser(3,async()=>{await assert.rejects(db.query('select * from push_chat_sessions'),/permission denied/);await assert.rejects(db.query('select * from get_message_push_subscriptions($1)',[id(980)]),/Unauthorized/);});
      await asUser(2,async()=>{await assert.rejects(db.query('select * from get_message_push_subscriptions($1)',[id(980)]),/Unauthorized/);await assert.rejects(db.query('select touch_push_chat($1,$2,true,0)',['https://push.test/phone',id(983)]),/Unauthorized/);});
      await db.exec('set role anon;');try{await assert.rejects(db.query('select touch_push_chat($1,$2,true,1)',['https://push.test/phone',id(983)]),/permission denied/);}finally{await db.exec('reset role;');}
    });
    await t.test('already-read or deleted messages do not generate late pushes; unsubscribe clears reading state',async()=>{
      await asUser(2,async()=>db.query('insert into message_reads(message_id,user_id) values($1,$2)',[id(980),id(2)]));
      await asUser(1,async()=>assert.equal((await db.query('select * from get_message_push_subscriptions($1)',[id(980)])).rows.length,0));
      await db.query('delete from message_reads where message_id=$1',[id(980)]);await db.query('update messages set deleted_at=clock_timestamp() where id=$1',[id(980)]);
      await asUser(1,async()=>assert.equal((await db.query('select * from get_message_push_subscriptions($1)',[id(980)])).rows.length,0));
      await asUser(2,async()=>db.exec("delete from push_subscriptions where endpoint='https://push.test/phone' or endpoint='https://push.test/tablet'"));
      assert.equal((await db.query('select * from push_chat_sessions')).rows.length,0);
    });
    await t.test('members cannot edit counterpart text or pair identity',async()=>{
      await asUser(2,async()=>{assert.equal((await db.query(`update messages set body='changed' where sender_id='${id(1)}' returning id`)).rows.length,0);await assert.rejects(db.exec(`update couples set user_a='${id(3)}' where id='${id(10)}'`),/permission denied/);});
    });
  }finally{await db.close();}
});
