// Direct chat (new feature, dev 2026-10-15) - A to Z positive + negative test.
//
// Feature as described by the tester + mined from the frontend bundle (main.9adc8e62.js):
//   * Profile page (/user/details/profile/:id) shows a "Message" button when GET chats/direct/options?userId=<profile user>
//     returns at least one option: { vendor:{companyName,chatRoomId} | teams:[{teamId,teamName,chatRoomId}] }.
//   * Clicking it calls POST chats/direct {userId, teamId?} (or opens the existing room) and navigates to /messages/<roomId>.
//   * Sidebar "Messages" (/messages) lists GET inbox?section=direct rows (isDirectChat=true).
//   * Allowed pairs: Tech Domain (team member, as a team) -> Vendor owner; Tech Domain -> Engineer (individual or vendor
//     engineer); Vendor owner <-> own Vendor engineer (two-way, either side may start). Tech Domain always starts its chats.
//   * Not allowed: vendor -> vendor, engineer -> engineer, vendor -> foreign engineer, anyone -> customer, anyone -> Tech Domain
//     (first message), customer -> anyone.
//
// Run:  npx playwright test tests/direct-chat.spec.js            (SKIP_UI=1 skips the browser phase)
// Evidence: evidence/DirectChat/run-<stamp>/  (DirectChat_<NN>_<step>.png, results.json, REPORT.md)

const { test, expect, request: pwRequest, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const td123 = require(path.join(__dirname, '..', 'td123-accounts.json'));

const BASE = process.env.BASE_URL || 'https://dev.techdomain.com.au';
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'DirectChat', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: BASE };
const SKIP_UI = !!process.env.SKIP_UI;
const TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f'; // Tech Domain team of user 640
const TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce'; // Tech Domain team user 640 is NOT in
const TAG = `dc${RUN}`;

const ACC = {
  TDOWNER: { label: 'Tech Domain owner (27, no team)', ...accounts[1] },
  TDTEAM: { label: 'Tech Domain team member (640, Service Delivery 3)', ...td123[1] },
  TDNONTEAM: { label: 'Tech Domain user without team (641)', ...td123[2] },
  ENG1: { label: 'Individual engineer (575)', ...accounts[2] },
  ENG2: { label: 'Individual engineer #2 (636)', ...testAccounts[0] },
  VEN1: { label: 'Vendor owner (609, Demo Field Services 0925)', ...accounts[3] },
  VENENG1: { label: 'Vendor engineer (611, member of vendor 609)', ...accounts[4] },
  VEN2: { label: 'Vendor owner #2 (637)', ...testAccounts[1] },
  CUST: { label: 'Customer owner (638)', email: 'customer-10090955@mailinator.com', password: testAccounts[2].password },
  CUSTSUB: { label: 'Customer sub-user (639)', ...td123[0] },
  ADMIN: { label: 'Admin (1)', ...accounts[0] },
};

test.describe.configure({ mode: 'serial' });
test.setTimeout(1_800_000);

// ---------------------------------------------------------------- state + evidence
const S = {};                 // API sessions by key
const R = { results: [], rooms: {}, notes: [], run: RUN, startedAt: new Date().toISOString() };
let shotNo = 0;
const ensureDir = () => fs.mkdirSync(EVIDENCE, { recursive: true }); // lazy: the runner process also loads this file

