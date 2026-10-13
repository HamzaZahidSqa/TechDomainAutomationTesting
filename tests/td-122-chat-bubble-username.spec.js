// TD-122: "Fix chat bubbles username, currently it displays vendor company name for all"  (Bug, Production, hotfix)
// https://techdomain.atlassian.net/browse/TD-122
//
// Reading: in a work order chat that involves a vendor company, the name shown above each chat bubble must be the
// SENDER's user name (e.g. "Demo CompanyOwner", "Demo Worker", "istkhar Hussain"), not the vendor company name
// ("Demo Field Services 0925") for every bubble. The company name may still be the conversation title.
//
// Setup (already done on dev, reusable): WO 981 (customer entity 104, Tech Domain company 9) ASSIGNED to vendor
// engineer 611 "Demo Worker" of vendor 79 "Demo Field Services 0925" (owner 609 "Demo CompanyOwner").
// Threads: Tech Domain <-> vendor owner (room 1800, TD opens ?engineerId=609, vendor owner clicks the "Tech Domain" row),
//          vendor owner <-> vendor worker (vendor owner clicks "Demo Worker", worker auto-opens it).
//
// Part A (API): message sender objects carry firstName/lastName (what the bubble renders) - info.
// Part B (UI): each party sends a tagged message, then every view is read: the name on each counterpart bubble must be
//   the sender's user name and no bubble row may carry the vendor company name.
//
// Run:  npx playwright test tests/td-122-chat-bubble-username.spec.js --reporter=line --trace off   (env WO_ID to reuse another WO)
// Evidence: evidence/TD-122-ChatBubbleUsername/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-122-ChatBubbleUsername', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const WO = Number(process.env.WO_ID || 981);
const VENDOR_OWNER_ID = 609, VENDOR_COMPANY = /Demo Field Services/i;
const TAG = `TD122-${RUN}`;
const NAMES = { td: 'istkhar Hussain', vo: 'Demo CompanyOwner', ve: 'Demo Worker' };

