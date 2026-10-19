// End-to-end (user request 2026-10-16): for BOTH engineer types - individual (freelancer) engineer and vendor engineer
// (company owner counters for a member) - run the full counter-offer flow to the invoices and check every calculation:
//   customer creates WO (45/5/50 + Travel 30) -> Tech Domain counter v1 (60/4/65 + Tools 20) -> Tech Domain EDITS to
//   v2 (58/6/62 + Parking 10) -> customer accepts (-> 388) -> Tech Domain publishes with engineer rates 15/4/15 ->
//   ENGINEER COUNTER (freelancer 20/4/22 | vendor 28/4/30 for member 611) -> Tech Domain accepts the counter (ASSIGNED)
//   -> confirm/check-in/check-out/complete (WORKDONE) -> Tech Domain edits the time log to 8.5 h + adds a company
//   expense 25 -> Reviewed -> Verify -> PO Pending -> customer PO -> Approve -> customer invoice (GST 10 %) ->
//   engineer invoice -> send both -> mark both PAID.
// Expected numbers (dev rule: customer overrun >= 15 min rounds up to the next hour, engineer pro-rata):
//   customer: 58 x 6 + 3 x 62 = 534 + 40 expenses = 574, GST 57.40, grand total 631.40
//   freelancer: 20 x 4 + 4.5 x 22 = 179 ; vendor: 28 x 4 + 4.5 x 30 = 247  (no tax)
//
// Run:  npx playwright test tests/counter-offer-invoice-e2e.spec.js --reporter=line --trace off --workers=1
//       (env ONLY=freelancer|vendor to run one scenario)
// Evidence: evidence/CounterOffer-Invoice-E2E/<scenario>-run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const ENTITY_ID = 104; // customer entity of owner 638
const TD_BANK = '75111164-ad42-4c50-ab3d-159c4201cc3d', TD_BRANCH = 1;
const TEMPLATE_WO = 242, TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const ORIG = { hourlyRate: 45, minimumHours: 5, additionalHourlyRate: 50 };
const V1 = { hourlyRate: 60, minimumHours: 4, additionalHourlyRate: 65, expenses: [{ expenseType: 'TOOLS', description: 'Ladder hire (v1)', amount: 20 }] };
const V2 = { hourlyRate: 58, minimumHours: 6, additionalHourlyRate: 62, expenses: [{ expenseType: 'OTHER', description: 'Parking (edited v2)', amount: 10 }] };
const PUB_ENG = { engineerHourlyRate: 15, engineerMinimumHours: 4, engineerAdditionalHourlyRate: 15 };
const WORKED_HOURS = 8.5, TD_EXPENSE = 25, GST = 10;
const CUST_EXPECT = { labour: 58 * 6 + 3 * 62, expenses: 40 }; // 534 + 40 = 574 (customer billed 9 h for 8.5 h worked)
CUST_EXPECT.total = CUST_EXPECT.labour + CUST_EXPECT.expenses; CUST_EXPECT.tax = Math.round(CUST_EXPECT.total * GST) / 100; CUST_EXPECT.grand = CUST_EXPECT.total + CUST_EXPECT.tax;
const SCENARIOS = {
  freelancer: { label: 'Individual (freelancer) engineer', counter: { hourlyRate: 20, minimumHours: 4, additionalHourlyRate: 22 } },
  vendor: { label: 'Vendor engineer (company owner 609 counters for member 611)', counter: { hourlyRate: 28, minimumHours: 4, additionalHourlyRate: 30 } },
};
const engExpect = (c) => c.hourlyRate * c.minimumHours + (WORKED_HOURS - c.minimumHours) * c.additionalHourlyRate; // pro-rata
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe.configure({ mode: 'serial' });
test.setTimeout(1_200_000);