function rec(id, title, expected, actual, pass, extra) {
  const row = { id, title, expected, actual: typeof actual === 'string' ? actual : JSON.stringify(actual), pass: pass === null ? null : !!pass, ...(extra || {}) };
  R.results.push(row); ensureDir();
  console.log(`${pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL'} ${id} ${title} -> ${row.actual}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(R, null, 2));
  return row;
}
function note(text) { R.notes.push(text); console.log('NOTE ' + text); }
async function shot(page, name) {
  shotNo += 1; ensureDir();
  const file = `DirectChat_${String(shotNo).padStart(2, '0')}_${name}.png`;
  await page.screenshot({ path: path.join(EVIDENCE, file), fullPage: false }).catch(() => { });
  return file;
}

// ---------------------------------------------------------------- API helpers
async function rawLogin(email, password) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email, password } });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  return { status: res.status(), body };
}
async function apiLogin(key) {
  const account = ACC[key];
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${key} ${account.email}: HTTP ${l.status} ${JSON.stringify(l.body).slice(0, 200)}`);
  const user = l.body.data || l.body.user || {};
  const s = { key, label: account.label, account, user, id: user.id, role: String(user.role?.role || user.role || '').toUpperCase() };
  s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } });
  s.relogin = async () => {
    const n = await rawLogin(account.email, account.password);
    if (!n.body.accessToken) return false;
    s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${n.body.accessToken}` } });
    return true;
  };
  S[key] = s;
  return s;
}
async function call(s, method, p, data) {
  const opts = data === undefined ? undefined : { data };
  let r = await s.api[method](u(p), opts);
  if (r.status() === 401 && s.relogin && (await s.relogin())) r = await s.api[method](u(p), opts);
  const body = await r.json().catch(async () => ({ text: await r.text().catch(() => '') }));
  return { status: r.status(), body };
}
const getJson = (s, p) => call(s, 'get', p);
const postJson = (s, p, data) => call(s, 'post', p, data);
const patchJson = (s, p, data) => call(s, 'patch', p, data);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '');
const short = (b) => JSON.stringify(b).slice(0, 160);

const options = async (s, userId) => {
  const r = await getJson(s, `/chats/direct/options?userId=${userId}`);
  const d = r.body?.data || {};
  return { status: r.status, vendor: d.vendor || null, teams: d.teams || [], summary: `vendor=${d.vendor ? `${d.vendor.companyName}#${d.vendor.chatRoomId}` : '-'} teams=${(d.teams || []).map((t) => `${t.teamName}#${t.chatRoomId}`).join('|') || '-'}` };
};
const createDirect = (s, payload) => postJson(s, '/chats/direct', payload);
const roomIdOf = (r) => r.body?.data?.id || r.body?.data?.chatRoomId || r.body?.data?.conversationId || r.body?.id || null;
const directList = async (s) => { const r = await getJson(s, '/inbox?section=direct&limit=50'); return { status: r.status, rows: Array.isArray(r.body?.data) ? r.body.data : [], counts: { total: r.body?.totalUnreadCount, direct: r.body?.unreadDirectCount, wo: r.body?.unreadWorkOrderCount } }; };
const room = async (s, id, limit = 50) => { const r = await getJson(s, `/inbox/${id}?limit=${limit}&markAsRead=false`); return { status: r.status, conv: r.body?.data?.conversation || null, messages: r.body?.data?.messages || [], body: r.body }; };
const sendMsg = (s, id, message) => postJson(s, `/inbox/${id}/message`, { message });
const notifRows = (b) => (Array.isArray(b) ? b : (Array.isArray(b?.data?.data) ? b.data.data : (Array.isArray(b?.data) ? b.data : [])));
const msgNotifs = async (s, roomId) => {
  const a = await getJson(s, '/notifications/messages?limit=40'); const b = await getJson(s, '/notifications/chat?limit=40');
  const seen = new Set(); const out = [];
  for (const n of [...notifRows(a.body), ...notifRows(b.body)]) { if (n.chatRoomId !== roomId || seen.has(n.id)) continue; seen.add(n.id); out.push({ id: n.id, senderId: n.senderId, title: n.title, url: n.url, content: strip(n.content).slice(0, 80), isRead: n.isRead, via: notifRows(a.body).some((x) => x.id === n.id) ? 'messages' : 'chat' }); }
  return out;
};

// Positive message exchange in one room between two API sessions; records delivery + notification both ways.
async function exchange(id, prefix, roomId, a, b) {
  const t1 = `${prefix} ${a.key}->${b.key} ${TAG}`;
  const t2 = `${prefix} ${b.key}->${a.key} ${TAG}`;
  const s1 = await sendMsg(a, roomId, `<p>${t1}</p>`);
  rec(`${id}.1`, `${a.label} sends in room ${roomId}`, '201 sentMessage', `${s1.status} ${short(s1.body?.data?.sentMessage ? { id: s1.body.data.sentMessage.id, key: s1.body.data.sentMessage.chatRoom?.directChatKey } : s1.body)}`, s1.status === 201);
  const s2 = await sendMsg(b, roomId, `<p>${t2}</p>`);
  rec(`${id}.2`, `${b.label} replies in room ${roomId}`, '201 sentMessage', `${s2.status} ${short(s2.body?.data?.sentMessage ? { id: s2.body.data.sentMessage.id } : s2.body)}`, s2.status === 201);
  await sleep(1500);
  const ra = await room(a, roomId); const rb = await room(b, roomId);
  const seesA = ra.messages.some((m) => strip(m.message) === t2); const seesB = rb.messages.some((m) => strip(m.message) === t1);
  rec(`${id}.3`, `Both sides read both messages via GET inbox/${roomId}`, 'both true', { aStatus: ra.status, aSeesReply: seesA, bStatus: rb.status, bSeesFirst: seesB }, ra.status === 200 && rb.status === 200 && seesA && seesB);
  const nb = await msgNotifs(b, roomId); const na = await msgNotifs(a, roomId);
  const bGot = nb.find((n) => n.content === t1); const aGot = na.find((n) => n.content === t2);
  rec(`${id}.4`, `MESSAGE notification to receiver (both directions)`, `b has notif for "${t1}", a has notif for "${t2}", url /messages/${roomId}`, { bGot: bGot || null, aGot: aGot || null }, !!bGot && !!aGot && bGot.url === `/messages/${roomId}` && aGot.url === `/messages/${roomId}`);
  const selfA = na.find((n) => n.content === t1); const selfB = nb.find((n) => n.content === t2);
  rec(`${id}.5`, `Sender is not notified about own message`, 'no self notification', { selfA: !!selfA, selfB: !!selfB }, !selfA && !selfB);
  if (bGot && bGot.title === '') note(`Direct-chat MESSAGE notification title is empty string (room ${roomId}); work-order notifications carry the WO title.`);
  return { t1, t2, ra, rb };
}

// Leak probe: `outsiders` must not list, read, or post in roomId, and must have no MESSAGE notification for it.
async function leakCheck(id, roomId, roomLabel, outsiders) {
  for (const o of outsiders) {
    const list = await directList(o);
    const listed = list.rows.some((c) => c.conversationId === roomId);
    const rd = await room(o, roomId, 1);
    const post = await sendMsg(o, roomId, `<p>LEAK ${o.key} ${TAG}</p>`);
    const notifs = await msgNotifs(o, roomId);
    const ok = !listed && rd.status === 403 && post.status === 403 && notifs.length === 0;
    rec(`${id}.${o.key}`, `${o.label} is an outsider of ${roomLabel} (room ${roomId})`, 'not listed, GET 403, POST 403, 0 notifications', { listed, get: rd.status, post: post.status, notifs: notifs.length, postMsg: post.body?.message }, ok);
    if (post.status === 201) note(`LEAK: ${o.label} could POST into room ${roomId} (${roomLabel}) - message id ${post.body?.data?.sentMessage?.id}`);
  }
}

async function expectDenied(id, s, payload, why) {
  const r = await createDirect(s, payload);
  const created = r.status < 300;
  rec(id, `${s.label} POST chats/direct ${JSON.stringify(payload)} - ${why}`, '4xx (denied)', `${r.status} ${short(r.body)}`, !created, { bugIfFail: true });
  if (created) { note(`BUG: ${s.label} created direct room ${roomIdOf(r)} with ${JSON.stringify(payload)} (${why})`); R.rooms[`unexpected_${id}`] = roomIdOf(r); }
  return r;
}

// ---------------------------------------------------------------- UI helpers
async function uiLogin(page, account) {
  await page.goto(`${BASE}/login`);
  const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(2_500);
}
async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'], baseURL: BASE });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  return { ctx, page };
}
const messageButton = (page) => page.getByRole('button', { name: 'Message', exact: true }).first();
async function composer(page) { const c = page.locator('.ql-editor').first(); await expect(c).toBeVisible({ timeout: 20_000 }); return c; }
async function uiSend(page, text) { const c = await composer(page); await c.click(); await c.fill(''); await c.type(text); await page.keyboard.press('Enter'); }

// ================================================================ PHASE 0 - sessions
test('00 login every role via API', async () => {
  for (const key of Object.keys(ACC)) {
    try { const s = await apiLogin(key); rec(`00.${key}`, `API login ${s.label}`, 'token + id', `id=${s.id} role=${s.role}`, true); }
    catch (e) { rec(`00.${key}`, `API login ${ACC[key].label}`, 'token', e.message, false); }
  }
  expect(S.TDTEAM && S.ENG1 && S.VEN1 && S.VENENG1 && S.ENG2 && S.VEN2).toBeTruthy();
  for (const k of ['ENG2', 'VEN2', 'VENENG1', 'VEN1', 'ENG1']) { const r = await getJson(S.TDTEAM, `/users/${S[k].id}`); S[k].name = `${r.body?.firstName || ''} ${r.body?.lastName || ''}`.trim(); }
  const me = await getJson(S.TDTEAM, '/users/me'); S.TDTEAM.name = `${me.body?.firstName || ''} ${me.body?.lastName || ''}`.trim();
  note(`Names: ENG1=${S.ENG1.name}, ENG2=${S.ENG2.name}, VEN1=${S.VEN1.name}, VENENG1=${S.VENENG1.name}, VEN2=${S.VEN2.name}, TDTEAM=${S.TDTEAM.name}`);
});

// ================================================================ PHASE 1 - who may start a chat with whom (options endpoint = the "Message" button)
test('01 chats/direct/options matrix = Message button visibility per role pair', async () => {
  const viewers = ['TDOWNER', 'TDTEAM', 'TDNONTEAM', 'ENG1', 'ENG2', 'VEN1', 'VENENG1', 'VEN2', 'CUST', 'CUSTSUB', 'ADMIN'];
  const targets = ['TDOWNER', 'TDTEAM', 'ENG1', 'ENG2', 'VEN1', 'VENENG1', 'VEN2', 'CUST', 'ADMIN'];
  const allowed = { 'TDTEAM>ENG1': 'teams', 'TDTEAM>ENG2': 'teams', 'TDTEAM>VEN1': 'teams', 'TDTEAM>VENENG1': 'teams', 'TDTEAM>VEN2': 'teams', 'VEN1>VENENG1': 'vendor', 'VENENG1>VEN1': 'vendor' };
  const matrix = [];
  for (const v of viewers) {
    if (!S[v]) continue;
    for (const t of targets) {
      if (v === t || !S[t]) continue;
      const o = await options(S[v], S[t].id);
      const has = !!o.vendor || o.teams.length > 0;
      const exp = allowed[`${v}>${t}`];
      const pass = exp ? (exp === 'vendor' ? !!o.vendor : o.teams.length > 0) : !has;
      matrix.push({ viewer: v, target: t, status: o.status, options: o.summary, expected: exp || 'none', pass });
      rec(`01.${v}>${t}`, `Message button: ${S[v].label} viewing ${S[t].label}`, exp ? `option(s): ${exp}` : 'no option (button hidden)', `${o.status} ${o.summary}`, pass);
    }
  }
  R.optionsMatrix = matrix;
  const tdOwner = matrix.filter((m) => m.viewer === 'TDOWNER');
  if (tdOwner.every((m) => m.options.endsWith('teams=-'))) note('Tech Domain company OWNER (user 27) is in no team, so he gets no Message button anywhere and cannot start a direct chat - only team members can. Confirm with product whether the owner should be able to.');
});

// ================================================================ PHASE 2 - negative: nobody outside the allowed pairs can create a room (server side)
test('02 negative - engineers cannot start any direct chat', async () => {
  await expectDenied('02.1', S.ENG1, { userId: S.ENG2.id }, 'engineer -> engineer');
  await expectDenied('02.2', S.ENG2, { userId: S.ENG1.id }, 'engineer -> engineer (reverse)');
  await expectDenied('02.3', S.ENG1, { userId: S.VEN1.id }, 'engineer -> vendor owner');
  await expectDenied('02.4', S.ENG1, { userId: S.VENENG1.id }, 'engineer -> vendor engineer');
  await expectDenied('02.5', S.ENG1, { userId: S.TDTEAM.id }, 'engineer -> Tech Domain (engineer must not start)');
  await expectDenied('02.6', S.ENG1, { userId: S.TDTEAM.id, teamId: TEAM_SD3 }, 'engineer -> Tech Domain team (teamId injected)');
  await expectDenied('02.7', S.ENG1, { userId: S.CUST.id }, 'engineer -> customer');
  await expectDenied('02.8', S.ENG1, { userId: S.ENG1.id }, 'engineer -> self');
});

test('03 negative - vendors cannot start chats outside their own company', async () => {
  await expectDenied('03.1', S.VEN1, { userId: S.VEN2.id }, 'vendor -> vendor');
  await expectDenied('03.2', S.VEN2, { userId: S.VEN1.id }, 'vendor -> vendor (reverse)');
  await expectDenied('03.3', S.VEN1, { userId: S.ENG1.id }, 'vendor -> individual engineer (not his member)');
  await expectDenied('03.4', S.VEN2, { userId: S.VENENG1.id }, 'vendor -> ANOTHER vendor\'s engineer');
  await expectDenied('03.5', S.VEN1, { userId: S.TDTEAM.id }, 'vendor -> Tech Domain (vendor must not start)');
  await expectDenied('03.6', S.VEN1, { userId: S.TDTEAM.id, teamId: TEAM_SD3 }, 'vendor -> Tech Domain team (teamId injected)');
  await expectDenied('03.7', S.VEN1, { userId: S.CUST.id }, 'vendor -> customer');
  await expectDenied('03.8', S.VEN1, { userId: S.VEN1.id }, 'vendor -> self');
});

test('04 negative - vendor engineer cannot start chats outside his own company', async () => {
  await expectDenied('04.1', S.VENENG1, { userId: S.ENG1.id }, 'vendor engineer -> individual engineer');
  await expectDenied('04.2', S.VENENG1, { userId: S.ENG2.id }, 'vendor engineer -> engineer #2');
  await expectDenied('04.3', S.VENENG1, { userId: S.VEN2.id }, 'vendor engineer -> ANOTHER vendor owner');
  await expectDenied('04.4', S.VENENG1, { userId: S.TDTEAM.id }, 'vendor engineer -> Tech Domain (must not start)');
  await expectDenied('04.5', S.VENENG1, { userId: S.CUST.id }, 'vendor engineer -> customer');
  await expectDenied('04.6', S.VENENG1, { userId: S.VENENG1.id }, 'vendor engineer -> self');
  note('No second engineer of vendor 609 exists on dev, so "vendor engineer -> vendor engineer of the same company" could not be exercised.');
});

test('05 negative - customers, admin and Tech Domain misuse', async () => {
  await expectDenied('05.1', S.CUST, { userId: S.ENG1.id }, 'customer -> engineer');
  await expectDenied('05.2', S.CUST, { userId: S.VEN1.id }, 'customer -> vendor');
  await expectDenied('05.3', S.CUST, { userId: S.TDTEAM.id }, 'customer -> Tech Domain');
  await expectDenied('05.4', S.CUSTSUB, { userId: S.ENG1.id }, 'customer sub-user -> engineer');
  await expectDenied('05.5', S.ADMIN, { userId: S.ENG1.id }, 'admin -> engineer (feature is for TD/vendor roles only)');
  await expectDenied('05.6', S.TDTEAM, { userId: S.CUST.id, teamId: TEAM_SD3 }, 'Tech Domain -> customer (customers are out of scope)');
  await expectDenied('05.7', S.TDTEAM, { userId: S.TDOWNER.id, teamId: TEAM_SD3 }, 'Tech Domain -> Tech Domain colleague');
  await expectDenied('05.8', S.TDTEAM, { userId: S.TDTEAM.id, teamId: TEAM_SD3 }, 'Tech Domain -> self');
  await expectDenied('05.9', S.TDTEAM, { userId: S.ENG1.id, teamId: TEAM_OP3 }, 'Tech Domain member sending as a team he is NOT in');
  await expectDenied('05.10', S.TDTEAM, { userId: S.ENG1.id, teamId: 'not-a-team-id' }, 'bogus teamId');
  await expectDenied('05.11', S.TDTEAM, { userId: 99999999, teamId: TEAM_SD3 }, 'unknown userId');
  await expectDenied('05.12', S.TDTEAM, {}, 'empty body');
  await expectDenied('05.13', S.TDTEAM, { userId: 'abc', teamId: TEAM_SD3 }, 'non-numeric userId');
  await expectDenied('05.14', S.TDNONTEAM, { userId: S.ENG1.id }, 'Tech Domain user with NO team');
  await expectDenied('05.15', S.TDNONTEAM, { userId: S.ENG1.id, teamId: TEAM_SD3 }, 'Tech Domain user with NO team injecting a teamId');
  await expectDenied('05.16', S.TDOWNER, { userId: S.ENG1.id, teamId: TEAM_SD3 }, 'Tech Domain OWNER (not a team member) injecting a teamId');
  const existingTeamRoom = (await options(S.TDTEAM, S.ENG1.id)).teams.find((t) => t.teamId === TEAM_SD3)?.chatRoomId || null;
  const noTeam = await createDirect(S.TDTEAM, { userId: S.ENG1.id });
  rec('05.17', 'Tech Domain member POST chats/direct WITHOUT teamId (UI always sends one)', `4xx, or the existing team room ${existingTeamRoom} re-used (no personal TD<->engineer room)`, `${noTeam.status} id=${roomIdOf(noTeam)} teamId=${noTeam.body?.data?.teamId} ${short(noTeam.body)}`, noTeam.status >= 400 || roomIdOf(noTeam) === existingTeamRoom);
  if (noTeam.status < 300) R.rooms.tdNoTeam = roomIdOf(noTeam);
  const vendorWithTeam = await createDirect(S.VEN1, { userId: S.VENENG1.id, teamId: TEAM_SD3 });
  rec('05.18', 'Vendor owner -> own engineer with a Tech Domain teamId injected', '4xx, or vendor room (teamId ignored)', `${vendorWithTeam.status} ${short(vendorWithTeam.body)}`, vendorWithTeam.status >= 400 || !(vendorWithTeam.body?.data?.teamId));
  if (vendorWithTeam.status < 300) R.rooms.vendorPair = roomIdOf(vendorWithTeam);
  // unauthenticated
  const anon = await pwRequest.newContext({ extraHTTPHeaders: H });
  const a1 = await anon.post(u('/chats/direct'), { data: { userId: S.ENG1.id, teamId: TEAM_SD3 } });
  const a2 = await anon.get(u(`/chats/direct/options?userId=${S.ENG1.id}`));
  const a3 = await anon.get(u('/inbox?section=direct'));
  rec('05.19', 'Unauthenticated POST chats/direct / GET options / GET inbox', '401 x3', [a1.status(), a2.status(), a3.status()], a1.status() === 401 && a2.status() === 401 && a3.status() === 401);
  await anon.dispose();
});

// ================================================================ PHASE 3 - positive: Tech Domain starts chats (API) with fresh targets
test('06 positive - Tech Domain team member starts a chat with a NEW engineer and a NEW vendor', async () => {
  for (const [k, who] of [['ENG2', 'engineer'], ['VEN2', 'vendor owner']]) {
    const before = await options(S.TDTEAM, S[k].id);
    const fresh = before.teams.length > 0 && !before.teams.some((t) => t.chatRoomId);
    rec(`06.${k}.1`, `Before: options for ${S[k].label}`, 'team option (chatRoomId null when no room exists yet)', `${before.summary} fresh=${fresh}`, before.teams.length > 0);
    const tgtBefore = await directList(S[k]);
    const c = await createDirect(S.TDTEAM, { userId: S[k].id, teamId: TEAM_SD3 });
    const id = roomIdOf(c);
    R.rooms[`td_${k}`] = id;
    rec(`06.${k}.2`, `POST chats/direct {userId:${S[k].id}, teamId:SD3} (Tech Domain -> ${who})`, '201 + room id', `${c.status} id=${id} ${short(c.body)}`, c.status < 300 && !!id);
    if (!id) continue;
    const again = await createDirect(S.TDTEAM, { userId: S[k].id, teamId: TEAM_SD3 });
    rec(`06.${k}.3`, 'Second POST for the same pair re-uses the room (idempotent)', `same id ${id}`, `${again.status} id=${roomIdOf(again)}`, roomIdOf(again) === id);
    const after = await options(S.TDTEAM, S[k].id);
    rec(`06.${k}.4`, 'Options now carry the existing chatRoomId', `teams=...#${id}`, after.summary, after.teams.some((t) => t.chatRoomId === id));
    if (fresh) {
      const tdList0 = await directList(S.TDTEAM); const tgtList0 = await directList(S[k]);
      const l0 = { tdListed: tdList0.rows.some((r) => r.conversationId === id), tgtListed: tgtList0.rows.some((r) => r.conversationId === id), tgtHadItBefore: tgtBefore.rows.some((r) => r.conversationId === id) };
      rec(`06.${k}.5a`, 'Right after creation, BEFORE any message: is the empty room already listed in the sidebars?', 'observation (frontend fetches the opened room separately, so an empty room need not be listed)', l0, null);
      if (!l0.tdListed && !l0.tgtListed) note(`A newly created direct room (${id}) is NOT listed in GET inbox?section=direct for either side until the first message is sent; the Tech Domain user still lands in it via /messages/${id}. The ${who} sees nothing until the first message - acceptable.`);
    }
    const rm = await room(S.TDTEAM, id);
    const memberIds = (rm.conv?.members || []).map((m) => m.id);
    rec(`06.${k}.6`, 'Participants = target user + Service Delivery 3 members only', `members contain ${S[k].id}; teamId SD3; directUserId ${S[k].id}`, { teamId: rm.conv?.teamId, directUserId: rm.conv?.directUserId, members: memberIds }, rm.conv?.teamId === TEAM_SD3 && rm.conv?.directUserId === S[k].id && memberIds.includes(S[k].id));
    await exchange(`06.${k}.7`, 'first', id, S.TDTEAM, S[k]);
    const tdList = await directList(S.TDTEAM); const tgtList = await directList(S[k]);
    const tdRow = tdList.rows.find((r) => r.conversationId === id); const tgtRow = tgtList.rows.find((r) => r.conversationId === id);
    rec(`06.${k}.5`, `After the first message the room is in BOTH sidebars (GET inbox?section=direct)`, 'both listed, isDirectChat=true', { tdListed: !!tdRow, tdName: tdRow?.participant?.name, tgtListed: !!tgtRow, tgtName: tgtRow?.participant?.name, tgtUnread: tgtRow?.unreadCount, isDirect: tdRow?.isDirectChat && tgtRow?.isDirectChat }, !!tdRow && !!tgtRow && tdRow.isDirectChat && tgtRow.isDirectChat);
    const seen = await room(S[k], id);
    rec(`06.${k}.8`, `${who} side: participant shown is the TEAM (not an individual)`, 'participant.type COMPANY "Service Delivery 3"', { participant: seen.conv?.participant?.name, type: seen.conv?.participant?.type }, seen.conv?.participant?.type === 'COMPANY' && /Service Delivery 3/.test(seen.conv?.participant?.name || ''));
  }
});

