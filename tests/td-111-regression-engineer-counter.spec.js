// TD-111 regression: the EXISTING engineer-side counter offer flow must still work after the "Tech Domain -> customer counter
// offer" feature (dev build main.16fe721c.js, 2026-10-14).
//
// R1 individual engineer: Counter Offer -> Edit -> Withdraw -> Counter again -> Tech Domain Providers > Pending Assignments >
//    COUNTER OFFERS > Review ("Counter Offer Review") > Accept & Assign -> WO ASSIGNED with the counter rates + counter expense.
// R2 vendor (freelance company owner) counters on behalf of a member engineer ("Select Engineer") -> Tech Domain accepts -> member assigned.
// R3 work order with "Disable counter offers": engineer gets no Counter Offer button; plain Request -> "Requested Offer Review" -> Accept & Assign.
// UI-driven (Playwright) with a screenshot per step; API only to create/publish the work orders and to read back the amounts.
// Run: npx playwright test tests/td-111-regression-engineer-counter.spec.js --reporter=line --trace off
// Evidence: evidence/TD-111-CustomerCounterOffer/regression-run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const BASE_URL = process.env.BASE_URL || 'https://dev.techdomain.com.au';
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-111-CustomerCounterOffer', `regression-run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: BASE_URL };
const ENTITY_ID = 104, TEMPLATE_WO = 242, TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const GEO = { geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'] };
const USERS = {
  td: accounts.find((a) => a.role === 'TechDomain User'),        // 27
  eng: accounts.find((a) => a.role === 'Individual Engineer'),   // 575 Syed Hamza
  vendor: accounts.find((a) => a.role === 'Vendor'),             // 609 Demo CompanyOwner (company 79)
  worker: accounts.find((a) => a.role === 'Vendor Engineer'),    // 611 Demo Worker
  cust: testAccounts.find((a) => a.role === 'Customer'),         // 638
};
test.setTimeout(900_000);

// ---------------- results / evidence ----------------
const results = { ticket: 'TD-111 regression (engineer counter offer)', run: RUN, date: new Date().toISOString(), env: { ui: BASE_URL, api: API_URL }, workOrders: {}, checks: [] };
let shotNo = 0;
const log = (m) => console.log(String(m).slice(0, 1500));
function check({ id, title, type, expected, actual, ok, note = '', screenshot = '' }) { const c = { id, title, type, expected: String(expected), actual: String(actual).slice(0, 1500), ok: !!ok, note, screenshot }; results.checks.push(c); log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | expected: ${expected} | actual: ${String(actual).slice(0, 300)}`); return c; }
function info(id, title, actual, screenshot = '') { results.checks.push({ id, title, type: 'info', expected: '-', actual: String(actual).slice(0, 1500), ok: true, info: true, note: '', screenshot }); log(`INFO ${id} ${title} :: ${String(actual).slice(0, 300)}`); }
async function shot(page, name, full = false) { shotNo += 1; const f = `TD-111_EngineerCounter_${String(shotNo).padStart(2, '0')}_${name}.png`; try { await page.screenshot({ path: path.join(EVIDENCE, f), fullPage: full }); } catch (e) { log(`screenshot failed ${name}: ${e.message}`); } return f; }
const shotFull = (page, name) => shot(page, name, true);
const scenario = (name, fn) => test(name, async ({ browser }) => { try { await fn(browser); } catch (e) { check({ id: `${name.slice(0, 2)}-ERR`, title: `scenario aborted by an unexpected error: ${name}`, type: 'error', expected: 'scenario completes', actual: String(e.stack || e.message).slice(0, 600), ok: false }); } });

// ---------------- API ----------------
async function apiLogin(account) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`); return { api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } }), id: body.data?.id, account }; }
const contexts = {}; const tokens = {};
async function call(s, method, p, data, retry = true) {
  const headers = s.key ? { Authorization: tokens[s.key] } : undefined;
  const r = await s.api.fetch(u(p), { method, data, headers }); const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  if (r.status() === 401 && s.key && retry && contexts[s.key]) { const page = contexts[s.key].page; await page.reload().catch(() => { }); await page.waitForTimeout(3500); return call(s, method, p, data, false); }
  return { status: r.status(), body };
}
const brief = (r) => `HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body).slice(0, 200)}`;
function customerWoPayload(title, dayOffset = 3) { const start = new Date(Date.now() + dayOffset * 86_400_000); start.setHours(10, 0, 0, 0); const day = start.toISOString().slice(0, 10); return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'TD-111 regression: engineer counter offer still works', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5, nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: 50, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }
async function publishedWo(cust, td, key, title, dayOffset, extra = {}) {
  const cr = await call(cust, 'POST', '/workOrders', customerWoPayload(title, dayOffset)); const id = cr.body?.id; const ref = cr.body?.referenceId;
  const template = (await call(td, 'GET', `/workOrders/${TEMPLATE_WO}`)).body?.data;
  const fix = await call(td, 'PATCH', `/workOrders/${id}`, { teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3', categoryId: template?.category?.id, workOrderServices: (template?.workOrderServices || []).map((x) => ({ serviceId: x.serviceId || x.id })), engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 20, engineerMinimumHours: 4, engineerAdditionalHourlyRate: 22, ...extra });
  const ap = await call(td, 'POST', `/workOrders/${id}/approvePublish`, {});
  log(`setup ${key}: WO ${id} (#${ref}) create ${cr.status} fix ${fix.status} publish ${ap.status}`);
  if (!id || ap.status >= 300) throw new Error(`setup ${key} failed: ${brief(ap)}`);
  results.workOrders[key] = { id, ref, title }; return { id, ref };
}
async function woOf(s, wo) { return (await call(s, 'GET', `/workOrders/${wo}`)).body?.data; }
async function payment(s, wo) { return (await call(s, 'GET', `/workOrders/estimatedPayment/${wo}`)).body?.data; }
async function offers(s, wo) { const r = await call(s, 'POST', `/offers/${wo}`, { limit: 20, page: 1 }); return r.body?.data?.offers || r.body?.data?.data || []; }
async function counterDetail(s, wo, userId, companyOwnerId) { const r = await call(s, 'POST', `/offers/engineer/workOrder/${wo}`, companyOwnerId ? { userId, companyOwnerId } : { userId }); const c = r.body?.data?.counter || null; return c ? { status: c.status, isCounter: c.isCounter, userId: c.userId, referred: c.referredEngineerId, hourlyRate: c.hourlyRate, minimumHours: c.minimumHours, additionalHourlyRate: c.additionalHourlyRate, expenses: (c.expenses || []).map((e) => `${e.expenseType}:${e.amount}`), total: c.totalWorkOrderCost } : null; }
const offerBrief = (o) => ({ id: o.id, status: o.status, isCounter: o.isCounter, user: o.user?.id, referred: o.referredEngineerId, hourlyRate: o.hourlyRate, minimumHours: o.minimumHours, additionalHourlyRate: o.additionalHourlyRate, expenses: (o.expenses || []).map((e) => `${e.expenseType}:${e.amount}`) });

// ---------------- UI ----------------
async function ui(browser, key) {
  if (contexts[key]) return contexts[key].page;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...GEO }); const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  page.on('request', (r) => { const a = r.headers()['authorization']; if (a && r.url().includes(API_URL)) tokens[key] = a; });
  const a = USERS[key]; await page.goto('/login'); await page.waitForTimeout(1500);
  await page.locator('input[type="email"], input[name="email"]').first().fill(a.email); await page.locator('input[type="password"]').first().fill(a.password); await page.locator('button[type="submit"]').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 }); await page.waitForTimeout(2500);
  contexts[key] = { ctx, page }; return page;
}
async function apiOf(key, browser) { if (!tokens[key]) await ui(browser, key); return { api: await pwRequest.newContext({ extraHTTPHeaders: H }), key }; }
async function openWo(page, wo, tab = 'details', q = '') { await page.goto(`/workOrder/${tab}/${wo}${q}`); await page.waitForTimeout(3500); }
const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const visibleButtons = async (page) => (await page.locator('button:visible').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
const dialog = (page) => page.locator('[role=dialog], .MuiModal-root:visible, .MuiDialog-root:visible').last();
async function waitToast(page, text, timeout = 15_000) { try { await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout }); return true; } catch { return false; } }
const modalText = async (m) => (await m.innerText()).replace(/\s+/g, ' ');
async function openCounterModal(page) { await page.getByRole('button', { name: 'Counter Offer', exact: true }).click(); const m = dialog(page); await expect(m.getByText('Counter Offer', { exact: true }).first()).toBeVisible(); await page.waitForTimeout(1000); return m; }
async function labourSection(m) { const cb = m.locator('input[type=checkbox]').first(); if (!(await cb.isChecked())) await cb.check(); await m.page().waitForTimeout(400); return m.locator('div.grid-cols-7').first(); }
async function expenseSection(m) { const cb = m.locator('input[type=checkbox]').nth(1); if (!(await cb.isChecked())) await cb.check(); await m.page().waitForTimeout(400); return m.locator('div.grid-cols-7').filter({ has: m.page().locator('input[name="amount"]') }).first(); }
async function fillLabour(m, values) { const g = await labourSection(m); for (const [name, v] of Object.entries(values)) { const inp = g.locator(`input[name="${name}"]`); await inp.fill(''); await inp.fill(String(v)); } await g.getByRole('button', { name: 'Add' }).click(); await m.page().waitForTimeout(1200); }
async function addExpense(m, type, description, amount) { const g = await expenseSection(m); await g.locator('[role=combobox]').first().click(); await m.page().getByRole('option', { name: type, exact: true }).click(); await g.locator('input[name="description"]').fill(description); await g.locator('input[name="amount"]').fill(String(amount)); await g.getByRole('button', { name: 'Add' }).click(); await m.page().waitForTimeout(1200); }
const sendBtn = (m) => m.getByRole('button', { name: /Send Counter Offer|Update Counter Offer/ });
// Tech Domain: Providers > Pending Assignments > Review (first row) > Accept & Assign > confirm
async function tdReviewAndAssign(tp, wo, shotPrefix) {
  await openWo(tp, wo, 'providers', '?tab=pending'); await tp.waitForTimeout(1500);
  let s = await shotFull(tp, `${shotPrefix}_td-pending-assignments`);
  const pendingText = await bodyText(tp);
  const review = tp.getByRole('button', { name: 'Review', exact: true }).first();
  const hasReview = await review.isVisible().catch(() => false);
  if (!hasReview) return { ok: false, step: 'review-button', pendingText, screenshot: s };
  await review.click(); await tp.waitForTimeout(3000);
  const m = dialog(tp); const mt = await modalText(m);
  s = await shotFull(tp, `${shotPrefix}_td-review-modal`);
  const accept = m.getByRole('button', { name: 'Accept & Assign' });
  try { await expect(accept).toBeEnabled({ timeout: 15_000 }); } catch { return { ok: false, step: 'accept-disabled', modalText: mt, pendingText, screenshot: s }; }
  await accept.click(); await tp.waitForTimeout(2500);
  const confirm = dialog(tp); const ct = await modalText(confirm);
  s = await shotFull(tp, `${shotPrefix}_td-confirm-assign`);
  const yes = confirm.getByRole('button', { name: 'Yes, Assign' });
  if (!(await yes.isVisible().catch(() => false))) return { ok: false, step: 'confirm', modalText: mt, confirmText: ct, pendingText, screenshot: s };
  const [resp] = await Promise.all([tp.waitForResponse((r) => /offers\/(counter\/accept|assign)/.test(r.url()) && r.request().method() === 'POST' && r.status() < 300, { timeout: 25_000 }).catch(() => null), yes.click()]);
  let toastCounter = false, toastAssign = false;
  try { const tl = tp.getByText(/Counter Offer Accepted Successfully|Job Assign Successfully/).first(); await expect(tl).toBeVisible({ timeout: 15_000 }); const tt = await tl.innerText(); toastCounter = /Counter Offer Accepted/.test(tt); toastAssign = /Job Assign/.test(tt); } catch { }
  s = await shotFull(tp, `${shotPrefix}_td-after-assign`);
  return { ok: true, modalText: mt, confirmText: ct, pendingText, api: resp ? `${resp.request().method()} ${resp.url().replace(API_URL, '')} -> ${resp.status()}` : 'no response captured', toastCounter, toastAssign, screenshot: s };
}

