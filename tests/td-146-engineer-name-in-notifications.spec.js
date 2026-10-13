// TD-146: "Show engineer's name instead of generic 'Engineer' in engineer-related notifications"  (Backend, Hotfix, PR merged 2026-10-12)
// https://techdomain.atlassian.net/browse/TD-146
//
// Expected: every engineer-related notification (assigned, confirmed, ready to go, en route, running late, checked in,
// checked out, completed) names the engineer (e.g. "Syed Hamza") instead of the generic word "Engineer".
//
// Flow (API): customer owner creates a WO -> Tech Domain completes it and approvePublish -> route to the individual
// engineer -> engineer accepts -> Tech Domain assigns -> engineer confirms, ready to go, on the way, running late,
// check-in, check-out, mark complete (task ids = tasks[].completedTask.id). Then the notifications created during the
// walk are read for Tech Domain (27), the customer owner (638) and the engineer, and each engineer-related one is
// checked for the engineer's name. UI: the customer's bell panel is screenshotted.
//
// Run:  npx playwright test tests/td-146-engineer-name-in-notifications.spec.js --reporter=line --trace off
//       (env WO_ID=<assigned WO> skips the create/assign setup)
// Evidence: evidence/TD-146-EngineerNameNotifications/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-146-EngineerNameNotifications', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const ENTITY_ID = 104, TEMPLATE_WO = 242, TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';
const ENGINEER_ROLE = process.env.ENGINEER_ROLE || 'Individual Engineer';
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const ENGINEER_TYPES = /^(WORK_ORDER_ASSIGNED|WORK_ORDER_CONFIRMED|WORK_ORDER_READY_TO_GO|WORK_ORDER_ON_THE_WAY|WORK_ORDER_RUNNING_LATE|WORK_ORDER_CHECK_IN|WORK_ORDER_CHECK_OUT|WORK_ORDER_WORK_DONE)$/;

