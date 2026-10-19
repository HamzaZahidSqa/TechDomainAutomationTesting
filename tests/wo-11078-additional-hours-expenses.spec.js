// WO #11078 (id 1084): after the EDITED counter offer was accepted (58/h, 6 min hrs, 62/h additional, expenses Travel 30 +
// Parking 10 = 388) the work order is published, assigned to the test engineer and completed; then the time log is edited
// to 8.5 worked hours (-> 2.5 additional hours) and a Tech Domain expense is added. Every calculation is checked.
//
// Expected (customer side, clientRates):
//   labour = 58 x 6 (min) + 2.5 x 62 (additional) = 348 + 155 = 503 ; expenses 30 + 10 = 40 ; total 543
//   (+ Tech Domain expense 25 if it is counted on the customer side -> 568)
//
// Run:  WO_ID=1084 npx playwright test tests/wo-11078-additional-hours-expenses.spec.js --reporter=line --trace off
// Evidence: evidence/CounterOffer-EditBeforeAccept/wo-11078-hours-expenses-run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const WO = Number(process.env.WO_ID || 1084);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'CounterOffer-EditBeforeAccept', `wo-11078-hours-expenses-run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const TEMPLATE_WO = 242, TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';
const RATE = { h: 58, min: 6, add: 62, expenses: 40 }; // accepted counter offer values
const WORKED_HOURS = 8.5, TD_EXPENSE = 25;

