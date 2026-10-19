// TD-167: "Customer should only receive notifications for sub-statuses that are visible to the customer"  (Feature, Backend)
// https://techdomain.atlassian.net/browse/TD-167
//
// Expected:
//   * the customer is notified only when the work order moves to a sub-status the customer can see on their side;
//   * for sub-statuses hidden from the customer (internal ones) no notification is sent to the customer;
//   * the notification text matches the sub-status the customer actually sees.
//
// Flow (API): customer owner 638 creates a WO (entity 104) -> Tech Domain 27 completes + approvePublish -> routed to the
// individual engineer -> accepted -> assigned (NOT_CONFIRMED). The WO is then driven through every sub-status:
//   CONFIRMED -> READY_TO_GO -> ON_THE_WAY -> RUNNING_LATE -> CHECK_IN -> CHECK_OUT -> (WORKDONE) -> REVIEWED
//   -> (VERIFIED) PO_PENDING -> (APPROVED)
// At every step the test records (a) the sub-status Tech Domain sees, (b) the sub-status the CUSTOMER sees (API detail +
// customer listing), (c) the in-app notifications created for the customer owner, the customer sub-user and Tech Domain
// in that step. Rule under test: customer notification for the step  <=>  customer can see that sub-status.
// Status changes (WORKDONE / VERIFIED / APPROVED) are not sub-statuses and are reported as info only.
// Push notifications cannot be observed from the test; the in-app notification rows are the same backend records.
//
// Run:  npx playwright test tests/td-167-customer-substatus-notifications.spec.js --reporter=line --trace off
//       (env WO_ID=<ASSIGNED wo of engineer 575> skips the create/assign setup)
// Evidence: evidence/TD-167-CustomerSubStatusNotifications/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const td123Accounts = (() => { try { return require(path.join(__dirname, '..', 'td123-accounts.json')); } catch { return []; } })();
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-167-CustomerSubStatusNotifications', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const ENTITY_ID = 104, TEMPLATE_WO = 242, TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));

// sub-status -> label shown in the UI badge, plus the words a notification about it may use
const LABEL = { NOT_CONFIRMED: 'Not Confirmed', CONFIRMED: 'Confirmed', READY_TO_GO: 'Ready to go', ON_THE_WAY: 'On the way', RUNNING_LATE: 'Running Late', CHECK_IN: 'Checked In', CHECK_OUT: 'Checked Out', REVIEWED: 'Reviewed', PO_PENDING: 'PO Pending' };
const WORDS = {
  NOT_CONFIRMED: /not confirmed|unconfirmed/i, CONFIRMED: /confirmed/i, READY_TO_GO: /ready to go/i, ON_THE_WAY: /on the way|en route|on his way|on their way/i,
  RUNNING_LATE: /running late|delay/i, CHECK_IN: /checked[ -]?in|check[ -]?in/i, CHECK_OUT: /checked[ -]?out|check[ -]?out/i, REVIEWED: /review/i, PO_PENDING: /po pending|purchase order/i,
};
const TYPE_OF = { CONFIRMED: /CONFIRMED/, READY_TO_GO: /READY_TO_GO/, ON_THE_WAY: /ON_THE_WAY|EN_ROUTE/, RUNNING_LATE: /RUNNING_LATE/, CHECK_IN: /CHECK_IN/, CHECK_OUT: /CHECK_OUT/, REVIEWED: /REVIEW/, PO_PENDING: /PO_PENDING|PURCHASE/ };

test.setTimeout(1_500_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-167_SubStatusNotifications_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: false }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status}`);
  const s = { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), user: l.body.data || {}, id: l.body.data?.id, name: `${l.body.data?.firstName || ''} ${l.body.data?.lastName || ''}`.trim() };
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
const pick = (w) => w && ({ status: w.status, subStatus: w.subStatus, customerStatus: w.customerStatus, customerSubStatus: w.customerSubStatus });

function customerWoPayload(title, day) { return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'TD-167 QA automation (customer sub-status notifications)', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5, nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }
function clientFixPayload(t, title, addressId, day, hm) { return { templateId: null, title, serviceLevelAgreeement: t.serviceLevelAgreeement || '', clientId: ENTITY_ID, projectId: t.project?.id || null, teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'TD-167 QA automation', confidentialInformation: '', categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })), scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm}:00`, orderEndDate: null, orderEndTime: null, timeZone: 'UTC', addressId, qualificationSubTypes: (t.qualificationSubTypes || []).map((q) => q.id), expenses: [], paymentType: 'HOURLY', paymentTerms: t.paymentTerms || '15 days', currency: t.currency || 'USD', hourlyRate: t.hourlyRate || 20, minimumHours: t.minimumHours || 4, nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }

