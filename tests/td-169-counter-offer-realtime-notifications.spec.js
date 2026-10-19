// TD-169 - Counter offer notifications do not update in real time (only after reload).
// https://techdomain.atlassian.net/browse/TD-169
//
// Method: one side keeps a browser page open on the work order (no reload, no click); the other side performs the
// counter-offer action through the API. For 40 s the open page is polled every second for: the bell badge count,
// the work order header sub-status / tabs / banner, socket.io frames received (notification, workOrder:update...)
// and HTTP requests fired (notifications/*, workOrders/*, offers/*). Then the bell is clicked (does it appear "on click"?)
// and finally the page is reloaded (does it appear after reload?). Server-side truth: GET /notifications/others diff.
//
//   WO 1 - customer page open:     Tech Domain SENDS counter, EDITS it, WITHDRAWS it
//   WO 2 - Tech Domain page open:  customer ACCEPTS the counter
//   WO 3 - Tech Domain page open:  customer DECLINES the counter
//
// Run:  npx playwright test tests/td-169-counter-offer-realtime-notifications.spec.js --reporter=line --trace off
// Evidence: evidence/TD-169-CounterOfferRealtime/run-<stamp>/  (TD-169_CounterOfferRealtime_NN_<step>.png, results.json, summary.txt)

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-169-CounterOfferRealtime', `run-${RUN}`);
const WATCH_MS = Number(process.env.WATCH_MS || 40_000);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const ENTITY_ID = 104;
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const COUNTER = { hourlyRate: 60, minimumHours: 4, additionalHourlyRate: 65, expenses: [{ expenseType: 'TOOLS', description: 'Ladder hire', amount: 20 }] };
const COUNTER_V2 = { hourlyRate: 58, minimumHours: 4, additionalHourlyRate: 62, expenses: [{ expenseType: 'TOOLS', description: 'Ladder hire', amount: 20 }, { expenseType: 'OTHER', description: 'Parking', amount: 10 }] };

test.setTimeout(1_500_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-169_CounterOfferRealtime_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: false }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status}`);
  const s = { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), id: l.body.data?.id, name: `${l.body.data?.firstName || ''} ${l.body.data?.lastName || ''}`.trim() };
  s.relogin = async () => { const n = await rawLogin(account.email, account.password); if (!n.body.accessToken) return false; s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${n.body.accessToken}` } }); return true; };
  return s;
}
async function call(s, method, p, data) {
  const opts = data === undefined ? undefined : { data };
  let r = await s.api[method](u(p), opts);
  if (r.status() === 401 && (await s.relogin())) r = await s.api[method](u(p), opts);
  return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) };
}
const getJson = (s, p) => call(s, 'get', p);
const postJson = (s, p, d) => call(s, 'post', p, d);
const patchJson = (s, p, d) => call(s, 'patch', p, d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString().slice(11, 23);

function customerWoPayload(title, day) { return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'QA TD-169: counter-offer notifications in real time', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [{ expenseType: 'TRAVEL', description: 'Customer travel', amount: 30 }], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5, additionalHourlyRate: 50, nonBusinessHourRate: null, purchaseOrderNumber: '', halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }

async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 });
  await page.waitForTimeout(3_000);
}

// ---------- page observers: socket frames + HTTP requests, time-stamped ----------
function observe(page, label) {
  const o = { label, frames: [], requests: [], mark: Date.now() };
  o.reset = () => { o.frames = []; o.requests = []; o.mark = Date.now(); };
  o.rel = (t) => `+${((t - o.mark) / 1000).toFixed(1)}s`;
  page.on('websocket', (ws) => {
    o.sockets = (o.sockets || 0) + 1;
    ws.on('framereceived', (f) => { const p = String(f.payload || ''); if (p === '2' || p === '3' || p.startsWith('0{') || p === '40' || p.startsWith('40{')) return; o.frames.push({ t: Date.now(), payload: p.slice(0, 400) }); });
    ws.on('close', () => o.frames.push({ t: Date.now(), payload: '<socket closed>' }));
  });
  page.on('request', (r) => { const url = r.url(); if (/notifications|workOrders\/\d+|offers\/|inbox/i.test(url) && !/socket\.io/.test(url)) o.requests.push({ t: Date.now(), m: r.method(), url: url.replace(API_URL, '') }); });
  page.on('response', async (r) => { const url = r.url(); if (/\/notifications\/others/.test(url) && r.status() === 200) { try { const j = await r.json(); o.lastUnread = j?.data?.unreadNotificationCount; } catch { } } });
  o.snapshotFrames = () => o.frames.map((f) => `${o.rel(f.t)} ${f.payload.slice(0, 220)}`);
  o.snapshotRequests = () => o.requests.map((r) => `${o.rel(r.t)} ${r.m} ${r.url}`);
  return o;
}

