// Checklist 10% — Area 04: Chat & inbox rules (§4) through the REST API
// Pair: Vendor Engineer (611, sender) and Vendor owner (609, reader) share engineer rooms; Customer (617) and Individual Engineer
// (575) are used as non-participants. Messages sent are tagged "[CL-04 <run>]".
const { test } = require('@playwright/test');
const L = require('./_lib');

test.setTimeout(600_000);

test('CL-04 Chat & inbox API', async ({ }, testInfo) => {
  const S = new L.Suite('04-ChatAPI', 'Chat & inbox rules (§4)', testInfo);
  const anon = await L.api();
  const sender = await L.session(L.byRole('Vendor Engineer'));
  const owner = await L.session(L.byRole('Vendor'));
  const outsider = await L.session(L.byRole('Customer'));
  const eng = await L.session(L.byRole('Individual Engineer'));
  const G = (s, p) => L.call(s.ctx, 'GET', p);

  // ---------- unauthenticated ----------
  for (const [id, m, p] of [['CH-N01', 'GET', '/inbox'], ['CH-N02', 'GET', '/chats/1'], ['CH-N03', 'GET', '/chats/users/1/1'], ['CH-N04', 'POST', '/inbox/1/message'], ['CH-N05', 'PATCH', '/inbox/readAll']]) {
    await L.step(S, id, p, 'negative', '§4 JWT', async () => {
      const r = await L.call(anon, m, p, m === 'POST' ? { message: 'x' } : undefined);
      S.add({ id, title: `${m} ${p} without token → 401`, type: 'negative', ref: '§4 Mobile inbox (JWT)', expected: 'HTTP 401', actual: `HTTP ${r.status}`, ok: r.status === 401 });
    });
  }

  // ---------- GET /chats/users ----------
  await L.step(S, 'CU', 'chats/users', 'edge', '§4 GET /chats/users/:workOrderId/:companyId', async () => {
    for (const [id, p, name] of [['CU-E01', '/chats/users/abc/xyz', 'non-integer params'], ['CU-E02', '/chats/users/0/0', 'zeros'], ['CU-E03', '/chats/users/-1/-1', 'negatives'], ['CU-E04', '/chats/users/999999999/999999999', 'missing ids']]) {
      const r = await G(owner, p);
      const arr = Array.isArray(r.json) ? r.json : r.json?.data;
      S.add({ id, title: `GET ${p} (${name}) → empty list, never 500`, type: 'bva', ref: '§4 Non-integer params return []', expected: 'HTTP 200 + [] (or 400)', actual: `HTTP ${r.status} body=${r.text.slice(0, 80)}`, ok: (r.status === 200 && Array.isArray(arr) && arr.length === 0) || r.status === 400, note: r.status === 500 ? 'SERVER ERROR 500' : '' });
    }
  });

  // ---------- inbox listing + BVA ----------
  let conv = null;
  await L.step(S, 'IN', 'inbox', 'positive', '§4 GET /inbox', async () => {
    const r = await G(sender, '/inbox');
    const j = r.json || {};
    S.add({ id: 'IN-P01', title: 'GET /inbox returns {data, nextCursor, totalUnreadCount, unreadConversationCount}', type: 'positive', ref: '§4 GET /inbox?limit&cursor: default 20, maximum 50', expected: 'shape + ≤20 rows', actual: `HTTP ${r.status} keys=${Object.keys(j).join(',')} n=${j.data?.length}`, ok: r.status === 200 && Array.isArray(j.data) && 'totalUnreadCount' in j && 'unreadConversationCount' in j && j.data.length <= 20 });
    conv = (j.data || []).find((c) => c.chatRoomId && !c.isDisabled) || (j.data || [])[0];
    const row = conv || {};
    S.add({ id: 'IN-P02', title: 'Conversation row has conversationId/chatRoomId/workOrder/participant/latestMessage/unreadCount', type: 'positive', ref: '§4 Conversation row fields', expected: 'fields present', actual: `keys=${Object.keys(row).join(',')}`, ok: !!conv && ['conversationId', 'chatRoomId', 'workOrder', 'participant', 'latestMessage', 'unreadCount'].every((k) => k in row), note: conv ? '' : 'sender has no conversations' });
    const prev = row.latestMessage?.preview || '';
    S.add({ id: 'IN-P03', title: 'Preview text starts with "You: " or "<FirstName>: "', type: 'positive', ref: '§4 Preview text: You: … or {senderFirstName}: …', expected: 'prefix', actual: prev.slice(0, 60), ok: /^(You|[A-Za-z]+): /.test(prev), note: prev ? '' : 'no preview' });
    S.add({ id: 'IN-P04', title: 'Only rooms with at least one message are listed', type: 'positive', ref: '§4 only rooms with at least one message', expected: 'every row has latestMessage', actual: `rows without latestMessage=${(j.data || []).filter((c) => !c.latestMessage).length}`, ok: (j.data || []).every((c) => !!c.latestMessage) });
    const sum = (j.data || []).reduce((a, c) => a + (c.unreadCount || 0), 0);
    S.add({ id: 'IN-P05', title: 'totalUnreadCount equals the sum of row unread counts (page 1 only when no more pages)', type: 'edge', ref: '§4 totalUnreadCount (sum of counts)', expected: `${sum} (if single page)`, actual: `total=${j.totalUnreadCount} nextCursor=${j.nextCursor}`, ok: j.nextCursor ? true : j.totalUnreadCount === sum, note: j.nextCursor ? 'multi-page: not comparable' : '' });
    for (const [lim, okS, name] of [['0', [200, 400], 'limit=0'], ['1', [200], 'limit=1'], ['20', [200], 'limit=20 (default)'], ['21', [200, 400], 'limit=21'], ['50', [200], 'limit=50 (max)'], ['51', [200, 400], 'limit=51 (above max → capped or 400)'], ['-1', [200, 400], 'limit=-1'], ['abc', [200, 400], 'limit=abc']]) {
      const x = await G(sender, `/inbox?limit=${lim}`);
      const n = x.json?.data?.length; const num = Number(lim);
      let ok = okS.includes(x.status) && x.status !== 500;
      if (x.status === 200 && Number.isInteger(num) && num > 0) ok = ok && n <= Math.min(num, 50);
      S.add({ id: `IN-B-${lim}`, title: `GET /inbox ${name}`, type: 'bva', ref: '§4 default 20, maximum 50', expected: `HTTP ${okS.join('/')}, rows ≤ min(limit,50)`, actual: `HTTP ${x.status} rows=${n}`, ok, note: x.status === 500 ? 'SERVER ERROR 500' : (x.status === 200 && (num <= 0 || Number.isNaN(num)) ? `accepted ${name}, returned ${n}` : '') });
    }
    for (const [cur, name] of [['abc', 'malformed cursor'], ['!!!', 'symbols'], [Buffer.from('2020-01-01T00:00:00Z|abc').toString('base64url'), 'base64 with bad id']]) {
      const x = await G(sender, `/inbox?cursor=${encodeURIComponent(cur)}&limit=5`);
      S.add({ id: `IN-C-${name.replace(/\W/g, '')}`, title: `GET /inbox with ${name} falls back to page 1`, type: 'edge', ref: '§4 a malformed cursor falls back to page 1', expected: 'HTTP 200 + rows', actual: `HTTP ${x.status} rows=${x.json?.data?.length}`, ok: x.status === 200 && Array.isArray(x.json?.data) });
    }
  });

  if (!conv) { S.add({ id: 'IN-X', title: 'No conversation available — chat thread checks skipped', type: 'positive', ref: '§4', expected: 'conversation', actual: 'none', ok: false }); S.save(); return; }
  const roomId = conv.chatRoomId;

  // ---------- history pagination ----------
  await L.step(S, 'CHH', 'history', 'positive', '§4 GET /chats/:chatRoomId?cursor&limit', async () => {
    const r = await G(sender, `/chats/${roomId}`);
    const d = r.json?.data || r.json || {};
    S.add({ id: 'CHH-P01', title: 'GET /chats/:roomId returns {messages, nextCursor, hasMore}, default page 10', type: 'positive', ref: '§4 History: default page is 10, maximum 100', expected: 'shape + ≤10 messages ascending', actual: `HTTP ${r.status} keys=${Object.keys(d).join(',')} n=${d.messages?.length}`, ok: r.status === 200 && Array.isArray(d.messages) && d.messages.length <= 10 && 'hasMore' in d });
    const ids = (d.messages || []).map((m) => m.id);
    S.add({ id: 'CHH-P02', title: 'Messages are in ascending id order', type: 'positive', ref: '§4 messages (ascending)', expected: 'ascending', actual: ids.join(','), ok: ids.every((v, i) => i === 0 || v > ids[i - 1]) });
    for (const [lim, okS, name] of [['0', [200, 400], 'limit=0'], ['1', [200], 'limit=1'], ['100', [200], 'limit=100 (max)'], ['101', [200, 400], 'limit=101 (above max)'], ['-3', [200, 400], 'limit=-3'], ['x', [200, 400], 'limit=x']]) {
      const x = await G(sender, `/chats/${roomId}?limit=${lim}`); const dd = x.json?.data || x.json || {}; const n = dd.messages?.length; const num = Number(lim);
      let ok = okS.includes(x.status) && x.status !== 500; if (x.status === 200 && Number.isInteger(num) && num > 0) ok = ok && n <= Math.min(num, 100);
      S.add({ id: `CHH-B-${lim}`, title: `GET /chats/:roomId ${name}`, type: 'bva', ref: '§4 default 10, maximum 100', expected: `HTTP ${okS.join('/')}, n ≤ min(limit,100)`, actual: `HTTP ${x.status} n=${n}`, ok, note: x.status === 500 ? 'SERVER ERROR 500' : '' });
    }
    if (d.nextCursor && d.hasMore) {
      const x = await G(sender, `/chats/${roomId}?cursor=${d.nextCursor}&limit=10`); const dd = x.json?.data || x.json || {};
      const dup = (dd.messages || []).filter((m) => ids.includes(m.id)).length;
      S.add({ id: 'CHH-P03', title: 'Older page via nextCursor has no overlap', type: 'positive', ref: '§4 paginates by message id', expected: '0 duplicates, older ids', actual: `HTTP ${x.status} n=${dd.messages?.length} dup=${dup}`, ok: x.status === 200 && dup === 0 });
    }
    const bad = await G(sender, '/chats/abc');
    S.add({ id: 'CHH-B-abc', title: 'GET /chats/abc (non-numeric room)', type: 'bva', ref: '§4', expected: 'HTTP 400/404, never 500', actual: `HTTP ${bad.status}`, ok: [400, 404].includes(bad.status), note: bad.status === 500 ? 'SERVER ERROR 500' : '' });
    const miss = await G(sender, '/chats/999999999');
    S.add({ id: 'CHH-N01', title: 'GET /chats/999999999 (missing room)', type: 'negative', ref: '§4 read gate', expected: 'HTTP 403/404', actual: `HTTP ${miss.status}`, ok: [403, 404].includes(miss.status) });
    const out = await G(outsider, `/chats/${roomId}`);
    S.add({ id: 'CHH-N02', title: 'Non-participant (Customer) cannot read the room', type: 'negative', ref: '§4 Read gate: needs ChatRoomUser row and a live relationship', expected: 'HTTP 403', actual: `HTTP ${out.status}`, ok: [403, 404].includes(out.status) });
    const out2 = await G(eng, `/chats/${roomId}`);
    S.add({ id: 'CHH-N03', title: 'Non-participant (other engineer) cannot read the room', type: 'negative', ref: '§4 Read gate', expected: 'HTTP 403', actual: `HTTP ${out2.status}`, ok: [403, 404].includes(out2.status) });
    const own = await G(owner, `/chats/${roomId}`);
    S.add({ id: 'CHH-P04', title: 'Freelance company owner can read the member room', type: 'positive', ref: '§4 allowed: assigned freelance company owner', expected: 'HTTP 200', actual: `HTTP ${own.status}`, ok: own.status === 200 });
  });

  // ---------- inbox thread ----------
  await L.step(S, 'IT', 'thread', 'positive', '§4 GET /inbox/:id', async () => {
    const r = await G(sender, `/inbox/${conv.conversationId}?markAsRead=false&limit=5`);
    const d = r.json?.data || r.json || {};
    S.add({ id: 'IT-P01', title: 'GET /inbox/:id returns the thread with participants', type: 'positive', ref: '§4 GET /inbox/:id?limit&before&after&markAsRead', expected: 'HTTP 200 + messages + participants', actual: `HTTP ${r.status} keys=${Object.keys(d).join(',')}`, ok: r.status === 200 && (Array.isArray(d.messages) || Array.isArray(d.data)) });
    const o = await G(outsider, `/inbox/${conv.conversationId}`);
    S.add({ id: 'IT-N01', title: 'GET /inbox/:id as non-participant → 403', type: 'negative', ref: '§4 returns 403 for non-participants', expected: 'HTTP 403', actual: `HTTP ${o.status}`, ok: [403, 404].includes(o.status) });
    for (const [v, name] of [['abc', 'id=abc'], ['0', 'id=0'], ['-1', 'id=-1'], ['999999999', 'missing id']]) {
      const x = await G(sender, `/inbox/${v}`);
      S.add({ id: `IT-B-${v}`, title: `GET /inbox/${v} (${name})`, type: 'bva', ref: '§4', expected: 'HTTP 400/403/404, never 500', actual: `HTTP ${x.status}`, ok: [400, 403, 404].includes(x.status), note: x.status === 500 ? 'SERVER ERROR 500' : '' });
    }
  });

  // ---------- send message validation + idempotency ----------
  await L.step(S, 'SM', 'send', 'positive', '§4 POST /inbox/:id/message', async () => {
    const P = (s, body) => L.call(s.ctx, 'POST', `/inbox/${conv.conversationId}/message`, body);
    const tag = `[CL-04 ${L.RUN}]`;
    const neg = [
      ['SM-N01', 'empty body', {}, [400]],
      ['SM-N02', 'empty message', { message: '' }, [400]],
      ['SM-N03', 'message as number', { message: 123 }, [400]],
      ['SM-N04', 'message null', { message: null }, [400]],
      ['SM-B01', '21 digitalAssetIds (max 20)', { message: `${tag} 21 assets`, digitalAssetIds: Array.from({ length: 21 }, (_, i) => i + 1) }, [400]],
      ['SM-B02', 'clientMessageId 65 chars (max 64)', { message: `${tag} cmid65`, clientMessageId: 'c'.repeat(65) }, [400]],
      ['SM-N05', 'digitalAssetIds not an array', { message: `${tag} assets-string`, digitalAssetIds: 'abc' }, [400]],
      ['SM-N06', 'replyToId non-numeric', { message: `${tag} reply`, replyToId: 'abc' }, [400, 404]],
    ];
    for (const [id, name, body, okS] of neg) {
      const r = await P(sender, body);
      S.add({ id, title: `Send rejected: ${name}`, type: id.includes('-B') ? 'bva' : 'negative', ref: '§4 POST /inbox/:id/message checks {message (required), digitalAssetIds≤20, clientMessageId≤64} with ValidationPipe', expected: `HTTP ${okS.join('/')}`, actual: `HTTP ${r.status} msg="${L.msg(r)}"`, ok: okS.includes(r.status), note: r.status === 500 ? 'SERVER ERROR 500' : (r.status < 300 ? 'ACCEPTED invalid payload' : '') });
    }
    const cmid = `cl04-${L.RUN}-`.padEnd(64, 'x').slice(0, 64);
    const r1 = await P(sender, { message: `${tag} idempotency check`, clientMessageId: cmid });
    const m1 = r1.json?.data?.sentMessage || r1.json?.sentMessage || r1.json?.data || {};
    S.add({ id: 'SM-P01', title: 'Valid message with 64-char clientMessageId is sent', type: 'positive', ref: '§4 clientMessageId (max 64 chars)', expected: 'HTTP 200/201 + sentMessage', actual: `HTTP ${r1.status} id=${m1.id} keys=${Object.keys(r1.json?.data || r1.json || {}).join(',')}`, ok: L.inRange(r1.status, [200, 201]) && !!m1.id });
    const r2 = await P(sender, { message: `${tag} idempotency check (replay)`, clientMessageId: cmid });
    const m2 = r2.json?.data?.sentMessage || r2.json?.sentMessage || r2.json?.data || {};
    S.add({ id: 'SM-E01', title: 'Resend with the same clientMessageId returns the original message (no duplicate)', type: 'edge', ref: '§4 Idempotency: a resend returns the original row with isReplay', expected: `same id ${m1.id}`, actual: `HTTP ${r2.status} id=${m2.id} isReplay=${m2.isReplay ?? r2.json?.isReplay}`, ok: L.inRange(r2.status, [200, 201]) && m2.id === m1.id });
    const r3 = await P(sender, { message: `${tag} 200-char preview ${'y'.repeat(260)}` });
    S.add({ id: 'SM-B03', title: '280-char message accepted; inbox preview clipped at 200', type: 'bva', ref: '§4 preview clipped at 200 chars', expected: 'HTTP 201; preview length ≤ 200+prefix', actual: `HTTP ${r3.status}`, ok: L.inRange(r3.status, [200, 201]) });
    const inb = await G(sender, '/inbox?limit=50'); const row = (inb.json?.data || []).find((c) => c.conversationId === conv.conversationId);
    const plen = (row?.latestMessage?.preview || '').length;
    S.add({ id: 'SM-B04', title: 'Inbox preview of the long message is clipped (≤ ~205 chars)', type: 'bva', ref: '§4 clipped at 200 chars', expected: '≤ 205', actual: `preview length=${plen}`, ok: plen > 0 && plen <= 210 });
    const html = await P(sender, { message: `${tag} <script>alert(1)</script> <b>bold</b>` });
    const saved = html.json?.data?.sentMessage?.message || html.json?.sentMessage?.message || '';
    S.add({ id: 'SM-E02', title: 'Script tag in a message is stored/escaped (XSS hygiene)', type: 'edge', ref: '§4 Edits: no validation of the content', expected: '<script> removed or escaped', actual: `HTTP ${html.status} stored="${saved.slice(0, 80)}"`, ok: html.status < 300 && !/<script>/i.test(saved), note: /<script>/i.test(saved) ? 'RAW <script> STORED — FE must sanitise on render; security note' : '' });
    const out = await P(outsider, { message: `${tag} outsider` });
    S.add({ id: 'SM-N07', title: 'Non-participant cannot send (403)', type: 'negative', ref: '§4 not allowed returns 403', expected: 'HTTP 403', actual: `HTTP ${out.status}`, ok: [403, 404].includes(out.status) });
    const miss = await L.call(sender.ctx, 'POST', '/inbox/999999999/message', { message: 'x' });
    S.add({ id: 'SM-N08', title: 'Send to a missing room → 404', type: 'negative', ref: '§4 Missing room returns 404', expected: 'HTTP 404', actual: `HTTP ${miss.status}`, ok: [403, 404].includes(miss.status) });
    // the reader's unread count went up; then mark read
    const ownInb = await G(owner, '/inbox?limit=50'); const orow = (ownInb.json?.data || []).find((c) => c.chatRoomId === roomId);
    S.add({ id: 'SM-P02', title: "Reader's inbox shows unread count > 0 for the room after the sends", type: 'positive', ref: '§4 every other participant\'s unreadCount is incremented', expected: 'unreadCount ≥ 1', actual: `unreadCount=${orow?.unreadCount} total=${ownInb.json?.totalUnreadCount}`, ok: !!orow && orow.unreadCount >= 1, note: orow ? '' : 'owner does not see this room in the inbox' });
    if (orow) {
      const rd = await L.call(owner.ctx, 'PATCH', `/inbox/${orow.conversationId}/read`);
      S.add({ id: 'RD-P01', title: 'PATCH /inbox/:id/read returns {unreadConversationCount}', type: 'positive', ref: '§4 PATCH /inbox/:id/read', expected: 'HTTP 200 + unreadConversationCount', actual: `HTTP ${rd.status} body=${rd.text.slice(0, 100)}`, ok: rd.status === 200 && ('unreadConversationCount' in (rd.json?.data || rd.json || {})) });
      const after = await G(owner, '/inbox?limit=50'); const arow = (after.json?.data || []).find((c) => c.chatRoomId === roomId);
      S.add({ id: 'RD-P02', title: 'After read the room unread count is 0', type: 'positive', ref: '§4 Join or inbox read: unreadCount=0', expected: '0', actual: String(arow?.unreadCount), ok: arow?.unreadCount === 0 });
    }
    const rdBad = await L.call(owner.ctx, 'PATCH', '/inbox/abc/read');
    S.add({ id: 'RD-B01', title: 'PATCH /inbox/abc/read', type: 'bva', ref: '§4', expected: 'HTTP 400/404, never 500', actual: `HTTP ${rdBad.status}`, ok: [400, 403, 404].includes(rdBad.status), note: rdBad.status === 500 ? 'SERVER ERROR 500' : '' });
    const ra = await L.call(owner.ctx, 'PATCH', '/inbox/readAll');
    const rad = ra.json?.data || ra.json || {};
    S.add({ id: 'RA-P01', title: 'PATCH /inbox/readAll returns {conversationsCleared, totalUnreadCount, unreadConversationCount}', type: 'positive', ref: '§4 PATCH /inbox/readAll', expected: 'HTTP 200 + 3 counters', actual: `HTTP ${ra.status} keys=${Object.keys(rad).join(',')}`, ok: ra.status === 200 && ['conversationsCleared', 'totalUnreadCount', 'unreadConversationCount'].every((k) => k in rad) });
    const ra2 = await L.call(owner.ctx, 'PATCH', '/inbox/readAll'); const rad2 = ra2.json?.data || ra2.json || {};
    S.add({ id: 'RA-E01', title: 'readAll twice → conversationsCleared 0 and totalUnreadCount 0', type: 'edge', ref: '§4', expected: '0 / 0', actual: `cleared=${rad2.conversationsCleared} total=${rad2.totalUnreadCount}`, ok: rad2.conversationsCleared === 0 && rad2.totalUnreadCount === 0 });
  });

  // ---------- attachments endpoint ----------
  await L.step(S, 'AT', 'files', 'negative', '§4 POST /chats/files', async () => {
    const r = await L.call(sender.ctx, 'POST', '/chats/files', { workOrderId: conv.workOrder?.id });
    S.add({ id: 'AT-N01', title: 'POST /chats/files without files is rejected (not 500)', type: 'negative', ref: '§4 POST /chats/files (multipart files, workOrderId)', expected: 'HTTP 400', actual: `HTTP ${r.status} msg="${L.msg(r)}"`, ok: [400, 415, 422].includes(r.status), note: r.status === 500 ? 'SERVER ERROR 500' : (r.status < 300 ? 'accepted an upload with no files (GAP: no limits)' : '') });
    const big = Buffer.alloc(1024, 65);
    const r2 = await sender.ctx.post(L.u('/chats/files'), { multipart: { workOrderId: String(conv.workOrder?.id), files: { name: 'cl04.exe', mimeType: 'application/x-msdownload', buffer: big } } });
    const t2 = await r2.text();
    S.add({ id: 'AT-E01', title: 'Uploading an .exe as a chat file', type: 'edge', ref: '§4 [GAP] No file-size, count or type limits on the server', expected: 'HTTP 400 (type rejected) — GAP if accepted', actual: `HTTP ${r2.status()} body=${t2.slice(0, 100)}`, ok: r2.status() >= 400, note: r2.status() < 300 ? 'CONFIRMED GAP: executable accepted as chat attachment' : '' });
  });

  await Promise.all([sender, owner, outsider, eng].map((s) => s.ctx.dispose())); await anon.dispose();
  S.save();
});
