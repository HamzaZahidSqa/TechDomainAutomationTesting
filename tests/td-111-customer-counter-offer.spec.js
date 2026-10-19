// TD-111: "counter offer from tech domain side to customer."  https://techdomain.atlassian.net/browse/TD-111
//
// Feature under test (dev build 2026-10-14, main.16fe721c.js):
//   A customer creates a work order (status PENDING_APPROVAL = "Submitted"). A Tech Domain (CLIENT) user can send the
//   customer a Counter Offer (different rates and/or extra expenses) from the work-order details page. The customer sees
//   it in a "Proposals" tab and can Accept or Decline. On accept the customer rates/expenses of the work order are
//   replaced by the accepted values and all later calculations use them. Tech Domain can also Edit / Withdraw the
//   pending counter offer; the latest counter offer replaces the previous one.
//
// Everything in scope is driven through the UI (Playwright, Chromium) with a screenshot per step. The API is used only
// for test-data setup (creating the customer work orders, engineer assignment / status walk) and to read back the
// calculated amounts (GET workOrders/estimatedPayment/:id) with the token of the logged-in browser session.
// When a step cannot be reached because an earlier step is broken on dev, the dependent checks are recorded as BLOCKED
// (not as failures) so the report shows exactly what could and could not be verified.
//
// Scenarios: A happy path + full lifecycle calculation, B decline, C edit + withdraw, D several Tech Domain users,
//            E negative / edge / boundary cases, F FIXED payment type, G customer notification.
// Run:  npx playwright test tests/td-111-customer-counter-offer.spec.js --reporter=line --trace off
// Evidence: evidence/TD-111-CustomerCounterOffer/run-<stamp>/  (screenshots + results.json)

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const td123 = require(path.join(__dirname, '..', 'td123-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const BASE_URL = process.env.BASE_URL || 'https://dev.techdomain.com.au';
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-111-CustomerCounterOffer', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: BASE_URL };
const ENTITY_ID = 104, TEMPLATE_WO = 242, TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const GEO = { geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'] };

const USERS = {
  td: accounts.find((a) => a.role === 'TechDomain User'),            // 27  Tech Domain owner (CLIENT)
  tdTeam: td123.find((a) => a.role === 'TD Team Member'),            // 640 Tech Domain user in Service Delivery 3
  tdNonTeam: td123.find((a) => a.role === 'TD Non-team User'),       // 641 Tech Domain user without a team
  cust: testAccounts.find((a) => a.role === 'Customer'),             // 638 customer owner (parent client 103, entity 104, company 9)
  custSub: td123.find((a) => a.role === 'Customer Sub-user'),        // 639 customer sub-user
  eng: accounts.find((a) => a.role === 'Individual Engineer'),       // 575 approved engineer
};

// tests run in file order on one worker (playwright.config workers=1); NOT serial so that a failing scenario does not skip the others
test.setTimeout(900_000);

// ------------------------------------------------------------------ results / evidence
const results = { ticket: 'TD-111', run: RUN, date: new Date().toISOString(), env: { ui: BASE_URL, api: API_URL }, workOrders: {}, checks: [], findings: [] };
let shotNo = 0;
const log = (m) => console.log(String(m).slice(0, 1500));
function check({ id, title, type, expected, actual, ok, note = '', screenshot = '' }) {
  const c = { id, title, type, expected: String(expected), actual: String(actual).slice(0, 1500), ok: !!ok, note, screenshot };
  results.checks.push(c);
  log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | expected: ${expected} | actual: ${String(actual).slice(0, 300)}`);
  return c;
}
function info(id, title, actual, screenshot = '') { results.checks.push({ id, title, type: 'info', expected: '-', actual: String(actual).slice(0, 1500), ok: true, info: true, note: '', screenshot }); log(`INFO ${id} ${title} :: ${String(actual).slice(0, 300)}`); }
function blocked(id, title, reason) { results.checks.push({ id, title, type: 'blocked', expected: 'could not be executed', actual: reason, ok: false, blocked: true, note: '', screenshot: '' }); log(`BLOCKED ${id} ${title} :: ${reason}`); }
async function shot(page, name, full = false) { shotNo += 1; const f = `TD-111_CounterOffer_${String(shotNo).padStart(2, '0')}_${name}.png`; try { await page.screenshot({ path: path.join(EVIDENCE, f), fullPage: full }); } catch (e) { log(`screenshot failed ${name}: ${e.message}`); } return f; }
const shotFull = (page, name) => shot(page, name, true);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scenario = (name, fn) => test(name, async ({ browser }) => { try { await fn(browser); } catch (e) { check({ id: `${name[0]}-ERR`, title: `scenario aborted by an unexpected error: ${name}`, type: 'error', expected: 'scenario completes', actual: String(e.stack || e.message).slice(0, 600), ok: false }); } });

// ------------------------------------------------------------------ API helpers
async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({})); await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`);
  return { api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } }), id: body.data?.id, name: `${body.data?.firstName || ''} ${body.data?.lastName || ''}`.trim(), account };
}
async function call(s, method, p, data, retry = true) {
  const headers = s.key ? { Authorization: tokens[s.key] } : undefined;
  const r = await s.api.fetch(u(p), { method, data, headers }); const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  if (r.status() === 401 && s.key && retry && contexts[s.key]) { // browser token expired: let the app refresh it, then retry once
    const page = contexts[s.key].page; await page.reload().catch(() => { }); await page.waitForTimeout(3500); return call(s, method, p, data, false);
  }
  return { status: r.status(), body };
}
const rej = (r) => r.status >= 400 && r.status !== 401; // rejected by business/authorization rules, not by an expired token
const brief = (r) => `HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body).slice(0, 200)}`;

function customerWoPayload(title, overrides = {}) {
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0); const day = start.toISOString().slice(0, 10);
  return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'TD-111 QA automation: Tech Domain counter offer to customer', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [{ expenseType: 'TRAVEL', description: 'Customer travel', amount: 30 }], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5, nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: 50, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [], ...overrides };
}
async function createCustomerWo(cust, key, title, overrides) {
  const cr = await call(cust, 'POST', '/workOrders', customerWoPayload(title, overrides));
  const id = cr.body?.id || cr.body?.data?.id; const ref = cr.body?.referenceId || cr.body?.data?.referenceId;
  log(`setup: customer POST /workOrders (${key}) -> ${cr.status} id=${id} ref=${ref} status=${cr.body?.status}`);
  if (!id) throw new Error(`could not create WO ${key}: ${brief(cr)}`);
  results.workOrders[key] = { id, ref, title, status: cr.body?.status };
  return { id, ref, title };
}

// ------------------------------------------------------------------ UI helpers
const contexts = {}; const tokens = {};
async function ui(browser, key) {
  if (contexts[key]) return contexts[key].page;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...GEO });
  const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  page.on('request', (r) => { const a = r.headers()['authorization']; if (a && r.url().includes(API_URL)) tokens[key] = a; });
  const a = USERS[key];
  await page.goto('/login'); await page.waitForTimeout(1500);
  await page.locator('input[type="email"], input[name="email"]').first().fill(a.email);
  await page.locator('input[type="password"]').first().fill(a.password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 }); await page.waitForTimeout(2500);
  contexts[key] = { ctx, page }; return page;
}
// API session that reuses the browser session's bearer token (a fresh API login would invalidate the browser token)
async function apiOf(key, browser) { if (!tokens[key]) await ui(browser, key); const api = await pwRequest.newContext({ extraHTTPHeaders: H }); return { api, key }; }

async function openWo(page, wo, customer = false, tab = 'details') {
  await page.goto(`/workOrder/${tab}/${wo}${customer ? '?fromCustomerBoard=true' : ''}`);
  await page.waitForTimeout(3500);
}
const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const visibleButtons = async (page) => (await page.locator('button:visible').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
const dialog = (page) => page.locator('[role=dialog], .MuiModal-root:visible, .MuiDialog-root:visible').last();
async function waitToast(page, text, timeout = 15_000) { try { await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout }); return true; } catch { return false; } }

async function openCounterModal(page) {
  await page.getByRole('button', { name: 'Counter Offer', exact: true }).click();
  const m = dialog(page); await expect(m.getByText('Counter Offer', { exact: true }).first()).toBeVisible(); await page.waitForTimeout(800); return m;
}
async function labourSection(m) { const first = m.locator('input[type=checkbox]').first(); if (!(await first.isChecked())) await first.check(); await m.page().waitForTimeout(400); return m.locator('div.grid-cols-7').first(); }
async function expenseSection(m) { const cb = m.locator('input[type=checkbox]').nth(1); if (!(await cb.isChecked())) await cb.check(); await m.page().waitForTimeout(400); return m.locator('div.grid-cols-7').filter({ has: m.page().locator('input[name="amount"]') }).first(); }
async function fillLabour(m, values) { const g = await labourSection(m); for (const [name, v] of Object.entries(values)) { const inp = g.locator(`input[name="${name}"]`); await inp.fill(''); if (v !== '' && v != null) await inp.fill(String(v)); } }
async function clickLabourAdd(m) { const g = await labourSection(m); await g.getByRole('button', { name: 'Add' }).click(); await m.page().waitForTimeout(1200); }
async function addExpense(m, type, description, amount, pick = true) {
  const g = await expenseSection(m);
  if (pick && type) { await g.locator('[role=combobox]').first().click(); await m.page().getByRole('option', { name: type, exact: true }).click(); }
  await g.locator('input[name="description"]').fill(description || '');
  await g.locator('input[name="amount"]').fill(amount == null ? '' : String(amount));
  await g.getByRole('button', { name: 'Add' }).click(); await m.page().waitForTimeout(1200);
}
const sendBtn = (m) => m.getByRole('button', { name: /Send Counter Offer|Update Counter Offer/ });
const modalText = async (m) => (await m.innerText()).replace(/\s+/g, ' ');
async function payment(apiCtx, wo) { const r = await call(apiCtx, 'GET', `/workOrders/estimatedPayment/${wo}`); return r.body?.data; }
async function counterOf(apiCtx, wo) { const r = await call(apiCtx, 'GET', `/offers/customer/counter/${wo}`); return { status: r.status, data: r.body?.data, msg: r.body?.message }; }
async function woOf(apiCtx, wo) { const r = await call(apiCtx, 'GET', `/workOrders/${wo}`); return r.body?.data; }
async function sendCounter(page, labour, expense) { // returns toast ok
  const m = await openCounterModal(page); await fillLabour(m, labour); await clickLabourAdd(m); if (expense) await addExpense(m, ...expense); await sendBtn(m).click(); return waitToast(page, 'Counter Offer Sent Successfully');
}