async function readBell(page) {
  return page.evaluate(() => {
    const i = document.querySelector('i[class*="fa-bell-ring"][class*="text-xl"]');
    const root = i && i.closest('.MuiBadge-root');
    const b = root && root.querySelector('.MuiBadge-badge');
    const txt = b ? b.textContent.trim() : '';
    const invisible = !b || /MuiBadge-invisible/.test(b.className);
    return { count: invisible ? 0 : Number(txt) || 0, raw: txt, found: !!i };
  }).catch(() => ({ count: -1, raw: 'n/a', found: false }));
}
async function readState(page, ref) {
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const idx = body.indexOf(`#${ref}`);
  const header = idx >= 0 ? body.slice(Math.max(0, idx - 110), idx + 12) : body.slice(0, 120);
  const tabs = await page.getByRole('tab').allInnerTexts().catch(() => []);
  const bannerMatch = body.match(/.{0,40}(Counter Offer (Sent|Accepted|Declined|Withdrawn|Review)|Proposal (Received|Accepted|Declined|Withdrawn)|Awaiting the customer[^.]{0,120}|has (accepted|declined) [^.]{0,80}).{0,80}/i);
  return { header: header.trim(), tabs: tabs.map((t) => t.trim()).filter(Boolean), banner: bannerMatch ? bannerMatch[0].trim() : '', url: page.url() };
}
// poll the page for WATCH_MS without touching it; record when the bell count and the expected state first change
async function watch(page, ref, obs, { baselineBell, stateDone }) {
  const t0 = Date.now(); const timeline = []; let bellAt = null, stateAt = null, last = null;
  while (Date.now() - t0 < WATCH_MS) {
    const bell = await readBell(page); const st = await readState(page, ref);
    const rel = ((Date.now() - t0) / 1000).toFixed(1);
    const sig = `${bell.count}|${st.header}|${st.tabs.join(',')}|${st.banner}`;
    if (sig !== last) { timeline.push({ at: `+${rel}s`, bell: bell.count, header: st.header, tabs: st.tabs, banner: st.banner }); last = sig; }
    if (bellAt === null && bell.count > baselineBell) bellAt = `+${rel}s`;
    if (stateAt === null && stateDone(st)) stateAt = `+${rel}s`;
    if (bellAt && stateAt && Date.now() - t0 > 8_000) break;
    await sleep(1_000);
  }
  const bell = await readBell(page); const st = await readState(page, ref);
  return { bellAt, stateAt, finalBell: bell.count, finalState: st, timeline, frames: obs.snapshotFrames(), requests: obs.snapshotRequests(), watchedSeconds: ((Date.now() - t0) / 1000).toFixed(0) };
}
async function openBell(page) {
  const bell = page.locator('i[class*="fa-bell-ring"][class*="text-xl"]').first();
  await bell.click({ timeout: 10_000 }).catch(() => { });
  await page.waitForTimeout(2_500);
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const i = body.indexOf('Notifications');
  return i >= 0 ? body.slice(i, i + 700) : body.slice(0, 400);
}
async function closeBell(page) { await page.locator('i[class*="fa-bell-ring"][class*="text-xl"]').first().click({ timeout: 5_000 }).catch(() => { }); await page.waitForTimeout(800); }

