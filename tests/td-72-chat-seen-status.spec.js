// TD-72: "Previously Seen Messages Become Unseen After Sending a New Message"
// https://techdomain.atlassian.net/browse/TD-72
//
// Flow (two browser contexts = two users on the same work-order chat):
//   1. User A opens the chat and sends 3 messages while B is NOT in the chat (ticks grey).
//   2. User B opens the chat -> joinGroupChat marks everything read -> A's ticks turn primary.
//   3. User B leaves (context closed, so B is inactive).
//   4. User A sends a NEW message.
//   5. Assert the 3 old messages still show "seen" (UI ticks + API read-status), only the new one is unseen.
//   6. Reload A and assert again (acceptance criterion: consistent after refresh).
//
// Run:  npx playwright test tests/td-72-chat-seen-status.spec.js --headed
// Optional env: API_URL, WORK_ORDER_ID, USER_A (email), USER_B (email)

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN_ID = Date.now().toString(36);

test.setTimeout(240_000);

// ---------- helpers ----------
const roleOf = (u) => String(u?.role?.role || u?.role?.name || u?.roleName || u?.role || '').toUpperCase();
const companyIdOf = (u) => u?.companyId || u?.company?.id || u?.clientCompanyId || null;

// Playwright's baseURL drops the "/api" prefix for leading-slash paths, so always build full URLs.
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;

async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au' } });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  if (!res.ok()) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()} ${await res.text()}`);
  const body = await res.json();
  const token = body.accessToken;
  const api = await pwRequest.newContext({
    extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au', Authorization: `Bearer ${token}` },
  });
  let user = body.user;
  try {
    const me = await api.get(u('/users/me'));
    if (me.ok()) { const j = await me.json(); user = j.user || j.data || j; }
  } catch { }
  await ctx.dispose();
  return { account, api, user, id: user?.id, role: roleOf(user), companyId: companyIdOf(user) };
}

async function getJson(api, url) {
  const res = await api.get(u(url));
  if (!res.ok()) return null;
  try { return await res.json(); } catch { return null; }
}