// customer side
async function openProposals(page, wo) { await openWo(page, wo, true, 'proposals'); return page.locator('article').first(); }
async function customerAnswer(page, cuApi, wo, which) { // try the UI first, then the API with the browser token; returns {via, ok, detail}
  const art = await openProposals(page, wo);
  const btn = art.getByRole('button', { name: which, exact: true });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click(); await page.waitForTimeout(800);
    const dt = (await dialog(page).innerText().catch(() => '')).replace(/\s+/g, ' ');
    await dialog(page).getByRole('button', { name: which, exact: true }).last().click();
    const ok = await waitToast(page, which === 'Accept' ? 'Proposal Accepted Successfully' : 'Proposal Declined');
    return { via: 'ui', ok, detail: `dialog: ${dt.slice(0, 200)} toast=${ok}` };
  }
  const co = await counterOf(cuApi, wo);
  if (co.status !== 200 || !co.data?.id) return { via: 'api', ok: false, detail: `no ${which} button in the UI; GET offers/customer/counter/${wo} as the customer -> HTTP ${co.status} ${co.msg || ''}` };
  const r = await call(cuApi, 'POST', `/offers/customer/counter/${which === 'Accept' ? 'accept' : 'decline'}/${co.data.id}`, {});
  return { via: 'api', ok: r.status < 300, detail: `no ${which} button in the UI; API ${brief(r)}` };
}

// ------------------------------------------------------------------ setup: create all work orders first (API, customer)
const WO = {};
test.beforeAll(async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const cust = await apiLogin(USERS.cust);
  WO.A = await createCustomerWo(cust, 'A', `TD-111 A happy path ${RUN}`);
  WO.B = await createCustomerWo(cust, 'B', `TD-111 B decline ${RUN}`);
  WO.C = await createCustomerWo(cust, 'C', `TD-111 C edit-withdraw ${RUN}`);
  WO.D = await createCustomerWo(cust, 'D', `TD-111 D multi TD users ${RUN}`);
  WO.E = await createCustomerWo(cust, 'E', `TD-111 E negatives ${RUN}`);
  WO.F = await createCustomerWo(cust, 'F', `TD-111 F fixed rate ${RUN}`, { paymentType: 'FIXED', fixedAmount: 300, hourlyRate: null, minimumHours: null, additionalHourlyRate: null, expenses: [] });
  await cust.api.dispose();
});
test.afterAll(async () => {
  for (const c of results.checks) if (!c.ok && !c.blocked) results.findings.push(`${c.id} ${c.title}`);
  results.summary = { total: results.checks.filter((c) => !c.info).length, pass: results.checks.filter((c) => !c.info && c.ok).length, fail: results.checks.filter((c) => !c.ok && !c.blocked).length, blocked: results.checks.filter((c) => c.blocked).length, info: results.checks.filter((c) => c.info).length };
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  log(`\nSUMMARY ${JSON.stringify(results.summary)} evidence=${EVIDENCE}`);
  for (const k of Object.keys(contexts)) await contexts[k].ctx.close().catch(() => { });
});