test.setTimeout(900_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-146_EngineerName_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f }).catch(() => { }); return path.basename(f); }
async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({})); await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`);
  return { api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } }), id: body.data?.id, name: `${body.data?.firstName || ''} ${body.data?.lastName || ''}`.trim(), email: account.email, account };
}
const relogin = async (s) => { await s.api.dispose().catch(() => { }); return apiLogin(s.account); };
async function call(s, method, p, data) { const r = await s.api.fetch(u(p), { method, data }); const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); } return { status: r.status(), body }; }
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
function customerWoPayload(title) { const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0); const day = start.toISOString().slice(0, 10); return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'TD-146 QA automation (engineer name in notifications)', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5, nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }
function clientFixPayload(t, title, addressId) { const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0); const day = start.toISOString().slice(0, 10); return { templateId: null, title, serviceLevelAgreeement: t.serviceLevelAgreeement || '', clientId: ENTITY_ID, projectId: t.project?.id || null, teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'TD-146 QA automation', confidentialInformation: '', categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })), scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: t.timeZone || 'Asia/Karachi', addressId, qualificationSubTypes: (t.qualificationSubTypes || []).map((q) => q.id), expenses: [], paymentType: 'HOURLY', paymentTerms: t.paymentTerms || '15 days', currency: t.currency || 'USD', hourlyRate: t.hourlyRate || 20, minimumHours: t.minimumHours || 4, nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }

test('TD-146 engineer-related notifications name the engineer', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, checks: [], findings: [], setup: {}, walk: [], notifications: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 600)}`); };

  let td = await apiLogin(accounts.find((a) => a.role === 'TechDomain User'));
  let cust = await apiLogin(testAccounts.find((a) => a.role === 'Customer'));
  let eng = await apiLogin(accounts.find((a) => a.role === ENGINEER_ROLE));
  const engName = eng.name; log(`engineer = ${eng.id} "${engName}" (${ENGINEER_ROLE}); TD ${td.id}; customer ${cust.id}`);
  const t0 = new Date().toISOString();

  // ---------------- setup: WO assigned to the engineer ----------------
  let WO = Number(process.env.WO_ID || 0);
  if (!WO) {
    const cr = await call(cust, 'POST', '/workOrders', customerWoPayload(`TD-146 engineer name ${RUN}`));
    const list = await call(cust, 'GET', `/workOrders/customer?page=1&limit=5&search=TD-146 engineer name ${RUN}`);
    WO = (list.body?.data?.workOrders || list.body?.data?.data || [])[0]?.id;
    log(`customer POST /workOrders -> ${cr.status}; new WO id ${WO}`);
    expect(WO, 'customer WO created').toBeTruthy();
    const woFull = (await call(td, 'GET', `/workOrders/${WO}`)).body?.data;
    const template = (await call(td, 'GET', `/workOrders/${TEMPLATE_WO}`)).body?.data;
    const fix = await call(td, 'PATCH', `/workOrders/${WO}`, clientFixPayload(template, woFull.title, woFull.address?.id || woFull.addressId));
    const ap = await call(td, 'POST', `/workOrders/${WO}/approvePublish`, {});
    log(`TD PATCH fix -> ${fix.status}; approvePublish -> ${ap.status} ${JSON.stringify(ap.body).slice(0, 120)}`);
    expect(ap.status, 'approvePublish').toBeLessThan(300);
    const route = await call(td, 'POST', '/offers/route', { workOrderId: WO, userIds: [eng.id] });
    const offerId = (route.body?.data || [])[0]?.id;
    const acc = await call(eng, 'POST', `/offers/route/accept/${offerId}`, {});
    const asg = await call(td, 'POST', '/offers/assign', { workOrderId: WO, userId: eng.id });
    log(`route -> ${route.status} offer ${offerId}; accept -> ${acc.status}; assign -> ${asg.status} ${JSON.stringify(asg.body).slice(0, 100)}`);
    expect(asg.status, 'assign').toBeLessThan(300);
  }
  const load = async () => (await call(eng, 'GET', `/workOrders/${WO}`)).body?.data;
  let wo = await load();
  results.setup = { wo: WO, ref: wo.referenceId, status: wo.status, subStatus: wo.subStatus, engineer: `${wo.engineer?.id} ${wo.engineer?.firstName} ${wo.engineer?.lastName}` };
  check(`setup: WO ${WO} (#${wo.referenceId}) is ASSIGNED to "${engName}"`, wo.status === 'ASSIGNED' && wo.engineer?.id === eng.id, results.setup);

  // ---------------- engineer walk ----------------
  const step = async (name, fn) => { const r = await fn(); results.walk.push({ step: name, status: r.status, body: JSON.stringify(r.body).slice(0, 120) }); log(`WALK ${name} -> ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`); await new Promise((res) => setTimeout(res, 2_500)); wo = await load(); return r; };
  const task = (t) => (wo.tasks || []).find((x) => x.taskType === t);
  await step('confirm', () => call(eng, 'PATCH', `/workOrders/${WO}/subStatus`, { subStatus: 'CONFIRMED' }));
  const now = new Date(); const day = now.toISOString().slice(0, 10); const hm = now.toISOString().slice(11, 16);
  await step('schedule now (TD)', () => call(td, 'PATCH', `/workOrders/${WO}`, { orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' }));
  eng = await relogin(eng);
  await step('re-confirm', () => call(eng, 'PATCH', `/workOrders/${WO}/subStatus`, { subStatus: 'CONFIRMED' }));
  for (const [t, body] of [['START_TIME', { isCompleted: true, text: new Date().toISOString() }], ['ON_THE_WAY', { isCompleted: true, text: new Date().toISOString() }], ['RUNNING_LATE', { isCompleted: true, text: 'TD-146 traffic', reason: 'TD-146 traffic' }]]) {
    const tk = task(t); if (tk?.completedTask?.id && !tk.completedTask.isCompleted) await step(`task ${t}`, () => call(eng, 'PATCH', `/tasks/${tk.completedTask.id}`, body));
  }
  const lat = 31.5203696, lng = 74.3587473;
  await step('checkIn', () => call(eng, 'POST', '/timeLogs/checkIn', { workOrderId: WO, checkInLatitude: lat, checkInLongitude: lng, taskId: task('CHECK_IN')?.completedTask?.id, checkInTimeZone: 'UTC' }));
  await step('checkOut', () => call(eng, 'POST', '/timeLogs/checkOut', { workOrderId: WO, checkOutLatitude: lat, checkOutLongitude: lng, taskId: task('CHECK_OUT')?.completedTask?.id, checkOutTimeZone: 'UTC' }));
  await step('markComplete', () => call(eng, 'PATCH', `/tasks/${task('MARK_COMPLETE')?.completedTask?.id}`, { isCompleted: true, text: 'TD-146 complete' }));
  check('walk: every engineer action succeeded (confirm, ready to go, on the way, running late, check-in, check-out, complete)', results.walk.every((w) => w.status < 300), results.walk.filter((w) => w.status >= 300));
  check('walk: work order reached WORKDONE', wo.status === 'WORKDONE', { status: wo.status });
  await new Promise((res) => setTimeout(res, 5_000));

  // ---------------- notifications ----------------
  td = await relogin(td); cust = await relogin(cust); eng = await relogin(eng);
  const first = (engName.split(' ')[0] || '').toLowerCase();
  const nameRe = new RegExp(engName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  for (const [label, s] of [['Tech Domain user', td], ['customer owner', cust], ['engineer', eng]]) {
    const n = await call(s, 'GET', `/notifications/others?userId=${s.id}&limit=60`);
    const rows = (n.body?.data?.data || n.body?.data || []).filter((r) => r.createdAt > t0 && (String(r.title).includes(String(wo.referenceId)) || r.workOrderId === WO));
    const engRows = rows.filter((r) => ENGINEER_TYPES.test(r.type) || /engineer/i.test(r.title + ' ' + plain(r.content)));
    results.notifications[label] = rows.map((r) => ({ type: r.type, title: r.title, content: plain(r.content), hasName: nameRe.test(r.title + ' ' + plain(r.content)), generic: /\bengineer\b/i.test(r.title + ' ' + plain(r.content)) }));
    log(`${label}: ${rows.length} notifications for WO-${wo.referenceId}, ${engRows.length} engineer-related`);
    for (const r of results.notifications[label]) log(`   ${r.type} | ${r.title} | ${r.content.slice(0, 90)} | name=${r.hasName}`);
    if (label === 'engineer') { info('engineer\'s own notifications (not in scope)', results.notifications[label]); continue; }
    check(`${label}: received the engineer-related notifications of the walk`, engRows.length >= 5, { count: engRows.length, types: engRows.map((r) => r.type) });
    for (const r of engRows) check(`${label}: "${r.title}" names the engineer "${engName}"`, nameRe.test(r.title + ' ' + plain(r.content)), { title: r.title, content: plain(r.content) });
  }

  // ---------------- UI: customer bell panel ----------------
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  await page.goto('/login'); await page.waitForTimeout(2_000);
  await page.locator('input[type="email"], input[name="email"]').first().fill(cust.email); await page.locator('input[type="password"]').first().fill(cust.account.password);
  await page.locator('button[type="submit"]').first().click(); await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 }); await page.waitForTimeout(5_000);
  const before = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await page.locator('i[class*="fa-bell"]').first().click(); await page.waitForTimeout(3_000);
  const after = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const panel = after.length > before.length ? after.slice(after.indexOf('Notifications')) : after; // the bell panel is plain DOM, not a MUI popover
  await shot(page, 'customer-bell-panel');
  info('UI: customer bell panel text', { text: panel.slice(0, 600) });
  check('UI: customer bell panel shows the engineer name on the engineer notifications', nameRe.test(panel) && new RegExp(String(wo.referenceId)).test(panel), { hasName: nameRe.test(panel), hasWo: new RegExp(String(wo.referenceId)).test(panel), hasGenericEngineer: /engineer/i.test(panel) });
  await ctx.close();

  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  for (const c of results.checks) if (!c.ok) results.findings.push(c.name);
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.length}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