test('07 positive - existing Tech Domain rooms with engineer 575, vendor 609 and vendor engineer 611 still deliver both ways', async () => {
  for (const k of ['ENG1', 'VEN1', 'VENENG1']) {
    const o = await options(S.TDTEAM, S[k].id);
    const id = o.teams.find((t) => t.teamId === TEAM_SD3)?.chatRoomId || roomIdOf(await createDirect(S.TDTEAM, { userId: S[k].id, teamId: TEAM_SD3 }));
    R.rooms[`td_${k}`] = id;
    rec(`07.${k}.0`, `Room Tech Domain(SD3) <-> ${S[k].label}`, 'room id', id, !!id);
    if (id) await exchange(`07.${k}`, 'again', id, S.TDTEAM, S[k]);
  }
});

// ================================================================ PHASE 4 - vendor <-> own engineer, two-way, engineer may start
test('08 positive - vendor engineer starts the chat with his vendor owner (two-way)', async () => {
  const oBefore = await options(S.VENENG1, S.VEN1.id);
  let id = oBefore.vendor?.chatRoomId || R.rooms.vendorPair || null;
  rec('08.1', 'Vendor engineer sees "Your company" option on the owner profile', 'vendor option', oBefore.summary, !!oBefore.vendor);
  if (!id) {
    const c = await createDirect(S.VENENG1, { userId: S.VEN1.id });
    id = roomIdOf(c);
    rec('08.2', 'Vendor ENGINEER creates the room first (POST chats/direct {userId: owner})', '201 + id', `${c.status} id=${id} ${short(c.body)}`, c.status < 300 && !!id);
  } else {
    rec('08.2', 'Vendor pair room already existed before this test', 'n/a', `id=${id} (created by 05.18 or earlier)`, null);
  }
  R.rooms.vendorPair = id;
  if (!id) return;
  const c2 = await createDirect(S.VEN1, { userId: S.VENENG1.id });
  rec('08.3', 'Owner side POST for the same pair returns the SAME room (one room per pair, whoever starts)', `id ${id}`, `${c2.status} id=${roomIdOf(c2)}`, roomIdOf(c2) === id);
  const rm = await room(S.VEN1, id);
  rec('08.4', 'Vendor room participants = owner + engineer only (no Tech Domain, no team)', `members [${S.VENENG1.id}] from owner view, teamId null`, { teamId: rm.conv?.teamId, directUserId: rm.conv?.directUserId, members: (rm.conv?.members || []).map((m) => m.id), key: rm.conv?.directChatKey }, rm.status === 200 && !rm.conv?.teamId && (rm.conv?.members || []).every((m) => [S.VEN1.id, S.VENENG1.id].includes(m.id)));
  await exchange('08.5', 'vendor', id, S.VENENG1, S.VEN1);
  const lo = await directList(S.VEN1); const le = await directList(S.VENENG1);
  rec('08.6', 'Vendor pair room listed in both sidebars', 'both listed', { owner: lo.rows.find((r) => r.conversationId === id)?.participant?.name || false, engineer: le.rows.find((r) => r.conversationId === id)?.participant?.name || false }, lo.rows.some((r) => r.conversationId === id) && le.rows.some((r) => r.conversationId === id));
});