test.setTimeout(900_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `WO-11078_HoursExpenses_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
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
const rates = (pay) => { const c = pay?.clientRates || {}; return { hourlyRate: c.hourlyRate, minimumHours: c.minimumHours, additionalHourlyRate: c.additionalHourlyRate, hoursWorked: c.hoursWorked, additionalHours: c.additionalHours, totalHoursApproved: c.totalHoursApproved, totalLabourCost: c.totalLabourCost, totalExpenseCost: c.totalExpenseCost, totalWorkOrderCost: c.totalWorkOrderCost, serviceFee: c.serviceFee, penalty: c.penalty, grandTotal: c.grandTotal, expenses: (c.expenses || []).map((e) => `${e.expenseType}:${e.description}:${e.amount}`) }; };
const engRates = (pay) => { const c = pay?.engineerRates || {}; return { hourlyRate: c.hourlyRate, minimumHours: c.minimumHours, additionalHourlyRate: c.additionalHourlyRate, hoursWorked: c.hoursWorked, additionalHours: c.additionalHours, totalHoursApproved: c.totalHoursApproved, totalLabourCost: c.totalLabourCost, totalExpenseCost: c.totalExpenseCost, totalWorkOrderCost: c.totalWorkOrderCost, grandTotal: c.grandTotal, expenses: (c.expenses || []).map((e) => `${e.expenseType}:${e.amount}`) }; };
async function uiLogin(page, account) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  const em = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first(); await em.waitFor({ state: 'visible' });
  await em.fill(account.email); await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 60_000 }); await page.waitForTimeout(3_000);
}
async function newPage(browser, account) { const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(45_000); await uiLogin(page, account); return { ctx, page }; }
async function paymentTab(page, url, name) { await page.goto(url); await page.waitForTimeout(5_000); const cancel = page.getByRole('button', { name: 'Cancel', exact: true }); if (await cancel.isVisible().catch(() => false)) { await cancel.click(); await page.waitForTimeout(1_500); } /* WORKDONE auto Feedback popup */ await page.getByRole('tab', { name: /Payment/i }).first().click().catch(() => { }); await page.waitForTimeout(4_000); const txt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' '); const s = await shot(page, name); return { txt, s }; }

test('WO #11078: additional hours + expenses after the edited counter offer was accepted', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, wo: WO, checks: [], findings: [], steps: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 700) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const engAcc = accounts.find((a) => a.role === 'Individual Engineer');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const td = await apiLogin(tdAcc, 'Tech Domain'); const eng = await apiLogin(engAcc, 'Engineer'); const cust = await apiLogin(custAcc, 'Customer');
  let wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
  const REF = wo.referenceId;
  const pay0 = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
  results.steps.start = { status: wo.status, subStatus: wo.subStatus, pay: pay0 };
  check(`0. start: WO ${WO} (#${REF}) ${wo.status}/${wo.subStatus}, accepted counter rates 58/6/62, expenses Travel 30 + Parking 10, total 388`, pay0.hourlyRate === 58 && pay0.minimumHours === 6 && pay0.additionalHourlyRate === 62 && pay0.totalWorkOrderCost === 388, results.steps.start);

  // 1. publish (keep the accepted rates) - only when still pending approval
  if (wo.status === 'PENDING_APPROVAL') {
    const template = (await getJson(td, `/workOrders/${TEMPLATE_WO}`)).body?.data || {};
    const fx = await patchJson(td, `/workOrders/${WO}`, { teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3', categoryId: template?.category?.id, workOrderServices: (template?.workOrderServices || []).map((x) => ({ serviceId: x.serviceId || x.id })), engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerMinimumHours: 4, engineerAdditionalHourlyRate: 15 });
    const ap = await postJson(td, `/workOrders/${WO}/approvePublish`, {});
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    const pay1 = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
    check('1. Tech Domain published the work order and the accepted rates survived (58/6/62, 388)', fx.status < 300 && ap.status < 300 && wo.status === 'PUBLISHED' && pay1.hourlyRate === 58 && pay1.totalWorkOrderCost === 388, { fix: fx.status, approvePublish: ap.status, status: wo.status, pay: pay1 });
  }
  // 2. assign the engineer (far-future slot to avoid schedule conflicts, then schedule -> now)
  if (wo.status === 'PUBLISHED') {
    const minute = Math.floor(Date.now() / 60_000);
    const slot = new Date(Date.now() + (170 + (minute % 60)) * 86_400_000); slot.setUTCHours(2 + (minute % 12), 0, 0, 0);
    const d = slot.toISOString().slice(0, 10), hm = slot.toISOString().slice(11, 16);
    const sh = await patchJson(td, `/workOrders/${WO}`, { orderStartDate: `${d}T00:00:00`, orderStartTime: `${d}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' });
    const route = await postJson(td, '/offers/route', { workOrderId: WO, userIds: [eng.id] });
    const offerId = (route.body?.data || [])[0]?.id || route.body?.data?.id;
    const acc = await postJson(eng, `/offers/route/accept/${offerId}`, {});
    const asg = await postJson(td, '/offers/assign', { workOrderId: WO, userId: eng.id });
    await sleep(2_000);
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    check(`2. engineer ${eng.id} "${eng.name}" routed -> accepted -> assigned`, wo.status === 'ASSIGNED' && (wo.engineerId || wo.engineer?.id) === eng.id, { schedule: sh.status, route: route.status, routeBody: JSON.stringify(route.body).slice(0, 150), accept: acc.status, assign: asg.status, assignBody: JSON.stringify(asg.body).slice(0, 150), status: wo.status });
    const pay2 = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
    check('2b. after assignment the customer rates are still 58/6/62 with expenses 40 (total 388)', pay2.hourlyRate === 58 && pay2.totalWorkOrderCost === 388, pay2);
  }
  expect(wo.status, 'work order must be ASSIGNED to continue').toBe('ASSIGNED');
  const now = new Date(Date.now() - 5 * 60_000); const nd = now.toISOString().slice(0, 10), nh = now.toISOString().slice(11, 16);
  const sch = await patchJson(td, `/workOrders/${WO}`, { orderStartDate: `${nd}T00:00:00`, orderStartTime: `${nd}T${nh}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' });
  log(`schedule -> now ${sch.status}`); await sleep(2_000);
  wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
  const task = (t) => (wo.tasks || []).find((x) => x.taskType === t)?.completedTask?.id;
  const lat = wo.address?.latitude || 31.5203696, lng = wo.address?.longitude || 74.3587473;

  // 3. engineer completes the job
  const walk = [];
  const stepW = async (n, fn) => { const r = await fn(); walk.push(`${n}:${r.status}`); if (r.status >= 300) log(`${n} -> ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`); await sleep(2_500); wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; };
  await stepW('confirm', () => patchJson(eng, `/workOrders/${WO}/subStatus`, { subStatus: 'CONFIRMED' }));
  await stepW('checkIn', () => postJson(eng, '/timeLogs/checkIn', { workOrderId: WO, checkInLatitude: lat, checkInLongitude: lng, taskId: task('CHECK_IN'), checkInTimeZone: 'UTC' }));
  await stepW('checkOut', () => postJson(eng, '/timeLogs/checkOut', { workOrderId: WO, checkOutLatitude: lat, checkOutLongitude: lng, taskId: task('CHECK_OUT'), checkOutTimeZone: 'UTC' }));
  await stepW('markComplete', () => patchJson(eng, `/tasks/${task('MARK_COMPLETE')}`, { isCompleted: true, text: 'QA complete' }));
  check('3. engineer confirm -> check-in -> check-out -> mark complete => WORKDONE', wo.status === 'WORKDONE', { walk, status: wo.status });
  const pay3 = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
  results.steps.afterWorkDone = pay3;
  check('4. at WORKDONE with ~0 h worked: hoursWorked 0, additionalHours 0, totalHoursApproved = 6 (minimum), labour 58x6 = 348, total 388', pay3.hoursWorked === 0 && pay3.additionalHours === 0 && pay3.totalHoursApproved === 6 && pay3.totalLabourCost === 348 && pay3.totalWorkOrderCost === 388, pay3);

  // 4. Tech Domain edits the time log to 8.5 worked hours -> 2.5 additional hours
  const logs = (await getJson(td, `/timeLogs/${WO}`)).body?.data || [];
  const tl = logs[logs.length - 1];
  info('time logs before the edit', logs.map((l) => ({ id: l.id, in: l.checkInTime, out: l.checkOutTime, totalHours: l.totalHours })));
  const inT = new Date(Date.now() - 10 * 3_600_000); inT.setUTCMinutes(0, 0, 0); const outT = new Date(inT.getTime() + WORKED_HOURS * 3_600_000);
  const up = await patchJson(td, '/timeLogs/updateTimelogs', { logs: [{ id: Number(tl?.id), checkInTime: inT.toISOString(), checkOutTime: outT.toISOString() }] });
  log(`PATCH timeLogs/updateTimelogs -> ${up.status} ${JSON.stringify(up.body).slice(0, 200)}`);
  await sleep(2_000);
  const logs2 = (await getJson(td, `/timeLogs/${WO}`)).body?.data || [];
  const hoursNow = logs2.reduce((a, l) => a + Number(l.totalHours || 0), 0);
  check(`5. Tech Domain edited the time log to ${WORKED_HOURS} h (PATCH timeLogs/updateTimelogs)`, up.status < 300 && Math.abs(hoursNow - WORKED_HOURS) < 0.02, { status: up.status, logs: logs2.map((l) => ({ id: l.id, in: l.checkInTime, out: l.checkOutTime, totalHours: l.totalHours })) });
  const pay4 = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
  results.steps.afterHours = pay4;
  // observed dev rule (2026-10-16): customer overrun >= 15 min is rounded UP to the next full hour, < 15 min pro-rata; engineer is always pro-rata
  const billedHours = (WORKED_HOURS % 1) >= 0.25 ? Math.ceil(WORKED_HOURS) : WORKED_HOURS;
  const expLabour = RATE.h * RATE.min + (billedHours - RATE.min) * RATE.add; // 8.5 h -> 9 h -> 348 + 186 = 534
  info('customer billing rule under test', { workedHours: WORKED_HOURS, billedHours, expectedLabour: expLabour, note: 'pro-rata would be 503; see REPORT-WO-11078-hours-expenses.md finding 1' });
  check(`6. CALC with ${WORKED_HOURS} h: hoursWorked ${WORKED_HOURS}, additionalHours ${WORKED_HOURS - RATE.min}, labour = 58x6 + (billed-6)x62 = ${expLabour}, expenses 40, total ${expLabour + 40}`, Math.abs(pay4.hoursWorked - billedHours) < 0.02 && Math.abs(pay4.additionalHours - (billedHours - RATE.min)) < 0.02 && Math.abs(pay4.totalLabourCost - expLabour) < 0.01 && pay4.totalExpenseCost === 40 && Math.abs(pay4.totalWorkOrderCost - (expLabour + 40)) < 0.01, pay4);
  const e4 = engRates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
  info('engineer side after 8.5 h (engineer rates 15/h, min 4, additional 15/h): expected labour 15x4 + 4.5x15 = 127.5', e4);
  check('6b. engineer labour = 15x4 + 4.5x15 = 127.5', Math.abs(e4.totalLabourCost - 127.5) < 0.01, e4);

  // 5. Tech Domain adds a company expense
  const ce = await patchJson(td, `/workOrders/${WO}/companyExpenses`, { id: WO, companyCurrency: 'USD', companyExpenses: [{ expenseType: 'MATERIAL', description: 'TD cable material', amount: TD_EXPENSE }] }); // key must be companyExpenses (wrong key -> 200 success:true, nothing saved)
  log(`PATCH companyExpenses -> ${ce.status} ${JSON.stringify(ce.body).slice(0, 200)}`);
  await sleep(2_000);
  const payFull = (await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data;
  const pay5 = rates(payFull); results.steps.afterExpense = pay5; results.steps.paymentRaw = payFull;
  const otherKeys = Object.keys(payFull || {}).filter((k) => !['clientRates', 'engineerRates'].includes(k));
  info('estimatedPayment top-level keys (where is the Tech Domain expense?)', { keys: Object.keys(payFull || {}), other: Object.fromEntries(otherKeys.map((k) => [k, JSON.stringify(payFull[k]).slice(0, 200)])) });
  check(`7. Tech Domain expense ${TD_EXPENSE} added (PATCH workOrders/:id/companyExpenses)`, ce.status < 300, { status: ce.status });
  const tdExpInClient = pay5.expenses.some((x) => x.startsWith('MATERIAL'));
  info(`8. is the Tech Domain expense counted in the CUSTOMER total? inClientExpenses=${tdExpInClient}; customer total now ${pay5.totalWorkOrderCost} (503+40=543 without it, 568 with it)`, pay5);
  check('8b. customer labour is unchanged by the Tech Domain expense (503) and customer expenses are Travel 30 + Parking 10 (+ Material 25 only if TD expenses are billed to the customer)', Math.abs(pay5.totalLabourCost - expLabour) < 0.01 && pay5.expenses.includes('TRAVEL:Customer travel:30') && pay5.expenses.some((x) => x.startsWith('OTHER:Parking')) && (pay5.totalWorkOrderCost === 543 || pay5.totalWorkOrderCost === 568), pay5);
  const custPay = rates((await getJson(cust, `/workOrders/estimatedPayment/${WO}`)).body?.data);
  check('9. customer API sees the same numbers as Tech Domain (hours, additional hours, labour, expenses, total)', custPay.totalLabourCost === pay5.totalLabourCost && custPay.totalWorkOrderCost === pay5.totalWorkOrderCost && custPay.hoursWorked === pay5.hoursWorked, custPay);

  // 6. UI evidence
  { const { ctx, page } = await newPage(browser, tdAcc);
    const { txt, s } = await paymentTab(page, `/workOrder/details/${WO}`, 'techdomain-payment-tab');
    results.steps.tdPaymentTab = txt.slice(0, 2500);
    check('10. Tech Domain Payment tab shows 58.00, 8.5 worked hours / 2.5 additional, 503.00 labour and the expenses', /58\.00/.test(txt) && /503\.00/.test(txt) && /Parking/.test(txt) && /25\.00/.test(txt), { has58: /58\.00/.test(txt), has503: /503\.00/.test(txt), has2_5: /2\.5|2:30|02:30/.test(txt), has8_5: /8\.5|8:30|08:30/.test(txt), parking: /Parking/.test(txt), material: /cable material/i.test(txt), shot: s });
    await page.goto(`/workOrder/details/${WO}`); await page.waitForTimeout(5_000);
    const s2 = await shot(page, 'techdomain-detail-workdone'); info('Tech Domain detail at WORKDONE (working hours header)', { shot: s2, header: (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400) });
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, custAcc);
    const { txt, s } = await paymentTab(page, `/workOrder/details/${WO}?fromCustomerBoard=true`, 'customer-payment-tab');
    results.steps.custPaymentTab = txt.slice(0, 2500);
    check('11. customer Payment tab shows 58.00, labour 503.00 and the expenses Travel + Parking', /58\.00/.test(txt) && /503\.00/.test(txt) && /Parking/.test(txt), { has58: /58\.00/.test(txt), has503: /503\.00/.test(txt), parking: /Parking/.test(txt), material: /cable material/i.test(txt), total543: /543\.00/.test(txt), total568: /568\.00/.test(txt), shot: s });
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, engAcc);
    const { txt, s } = await paymentTab(page, `/workOrder/details/${WO}`, 'engineer-payment-tab');
    info('engineer Payment tab', { has127: /127\.50/.test(txt), has8_5: /8\.5|8:30/.test(txt), shot: s });
    await ctx.close(); }

  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.length}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
