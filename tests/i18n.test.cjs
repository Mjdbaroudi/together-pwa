const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {load}=require('./load-ts.cjs');
const {preferredLanguage,isLanguage,translate,arabic,english,LANGUAGE_KEY}=load('lib/i18n.ts');
test('saved device language overrides browser language; invalid values have a safe fallback',()=>{
  assert.equal(preferredLanguage('en','ar-SY'),'en');assert.equal(preferredLanguage('ar','en-US'),'ar');
  assert.equal(preferredLanguage(null,'ar-SY'),'ar');assert.equal(preferredLanguage('bad','en-US'),'en');
  assert.equal(isLanguage('AR'),false);assert.equal(LANGUAGE_KEY,'together-language-v1');
});
test('English retains original labels and placeholders without bidi changes',()=>{
  assert.equal(translate('en','Hello, {0}.',['Lina ♥']),'Hello, Lina ♥.');
  assert.equal(translate('en',' Save '),' Save ');assert.equal(translate('en','No answer'),'No answer');
});
test('Arabic UI localizes known labels and isolates mixed-language user values verbatim',()=>{
  assert.equal(translate('ar','Home'),'الرئيسية');assert.equal(translate('ar',' Save '),' حفظ ');
  const name='Lina ❤️ / نور';assert.equal(translate('ar','Hello, {0}.',[name]),`أهلًا، \u2068${name}\u2069.`);
  assert.equal(translate('ar','Save {0} {1}',[2,translate('ar','memories')]),'حفظ \u20682\u2069 \u2068ذكريات\u2069');
});
test('unknown messages and values stay original, including English words matching UI keys',()=>{
  assert.equal(translate('ar','Our favorite sunset'),'Our favorite sunset');
  assert.equal(translate('ar','Reply to {0}',['Home']),'الرد على \u2068Home\u2069');
  assert.equal(translate('ar','صورة خطبتنا ❤️'),'صورة خطبتنا ❤️');
});
test('dynamic technical labels use compiled templates; durations remain unchanged',()=>{
  assert.equal(translate('ar','Incoming video call'),'مكالمة فيديو واردة');
  assert.equal(translate('ar','Microphone 2'),'الميكروفون \u20682\u2069');
  assert.equal(translate('ar','02:56'),'02:56');
  const {callLabel}=load('lib/calls/journal.ts');for(const state of ['ringing','accepted','active','ended','missed','declined','cancelled','failed'])for(const media_kind of ['audio','video'])for(const viewer of ['me','partner']){
    const label=callLabel({state,media_kind,caller_id:'me',callee_id:'partner',started_at:null},viewer);assert.ok(Object.hasOwn(arabic,label),label);
  }
});
test('every translation retains exactly the same placeholder indices as its English key',()=>{
  for(const [key,value] of Object.entries(arabic)){
    const tokens=s=>[...s.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();assert.deepEqual(tokens(value),tokens(key),key);assert.ok(value.length,key);
  }
});
test('all explicit static UI translation calls have an Arabic entry',()=>{
  const root=path.resolve(__dirname,'../src'),missing=[];
  function visit(dir){for(const file of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,file.name);if(file.isDirectory()){visit(full);continue;}if(!/\.tsx$/.test(file.name))continue;
    const source=ts.createSourceFile(full,fs.readFileSync(full,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function walk(node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['uiText','t'].includes(node.expression.text)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
      const key=node.arguments[0].text.replace(/\s+/g,' ').trim();if(!Object.hasOwn(arabic,key)&&!Object.hasOwn(english,key))missing.push(path.relative(root,full)+': '+key);
    }ts.forEachChild(node,walk);}walk(source);
  }}visit(root);assert.deepEqual(missing,[]);
});
test('Arabic date and last-seen formatting does not mutate dates or presence ownership',()=>{
  const date=load('lib/date.ts'),presence=load('lib/together/presence.ts',{}, {'@/lib/supabase/client':{}}),now=new Date(2026,9,8,12);
  const stamp=new Date(2026,9,8,10).toISOString();assert.equal(date.dayLabel(stamp,now,'ar'),'اليوم');
  assert.match(presence.lastSeenLabel(stamp,now,'ar'),/^آخر ظهور اليوم/);assert.match(presence.lastSeenLabel(stamp,now,'en'),/^Last seen today/);
  assert.equal(date.formatDateOnly('2024-01-21','ar'),new Date(2024,0,21).toLocaleDateString('ar',{month:'short',day:'numeric',year:'numeric'}));
  const profile={myUserId:'me',partnerUserId:'partner',coupleId:'pair'};const rows=[{user_id:'me',last_seen:'mine',online:false},{user_id:'partner',last_seen:stamp,online:false}];
  assert.equal(presence.applyAppPresence(profile,profile,rows).lastSeen,stamp);
});
test('Faith UI, source labels and all curated meanings follow the selected language',()=>{
  const {DAILY_VERSES,ADHKAR,periodLabel}=load('lib/faith/content.ts'),{PRAYERS,PRAYER_CITIES,PRAYER_METHODS,countdown,prayerTime}=load('lib/faith/prayers.ts');
  for(const source of ['لحظة إيمان','إعداد مواقيت الصلاة','موقعي الحالي','كيف أفعّل الميكروفون والكاميرا؟',periodLabel('morning'),periodLabel('evening'),...DAILY_VERSES.flatMap(v=>[v.text,v.meaning,v.surah,v.theme]),...ADHKAR.flatMap(d=>[d.title,d.text,d.source]),...PRAYERS.map(p=>p.label),...PRAYER_CITIES.map(p=>p.label),...PRAYER_METHODS.map(p=>p.label)]){
    assert.ok(!/[\u0600-\u06ff]/.test(translate('en',source)),source);assert.equal(translate('ar',source),source);
  }
  assert.equal(countdown('2026-10-08T14:30:00Z',Date.parse('2026-10-08T12:00:00Z'),'en'),'In 2h 30m');assert.equal(prayerTime(null,'Europe/Paris','en'),'Unavailable');
});
test('chat toolbar stays physically LTR while Arabic message text stays automatic',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/components/chat/Composer.tsx'),'utf8');
  assert.match(source,/composer-wrap composer-wrap-pro" dir="ltr"/);assert.ok(source.includes('dir="auto"'));
});
test('language provider keeps app identity and uses local fonts without translating user content',()=>{
  const root=path.resolve(__dirname,'../src'),provider=fs.readFileSync(root+'/components/i18n/LanguageProvider.tsx','utf8'),css=fs.readFileSync(root+'/app/language-v35.css','utf8');
  assert.ok(provider.includes('localStorage.setItem(LANGUAGE_KEY, value)'));assert.ok(provider.includes('document.documentElement.dir'));
  assert.ok(!provider.includes('key={language}'));assert.ok(!provider.includes('location.reload'));assert.ok(!provider.includes('querySelector'));
  assert.ok(!css.includes('@import'));assert.ok(!css.includes('http'));assert.ok(css.includes('unicode-bidi:plaintext'));
});