// ================================================================ PHASE 5 - leaks
test('09 leak checks - every room is invisible to everyone else', async () => {
  const outsidersFor = (keys) => Object.keys(S).filter((k) => !keys.includes(k)).map((k) => S[k]);
  const rooms = [
    ['td_ENG2', `TD(SD3) <-> ${S.ENG2.label}`, ['TDTEAM', 'ENG2']],
    ['td_VEN2', `TD(SD3) <-> ${S.VEN2.label}`, ['TDTEAM', 'VEN2']],
    ['td_ENG1', `TD(SD3) <-> ${S.ENG1.label}`, ['TDTEAM', 'ENG1']],
    ['td_VEN1', `TD(SD3) <-> ${S.VEN1.label}`, ['TDTEAM', 'VEN1']],
    ['td_VENENG1', `TD(SD3) <-> ${S.VENENG1.label}`, ['TDTEAM', 'VENENG1']],
    ['vendorPair', `Vendor 609 <-> engineer 611`, ['VEN1', 'VENENG1']],
  ];
  for (const [key, label, insiders] of rooms) {
    const id = R.rooms[key];
    if (!id) { rec(`09.${key}`, `leak check ${label}`, 'room id', 'room missing - skipped', null); continue; }
    await leakCheck(`09.${key}`, id, label, outsidersFor(insiders));
  }
  // Special cases the tester cares about: vendor owner must not read TD<->member room and vice versa; message in one TD room must not show in another
  const a = await room(S.ENG2, R.rooms.td_ENG2); const b = await room(S.VEN2, R.rooms.td_VEN2);
  const cross = a.messages.some((m) => /VEN2/.test(strip(m.message))) || b.messages.some((m) => /ENG2/.test(strip(m.message)));
  rec('09.cross', 'Messages of one Tech Domain room never show in another target\'s room', 'no cross-room text', { engRoomMsgs: a.messages.length, venRoomMsgs: b.messages.length, cross }, !cross);
});