async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status}`);
  const s = { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), id: l.body.data?.id, name: `${l.body.data?.firstName || ''} ${l.body.data?.lastName || ''}`.trim() };
  s.relogin = async () => { const n = await rawLogin(account.email, account.password); if (!n.body.accessToken) return false; s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${n.body.accessToken}` } }); return true; };
  return s;
}
async function call(s, method, p, data, multipart) {
  const opts = multipart ? { multipart } : data === undefined ? undefined : { data };
  let r = await s.api[method](u(p), opts);
  if (r.status() === 401 && (await s.relogin())) r = await s.api[method](u(p), opts);
  return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) };
}
const getJson = (s, p) => call(s, 'get', p);
const postJson = (s, p, d) => call(s, 'post', p, d);
const patchJson = (s, p, d) => call(s, 'patch', p, d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const near = (a, b, eps = 0.011) => Math.abs(Number(a) - Number(b)) < eps;
const side = (c) => ({ hourlyRate: c?.hourlyRate, minimumHours: c?.minimumHours, additionalHourlyRate: c?.additionalHourlyRate, hoursWorked: c?.hoursWorked, additionalHours: c?.additionalHours, totalHoursApproved: c?.totalHoursApproved, totalLabourCost: c?.totalLabourCost, totalExpenseCost: c?.totalExpenseCost, totalWorkOrderCost: c?.totalWorkOrderCost, grandTotal: c?.grandTotal, expenses: (c?.expenses || []).map((e) => `${e.expenseType}:${e.amount}`) });
async function payment(s, wo) { const p = (await getJson(s, `/workOrders/estimatedPayment/${wo}`)).body?.data || {}; return { cust: side(p.clientRates), eng: side(p.engineerRates), company: p.companyExpenses ? { total: p.companyExpenses.companyTotalExpenseCost, expenses: (p.companyExpenses.expenses || []).map((e) => `${e.expenseType}:${e.amount}`) } : null }; }
function customerWoPayload(title) { const start = new Date(Date.now() + 5 * 86_400_000); const day = start.toISOString().slice(0, 10); return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'QA: counter offer -> invoice end to end', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [{ expenseType: 'TRAVEL', description: 'Customer travel', amount: 30 }], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: ORIG.hourlyRate, minimumHours: ORIG.minimumHours, additionalHourlyRate: ORIG.additionalHourlyRate, nonBusinessHourRate: null, purchaseOrderNumber: '', halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }
async function uiLogin(page, account) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  const em = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first(); await em.waitFor({ state: 'visible' });
  await em.fill(account.email); await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 60_000 }); await page.waitForTimeout(3_000);
}
async function newPage(browser, account) { const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(45_000); await uiLogin(page, account); return { ctx, page }; }
async function dismiss(page) { const cancel = page.getByRole('button', { name: 'Cancel', exact: true }); if (await cancel.isVisible().catch(() => false)) { await cancel.click(); await page.waitForTimeout(1_000); } }
const bodyText = async (page) => (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');

for (const [key, SC] of Object.entries(SCENARIOS)) {
  if (process.env.ONLY && process.env.ONLY !== key) continue;
  test(`${key}: counter offer (customer edited + engineer counter) -> work -> invoices -> paid`, async ({ browser }, testInfo) => {
    const EVIDENCE = path.join(__dirname, '..', 'evidence', 'CounterOffer-Invoice-E2E', `${key}-run-${RUN}`);
    fs.mkdirSync(EVIDENCE, { recursive: true });
    let shotNo = 0;
    const shot = async (page, name) => { shotNo += 1; const f = path.join(EVIDENCE, `${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); };
    const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
    const results = { run: RUN, scenario: key, label: SC.label, checks: [], findings: [], steps: {} };
    const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 700) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
    const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };
    const save = () => { const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n'); fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2)); fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n'); return summary; };

    const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
    const custAcc = testAccounts.find((a) => a.role === 'Customer');
    const engAcc = accounts.find((a) => a.role === 'Individual Engineer');
    const vendorAcc = accounts.find((a) => a.role === 'Vendor');
    const workerAcc = accounts.find((a) => a.role === 'Vendor Engineer');
    const td = await apiLogin(tdAcc, 'Tech Domain'); const cust = await apiLogin(custAcc, 'Customer');
    const counterer = await apiLogin(key === 'vendor' ? vendorAcc : engAcc, 'counter sender'); // who sends the engineer counter
    const worker = key === 'vendor' ? await apiLogin(workerAcc, 'worker') : counterer;        // who does the work
    const workerAccount = key === 'vendor' ? workerAcc : engAcc;
    const payee = counterer; // engineer invoice goes to the freelancer / the vendor company owner
    log(`${SC.label}: Tech Domain ${td.id}, customer ${cust.id} "${cust.name}", counter by ${counterer.id} "${counterer.name}", worker ${worker.id} "${worker.name}"`);

    // ---------- 1. customer creates the work order ----------
    const title = `E2E ${key} counter->invoice ${RUN}`;
    const cr = await postJson(cust, '/workOrders', customerWoPayload(title));
    const WO = cr.body?.data?.id || cr.body?.id; expect(WO, 'customer WO created').toBeTruthy();
    let wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; const REF = wo.referenceId; results.wo = WO; results.ref = REF;
    let pay = await payment(td, WO);
    check(`1. customer created WO ${WO} (#${REF}) 45/5/50 + Travel 30 -> PENDING_APPROVAL, total 255`, cr.status < 300 && wo.status === 'PENDING_APPROVAL' && pay.cust.totalWorkOrderCost === 255, { status: wo.status, cust: pay.cust });

    // ---------- 2. Tech Domain counter v1 -> edit v2 -> customer accepts ----------
    const c1 = await postJson(td, '/offers/customer/counter', { workOrderId: WO, ...V1 }); const coId = c1.body?.data?.id || c1.body?.id;
    await sleep(2_000);
    const e = await patchJson(td, `/offers/customer/counter/${coId}`, { workOrderId: WO, ...V2 });
    await sleep(2_000);
    const coV2 = (await getJson(cust, `/offers/customer/counter/${WO}`)).body?.data || {};
    check('2. Tech Domain sent counter v1 (60/4/65) and edited it to v2 (58/6/62 + Parking 10); customer sees v2 PENDING', c1.status < 300 && e.status < 300 && coV2.status === 'PENDING' && Number(coV2.customerHourlyRate) === 58 && Number(coV2.customerMinimumHours) === 6, { c1: c1.status, edit: e.status, customerView: { id: coV2.id, status: coV2.status, rates: [coV2.customerHourlyRate, coV2.customerMinimumHours, coV2.customerAdditionalHourlyRate], expenses: (coV2.expenses || []).map((x) => `${x.expenseType}:${x.amount}`) } });
    const acc = await postJson(cust, `/offers/customer/counter/accept/${coId}`, {});
    await sleep(2_500);
    pay = await payment(td, WO); const coF = (await getJson(td, `/offers/customer/counter/${WO}`)).body?.data || {};
    check('3. customer ACCEPTED -> counter ASSIGNED, WO carries the EDITED rates 58/6/62, expenses Travel 30 + Parking 10, total 388', acc.status < 300 && coF.status === 'ASSIGNED' && pay.cust.hourlyRate === 58 && pay.cust.minimumHours === 6 && pay.cust.additionalHourlyRate === 62 && pay.cust.totalWorkOrderCost === 388 && pay.cust.expenses.includes('TRAVEL:30') && pay.cust.expenses.includes('OTHER:10'), { accept: acc.status, counter: coF.status, cust: pay.cust });

    // ---------- 3. Tech Domain publishes with engineer rates 15/4/15 ----------
    const template = (await getJson(td, `/workOrders/${TEMPLATE_WO}`)).body?.data || {};
    const fx = await patchJson(td, `/workOrders/${WO}`, { teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3', categoryId: template?.category?.id, workOrderServices: (template?.workOrderServices || []).map((x) => ({ serviceId: x.serviceId || x.id })), engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', ...PUB_ENG });
    const ap = await postJson(td, `/workOrders/${WO}/approvePublish`, {});
    await sleep(2_000);
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; pay = await payment(td, WO);
    check('4. Tech Domain published (engineer rates 15/4/15); customer rates still 58/6/62 = 388', fx.status < 300 && ap.status < 300 && wo.status === 'PUBLISHED' && pay.cust.totalWorkOrderCost === 388 && pay.eng.hourlyRate === 15, { fix: fx.status, publish: ap.status, status: wo.status, cust: pay.cust, eng: pay.eng });
    const minute = Math.floor(Date.now() / 60_000);
    const slot = new Date(Date.now() + (160 + (minute % 90)) * 86_400_000); slot.setUTCHours(1 + (minute % 14), 0, 0, 0);
    const d = slot.toISOString().slice(0, 10), hm = slot.toISOString().slice(11, 16);
    const sh = await patchJson(td, `/workOrders/${WO}`, { orderStartDate: `${d}T00:00:00`, orderStartTime: `${d}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' });
    log(`far-future schedule ${d} ${hm} -> ${sh.status}`);

    // ---------- 4. ENGINEER COUNTER OFFER -> Tech Domain accepts ----------
    const counterPayload = { workOrderId: WO, ...SC.counter, expenses: [], ...(key === 'vendor' ? { referredEngineerId: worker.id } : {}) };
    const ec = await patchJson(counterer, '/offers/engineer/counter', counterPayload);
    log(`PATCH offers/engineer/counter -> ${ec.status} ${JSON.stringify(ec.body).slice(0, 200)}`);
    await sleep(2_500);
    const offers = (await postJson(td, `/offers/${WO}`, { limit: 20, page: 1 })).body?.data?.offers || [];
    const pending = offers.find((o) => o.status === 'PENDING' && o.isCounter);
    results.steps.engineerCounter = { status: ec.status, payload: counterPayload, offers: offers.map((o) => ({ id: o.id, status: o.status, isCounter: o.isCounter, user: o.user?.id, referred: o.referredEngineerId, rates: [o.hourlyRate, o.minimumHours, o.additionalHourlyRate] })) };
    check(`5. ${key === 'vendor' ? 'vendor owner 609 countered for member 611' : 'freelancer countered'} at ${SC.counter.hourlyRate}/${SC.counter.minimumHours}/${SC.counter.additionalHourlyRate} -> PENDING counter offer visible to Tech Domain`, ec.status < 300 && !!pending && Number(ec.body?.hourlyRate) === SC.counter.hourlyRate && (key !== 'vendor' || pending.referredEngineerId === worker.id), results.steps.engineerCounter);
    let assignedVia = 'counter';
    if (pending) {
      let ca = await postJson(td, `/offers/counter/accept/${pending.id}`, {});
      if (ca.status >= 300) ca = await postJson(td, `/offers/counter/accept/${pending.id}`, { workOrderId: WO });
      log(`POST offers/counter/accept/${pending.id} -> ${ca.status} ${JSON.stringify(ca.body).slice(0, 200)}`);
    } else { // fallback: route/accept/assign at the published rates
      assignedVia = 'route-assign';
      const route = await postJson(td, '/offers/route', key === 'vendor' ? { workOrderId: WO, userId: counterer.id } : { workOrderId: WO, userIds: [counterer.id] });
      const offerId = (route.body?.data || [])[0]?.id || route.body?.data?.id;
      await postJson(counterer, `/offers/route/accept/${offerId}`, key === 'vendor' ? { referredEngineerId: worker.id } : {});
      const asg = await postJson(td, '/offers/assign', key === 'vendor' ? { workOrderId: WO, userId: counterer.id, referredEngineerId: worker.id } : { workOrderId: WO, userId: counterer.id });
      log(`fallback route/accept/assign -> ${route.status}/${asg.status} ${JSON.stringify(asg.body).slice(0, 150)}`);
    }
    await sleep(2_500);
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; pay = await payment(td, WO);
    const ENG = assignedVia === 'counter' ? SC.counter : { hourlyRate: 15, minimumHours: 4, additionalHourlyRate: 15 };
    results.steps.assigned = { via: assignedVia, status: wo.status, engineer: wo.engineer?.id, engineerCompany: wo.engineerCompany?.id, eng: pay.eng, cust: pay.cust };
    check(`6. Tech Domain accepted the counter -> ASSIGNED to ${worker.id} "${worker.name}"${key === 'vendor' ? ' (company 79)' : ''} with ENGINEER rates ${ENG.hourlyRate}/${ENG.minimumHours}/${ENG.additionalHourlyRate}; customer rates untouched (388)`, wo.status === 'ASSIGNED' && wo.engineer?.id === worker.id && (key !== 'vendor' || wo.engineerCompany?.id === 79) && pay.eng.hourlyRate === ENG.hourlyRate && pay.eng.additionalHourlyRate === ENG.additionalHourlyRate && pay.cust.totalWorkOrderCost === 388, results.steps.assigned);
    expect(wo.status, 'work order must be ASSIGNED to continue').toBe('ASSIGNED');
    check(`6b. estimated engineer payment at assignment = ${ENG.hourlyRate} x ${ENG.minimumHours} = ${ENG.hourlyRate * ENG.minimumHours}`, near(pay.eng.totalLabourCost, ENG.hourlyRate * ENG.minimumHours) && near(pay.eng.totalWorkOrderCost, ENG.hourlyRate * ENG.minimumHours), pay.eng);

    // ---------- 5. the engineer does the work ----------
    const now = new Date(Date.now() - 5 * 60_000); const nd = now.toISOString().slice(0, 10), nh = now.toISOString().slice(11, 16);
    const sch = await patchJson(td, `/workOrders/${WO}`, { orderStartDate: `${nd}T00:00:00`, orderStartTime: `${nd}T${nh}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' });
    log(`schedule -> now ${sch.status}`); await sleep(2_000);
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    const task = (t) => (wo.tasks || []).find((x) => x.taskType === t)?.completedTask?.id;
    const lat = wo.address?.latitude || 31.5203696, lng = wo.address?.longitude || 74.3587473;
    const walk = [];
    const stepW = async (n, fn) => { const r = await fn(); walk.push(`${n}:${r.status}`); if (r.status >= 300) log(`${n} -> ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`); await sleep(2_500); wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; };
    await stepW('confirm', () => patchJson(worker, `/workOrders/${WO}/subStatus`, { subStatus: 'CONFIRMED' }));
    await stepW('checkIn', () => postJson(worker, '/timeLogs/checkIn', { workOrderId: WO, checkInLatitude: lat, checkInLongitude: lng, taskId: task('CHECK_IN'), checkInTimeZone: 'UTC' }));
    await stepW('checkOut', () => postJson(worker, '/timeLogs/checkOut', { workOrderId: WO, checkOutLatitude: lat, checkOutLongitude: lng, taskId: task('CHECK_OUT'), checkOutTimeZone: 'UTC' }));
    await stepW('markComplete', () => patchJson(worker, `/tasks/${task('MARK_COMPLETE')}`, { isCompleted: true, text: 'QA complete' }));
    check(`7. worker ${worker.id} confirm -> check-in -> check-out -> mark complete => WORKDONE`, wo.status === 'WORKDONE', { walk, status: wo.status });
    expect(wo.status, 'work order must be WORKDONE to continue').toBe('WORKDONE');
    pay = await payment(td, WO);
    check(`8. at WORKDONE (~0 h): customer = minimum 6 h -> 348 + 40 = 388 ; engineer = minimum ${ENG.minimumHours} h -> ${ENG.hourlyRate * ENG.minimumHours}`, pay.cust.totalHoursApproved === 6 && pay.cust.totalWorkOrderCost === 388 && near(pay.eng.totalLabourCost, ENG.hourlyRate * ENG.minimumHours), { cust: pay.cust, eng: pay.eng });

    // ---------- 6. Tech Domain edits the time log to 8.5 h and adds a company expense ----------
    const logs = (await getJson(td, `/timeLogs/${WO}`)).body?.data || []; const tl = logs[logs.length - 1];
    const inT = new Date(Date.now() - 10 * 3_600_000); inT.setUTCMinutes(0, 0, 0); const outT = new Date(inT.getTime() + WORKED_HOURS * 3_600_000);
    const up = await patchJson(td, '/timeLogs/updateTimelogs', { logs: [{ id: Number(tl?.id), checkInTime: inT.toISOString(), checkOutTime: outT.toISOString() }] });
    await sleep(2_000);
    const logs2 = (await getJson(td, `/timeLogs/${WO}`)).body?.data || []; const hoursNow = logs2.reduce((a, l) => a + Number(l.totalHours || 0), 0);
    check(`9. Tech Domain edited the time log to ${WORKED_HOURS} h`, up.status < 300 && near(hoursNow, WORKED_HOURS, 0.02), { status: up.status, hours: hoursNow, logs: logs2.map((l) => ({ id: l.id, totalHours: l.totalHours })) });
    const ce = await patchJson(td, `/workOrders/${WO}/companyExpenses`, { id: WO, companyCurrency: 'USD', companyExpenses: [{ expenseType: 'MATERIAL', description: 'TD cable material', amount: TD_EXPENSE }] });
    await sleep(2_000);
    pay = await payment(td, WO); results.steps.afterHours = pay;
    const ENG_EXPECT = engExpect(ENG);
    check(`10. CUSTOMER calc with 8.5 h: billed 9 h (dev rounding rule), additional 3 h, labour 58x6 + 3x62 = ${CUST_EXPECT.labour}, expenses 40, total ${CUST_EXPECT.total}`, near(pay.cust.hoursWorked, 9) && near(pay.cust.additionalHours, 3) && near(pay.cust.totalLabourCost, CUST_EXPECT.labour) && pay.cust.totalExpenseCost === 40 && near(pay.cust.totalWorkOrderCost, CUST_EXPECT.total), pay.cust);
    check(`11. ENGINEER calc with 8.5 h (${key}): ${ENG.hourlyRate} x ${ENG.minimumHours} + 4.5 x ${ENG.additionalHourlyRate} = ${ENG_EXPECT} (pro-rata), no expenses`, near(pay.eng.hoursWorked, WORKED_HOURS) && near(pay.eng.totalLabourCost, ENG_EXPECT) && near(pay.eng.totalWorkOrderCost, ENG_EXPECT), pay.eng);
    check(`12. Tech Domain company expense ${TD_EXPENSE} saved and NOT billed to the customer (customer total stays ${CUST_EXPECT.total})`, ce.status < 300 && pay.company?.total === TD_EXPENSE && near(pay.cust.totalWorkOrderCost, CUST_EXPECT.total), { status: ce.status, company: pay.company });
    const custPay = await payment(cust, WO); const workerPay = await payment(worker, WO); const payeePay = key === 'vendor' ? await payment(payee, WO) : workerPay;
    check('13. customer API sees the same customer numbers as Tech Domain', custPay.cust.totalWorkOrderCost === pay.cust.totalWorkOrderCost && custPay.cust.totalLabourCost === pay.cust.totalLabourCost, custPay.cust);
    check(`14. ${key === 'vendor' ? 'vendor owner and member' : 'engineer'} API see the engineer numbers (${ENG_EXPECT})`, near(workerPay.eng.totalWorkOrderCost, ENG_EXPECT) && near(payeePay.eng.totalWorkOrderCost, ENG_EXPECT), { worker: workerPay.eng, payee: payeePay.eng });
    info('do the engineer-side users see the CUSTOMER rates? (should not)', { worker: workerPay.cust, payee: payeePay.cust });

    // ---------- 7. Reviewed -> Verify -> PO Pending -> customer PO -> Approve ----------
    const rv = await patchJson(td, `/workOrders/${WO}/subStatus`, { subStatus: 'REVIEWED' }); await sleep(1_500);
    const vf = await postJson(td, `/workOrders/${WO}/verify`, {}); await sleep(1_500);
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    let pp = { status: 'skipped' }; if (wo.subStatus !== 'PO_PENDING') { pp = await postJson(td, `/workOrders/${WO}/poPending`, {}); await sleep(1_500); wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; }
    check('15. Tech Domain: Reviewed -> Verify -> PO Pending (VERIFIED / PO_PENDING)', rv.status < 300 && vf.status < 300 && wo.status === 'VERIFIED' && wo.subStatus === 'PO_PENDING', { reviewed: rv.status, verify: vf.status, poPending: pp.status, status: wo.status, subStatus: wo.subStatus });
    const poNumber = `PO-${REF}-QA`;
    const po = await call(cust, 'post', `/workOrders/${WO}/purchaseOrder`, undefined, { purchaseOrders: JSON.stringify([{ number: poNumber, uid: `qa-${RUN}` }]) }); // web app sends FormData purchaseOrders=JSON array
    await sleep(2_000); wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    check(`16. customer added purchase order ${poNumber} -> PO Pending cleared`, po.status < 300 && (wo.purchaseOrders || []).some((p) => p.number === poNumber) && wo.subStatus !== 'PO_PENDING', { po: po.status, body: JSON.stringify(po.body).slice(0, 150), subStatus: wo.subStatus, pos: (wo.purchaseOrders || []).map((p) => p.number) });
    const apr = await postJson(td, `/workOrders/${WO}/approve`, {}); await sleep(2_000);
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; pay = await payment(td, WO); results.steps.approved = { status: wo.status, customerStatus: wo.customerStatus, pay };
    check(`17. Tech Domain approved -> APPROVED; final numbers unchanged (customer ${CUST_EXPECT.total}, engineer ${ENG_EXPECT}, TD expense ${TD_EXPENSE})`, apr.status < 300 && wo.status === 'APPROVED' && near(pay.cust.totalWorkOrderCost, CUST_EXPECT.total) && near(pay.eng.totalWorkOrderCost, ENG_EXPECT), results.steps.approved);
    expect(wo.status, 'work order must be APPROVED to invoice').toBe('APPROVED');

    // ---------- 8. invoices ----------
    const ci = await postJson(td, '/invoices', { clientId: ENTITY_ID, currency: 'USD', paymentTerms: 30, taxType: 'GST', taxPercentage: GST, workOrderIds: [WO], bankAccountId: TD_BANK, branchId: TD_BRANCH, role: 'CLIENT' });
    const custInvId = ci.body?.data?.id || ci.body?.id; results.custInvoice = custInvId;
    const cd = custInvId ? (await getJson(td, `/invoices/details/${custInvId}`)).body?.data || {} : {};
    check(`18. CUSTOMER invoice INV-#${custInvId} generated: subTotal ${CUST_EXPECT.total}, GST ${GST}% = ${CUST_EXPECT.tax}, grand total ${CUST_EXPECT.grand}`, ci.status < 300 && cd.status === 'GENERATED' && near(cd.subTotal, CUST_EXPECT.total) && near(cd.taxAmount, CUST_EXPECT.tax) && near(cd.grandTotal, CUST_EXPECT.grand), { status: ci.status, body: JSON.stringify(ci.body).slice(0, 150), inv: { status: cd.status, subTotal: cd.subTotal, taxAmount: cd.taxAmount, grandTotal: cd.grandTotal, currency: cd.currency, dueDate: cd.dueDate } });
    // engineer / vendor bank account (the invoice needs one)
    let banks = (await getJson(td, `/bankDetails/user/${payee.id}/bankAccountDetails`)).body?.data || [];
    if (!banks.length) {
      const nb = await postJson(payee, '/bankDetails', { accountHolderName: payee.name, bankName: 'QA Vendor Bank', bankAddress: '', accountNumber: '987654321', iban: '', swiftCode: '', accountType: 'CURRENT', currency: 'USD', routingNumber: '', sortCode: '', bsb: '', institutionNumber: '', transitNumber: '', bankCode: '' });
      log(`POST bankDetails as ${payee.label} ${payee.id} -> ${nb.status} ${JSON.stringify(nb.body).slice(0, 200)}`);
      banks = (await getJson(td, `/bankDetails/user/${payee.id}/bankAccountDetails`)).body?.data || [];
      info(`bank account added for ${key === 'vendor' ? 'vendor owner' : 'engineer'} ${payee.id} (had none)`, { status: nb.status, banks: banks.map((b) => ({ id: b.id, bankName: b.bankName })) });
    }
    const bankId = banks[0]?.id;
    const engInvPayload = { clientId: ENTITY_ID, engineerId: payee.id, currency: 'USD', paymentTerms: 30, taxType: null, taxPercentage: 0, workOrderIds: [WO], bankAccountId: bankId, branchId: TD_BRANCH, role: 'FREELANCER' };
    let ei = await postJson(td, '/invoices/engineer', engInvPayload);
    let engInvPayee = payee.id;
    if (ei.status >= 300 && key === 'vendor') { // maybe the invoice must be raised to the member
      log(`engineer invoice to vendor owner failed ${ei.status} ${JSON.stringify(ei.body).slice(0, 200)} -> trying member ${worker.id}`);
      ei = await postJson(td, '/invoices/engineer', { ...engInvPayload, engineerId: worker.id }); engInvPayee = worker.id;
    }
    const engInvId = ei.body?.data?.id || ei.body?.id; results.engInvoice = engInvId;
    const ed = engInvId ? (await getJson(td, `/invoices/engineer/details/${engInvId}`)).body?.data || {} : {};
    check(`19. ENGINEER invoice #${engInvId} generated to ${key === 'vendor' ? 'vendor owner' : 'engineer'} ${engInvPayee} "${ed.engineer?.firstName || ''} ${ed.engineer?.lastName || ''}": subTotal = grand total = ${ENG_EXPECT}, no tax`, ei.status < 300 && ed.status === 'GENERATED' && near(ed.subTotal, ENG_EXPECT) && near(ed.grandTotal, ENG_EXPECT) && ed.engineer?.id === engInvPayee, { status: ei.status, body: JSON.stringify(ei.body).slice(0, 150), payload: engInvPayload, inv: { status: ed.status, subTotal: ed.subTotal, taxAmount: ed.taxAmount, grandTotal: ed.grandTotal, engineer: ed.engineer?.id, bank: ed.bankAccount?.bankName } });
    // send both
    const s1 = custInvId ? await call(td, 'patch', `/invoices/send/${custInvId}`, undefined, { id: String(custInvId), status: 'UNPAID', toEmail: custAcc.email, skipEmail: 'false' }) : { status: 0 };
    const s2 = engInvId ? await call(td, 'patch', `/invoices/engineer/send/${engInvId}`, undefined, { id: String(engInvId), status: 'UNPAID', toEmail: payee.account.email, skipEmail: 'false' }) : { status: 0 };
    await sleep(2_500);
    const cd2 = custInvId ? (await getJson(td, `/invoices/details/${custInvId}`)).body?.data || {} : {}; const ed2 = engInvId ? (await getJson(td, `/invoices/engineer/details/${engInvId}`)).body?.data || {} : {};
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    check('20. both invoices sent -> UNPAID; work order INVOICED; amounts unchanged', s1.status < 300 && s2.status < 300 && cd2.status === 'UNPAID' && ed2.status === 'UNPAID' && wo.status === 'INVOICED' && near(cd2.grandTotal, CUST_EXPECT.grand) && near(ed2.grandTotal, ENG_EXPECT), { sendCust: s1.status, sendEng: s2.status, cust: cd2.status, eng: ed2.status, wo: wo.status, customerStatus: wo.customerStatus });
    const custList = (await getJson(cust, `/invoices?role=CLIENT&page=1&limit=50&status=UNPAID`)).body?.data; const custRow = (custList?.invoices || custList || []).find((i) => i.id === custInvId);
    check(`21. customer sees INV-#${custInvId} UNPAID with grand total ${CUST_EXPECT.grand} in their invoice list`, !!custRow && near(custRow.grandTotal, CUST_EXPECT.grand), custRow && { status: custRow.status, subTotal: custRow.subTotal, taxAmount: custRow.taxAmount, grandTotal: custRow.grandTotal });
    const payeeInv = await getJson(payee, `/invoices/engineer?limit=5&page=1`);
    info(`${key === 'vendor' ? 'vendor owner' : 'engineer'} access to /invoices/engineer (engineers have no invoice UI; 403 expected)`, { status: payeeInv.status });
    // mark both paid
    const p1 = custInvId ? await call(td, 'patch', `/invoices/paid/${custInvId}`, undefined, { id: String(custInvId), status: 'PAID', file: { name: 'proof.png', mimeType: 'image/png', buffer: PNG } }) : { status: 0 };
    const p2 = engInvId ? await call(td, 'patch', `/invoices/engineer/paid/${engInvId}`, undefined, { id: String(engInvId), status: 'PAID', file: { name: 'proof.png', mimeType: 'image/png', buffer: PNG } }) : { status: 0 };
    await sleep(2_500);
    const cd3 = custInvId ? (await getJson(td, `/invoices/details/${custInvId}`)).body?.data || {} : {}; const ed3 = engInvId ? (await getJson(td, `/invoices/engineer/details/${engInvId}`)).body?.data || {} : {};
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    results.steps.paid = { custInvoice: { status: cd3.status, grandTotal: cd3.grandTotal, history: (cd3.statusHistory || []).map((h) => h.newStatus || h.status) }, engInvoice: { status: ed3.status, grandTotal: ed3.grandTotal, history: (ed3.statusHistory || []).map((h) => h.newStatus || h.status) }, wo: { status: wo.status, customerStatus: wo.customerStatus } };
    check(`22. both invoices marked PAID (customer ${CUST_EXPECT.grand}, engineer ${ENG_EXPECT}); WO customerStatus PAID`, p1.status < 300 && p2.status < 300 && cd3.status === 'PAID' && ed3.status === 'PAID' && near(cd3.grandTotal, CUST_EXPECT.grand) && near(ed3.grandTotal, ENG_EXPECT) && wo.customerStatus === 'PAID', { paidCust: p1.status, paidEng: p2.status, ...results.steps.paid });
    const custNotes = (await getJson(cust, `/notifications/others?userId=${cust.id}&limit=10`)).body?.data; const notes = (custNotes?.data || custNotes || []).filter((n) => /invoice/i.test(n.title + ' ' + n.content)).slice(0, 3).map((n) => ({ title: n.title, content: String(n.content).replace(/<[^>]+>/g, '').trim() }));
    info('customer invoice notifications (wording ticket already drafted)', notes);

    // ---------- 9. UI evidence ----------
    const paymentTab = async (page, url, name) => { await page.goto(url); await page.waitForTimeout(5_000); await dismiss(page); await page.getByRole('tab', { name: /Payment/i }).first().click().catch(() => { }); await page.waitForTimeout(4_000); const txt = await bodyText(page); const s = await shot(page, name); return { txt, s }; };
    { const { ctx, page } = await newPage(browser, tdAcc);
      const { txt, s } = await paymentTab(page, `/workOrder/details/${WO}`, 'td-payment-tab');
      check(`23. Tech Domain Payment tab: customer ${CUST_EXPECT.labour}.00 / ${CUST_EXPECT.total}.00, engineer ${ENG_EXPECT.toFixed(2)}, TD expense ${TD_EXPENSE}.00`, txt.includes(`${CUST_EXPECT.labour}.00`) && txt.includes(`${CUST_EXPECT.total}.00`) && txt.includes(ENG_EXPECT.toFixed(2)) && txt.includes(`${TD_EXPENSE}.00`), { shot: s, snippet: txt.slice(txt.indexOf('Customer Rates'), txt.indexOf('Customer Rates') + 500) });
      await page.goto(`/workOrder/details/${WO}`); await page.waitForTimeout(4_000); await dismiss(page); const hdr = await bodyText(page); const sh2 = await shot(page, 'td-wo-header'); info('Tech Domain WO header after payment', { shot: sh2, invoiced: /Invoiced/.test(hdr), paid: /\bPaid\b/.test(hdr) });
      await page.goto('/invoices/engineer'); await page.waitForTimeout(5_000); await page.getByText(/^Paid/).first().click().catch(() => { }); await page.waitForTimeout(4_000); const et = await bodyText(page); const s3 = await shot(page, 'td-engineer-invoices');
      check(`24. Tech Domain Engineer Invoices list (Paid tab) shows invoice #${engInvId} for "${payee.name}" ${ENG_EXPECT.toFixed(2)}`, et.includes(ENG_EXPECT.toFixed(2)) && et.includes(payee.name.split(' ')[0]), { shot: s3, row: (et.match(new RegExp(`.{0,80}${ENG_EXPECT.toFixed(2)}.{0,80}`)) || [])[0] });
      await page.goto('/invoices/customer'); await page.waitForTimeout(5_000); await page.getByText(/^Paid/).first().click().catch(() => { }); await page.waitForTimeout(4_000); const ct = await bodyText(page); const s4 = await shot(page, 'td-customer-invoices');
      info('Tech Domain Customer Invoices list', { shot: s4, row: (ct.match(new RegExp(`.{0,80}${CUST_EXPECT.grand.toFixed(2)}.{0,80}`)) || [])[0] });
      await ctx.close(); }
    { const { ctx, page } = await newPage(browser, custAcc);
      const { txt, s } = await paymentTab(page, `/workOrder/details/${WO}?fromCustomerBoard=true`, 'customer-payment-tab');
      check(`25. customer Payment tab: ${CUST_EXPECT.labour}.00 / ${CUST_EXPECT.total}.00, no engineer rate (${ENG.hourlyRate}.00) and no TD expense`, txt.includes(`${CUST_EXPECT.labour}.00`) && txt.includes(`${CUST_EXPECT.total}.00`) && !txt.includes(ENG_EXPECT.toFixed(2)) && !/cable material/i.test(txt), { shot: s, hasEngineerTotal: txt.includes(ENG_EXPECT.toFixed(2)) });
      await page.goto('/invoices'); await page.waitForTimeout(5_000); const it = await bodyText(page); const s2 = await shot(page, 'customer-invoices'); info('customer Invoices page', { shot: s2, snippet: it.slice(it.indexOf('Invoice ID'), it.indexOf('Invoice ID') + 300) });
      await ctx.close(); }
    { const { ctx, page } = await newPage(browser, workerAccount);
      const { txt, s } = await paymentTab(page, `/workOrder/details/${WO}`, `${key === 'vendor' ? 'vendor-member' : 'engineer'}-payment-tab`);
      check(`26. ${key === 'vendor' ? 'vendor member (Demo Worker)' : 'engineer'} Payment tab shows ${ENG_EXPECT.toFixed(2)} and NOT the customer figures (${CUST_EXPECT.total}.00)`, txt.includes(ENG_EXPECT.toFixed(2)) && !txt.includes(`${CUST_EXPECT.total}.00`), { shot: s, hasCustomerTotal: txt.includes(`${CUST_EXPECT.total}.00`), has58: /58\.00/.test(txt) });
      await ctx.close(); }
    if (key === 'vendor') { const { ctx, page } = await newPage(browser, vendorAcc);
      const { txt, s } = await paymentTab(page, `/workOrder/details/${WO}`, 'vendor-owner-payment-tab');
      check(`27. vendor owner Payment tab shows the vendor counter rates (${ENG.hourlyRate}.00) and total ${ENG_EXPECT.toFixed(2)}, not the customer figures`, txt.includes(ENG_EXPECT.toFixed(2)) && txt.includes(`${ENG.hourlyRate}.00`) && !txt.includes(`${CUST_EXPECT.total}.00`), { shot: s, hasCustomerTotal: txt.includes(`${CUST_EXPECT.total}.00`) });
      await page.goto('/invoices'); await page.waitForTimeout(4_000); const vt = await bodyText(page); const s2 = await shot(page, 'vendor-owner-invoices-page'); info('vendor owner /invoices page (no engineer invoice UI expected)', { shot: s2, snippet: vt.slice(0, 200) });
      await ctx.close(); }

    const summary = save();
    log(`\nSUMMARY (${key}) WO ${WO} #${REF}, invoices customer ${custInvId} / engineer ${engInvId}\n${summary}\nFINDINGS: ${results.findings.length}`);
  });
}
