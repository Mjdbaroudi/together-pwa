const test = require('node:test'), assert = require('node:assert/strict');
const {load} = require('./load-ts.cjs');
const {todayOccasions, claimDailyCelebration} = load('lib/celebration.ts');
const profile = {anniversary: '2024-07-14', storyPhotoPath: 'pair/a/story/photo.jpg'};
const date = (id, day, repeatsYearly = true) => ({id, title: id, kind: 'milestone', specialType: 'engagement', localDate: day, date: day + 'T12:00:00Z', repeatsYearly});

test('today surfaces matching occasions beyond the first three without changing original chronology', () => {
 const dates = [date('a','2020-01-01'),date('b','2021-02-02'),date('c','2022-03-03'),{...date('d','2024-10-08'),photoPath:'pair/a/dates/d.jpg'},date('e','2025-10-08')];
 const before = JSON.stringify(dates), result = todayOccasions(dates, profile, '2026-10-08');
 assert.deepEqual(Array.from(result, item => [item.id,item.years,item.photoPath]), [['d',2,'pair/a/dates/d.jpg'],['e',1,undefined]]);
 assert.equal(JSON.stringify(dates), before);
});
test('future, expired one-off, invalid dates and ordinary plans do not invent celebrations', () => {
 assert.equal(todayOccasions([date('future','2028-10-08'),date('past','2024-10-08',false),date('bad','2026-02-30'),{id:'plan',kind:'date',date:'2026-10-08T12:00:00Z'}],profile,'2026-10-08').length,0);
 assert.equal(todayOccasions([date('today','2026-10-08',false)],profile,'2026-10-08')[0].years,0);
 assert.equal(todayOccasions([date('a','2024-10-08')],profile,'invalid').length,0);
});
test('story anniversary is included when needed and does not duplicate the same saved original day', () => {
 const result = todayOccasions([],profile,'2026-07-14');
 assert.equal(result[0].story,true); assert.equal(result[0].years,2); assert.equal(result[0].photoPath,profile.storyPhotoPath);
 const saved = todayOccasions([date('synthetic anniversary','2024-07-14')],profile,'2026-07-14');
 assert.equal(saved.length,1); assert.equal(saved[0].id,'synthetic anniversary');
 assert.equal(todayOccasions([],profile,'2026-07-15').length,0);
});
test('leap anniversaries use February 28 in non-leap years and return on February 29 in leap years', () => {
 const dates = [date('leap','2024-02-29')];
 assert.equal(todayOccasions(dates,{},'2025-02-28')[0].years,1);
 assert.equal(todayOccasions(dates,{},'2028-02-28').length,0);
 assert.equal(todayOccasions(dates,{},'2028-02-29')[0].years,4);
});
test('each local calendar day resolves independently for partners in different timezones', () => {
 const dates = [date('d','2024-10-09')];
 assert.equal(todayOccasions(dates,{},'2026-10-08').length,0);
 assert.equal(todayOccasions(dates,{},'2026-10-09').length,1);
});
test('animation claim persists once per account and pair per day, with next-day renewal', () => {
 const data = new Map(), storage = {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 assert.equal(claimDailyCelebration(storage,'u1','c1','2026-10-08'),true);
 assert.equal(claimDailyCelebration(storage,'u1','c1','2026-10-08'),false);
 assert.equal(claimDailyCelebration(storage,'u2','c1','2026-10-08'),true);
 assert.equal(claimDailyCelebration(storage,'u1','c2','2026-10-08'),true);
 assert.equal(claimDailyCelebration(storage,'u1','c1','2026-10-09'),true);
 assert.equal(claimDailyCelebration(storage,'','c1','2026-10-09'),false);
 const fresh = load('lib/celebration.ts');
 assert.equal(fresh.claimDailyCelebration(storage,'u1','c1','2026-10-09'),false);
});
test('blocked persistence does not crash or repeatedly animate in the same tab', () => {
 const storage = {getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');}};
 assert.equal(claimDailyCelebration(storage,'blocked-user','pair','2026-10-08'),true);
 assert.equal(claimDailyCelebration(storage,'blocked-user','pair','2026-10-08'),false);
 assert.equal(claimDailyCelebration(undefined,'unavailable','pair','2026-10-08'),true);
 assert.equal(claimDailyCelebration(undefined,'unavailable','pair','2026-10-08'),false);
});