// Find a chat room shared by two of the accounts. Returns { a, b, workOrderId, chatRoomId, companyId, engineerId }
async function discoverSharedChat(sessions, log) {
  // 1) Inbox intersection (rooms that already contain messages)
  const inboxes = new Map();
  for (const s of sessions) {
    const j = await getJson(s.api, '/inbox?limit=50');
    const rows = j?.data || [];
    inboxes.set(s.id, rows);
    log(`inbox ${s.account.role} <${s.account.email}> id=${s.id} role=${s.role} companyId=${s.companyId}: ${rows.length} conversation(s)` +
      rows.slice(0, 10).map((r) => `\n    - conv=${r.conversationId} room=${r.chatRoomId} WO=${r.workOrder?.id} "${r.workOrder?.title || ''}" engineerId=${r.engineerId} participant=${r.participant?.firstName || r.participant?.name || ''}`).join(''));
  }
  if (process.env.WORK_ORDER_ID) log(`WORK_ORDER_ID filter = ${process.env.WORK_ORDER_ID}`);

  const wanted = (s, env) => !process.env[env] || s.account.email.toLowerCase() === process.env[env].toLowerCase();
  const woOk = (id) => !process.env.WORK_ORDER_ID || String(id) === String(process.env.WORK_ORDER_ID);

  // 1a) Preferred: engineer room (engineerId = the FREELANCER) shared with a CLIENT who can read it.
  //     Engineer UI auto-opens its own thread; CLIENT opens it with ?engineerId=<engineer>.
  const freelancers = sessions.filter((s) => s.role === 'FREELANCER');
  const clientsAll = sessions.filter((s) => s.role === 'CLIENT');
  for (const f of freelancers) {
    if (!wanted(f, 'USER_A')) continue;
    for (const r of inboxes.get(f.id) || []) {
      if (r.engineerId !== f.id || !woOk(r.workOrder?.id)) continue;
      for (const c of clientsAll) {
        if (!wanted(c, 'USER_B')) continue;
        const roomId = r.chatRoomId || r.conversationId;
        const can = await getJson(c.api, `/chats/${roomId}?limit=1`);
        if (!can) continue;
        return { a: f, b: c, workOrderId: r.workOrder?.id, chatRoomId: roomId, companyId: r.company?.id || c.companyId, engineerId: f.id, source: 'engineer-room' };
      }
    }
  }

  // 1c) Engineer room (engineer = member f) shared with the freelance-company OWNER o, who picks f's row from the
  //     sidebar. The owner is the one whose GET /chats/users/:wo/:company lists the member.
  for (const f of freelancers) {
    if (!wanted(f, 'USER_A')) continue;
    for (const r of inboxes.get(f.id) || []) {
      if (r.engineerId !== f.id || !woOk(r.workOrder?.id)) continue;
      if (f.user?.company?.ownerId === f.id) continue; // f must be the member, not the owner
      for (const o of freelancers) {
        if (o.id === f.id || !wanted(o, 'USER_B')) continue;
        if (o.user?.company?.ownerId !== o.id || o.user?.company?.id !== f.user?.company?.id) continue; // o = owner of f's company
        const roomId = r.chatRoomId || r.conversationId;
        const companyId = r.company?.id || r.workOrder?.companyId;
        const can = await getJson(o.api, `/chats/${roomId}?limit=1`);
        if (!can) continue;
        return { a: f, b: o, workOrderId: r.workOrder?.id, chatRoomId: roomId, companyId, engineerId: f.id, source: 'fc-owner-room' };
      }
    }
  }

  // 1b) Any conversation both sides list in their inbox (navigation may not land on it for every role combo).
  for (let i = 0; i < sessions.length; i++) {
    for (let k = 0; k < sessions.length; k++) {
      if (i === k) continue;
      const a = sessions[i], b = sessions[k];
      if (!wanted(a, 'USER_A') || !wanted(b, 'USER_B')) continue;
      for (const ra of inboxes.get(a.id) || []) {
        if (!woOk(ra.workOrder?.id)) continue;
        const rb = (inboxes.get(b.id) || []).find((x) => x.conversationId === ra.conversationId);
        if (!rb) continue;
        // the room must be the one each side's UI will open: engineer room of a/b, with the other side a CLIENT
        const engineerSide = ra.engineerId === a.id ? a : ra.engineerId === b.id ? b : null;
        const other = engineerSide === a ? b : a;
        if (!engineerSide || other.role !== 'CLIENT') continue;
        return {
          a, b,
          workOrderId: ra.workOrder?.id,
          chatRoomId: ra.chatRoomId || ra.conversationId,
          companyId: ra.company?.id || a.companyId || b.companyId,
          engineerId: ra.engineerId,
          source: 'inbox',
        };
      }
    }
  }

  // 2) Fallback: CLIENT work-order board -> chat users list -> create/fetch the room with one of our engineer accounts
  const clients = sessions.filter((s) => s.role === 'CLIENT' && s.companyId);
  const others = sessions.filter((s) => s.role !== 'CLIENT');
  for (const c of clients) {
    const board = await getJson(c.api, '/workOrders?page=1&limit=50');
    const wos = board?.data?.workOrders || board?.workOrders || (Array.isArray(board?.data) ? board.data : []);
    log(`CLIENT ${c.account.email}: ${wos.length} work order(s) on board`);
    for (const wo of wos) {
      if (process.env.WORK_ORDER_ID && String(wo.id) !== String(process.env.WORK_ORDER_ID)) continue;
      const cu = await getJson(c.api, `/chats/users/${wo.id}/${c.companyId}`);
      const rows = cu?.data || [];
      for (const row of rows) {
        const uid = row.userId || row.user?.id || row.engineerId || row.id;
        const other = others.find((o) => o.id === uid);
        if (!other) continue;
        const room = await c.api.post(u('/chats/room/group'), { data: { workOrderId: wo.id, companyId: c.companyId, engineerId: uid } });
        if (!room.ok()) continue;
        const rj = await room.json();
        const r = rj.data || rj;
        return { a: c, b: other, workOrderId: wo.id, chatRoomId: r.id || r.chatRoomId, companyId: c.companyId, engineerId: other.role === 'CUSTOMER' ? null : uid, source: 'board' };
      }
    }
  }
  return null;
}

async function uiLogin(page, account) {
  await page.goto('/login');
  const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")').first().click();
  await expect(page).not.toHaveURL(/login|sign-?in/i, { timeout: 30_000 });
}

