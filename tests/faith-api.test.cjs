const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
class ServerError extends Error{constructor(message,status){super(message);this.status=status;}}
const params={date:'2026-10-08',latitude:'48.8566',longitude:'2.3522',timezone:'Europe/Paris',method:'3',school:'0',highLatitude:'3'};
const DateFixed=class extends Date{static now(){return Date.parse('2026-10-08T12:00:00Z');}};
function fixture({authStatus,providerStatus=200,wrongLocation=false}={}){
 const requests=[];
 const route=load('app/api/faith/prayers/route.ts',{URL,AbortSignal,Date:DateFixed,fetch:async(url,options)=>{
  requests.push({url:new URL(url),options});const date=url.pathname.split('/').at(-1).split('-').reverse().join('-'),dd=url.pathname.split('/').at(-1);
  const body={code:200,data:{date:{gregorian:{date:dd}},meta:{latitude:wrongLocation?0:48.8566,longitude:2.3522,timezone:'Europe/Paris',method:{id:3},school:'STANDARD',latitudeAdjustmentMethod:'ANGLE_BASED'},timings:Object.fromEntries(Object.entries({Fajr:'04:28',Sunrise:'07:07',Dhuhr:'12:26',Asr:'14:54',Maghrib:'17:44',Isha:'20:13'}).map(([key,value])=>[key,`${date}T${value}:00+02:00`]))}};
  return new Response(JSON.stringify(body),{status:providerStatus});
 }},{'next/server':{NextResponse:{json:(value,options)=>new Response(JSON.stringify(value),{...options,headers:{...options.headers,'Content-Type':'application/json'}})}},'@/lib/calls/server':{CallServerError:ServerError,authenticateCall:async()=>{if(authStatus)throw new ServerError('auth rejected',authStatus);return {userId:'a'};}}});
 return {route,requests,request:patch=>new Request('https://together.example/api/faith/prayers?'+new URLSearchParams({...params,...patch}))};
}
test('prayer API rejects unauthenticated requests before contacting provider',async()=>{const f=fixture({authStatus:401}),result=await f.route.GET(f.request());assert.equal(result.status,401);assert.equal(f.requests.length,0);});
test('prayer API rejects invalid coordinates, timezone and dates without provider calls',async()=>{for(const patch of [{latitude:'91'},{longitude:'999'},{timezone:'bad'},{method:'99'},{date:'2026-02-30'},{date:'2027-01-01'}]){const f=fixture(),result=await f.route.GET(f.request(patch));assert.equal(result.status,400);assert.equal(f.requests.length,0);}});
test('prayer API fetches today and tomorrow from fixed provider with selected options and no auth-token forwarding',async()=>{const f=fixture(),response=await f.route.GET(f.request());assert.equal(response.status,200);const data=await response.json();assert.equal(data.today.date,'2026-10-08');assert.equal(data.tomorrow.date,'2026-10-09');assert.equal(data.today.complete,true);assert.equal(f.requests.length,2);for(const request of f.requests){assert.equal(request.url.origin,'https://api.aladhan.com');assert.equal(request.url.searchParams.get('iso8601'),'true');assert.equal(request.url.searchParams.get('latitudeAdjustmentMethod'),'3');assert.equal(request.url.searchParams.get('timezonestring'),'Europe/Paris');assert.equal(request.options.headers,undefined);assert.equal(request.options.next.revalidate,21600);}assert.match(response.headers.get('cache-control'),/private/);});
test('prayer API returns an honest unavailable state when provider is down or returns another location',async()=>{for(const options of [{providerStatus:503},{wrongLocation:true}]){const f=fixture(options),response=await f.route.GET(f.request());assert.equal(response.status,503);assert.equal((await response.json()).today,undefined);}});