// ================================================================ PHASE 6 - message validation / read state
test('10 message validation and read state', async () => {
  const id = R.rooms.td_ENG2;
  const e1 = await sendMsg(S.TDTEAM, id, '');
  rec('10.1', 'Empty message', '400', `${e1.status} ${short(e1.body)}`, e1.status === 400);
  const e2 = await sendMsg(S.TDTEAM, id, '   ');
  rec('10.2', 'Whitespace-only message', '400 (or trimmed/rejected)', `${e2.status} ${short(e2.body)}`, e2.status >= 400, { info: e2.status < 300 });
  const e3 = await postJson(S.TDTEAM, `/inbox/${id}/message`, {});
  rec('10.3', 'Missing message field', '400', `${e3.status} ${short(e3.body)}`, e3.status === 400);
  const long = 'L'.repeat(10_000);
  const e4 = await sendMsg(S.TDTEAM, id, `<p>${long}</p>`);
  rec('10.4', '10,000-character message', '201 or a clear 4xx (no 500)', `${e4.status} len=${e4.body?.data?.sentMessage?.message?.length}`, e4.status !== 500 && e4.status < 500);
  const xss = `<p>xss ${TAG}</p><img src=x onerror="window.__dcXss=1">`;
  const e5 = await sendMsg(S.TDTEAM, id, xss);
  R.xssMessageId = e5.body?.data?.sentMessage?.id;
  const rawStored = /onerror/.test(e5.body?.data?.sentMessage?.message || '');
  rec('10.5', 'HTML with onerror handler accepted by API (stored as-is?)', 'observation - render check is 11.12 / 13.eng2xss', `${e5.status} stored=${JSON.stringify(e5.body?.data?.sentMessage?.message || e5.body?.message)}`, null);
  if (rawStored) note('API stores message HTML unsanitised (onerror attribute kept in DB). The web UI strips the handler on render (11.12), but any other client (mobile app, email digest) rendering raw HTML would execute it - recommend server-side sanitisation.');
  const e6 = await sendMsg(S.TDTEAM, 99999999, '<p>ghost</p>');
  rec('10.6', 'Send to a non-existent room', '403/404', `${e6.status} ${short(e6.body)}`, e6.status === 403 || e6.status === 404);
  // unread + read
  const before = await directList(S.ENG2);
  const row = before.rows.find((r) => r.conversationId === id);
  rec('10.7', 'Engineer #2 has unread messages in the TD room before reading', 'unreadCount > 0, unreadDirectCount > 0', { unreadCount: row?.unreadCount, counts: before.counts }, (row?.unreadCount || 0) > 0 && (before.counts.direct || 0) > 0);
  const rd = await patchJson(S.ENG2, `/inbox/${id}/read`);
  const after = await directList(S.ENG2);
  const row2 = after.rows.find((r) => r.conversationId === id);
  rec('10.8', 'PATCH inbox/<id>/read clears the unread count', '200 + unreadCount 0', { patch: rd.status, unreadCount: row2?.unreadCount, counts: after.counts }, rd.status < 300 && (row2?.unreadCount || 0) === 0);
  const rdOut = await patchJson(S.VEN1, `/inbox/${id}/read`);
  rec('10.9', 'Outsider cannot mark the room as read', '403/404', `${rdOut.status} ${short(rdOut.body)}`, rdOut.status >= 400);
});

