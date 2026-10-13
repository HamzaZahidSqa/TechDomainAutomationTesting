// Checklist 10% — Area 03: Notifications API (§1.3 read / read-all / counts; §1.1 pipeline facts that are visible from the API)
// Accounts: TechDomain User (CLIENT owner), Customer, Individual Engineer.
const { test } = require('@playwright/test');
const L = require('./_lib');

test.setTimeout(600_000);

const shapeOk = (j) => j && Array.isArray(j.data) && 'nextCursor' in j && 'unreadNotificationCount' in j;
// API wraps payloads as {data: <payload>, message}; unwrap to the payload (object or array)
const un = (r) => { const j = r?.json; if (j && j.data !== undefined && 'message' in j) return j.data; return j; };
const arrOf = (r) => { const d = un(r); return Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []); };

test('CL-03 Notifications API', async ({ }, testInfo) => {
  const S = new L.Suite('03-NotificationsAPI', 'Notifications API (§1.3)', testInfo);
  const anon = await L.api();

  // ---------- unauthenticated ----------
  for (const [id, m, p] of [['NA-N01', 'GET', '/notifications'], ['NA-N02', 'GET', '/notifications/messages'], ['NA-N03', 'GET', '/notifications/others'], ['NA-N04', 'GET', '/notifications/chat'], ['NA-N05', 'PATCH', '/notifications/readAll'], ['NA-N06', 'PATCH', '/notifications/read/1']]) {
    await L.step(S, id, p, 'negative', '§1.3', async () => {
      const r = await L.call(anon, m, p);
      S.add({ id, title: `${m} ${p} without token → 401`, type: 'negative', ref: '§1.3 endpoints are JWT protected', expected: 'HTTP 401', actual: `HTTP ${r.status}`, ok: r.status === 401 });
    });
  }

  const client = await L.session(L.byRole('TechDomain User'));
  const customer = await L.session(L.byRole('Customer'));
  const G = (s, p) => L.call(s.ctx, 'GET', p);

  // ---------- GET /notifications ----------
  let all = null;
  await L.step(S, 'NA-P01', 'list', 'positive', '§1.3 GET /notifications', async () => {
    const r = await G(client, '/notifications'); all = r.json;
    const arr = arrOf(r);
    S.add({ id: 'NA-P01', title: 'GET /notifications returns the full list (not paginated)', type: 'positive', ref: '§1.3 GET /notifications returns MESSAGE … followed by all non-MESSAGE, not paginated', expected: 'HTTP 200 + array', actual: `HTTP ${r.status} items=${arr.length}`, ok: r.status === 200 && Array.isArray(arr) });
    const types = arr.map((n) => n.type);
    const lastMsg = types.lastIndexOf('MESSAGE'); const firstOther = types.findIndex((t) => t !== 'MESSAGE');
    S.add({ id: 'NA-P02', title: 'MESSAGE notifications come first, then the rest', type: 'positive', ref: '§1.3 ordering', expected: 'all MESSAGE before non-MESSAGE', actual: `lastMessageIdx=${lastMsg} firstOtherIdx=${firstOther} (n=${arr.length})`, ok: arr.length === 0 || lastMsg === -1 || firstOther === -1 || lastMsg < firstOther });
    const sample = arr[0] || {};
    S.add({ id: 'NA-P03', title: 'Each notification has id/type/title/content/url/isRead/createdAt', type: 'positive', ref: '§1.1 Notification row fields', expected: 'fields present', actual: `keys=${Object.keys(sample).slice(0, 14).join(',')}`, ok: arr.length === 0 || ['id', 'type', 'title', 'content', 'isRead', 'createdAt'].every((k) => k in sample), note: arr.length === 0 ? 'no notifications on this account' : '' });
    const leak = arr.some((n) => n.receiver && 'deviceToken' in n.receiver);
    S.add({ id: 'NA-E01', title: 'List does not expose receiver.deviceToken', type: 'edge', ref: '§1.1 [BUG?] socket payload includes receiver.deviceToken', expected: 'no deviceToken in REST list', actual: leak ? 'deviceToken present' : 'absent', ok: !leak });
    const self = arr.filter((n) => n.senderId && n.senderId === client.user.id).length;
    S.add({ id: 'NA-E02', title: 'User never receives a notification about their own action (senderId ≠ me)', type: 'edge', ref: '§1.1 sender removed from recipientIds', expected: '0 self-sent', actual: `self-sent=${self} of ${arr.length}`, ok: self === 0 });
  });

  // ---------- /messages and /others: shape + BVA on limit/cursor ----------
  for (const ep of ['messages', 'others']) {
    await L.step(S, `NM-${ep}`, ep, 'positive', `§1.3 GET /notifications/${ep}`, async () => {
      const base = await G(client, `/notifications/${ep}`); const bj = un(base);
      // /messages is paginated by chat ROOM (limit = rooms), /others by notification (limit = items)
      const units = (j) => (ep === 'messages' ? new Set((j?.data || []).map((x) => x.chatRoomId ?? x.conversationId ?? x.workOrderId)).size : (j?.data || []).length);
      S.add({ id: `NB-P01-${ep}`, title: `GET /notifications/${ep} default returns {data, nextCursor, unreadNotificationCount}`, type: 'positive', ref: `§1.3 GET /notifications/${ep}?cursor&limit=10`, expected: `shape + ≤10 ${ep === 'messages' ? 'rooms' : 'items'}`, actual: `HTTP ${base.status} keys=${Object.keys(bj || {}).join(',')} items=${bj?.data?.length} units=${units(bj)}`, ok: base.status === 200 && shapeOk(bj) && units(bj) <= 10 });
      const bva = [['0', [200, 400], 'limit=0'], ['1', [200], 'limit=1 → 1 item'], ['10', [200], 'limit=10 (default)'], ['11', [200, 400], 'limit=11'], ['100', [200, 400], 'limit=100'], ['101', [200, 400], 'limit=101'], ['-1', [200, 400], 'limit=-1'], ['abc', [200, 400], 'limit=abc'], ['1.5', [200, 400], 'limit=1.5']];
      for (const [lim, okS, name] of bva) {
        const r = await G(client, `/notifications/${ep}?limit=${lim}`); const rj = un(r);
        const n = units(rj); const num = Number(lim);
        let good = okS.includes(r.status) && (r.status !== 200 || shapeOk(rj));
        let note = '';
        if (r.status === 200 && Number.isInteger(num) && num > 0) { good = good && n <= num; if (lim === '1' && n !== 1 && units(bj) > 0) { good = false; } }
        if (r.status === 200 && (num <= 0 || Number.isNaN(num))) note = `server accepted ${name} and returned ${n} items (should probably be 400 or default 10)`;
        if (r.status === 500) note = 'SERVER ERROR 500';
        S.add({ id: `NB-B-${ep}-${lim}`, title: `GET /notifications/${ep} ${name}`, type: 'bva', ref: '§1.3 limit param', expected: `HTTP ${okS.join('/')}; ${ep === 'messages' ? 'rooms' : 'items'} ≤ limit`, actual: `HTTP ${r.status} ${ep === 'messages' ? 'rooms' : 'items'}=${n} (${rj?.data?.length} notifications)`, ok: good && r.status !== 500, note });
      }
      for (const [cur, name] of [['abc', 'cursor=abc'], ['0', 'cursor=0'], ['-5', 'cursor=-5'], ['999999999', 'cursor=huge']]) {
        const r = await G(client, `/notifications/${ep}?cursor=${cur}&limit=5`);
        S.add({ id: `NB-C-${ep}-${cur}`, title: `GET /notifications/${ep} ${name}`, type: 'edge', ref: '§1.3 cursor param', expected: 'HTTP 200 (empty or page) or 400, never 500', actual: `HTTP ${r.status} items=${un(r)?.data?.length}`, ok: [200, 400].includes(r.status), note: r.status === 500 ? 'SERVER ERROR 500' : '' });
      }
      // pagination walk
      if (bj?.nextCursor) {
        const r2 = await G(client, `/notifications/${ep}?cursor=${bj.nextCursor}&limit=10`); const r2j = un(r2);
        const ids1 = new Set((bj.data || []).map((x) => x.id)); const dup = (r2j?.data || []).filter((x) => ids1.has(x.id)).length;
        S.add({ id: `NB-P02-${ep}`, title: `Second page via nextCursor has no overlap with page 1 (${ep})`, type: 'positive', ref: '§1.3 cursor pagination', expected: '0 duplicates', actual: `HTTP ${r2.status} dup=${dup} n=${r2j?.data?.length}`, ok: r2.status === 200 && dup === 0 });
      }
    });
  }

  // ---------- /chat ----------
  await L.step(S, 'NC-P01', 'chat', 'positive', '§1.3 GET /notifications/chat', async () => {
    const r = await G(client, '/notifications/chat');
    const arr = arrOf(r);
    S.add({ id: 'NC-P01', title: 'GET /notifications/chat returns unread MESSAGE notifications only', type: 'positive', ref: '§1.3 GET /notifications/chat', expected: 'HTTP 200; every item type=MESSAGE & isRead=false', actual: `HTTP ${r.status} n=${arr.length} badTypes=${arr.filter((x) => x.type !== 'MESSAGE').length} read=${arr.filter((x) => x.isRead).length}`, ok: r.status === 200 && arr.every((x) => x.type === 'MESSAGE' && !x.isRead) });
  });

  // ---------- read one ----------
  await L.step(S, 'NR', 'read one', 'positive', '§1.3 PATCH /notifications/read/:id', async () => {
    const list = await G(client, '/notifications/others?limit=10');
    const mine = (un(list)?.data || [])[0];
    if (mine) {
      const r = await L.call(client.ctx, 'PATCH', `/notifications/read/${mine.id}`);
      S.add({ id: 'NR-P01', title: 'Mark own notification read', type: 'positive', ref: '§1.3 PATCH /notifications/read/:id', expected: 'HTTP 200 + isRead true', actual: `HTTP ${r.status} isRead=${r.json?.isRead ?? r.json?.data?.isRead}`, ok: r.status === 200 });
      const again = await L.call(client.ctx, 'PATCH', `/notifications/read/${mine.id}`);
      S.add({ id: 'NR-E01', title: 'Marking the same notification read twice is idempotent', type: 'edge', ref: '§1.3', expected: 'HTTP 200', actual: `HTTP ${again.status}`, ok: again.status === 200 });
      const other = await L.call(customer.ctx, 'PATCH', `/notifications/read/${mine.id}`);
      S.add({ id: 'NR-N01', title: "Marking ANOTHER user's notification read is refused with 404/403 (not 500)", type: 'negative', ref: '§1.3 [BUG?] another user\'s id makes Prisma update throw (500) instead of 404', expected: 'HTTP 403/404', actual: `HTTP ${other.status} msg="${L.msg(other)}"`, ok: [403, 404].includes(other.status), note: other.status === 500 ? 'CONFIRMED BUG: 500 Internal Server Error' : '' });
    } else S.add({ id: 'NR-P01', title: 'Mark own notification read', type: 'positive', ref: '§1.3', expected: 'a notification exists', actual: 'client has no non-MESSAGE notifications', ok: false, note: 'no data to test' });
    for (const [id, v, name] of [['NR-B01', '0', 'id=0'], ['NR-B02', '-1', 'id=-1'], ['NR-B03', 'abc', 'id=abc'], ['NR-B04', '999999999', 'id=999999999 (missing)'], ['NR-B05', '1.5', 'id=1.5'], ['NR-B06', '9999999999999999999', 'id beyond int range']]) {
      const r = await L.call(client.ctx, 'PATCH', `/notifications/read/${v}`);
      S.add({ id, title: `PATCH /notifications/read/${v} (${name})`, type: 'bva', ref: '§1.3 read/:id validation', expected: 'HTTP 400/404 (never 500)', actual: `HTTP ${r.status} msg="${L.msg(r)}"`, ok: [400, 404].includes(r.status), note: r.status === 500 ? 'SERVER ERROR 500' : '' });
    }
  });

  // ---------- readAll ----------
  await L.step(S, 'NRA', 'readAll', 'positive', '§1.3 PATCH /notifications/readAll', async () => {
    const r = await L.call(client.ctx, 'PATCH', '/notifications/readAll');
    S.add({ id: 'NRA-P01', title: 'PATCH /notifications/readAll returns {message, count}', type: 'positive', ref: '§1.3 readAll marks all non-MESSAGE read and returns {message,count}', expected: 'HTTP 200 + count number', actual: `HTTP ${r.status} body=${r.text.slice(0, 120)}`, ok: r.status === 200 && typeof r.json?.count === 'number' });
    const o = await G(client, '/notifications/others?limit=10'); const oj = un(o);
    S.add({ id: 'NRA-P02', title: 'After readAll the non-MESSAGE unread count is 0', type: 'positive', ref: '§1.3 others.unreadNotificationCount', expected: '0', actual: String(oj?.unreadNotificationCount), ok: oj?.unreadNotificationCount === 0 });
    const r2 = await L.call(client.ctx, 'PATCH', '/notifications/readAll');
    S.add({ id: 'NRA-E01', title: 'readAll again → count 0 (idempotent)', type: 'edge', ref: '§1.3', expected: 'HTTP 200, count 0', actual: `HTTP ${r2.status} count=${r2.json?.count}`, ok: r2.status === 200 && r2.json?.count === 0 });
    const m = await L.call(client.ctx, 'PATCH', '/notifications/messages/readAll');
    S.add({ id: 'NRA-P03', title: 'PATCH /notifications/messages/readAll marks MESSAGE notifications read', type: 'positive', ref: '§1.3 messages/readAll', expected: 'HTTP 200', actual: `HTTP ${m.status} body=${m.text.slice(0, 100)}`, ok: m.status === 200 });
    const c = await G(client, '/notifications/chat'); const arr = arrOf(c);
    S.add({ id: 'NRA-P04', title: 'After messages/readAll, /notifications/chat is empty', type: 'positive', ref: '§1.3', expected: '0 unread MESSAGE', actual: `n=${arr.length}`, ok: arr.length === 0 });
    for (const [id, v, name, okS] of [['NRM-N01', 'undefined', 'chatroomId=undefined (FE bug value → NaN)', [400, 404]], ['NRM-B01', '0', 'chatroomId=0', [200, 400, 404]], ['NRM-B02', 'abc', 'chatroomId=abc', [400, 404]], ['NRM-B03', '999999999', 'chatroomId missing', [200, 404]], ['NRM-B04', '-1', 'chatroomId=-1', [200, 400, 404]]]) {
      const r = await L.call(client.ctx, 'PATCH', `/notifications/messages/readAll/${v}`);
      S.add({ id, title: `PATCH /notifications/messages/readAll/${v} (${name})`, type: id.includes('-N') ? 'negative' : 'bva', ref: '§1.3 [BUG?] FE sends readAll/undefined → NaN', expected: `HTTP ${okS.join('/')}, never 500`, actual: `HTTP ${r.status} msg="${L.msg(r)}"`, ok: okS.includes(r.status), note: r.status === 500 ? 'SERVER ERROR 500 — confirms the NaN bug path' : '' });
    }
  });

  // ---------- no delete endpoint ----------
  await L.step(S, 'ND', 'delete', 'negative', '§1.3 no delete endpoint', async () => {
    const r = await L.call(client.ctx, 'DELETE', '/notifications/1');
    const r2 = await L.call(client.ctx, 'DELETE', '/notifications');
    S.add({ id: 'ND-N01', title: 'DELETE /notifications/:id does not exist (404)', type: 'negative', ref: '§1.3 There is no delete endpoint for notifications', expected: 'HTTP 404/405', actual: `HTTP ${r.status} / ${r2.status}`, ok: [404, 405].includes(r.status) && [404, 405].includes(r2.status) });
  });

  // ---------- customer scoping ----------
  await L.step(S, 'NS', 'customer', 'positive', '§1.3 / §1.2 customer copy', async () => {
    const r = await G(customer, '/notifications/others?limit=10');
    const arr = un(r)?.data || [];
    const wrongUrl = arr.filter((n) => /\/workOrder\/details\//.test(n.url || '') && !/fromCustomerBoard=true/.test(n.url)).length;
    S.add({ id: 'NS-P01', title: 'Customer work-order notifications carry ?fromCustomerBoard=true', type: 'positive', ref: '§1.2 "Customer copy" URL /workOrder/details/:id?fromCustomerBoard=true', expected: 'all WO urls have fromCustomerBoard=true', actual: `n=${arr.length} without flag=${wrongUrl}`, ok: wrongUrl === 0, note: arr.length === 0 ? 'customer has no notifications' : '' });
    const other = await G(customer, '/notifications/messages?limit=5');
    S.add({ id: 'NS-P02', title: 'Customer can list message notifications (shape ok)', type: 'positive', ref: '§1.3 /messages for CUSTOMER', expected: 'HTTP 200 shape', actual: `HTTP ${other.status} keys=${Object.keys(un(other) || {}).join(',')}`, ok: other.status === 200 && shapeOk(un(other)) });
  });

  // ---------- device token ----------
  await L.step(S, 'NT', 'deviceToken', 'negative', '§1.1 PATCH /users/deviceToken', async () => {
    const r = await L.call(client.ctx, 'PATCH', '/users/deviceToken', {});
    S.add({ id: 'NT-N01', title: 'PATCH /users/deviceToken with empty body is rejected', type: 'negative', ref: '§1.1 device token is set through PATCH /users/deviceToken {deviceToken}', expected: 'HTTP 400', actual: `HTTP ${r.status} msg="${L.msg(r)}"`, ok: [400, 422].includes(r.status), note: r.status === 200 ? 'accepts empty body (clears token?) — informational' : '' });
    const r2 = await L.call(anon, 'PATCH', '/users/deviceToken', { deviceToken: 'x' });
    S.add({ id: 'NT-N02', title: 'PATCH /users/deviceToken without token → 401', type: 'negative', ref: '§1.1', expected: 'HTTP 401', actual: `HTTP ${r2.status}`, ok: r2.status === 401 });
  });

  await client.ctx.dispose(); await customer.ctx.dispose(); await anon.dispose();
  S.save();
});