// ---------------- setup ----------------
const WO = {};
test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const cust = await apiLogin(USERS.cust); const td = await apiLogin(USERS.td);
  // day offsets: engineers 575/611 already have assigned jobs on +3/+4/+5 days from earlier runs (409 "Schedule Conflict" otherwise)
  const D = Number(process.env.DAY_BASE || 9);
  WO.R1 = await publishedWo(cust, td, 'R1', `TD-111 regression R1 engineer counter ${RUN}`, D);
  WO.R2 = await publishedWo(cust, td, 'R2', `TD-111 regression R2 vendor counter ${RUN}`, D + 1);
  WO.R3 = await publishedWo(cust, td, 'R3', `TD-111 regression R3 counter disabled ${RUN}`, D + 2, { isCounterOffersDisable: true });
  await cust.api.dispose(); await td.api.dispose();
});
test.afterAll(async () => {
  results.summary = { total: results.checks.filter((c) => !c.info).length, pass: results.checks.filter((c) => !c.info && c.ok).length, fail: results.checks.filter((c) => !c.ok).length, info: results.checks.filter((c) => c.info).length };
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  log(`\nSUMMARY ${JSON.stringify(results.summary)} evidence=${EVIDENCE}`);
  for (const k of Object.keys(contexts)) await contexts[k].ctx.close().catch(() => { });
});