function chatUrl(session, shared) {
  // CLIENT (team side) must pick the counterpart's conversation; others auto-open their own thread.
  const counterpart = session.id === shared.a.id ? shared.b : shared.a;
  if (session.role === 'CLIENT') return `/workOrder/messages/${shared.workOrderId}?engineerId=${counterpart.id}`;
  return `/workOrder/messages/${shared.workOrderId}`;
}

async function openChat(page, session, shared) {
  await page.goto(chatUrl(session, shared));
  const editor = page.locator('.ql-editor').first();
  await expect(editor, `chat composer not visible for ${session.account.email}`).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(2_500); // let joinGroupChat / joinSuccess settle

  // Non-engineer side (CLIENT without ?engineerId, or freelance-company owner): pick the engineer's row in the sidebar.
  if (session.id !== shared.engineerId) {
    const counterpart = session.id === shared.a.id ? shared.b : shared.a;
    const name = `${counterpart.user?.firstName || ''} ${counterpart.user?.lastName || ''}`.trim();
    // The thread header also shows the counterpart name (clicking it opens the profile), so pick the LEFT-most
    // match: the conversation list is the left column of the Messages tab.
    if (name) {
      const matches = page.getByText(name, { exact: true });
      const n = await matches.count();
      let best = null, bestX = Infinity;
      for (let i = 0; i < n; i++) {
        const box = await matches.nth(i).boundingBox();
        if (box && box.x < bestX) { bestX = box.x; best = matches.nth(i); }
      }
      const vw = page.viewportSize()?.width || 1280;
      if (best && bestX < vw * 0.35) {
        await best.click();
        await page.waitForTimeout(2_500);
        await expect(page.locator('.ql-editor').first(), 'composer should still be visible after selecting the conversation').toBeVisible({ timeout: 20_000 });
      }
    }
  }
  return editor;
}

async function sendMessage(page, text) {
  const editor = page.locator('.ql-editor').first();
  await editor.click();
  await editor.fill('');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(page.locator(`div.group\\/row:has-text("${text}")`).first()).toBeVisible({ timeout: 15_000 });
}

// Own message row -> tick state. 'seen' = text-primary, 'unseen' = text-gray-400, 'none' = no tick found
async function tickState(page, text) {
  const row = page.locator(`div.group\\/row:has-text("${text}")`).first();
  const tick = row.locator('i.fa-check-double').first();
  if (await tick.count() === 0) return 'none';
  const cls = (await tick.getAttribute('class')) || '';
  if (cls.includes('text-primary')) return 'seen';
  if (cls.includes('text-gray-400')) return 'unseen';
  return `unknown(${cls})`;
}

async function waitForTick(page, text, expected, timeout = 20_000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await tickState(page, text);
    if (last === expected) return last;
    await page.waitForTimeout(500);
  }
  return last;
}

// API view of read status: { [messageText]: { isRead(by B), statusRows } }
async function apiReadStatus(session, shared, readerId, texts) {
  const j = await getJson(session.api, `/chats/${shared.chatRoomId}?limit=100`);
  const msgs = j?.messages || j?.data?.messages || [];
  const out = {};
  for (const t of texts) {
    const m = msgs.find((x) => typeof x.message === 'string' && x.message.includes(t));
    if (!m) { out[t] = { found: false }; continue; }
    const rows = m.chatMessageReadStatus || m.readStatus || m.status || [];
    const mine = rows.find((r) => r.userId === readerId);
    out[t] = { found: true, id: m.id, isRead: m.isRead, readerRow: mine ? { isRead: mine.isRead, isDelivered: mine.isDelivered } : null, rows: rows.length };
  }
  return out;
}