// =================================================================== A. happy path + lifecycle
scenario('A. Tech Domain sends a counter offer, customer accepts, work order moves on with the accepted rates', async (browser) => {
  const wo = WO.A.id;
  const td = await ui(browser, 'td');
  await openWo(td, wo);
  let s = await shotFull(td, 'A01_td-submitted-wo-details');
  const btns = await visibleButtons(td);
  check({ id: 'A-01', title: 'Tech Domain sees "Counter Offer" on a customer-created Submitted work order', type: 'positive', expected: 'buttons include Counter Offer and Review & Publish', actual: btns.join(', '), ok: btns.includes('Counter Offer') && btns.includes('Review & Publish'), screenshot: s });
  const tdApi = await apiOf('td', browser);
  const pay0 = await payment(tdApi, wo);
  check({ id: 'A-02', title: 'Customer rates before the counter offer (hourly 45, min 5 h, additional 50, travel expense 30)', type: 'positive', expected: 'clientRates 45 / 5 / 50, expenses 30, total 255', actual: JSON.stringify({ hourlyRate: pay0?.clientRates?.hourlyRate, minimumHours: pay0?.clientRates?.minimumHours, additionalHourlyRate: pay0?.clientRates?.additionalHourlyRate, totalExpenseCost: pay0?.clientRates?.totalExpenseCost, totalWorkOrderCost: pay0?.clientRates?.totalWorkOrderCost }), ok: pay0?.clientRates?.hourlyRate === 45 && pay0?.clientRates?.minimumHours === 5 && pay0?.clientRates?.totalWorkOrderCost === 255 });

  const m = await openCounterModal(td);
  s = await shot(td, 'A02_td-counter-modal-opened');
  const mt = await modalText(m);
  check({ id: 'A-03', title: 'Counter Offer modal shows the current labour, the customer expense and the estimated payment', type: 'positive', expected: 'Hourly Rate USD 45.00, Minimum Payable Hours 5 hrs, Additional Hourly rate USD 50.00, Travel Expense USD 30.00, Estimated Payment USD 255.00', actual: mt.slice(0, 500), ok: /USD 45\.00/.test(mt) && /5 hrs/.test(mt) && /USD 50\.00/.test(mt) && /Travel Expense/.test(mt) && /USD 255\.00/.test(mt), screenshot: s });
  check({ id: 'A-04', title: '"Send Counter Offer" is disabled until something is added', type: 'negative', expected: 'disabled', actual: `disabled=${await sendBtn(m).isDisabled()}`, ok: await sendBtn(m).isDisabled() });
  await fillLabour(m, { hourlyRate: 60, minimumHours: 4, additionalHourlyRate: 65 });
  s = await shot(td, 'A03_td-labour-values-typed');
  await clickLabourAdd(m);
  s = await shot(td, 'A04_td-labour-added');
  let mt2 = await modalText(m);
  check({ id: 'A-05', title: 'After Labour "Add" the modal shows old (struck) and new values and recalculates the estimate (60 x 4 = 240 + customer expense 30 = 270)', type: 'positive', expected: 'USD 60.00, 4 hrs, USD 65.00 and Estimated Payment USD 255.00 -> USD 270.00', actual: mt2.slice(0, 700), ok: /USD 60\.00/.test(mt2) && /4 hrs/.test(mt2) && /USD 65\.00/.test(mt2) && /USD 270\.00/.test(mt2), screenshot: s });
  await addExpense(m, 'Tools Expense', 'Ladder hire', 20);
  s = await shot(td, 'A05_td-expense-added');
  mt2 = await modalText(m);
  check({ id: 'A-06', title: 'Counter expense "Tools Expense (Ladder hire) USD 20.00" is listed', type: 'positive', expected: 'Tools Expense (Ladder hire) USD 20.00', actual: mt2.slice(0, 700), ok: /Tools Expense \(Ladder hire\)/.test(mt2) && /USD 20\.00/.test(mt2), screenshot: s });
  check({ id: 'A-06b', title: 'Modal estimate includes the proposed expense (labour 240 + customer expense 30 + proposed expense 20 = 290)', type: 'edge', expected: 'Estimated Payment USD 255.00 -> USD 290.00', actual: (mt2.match(/Estimated Payment[^A-Z]*(USD [\d,.]+)(\s*USD [\d,.]+)?/) || [])[0] || mt2.slice(0, 200), ok: /USD 290\.00/.test(mt2), screenshot: s });
  check({ id: 'A-07', title: '"Send Counter Offer" becomes enabled after adding values', type: 'positive', expected: 'enabled', actual: `disabled=${await sendBtn(m).isDisabled()}`, ok: !(await sendBtn(m).isDisabled()) });
  const [resp] = await Promise.all([td.waitForResponse((r) => r.url().includes('/offers/customer/counter') && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null), sendBtn(m).click()]);
  const toast = await waitToast(td, 'Counter Offer Sent Successfully');
  s = await shot(td, 'A06_td-counter-sent-toast');
  check({ id: 'A-08', title: 'Send Counter Offer calls POST offers/customer/counter and shows "Counter Offer Sent Successfully"', type: 'positive', expected: 'HTTP 2xx + toast', actual: `HTTP ${resp?.status()} toast=${toast}`, ok: resp && resp.status() < 300 && toast, screenshot: s });
  await td.waitForTimeout(2500);
  const btns2 = await visibleButtons(td); const bt = await bodyText(td);
  s = await shotFull(td, 'A07_td-after-send-buttons-banner');
  check({ id: 'A-09', title: 'After sending, Tech Domain gets "Edit Counter Offer" + "Withdraw Counter Offer" instead of "Counter Offer"', type: 'positive', expected: 'Edit Counter Offer, Withdraw Counter Offer; no plain Counter Offer', actual: btns2.join(', '), ok: btns2.includes('Edit Counter Offer') && btns2.includes('Withdraw Counter Offer') && !btns2.includes('Counter Offer'), screenshot: s });
  check({ id: 'A-10', title: 'Header shows the "Counter Sent" sub-status and the banner "Counter Offer Sent" names the sender and time', type: 'positive', expected: 'Submitted -> Counter Sent badge; banner "Counter Offer Sent / Awaiting the customer\'s response to the counter offer sent by istkhar Hussain on <date>"', actual: bt.slice(0, 600), ok: /Counter Sent/.test(bt) && /Counter Offer Sent/.test(bt) && /Awaiting the customer's response to the counter offer sent by istkhar Hussain/.test(bt), screenshot: s });
  const co = await counterOf(tdApi, wo);
  info('A-11', 'Counter offer record as seen by Tech Domain (GET offers/customer/counter/:wo)', JSON.stringify({ status: co.data?.status, id: co.data?.id, type: co.data?.type, userId: co.data?.userId, createdById: co.data?.createdById, hourlyRate: co.data?.hourlyRate, customerHourlyRate: co.data?.customerHourlyRate, expenses: (co.data?.expenses || []).map((e) => [e.expenseType, e.amount]), history: (co.data?.offerHistory || []).map((h) => h.status) }));
  check({ id: 'A-12', title: 'Counter offer is PENDING and stores the proposed customer rates (60/4/65) + the proposed expense', type: 'positive', expected: 'status PENDING, customerHourlyRate 60, customerMinimumHours 4, customerAdditionalHourlyRate 65, 1 expense 20', actual: JSON.stringify({ status: co.data?.status, customerHourlyRate: co.data?.customerHourlyRate, customerMinimumHours: co.data?.customerMinimumHours, customerAdditionalHourlyRate: co.data?.customerAdditionalHourlyRate, expenses: co.data?.expenses?.length }), ok: co.data?.status === 'PENDING' && Number(co.data?.customerHourlyRate) === 60 && Number(co.data?.customerMinimumHours) === 4 && Number(co.data?.customerAdditionalHourlyRate) === 65 && (co.data?.expenses || []).length === 1 });
  const pay1 = await payment(tdApi, wo);
  check({ id: 'A-13', title: 'While the counter offer is pending the work order keeps the original customer rates (45/5/50, 255)', type: 'edge', expected: 'unchanged', actual: JSON.stringify({ hourlyRate: pay1?.clientRates?.hourlyRate, total: pay1?.clientRates?.totalWorkOrderCost }), ok: pay1?.clientRates?.hourlyRate === 45 && pay1?.clientRates?.totalWorkOrderCost === 255 });

  // ---- customer
  const cu = await ui(browser, 'cust'); const cuApi = await apiOf('cust', browser);
  await openWo(cu, wo, true);
  s = await shotFull(cu, 'A08_customer-wo-details-proposal-pending');
  const cbt = await bodyText(cu); const ctabs = await cu.locator('[role=tab]').allInnerTexts();
  check({ id: 'A-14', title: 'Customer header says a proposal with different rates is awaiting their answer', type: 'positive', expected: '"Your provider sent you a proposal with different rates, awaiting your answer"', actual: cbt.slice(0, 500), ok: /Your provider sent you a proposal with different rates, awaiting your answer/.test(cbt), screenshot: s });
  check({ id: 'A-15', title: 'Customer gets a "Proposals" tab once a counter offer exists', type: 'positive', expected: 'tabs include Proposals', actual: ctabs.join(', '), ok: ctabs.some((t) => /Proposals/i.test(t)) });
  const coC = await counterOf(cuApi, wo);
  check({ id: 'A-16', title: 'Customer (owner who created the work order) can read the counter offer: GET offers/customer/counter/:wo with the customer\'s browser token', type: 'positive', expected: 'HTTP 200, status PENDING', actual: `HTTP ${coC.status} ${coC.msg || ''} data=${String(JSON.stringify(coC.data)).slice(0, 120)}`, ok: coC.status === 200 && coC.data?.status === 'PENDING' });
  const art = await openProposals(cu, wo);
  s = await shotFull(cu, 'A09_customer-proposals-tab');
  const at = (await art.innerText().catch(() => '')).replace(/\s+/g, ' ');
  check({ id: 'A-17', title: 'Proposal card shows Current vs Proposed labour, proposed expense, estimated payment old/new, "Awaiting your response" and Accept/Decline', type: 'positive', expected: 'Current USD 225.00, Proposed USD 240.00, Ladder hire 20.00, Estimated payment 255.00 -> 290.00, Awaiting your response, From istkhar Hussain', actual: at ? at.slice(0, 700) : `no proposal card; page url ${cu.url()}`, ok: /Awaiting your response/.test(at) && /USD 225\.00/.test(at) && /USD 240\.00/.test(at) && /Ladder hire/.test(at) && /USD 290\.00/.test(at) && (await art.getByRole('button', { name: 'Accept', exact: true }).isVisible().catch(() => false)), screenshot: s });
  const ans = await customerAnswer(cu, cuApi, wo, 'Accept');
  s = await shot(cu, 'A10_customer-accept-attempt');
  check({ id: 'A-18', title: 'Customer accepts the proposal (UI Accept -> "Accept Proposal" confirmation -> "Proposal Accepted Successfully")', type: 'positive', expected: 'accepted', actual: `${ans.via}: ${ans.detail}`, ok: ans.ok, screenshot: s });
  if (!ans.ok) {
    const why = `customer cannot see or accept the counter offer on dev (${ans.detail.slice(0, 160)})`;
    for (const [id, t] of [['A-19', 'Proposal card shows "Accepted … by you" and no Accept/Decline buttons'], ['A-20', 'Customer header shows "You accepted the proposal"'], ['A-21', 'Customer Payment tab shows the accepted rates and both expenses'], ['A-22', 'Calculation after acceptance uses the accepted rates (60 x 4 = 240 + 30 + 20 = 290)'], ['A-23', 'Work order record carries the accepted customer rates and stays Submitted for Tech Domain review'], ['A-24', 'Tech Domain sees "Counter Offer Accepted … rates have been updated" and no counter buttons'], ['A-25', 'Tech Domain Payment tab shows the accepted rates and expenses'], ['A-26', 'Accepted rates survive publishing'], ['A-27', 'Engineer routed / accepts / assigned'], ['A-28', 'Engineer completes the job -> WORKDONE'], ['A-29', 'Completion calculation uses the accepted rate and all expenses (customer + counter + Tech Domain)'], ['A-30', 'Tech Domain Payment tab at WORKDONE shows accepted rate + counter expense + Tech Domain expense'], ['A-31', 'Customer Payment tab at WORKDONE shows accepted rate + counter expense']]) blocked(id, t, why);
    // extra evidence of what the customer actually gets
    await cu.locator('i[class*="fa-bell"]').first().click().catch(() => { }); await cu.waitForTimeout(2500);
    s = await shot(cu, 'A11_customer-bell-notification');
    const bell = await bodyText(cu);
    info('A-32', 'Customer bell panel after the counter offer (notification text)', (bell.match(/.{0,80}sent you a proposal.{0,60}/) || [bell.slice(0, 300)])[0], s);
    const notif = cu.getByText('has sent you a proposal', { exact: false }).first();
    if (await notif.isVisible().catch(() => false)) { await notif.click().catch(() => { }); await cu.waitForTimeout(3500); s = await shotFull(cu, 'A12_customer-after-clicking-notification'); info('A-33', 'Where the proposal notification takes the customer (link is /workOrder/proposals/:id?fromCustomerBoard=true)', `url ${cu.url()} | tabs ${(await cu.locator('[role=tab]').allInnerTexts()).join(', ')} | ${(await bodyText(cu)).slice(0, 200)}`, s); }
    await openWo(cu, wo, true, 'payment'); s = await shotFull(cu, 'A13_customer-payment-tab-while-pending');
    return;
  }
  // ---------- reached only when the customer could accept ----------
  await cu.waitForTimeout(2500);
  const at2 = (await cu.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  s = await shotFull(cu, 'A12_customer-proposal-accepted-card');
  check({ id: 'A-19', title: 'Proposal card now shows "Accepted … by you" and no Accept/Decline buttons', type: 'positive', expected: 'Accepted pill, "accepted by you", no buttons', actual: at2.slice(0, 400), ok: /Accepted/.test(at2) && !(await cu.locator('article').first().getByRole('button', { name: 'Accept', exact: true }).isVisible().catch(() => false)), screenshot: s });
  await openWo(cu, wo, true);
  const cbt2 = await bodyText(cu); s = await shot(cu, 'A13_customer-header-you-accepted');
  check({ id: 'A-20', title: 'Customer header shows "You accepted the proposal"', type: 'positive', expected: 'You accepted the proposal', actual: cbt2.slice(0, 400), ok: /You accepted the proposal/.test(cbt2), screenshot: s });
  await openWo(cu, wo, true, 'payment'); s = await shotFull(cu, 'A14_customer-payment-tab-after-accept');
  const cpt = await bodyText(cu);
  check({ id: 'A-21', title: 'Customer Payment tab shows the accepted rates and both expenses (customer travel 30 + Tech Domain tools 20)', type: 'positive', expected: '60.00, 65.00, Travel 30.00, Ladder hire 20.00', actual: cpt.slice(0, 900), ok: /60\.00/.test(cpt) && /65\.00/.test(cpt) && /30\.00/.test(cpt) && /20\.00/.test(cpt) && /Ladder hire/i.test(cpt), screenshot: s });
  const pay2 = await payment(tdApi, wo);
  check({ id: 'A-22', title: 'Calculation after acceptance uses the accepted rates: 60 x 4 h = 240 labour + 30 + 20 expenses = 290 total', type: 'positive', expected: 'clientRates hourly 60, min 4, additional 65, totalLabourCost 240, totalExpenseCost 50, totalWorkOrderCost 290', actual: JSON.stringify({ hourlyRate: pay2?.clientRates?.hourlyRate, minimumHours: pay2?.clientRates?.minimumHours, additionalHourlyRate: pay2?.clientRates?.additionalHourlyRate, totalLabourCost: pay2?.clientRates?.totalLabourCost, totalExpenseCost: pay2?.clientRates?.totalExpenseCost, totalWorkOrderCost: pay2?.clientRates?.totalWorkOrderCost, expenses: (pay2?.clientRates?.expenses || []).map((e) => [e.expenseType, e.description, e.amount]) }), ok: pay2?.clientRates?.hourlyRate === 60 && pay2?.clientRates?.minimumHours === 4 && pay2?.clientRates?.additionalHourlyRate === 65 && pay2?.clientRates?.totalLabourCost === 240 && pay2?.clientRates?.totalExpenseCost === 50 && pay2?.clientRates?.totalWorkOrderCost === 290 });
  const woA = await woOf(tdApi, wo);
  check({ id: 'A-23', title: 'Work order record itself now carries the accepted customer rates and stays Submitted (PENDING_APPROVAL) for Tech Domain review', type: 'positive', expected: 'hourlyRate 60, minimumHours 4, additionalHourlyRate 65, status PENDING_APPROVAL', actual: JSON.stringify({ hourlyRate: woA?.hourlyRate, minimumHours: woA?.minimumHours, additionalHourlyRate: woA?.additionalHourlyRate, status: woA?.status }), ok: Number(woA?.hourlyRate) === 60 && Number(woA?.minimumHours) === 4 && Number(woA?.additionalHourlyRate) === 65 && woA?.status === 'PENDING_APPROVAL' });
  await openWo(td, wo);
  const bt3 = await bodyText(td); const btns3 = await visibleButtons(td);
  s = await shotFull(td, 'A15_td-after-acceptance-banner');
  check({ id: 'A-24', title: 'Tech Domain sees "Counter Offer Accepted … The customer rates have been updated." and no counter buttons any more', type: 'positive', expected: 'banner + no Counter Offer / Edit / Withdraw', actual: `${bt3.slice(0, 500)} | buttons: ${btns3.join(', ')}`, ok: /Counter Offer Accepted/.test(bt3) && /customer rates have been updated/.test(bt3) && !btns3.some((b) => /Counter Offer/.test(b)), screenshot: s });
  await openWo(td, wo, false, 'payment'); s = await shotFull(td, 'A16_td-payment-tab-after-acceptance');
  const tpt = await bodyText(td);
  check({ id: 'A-25', title: 'Tech Domain Payment tab shows the accepted customer rates and expenses', type: 'positive', expected: '60.00 / 65.00 and expenses 30 + 20', actual: tpt.slice(0, 900), ok: /60\.00/.test(tpt) && /65\.00/.test(tpt) && /30\.00/.test(tpt) && /20\.00/.test(tpt), screenshot: s });
  const template = (await call(tdApi, 'GET', `/workOrders/${TEMPLATE_WO}`)).body?.data;
  await call(tdApi, 'PATCH', `/workOrders/${wo}`, { teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3', categoryId: template?.category?.id, workOrderServices: (template?.workOrderServices || []).map((x) => ({ serviceId: x.serviceId || x.id })), engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerMinimumHours: 4, engineerAdditionalHourlyRate: 15 });
  const ap = await call(tdApi, 'POST', `/workOrders/${wo}/approvePublish`, {});
  const woP = await woOf(tdApi, wo);
  check({ id: 'A-26', title: 'Tech Domain publishes the work order after acceptance; the accepted customer rates survive publishing', type: 'positive', expected: 'PUBLISHED, hourlyRate 60, minimumHours 4', actual: JSON.stringify({ approvePublish: ap.status, status: woP?.status, hourlyRate: woP?.hourlyRate, minimumHours: woP?.minimumHours }), ok: ap.status < 300 && woP?.status === 'PUBLISHED' && Number(woP?.hourlyRate) === 60 });
  const eng = await apiLogin(USERS.eng);
  const route = await call(tdApi, 'POST', '/offers/route', { workOrderId: wo, userIds: [eng.id] });
  const offerId = (route.body?.data || [])[0]?.id;
  const acc = await call(eng, 'POST', `/offers/route/accept/${offerId}`, {});
  const asg = await call(tdApi, 'POST', '/offers/assign', { workOrderId: wo, userId: eng.id });
  let w = await woOf(tdApi, wo);
  check({ id: 'A-27', title: 'Engineer routed, accepts and is assigned (setup for the completion calculation)', type: 'positive', expected: 'ASSIGNED', actual: JSON.stringify({ route: route.status, accept: acc.status, assign: asg.status, status: w?.status }), ok: w?.status === 'ASSIGNED' });
  if (w?.status === 'ASSIGNED') {
    const task = (t) => (w.tasks || []).find((x) => x.taskType === t);
    const walk = [];
    const stepW = async (n, fn) => { const r = await fn(); walk.push(`${n}:${r.status}`); await sleep(2000); w = await woOf(tdApi, wo); };
    await stepW('confirm', () => call(eng, 'PATCH', `/workOrders/${wo}/subStatus`, { subStatus: 'CONFIRMED' }));
    const now = new Date(); const day = now.toISOString().slice(0, 10); const hm = now.toISOString().slice(11, 16);
    await stepW('schedule-now', () => call(tdApi, 'PATCH', `/workOrders/${wo}`, { orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' }));
    await stepW('re-confirm', () => call(eng, 'PATCH', `/workOrders/${wo}/subStatus`, { subStatus: 'CONFIRMED' }));
    for (const [t, body] of [['START_TIME', { isCompleted: true, text: new Date().toISOString() }], ['ON_THE_WAY', { isCompleted: true, text: new Date().toISOString() }]]) { const tk = task(t); if (tk?.completedTask?.id) await stepW(`task-${t}`, () => call(eng, 'PATCH', `/tasks/${tk.completedTask.id}`, body)); }
    const lat = 31.5203696, lng = 74.3587473;
    await stepW('checkIn', () => call(eng, 'POST', '/timeLogs/checkIn', { workOrderId: wo, checkInLatitude: lat, checkInLongitude: lng, taskId: task('CHECK_IN')?.completedTask?.id, checkInTimeZone: 'UTC' }));
    await stepW('checkOut', () => call(eng, 'POST', '/timeLogs/checkOut', { workOrderId: wo, checkOutLatitude: lat, checkOutLongitude: lng, taskId: task('CHECK_OUT')?.completedTask?.id, checkOutTimeZone: 'UTC' }));
    await stepW('markComplete', () => call(eng, 'PATCH', `/tasks/${task('MARK_COMPLETE')?.completedTask?.id}`, { isCompleted: true, text: 'TD-111 complete' }));
    check({ id: 'A-28', title: 'Engineer completes the job (confirm, check-in, check-out, mark complete) -> WORKDONE', type: 'positive', expected: 'WORKDONE', actual: `${walk.join(' ')} status=${w?.status}`, ok: w?.status === 'WORKDONE' });
    await openWo(td, wo, false, 'payment'); s = await shotFull(td, 'A17_td-payment-tab-workdone');
    let tdExpNote = '';
    try {
      await td.locator('h6:has-text("Techdomain Expenses")').locator('..').locator('i[class*="fa-pencil"]').first().click(); await td.waitForTimeout(1000);
      const em = dialog(td); await expect(em.getByText('Edit Techdomain Expenses')).toBeVisible();
      await em.getByRole('button', { name: 'Add Expense' }).click(); await td.waitForTimeout(500);
      const row = em.locator('.bg-light').last();
      await row.locator('[role=combobox]').first().click(); await td.getByRole('option', { name: 'Material Expense', exact: true }).click();
      await row.locator('input[name="description"]').fill('TD cable material'); await row.locator('input[name="amount"]').fill('25');
      s = await shot(td, 'A18_td-expense-modal-filled');
      await em.getByRole('button', { name: 'Save Changes' }).click(); await td.waitForTimeout(3000); tdExpNote = 'added via UI';
    } catch (e) { const r = await call(tdApi, 'PATCH', `/workOrders/${wo}/companyExpenses`, { id: wo, companyCurrency: 'USD', expenses: [{ expenseType: 'MATERIAL', description: 'TD cable material', amount: 25 }] }); tdExpNote = `UI add failed (${e.message.slice(0, 100)}); API PATCH companyExpenses -> ${r.status}`; }
    await openWo(td, wo, false, 'payment'); s = await shotFull(td, 'A19_td-payment-tab-with-td-expense');
    const pay3 = await payment(tdApi, wo); const cr = pay3?.clientRates || {}; const expList = (cr.expenses || []).map((e) => `${e.expenseType}:${e.amount}`);
    const expectedLabour = 60 * Math.max(Number(cr.hoursWorked || 0), 4);
    check({ id: 'A-29', title: 'Completion calculation uses the ACCEPTED rate: labour = 60/h x max(hours worked, 4 min hours); expenses = customer 30 + counter 20 (Tech Domain expense tracked separately)', type: 'positive', expected: `hourlyRate 60, totalLabourCost ${expectedLabour}, expenses include TRAVEL 30 and TOOLS 20`, actual: JSON.stringify({ hourlyRate: cr.hourlyRate, minimumHours: cr.minimumHours, hoursWorked: cr.hoursWorked, totalLabourCost: cr.totalLabourCost, totalExpenseCost: cr.totalExpenseCost, totalWorkOrderCost: cr.totalWorkOrderCost, grandTotal: cr.grandTotal, expenses: expList, tdExpense: tdExpNote }), ok: cr.hourlyRate === 60 && cr.totalLabourCost === expectedLabour && expList.includes('TRAVEL:30') && expList.includes('TOOLS:20'), screenshot: s });
    const tpt2 = await bodyText(td);
    check({ id: 'A-30', title: 'Tech Domain Payment tab at WORKDONE shows the accepted rate 60.00, the counter expense and the Tech Domain expense 25.00', type: 'positive', expected: '60.00, Ladder hire, 25.00', actual: tpt2.slice(0, 1200), ok: /60\.00/.test(tpt2) && /Ladder hire/i.test(tpt2) && /25\.00/.test(tpt2), screenshot: s });
    await openWo(cu, wo, true, 'payment'); s = await shotFull(cu, 'A20_customer-payment-tab-workdone');
    const cpt2 = await bodyText(cu);
    check({ id: 'A-31', title: 'Customer Payment tab at WORKDONE still shows the accepted rate and the counter expense', type: 'positive', expected: '60.00 and Ladder hire', actual: cpt2.slice(0, 900), ok: /60\.00/.test(cpt2) && /Ladder hire/i.test(cpt2), screenshot: s });
  }
  await eng.api.dispose().catch(() => { });
});

// =================================================================== B. decline
scenario('B. Customer declines the counter offer -> original rates stay, Tech Domain can counter again', async (browser) => {
  const wo = WO.B.id;
  const td = await ui(browser, 'td'); const cu = await ui(browser, 'cust'); const tdApi = await apiOf('td', browser); const cuApi = await apiOf('cust', browser);
  await openWo(td, wo);
  const t1 = await sendCounter(td, { hourlyRate: 70, minimumHours: 5, additionalHourlyRate: 75 }, ['Travel Expense', 'Extra travel', 15]);
  let s = await shot(td, 'B01_td-counter-sent-70');
  check({ id: 'B-01', title: 'Tech Domain sends a counter offer (70/5/75 + travel 15)', type: 'positive', expected: 'toast Counter Offer Sent Successfully', actual: `toast=${t1}`, ok: t1, screenshot: s });
  await cu.waitForTimeout(1000);
  const ans = await customerAnswer(cu, cuApi, wo, 'Decline');
  s = await shotFull(cu, 'B02_customer-decline-attempt');
  check({ id: 'B-02', title: 'Customer declines the proposal (UI Decline -> "Decline Proposal" confirmation -> "Proposal Declined")', type: 'positive', expected: 'declined', actual: `${ans.via}: ${ans.detail}`, ok: ans.ok, screenshot: s });
  if (!ans.ok) {
    const why = `customer cannot see or decline the counter offer on dev (${ans.detail.slice(0, 160)})`;
    for (const [id, t] of [['B-03', 'Proposal card shows "Declined … by you", no Accept/Decline buttons'], ['B-04', 'Customer header shows "You declined the proposal"'], ['B-05', 'After decline the work order keeps the original rates (45/5/50, 255)'], ['B-06', 'Tech Domain sees "Counter Offer Declined … keeps its original rates" and can send a new Counter Offer'], ['B-07', 'A new counter offer can be sent after a decline and the customer sees it']]) blocked(id, t, why);
    return;
  }
  await cu.waitForTimeout(2000);
  const at = (await cu.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  s = await shotFull(cu, 'B03_customer-proposal-declined-card');
  check({ id: 'B-03', title: 'Proposal card shows "Declined … by you", no Accept/Decline buttons', type: 'positive', expected: 'Declined pill', actual: at.slice(0, 400), ok: /Declined/.test(at) && !(await cu.locator('article').first().getByRole('button', { name: 'Accept', exact: true }).isVisible().catch(() => false)), screenshot: s });
  await openWo(cu, wo, true); const cbt = await bodyText(cu); s = await shot(cu, 'B04_customer-header-you-declined');
  check({ id: 'B-04', title: 'Customer header shows "You declined the proposal"', type: 'positive', expected: 'You declined the proposal', actual: cbt.slice(0, 300), ok: /You declined the proposal/.test(cbt), screenshot: s });
  const pay = await payment(tdApi, wo);
  check({ id: 'B-05', title: 'After decline the work order keeps the original rates and only the customer expense (45/5/50, total 255)', type: 'positive', expected: 'hourly 45, expenses 30, total 255', actual: JSON.stringify({ hourlyRate: pay?.clientRates?.hourlyRate, totalExpenseCost: pay?.clientRates?.totalExpenseCost, total: pay?.clientRates?.totalWorkOrderCost }), ok: pay?.clientRates?.hourlyRate === 45 && pay?.clientRates?.totalExpenseCost === 30 && pay?.clientRates?.totalWorkOrderCost === 255 });
  await openWo(td, wo); const bt = await bodyText(td); const btns = await visibleButtons(td); s = await shotFull(td, 'B05_td-after-decline-banner');
  check({ id: 'B-06', title: 'Tech Domain sees "Counter Offer Declined … keeps its original rates" and can send a new Counter Offer', type: 'positive', expected: 'banner + Counter Offer button', actual: `${bt.slice(0, 500)} | ${btns.join(', ')}`, ok: /Counter Offer Declined/.test(bt) && btns.includes('Counter Offer'), screenshot: s });
  const t3 = await sendCounter(td, { hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55 }); s = await shot(td, 'B06_td-second-counter-after-decline');
  await openProposals(cu, wo); const at2 = (await cu.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check({ id: 'B-07', title: 'A new counter offer can be sent after a decline and the customer sees it (50/h awaiting response)', type: 'positive', expected: 'toast + Awaiting your response + USD 50.00', actual: `toast=${t3} | ${at2.slice(0, 300)}`, ok: t3 && /Awaiting your response/.test(at2) && /USD 50\.00/.test(at2), screenshot: s });
});

// =================================================================== C. edit + withdraw
scenario('C. Tech Domain edits and then withdraws a pending counter offer', async (browser) => {
  const wo = WO.C.id;
  const td = await ui(browser, 'td'); const cu = await ui(browser, 'cust'); const tdApi = await apiOf('td', browser); const cuApi = await apiOf('cust', browser);
  await openWo(td, wo);
  const t1 = await sendCounter(td, { hourlyRate: 55, minimumHours: 5, additionalHourlyRate: 60 });
  let s = await shot(td, 'C01_td-counter-sent-55');
  check({ id: 'C-01', title: 'Initial counter offer 55/5/60 sent', type: 'positive', expected: 'toast', actual: `toast=${t1}`, ok: t1, screenshot: s });
  await td.waitForTimeout(2000);
  await td.getByRole('button', { name: 'Edit Counter Offer', exact: true }).click(); await td.waitForTimeout(1200);
  let m = dialog(td);
  s = await shot(td, 'C02_td-edit-counter-modal');
  const mt = await modalText(m);
  check({ id: 'C-02', title: 'Edit Counter Offer opens the modal pre-filled with the pending counter (55 -> shown next to 45) and an "Update Counter Offer" button', type: 'positive', expected: 'USD 55.00 shown, Update Counter Offer button', actual: mt.slice(0, 400) + ' | updateBtn=' + (await m.getByRole('button', { name: 'Update Counter Offer' }).count()), ok: /USD 55\.00/.test(mt) && (await m.getByRole('button', { name: 'Update Counter Offer' }).count()) === 1, screenshot: s });
  await fillLabour(m, { hourlyRate: 58, minimumHours: 6, additionalHourlyRate: 62 }); await clickLabourAdd(m);
  await addExpense(m, 'Other', 'Parking', 10);
  s = await shot(td, 'C03_td-edit-values-added');
  const [resp] = await Promise.all([td.waitForResponse((r) => /\/offers\/customer\/counter\/\d+/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 20_000 }).catch(() => null), m.getByRole('button', { name: 'Update Counter Offer' }).click()]);
  const t2 = await waitToast(td, 'Counter Offer Updated');
  s = await shot(td, 'C04_td-counter-updated-toast');
  check({ id: 'C-03', title: 'Update calls PATCH offers/customer/counter/:id and shows "Counter Offer Updated"', type: 'positive', expected: 'HTTP 2xx + toast', actual: `HTTP ${resp?.status()} toast=${t2}`, ok: resp && resp.status() < 300 && t2, screenshot: s });
  let co = await counterOf(tdApi, wo);
  check({ id: 'C-04', title: 'Counter record now holds the edited values 58/6/62 + Parking 10 and is still PENDING', type: 'positive', expected: 'PENDING, 58 / 6 / 62, expense 10', actual: JSON.stringify({ status: co.data?.status, h: co.data?.customerHourlyRate, m: co.data?.customerMinimumHours, a: co.data?.customerAdditionalHourlyRate, exp: (co.data?.expenses || []).map((e) => `${e.expenseType}:${e.amount}`), history: (co.data?.offerHistory || []).map((h) => `${h.status}/${h.customerHourlyRate}`) }), ok: co.data?.status === 'PENDING' && Number(co.data?.customerHourlyRate) === 58 && Number(co.data?.customerMinimumHours) === 6 && Number(co.data?.customerAdditionalHourlyRate) === 62 && (co.data?.expenses || []).some((e) => Number(e.amount) === 10) });
  const canRead = (await counterOf(cuApi, wo)).status === 200;
  if (canRead) { await openProposals(cu, wo); const at = (await cu.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' '); s = await shotFull(cu, 'C05_customer-sees-edited-proposal'); check({ id: 'C-05', title: 'Customer sees the EDITED proposal (58/h, 6 hrs, Parking 10)', type: 'positive', expected: 'USD 58.00, 6 hrs, Parking, Awaiting your response', actual: at.slice(0, 500), ok: /USD 58\.00/.test(at) && /6 hrs/.test(at) && /Parking/.test(at), screenshot: s }); }
  else blocked('C-05', 'Customer sees the EDITED proposal (58/h, 6 hrs, Parking 10)', 'customer cannot read the counter offer on dev (GET offers/customer/counter/:wo -> 403)');
  // withdraw
  await openWo(td, wo);
  await td.getByRole('button', { name: 'Withdraw Counter Offer', exact: true }).click(); await td.waitForTimeout(1200);
  m = dialog(td); s = await shot(td, 'C06_td-withdraw-modal');
  const wt = await modalText(m);
  check({ id: 'C-06', title: '"Withdraw Counter Offer" modal summarises the pending counter (labour old -> new, expenses, estimated payable) with a Withdraw button', type: 'positive', expected: 'Withdraw Counter Offer, USD 58.00, Parking, Withdraw button', actual: wt.slice(0, 600), ok: /Withdraw Counter Offer/.test(wt) && /USD 58\.00/.test(wt) && /Parking/.test(wt) && (await m.getByRole('button', { name: 'Withdraw', exact: true }).count()) >= 1, screenshot: s });
  const [wresp] = await Promise.all([td.waitForResponse((r) => r.url().includes('/offers/customer/counter/withdraw/') && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null), m.getByRole('button', { name: 'Withdraw', exact: true }).last().click()]);
  const t3 = await waitToast(td, 'Counter Offer Withdrawn');
  s = await shot(td, 'C07_td-withdrawn-toast');
  check({ id: 'C-07', title: 'Withdraw calls POST offers/customer/counter/withdraw/:id and shows "Counter Offer Withdrawn"', type: 'positive', expected: 'HTTP 2xx + toast', actual: `HTTP ${wresp?.status()} toast=${t3}`, ok: wresp && wresp.status() < 300 && t3, screenshot: s });
  await td.waitForTimeout(2000); await openWo(td, wo);
  const bt = await bodyText(td); const btns = await visibleButtons(td);
  s = await shotFull(td, 'C08_td-after-withdraw');
  check({ id: 'C-08', title: 'After withdrawing: banner "Counter Offer Withdrawn … keeps its original rates", "Counter Offer" button is back, no Edit/Withdraw', type: 'positive', expected: 'banner + Counter Offer button', actual: `${bt.slice(0, 500)} | ${btns.join(', ')}`, ok: /Counter Offer Withdrawn/.test(bt) && btns.includes('Counter Offer') && !btns.includes('Withdraw Counter Offer'), screenshot: s });
  co = await counterOf(tdApi, wo);
  check({ id: 'C-09', title: 'Counter record status is WITHDRAWN', type: 'positive', expected: 'WITHDRAWN', actual: `${co.data?.status}`, ok: co.data?.status === 'WITHDRAWN' });
  if (canRead) { await openProposals(cu, wo); const at2 = (await cu.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' '); s = await shotFull(cu, 'C09_customer-proposal-withdrawn'); check({ id: 'C-10', title: 'Customer sees the proposal as "Withdrawn" with no Accept/Decline', type: 'positive', expected: 'Withdrawn, no buttons', actual: at2.slice(0, 400), ok: /Withdrawn/.test(at2) && !(await cu.locator('article').first().getByRole('button', { name: 'Accept', exact: true }).isVisible().catch(() => false)), screenshot: s }); }
  else blocked('C-10', 'Customer sees the proposal as "Withdrawn" with no Accept/Decline', 'customer cannot read the counter offer on dev');
  const pay = await payment(tdApi, wo);
  check({ id: 'C-11', title: 'Work order rates unchanged after edit + withdraw (45/5/50, total 255)', type: 'positive', expected: '255', actual: JSON.stringify({ hourlyRate: pay?.clientRates?.hourlyRate, total: pay?.clientRates?.totalWorkOrderCost }), ok: pay?.clientRates?.hourlyRate === 45 && pay?.clientRates?.totalWorkOrderCost === 255 });
  const t4 = await sendCounter(td, { hourlyRate: 47, minimumHours: 5, additionalHourlyRate: 52 }); s = await shot(td, 'C10_td-new-counter-after-withdraw');
  co = await counterOf(tdApi, wo);
  check({ id: 'C-12', title: 'A new counter offer can be sent after a withdrawal (47/h) and becomes the pending one', type: 'positive', expected: 'toast + PENDING 47', actual: `toast=${t4} status=${co.data?.status} rate=${co.data?.customerHourlyRate} history=${(co.data?.offerHistory || []).map((h) => h.status).join('>')}`, ok: t4 && co.data?.status === 'PENDING' && Number(co.data?.customerHourlyRate) === 47, screenshot: s });
});

// =================================================================== D. several Tech Domain users
scenario('D. Several Tech Domain users counter the same work order; customer accepts one', async (browser) => {
  const wo = WO.D.id;
  const td = await ui(browser, 'td'); const cu = await ui(browser, 'cust'); const tdApi = await apiOf('td', browser); const cuApi = await apiOf('cust', browser);
  await openWo(td, wo);
  const t1 = await sendCounter(td, { hourlyRate: 52, minimumHours: 5, additionalHourlyRate: 55 });
  let s = await shot(td, 'D01_td-owner-counter-52');
  check({ id: 'D-01', title: 'Tech Domain user 1 (owner) sends counter 52/h', type: 'positive', expected: 'toast', actual: `toast=${t1}`, ok: t1, screenshot: s });
  const team = await ui(browser, 'tdTeam');
  await openWo(team, wo);
  let bt = await bodyText(team); let btns = await visibleButtons(team);
  s = await shotFull(team, 'D02_td-user2-sees-user1-counter');
  info('D-02', 'Tech Domain user 2 (team member) view while user 1\'s counter is pending: buttons + banner', `${btns.join(', ')} | ${bt.slice(0, 400)}`, s);
  check({ id: 'D-03', title: 'Tech Domain user 2 sees that a counter offer is pending and who sent it', type: 'positive', expected: 'banner "Counter Offer Sent … sent by istkhar Hussain"', actual: bt.slice(0, 400), ok: /Counter Offer Sent/.test(bt) && /sent by istkhar/.test(bt), screenshot: s });
  let user2Sent = false;
  if (btns.includes('Counter Offer')) {
    user2Sent = await sendCounter(team, { hourlyRate: 57, minimumHours: 5, additionalHourlyRate: 60 }); s = await shot(team, 'D03_td-user2-sends-own-counter-57');
    check({ id: 'D-04', title: 'Tech Domain user 2 can send their own counter offer (57/h) while user 1\'s is pending', type: 'edge', expected: 'toast Counter Offer Sent Successfully', actual: `toast=${user2Sent}`, ok: user2Sent, screenshot: s });
  } else if (btns.includes('Edit Counter Offer')) {
    await team.getByRole('button', { name: 'Edit Counter Offer', exact: true }).click(); await team.waitForTimeout(1200); const m = dialog(team);
    await fillLabour(m, { hourlyRate: 57, minimumHours: 5, additionalHourlyRate: 60 }); await clickLabourAdd(m); await m.getByRole('button', { name: 'Update Counter Offer' }).click(); user2Sent = await waitToast(team, 'Counter Offer Updated');
    s = await shot(team, 'D03_td-user2-edits-shared-counter-57');
    check({ id: 'D-04', title: 'Tech Domain user 2 edits the shared pending counter to 57/h (one counter per work order, shared by the Tech Domain team)', type: 'edge', expected: 'toast Counter Offer Updated', actual: `toast=${user2Sent}`, ok: user2Sent, screenshot: s });
  } else check({ id: 'D-04', title: 'Tech Domain user 2 has a way to counter / edit while user 1\'s counter is pending', type: 'edge', expected: 'Counter Offer or Edit Counter Offer button', actual: btns.join(', '), ok: false, screenshot: s });
  let co = await counterOf(tdApi, wo);
  info('D-05', 'Counter record after user 2 acted', JSON.stringify({ status: co.data?.status, rate: co.data?.customerHourlyRate, createdById: co.data?.createdById, history: (co.data?.offerHistory || []).map((h) => `${h.status}/${h.customerHourlyRate}/by ${h.createdBy?.firstName || h.createdById}`) }));
  check({ id: 'D-06', title: 'The latest counter (57/h) is the only pending one; the earlier 52/h is superseded', type: 'edge', expected: 'status PENDING, customerHourlyRate 57', actual: JSON.stringify({ status: co.data?.status, rate: co.data?.customerHourlyRate }), ok: co.data?.status === 'PENDING' && Number(co.data?.customerHourlyRate) === 57 });
  const non = await ui(browser, 'tdNonTeam');
  await openWo(non, wo); bt = await bodyText(non); btns = await visibleButtons(non);
  s = await shotFull(non, 'D04_td-user3-noteam-view');
  info('D-07', 'Tech Domain user 3 (no team) view of the work order: buttons + banner', `${btns.join(', ')} | ${bt.slice(0, 300)}`, s);
  await openWo(td, wo); bt = await bodyText(td); btns = await visibleButtons(td);
  s = await shotFull(td, 'D05_td-user1-sees-user2-counter');
  check({ id: 'D-08', title: 'Tech Domain user 1 now sees the pending counter as sent by user 2 (TD Team Member)', type: 'positive', expected: 'banner names the TD-123 team member, not istkhar', actual: bt.slice(0, 400), ok: /Counter Offer Sent/.test(bt) && /sent by/.test(bt) && !/sent by istkhar/.test(bt), screenshot: s });
  const canRead = (await counterOf(cuApi, wo)).status === 200;
  if (canRead) {
    await openProposals(cu, wo); const arts = await cu.locator('article').count(); const at = (await cu.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    s = await shotFull(cu, 'D06_customer-proposals-latest-only');
    check({ id: 'D-09', title: 'Customer sees ONE actionable proposal: the latest (57/h)', type: 'positive', expected: '1 card, USD 57.00, Awaiting your response', actual: `cards=${arts} | ${at.slice(0, 400)}`, ok: arts === 1 && /USD 57\.00/.test(at) && /Awaiting your response/.test(at), screenshot: s });
  } else blocked('D-09', 'Customer sees ONE actionable proposal: the latest (57/h)', 'customer cannot read the counter offer on dev');
  const ans = await customerAnswer(cu, cuApi, wo, 'Accept'); s = await shot(cu, 'D07_customer-accept-attempt');
  check({ id: 'D-10', title: 'Customer accepts the 57/h proposal', type: 'positive', expected: 'accepted', actual: `${ans.via}: ${ans.detail}`, ok: ans.ok, screenshot: s });
  if (!ans.ok) { for (const [id, t] of [['D-11', 'Work order moves on with the ACCEPTED rate 57/h (not 52)'], ['D-12', 'Every Tech Domain user sees "Counter Offer Accepted" and no counter buttons after acceptance']]) blocked(id, t, 'customer cannot accept the counter offer on dev'); return; }
  await cu.waitForTimeout(2000);
  const pay = await payment(tdApi, wo);
  check({ id: 'D-11', title: 'Work order moves on with the ACCEPTED rate 57/h (not 52)', type: 'positive', expected: 'clientRates.hourlyRate 57, total 57x5+30 = 315', actual: JSON.stringify({ hourlyRate: pay?.clientRates?.hourlyRate, total: pay?.clientRates?.totalWorkOrderCost }), ok: pay?.clientRates?.hourlyRate === 57 && pay?.clientRates?.totalWorkOrderCost === 315 });
  for (const [k, p, label] of [['td', td, 'user 1 (owner)'], ['tdTeam', team, 'user 2 (team member)'], ['tdNonTeam', non, 'user 3 (no team)']]) {
    await openWo(p, wo); bt = await bodyText(p); btns = await visibleButtons(p); s = await shotFull(p, `D08_${k}-after-acceptance`);
    check({ id: `D-12-${k}`, title: `Tech Domain ${label} sees "Counter Offer Accepted" and no Counter Offer / Edit / Withdraw buttons after acceptance`, type: 'positive', expected: 'banner Counter Offer Accepted, no counter buttons', actual: `${bt.slice(0, 300)} | ${btns.join(', ')}`, ok: /Counter Offer Accepted/.test(bt) && !btns.some((b) => /Counter Offer/.test(b)), screenshot: s });
  }
});

// =================================================================== E. negatives / edge / boundary
scenario('E. Negative, edge and boundary cases', async (browser) => {
  const wo = WO.E.id;
  const td = await ui(browser, 'td'); const cu = await ui(browser, 'cust'); const tdApi = await apiOf('td', browser); const cuApi = await apiOf('cust', browser);
  await openWo(td, wo);
  let m = await openCounterModal(td);
  await labourSection(m); await td.waitForTimeout(1000); await clickLabourAdd(m);
  let t = await waitToast(td, 'Please enter Labour Values', 6000); let s = await shot(td, 'E01_labour-add-empty');
  check({ id: 'E-01', title: 'Labour "Add" with empty fields -> "Please enter Labour Values"', type: 'negative', expected: 'toast', actual: `toast=${t} sendDisabled=${await sendBtn(m).isDisabled()} modal=${(await modalText(m)).slice(0, 160)}`, ok: t, note: t ? '' : 'No feedback at all: the click is silently ignored (Send stays disabled, nothing added).', screenshot: s });
  await td.waitForTimeout(4000);
  await fillLabour(m, { hourlyRate: 0, minimumHours: 5, additionalHourlyRate: 50 }); await clickLabourAdd(m);
  t = await waitToast(td, 'Please enter Labour Values', 6000); s = await shot(td, 'E02_labour-add-zero-rate');
  check({ id: 'E-02', title: 'Labour "Add" with hourly rate 0 -> rejected ("Please enter Labour Values"), Send stays disabled', type: 'bva', expected: 'toast + disabled', actual: `toast=${t} sendDisabled=${await sendBtn(m).isDisabled()}`, ok: t && (await sendBtn(m).isDisabled()), screenshot: s });
  await td.waitForTimeout(4000);
  await fillLabour(m, { hourlyRate: -5, minimumHours: 5, additionalHourlyRate: 50 }); await clickLabourAdd(m);
  t = await waitToast(td, 'Please enter Labour Values', 6000); s = await shot(td, 'E03_labour-add-negative-rate');
  const typedNeg = await m.locator('input[name="hourlyRate"]').inputValue().catch(() => '');
  check({ id: 'E-03', title: 'Labour "Add" with negative hourly rate -5 -> rejected', type: 'bva', expected: 'toast "Please enter Labour Values" or the field refuses the minus sign; Send disabled', actual: `toast=${t} fieldValue="${typedNeg}" sendDisabled=${await sendBtn(m).isDisabled()}`, ok: (t || typedNeg === '' || typedNeg === '5') && (await sendBtn(m).isDisabled()), screenshot: s });
  await td.waitForTimeout(4000);
  await fillLabour(m, { hourlyRate: 45, minimumHours: 5, additionalHourlyRate: 50 }); await clickLabourAdd(m);
  s = await shot(td, 'E04_labour-add-unchanged-values');
  check({ id: 'E-04', title: 'Labour "Add" with the SAME values as the current rates -> no change, Send stays disabled', type: 'edge', expected: 'Send disabled', actual: `sendDisabled=${await sendBtn(m).isDisabled()}`, ok: await sendBtn(m).isDisabled(), screenshot: s });
  await addExpense(m, null, 'No type', 10, false);
  t = await waitToast(td, 'Please enter Expense Values', 6000); s = await shot(td, 'E05_expense-add-no-type');
  check({ id: 'E-05', title: 'Expense "Add" without a type -> "Please enter Expense Values"', type: 'negative', expected: 'toast', actual: `toast=${t}`, ok: t, screenshot: s });
  await td.waitForTimeout(4000);
  await addExpense(m, 'Travel Expense', '', 10);
  t = await waitToast(td, 'Please enter Expense Values', 6000); s = await shot(td, 'E06_expense-add-no-description');
  check({ id: 'E-06', title: 'Expense "Add" without a description -> "Please enter Expense Values"', type: 'negative', expected: 'toast', actual: `toast=${t}`, ok: t, screenshot: s });
  await td.waitForTimeout(4000);
  await addExpense(m, 'Travel Expense', 'Zero', 0, false);
  t = await waitToast(td, 'Please enter Expense Values', 6000); s = await shot(td, 'E07_expense-add-zero-amount');
  check({ id: 'E-07', title: 'Expense "Add" with amount 0 -> rejected', type: 'bva', expected: 'toast', actual: `toast=${t}`, ok: t, screenshot: s });
  await td.waitForTimeout(4000);
  await m.getByRole('button', { name: 'Cancel', exact: true }).click(); await td.waitForTimeout(1000);
  let co = await counterOf(tdApi, wo); let btns = await visibleButtons(td);
  s = await shot(td, 'E08_cancel-closes-without-sending');
  check({ id: 'E-08', title: 'Cancel closes the modal without creating a counter offer', type: 'negative', expected: 'no counter record, "Counter Offer" button still shown', actual: `counter=${JSON.stringify(co.data)} buttons=${btns.join(', ')}`, ok: co.data == null && btns.includes('Counter Offer'), screenshot: s });
  m = await openCounterModal(td);
  await fillLabour(m, { hourlyRate: 60.55, minimumHours: 1, additionalHourlyRate: 0.01 }); await clickLabourAdd(m);
  let mt = await modalText(m); s = await shot(td, 'E09_decimal-and-min-boundary');
  check({ id: 'E-09', title: 'Decimal rate 60.55, minimum 1 h and additional 0.01 are accepted and shown with 2 decimals (estimate 60.55 x 1 + 30 = 90.55)', type: 'bva', expected: 'USD 60.55, 1 hrs, USD 0.01, Estimated Payment USD 90.55', actual: mt.slice(0, 600), ok: /USD 60\.55/.test(mt) && /1 hrs/.test(mt) && /USD 0\.01/.test(mt) && /USD 90\.55/.test(mt), screenshot: s });
  await fillLabour(m, { hourlyRate: 999999.99, minimumHours: 1000, additionalHourlyRate: 1 }); await clickLabourAdd(m);
  mt = await modalText(m); s = await shot(td, 'E10_large-values');
  info('E-10', 'Large values 999999.99/h x 1000 h accepted by the modal (estimate shown)', (mt.match(/Estimated Payment[^A-Z]*USD [\d,.]+(\s*USD [\d,.]+)?/) || [mt.slice(0, 200)])[0], s);
  await fillLabour(m, { hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55 }); await clickLabourAdd(m);
  await addExpense(m, 'Material Expense', 'Cables', 12.5);
  mt = await modalText(m);
  check({ id: 'E-11', title: 'Last labour "Add" wins (50/5/55) and an expense with a decimal amount 12.50 is listed', type: 'edge', expected: 'USD 50.00, USD 12.50', actual: mt.slice(0, 600), ok: /USD 50\.00/.test(mt) && /USD 12\.50/.test(mt) });
  await sendBtn(m).click(); t = await waitToast(td, 'Counter Offer Sent Successfully'); s = await shot(td, 'E11_counter-sent-for-api-cases');
  check({ id: 'E-12', title: 'Counter offer 50/5/55 + Cables 12.50 sent', type: 'positive', expected: 'toast', actual: `toast=${t}`, ok: t, screenshot: s });
  await td.waitForTimeout(1500);
  co = await counterOf(tdApi, wo); const coId = co.data?.id;
  const r1 = await call(cuApi, 'POST', '/offers/customer/counter', { workOrderId: wo, hourlyRate: 10, minimumHours: 1, additionalHourlyRate: 10, expenses: [] });
  check({ id: 'E-13', title: 'API: a CUSTOMER cannot create a counter offer (POST offers/customer/counter)', type: 'negative', expected: 'HTTP 4xx', actual: brief(r1), ok: rej(r1) });
  const r2 = await call(tdApi, 'POST', `/offers/customer/counter/accept/${coId}`, {});
  check({ id: 'E-14', title: 'API: Tech Domain cannot accept its own counter offer', type: 'negative', expected: 'HTTP 4xx', actual: brief(r2), ok: rej(r2) });
  const r2b = await call(tdApi, 'POST', `/offers/customer/counter/decline/${coId}`, {});
  check({ id: 'E-15', title: 'API: Tech Domain cannot decline the counter offer on the customer\'s behalf', type: 'negative', expected: 'HTTP 4xx', actual: brief(r2b), ok: rej(r2b) });
  const r3 = await call(cuApi, 'POST', `/offers/customer/counter/withdraw/${coId}`, {});
  check({ id: 'E-16', title: 'API: a CUSTOMER cannot withdraw Tech Domain\'s counter offer', type: 'negative', expected: 'HTTP 4xx', actual: brief(r3), ok: rej(r3) });
  const r4 = await call(tdApi, 'POST', '/offers/customer/counter', { workOrderId: wo, hourlyRate: -1, minimumHours: 5, additionalHourlyRate: 55, expenses: [] });
  check({ id: 'E-17', title: 'API: negative hourly rate is rejected by the backend (not only by the UI)', type: 'negative', expected: 'HTTP 400', actual: brief(r4), ok: rej(r4) });
  const r5 = await call(tdApi, 'POST', '/offers/customer/counter', { hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55, expenses: [] });
  check({ id: 'E-18', title: 'API: counter offer without workOrderId is rejected', type: 'negative', expected: 'HTTP 400', actual: brief(r5), ok: rej(r5) });
  const r6 = await call(cuApi, 'POST', '/offers/customer/counter/accept/999999999', {});
  check({ id: 'E-19', title: 'API: accepting a non-existent counter offer id fails cleanly (no 500)', type: 'negative', expected: 'HTTP 4xx', actual: brief(r6), ok: rej(r6) && r6.status < 500 });
  const r7 = await call(tdApi, 'POST', '/offers/customer/counter', { workOrderId: WO.F.id, hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55, expenses: [] });
  info('E-20', 'API: HOURLY rate fields sent for a FIXED work order (backend response)', brief(r7));
  const r9 = await call(cuApi, 'POST', `/offers/customer/counter/accept/${(await counterOf(tdApi, WO.C.id)).data?.id}`, {});
  info('E-21', 'API: customer accepting the counter of WO C (which was withdrawn and re-sent) -> response', brief(r9));
  const r10 = await counterOf(cuApi, wo);
  check({ id: 'E-22', title: 'API: the customer who created the work order can read its pending counter offer (GET offers/customer/counter/:wo)', type: 'positive', expected: 'HTTP 200, status PENDING', actual: `HTTP ${r10.status} ${r10.msg || ''} status=${r10.data?.status}`, ok: r10.status === 200 && r10.data?.status === 'PENDING' });
  const sub = await ui(browser, 'custSub'); const subApi = await apiOf('custSub', browser);
  await openWo(sub, wo, true); const sbt = await bodyText(sub); const stabs = await sub.locator('[role=tab]').allInnerTexts();
  s = await shotFull(sub, 'E12_customer-subuser-view');
  info('E-23', 'Customer SUB-USER (did not create the WO) view: tabs + header + GET counter', `tabs=${stabs.join(', ')} | GET counter -> HTTP ${(await counterOf(subApi, wo)).status} | ${sbt.slice(0, 250)}`, s);
  // publishing while a counter is pending
  await openWo(td, wo);
  await td.getByRole('button', { name: 'Review & Publish', exact: true }).click(); await td.waitForTimeout(5000);
  s = await shotFull(td, 'E13_td-review-publish-wizard');
  const pubBtn = td.getByRole('button', { name: /^Publish$/ }).first();
  let dlgText = ''; let wizardNote = '';
  try {
    if (await pubBtn.isDisabled()) { // the customer WO lacks Project / Technology Stacks / Category / Skills: pick the first option of each required autocomplete
      for (const label of ['Project', 'Technology Stacks', 'Category', 'Skills']) {
        const inp = td.locator(`label:has-text("${label}")`).first().locator('xpath=following::input[1]');
        await inp.click({ timeout: 5000 }); await td.waitForTimeout(800);
        const opt = td.locator('[role=option], li.MuiAutocomplete-option').first(); if (await opt.count()) await opt.click({ timeout: 5000 }); await td.keyboard.press('Escape'); await td.waitForTimeout(500);
      }
      s = await shotFull(td, 'E13b_td-wizard-required-fields-filled');
    }
    wizardNote = `publishDisabled=${await pubBtn.isDisabled()}`;
    if (!(await pubBtn.isDisabled())) { await pubBtn.click({ timeout: 5000 }); await td.waitForTimeout(2500); dlgText = (await dialog(td).innerText().catch(() => '')).replace(/\s+/g, ' '); s = await shot(td, 'E14_td-publish-while-pending-dialog'); }
  } catch (e) { wizardNote += ` wizard error: ${e.message.slice(0, 120)}`; }
  if (dlgText) check({ id: 'E-24', title: 'Publishing while a counter offer is pending warns "Proposal Pending" (published with current rates, customer can no longer respond) with "Publish Anyway"', type: 'edge', expected: 'dialog Proposal Pending + Publish Anyway', actual: dlgText.slice(0, 400), ok: /Proposal Pending/.test(dlgText) && /Publish Anyway/.test(dlgText), screenshot: s });
  else { info('E-24a', 'Review & Publish wizard state (Publish stays disabled until Project / Technology Stacks / Category / Skills are filled)', `${wizardNote} | buttons: ${(await visibleButtons(td)).join(', ')}`, s); blocked('E-24', 'Publishing while a counter offer is pending warns "Proposal Pending" with "Publish Anyway"', `could not reach an enabled Publish button in the Review & Publish wizard (${wizardNote})`); }
  if (/Proposal Pending/.test(dlgText)) { await dialog(td).getByRole('button', { name: 'Cancel', exact: true }).last().click().catch(() => { }); await td.waitForTimeout(800); }
  co = await counterOf(tdApi, wo); const woE0 = await woOf(tdApi, wo);
  check({ id: 'E-25', title: 'Cancelling the warning leaves the counter offer pending and the work order unpublished', type: 'edge', expected: 'PENDING + PENDING_APPROVAL', actual: `counter=${co.data?.status} wo=${woE0?.status}`, ok: co.data?.status === 'PENDING' && woE0?.status === 'PENDING_APPROVAL' });
  const template = (await call(tdApi, 'GET', `/workOrders/${TEMPLATE_WO}`)).body?.data;
  await call(tdApi, 'PATCH', `/workOrders/${wo}`, { teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3', categoryId: template?.category?.id, workOrderServices: (template?.workOrderServices || []).map((x) => ({ serviceId: x.serviceId || x.id })), engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerMinimumHours: 4, engineerAdditionalHourlyRate: 15 });
  const ap = await call(tdApi, 'POST', `/workOrders/${wo}/approvePublish`, {});
  const woE = await woOf(tdApi, wo);
  check({ id: 'E-26', title: 'Work order published while the counter was pending ("Publish Anyway" path, done via the same API the wizard calls) -> published with the ORIGINAL customer rates (45/5/50)', type: 'edge', expected: 'PUBLISHED, hourlyRate 45', actual: `approvePublish ${brief(ap)}; status=${woE?.status} hourlyRate=${woE?.hourlyRate}`, ok: ap.status < 300 && woE?.status === 'PUBLISHED' && Number(woE?.hourlyRate) === 45 });
  await openWo(td, wo); const bt = await bodyText(td); btns = await visibleButtons(td);
  s = await shotFull(td, 'E15_td-counter-not-answered-banner');
  check({ id: 'E-27', title: 'Tech Domain sees "Counter Offer Not Answered … before the work order moved on from review" and no counter buttons on the published WO', type: 'edge', expected: 'banner + no Counter Offer buttons', actual: `${bt.slice(0, 500)} | ${btns.join(', ')}`, ok: /Counter Offer Not Answered/.test(bt) && !btns.some((b) => /Counter Offer/.test(b)), screenshot: s });
  if ((await counterOf(cuApi, wo)).status === 200) { await openProposals(cu, wo); const at = (await cu.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' '); const av = await cu.locator('article').first().getByRole('button', { name: 'Accept', exact: true }).isVisible().catch(() => false); s = await shotFull(cu, 'E16_customer-proposal-not-answered'); check({ id: 'E-28', title: 'Customer sees the proposal as "Not answered · closed when the work order left review" with no Accept/Decline', type: 'edge', expected: 'Not answered, no buttons', actual: `${at.slice(0, 400)} acceptVisible=${av}`, ok: /Not answered/.test(at) && !av, screenshot: s }); }
  else blocked('E-28', 'Customer sees the proposal as "Not answered · closed when the work order left review" with no Accept/Decline', 'customer cannot read the counter offer on dev');
  const r11 = await call(cuApi, 'POST', `/offers/customer/counter/accept/${coId}`, {});
  check({ id: 'E-29', title: 'API: customer cannot accept the counter after the work order left review', type: 'negative', expected: 'HTTP 4xx', actual: brief(r11), ok: rej(r11) });
  const payE = await payment(tdApi, wo);
  check({ id: 'E-30', title: 'Published-while-pending work order keeps original amounts (255) and the proposed Cables expense was NOT added', type: 'edge', expected: 'total 255, expenses only TRAVEL 30', actual: JSON.stringify({ total: payE?.clientRates?.totalWorkOrderCost, expenses: (payE?.clientRates?.expenses || []).map((e) => `${e.expenseType}:${e.amount}`) }), ok: payE?.clientRates?.totalWorkOrderCost === 255 && !(payE?.clientRates?.expenses || []).some((e) => e.expenseType === 'MATERIAL') });
  const r12 = await call(tdApi, 'POST', '/offers/customer/counter', { workOrderId: wo, hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55, expenses: [] });
  check({ id: 'E-31', title: 'API: a counter offer on a PUBLISHED work order (left review) is rejected', type: 'negative', expected: 'HTTP 4xx "not pending approval"', actual: brief(r12), ok: rej(r12) });
});

// =================================================================== F. FIXED payment type
scenario('F. Counter offer on a FIXED-rate customer work order', async (browser) => {
  const wo = WO.F.id;
  const td = await ui(browser, 'td'); const cu = await ui(browser, 'cust'); const tdApi = await apiOf('td', browser); const cuApi = await apiOf('cust', browser);
  await openWo(td, wo);
  const m = await openCounterModal(td);
  let s = await shot(td, 'F01_td-fixed-counter-modal');
  let mt = await modalText(m); const g = await labourSection(m);
  check({ id: 'F-01', title: 'FIXED work order: modal shows "Fixed Rate USD 300.00" and a Fixed Rate input (no hourly fields)', type: 'positive', expected: 'Fixed Rate USD 300.00, input fixedAmount, no hourlyRate input', actual: mt.slice(0, 300) + ` | fixedInput=${await g.locator('input[name="fixedAmount"]').count()} hourlyInput=${await g.locator('input[name="hourlyRate"]').count()}`, ok: /Fixed Rate/.test(mt) && /USD 300\.00/.test(mt) && (await g.locator('input[name="fixedAmount"]').count()) === 1 && (await g.locator('input[name="hourlyRate"]').count()) === 0, screenshot: s });
  await fillLabour(m, { fixedAmount: 350 }); await clickLabourAdd(m);
  await addExpense(m, 'Travel Expense', 'Site visit', 40);
  mt = await modalText(m); s = await shot(td, 'F02_td-fixed-values-added');
  check({ id: 'F-02', title: 'Fixed 300 -> 350 shown struck/new, travel 40 listed, labour estimate USD 350.00', type: 'positive', expected: 'USD 350.00, Site visit USD 40.00', actual: mt.slice(0, 500), ok: /USD 350\.00/.test(mt) && /Site visit/.test(mt) && /USD 40\.00/.test(mt), screenshot: s });
  await sendBtn(m).click(); const t1 = await waitToast(td, 'Counter Offer Sent Successfully');
  const co = await counterOf(tdApi, wo);
  check({ id: 'F-03', title: 'Fixed-rate counter offer sent and stored (customerFixedAmount 350 + expense 40)', type: 'positive', expected: 'toast + PENDING customerFixedAmount 350', actual: `toast=${t1} ${JSON.stringify({ status: co.data?.status, customerFixedAmount: co.data?.customerFixedAmount, expenses: (co.data?.expenses || []).map((e) => e.amount) })}`, ok: t1 && co.data?.status === 'PENDING' && Number(co.data?.customerFixedAmount) === 350 });
  const ans = await customerAnswer(cu, cuApi, wo, 'Accept'); s = await shotFull(cu, 'F03_customer-fixed-accept-attempt');
  check({ id: 'F-04', title: 'Customer accepts the fixed-rate proposal', type: 'positive', expected: 'accepted', actual: `${ans.via}: ${ans.detail}`, ok: ans.ok, screenshot: s });
  if (!ans.ok) { blocked('F-05', 'Calculation uses the accepted fixed amount 350 + expense 40 = 390', 'customer cannot accept the counter offer on dev'); return; }
  await cu.waitForTimeout(2000);
  const pay = await payment(tdApi, wo);
  check({ id: 'F-05', title: 'Calculation uses the accepted fixed amount 350 + expense 40 = 390', type: 'positive', expected: 'fixedAmount 350, expenses 40, total 390', actual: JSON.stringify({ fixedAmount: pay?.clientRates?.fixedAmount, totalExpenseCost: pay?.clientRates?.totalExpenseCost, total: pay?.clientRates?.totalWorkOrderCost }), ok: pay?.clientRates?.fixedAmount === 350 && pay?.clientRates?.totalExpenseCost === 40 && pay?.clientRates?.totalWorkOrderCost === 390 });
});

// =================================================================== G. customer notification
scenario('G. Customer is notified about the counter offer', async (browser) => {
  const cuApi = await apiOf('cust', browser);
  const n = await call(cuApi, 'GET', `/notifications/others?userId=638&limit=40`);
  const rows = (n.body?.data?.data || n.body?.data || []).filter((r) => r.type === 'COUNTER' && [WO.A.id, WO.B.id, WO.C.id, WO.D.id, WO.E.id, WO.F.id].includes(r.workOrderId));
  info('G-01', 'COUNTER notifications received by the customer for this run\'s work orders', JSON.stringify(rows.map((r) => ({ wo: r.workOrderId, title: r.title, content: String(r.content).replace(/<[^>]+>/g, ''), url: r.url }))));
  check({ id: 'G-02', title: 'Customer receives a notification for every counter offer event ("<sender> has sent you a proposal." / "has updated their proposal." / "has sent you a new proposal.") linking to /workOrder/proposals/:id?fromCustomerBoard=true', type: 'positive', expected: `>= 6 COUNTER notifications with the proposals link`, actual: `${rows.length} notifications; texts: ${[...new Set(rows.map((r) => r.content.replace(/^.*? has /, 'has ')))].join(' | ')}; first url ${rows[0]?.url}`, ok: rows.length >= 6 && rows.every((r) => /proposal/.test(r.content) && /\/workOrder\/proposals\//.test(r.url)) });
});