// =================================================================== R1
scenario('R1. Individual engineer: counter offer -> edit -> withdraw -> counter -> Tech Domain reviews and accepts', async (browser) => {
  const wo = WO.R1.id, ref = WO.R1.ref;
  const eng = await ui(browser, 'eng'); const tdApi = await apiOf('td', browser);
  await openWo(eng, wo);
  let s = await shotFull(eng, 'R1-01_engineer-published-wo');
  let btns = await visibleButtons(eng);
  check({ id: 'R1-01', title: 'Engineer sees "Counter Offer" and "Request" on a published work order', type: 'positive', expected: 'Counter Offer + Request', actual: btns.join(', '), ok: btns.includes('Counter Offer') && btns.includes('Request'), screenshot: s });
  let m = await openCounterModal(eng); let mt = await modalText(m);
  s = await shot(eng, 'R1-02_engineer-counter-modal');
  check({ id: 'R1-02', title: 'Engineer counter modal shows the WO engineer rates (20/h, 4 hrs, 22) and estimate 80', type: 'positive', expected: 'USD 20.00, 4 hrs, USD 80.00, Send disabled', actual: `${mt.slice(0, 300)} | sendDisabled=${await sendBtn(m).isDisabled()}`, ok: /USD 20\.00/.test(mt) && /4 hrs/.test(mt) && /USD 80\.00/.test(mt) && (await sendBtn(m).isDisabled()), screenshot: s });
  await fillLabour(m, { hourlyRate: 30, minimumHours: 4, additionalHourlyRate: 33 }); await addExpense(m, 'Travel Expense', 'Fuel', 10);
  mt = await modalText(m); s = await shot(eng, 'R1-03_engineer-counter-values-added');
  check({ id: 'R1-03', title: 'Labour 30/4/33 + Travel expense "Fuel" 10 added; estimate 30x4+10 = 130', type: 'positive', expected: 'USD 30.00, USD 33.00, Fuel USD 10.00, USD 130.00', actual: mt.slice(0, 500), ok: /USD ?30\.00/.test(mt) && /\b33\b/.test(mt) && /Fuel/.test(mt) && /USD ?130\.00/.test(mt), note: 'Engineer modal prints amounts without a space ("USD30.00"); the Tech Domain modal prints "USD 30.00".', screenshot: s });
  const [r1] = await Promise.all([eng.waitForResponse((r) => r.url().includes('/offers/engineer/counter') && r.request().method() === 'PATCH', { timeout: 20_000 }).catch(() => null), sendBtn(m).click()]);
  let t = await waitToast(eng, 'Counter Offer Sent Successfully'); s = await shot(eng, 'R1-04_engineer-counter-sent');
  check({ id: 'R1-04', title: 'Send -> PATCH offers/engineer/counter -> "Counter Offer Sent Successfully"', type: 'positive', expected: 'HTTP 2xx + toast', actual: `HTTP ${r1?.status()} toast=${t}`, ok: r1 && r1.status() < 300 && t, screenshot: s });
  await eng.waitForTimeout(2500); btns = await visibleButtons(eng); let bt = await bodyText(eng);
  s = await shotFull(eng, 'R1-05_engineer-after-counter');
  check({ id: 'R1-05', title: 'After countering the engineer gets "Edit Counter Offer" + "Withdraw Counter Offer" and the title status COUNTER', type: 'positive', expected: 'Edit/Withdraw buttons, status Counter', actual: `${btns.join(', ')} | ${bt.slice(0, 200)}`, ok: btns.includes('Edit Counter Offer') && btns.includes('Withdraw Counter Offer') && /COUNTER/i.test(bt), screenshot: s });
  let off = (await offers(tdApi, wo)).map(offerBrief); let cd = await counterDetail(tdApi, wo, 575);
  check({ id: 'R1-06', title: 'Tech Domain sees the engineer\'s PENDING counter (30/4/33 + Fuel 10, total 130)', type: 'positive', expected: 'offer PENDING isCounter; counter hourlyRate 30, additional 33, TRAVEL:10', actual: `offers=${JSON.stringify(off)} counter=${JSON.stringify(cd)}`, ok: off.some((o) => o.status === 'PENDING' && o.isCounter && o.user === 575) && cd && Number(cd.hourlyRate) === 30 && Number(cd.additionalHourlyRate) === 33 && cd.expenses.includes('TRAVEL:10') });
  await eng.goto('/jobs'); await eng.waitForTimeout(3000); const before = (await bodyText(eng)).match(/Countered\s*(\d+)/)?.[1];
  await eng.getByText('Countered', { exact: true }).first().click({ force: true }).catch(() => { }); await eng.waitForTimeout(4000); bt = await bodyText(eng); s = await shotFull(eng, 'R1-06_engineer-jobs-countered-tab');
  check({ id: 'R1-07', title: 'Engineer Jobs page counts the work order under "Countered" and the Countered tab lists it', type: 'positive', expected: `Countered >= 1 and #${ref} in the Countered list`, actual: `Countered=${before} | ${bt.slice(0, 400)}`, ok: Number(before) >= 1 && new RegExp(String(ref)).test(bt), screenshot: s });
  // edit
  await openWo(eng, wo); await eng.getByRole('button', { name: 'Edit Counter Offer', exact: true }).click(); await eng.waitForTimeout(1500);
  m = dialog(eng); mt = await modalText(m); s = await shot(eng, 'R1-07_engineer-edit-counter-modal');
  check({ id: 'R1-08', title: 'Edit Counter Offer re-opens the modal with the pending counter (30 / Fuel)', type: 'positive', expected: 'USD 30.00 and Fuel shown', actual: mt.slice(0, 400), ok: /USD ?30\.00/.test(mt) && /Fuel/.test(mt), screenshot: s });
  await fillLabour(m, { hourlyRate: 32, minimumHours: 4, additionalHourlyRate: 35 });
  const [r2] = await Promise.all([eng.waitForResponse((r) => r.url().includes('/offers/engineer/counter') && r.request().method() === 'PATCH' && r.status() < 300, { timeout: 25_000 }).catch(() => null), sendBtn(m).click()]);
  t = await waitToast(eng, 'Counter Offer Sent Successfully'); s = await shot(eng, 'R1-08_engineer-counter-edited');
  off = (await offers(tdApi, wo)).map(offerBrief); cd = await counterDetail(tdApi, wo, 575);
  check({ id: 'R1-09', title: 'Editing the counter (32/4/35) updates the same pending offer (still one offer)', type: 'positive', expected: 'HTTP 2xx + toast; one PENDING offer; counter hourlyRate 32, additional 35', actual: `HTTP ${r2?.status()} toast=${t} | offers=${JSON.stringify(off)} counter=${JSON.stringify(cd)}`, ok: r2 && r2.status() < 300 && t && off.filter((o) => o.status === 'PENDING').length === 1 && cd && Number(cd.hourlyRate) === 32 && Number(cd.additionalHourlyRate) === 35, screenshot: s });
  // withdraw
  await eng.waitForTimeout(2000); await eng.getByRole('button', { name: 'Withdraw Counter Offer', exact: true }).click(); await eng.waitForTimeout(1500);
  m = dialog(eng); mt = await modalText(m); s = await shot(eng, 'R1-09_engineer-withdraw-modal');
  check({ id: 'R1-10', title: '"Withdraw Counter Offer" modal summarises the counter (32/h, Fuel) with a Withdraw button', type: 'positive', expected: 'Withdraw Counter Offer, USD 32.00', actual: mt.slice(0, 400), ok: /Withdraw Counter Offer/.test(mt) && /USD ?32\.00/.test(mt) && (await m.getByRole('button', { name: 'Withdraw', exact: true }).count()) >= 1, screenshot: s });
  const [r3] = await Promise.all([eng.waitForResponse((r) => r.url().includes('/offers/engineer/withdraw/') && r.request().method() === 'DELETE', { timeout: 20_000 }).catch(() => null), m.getByRole('button', { name: 'Withdraw', exact: true }).last().click()]);
  t = await waitToast(eng, 'Counter Offer withdrawn Successfully'); await eng.waitForTimeout(2500); btns = await visibleButtons(eng); s = await shotFull(eng, 'R1-10_engineer-after-withdraw');
  off = (await offers(tdApi, wo)).map(offerBrief);
  check({ id: 'R1-11', title: 'Withdraw -> DELETE offers/engineer/withdraw/:wo -> toast; Counter Offer + Request buttons are back; no pending offer left', type: 'positive', expected: 'HTTP 2xx, toast, buttons back, 0 PENDING offers', actual: `HTTP ${r3?.status()} toast=${t} | ${btns.join(', ')} | offers=${JSON.stringify(off)}`, ok: r3 && r3.status() < 300 && t && btns.includes('Counter Offer') && btns.includes('Request') && !off.some((o) => o.status === 'PENDING'), screenshot: s });
  // counter again, then Tech Domain accepts
  m = await openCounterModal(eng); await fillLabour(m, { hourlyRate: 35, minimumHours: 4, additionalHourlyRate: 38 }); await addExpense(m, 'Tools Expense', 'Crimping tool', 15);
  await sendBtn(m).click(); t = await waitToast(eng, 'Counter Offer Sent Successfully'); s = await shot(eng, 'R1-11_engineer-second-counter-35');
  check({ id: 'R1-12', title: 'Engineer counters again after withdrawing (35/4/38 + Tools 15)', type: 'positive', expected: 'toast', actual: `toast=${t}`, ok: t, screenshot: s });
  const td = await ui(browser, 'td');
  const rv = await tdReviewAndAssign(td, wo, 'R1-12');
  check({ id: 'R1-13', title: 'Tech Domain Providers > Pending Assignments shows the offer under "COUNTER OFFERS" with the engineer and a Review button', type: 'positive', expected: 'COUNTER OFFERS group + Review', actual: `${rv.pendingText.slice(0, 500)} | step=${rv.step || 'ok'}`, ok: /COUNTER OFFERS/.test(rv.pendingText) && rv.step !== 'review-button', screenshot: rv.screenshot });
  check({ id: 'R1-14', title: '"Counter Offer Review" modal shows Current Pay vs Counter Pay (35/h, Crimping tool) and an enabled "Accept & Assign"', type: 'positive', expected: 'Counter Offer Review, Counter Pay, USD 35.00, Accept & Assign enabled', actual: `${(rv.modalText || '').slice(0, 600)} | step=${rv.step || 'ok'}`, ok: /Counter Offer Review/.test(rv.modalText || '') && /Counter Pay/.test(rv.modalText || '') && /35\.00/.test(rv.modalText || '') && rv.step !== 'accept-disabled', screenshot: rv.screenshot });
  check({ id: 'R1-15', title: 'Accept & Assign -> confirm "Yes, Assign" -> POST offers/counter/accept/:offerId -> "Counter Offer Accepted Successfully"', type: 'positive', expected: 'POST offers/counter/accept 2xx + toast', actual: `${rv.api || rv.step} toastCounter=${rv.toastCounter} confirm="${(rv.confirmText || '').slice(0, 150)}"`, ok: rv.ok && /counter\/accept/.test(rv.api || '') && /-> 2\d\d/.test(rv.api || '') && rv.toastCounter, screenshot: rv.screenshot });
  const w = await woOf(tdApi, wo); const pay = await payment(tdApi, wo); const er = pay?.engineerRates || {};
  check({ id: 'R1-16', title: 'Work order is ASSIGNED to the engineer with the COUNTER rates (35/4/38) and the counter expense (Tools 15) in the engineer payment', type: 'positive', expected: 'ASSIGNED, engineer 575, engineerRates hourly 35, additional 38, expense TOOLS 15', actual: JSON.stringify({ status: w?.status, engineer: w?.engineer?.id, engineerRates: { hourlyRate: er.hourlyRate, minimumHours: er.minimumHours, additionalHourlyRate: er.additionalHourlyRate, expenses: (er.expenses || []).map((e) => `${e.expenseType}:${e.amount}`), totalWorkOrderCost: er.totalWorkOrderCost } }), ok: w?.status === 'ASSIGNED' && w?.engineer?.id === 575 && er.hourlyRate === 35 && er.additionalHourlyRate === 38 && (er.expenses || []).some((e) => e.expenseType === 'TOOLS' && Number(e.amount) === 15) });
  check({ id: 'R1-17', title: 'Customer rates are untouched by the engineer counter (45/5/50)', type: 'edge', expected: 'clientRates hourly 45', actual: JSON.stringify({ hourlyRate: pay?.clientRates?.hourlyRate, minimumHours: pay?.clientRates?.minimumHours, additionalHourlyRate: pay?.clientRates?.additionalHourlyRate }), ok: pay?.clientRates?.hourlyRate === 45 && pay?.clientRates?.minimumHours === 5 });
  await openWo(td, wo, 'payment'); s = await shotFull(td, 'R1-13_td-payment-tab-assigned');
  const tpt = await bodyText(td);
  check({ id: 'R1-18', title: 'Tech Domain Payment tab shows the accepted engineer rate 35.00 and the Crimping tool expense', type: 'positive', expected: '35.00 + Crimping tool', actual: tpt.slice(0, 800), ok: /35\.00/.test(tpt) && /Crimping tool/i.test(tpt), screenshot: s });
  await openWo(eng, wo); bt = await bodyText(eng); btns = await visibleButtons(eng); s = await shotFull(eng, 'R1-14_engineer-assigned-view');
  check({ id: 'R1-19', title: 'Engineer sees the work order as assigned to them (no Counter Offer / Request buttons any more)', type: 'positive', expected: 'Assigned, no counter/request buttons', actual: `${bt.slice(0, 200)} | ${btns.join(', ')}`, ok: /ASSIGNED|Assigned/.test(bt) && !btns.includes('Counter Offer') && !btns.includes('Request'), screenshot: s });
});