async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(3_000);
}

test('TD-167: customer is notified only for sub-statuses visible to the customer', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, workOrderId: 0, setup: {}, steps: [], checks: [], findings: [], rawNotificationSample: null };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 600)}`); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const engAcc = accounts.find((a) => a.role === 'Individual Engineer');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const subAcc = td123Accounts.find((a) => a.role === 'Customer Sub-user');
  const td = await apiLogin(tdAcc, 'Tech Domain');
  const eng = await apiLogin(engAcc, 'Engineer');
  const cust = await apiLogin(custAcc, 'Customer owner');
  const sub = subAcc ? await apiLogin(subAcc, 'Customer sub-user') : null;
  log(`Tech Domain ${td.id} "${td.name}", engineer ${eng.id} "${eng.name}", customer owner ${cust.id} "${cust.name}", customer sub-user ${sub?.id || '-'}`);

  // ---------------- setup: customer WO assigned to the engineer ----------------
  let WO = Number(process.env.WO_ID || 0);
  const minute = Math.floor(Date.now() / 60_000);
  // far-future slot (the shared engineer has many assignments): avoids 409 Schedule Conflict on route/assign
  const slot = new Date(Date.now() + (160 + (minute % 60)) * 86_400_000); slot.setUTCHours(2 + (minute % 12), 0, 0, 0);
  const slotDay = slot.toISOString().slice(0, 10), slotHm = slot.toISOString().slice(11, 16);
  if (!WO) {
    const title = `TD-167 sub-status notifications ${RUN}`;
    const cr = await postJson(cust, '/workOrders', customerWoPayload(title, slotDay));
    WO = cr.body?.data?.id || cr.body?.id;
    if (!WO) { const list = await getJson(cust, `/workOrders/customer?page=1&limit=5&search=${encodeURIComponent(title)}`); WO = (list.body?.data?.workOrders || list.body?.data?.data || list.body?.data || [])[0]?.id; }
    log(`customer POST /workOrders -> ${cr.status}; new WO id ${WO}`);
    expect(WO, 'customer WO created').toBeTruthy();
    const woFull = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    const template = (await getJson(td, `/workOrders/${TEMPLATE_WO}`)).body?.data || {};
    const fix = await patchJson(td, `/workOrders/${WO}`, clientFixPayload(template, woFull.title, woFull.address?.id || woFull.addressId, slotDay, slotHm));
    const ap = await postJson(td, `/workOrders/${WO}/approvePublish`, {});
    log(`TD PATCH fix -> ${fix.status}; approvePublish -> ${ap.status} ${JSON.stringify(ap.body).slice(0, 120)}`);
    expect(ap.status, 'approvePublish').toBeLessThan(300);
    const route = await postJson(td, '/offers/route', { workOrderId: WO, userIds: [eng.id] });
    const offerId = (route.body?.data || [])[0]?.id || route.body?.data?.id;
    const acc = await postJson(eng, `/offers/route/accept/${offerId}`, {});
    const asg = await postJson(td, '/offers/assign', { workOrderId: WO, userId: eng.id });
    log(`route -> ${route.status} offer ${offerId} ${JSON.stringify(route.body).slice(0, 120)}; accept -> ${acc.status}; assign -> ${asg.status} ${JSON.stringify(asg.body).slice(0, 120)}`);
    expect(asg.status, 'assign').toBeLessThan(300);
    await sleep(3_000);
  }
  results.workOrderId = WO;
  let wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
  const REF = wo.referenceId;
  results.setup = { wo: WO, ref: REF, status: wo.status, subStatus: wo.subStatus, engineer: `${wo.engineer?.id} ${wo.engineer?.firstName} ${wo.engineer?.lastName}`, slot: `${slotDay} ${slotHm} UTC` };
  check(`setup: WO ${WO} (#${REF}) is ASSIGNED to engineer ${eng.id} "${eng.name}"`, wo.status === 'ASSIGNED' && (wo.engineerId || wo.engineer?.id) === eng.id, results.setup);
  const tasks = wo.tasks || [];
  const taskId = (type) => tasks.find((t) => t.taskType === type)?.completedTask?.id;
  const lat = wo.address?.latitude || 31.5203696, lng = wo.address?.longitude || 74.3587473;

  // schedule -> now so that check-in is allowed (this resets the sub-status to NOT_CONFIRMED on dev)
  const now = new Date(Date.now() - 5 * 60_000); const nowDay = now.toISOString().slice(0, 10), nowHm = now.toISOString().slice(11, 16);
  const sch = await patchJson(td, `/workOrders/${WO}`, { orderStartDate: `${nowDay}T00:00:00`, orderStartTime: `${nowDay}T${nowHm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' });
  log(`schedule -> now (${nowDay} ${nowHm} UTC) -> ${sch.status} ${JSON.stringify(sch.body).slice(0, 100)}`);
  await sleep(3_000);

  // ---------------- notification readers ----------------
  const viewers = [{ key: 'customer', who: 'customer owner', s: cust }, ...(sub ? [{ key: 'subuser', who: 'customer sub-user', s: sub }] : []), { key: 'techdomain', who: 'Tech Domain', s: td }];
  const seen = {}; // viewer key -> Set of notification ids already attributed to an earlier step
  async function readNew(v) {
    const n = await getJson(v.s, `/notifications/others?userId=${v.s.id}&limit=60`);
    const all = n.body?.data?.data || n.body?.data?.notifications || n.body?.data || [];
    if (!results.rawNotificationSample && Array.isArray(all) && all.length) results.rawNotificationSample = all[0];
    const rows = (Array.isArray(all) ? all : []).filter((r) => (String(r.title).includes(String(REF)) || r.workOrderId === WO || String(plain(r.content)).includes(String(REF))));
    const s = seen[v.key] || (seen[v.key] = new Set());
    const fresh = rows.filter((r) => !s.has(r.id));
    for (const r of fresh) s.add(r.id);
    return { status: n.status, fresh: fresh.map((r) => ({ id: r.id, type: r.type, title: r.title, content: plain(r.content), createdAt: r.createdAt, isRead: r.isRead })) };
  }
  // baseline: everything created by the setup (assigned, schedule change) is consumed so later steps only see new rows
  const baseline = {};
  for (const v of viewers) { baseline[v.key] = (await readNew(v)).fresh; log(`baseline ${v.who}: ${baseline[v.key].length} notifications for WO-${REF}: ${baseline[v.key].map((r) => `${r.type}|${r.title}`).join(' ; ')}`); }
  results.baseline = baseline;

  // the customer-side view of the sub-status: detail + listing
  async function customerView(v) {
    const cd = await getJson(v.s, `/workOrders/${WO}`);
    const cl = await getJson(v.s, `/workOrders/customer?page=1&limit=50&search=${REF}`);
    const rows = cl.body?.data?.workOrders || cl.body?.data?.data || cl.body?.data || [];
    const row = (Array.isArray(rows) ? rows : []).find((r) => r.id === WO);
    return { detail: pick(cd.body?.data), list: pick(row), detailStatus: cd.status, listStatus: cl.status };
  }

  // ---------------- checkpoint ----------------
  async function checkpoint(name, { sub: expectSub, status: expectStatus, kind }) {
    await sleep(5_000);
    const step = { step: name, kind, notifications: {} };
    results.steps.push(step);
    step.techDomainApi = pick((await getJson(td, `/workOrders/${WO}`)).body?.data);
    if (expectSub !== undefined) check(`[${name}] Tech Domain API subStatus is ${expectSub}`, step.techDomainApi?.subStatus === expectSub, step.techDomainApi);
    if (expectStatus) check(`[${name}] status is ${expectStatus}`, step.techDomainApi?.status === expectStatus, step.techDomainApi);
    const subStatus = step.techDomainApi?.subStatus;
    step.customerView = await customerView({ s: cust });
    for (const v of viewers) step.notifications[v.key] = (await readNew(v)).fresh;
    const cv = step.customerView;
    const visible = !!subStatus && (cv.detail?.customerSubStatus === subStatus || cv.detail?.subStatus === subStatus || cv.list?.customerSubStatus === subStatus || cv.list?.subStatus === subStatus);
    step.customerSeesSubStatus = visible;
    log(`[${name}] TD ${JSON.stringify(step.techDomainApi)} | customer detail ${JSON.stringify(cv.detail)} list ${JSON.stringify(cv.list)} | visible=${visible}`);
    for (const v of viewers) log(`[${name}] ${v.who}: ${step.notifications[v.key].length} new -> ${step.notifications[v.key].map((r) => `${r.type} | ${r.title} | ${r.content.slice(0, 80)}`).join(' ;; ') || '-'}`);

    if (kind !== 'substatus') { info(`[${name}] status change (not a sub-status): customer owner got ${step.notifications.customer.length} notification(s)`, step.notifications.customer.map((r) => `${r.title}: ${r.content.slice(0, 80)}`)); return step; }
    const label = LABEL[subStatus] || subStatus;
    const isAbout = (r) => (TYPE_OF[subStatus] && TYPE_OF[subStatus].test(String(r.type))) || WORDS[subStatus].test(r.title + ' ' + r.content);
    const custRows = step.notifications.customer;
    const about = custRows.filter(isAbout);
    step.rule = { subStatus, label, customerSees: visible, customerNotified: custRows.length > 0, customerNotifiedAboutSubStatus: about.length > 0 };
    if (visible) {
      check(`[${name}] customer sees "${label}" -> customer owner IS notified`, custRows.length > 0, { customerView: cv.detail, notifications: custRows.map((r) => r.title) });
      if (custRows.length) check(`[${name}] notification text matches the sub-status the customer sees ("${label}")`, about.length > 0, custRows.map((r) => `${r.title}: ${r.content}`));
    } else {
      check(`[${name}] customer does NOT see sub-status ${subStatus} (customer API: ${JSON.stringify(cv.detail)}) -> customer owner gets NO notification`, custRows.length === 0, custRows.map((r) => `${r.type} | ${r.title}: ${r.content.slice(0, 100)}`));
    }
    info(`[${name}] Tech Domain (control) got ${step.notifications.techdomain.length}; sub-user got ${(step.notifications.subuser || []).length}`, { techdomain: step.notifications.techdomain.map((r) => r.title), subuser: (step.notifications.subuser || []).map((r) => r.title) });
    return step;
  }
  const act = async (name, fn) => { try { const r = await fn(); log(`${name} -> HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); results.steps.push({ action: name, status: r.status }); return r; } catch (e) { log(`${name} threw ${e.message.slice(0, 200)}`); return { status: 0 }; } };

  // UI evidence: the customer's bell panel + WO detail page
  async function customerUi(name) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
    try {
      await uiLogin(page, custAcc);
      await page.goto(`/workOrder/details/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
      const detail = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const detailShot = await shot(page, `${name}-customer-detail`);
      await page.goto('/'); await page.waitForTimeout(4_000);
      await page.locator('i[class*="fa-bell"]').first().click().catch(() => { }); await page.waitForTimeout(3_000);
      const panel = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const bellShot = await shot(page, `${name}-customer-bell`);
      const out = { detailShot, bellShot, detailTop: detail.slice(0, 500), bell: panel.slice(panel.indexOf('Notifications') >= 0 ? panel.indexOf('Notifications') : 0, (panel.indexOf('Notifications') >= 0 ? panel.indexOf('Notifications') : 0) + 900) };
      info(`UI ${name}: customer detail + bell panel captured`, { detailShot, bellShot });
      return out;
    } finally { await ctx.close(); }
  }

  // ---------------- the walk ----------------
  const s0 = await checkpoint('NOT_CONFIRMED', { sub: 'NOT_CONFIRMED', status: 'ASSIGNED', kind: 'substatus' });
  await act('engineer confirm', () => patchJson(eng, `/workOrders/${WO}/subStatus`, { subStatus: 'CONFIRMED' }));
  await checkpoint('CONFIRMED', { sub: 'CONFIRMED', kind: 'substatus' });
  await act('START_TIME task (ready to go)', () => patchJson(eng, `/tasks/${taskId('START_TIME')}`, { isCompleted: true, text: new Date().toISOString() }));
  await checkpoint('READY_TO_GO', { sub: 'READY_TO_GO', kind: 'substatus' });
  await act('ON_THE_WAY task', () => patchJson(eng, `/tasks/${taskId('ON_THE_WAY')}`, { isCompleted: true, text: new Date().toISOString() }));
  await checkpoint('ON_THE_WAY', { sub: 'ON_THE_WAY', kind: 'substatus' });
  await act('RUNNING_LATE task', () => patchJson(eng, `/tasks/${taskId('RUNNING_LATE')}`, { isCompleted: true, text: 'TD-167 traffic', reason: 'TD-167 traffic' }));
  await checkpoint('RUNNING_LATE', { sub: 'RUNNING_LATE', kind: 'substatus' });
  await act('checkIn', () => postJson(eng, '/timeLogs/checkIn', { workOrderId: WO, checkInLatitude: lat, checkInLongitude: lng, taskId: taskId('CHECK_IN'), checkInTimeZone: 'UTC' }));
  await checkpoint('CHECK_IN', { sub: 'CHECK_IN', status: 'INPROGRESS', kind: 'substatus' });
  await act('checkOut', () => postJson(eng, '/timeLogs/checkOut', { workOrderId: WO, checkOutLatitude: lat, checkOutLongitude: lng, taskId: taskId('CHECK_OUT'), checkOutTimeZone: 'UTC' }));
  const sCO = await checkpoint('CHECK_OUT', { sub: 'CHECK_OUT', kind: 'substatus' });
  sCO.ui = await customerUi('after-technician-substatuses');

  await act('MARK_COMPLETE task (work done)', () => patchJson(eng, `/tasks/${taskId('MARK_COMPLETE')}`, { isCompleted: true, text: 'TD-167 complete' }));
  await checkpoint('WORKDONE', { status: 'WORKDONE', kind: 'status' });
  await act('Tech Domain sets REVIEWED', () => patchJson(td, `/workOrders/${WO}/subStatus`, { subStatus: 'REVIEWED' }));
  const sRev = await checkpoint('REVIEWED', { sub: 'REVIEWED', kind: 'substatus' });
  sRev.ui = await customerUi('after-reviewed');
  await act('verify', () => postJson(td, `/workOrders/${WO}/verify`, {}));
  await checkpoint('VERIFIED', { status: 'VERIFIED', kind: 'status' });
  const afterVerify = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
  if (afterVerify.subStatus !== 'PO_PENDING') await act('poPending', () => postJson(td, `/workOrders/${WO}/poPending`, {}));
  const sPo = await checkpoint('PO_PENDING', { sub: 'PO_PENDING', kind: 'substatus' });
  sPo.ui = await customerUi('after-po-pending');
  await act('approve', () => postJson(td, `/workOrders/${WO}/approve`, {}));
  await checkpoint('APPROVED', { status: 'APPROVED', kind: 'status' });

  // Tech Domain bell panel as control
  { const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
    try { await uiLogin(page, tdAcc); await page.locator('i[class*="fa-bell"]').first().click().catch(() => { }); await page.waitForTimeout(3_000); await shot(page, 'techdomain-bell-control'); } catch (e) { log(`TD bell shot failed ${e.message}`); } finally { await ctx.close(); } }

  // ---------------- summary ----------------
  const table = results.steps.filter((s) => s.step).map((s) => `${s.step.padEnd(14)} TD=${(s.techDomainApi?.status || '-') + '/' + (s.techDomainApi?.subStatus || '-')}`.padEnd(46) + ` customer sees=${s.customerView?.detail?.status || '-'}/${s.customerView?.detail?.customerSubStatus || s.customerView?.detail?.subStatus || '-'}`.padEnd(40) + ` customer notif=${s.notifications?.customer?.length ?? '-'} [${(s.notifications?.customer || []).map((r) => r.title).join(' ; ')}]  TD notif=${s.notifications?.techdomain?.length ?? '-'}`);
  const summary = table.join('\n') + '\n\n' + results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.length}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