// ---------- the test ----------
test('TD-72: seen status of old messages survives a new message', async ({ browser }, testInfo) => {
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 500) }); };

  // API sessions for every account (skip ones that fail to log in)
  const sessions = [];
  for (const acc of accounts) {
    try { sessions.push(await apiLogin(acc)); }
    catch (e) { log(`skip ${acc.role}: ${e.message.slice(0, 160)}`); }
  }
  expect(sessions.length, 'need at least two working accounts').toBeGreaterThanOrEqual(2);

  const shared = await discoverSharedChat(sessions, log);
  if (!shared) {
    log('No shared chat room found between any two accounts in accounts.json. ' +
      'Create a work order as the TechDomain (CLIENT) user, route/assign it to the Individual Engineer, send one message, then rerun. ' +
      'Or pass WORK_ORDER_ID=<id>.');
    test.fail(true, 'no shared chat room available for the test accounts');
    return;
  }
  const { a: A, b: B } = shared;
  log(`Using WO ${shared.workOrderId}, room ${shared.chatRoomId} (via ${shared.source}). ` +
    `A (sender) = ${A.account.role} <${A.account.email}> id=${A.id}; B (reader) = ${B.account.role} <${B.account.email}> id=${B.id}`);

  const msgs = [1, 2, 3].map((n) => `TD72-${RUN_ID} old message ${n}`);
  const newMsg = `TD72-${RUN_ID} NEW message after seen`;

  // --- User A: login + open chat + send 3 messages while B is away ---
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await uiLogin(pageA, A.account);
  await openChat(pageA, A, shared);
  for (const m of msgs) await sendMessage(pageA, m);
  await pageA.screenshot({ path: testInfo.outputPath('1-A-sent-3-unseen.png'), fullPage: true });

  const beforeB = {};
  for (const m of msgs) beforeB[m] = await tickState(pageA, m);
  log(`Step 1 - A's ticks before B opens: ${JSON.stringify(beforeB)}`);
  for (const m of msgs) expect(beforeB[m], `tick for "${m}" should exist`).not.toBe('none');

  // --- User B: login + open the chat (marks everything read) ---
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await uiLogin(pageB, B.account);
  await openChat(pageB, B, shared);
  for (const m of msgs) await expect(pageB.locator(`div.group\\/row:has-text("${m}")`).first()).toBeVisible({ timeout: 20_000 });
  await pageB.screenshot({ path: testInfo.outputPath('2-B-reads.png'), fullPage: true });

  // A should now see all 3 as seen
  const afterB = {};
  for (const m of msgs) afterB[m] = await waitForTick(pageA, m, 'seen');
  log(`Step 2 - A's ticks after B read: ${JSON.stringify(afterB)}`);
  await pageA.screenshot({ path: testInfo.outputPath('3-A-sees-seen.png'), fullPage: true });
  for (const m of msgs) expect(afterB[m], `"${m}" should be SEEN after B opened the chat (precondition)`).toBe('seen');

  // --- B leaves so the new message stays unread ---
  await ctxB.close();
  await pageA.waitForTimeout(1_500);

  // --- A sends a new message ---
  await sendMessage(pageA, newMsg);
  await pageA.waitForTimeout(2_500);
  await pageA.screenshot({ path: testInfo.outputPath('4-A-after-new-message.png'), fullPage: true });

  const afterNew = {};
  for (const m of [...msgs, newMsg]) afterNew[m] = await tickState(pageA, m);
  log(`Step 3 - A's ticks right after sending the new message: ${JSON.stringify(afterNew)}`);

  const apiAfterNew = await apiReadStatus(A, shared, B.id, [...msgs, newMsg]);
  log(`Step 3 - API read status (reader=B ${B.id}): ${JSON.stringify(apiAfterNew)}`);

  // --- A reloads (refresh criterion) ---
  await pageA.reload();
  await expect(pageA.locator('.ql-editor').first()).toBeVisible({ timeout: 40_000 });
  await pageA.waitForTimeout(3_000);
  await pageA.screenshot({ path: testInfo.outputPath('5-A-after-reload.png'), fullPage: true });
  const afterReload = {};
  for (const m of [...msgs, newMsg]) afterReload[m] = await tickState(pageA, m);
  log(`Step 4 - A's ticks after reload: ${JSON.stringify(afterReload)}`);

  await ctxA.close();

  // ---------- assertions (soft, so every failure is reported) ----------
  for (const m of msgs) {
    expect.soft(afterNew[m], `UI (live): "${m}" reverted to ${afterNew[m]} after new message - BUG TD-72 reproduced`).toBe('seen');
    expect.soft(afterReload[m], `UI (after reload): "${m}" shows ${afterReload[m]}`).toBe('seen');
    expect.soft(apiAfterNew[m]?.readerRow?.isRead, `API: "${m}" read-status for B is not isRead=true: ${JSON.stringify(apiAfterNew[m])}`).toBe(true);
  }
  expect.soft(afterNew[newMsg], 'new message should still be unseen (B is away)').toBe('unseen');
  expect.soft(apiAfterNew[newMsg]?.readerRow?.isRead ?? false, 'API: new message should not be read by B').toBe(false);
});