// =================================================================== R2
scenario('R2. Vendor owner counters for a member engineer; Tech Domain accepts; member is assigned', async (browser) => {
  const wo = WO.R2.id;
  const v = await ui(browser, 'vendor'); const tdApi = await apiOf('td', browser);
  await openWo(v, wo); let s = await shotFull(v, 'R2-01_vendor-published-wo');
  let btns = await visibleButtons(v);
  check({ id: 'R2-01', title: 'Vendor owner sees "Counter Offer" on the published work order', type: 'positive', expected: 'Counter Offer button', actual: btns.join(', '), ok: btns.includes('Counter Offer'), screenshot: s });
  const m = await openCounterModal(v); let mt = await modalText(m); s = await shot(v, 'R2-02_vendor-counter-modal');
  check({ id: 'R2-02', title: 'Vendor counter modal has a "Select Engineer" picker', type: 'positive', expected: 'Select Engineer', actual: mt.slice(0, 300), ok: /Select Engineer/.test(mt), screenshot: s });
  const picker = m.locator('input[role="combobox"], .MuiAutocomplete-root input').first();
  await picker.click(); await picker.fill('Demo'); await v.waitForTimeout(1200);
  await v.getByRole('option', { name: /Demo Worker/ }).first().click(); await v.waitForTimeout(1500);
  s = await shot(v, 'R2-03_vendor-engineer-selected');
  mt = await modalText(m); const picked = await picker.inputValue().catch(() => '');
  check({ id: 'R2-03', title: 'Member engineer "Demo Worker" can be selected (qualification table passes, no missing qualification)', type: 'positive', expected: 'Demo Worker selected, no "Add … to profile" hint', actual: `picker="${picked}" | ${mt.slice(0, 300)}`, ok: /Demo Worker/.test(picked + mt) && !/to profile/.test(mt), screenshot: s });
  await fillLabour(m, { hourlyRate: 28, minimumHours: 4, additionalHourlyRate: 30 });
  const [r1] = await Promise.all([v.waitForResponse((r) => r.url().includes('/offers/engineer/counter') && r.request().method() === 'PATCH', { timeout: 20_000 }).catch(() => null), sendBtn(m).click()]);
  const t = await waitToast(v, 'Counter Offer Sent Successfully'); s = await shot(v, 'R2-04_vendor-counter-sent');
  let payload = ''; try { payload = r1 ? r1.request().postData() : ''; } catch { }
  check({ id: 'R2-04', title: 'Vendor sends the counter (28/4/30) for the member: PATCH offers/engineer/counter with referredEngineerId 611', type: 'positive', expected: 'HTTP 2xx, toast, referredEngineerId 611 in the payload', actual: `HTTP ${r1?.status()} toast=${t} payload=${String(payload).slice(0, 200)}`, ok: r1 && r1.status() < 300 && t && /referredEngineerId"?\s*:\s*611/.test(String(payload)), screenshot: s });
  const off = (await offers(tdApi, wo)).map(offerBrief); const cd = await counterDetail(tdApi, wo, 611, 609);
  check({ id: 'R2-05', title: 'Tech Domain sees the PENDING counter created by vendor 609 for engineer 611 at 28/4/30', type: 'positive', expected: 'offer PENDING isCounter referred 611; counter userId 609, hourlyRate 28, additional 30', actual: `offers=${JSON.stringify(off)} counter=${JSON.stringify(cd)}`, ok: off.some((o) => o.status === 'PENDING' && o.isCounter && o.referred === 611) && cd && cd.userId === 609 && Number(cd.hourlyRate) === 28 && Number(cd.additionalHourlyRate) === 30 });
  const td = await ui(browser, 'td');
  const rv = await tdReviewAndAssign(td, wo, 'R2-05');
  check({ id: 'R2-06', title: 'Tech Domain Pending Assignments shows the vendor counter (company + Demo Worker) under COUNTER OFFERS', type: 'positive', expected: 'COUNTER OFFERS + Demo Worker', actual: `${rv.pendingText.slice(0, 500)} | step=${rv.step || 'ok'}`, ok: /COUNTER OFFERS/.test(rv.pendingText) && /Demo Worker/.test(rv.pendingText), screenshot: rv.screenshot });
  check({ id: 'R2-07', title: 'Review -> Accept & Assign -> Yes, Assign -> POST offers/counter/accept -> toast', type: 'positive', expected: 'counter/accept 2xx + "Counter Offer Accepted Successfully"', actual: `${rv.api || rv.step} toastCounter=${rv.toastCounter} modal="${(rv.modalText || '').slice(0, 200)}"`, ok: rv.ok && /counter\/accept/.test(rv.api || '') && /-> 2\d\d/.test(rv.api || '') && rv.toastCounter, screenshot: rv.screenshot });
  const w = await woOf(tdApi, wo); const pay = await payment(tdApi, wo); const er = pay?.engineerRates || {};
  check({ id: 'R2-08', title: 'Work order ASSIGNED to the member engineer 611 (company 79) with the vendor counter rates (28/4/30)', type: 'positive', expected: 'ASSIGNED, engineer 611, engineerCompany 79, hourly 28', actual: JSON.stringify({ status: w?.status, engineer: w?.engineer?.id, engineerCompany: w?.engineerCompany?.id, hourlyRate: er.hourlyRate, additionalHourlyRate: er.additionalHourlyRate }), ok: w?.status === 'ASSIGNED' && w?.engineer?.id === 611 && er.hourlyRate === 28 && er.additionalHourlyRate === 30 });
  const worker = await ui(browser, 'worker'); await openWo(worker, wo); s = await shotFull(worker, 'R2-06_worker-assigned-view'); const wt = await bodyText(worker);
  check({ id: 'R2-09', title: 'Vendor engineer (Demo Worker) sees the assigned work order', type: 'positive', expected: 'Assigned', actual: wt.slice(0, 300), ok: /ASSIGNED|Assigned/.test(wt), screenshot: s });
});

// =================================================================== R3
scenario('R3. "Disable counter offers" work order: engineer cannot counter; plain Request -> Requested Offer Review -> assign', async (browser) => {
  const wo = WO.R3.id;
  const eng = await ui(browser, 'eng'); const tdApi = await apiOf('td', browser);
  const w0 = await woOf(tdApi, wo);
  info('R3-00', 'Work order flag', `isCounterOffersDisable=${w0?.isCounterOffersDisable} status=${w0?.status}`);
  await openWo(eng, wo); let s = await shotFull(eng, 'R3-01_engineer-wo-counter-disabled');
  let btns = await visibleButtons(eng);
  check({ id: 'R3-01', title: 'With "Disable counter offers" the engineer sees Request but NO Counter Offer button', type: 'negative', expected: 'Request only', actual: btns.join(', '), ok: btns.includes('Request') && !btns.includes('Counter Offer'), note: 'If Counter Offer is still shown, the old flag is being ignored.', screenshot: s });
  const r = await call({ api: (await apiLogin(USERS.eng)).api }, 'PATCH', '/offers/engineer/counter', { workOrderId: wo, hourlyRate: 50, minimumHours: 4, additionalHourlyRate: 55, expenses: [] });
  check({ id: 'R3-02', title: 'API: engineer counter on a counter-disabled work order is rejected', type: 'negative', expected: 'HTTP 4xx', actual: brief(r), ok: r.status >= 400 });
  if (r.status < 300) { const engApi = await apiLogin(USERS.eng); const wd = await call(engApi, 'DELETE', `/offers/engineer/withdraw/${wo}`); info('R3-02b', 'Cleanup: the counter that should have been rejected was withdrawn again', brief(wd)); await engApi.api.dispose(); }
  await eng.reload(); await eng.waitForTimeout(3000);
  await eng.getByRole('button', { name: 'Request', exact: true }).click(); await eng.waitForTimeout(1500);
  const m = dialog(eng); const mt = await modalText(m); s = await shot(eng, 'R3-02_engineer-request-modal');
  check({ id: 'R3-03', title: '"Request Work Order" modal opens with "Send a Request"', type: 'positive', expected: 'Request Work Order + Send a Request', actual: mt.slice(0, 300), ok: /Request Work Order/.test(mt) && (await m.getByRole('button', { name: 'Send a Request' }).count()) === 1, screenshot: s });
  await eng.waitForTimeout(1500);
  let [r1] = await Promise.all([eng.waitForResponse((x) => x.url().includes('/offers/engineer/request') && x.request().method() === 'POST' && x.status() < 300, { timeout: 15_000 }).catch(() => null), m.getByRole('button', { name: 'Send a Request' }).click()]);
  if (!r1 && await m.getByRole('button', { name: 'Send a Request' }).isVisible().catch(() => false)) { // the first click sometimes lands while the modal is still mounting; retry once
    [r1] = await Promise.all([eng.waitForResponse((x) => x.url().includes('/offers/engineer/request') && x.request().method() === 'POST' && x.status() < 300, { timeout: 20_000 }).catch(() => null), m.getByRole('button', { name: 'Send a Request' }).click()]);
  }
  const t = await waitToast(eng, 'Offer Sent Successfully'); await eng.waitForTimeout(2000); btns = await visibleButtons(eng); s = await shotFull(eng, 'R3-03_engineer-requested');
  check({ id: 'R3-04', title: 'Send a Request -> POST offers/engineer/request -> "Offer Sent Successfully" -> "Withdraw Request"', type: 'positive', expected: 'HTTP 2xx + toast + Withdraw Request', actual: `HTTP ${r1?.status()} toast=${t} | ${btns.join(', ')}`, ok: r1 && r1.status() < 300 && t && btns.includes('Withdraw Request'), screenshot: s });
  const td = await ui(browser, 'td');
  const rv = await tdReviewAndAssign(td, wo, 'R3-04');
  check({ id: 'R3-05', title: 'Tech Domain: REQUESTED OFFERS > Review ("Requested Offer Review") > Accept & Assign > Yes, Assign -> POST offers/assign -> "Job Assign Successfully"', type: 'positive', expected: 'Requested Offer Review, offers/assign 2xx, toast', actual: `${(rv.modalText || '').slice(0, 200)} | ${rv.api || rv.step} toastAssign=${rv.toastAssign}`, ok: rv.ok && /Requested Offer Review/.test(rv.modalText || '') && /offers\/assign/.test(rv.api || '') && /-> 2\d\d/.test(rv.api || '') && rv.toastAssign, screenshot: rv.screenshot });
  const w = await woOf(tdApi, wo); const pay = await payment(tdApi, wo);
  check({ id: 'R3-06', title: 'Work order ASSIGNED to engineer 575 with the ORIGINAL engineer rates (20/4/22)', type: 'positive', expected: 'ASSIGNED, hourly 20', actual: JSON.stringify({ status: w?.status, engineer: w?.engineer?.id, hourlyRate: pay?.engineerRates?.hourlyRate, additionalHourlyRate: pay?.engineerRates?.additionalHourlyRate }), ok: w?.status === 'ASSIGNED' && w?.engineer?.id === 575 && pay?.engineerRates?.hourlyRate === 20 });
});