test.setTimeout(600_000);
let shotNo = 0;
async function shot(page, name, full = false) { shotNo += 1; const f = path.join(EVIDENCE, `TD-122_ChatBubble_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: full }).catch(() => { }); return path.basename(f); }
async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({})); await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`);
  return { api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } }), id: body.data?.id };
}
const getJson = async (s, p) => { const r = await s.api.get(u(p)); return { status: r.status(), body: await r.json().catch(() => null) }; };
const texts = async (loc) => (await loc.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
async function openChat(browser, account, query) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, geolocation: { latitude: 31.52, longitude: 74.36 }, permissions: ['geolocation'] });
  const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  await page.goto('/login'); await page.waitForTimeout(2_000);
  await page.locator('input[type="email"], input[name="email"]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login")').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await page.goto(`/workOrder/messages/${WO}${query || ''}`);
  await page.waitForTimeout(7_000);
  return { ctx, page };
}
const selectThread = async (page, rowText) => { const row = page.getByText(rowText, { exact: true }).first(); await expect(row, `sidebar row "${rowText}"`).toBeVisible({ timeout: 20_000 }); await row.click(); await page.waitForTimeout(4_000); };
const send = async (page, text) => { const ed = page.locator('.ql-editor').first(); await expect(ed).toBeVisible({ timeout: 20_000 }); await ed.click(); await ed.fill(text); await page.keyboard.press('Enter'); await page.waitForTimeout(3_000); };
// every bubble row that carries one of our tagged messages: "<name> <time> <emoji> <text>" (own messages have no name)
async function bubbleRows(page) {
  const rows = page.locator('[class*="group/row"]'); const n = await rows.count(); const out = [];
  for (let i = 0; i < n; i++) { const t = (await rows.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim(); if (t.includes(TAG)) out.push(t); }
  return out;
}
const rowFor = (rows, who) => rows.find((r) => r.includes(`${TAG} from ${who}`)) || '';
const nameOn = (row) => row.replace(/\d{1,2}:\d{2} [AP]M.*$/, '').trim(); // text before the time stamp = displayed sender name ('' for own bubbles)

test('TD-122 chat bubbles show the sender user name, not the vendor company name', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, wo: WO, tag: TAG, checks: [], findings: [], api: {}, ui: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 600)}`); };
  const tdAcc = accounts.find((a) => a.role === 'TechDomain User'), voAcc = accounts.find((a) => a.role === 'Vendor'), veAcc = accounts.find((a) => a.role === 'Vendor Engineer');

  // ---------------- precondition ----------------
  const tdApi = await apiLogin(tdAcc);
  const wo = (await getJson(tdApi, `/workOrders/${WO}`)).body?.data;
  results.api.wo = { status: wo?.status, engineer: wo?.engineer && `${wo.engineer.id} ${wo.engineer.firstName} ${wo.engineer.lastName}`, company: wo?.engineerCompany?.name };
  check(`precondition: WO ${WO} is ASSIGNED to a vendor engineer of a vendor company`, wo?.status === 'ASSIGNED' && !!wo?.engineerCompany?.name, results.api.wo);
  const rooms = (await getJson(tdApi, `/chats/users/${WO}/9`)).body?.data || [];
  const vendorRoom = rooms.find((r) => r.id === VENDOR_OWNER_ID && !r.isCustomerChat);
  info('Tech Domain chat rooms for the WO', rooms.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), room: r.chatRoomId, customer: r.isCustomerChat })));
  await tdApi.api.dispose();

  // ---------------- Part B: send one tagged message per party in each thread ----------------
  const vo = await openChat(browser, voAcc, '');
  await selectThread(vo.page, 'Tech Domain');
  await send(vo.page, `${TAG} from Vendor owner (to Tech Domain)`);
  await selectThread(vo.page, 'Demo Worker');
  await send(vo.page, `${TAG} from Vendor owner (to worker)`);
  const td = await openChat(browser, tdAcc, `?engineerId=${VENDOR_OWNER_ID}`);
  await send(td.page, `${TAG} from Tech Domain user`);
  const ve = await openChat(browser, veAcc, '');
  await send(ve.page, `${TAG} from Vendor worker`);
  await new Promise((r) => setTimeout(r, 3_000));

  // ---------------- read every view ----------------
  // TD view: Tech Domain <-> vendor thread
  await td.page.reload(); await td.page.waitForTimeout(7_000);
  const tdRows = await bubbleRows(td.page);
  const tdHeader = (await texts(td.page.locator('h5, h6, p.font-medium, p.font-semibold'))).filter((t) => t.length < 40);
  await shot(td.page, 'techdomain-view-vendor-thread');
  results.ui.td = { rows: tdRows, header: tdHeader };
  check('TD view: vendor owner\'s bubble is labelled with the sender user name', nameOn(rowFor(tdRows, 'Vendor owner (to Tech Domain)')) === NAMES.vo, { row: rowFor(tdRows, 'Vendor owner (to Tech Domain)'), expected: NAMES.vo });
  check('TD view: own bubble has no company label', rowFor(tdRows, 'Tech Domain user') !== '' && !VENDOR_COMPANY.test(rowFor(tdRows, 'Tech Domain user')), { row: rowFor(tdRows, 'Tech Domain user') });
  check('TD view: no bubble row shows the vendor company name', tdRows.length >= 2 && !tdRows.some((r) => VENDOR_COMPANY.test(r)), { rows: tdRows });
  info('TD view: conversation title / sidebar (company name allowed here)', { header: tdHeader, sidebar: (await texts(td.page.locator('p'))).filter((t) => VENDOR_COMPANY.test(t)).slice(0, 3) });
  await td.ctx.close();

  // Vendor owner view: Tech Domain thread + worker thread
  await vo.page.reload(); await vo.page.waitForTimeout(7_000);
  await selectThread(vo.page, 'Tech Domain');
  const voTdRows = await bubbleRows(vo.page);
  await shot(vo.page, 'vendor-owner-view-techdomain-thread');
  check('Vendor owner view (Tech Domain thread): TD user\'s bubble is labelled with the sender user name', nameOn(rowFor(voTdRows, 'Tech Domain user')) === NAMES.td, { row: rowFor(voTdRows, 'Tech Domain user'), expected: NAMES.td });
  check('Vendor owner view (Tech Domain thread): no bubble shows the vendor company name', voTdRows.length >= 2 && !voTdRows.some((r) => VENDOR_COMPANY.test(r)), { rows: voTdRows });
  await selectThread(vo.page, 'Demo Worker');
  const voVeRows = await bubbleRows(vo.page);
  await shot(vo.page, 'vendor-owner-view-worker-thread');
  check('Vendor owner view (worker thread): worker\'s bubble is labelled "Demo Worker"', nameOn(rowFor(voVeRows, 'Vendor worker')) === NAMES.ve, { row: rowFor(voVeRows, 'Vendor worker'), expected: NAMES.ve });
  check('Vendor owner view (worker thread): no bubble shows the vendor company name', voVeRows.length >= 2 && !voVeRows.some((r) => VENDOR_COMPANY.test(r)), { rows: voVeRows });
  results.ui.vo = { tdThread: voTdRows, workerThread: voVeRows };
  await vo.ctx.close();

  // Vendor worker view
  await ve.page.reload(); await ve.page.waitForTimeout(7_000);
  const veRows = await bubbleRows(ve.page);
  const veHeader = (await texts(ve.page.locator('h5, h6, p.font-medium, p.font-semibold'))).filter((t) => t.length < 40);
  await shot(ve.page, 'vendor-worker-view');
  results.ui.ve = { rows: veRows, header: veHeader };
  check('Vendor worker view: owner\'s bubble is labelled "Demo CompanyOwner"', nameOn(rowFor(veRows, 'Vendor owner (to worker)')) === NAMES.vo, { row: rowFor(veRows, 'Vendor owner (to worker)'), expected: NAMES.vo });
  check('Vendor worker view: no bubble shows the vendor company name', veRows.length >= 2 && !veRows.some((r) => VENDOR_COMPANY.test(r)), { rows: veRows });
  info('Vendor worker view: thread title (company name allowed here)', { header: veHeader });
  await ve.ctx.close();

  // ---------------- Part A: API shape behind the bubbles (info) ----------------
  const tdApi2 = await apiLogin(tdAcc);
  if (vendorRoom?.chatRoomId) {
    const msgs = (await getJson(tdApi2, `/chats/${vendorRoom.chatRoomId}?limit=10`)).body?.data?.messages || [];
    const ours = msgs.filter((m) => (m.message || '').includes(TAG)).map((m) => ({ senderId: m.senderId, sender: m.sender && `${m.sender.firstName} ${m.sender.lastName}`, hasCompanyField: !!(m.sender && (m.sender.company || m.sender.companyName)) }));
    results.api.messages = ours;
    info(`A: GET /chats/${vendorRoom.chatRoomId} sender objects (firstName/lastName, no company)`, ours);
    const conv = (await getJson(tdApi2, `/inbox/${vendorRoom.chatRoomId}?markAsRead=false&limit=1`)).body?.data?.conversation;
    info('A: conversation participant (the thread title source) vs participants', { participant: conv?.participant && `${conv.participant.type} ${conv.participant.name}`, participants: (conv?.participants || []).map((p) => `${p.id} ${p.name} ${p.role}`) });
  }
  await tdApi2.api.dispose();

  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  for (const c of results.checks) if (!c.ok) results.findings.push(c.name);
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
