const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const prayers=load('lib/faith/prayers.ts');
const content=load('lib/faith/content.ts');
const config={label:'Paris',latitude:48.8566,longitude:2.3522,timezone:'Europe/Paris',method:3,school:0,highLatitude:3};
function provider(date='2026-10-08',options={}){
 const [y,m,d]=date.split('-');const times={Fajr:'04:28',Sunrise:'07:07',Dhuhr:'12:26',Asr:'14:54',Maghrib:'17:44',Isha:'20:13'};
 return {code:200,data:{date:{gregorian:{date:`${d}-${m}-${y}`}},meta:{latitude:config.latitude,longitude:config.longitude,timezone:config.timezone,method:{id:3},school:'STANDARD',latitudeAdjustmentMethod:'ANGLE_BASED',...options.meta},timings:Object.fromEntries(Object.entries({...times,...options.times}).map(([k,v])=>[k,v===null?'-':`${date}T${v}:00+02:00`]))}};
}
function schedule(date='2026-10-08'){return {today:prayers.parseProviderDay(provider(date),date,config),tomorrow:prayers.parseProviderDay(provider(prayers.nextDay(date)),prayers.nextDay(date),config)};}
function storageFixture(initial=new Map()){
 const localStorage={getItem:k=>initial.get(k)||null,setItem:(k,v)=>initial.set(k,v)};
 return {store:initial,storage:load('lib/faith/storage.ts',{localStorage}),reload:()=>load('lib/faith/storage.ts',{localStorage}),localStorage};
}
test('city settings validate every calculation option and coordinate boundary',()=>{
 assert.deepEqual({...prayers.parseSettings(config)},config);
 for(const patch of [{latitude:NaN},{longitude:Infinity},{latitude:91},{longitude:-181},{timezone:'invalid/timezone'},{method:999},{school:9},{highLatitude:0},{label:''}])assert.equal(prayers.parseSettings({...config,...patch}),null);
});
test('calendar validation rejects normalized impossible dates',()=>{assert.equal(prayers.validDay('2026-02-30'),false);assert.equal(prayers.validDay('2026-10-08'),true);assert.equal(prayers.nextDay('2026-12-31'),'2027-01-01');});
test('selected city date uses its timezone rather than browser UTC date',()=>{
 const instant=new Date('2026-10-08T22:30:00Z');assert.equal(prayers.zonedDay(instant,'Europe/Paris'),'2026-10-09');assert.equal(prayers.zonedDay(instant,'America/New_York'),'2026-10-08');
});
test('verified provider response supplies absolute instants and five ordered prayers',()=>{const day=prayers.parseProviderDay(provider(),'2026-10-08',config);assert.equal(day.complete,true);assert.equal(day.timings.Fajr,'2026-10-08T04:28:00+02:00');});
test('wrong city coordinates, date, method or timezone are rejected before display',()=>{
 for(const patch of [{latitude:33},{longitude:99},{timezone:'Asia/Damascus'},{method:{id:4}},{school:'HANAFI'},{latitudeAdjustmentMethod:'ONE_SEVENTH'}])assert.throws(()=>prayers.parseProviderDay(provider('2026-10-08',{meta:patch}),'2026-10-08',config));
 assert.throws(()=>prayers.parseProviderDay(provider('2026-10-07'),'2026-10-08',config));
});
test('polar unavailable times remain unavailable and are never invented',()=>{const day=prayers.parseProviderDay(provider('2026-10-08',{times:{Fajr:null}}),'2026-10-08',config);assert.equal(day.timings.Fajr,null);assert.equal(day.complete,false);assert.equal(prayers.upcomingPrayer({...schedule(),today:day},Date.parse('2026-10-08T10:00:00Z')),null);});
test('out-of-order midnight times do not produce a misleading countdown',()=>{const day=prayers.parseProviderDay(provider('2026-10-08',{times:{Isha:'00:15'}}),'2026-10-08',config);assert.equal(day.complete,false);});
test('after Isha next prayer is tomorrow Fajr, not today Fajr plus a fixed 24-hour guess',()=>{const next=prayers.upcomingPrayer(schedule(),Date.parse('2026-10-08T21:00:00+02:00'));assert.equal(next.key,'Fajr');assert.equal(next.date,'2026-10-09');assert.equal(next.at,'2026-10-09T04:28:00+02:00');});
test('exact prayer minute displays the current prayer then moves to the next',()=>{const data=schedule(),at=Date.parse(data.today.timings.Asr);assert.equal(prayers.upcomingPrayer(data,at+30000).key,'Asr');assert.equal(prayers.countdown(data.today.timings.Asr,at+30000),'حان وقت الصلاة');assert.equal(prayers.upcomingPrayer(data,at+61000).key,'Maghrib');});
test('different DST offsets are preserved as actual elapsed time',()=>{const data=schedule('2026-10-24');for(const key of Object.keys(data.tomorrow.timings))data.tomorrow.timings[key]=data.tomorrow.timings[key].replace('+02:00','+01:00');assert.equal(prayers.validSchedule(data,'2026-10-24',config),true);const at=Date.parse('2026-10-24T23:30:00+02:00');assert.equal(prayers.countdown(prayers.upcomingPrayer(data,at).at,at),'بعد 5 س و58 د');});
test('cache validation rejects invalid instants, shifted dates and mismatched timezone',()=>{for(const mutate of [d=>d.today.timings.Fajr='garbage',d=>d.tomorrow.date='2026-10-08',d=>d.today.timezone='Asia/Damascus',d=>d.today.timings.Isha=d.today.timings.Fajr]){const data=schedule();mutate(data);assert.equal(prayers.validSchedule(data,'2026-10-08',config),false);}});
test('prayer settings persist after reload and remain separate for both accounts',()=>{const f=storageFixture();f.storage.savePrayerSettings('a',config);assert.equal(f.reload().readPrayerSettings('a').latitude,config.latitude);assert.equal(f.reload().readPrayerSettings('b'),null);f.storage.savePrayerSettings('a',null);assert.equal(f.reload().readPrayerSettings('a'),null);});
test('dhikr counts persist and morning, evening and account data remain independent',()=>{const f=storageFixture();f.storage.saveDhikrCount('a','2026-10-08','morning','ikhlas',2);const p=f.reload().readDhikrProgress('a','2026-10-08');assert.equal(p.morning.ikhlas,2);assert.equal(p.evening.ikhlas,0);assert.equal(f.reload().readDhikrProgress('b','2026-10-08').morning.ikhlas,0);});
test('new day resets visible progress without treating yesterday as completed today',()=>{const f=storageFixture();f.storage.saveDhikrCount('a','2026-10-08','morning','ikhlas',3);assert.equal(f.reload().readDhikrProgress('a','2026-10-09').morning.ikhlas,0);});
test('negative, over-limit and malformed persisted counts are normalized safely',()=>{const f=storageFixture(new Map([['together:faith:adhkar:a',JSON.stringify({day:'2026-10-08',morning:{ikhlas:900,nas:-1,tasbih:'100',bismillah:2.9}})]]));const p=f.storage.readDhikrProgress('a','2026-10-08');assert.equal(p.morning.ikhlas,3);assert.equal(p.morning.nas,0);assert.equal(p.morning.tasbih,0);assert.equal(p.morning.bismillah,2);});
test('counter remains bounded and unknown dhikr cannot be injected into storage',()=>{const f=storageFixture();assert.equal(f.storage.saveDhikrCount('a','2026-10-08','morning','tasbih',101).morning.tasbih,100);assert.throws(()=>f.storage.saveDhikrCount('a','2026-10-08','morning','unknown',1));});
test('failed device storage is reported rather than claiming saved progress',()=>{const f=storageFixture();f.localStorage.setItem=()=>{throw new Error('quota');};assert.throws(()=>f.storage.saveDhikrCount('a','2026-10-08','morning','ikhlas',1),/تعذّر حفظ/);assert.throws(()=>f.storage.savePrayerSettings('a',config),/تعذّر حفظ/);});
test('prayer cache is bound to exact account, city, day and calculation choices',()=>{const f=storageFixture(),data=schedule();f.storage.savePrayerCache('a',config,'2026-10-08',data);assert.ok(f.reload().readPrayerCache('a',config,'2026-10-08'));assert.equal(f.storage.readPrayerCache('b',config,'2026-10-08'),null);assert.equal(f.storage.readPrayerCache('a',{...config,method:4},'2026-10-08'),null);assert.equal(f.storage.readPrayerCache('a',config,'2026-10-10'),null);});
test('daily verses stay stable on a calendar day and cycle through sourced full verses',()=>{const same=content.verseForDay('2026-10-08');assert.equal(content.verseForDay('2026-10-08').key,same.key);assert.notEqual(content.verseForDay('2026-10-09').key,same.key);assert.equal(new Set(Array.from({length:6},(_,n)=>content.verseForDay(`2026-10-${String(n+8).padStart(2,'0')}`).key)).size,6);assert.ok(content.DAILY_VERSES.every(v=>/^\d+:\d+$/.test(v.key)&&v.text&&v.meaning));});

test('offline cache carries verified tomorrow into today at midnight without inventing another day',()=>{const f=storageFixture();f.storage.savePrayerCache('a',config,'2026-10-08',schedule());const carried=f.storage.readPrayerCache('a',config,'2026-10-09');assert.equal(carried.today.date,'2026-10-09');assert.equal(carried.tomorrow.complete,false);assert.equal(carried.tomorrow.timings.Fajr,null);assert.equal(prayers.upcomingPrayer(carried,Date.parse('2026-10-09T13:00:00+02:00')).key,'Asr');assert.equal(prayers.upcomingPrayer(carried,Date.parse('2026-10-09T23:00:00+02:00')),null);});
