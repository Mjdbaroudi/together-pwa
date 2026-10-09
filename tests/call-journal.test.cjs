const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load-ts.cjs');
const journal=load('lib/calls/journal.ts'),store=load('lib/together/messageStore.ts'),mapper=load('lib/together/mappers.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const call={id:id(10),couple_id:id(20),caller_id:id(1),callee_id:id(2),state:'ended',created_at:'2026-10-07T12:00:00Z',accepted_at:'2026-10-07T12:00:05Z',started_at:'2026-10-07T12:00:06Z',ended_at:'2026-10-07T12:01:11Z',updated_at:'2026-10-07T12:01:11Z'};
test('call summaries reject malformed state, identity and timestamps, without exposing extra fields',()=>{
 for(const bad of [null,[],{}, {...call,state:'forged'},{...call,caller_id:call.callee_id},{...call,ended_at:'bad'},{...call,updated_at:null},{...call,id:'foreign'}])assert.equal(journal.parseCallSummary(bad),undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(journal.parseCallSummary({...call,credential:'secret',sdp:'private'}))),{...call,media_kind:'audio'});
});
test('call labels distinguish viewer, missed, cancelled, declined and connection failure',()=>{
 assert.equal(journal.callLabel({...call,state:'missed'},id(2)),'Missed voice call');assert.equal(journal.callLabel({...call,state:'missed'},id(1)),'No answer');
 assert.equal(journal.callLabel({...call,state:'declined'},id(2)),'Call declined by you');assert.equal(journal.callLabel({...call,state:'cancelled'},id(2)),'Cancelled incoming call');assert.equal(journal.callLabel({...call,state:'failed',started_at:null},id(2)),'Call could not connect');assert.equal(journal.callLabel({...call,state:'failed'},id(2)),'Call disconnected');
});
test('duration counts connected time only and cannot become invalid or negative',()=>{
 assert.equal(journal.callRecordedDuration(call),'01:05');assert.equal(journal.callRecordedDuration({...call,started_at:null}),null);assert.equal(journal.callRecordedDuration({...call,ended_at:null}),null);assert.equal(journal.callRecordedDuration({...call,ended_at:'2026-10-07T11:00:00Z'}),'00:00');assert.equal(journal.callRecordedDuration({...call,ended_at:'bad'}),null);
});
test('video kind is validated, legacy summaries remain audio and labels expose video',()=>{
 assert.equal(journal.parseCallSummary(call).media_kind,'audio');
 assert.equal(journal.parseCallSummary({...call,media_kind:'video'}).media_kind,'video');
 assert.equal(journal.parseCallSummary({...call,media_kind:'screen'}),undefined);
 assert.equal(journal.callLabel({...call,media_kind:'video'},id(1)),'Outgoing video call');
 assert.equal(journal.callLabel({...call,media_kind:'video',state:'missed'},id(2)),'Missed video call');
});
test('late ringing insert or reconnect snapshots cannot roll an ended call backwards',()=>{
 const ended={id:id(30),sender:'me',type:'call',createdAt:call.created_at,callSummary:call},old={...ended,callSummary:{...call,state:'ringing',started_at:null,ended_at:null,updated_at:call.created_at}};
 assert.equal(store.upsertMessage([ended],old)[0].callSummary.state,'ended');assert.equal(store.mergeMessageGroups([ended],[old])[0].callSummary.state,'ended');assert.equal(store.upsertMessage([old],ended).length,1);
 const precise={...call,updated_at:'2026-10-07T12:01:11.123456Z'},late={...call,updated_at:'2026-10-07T12:01:11.123455Z'};assert.equal(journal.latestCallSummary(precise,late).updated_at,precise.updated_at);assert.equal(journal.latestCallSummary(call,{...call,state:'active',updated_at:'2026-10-07T12:02:00Z'}).state,'ended');
 const mapped=mapper.mapMessage({id:id(30),sender_id:id(1),type:'call',created_at:call.created_at,call_summary:call},id(2));assert.equal(mapped.sender,'partner');assert.equal(mapped.callSummary.state,'ended');
});