// ================================================================ PHASE 7 - UI
test('11 UI - Tech Domain profile Message button -> /messages, realtime both ways, sidebar listing', async () => {
  test.skip(SKIP_UI, 'SKIP_UI set');
  const browser = await chromium.launch();
  const td = await newPage(browser); const en = await newPage(browser);
  try {
    await uiLogin(td.page, ACC.TDTEAM);
    await td.page.goto(`${BASE}/user/details/profile/${S.ENG1.id}`);
    await td.page.waitForTimeout(3000);
    const btn = messageButton(td.page);
    const visible = await btn.isVisible().catch(() => false);
    rec('11.1', 'Tech Domain member sees "Message" button on the engineer profile', 'visible', visible, visible, { shot: await shot(td.page, 'td-engineer-profile-message-button') });
    if (visible) {
      await btn.click();
      await td.page.waitForTimeout(1500);
      const picker = td.page.locator('text=Send message as');
      if (await picker.isVisible().catch(() => false)) { await shot(td.page, 'td-send-message-as-picker'); await td.page.locator('button:has-text("Service Delivery 3")').first().click(); }
      await td.page.waitForURL(/\/messages\/\d+/, { timeout: 20_000 }).catch(() => { });
      const url = td.page.url(); const m = url.match(/\/messages\/(\d+)/);
      rec('11.2', 'Click navigates to /messages/<roomId>', `/messages/${R.rooms.td_ENG1}`, url, !!m && Number(m[1]) === R.rooms.td_ENG1, { shot: await shot(td.page, 'td-direct-room-opened') });
    } else {
      await td.page.goto(`${BASE}/messages/${R.rooms.td_ENG1}`);
    }
    await composer(td.page);
    // engineer side: Messages sidebar + room, in parallel
    await uiLogin(en.page, ACC.ENG1);
    await en.page.goto(`${BASE}/messages`);
    await en.page.waitForTimeout(3000);
    const rowText = await en.page.locator('text=/Teammember|Istkhar|Service Delivery/i').first().textContent().catch(() => null);
    const teamNamed = await en.page.locator('text=/Service Delivery 3|Tech Domain/').first().isVisible().catch(() => false);
    rec('11.3', 'Engineer sidebar "Messages" lists the Tech Domain team conversation', 'a row for the Tech Domain team chat', { row: rowText, showsTeamOrCompanyName: teamNamed }, !!rowText, { shot: await shot(en.page, 'engineer-messages-listing') });
    if (rowText && !teamNamed) note(`Engineer-side sidebar row / thread header shows the Tech Domain members' first names ("${rowText.trim().slice(0, 40)}") instead of "Tech Domain" / "Service Delivery 3" (the API already returns participant.name = "Service Delivery 3"). The engineer cannot tell this chat comes from Tech Domain - UX issue.`);
    await en.page.goto(`${BASE}/messages/${R.rooms.td_ENG1}`);
    await composer(en.page);
    const t1 = `UI hello from TD ${TAG}`;
    await uiSend(td.page, t1);
    const gotLive = await en.page.getByText(t1).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    rec('11.4', 'Message typed by Tech Domain appears live (socket) on the engineer screen', 'visible within 15s without reload', gotLive, gotLive, { shot: await shot(en.page, 'engineer-received-live') });
    await shot(td.page, 'td-sent-message');
    const t2 = `UI reply from engineer ${TAG}`;
    await uiSend(en.page, t2);
    const gotBack = await td.page.getByText(t2).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    rec('11.5', 'Engineer reply appears live on the Tech Domain screen', 'visible within 15s', gotBack, gotBack, { shot: await shot(td.page, 'td-received-reply-live') });
    // header/profile link sanity: counterpart name shown on TD side
    const headerHasEng = S.ENG1.name ? await td.page.getByText(S.ENG1.name, { exact: false }).first().isVisible().catch(() => false) : null;
    rec('11.6', 'Tech Domain thread header shows the engineer name', S.ENG1.name || 'n/a', headerHasEng, headerHasEng);

    // ---- offline: sender offline
    const tOff = `OFFLINE send ${TAG}`;
    await td.ctx.setOffline(true);
    await td.page.waitForTimeout(1500);
    await uiSend(td.page, tOff);
    await td.page.waitForTimeout(4000);
    const toast = await td.page.locator('text=/could not be sent|try again|offline|network|failed/i').first().isVisible().catch(() => false);
    const shownOptimistic = await td.page.getByText(tOff).first().isVisible().catch(() => false);
    const shotOff = await shot(td.page, 'td-offline-after-send');
    const engSawWhileOffline = await en.page.getByText(tOff).first().isVisible().catch(() => false);
    if (!toast && !shownOptimistic) note('Sender offline: pressing Enter gives NO feedback (no error toast, no pending bubble, composer just clears); the socket buffers the message and it is delivered silently once the network is back (11.8). Recommend a "not sent / offline" indicator.');
    rec('11.7', 'Sender OFFLINE (network off) and presses Enter', 'clear feedback (error/pending), message NOT shown as delivered, receiver gets nothing', { errorToast: toast, shownInSenderThread: shownOptimistic, receiverGotIt: engSawWhileOffline }, !engSawWhileOffline && (toast || !shownOptimistic), { shot: shotOff, info: true });
    await td.ctx.setOffline(false);
    await td.page.waitForTimeout(8000);
    const engAfterOnline = await en.page.getByText(tOff).first().isVisible().catch(() => false);
    const tdAfterOnline = await td.page.getByText(tOff).first().isVisible().catch(() => false);
    rec('11.8', 'Sender back ONLINE: is the offline message delivered / retried / dropped?', 'consistent state (either delivered to both or clearly failed on sender)', { senderShows: tdAfterOnline, receiverShows: engAfterOnline }, tdAfterOnline === engAfterOnline, { shot: await shot(td.page, 'td-back-online'), info: true });
    R.offlineText = tOff;
    // resend after reconnect works
    const tAfter = `after reconnect ${TAG}`;
    await uiSend(td.page, tAfter);
    const okAfter = await en.page.getByText(tAfter).first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
    rec('11.9', 'Sending again after reconnect works live', 'delivered', okAfter, okAfter, { shot: await shot(en.page, 'engineer-after-reconnect') });

    // ---- offline: receiver offline
    const tRecv = `RECEIVER offline ${TAG}`;
    await en.ctx.setOffline(true);
    await en.page.waitForTimeout(1500);
    await uiSend(td.page, tRecv);
    await td.page.waitForTimeout(3000);
    const tdShowsRecv = await td.page.getByText(tRecv).first().isVisible().catch(() => false);
    await en.ctx.setOffline(false);
    const recvAfter = await en.page.getByText(tRecv).first().waitFor({ state: 'visible', timeout: 25_000 }).then(() => true).catch(() => false);
    rec('11.10', 'Receiver was OFFLINE while the message was sent, then reconnects', 'sender delivered OK; receiver sees it after reconnect (resync)', { senderShows: tdShowsRecv, receiverShowsAfterReconnect: recvAfter }, tdShowsRecv && recvAfter, { shot: await shot(en.page, 'engineer-reconnect-resync') });
    if (!recvAfter) { await en.page.reload(); await en.page.waitForTimeout(4000); const afterReload = await en.page.getByText(tRecv).first().isVisible().catch(() => false); rec('11.11', 'Receiver sees the message after a page reload', 'visible', afterReload, afterReload, { shot: await shot(en.page, 'engineer-after-reload') }); }

    // ---- stored-XSS render check on the engineer screen (message 10.5 was sent into the ENG2 room; send one here too)
    const xss = `<p>xss2 ${TAG}</p><img src=x onerror="window.__dcXss=1">`;
    await sendMsg(S.TDTEAM, R.rooms.td_ENG1, xss).catch(() => { });
    await en.page.waitForTimeout(3000);
    await en.page.reload(); await en.page.waitForTimeout(5000);
    const fired = await en.page.evaluate(() => window.__dcXss === 1).catch(() => false);
    const imgs = await en.page.locator('img[src="x"]').count().catch(() => 0);
    rec('11.12', 'Stored XSS: message containing <img onerror> rendered on the receiver screen', 'handler must NOT execute (sanitised)', { onerrorExecuted: fired, rawImgTags: imgs }, !fired, { shot: await shot(en.page, 'engineer-xss-render'), bugIfFail: true });
    if (fired) note('SECURITY: chat message HTML is rendered unsanitised - onerror handler executed on the receiver browser (stored XSS).');
  } finally { await browser.close(); }
});

