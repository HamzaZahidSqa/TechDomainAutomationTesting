// TD-55: "Optimize route to multiple engineers API"  https://techdomain.atlassian.net/browse/TD-55
// Expected: "Route Selected" sends ONE request with the work order + the full list of selected engineers, the backend
// routes them together and returns a result per engineer, and the page refreshes once (not 3 times per engineer).
// Sub-task TD-85 (Done): unroute of multiple engineers in one request.
//
// Part A (API, Tech Domain owner): POST /offers/route {workOrderId, userIds:[...]} with 3 engineers, an already-routed
//   engineer, and a mixed valid+invalid batch (per-engineer result?). Unroute with POST /offers/unroute {offerIds}.
// Part B (UI, Tech Domain owner): work order > Providers tab > tick 3 engineers > "Route Selected (3)" while every API
//   request is recorded: expect exactly 1 POST offers/route carrying the 3 ids, every reload endpoint called at most once,
//   toast "3 engineers routed successfully", offers ROUTED via API. Then Routed list > tick all > "Unroute Selected":
//   expect exactly 1 POST offers/unroute with the 3 offer ids.
//
// Run:  npx playwright test tests/td-55-route-multiple-engineers.spec.js            (uses PUBLISHED WO 969)
//       WO_ID=955 npx playwright test tests/td-55-route-multiple-engineers.spec.js  (any PUBLISHED work order of Tech Domain)
// Evidence: evidence/TD-55-RouteMultiple/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-55-RouteMultiple', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const WO_ID = Number(process.env.WO_ID || 969);
const ENGINEERS = [575, 609, 611]; // Individual Engineer, Vendor owner, Vendor engineer (all approved on dev)
const MIXED = [576, 999999];       // approved engineer + non-existent id
// providers visible on page 1 of WO 969's Nearby list (50 km) that carry hourly/half-day/full-day rates -> routable
const UI_IDS = String(process.env.UI_IDS || '41,294,386').split(',').map(Number);
// 91 "Saman Farooq" has only an hourly rate -> backend rejects "Engineer billing rates are missing"; 294 is routable
const UI_MIXED_IDS = String(process.env.UI_MIXED_IDS || '91,294').split(',').map(Number);
const UI_PICK = UI_IDS.length;

