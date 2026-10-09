const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load-ts.cjs');
const messageId = '00000000-0000-4000-8000-000000000980';
function fixture({ subscriptions = [], dbStatus = 200, configured = true } = {}) {
  const requests = [], deliveries = [];
  const { POST } = load('app/api/push/send/route.ts', {
    fetch: async (url, options) => { requests.push({ url, ...options }); return new Response(JSON.stringify(subscriptions), { status: dbStatus }); },
  }, { '@/lib/push/server': {
    configureWebPush: () => ({ ok: configured, error: 'Not configured', vapid: { diagnostics: {} } }),
    getSupabaseRestConfig: () => ({ url: 'https://fixture.invalid', key: 'public-key' }),
    deliverPush: async (...args) => { deliveries.push(args); return { delivered: args[0].length, removed: 0, failed: 0 }; },
  } });
  const send = (body = { messageId }, authorized = true) => POST(new Request('https://fixture.invalid/api/push/send', {
    method: 'POST', headers: authorized ? { Authorization: 'Bearer sender-token' } : {}, ...(body === null ? {} : { body: JSON.stringify(body) }),
  }));
  return { send, requests, deliveries };
}
test('message push uses authenticated unread-message RPC and short delivery lifetime', async () => {
  const f = fixture({ subscriptions: [{ endpoint: 'phone', p256dh: 'key', auth: 'auth' }] });
  const response = await f.send();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).delivered, 1);
  assert.match(f.requests[0].url, /\/get_message_push_subscriptions$/);
  assert.deepEqual(JSON.parse(f.requests[0].body), { p_message: messageId });
  assert.equal(f.requests[0].headers.Authorization, 'Bearer sender-token');
  assert.equal(f.requests[0].cache, 'no-store');
  assert.equal(f.deliveries[0][2].TTL, 30);
});
test('active chat or read-message suppression is successful and delivers to no endpoints', async () => {
  const f = fixture();
  const response = await f.send();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(f.deliveries[0][0].length, 0);
  assert.equal(f.requests.length, 1);
});
test('older sender clients still use the database-filtered partner RPC', async () => {
  const f = fixture();
  assert.equal((await f.send(null)).status, 200);
  assert.match(f.requests[0].url, /\/get_partner_push_subscriptions$/);
  assert.equal(f.requests[0].body, '{}');
});
test('missing authorization or invalid message identity never reaches push transport', async () => {
  const f = fixture();
  assert.equal((await f.send({ messageId }, false)).status, 401);
  for (const bad of ['not-a-message', 42, null, {}]) assert.equal((await f.send({ messageId: bad })).status, 400);
  assert.equal(f.requests.length, 0);
  assert.equal(f.deliveries.length, 0);
});
test('database authorization and migration failures never bypass suppression', async () => {
  for (const status of [401, 403, 404, 500]) {
    const f = fixture({ dbStatus: status });
    assert.equal((await f.send()).status, status < 404 ? 401 : 503);
    assert.equal(f.requests.length, 1);
    assert.equal(f.deliveries.length, 0);
  }
});
test('invalid VAPID configuration does not call the database or deliver push', async () => {
  const f = fixture({ configured: false });
  assert.equal((await f.send()).status, 503);
  assert.equal(f.requests.length, 0);
  assert.equal(f.deliveries.length, 0);
});