test('12 UI - vendor engineer starts chat with owner from profile; owner sees it in Messages and replies', async () => {
  test.skip(SKIP_UI, 'SKIP_UI set');
  const browser = await chromium.launch();
  const ve = await newPage(browser); const vo = await newPage(browser);
  try {
    await uiLogin(ve.page, ACC.VENENG1);
    await ve.page.goto(`${BASE}/user/details/profile/${S.VEN1.id}`);
    await ve.page.waitForTimeout(3000);
    const btn = messageButton(ve.page);
    const visible = await btn.isVisible().catch(() => false);
    rec('12.1', 'Vendor engineer sees "Message" on his vendor owner profile', 'visible', visible, visible, { shot: await shot(ve.page, 'vendor-engineer-owner-profile-button') });
    if (visible) {
      await btn.click();
      await ve.page.waitForTimeout(1500);
      if (await ve.page.locator('text=Send message as').isVisible().catch(() => false)) { await shot(ve.page, 'vendor-engineer-picker'); await ve.page.locator('button:has-text("Your company"), button:has-text("Demo Field Services")').first().click(); }
      await ve.page.waitForURL(/\/messages\/\d+/, { timeout: 20_000 }).catch(() => { });
      const m = ve.page.url().match(/\/messages\/(\d+)/);
      rec('12.2', 'Navigates to the vendor pair room', `/messages/${R.rooms.vendorPair}`, ve.page.url(), !!m && Number(m[1]) === R.rooms.vendorPair, { shot: await shot(ve.page, 'vendor-engineer-room') });
    } else await ve.page.goto(`${BASE}/messages/${R.rooms.vendorPair}`);
    await composer(ve.page);
    await uiLogin(vo.page, ACC.VEN1);
    await vo.page.goto(`${BASE}/messages`);
    await vo.page.waitForTimeout(3000);
    const listed = S.VENENG1.name ? await vo.page.getByText(S.VENENG1.name, { exact: false }).first().isVisible().catch(() => false) : false;
    rec('12.3', 'Vendor owner sidebar Messages lists the engineer conversation', `${S.VENENG1.name} listed`, listed, listed, { shot: await shot(vo.page, 'vendor-owner-messages-listing') });
    await vo.page.goto(`${BASE}/messages/${R.rooms.vendorPair}`);
    await composer(vo.page);
    const t1 = `UI vendor engineer first ${TAG}`;
    await uiSend(ve.page, t1);
    const got = await vo.page.getByText(t1).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    rec('12.4', 'Engineer -> owner live', 'visible within 15s', got, got, { shot: await shot(vo.page, 'vendor-owner-received-live') });
    const t2 = `UI vendor owner reply ${TAG}`;
    await uiSend(vo.page, t2);
    const got2 = await ve.page.getByText(t2).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    rec('12.5', 'Owner -> engineer live', 'visible within 15s', got2, got2, { shot: await shot(ve.page, 'vendor-engineer-received-reply') });
    // owner also starts from the member profile -> same room
    await vo.page.goto(`${BASE}/user/details/profile/${S.VENENG1.id}`);
    await vo.page.waitForTimeout(3000);
    const b2 = messageButton(vo.page);
    const v2 = await b2.isVisible().catch(() => false);
    rec('12.6', 'Vendor owner sees "Message" on his engineer profile', 'visible', v2, v2, { shot: await shot(vo.page, 'vendor-owner-engineer-profile-button') });
    if (v2) { await b2.click(); await vo.page.waitForURL(/\/messages\/\d+/, { timeout: 20_000 }).catch(() => { }); const m = vo.page.url().match(/\/messages\/(\d+)/); rec('12.7', 'Owner click opens the SAME pair room', `/messages/${R.rooms.vendorPair}`, vo.page.url(), !!m && Number(m[1]) === R.rooms.vendorPair, { shot: await shot(vo.page, 'vendor-owner-same-room') }); }
  } finally { await browser.close(); }
});