test('TD-169 counter-offer notifications and work-order state update in real time (no reload)', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(`${now()} ${m}`); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, watchMs: WATCH_MS, checks: [], findings: [], workOrders: {}, events: [] };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const td = await apiLogin(tdAcc, 'Tech Domain');
  const cust = await apiLogin(custAcc, 'Customer owner');
  log(`Tech Domain ${td.id} "${td.name}", customer owner ${cust.id} "${cust.name}"`);
  const minute = Math.floor(Date.now() / 60_000);
  const slot = new Date(Date.now() + (200 + (minute % 60)) * 86_400_000); const slotDay = slot.toISOString().slice(0, 10);

  // server-side notification truth, id-diff per receiver
  const seen = { td: new Set(), cust: new Set() };
  async function serverNotifs(who, woId, ref) {
    const s = who === 'td' ? td : cust;
    const n = await getJson(s, `/notifications/others?userId=${s.id}&limit=40`);
    const all = n.body?.data?.data || [];
    const rows = all.filter((r) => r.workOrderId === woId || String(r.title).includes(String(ref)) || plain(r.content).includes(String(ref)));
    const fresh = rows.filter((r) => !seen[who].has(r.id)); for (const r of fresh) seen[who].add(r.id);
    return { fresh: fresh.map((r) => ({ id: r.id, type: r.type, title: r.title, content: plain(r.content).slice(0, 140), url: r.url, createdAt: r.createdAt })), unreadNotificationCount: n.body?.data?.unreadNotificationCount };
  }
  async function createWo(tag) {
    const title = `TD-169 realtime ${tag} ${RUN}`;
    const cr = await postJson(cust, '/workOrders', customerWoPayload(title, slotDay));
    let id = cr.body?.data?.id || cr.body?.id;
    if (!id) { const list = await getJson(cust, `/workOrders/customer?page=1&limit=5&search=${encodeURIComponent(title)}`); id = (list.body?.data?.workOrders || list.body?.data?.data || list.body?.data || [])[0]?.id; }
    expect(id, `customer WO ${tag} created`).toBeTruthy();
    const w = (await getJson(td, `/workOrders/${id}`)).body?.data || {};
    results.workOrders[tag] = { id, ref: w.referenceId, title, status: w.status, subStatus: w.subStatus };
    log(`WO ${tag}: ${id} (#${w.referenceId}) ${w.status}/${w.subStatus}`);
    await sleep(2_000); await serverNotifs('cust', id, w.referenceId); await serverNotifs('td', id, w.referenceId);
    return results.workOrders[tag];
  }

  // One observed event: the open page belongs to `watcher` ('cust' | 'td'); `action` is run on the other side.
  async function runEvent({ name, page, obs, watcher, wo, action, expectState, stateLabel, expectNotified = true }) {
    log(`\n===== ${name} (watching the ${watcher === 'cust' ? 'customer' : 'Tech Domain'} page, WO ${wo.id} #${wo.ref}) =====`);
    obs.reset();
    const baseBell = (await readBell(page)).count; const baseState = await readState(page, wo.ref);
    const ev = { name, watcher, wo: wo.id, ref: wo.ref, baseline: { bell: baseBell, ...baseState }, startedAt: new Date().toISOString() };
    log(`[${name}] baseline bell=${baseBell} header="${baseState.header}" tabs=${baseState.tabs.join(',')} banner="${baseState.banner}"`);
    const act = await action(); ev.action = act; log(`[${name}] action -> HTTP ${act.status} ${JSON.stringify(act.body).slice(0, 160)}`);
    expect(act.status, `${name} action`).toBeLessThan(300);
    const w = await watch(page, wo.ref, obs, { baselineBell: baseBell, stateDone: expectState });
    ev.watch = w;
    log(`[${name}] watched ${w.watchedSeconds}s: bell ${baseBell} -> ${w.finalBell} (first change ${w.bellAt || 'never'}), ${stateLabel}: ${w.stateAt || 'never'} | header="${w.finalState.header}" tabs=${w.finalState.tabs.join(',')} banner="${w.finalState.banner}"`);
    log(`[${name}] socket frames: ${w.frames.length ? w.frames.join(' || ') : 'none'}`);
    log(`[${name}] http requests: ${w.requests.length ? w.requests.join(' | ') : 'none'}`);
    ev.shots = { noReload: await shot(page, `${name}-after-${w.watchedSeconds}s-no-reload`) };
    // server truth
    await sleep(1_500);
    ev.server = await serverNotifs(watcher, wo.id, wo.ref);
    log(`[${name}] server notifications for the watcher: ${ev.server.fresh.map((r) => `${r.type} | ${r.title} | ${r.content.slice(0, 70)}`).join(' ;; ') || 'none'} (unread ${ev.server.unreadNotificationCount})`);
    // bell click
    ev.panelOnClick = await openBell(page); ev.shots.bellClick = await shot(page, `${name}-bell-clicked`);
    ev.requestsOnClick = obs.snapshotRequests().slice(w.requests.length);
    log(`[${name}] bell panel after click: "${ev.panelOnClick.slice(0, 300)}" | new requests on click: ${ev.requestsOnClick.join(' | ') || 'none'}`);
    await closeBell(page);
    // reload
    await page.reload().catch(() => { }); await page.waitForTimeout(6_000);
    ev.afterReload = { bell: (await readBell(page)).count, ...(await readState(page, wo.ref)) };
    ev.shots.reload = await shot(page, `${name}-after-reload`);
    log(`[${name}] after reload: bell=${ev.afterReload.bell} header="${ev.afterReload.header}" tabs=${ev.afterReload.tabs.join(',')} banner="${ev.afterReload.banner}"`);
    results.events.push(ev);

    const notifFrame = w.frames.some((f) => /\["notification"/.test(f));
    const woFrame = w.frames.some((f) => /workOrder/.test(f));
    const serverHas = ev.server.fresh.length > 0;
    const realtimeBell = w.bellAt !== null;
    const realtimeState = w.stateAt !== null;
    if (expectNotified) {
      check(`[${name}] server created a notification for the ${watcher === 'cust' ? 'customer' : 'Tech Domain'}`, serverHas, ev.server.fresh.map((r) => `${r.type} | ${r.title}`));
      check(`[${name}] bell badge count increased in real time (no reload/click) within ${WATCH_MS / 1000}s`, realtimeBell, { baseline: baseBell, final: w.finalBell, firstChange: w.bellAt, socketNotificationFrame: notifFrame });
      info(`[${name}] socket 'notification' frame received by the page`, { received: notifFrame, frames: w.frames.slice(0, 6) });
      check(`[${name}] notification visible when the bell is clicked (no reload)`, /proposal|counter|offer/i.test(ev.panelOnClick), { panel: ev.panelOnClick.slice(0, 200), requestsOnClick: ev.requestsOnClick });
      check(`[${name}] notification counted after reload (badge ${ev.afterReload.bell})`, ev.afterReload.bell > 0 || serverHas, { bell: ev.afterReload.bell });
    } else {
      info(`[${name}] watcher notifications (own action / none expected)`, { server: ev.server.fresh, bell: `${baseBell} -> ${w.finalBell}` });
    }
    check(`[${name}] work order state "${stateLabel}" updated in real time (no reload) within ${WATCH_MS / 1000}s`, realtimeState, { firstChange: w.stateAt, header: w.finalState.header, tabs: w.finalState.tabs, banner: w.finalState.banner, workOrderSocketFrame: woFrame, requestsDuringWatch: w.requests.slice(0, 8) });
    check(`[${name}] work order state "${stateLabel}" correct after reload`, expectState(ev.afterReload), { header: ev.afterReload.header, tabs: ev.afterReload.tabs, banner: ev.afterReload.banner });
    return ev;
  }

  // =============================== WO 1: customer page open ===============================
  const W1 = await createWo('WO1-customer-watches');
  const cctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const cpage = await cctx.newPage(); cpage.setDefaultTimeout(20_000);
  const cobs = observe(cpage, 'customer');
  await uiLogin(cpage, custAcc);
  await cpage.goto(`/workOrder/details/${W1.id}?fromCustomerBoard=true`); await cpage.waitForTimeout(6_000);
  info('customer page open on WO 1', { url: cpage.url(), sockets: cobs.sockets || 0, state: await readState(cpage, W1.ref), bell: await readBell(cpage), shot: await shot(cpage, 'WO1-customer-page-open-baseline') });
  check('customer page has a live socket connection', (cobs.sockets || 0) > 0, { sockets: cobs.sockets || 0 });

  let counter1;
  await runEvent({
    name: 'E1-send', page: cpage, obs: cobs, watcher: 'cust', wo: W1,
    action: async () => { const r = await postJson(td, '/offers/customer/counter', { workOrderId: W1.id, ...COUNTER }); counter1 = r.body?.data?.id || r.body?.id; return r; },
    expectState: (st) => /Proposal Received|Counter/i.test(st.header) || st.tabs.some((t) => /Proposal/i.test(t)), stateLabel: 'Proposal Received badge / Proposals tab',
  });
  await runEvent({
    name: 'E2-edit', page: cpage, obs: cobs, watcher: 'cust', wo: W1,
    action: () => patchJson(td, `/offers/customer/counter/${counter1}`, { workOrderId: W1.id, ...COUNTER_V2 }),
    expectState: (st) => /Proposal Received|Counter/i.test(st.header), stateLabel: 'Proposal Received badge still shown (edit keeps it pending)',
  });
  await runEvent({
    name: 'E3-withdraw', page: cpage, obs: cobs, watcher: 'cust', wo: W1,
    action: () => postJson(td, `/offers/customer/counter/withdraw/${counter1}`, {}),
    expectState: (st) => !/Proposal Received/i.test(st.header) && !st.tabs.some((t) => /Proposal/i.test(t)), stateLabel: 'Proposal badge + Proposals tab removed',
  });
  await cctx.close();

  // =============================== WO 2 / WO 3: Tech Domain page open ===============================
  const W2 = await createWo('WO2-td-watches-accept');
  const W3 = await createWo('WO3-td-watches-decline');
  const c2 = await postJson(td, '/offers/customer/counter', { workOrderId: W2.id, ...COUNTER }); const counter2 = c2.body?.data?.id || c2.body?.id;
  const c3 = await postJson(td, '/offers/customer/counter', { workOrderId: W3.id, ...COUNTER }); const counter3 = c3.body?.data?.id || c3.body?.id;
  log(`counters: WO2 -> ${c2.status} id ${counter2}; WO3 -> ${c3.status} id ${counter3}`);
  expect(counter2 && counter3, 'counters for WO2/WO3').toBeTruthy();
  await sleep(2_000); await serverNotifs('td', W2.id, W2.ref); await serverNotifs('td', W3.id, W3.ref); await serverNotifs('cust', W2.id, W2.ref); await serverNotifs('cust', W3.id, W3.ref);

  const tctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const tpage = await tctx.newPage(); tpage.setDefaultTimeout(20_000);
  const tobs = observe(tpage, 'techdomain');
  await uiLogin(tpage, tdAcc);
  await tpage.goto(`/workOrder/details/${W2.id}`); await tpage.waitForTimeout(6_000);
  info('Tech Domain page open on WO 2', { url: tpage.url(), sockets: tobs.sockets || 0, state: await readState(tpage, W2.ref), bell: await readBell(tpage), shot: await shot(tpage, 'WO2-techdomain-page-open-baseline') });
  check('Tech Domain page has a live socket connection', (tobs.sockets || 0) > 0, { sockets: tobs.sockets || 0 });

  await runEvent({
    name: 'E4-customer-accepts', page: tpage, obs: tobs, watcher: 'td', wo: W2,
    action: () => postJson(cust, `/offers/customer/counter/accept/${counter2}`, {}),
    expectState: (st) => /Accepted/i.test(st.header + ' ' + st.banner), stateLabel: 'Counter Accepted badge/banner',
  });

  await tpage.goto(`/workOrder/details/${W3.id}`); await tpage.waitForTimeout(6_000);
  info('Tech Domain page open on WO 3', { state: await readState(tpage, W3.ref), bell: await readBell(tpage), shot: await shot(tpage, 'WO3-techdomain-page-open-baseline') });
  await runEvent({
    name: 'E5-customer-declines', page: tpage, obs: tobs, watcher: 'td', wo: W3,
    action: () => postJson(cust, `/offers/customer/counter/decline/${counter3}`, {}),
    expectState: (st) => /Declined|Rejected/i.test(st.header + ' ' + st.banner), stateLabel: 'Counter Declined badge/banner',
  });
  await tctx.close();

  // ---------------- summary ----------------
  const rows = results.events.map((e) => `${e.name.padEnd(22)} watcher=${e.watcher.padEnd(4)} bell ${e.baseline.bell}->${e.watch.finalBell} (realtime ${e.watch.bellAt || 'NO'})  state realtime ${e.watch.stateAt || 'NO'}  socket-notification-frame ${e.watch.frames.some((f) => /\["notification"/.test(f)) ? 'yes' : 'no'}  server-notif ${e.server.fresh.length}  on-click ${/proposal|counter|offer/i.test(e.panelOnClick) ? 'shown' : 'not shown'}  after-reload bell ${e.afterReload.bell} header "${e.afterReload.header.slice(-40)}"`);
  const summary = rows.join('\n') + '\n\n' + results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.length}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