test.setTimeout(600_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-55_Route_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: false }).catch(() => { }); return path.basename(f); }
async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({})); await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`);
  return { api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } }), id: body.data?.id };
}
async function call(s, method, p, data) { const t0 = Date.now(); const r = await s.api[method](u(p), data === undefined ? undefined : { data }); return { status: r.status(), ms: Date.now() - t0, body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) }; }
const getJson = (s, p) => call(s, 'get', p);
const postJson = (s, p, d) => call(s, 'post', p, d);
async function offers(s, woId) { const r = await postJson(s, `/offers/${woId}`, { limit: 100, page: 1 }); return (r.body?.data?.offers || []).map((o) => ({ id: o.id, status: o.status, userId: o.userId ?? o.user?.id ?? o.engineer?.id ?? null })); }
async function unrouteAll(s, woId) { const routed = (await offers(s, woId)).filter((o) => o.status === 'ROUTED'); if (!routed.length) return { status: 0, n: 0 }; const r = await postJson(s, '/offers/unroute', { offerIds: routed.map((o) => o.id) }); return { status: r.status, n: routed.length, body: r.body }; }
async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
}
const apiPath = (url) => { try { const x = new URL(url); return x.pathname.replace(/^\/api\//, '') + (x.search ? '?' + [...x.searchParams.keys()].join(',') : ''); } catch { return url; } };
function summarize(calls) { const m = {}; for (const c of calls) { const k = `${c.method} ${c.path}`; m[k] = (m[k] || 0) + 1; } return m; }

test('TD-55 route multiple engineers: one request, one refresh, per-engineer result', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, woId: WO_ID, checks: [], findings: [], api: {}, ui: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 500)}`); };
  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const td = await apiLogin(tdAcc);

  const wo = (await getJson(td, `/workOrders/${WO_ID}`)).body?.data || {};
  log(`WO ${WO_ID}: ${wo.status} "${wo.title}" client=${wo.client?.clientName} lat/lng=${wo.address?.latitude},${wo.address?.longitude}`);
  expect(wo.status, 'work order must be PUBLISHED').toBe('PUBLISHED');
  const cleaned0 = await unrouteAll(td, WO_ID); log(`pre-clean: unrouted ${cleaned0.n} offer(s) HTTP ${cleaned0.status}`);

  // ---------------- Part A: API ----------------
  const a1 = await postJson(td, '/offers/route', { workOrderId: WO_ID, userIds: ENGINEERS });
  log(`A1 route ${JSON.stringify(ENGINEERS)} -> HTTP ${a1.status} in ${a1.ms}ms ${JSON.stringify(a1.body).slice(0, 700)}`);
  results.api.a1 = { status: a1.status, ms: a1.ms, body: a1.body };
  const a1Rows = Array.isArray(a1.body?.data) ? a1.body.data : [];
  check('A1: one POST /offers/route with userIds[3] is accepted (201)', a1.status === 201, { status: a1.status, message: a1.body?.message });
  check('A1: response carries one result per engineer (data[3], all ROUTED)', a1Rows.length === ENGINEERS.length && a1Rows.every((o) => o.status === 'ROUTED') && ENGINEERS.every((id) => a1Rows.some((o) => o.userId === id)), { rows: a1Rows.map((o) => `${o.id}:${o.userId}:${o.status}`), routedCount: a1.body?.routedCount });
  const after1 = await offers(td, WO_ID);
  check('A1: offers list shows 3 ROUTED offers for the 3 engineers', after1.filter((o) => o.status === 'ROUTED').length === ENGINEERS.length, { offers: after1 });

  const a2 = await postJson(td, '/offers/route', { workOrderId: WO_ID, userIds: [ENGINEERS[0]] });
  log(`A2 re-route already routed ${ENGINEERS[0]} -> HTTP ${a2.status} ${JSON.stringify(a2.body).slice(0, 400)}`);
  results.api.a2 = { status: a2.status, body: a2.body };
  const after2 = await offers(td, WO_ID);
  check('A2: routing an already-routed engineer is rejected with a reason and creates no duplicate offer', a2.status >= 400 && after2.filter((o) => o.status === 'ROUTED').length === ENGINEERS.length, { status: a2.status, message: a2.body?.message, routedNow: after2.filter((o) => o.status === 'ROUTED').length });

  const a3 = await postJson(td, '/offers/route', { workOrderId: WO_ID, userIds: MIXED });
  log(`A3 mixed batch ${JSON.stringify(MIXED)} -> HTTP ${a3.status} ${JSON.stringify(a3.body).slice(0, 400)}`);
  results.api.a3 = { status: a3.status, body: a3.body };
  const after3 = await offers(td, WO_ID);
  const validRouted = after3.some((o) => o.userId === MIXED[0] && o.status === 'ROUTED');
  const a3Rows = Array.isArray(a3.body?.data) ? a3.body.data : [];
  const perEngineer = a3Rows.length === MIXED.length || (a3.body?.results && Object.keys(a3.body.results).length === MIXED.length) || (Array.isArray(a3.body?.failed) && Array.isArray(a3.body?.data));
  check('A3: mixed batch (valid + invalid id) returns a result per engineer (valid one routed, invalid one reported)', perEngineer && validRouted, { status: a3.status, message: a3.body?.message, validEngineerRouted: validRouted, keys: Object.keys(a3.body || {}) });
  check('A3: failure message names the failing engineer', /\b999999\b/.test(JSON.stringify(a3.body)), { message: a3.body?.message });
  const a4 = await postJson(td, '/offers/route', { workOrderId: WO_ID, userIds: [] });
  info('A4: empty userIds[]', { status: a4.status, message: a4.body?.message });
  const a5 = await postJson(td, '/offers/route', { workOrderId: WO_ID, userId: 576 });
  const after5 = await offers(td, WO_ID);
  info('A5: legacy single "userId" payload', { status: a5.status, message: a5.body?.message, routed576: after5.some((o) => o.userId === 576 && o.status === 'ROUTED') });

  const routedIds = (await offers(td, WO_ID)).filter((o) => o.status === 'ROUTED').map((o) => o.id);
  const un = await postJson(td, '/offers/unroute', { offerIds: routedIds });
  const afterUn = await offers(td, WO_ID);
  log(`A6 unroute ${JSON.stringify(routedIds)} -> HTTP ${un.status} in ${un.ms}ms ${JSON.stringify(un.body).slice(0, 200)}; routed left: ${afterUn.filter((o) => o.status === 'ROUTED').length}`);
  check('A6 (TD-85): one POST /offers/unroute {offerIds[]} unroutes every routed offer', un.status < 300 && afterUn.filter((o) => o.status === 'ROUTED').length === 0, { status: un.status, ms: un.ms, n: routedIds.length });

  // ---------------- Part B: UI ----------------
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  const calls = []; let recording = false;
  page.on('request', (r) => { if (recording && r.url().includes(API_URL)) calls.push({ t: Date.now(), method: r.method(), path: apiPath(r.url()), url: r.url(), post: r.postData() }); });
  page.on('response', async (r) => { if (recording && r.url().includes(API_URL)) { const c = calls.find((x) => x.url === r.url() && x.method === r.request().method() && x.status === undefined); if (c) { c.status = r.status(); if (/offers\/(route|unroute)/.test(r.url())) c.body = (await r.text().catch(() => '')).slice(0, 600); } } });
  const toasts = async () => (await page.locator('.MuiAlert-message, .MuiSnackbarContent-message, [role="alert"], .Toastify__toast, .notistack-MuiContent').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);

  await uiLogin(page, tdAcc);
  await page.goto(`/workOrder/details/${WO_ID}`);
  await page.waitForTimeout(4_000);
  const tabs = (await page.locator('[role="tab"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  log(`tabs: ${tabs.join(' | ')}`);
  await shot(page, 'wo-details');
  const provTab = page.locator('[role="tab"]', { hasText: /providers/i }).first();
  const nearbyWait = page.waitForResponse((r) => r.url().includes('users/nearby'), { timeout: 30_000 }).catch(() => null);
  await provTab.click();
  const nearbyRes = await nearbyWait;
  await page.waitForTimeout(3_000);
  log(`Providers tab: nearby ${nearbyRes ? nearbyRes.status() + ' ' + apiPath(nearbyRes.url()) : 'no response seen'}`);
  // ---- helpers for the Providers grid ----
  const rowById = (id) => page.locator('.MuiDataGrid-row').filter({ has: page.locator(`[data-field="id"]`).filter({ hasText: new RegExp(`^\\s*${id}\\s*$`) }) }).first();
  const tickRows = async (ids) => {
    const picked = [];
    for (const id of ids) {
      const row = rowById(id);
      if (!(await row.count())) { picked.push({ id, found: false }); continue; }
      await row.scrollIntoViewIfNeeded().catch(() => { });
      await row.locator('input[type="checkbox"]').first().click({ force: true });
      picked.push({ id, found: true, text: (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 70) });
    }
    await page.waitForTimeout(800);
    return picked;
  };
  const untickAll = async () => { const boxes = page.locator('.MuiDataGrid-row input[type="checkbox"]:checked'); const n = await boxes.count(); for (let i = n - 1; i >= 0; i--) await boxes.nth(i).click({ force: true }); await page.waitForTimeout(500); };
  // click a button and record every API call + every toast text during the next `ms`
  const clickAndRecord = async (btn, ms) => {
    calls.length = 0; recording = true; const seen = new Set(); const t0 = Date.now();
    await btn.click();
    while (Date.now() - t0 < ms) { for (const t of await toasts()) seen.add(t); await page.waitForTimeout(300); }
    recording = false;
    return { t0, calls: calls.slice(), toasts: [...seen] };
  };
  const gridRows = page.locator('.MuiDataGrid-row');
  const nRows = await gridRows.count();
  log(`provider rows on page 1: ${nRows}; ids: ${(await page.locator('.MuiDataGrid-row [data-field="id"]').allInnerTexts().catch(() => [])).map((t) => t.trim()).join(',')}`);
  await shot(page, 'providers-tab');
  check('UI: Providers tab lists engineers to select', nRows >= 3, { rows: nRows });

  // ---- B1: happy path, 3 routable engineers ----
  const picked = await tickRows(UI_IDS);
  const routeBtn = page.locator('button', { hasText: /route selected/i }).first();
  const routeBtnText = (await routeBtn.innerText().catch(() => '')).trim();
  log(`picked: ${JSON.stringify(picked)} | button: "${routeBtnText}"`);
  await shot(page, 'three-selected');
  check(`UI: all ${UI_PICK} target engineers found on the Nearby list`, picked.every((p) => p.found), { picked });
  check(`UI: "Route Selected (${UI_PICK})" button appears after ticking ${UI_PICK} engineers`, new RegExp(`\\(${UI_PICK}\\)`).test(routeBtnText), { button: routeBtnText });

  const b1 = await clickAndRecord(routeBtn, 10_000);
  const routeCalls = b1.calls.filter((c) => c.method === 'POST' && /offers\/route(\?|$)/.test(c.path));
  const others = b1.calls.filter((c) => !routeCalls.includes(c));
  const perEndpoint = summarize(others);
  await shot(page, 'after-route-selected');
  log(`route calls: ${JSON.stringify(routeCalls.map((c) => ({ status: c.status, post: c.post, body: c.body })))}`);
  log(`other API calls after click (${others.length}): ${JSON.stringify(perEndpoint)}`);
  log(`toasts: ${JSON.stringify(b1.toasts)}`);
  results.ui.route = { picked, button: routeBtnText, routeCalls: routeCalls.map((c) => ({ status: c.status, post: c.post, body: c.body, afterMs: c.t - b1.t0 })), reloads: perEndpoint, allCalls: b1.calls.map((c) => ({ afterMs: c.t - b1.t0, method: c.method, path: c.path, status: c.status })), toasts: b1.toasts };
  check('UI: exactly ONE POST offers/route is sent for the selection', routeCalls.length === 1, { count: routeCalls.length });
  let sent = {}; try { sent = JSON.parse(routeCalls[0]?.post || '{}'); } catch { }
  check(`UI: the single request carries workOrderId + all ${UI_PICK} selected ids (userIds[])`, (sent.userIds || []).length === UI_PICK && sent.workOrderId === WO_ID && UI_IDS.every((id) => sent.userIds.includes(id)), { post: routeCalls[0]?.post });
  check('UI: route request succeeded (2xx)', routeCalls[0]?.status >= 200 && routeCalls[0]?.status < 300, { status: routeCalls[0]?.status, body: routeCalls[0]?.body });
  const multiReload = Object.entries(perEndpoint).filter(([, n]) => n > 1);
  check('UI: the page refreshes ONCE (no reload endpoint is called more than once after routing)', multiReload.length === 0 && others.length <= 6, { reloads: perEndpoint, total: others.length });
  check(`UI: toast "${UI_PICK} engineers routed successfully"`, b1.toasts.some((t) => new RegExp(`${UI_PICK} engineers? routed successfully`, 'i').test(t)), { toasts: b1.toasts });
  const afterUi = await offers(td, WO_ID);
  const routedUi = afterUi.filter((o) => o.status === 'ROUTED');
  check(`API: ${UI_PICK} offers are ROUTED after the UI action`, routedUi.length === UI_PICK && UI_IDS.every((id) => routedUi.some((o) => o.userId === id)), { offers: afterUi });
  results.ui.routedOffers = routedUi;
  const stillChecked = await page.locator('.MuiDataGrid-row input[type="checkbox"]:checked').count();
  check('UI: selection is cleared after a successful route', stillChecked === 0, { stillChecked });
  const routedCountBadge = (await page.locator('[role="tab"], button, span').filter({ hasText: /pending assignments/i }).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  info('UI: "Pending Assignments" badge after routing', { text: routedCountBadge });

  // ---- B2 (TD-85): unroute from the UI ----
  let unrouteCalls = [], unrouteOthers = {}, toastAfterUnroute = [];
  const pendTab = page.locator('[role="tab"], button, div[class*="cursor-pointer"]').filter({ hasText: /^\s*pending assignments/i }).first();
  const routedTab = page.locator('[role="tab"], button').filter({ hasText: /^\s*routed/i }).first();
  const listTab = (await routedTab.count()) ? routedTab : pendTab;
  if (await listTab.count()) {
    await listTab.click(); await page.waitForTimeout(4_000);
    await shot(page, 'routed-list');
    const boxes = page.locator('.MuiDataGrid-row:not(:has-text("ROUTED OFFERS")) input[type="checkbox"]:visible');
    const nb = await boxes.count(); log(`routed-list rows with checkbox: ${nb}`);
    for (let i = 0; i < nb; i++) await boxes.nth(i).click({ force: true }).catch((e) => log(`checkbox ${i}: ${String(e.message).slice(0, 80)}`));
    await page.waitForTimeout(800);
    const unBtn = page.locator('button', { hasText: /unroute selected/i }).first();
    const unText = (await unBtn.innerText().catch(() => '')).trim();
    log(`unroute button: "${unText}"`);
    await shot(page, 'routed-selected');
    if (await unBtn.count()) {
      const b2 = await clickAndRecord(unBtn, 10_000);
      unrouteCalls = b2.calls.filter((c) => c.method === 'POST' && /offers\/unroute/.test(c.path));
      unrouteOthers = summarize(b2.calls.filter((c) => !unrouteCalls.includes(c)));
      toastAfterUnroute = b2.toasts;
      await shot(page, 'after-unroute-selected');
      log(`unroute calls: ${JSON.stringify(unrouteCalls.map((c) => ({ status: c.status, post: c.post, body: c.body })))} | reloads ${JSON.stringify(unrouteOthers)} | toasts ${JSON.stringify(toastAfterUnroute)}`);
      let unIds = []; try { unIds = JSON.parse(unrouteCalls[0]?.post || '{}').offerIds || []; } catch { }
      check('UI (TD-85): exactly ONE POST offers/unroute carrying all routed offer ids', unrouteCalls.length === 1 && unIds.length === routedUi.length, { count: unrouteCalls.length, post: unrouteCalls[0]?.post, status: unrouteCalls[0]?.status });
      check('UI (TD-85): no reload endpoint is called more than once after unrouting', Object.values(unrouteOthers).every((n) => n <= 1), { reloads: unrouteOthers });
      check(`UI (TD-85): toast "${routedUi.length} offers unrouted successfully"`, toastAfterUnroute.some((t) => /unrouted successfully/i.test(t)), { toasts: toastAfterUnroute });
      check('API: no ROUTED offer left after the UI unroute', (await offers(td, WO_ID)).filter((o) => o.status === 'ROUTED').length === 0, {});
    } else info('UI: no "Unroute Selected" button found on the routed list', { tabs, unText });
  } else info('UI: no routed list tab found', { tabs });
  results.ui.unroute = { calls: unrouteCalls.map((c) => ({ status: c.status, post: c.post, body: c.body })), reloads: unrouteOthers, toasts: toastAfterUnroute };
  const leftover = await unrouteAll(td, WO_ID); if (leftover.n) log(`API cleanup before B3: unrouted ${leftover.n}`);

  // ---- B3: mixed batch from the UI (one engineer the backend rejects + one routable) ----
  await page.goto(`/workOrder/details/${WO_ID}`); await page.waitForTimeout(4_000);
  await page.locator('[role="tab"]', { hasText: /providers/i }).first().click();
  await page.waitForResponse((r) => r.url().includes('users/nearby'), { timeout: 30_000 }).catch(() => null);
  await page.waitForTimeout(3_000);
  const pickedMixed = await tickRows(UI_MIXED_IDS);
  const routeBtn2 = page.locator('button', { hasText: /route selected/i }).first();
  await shot(page, 'mixed-selected');
  log(`B3 picked: ${JSON.stringify(pickedMixed)}`);
  const b3 = await clickAndRecord(routeBtn2, 10_000);
  const routeCalls3 = b3.calls.filter((c) => c.method === 'POST' && /offers\/route(\?|$)/.test(c.path));
  const reloads3 = summarize(b3.calls.filter((c) => !routeCalls3.includes(c)));
  await shot(page, 'mixed-after-route');
  const offers3 = await offers(td, WO_ID);
  const routed3 = offers3.filter((o) => o.status === 'ROUTED');
  log(`B3 route calls: ${JSON.stringify(routeCalls3.map((c) => ({ status: c.status, post: c.post, body: c.body })))} | reloads ${JSON.stringify(reloads3)} | toasts ${JSON.stringify(b3.toasts)} | routed now ${JSON.stringify(routed3)}`);
  results.ui.mixed = { picked: pickedMixed, routeCalls: routeCalls3.map((c) => ({ status: c.status, post: c.post, body: c.body })), reloads: reloads3, toasts: b3.toasts, routedAfter: routed3 };
  check('UI mixed: still exactly ONE POST offers/route', routeCalls3.length === 1, { count: routeCalls3.length });
  check('UI mixed: the error toast names the rejected engineer and the reason', b3.toasts.some((t) => /billing rates|not approved|already routed/i.test(t) && !/failed to route the selected engineers$/i.test(t)), { toasts: b3.toasts, body: routeCalls3[0]?.body });
  check('UI mixed: the routable engineer is still routed (per-engineer result) and the rejected one is reported', routed3.some((o) => o.userId === UI_MIXED_IDS[1]) && !routed3.some((o) => o.userId === UI_MIXED_IDS[0]), { routed: routed3, status: routeCalls3[0]?.status, body: routeCalls3[0]?.body });
  const stillChecked3 = await page.locator('.MuiDataGrid-row input[type="checkbox"]:checked').count();
  info('UI mixed: ticks left on the grid after the failed route', { stillChecked: stillChecked3, buttonText: (await routeBtn2.innerText().catch(() => '')).trim() });
  await ctx.close();

  const cleaned = await unrouteAll(td, WO_ID);
  log(`cleanup: unrouted ${cleaned.n} leftover offer(s) HTTP ${cleaned.status}`);
  check('cleanup: work order has no ROUTED offers left', (await offers(td, WO_ID)).filter((o) => o.status === 'ROUTED').length === 0, {});

  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  for (const c of results.checks) if (!c.ok) results.findings.push(c.name);
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