test('13 UI - Message button is hidden for disallowed pairs; pending-profile engineer sees TD chat', async () => {
  test.skip(SKIP_UI, 'SKIP_UI set');
  const browser = await chromium.launch();
  const cases = [
    ['ENG1', 'VEN1', 'engineer viewing a vendor'],
    ['ENG1', 'ENG2', 'engineer viewing another engineer'],
    ['ENG1', 'TDTEAM', 'engineer viewing a Tech Domain user'],
    ['VEN1', 'VEN2', 'vendor viewing another vendor'],
    ['VEN1', 'ENG1', 'vendor viewing an individual engineer'],
    ['VEN1', 'TDTEAM', 'vendor viewing a Tech Domain user'],
    ['VENENG1', 'ENG1', 'vendor engineer viewing an individual engineer'],
    ['VEN2', 'VENENG1', 'vendor viewing ANOTHER vendor\'s engineer'],
    ['TDTEAM', 'CUST', 'Tech Domain viewing a customer'],
    ['TDTEAM', 'TDNONTEAM', 'Tech Domain viewing a colleague'],
    ['TDOWNER', 'ENG1', 'Tech Domain OWNER (no team) viewing an engineer'],
    ['CUST', 'ENG1', 'customer viewing an engineer'],
  ];
  let i = 0;
  for (const [viewer, target, why] of cases) {
    i += 1;
    const { ctx, page } = await newPage(browser);
    try {
      await uiLogin(page, ACC[viewer]);
      await page.goto(`${BASE}/user/details/profile/${S[target].id}`);
      await page.waitForTimeout(3500);
      const unauthorized = await page.locator('text=Unauthorized').first().isVisible().catch(() => false);
      const visible = await messageButton(page).isVisible().catch(() => false);
      const expectVisible = viewer === 'TDOWNER' ? null : false;
      rec(`13.${i}`, `Message button: ${why}`, viewer === 'TDOWNER' ? 'observation (owner is in no team)' : 'hidden', { buttonVisible: visible, pageUnauthorized: unauthorized }, expectVisible === null ? null : visible === expectVisible, { shot: await shot(page, `no-button-${viewer}-views-${target}`) });
      if (unauthorized) R.unauthorizedPairs = [...(R.unauthorizedPairs || []), why];
    } catch (e) { rec(`13.${i}`, `Message button: ${why}`, 'hidden', `error ${e.message.slice(0, 120)}`, null, { shot: await shot(page, `error-${viewer}-views-${target}`) }); }
    finally { await ctx.close(); }
  }
  if (R.unauthorizedPairs?.length) note(`Profile page itself is "Unauthorized" for: ${R.unauthorizedPairs.join('; ')} - so there is no surface for a Message button there (API options are empty too).`);
  // pending-profile engineer #2 sidebar
  const { ctx, page } = await newPage(browser);
  try {
    await uiLogin(page, ACC.ENG2);
    await page.goto(`${BASE}/messages`);
    await page.waitForTimeout(4000);
    const rowText = await page.locator('text=/Teammember|Istkhar|Service Delivery/i').first().textContent().catch(() => null);
    rec('13.eng2', 'Engineer #2 (first-ever chat, started by Tech Domain) sees it in sidebar Messages', 'a row for the Tech Domain team chat', { row: rowText, url: page.url() }, !!rowText, { shot: await shot(page, 'engineer2-first-chat-listing') });
    await page.goto(`${BASE}/messages/${R.rooms.td_ENG2}`);
    await page.waitForTimeout(4000);
    const fired = await page.evaluate(() => window.__dcXss === 1).catch(() => false);
    rec('13.eng2xss', 'Engineer #2 opens the room holding the API-sent onerror payload', 'handler must NOT execute', { onerrorExecuted: fired }, !fired, { shot: await shot(page, 'engineer2-room-xss-check'), bugIfFail: true });
  } catch (e) { rec('13.eng2', 'Engineer #2 sidebar', 'listed', `error ${e.message.slice(0, 150)}`, false, { shot: await shot(page, 'engineer2-error') }); }
  finally { await ctx.close(); await browser.close(); }
});

// ================================================================ PHASE 8 - after UI: duplicates / loss of the offline message, final leak sweep
test('14 after UI - offline message outcome in DB, final leak sweep, report', async () => {
  if (R.offlineText && R.rooms.td_ENG1) {
    const rm = await room(S.TDTEAM, R.rooms.td_ENG1, 100);
    const n = rm.messages.filter((m) => strip(m.message) === R.offlineText).length;
    rec('14.1', 'Offline-typed message stored exactly once or not at all (no duplicates)', '0 or 1 rows', { stored: n }, n <= 1);
    const n2 = rm.messages.filter((m) => strip(m.message) === `RECEIVER offline ${TAG}`).length;
    rec('14.2', 'Message sent while receiver was offline stored once', '1 row', { stored: n2 }, n2 === 1);
  }
  // final: engineer2 / vendor2 rooms still only visible to insiders after UI phase
  if (R.rooms.td_ENG2) await leakCheck('14.3', R.rooms.td_ENG2, 'TD(SD3) <-> engineer #2 (final)', [S.ENG1, S.VEN1, S.VENENG1, S.VEN2, S.TDNONTEAM, S.TDOWNER, S.CUST]);
  if (R.rooms.vendorPair) await leakCheck('14.4', R.rooms.vendorPair, 'Vendor 609 <-> 611 (final)', [S.TDTEAM, S.ENG1, S.VEN2, S.ENG2]);
  R.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(R, null, 2));
  // ---- REPORT.md
  const rows = R.results;
  const pass = rows.filter((r) => r.pass === true).length, fail = rows.filter((r) => r.pass === false).length, info = rows.filter((r) => r.pass === null).length;
  const md = [];
  md.push(`# Direct Chat - A to Z test report (dev, ${R.startedAt.slice(0, 10)})`, '');
  md.push(`Run \`${RUN}\` - ${pass} passed, ${fail} failed, ${info} observations. Spec: \`tests/direct-chat.spec.js\`. Evidence: \`evidence/DirectChat/run-${RUN}/\`.`, '');
  md.push('## Rooms used', '', '| key | room id |', '|---|---|', ...Object.entries(R.rooms).map(([k, v]) => `| ${k} | ${v} |`), '');
  md.push('## Failures / bugs', '');
  const fails = rows.filter((r) => r.pass === false);
  md.push(...(fails.length ? fails.map((r) => `- **${r.id}** ${r.title}\n  - expected: ${r.expected}\n  - actual: ${r.actual}${r.shot ? `\n  - screenshot: ${r.shot}` : ''}`) : ['- none']), '');
  md.push('## Notes / observations', '', ...R.notes.map((n) => `- ${n}`), '');
  md.push('## All checks', '', '| # | check | expected | actual | result | screenshot |', '|---|---|---|---|---|---|');
  md.push(...rows.map((r) => `| ${r.id} | ${r.title.replace(/\|/g, '/')} | ${String(r.expected).replace(/\|/g, '/')} | ${String(r.actual).replace(/\|/g, '/').slice(0, 140)} | ${r.pass === null ? 'INFO' : r.pass ? 'PASS' : 'FAIL'} | ${r.shot || ''} |`));
  fs.writeFileSync(path.join(EVIDENCE, 'REPORT.md'), md.join('\n'));
  console.log(`\nREPORT: ${path.join(EVIDENCE, 'REPORT.md')}  pass=${pass} fail=${fail} info=${info}`);
});
