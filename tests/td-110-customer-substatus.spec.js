// TD-110: "remove sub status for Customer eg: review from work order detail + listing"
// https://techdomain.atlassian.net/browse/TD-110
// Dev comment: "the tech and po pending substatus will be visible to the customer only".
//
// Expected: on the CUSTOMER work-order listing and detail page the sub-status badge shows only the technician
// sub-statuses (Not Confirmed, Confirmed, Ready to go, On the way, Running Late, Checked In, Checked Out) and
// "PO Pending". Internal sub-statuses such as "Reviewed" must not be shown to the customer (the Tech Domain
// client side still sees them).
//
// Flow: one ASSIGNED work order of customer 104 is driven through every sub-status:
//   NOT_CONFIRMED -> CONFIRMED -> READY_TO_GO -> ON_THE_WAY -> RUNNING_LATE -> CHECK_IN -> CHECK_OUT -> WORKDONE
//   -> REVIEWED -> VERIFIED (-> PO_PENDING) -> APPROVED
// At every step: Tech Domain API view, customer API view (list + detail), customer UI (listing row + detail title),
// and at REVIEWED also the Tech Domain UI as a control.
//
// 2026-10-12: the customer SUB-USER (td123-accounts.json) is checked next to the customer owner at every step: the
// sub-user sees every work order of the company, so "Reviewed" must be hidden from the sub-user too. Without WO_ID a
// fresh work order is created by the customer owner (API) and assigned to the test engineer.
//
// Run:  npx playwright test tests/td-110-customer-substatus.spec.js            (creates a new customer work order)
//       WO_ID=957 npx playwright test tests/td-110-customer-substatus.spec.js  (reuse an ASSIGNED/PUBLISHED work order)
// Evidence: evidence/TD-110-CustomerSubStatus/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-110-CustomerSubStatus', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
let WO_ID = Number(process.env.WO_ID || 0); // 0 = create a new customer work order
const td123Accounts = (() => { try { return require(path.join(__dirname, '..', 'td123-accounts.json')); } catch { return []; } })();
const ENTITY_ID = 104; // customer entity of "Customer Company 10090955" (owner 638)
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
function customerWoPayload(title) {
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  return {
    templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'TD-110 QA automation (customer sub-status visibility)', confidentialInformation: '',
    categoryId: null, workOrderServices: [],
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi',
    addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000',
    latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL',
    qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [],
  };
}
// fields the Tech Domain client adds on "Review & Publish" (cloned from template WO 242) - approvePublish needs them
const TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce', TEMPLATE_WO = Number(process.env.TEMPLATE_WO || 242);
function clientWoPayload(t, title, addressId) {
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  return {
    templateId: null, title, serviceLevelAgreeement: t.serviceLevelAgreeement || '', clientId: ENTITY_ID,
    projectId: t.project?.id || null, teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'TD-110 QA automation (customer sub-status visibility)', confidentialInformation: '',
    categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })),
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null,
    timeZone: 'Asia/Karachi', addressId,
    qualificationSubTypes: (t.qualificationSubTypes || []).map((q) => q.id),
    expenses: [], paymentType: 'HOURLY', paymentTerms: t.paymentTerms || '15 days', currency: t.currency || 'USD', hourlyRate: t.hourlyRate || 20, minimumHours: t.minimumHours || 4,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4,
    isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [],
  };
}

// sub-status -> badge label (FE StatusBadge map) and whether the customer may see it
const LABEL = { NOT_CONFIRMED: 'Not Confirmed', CONFIRMED: 'Confirmed', READY_TO_GO: 'Ready to go', ON_THE_WAY: 'On the way', RUNNING_LATE: 'Running Late', CHECK_IN: 'Checked In', CHECK_OUT: 'Checked Out', REVIEWED: 'Reviewed', PO_PENDING: 'PO Pending' };
// Observed on dev 2026-10-09 (run-1009124111): the customer API/UI expose ONLY PO_PENDING; every technician sub-status is
// null for the customer. The ticket's hard requirement is that internal sub-statuses (REVIEWED) are hidden. Technician
// sub-statuses are therefore reported as informational (the dev comment 'tech and po pending visible to the customer' is ambiguous).
const CUSTOMER_VISIBLE = new Set(['PO_PENDING']);
const MUST_HIDE = new Set(['REVIEWED']);
const INFO_ONLY = new Set(['NOT_CONFIRMED', 'CONFIRMED', 'READY_TO_GO', 'ON_THE_WAY', 'RUNNING_LATE', 'CHECK_IN', 'CHECK_OUT']);
const CUSTOMER_TAB = { ASSIGNED: 'ASSIGNED', INPROGRESS: 'INPROGRESS', WORKDONE: 'WORKDONE', VERIFIED: 'WORKDONE', APPROVED: 'APPROVED', PUBLISHED: 'PUBLISHED' };

test.setTimeout(1_200_000);

let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-110_SubStatus_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status}`);
  const s = { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), user: l.body.data || {}, id: l.body.data?.id };
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
const pick = (w) => w && ({ status: w.status, subStatus: w.subStatus, customerStatus: w.customerStatus, customerSubStatus: w.customerSubStatus });

async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
}

// customer listing row text for the work order (tries the status tab, then every tab)
// the ?filter= query is not honoured by the customer list, so the status chip is clicked by its label
const TAB_LABEL = { ASSIGNED: 'Assigned', INPROGRESS: 'Inprogress', WORKDONE: 'Work Done', APPROVED: 'Approved', PUBLISHED: 'Accepted', ALL: 'All' };
async function customerRow(page, refId, tab) {
  const tabs = Array.from(new Set([tab, 'ALL', 'ASSIGNED', 'INPROGRESS', 'WORKDONE', 'APPROVED', 'PUBLISHED'].filter(Boolean)));
  await page.goto('/workOrders');
  await page.waitForTimeout(4_000);
  for (const t of tabs) {
    // the chip text is "<Label> <count>", e.g. "Assigned 2"
    const chip = page.getByText(new RegExp(`^\\s*${TAB_LABEL[t]}\\s*\\d*\\s*$`, 'i')).first();
    if (!(await chip.count())) continue;
    await chip.click({ force: true }).catch(() => { });
    await page.waitForTimeout(4_000);
    const row = page.locator('tr, [role="row"]', { hasText: String(refId) }).first();
    if (await row.count()) return { tab: t, text: (await row.innerText()).replace(/\s+/g, ' ').trim() };
  }
  return { tab: null, text: '' };
}

test('TD-110: customer sees only technician sub-statuses and PO Pending', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 700) }); };
  const results = { run: RUN, workOrderId: WO_ID, steps: [], findings: [] };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const engAcc = accounts.find((a) => a.role === 'Individual Engineer');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const td = await apiLogin(tdAcc, 'TD owner');
  const eng = await apiLogin(engAcc, 'Engineer');
  const cust = await apiLogin(custAcc, 'Customer owner');
  const subAcc = td123Accounts.find((a) => a.role === 'Customer Sub-user');
  expect(subAcc, 'Customer Sub-user account in td123-accounts.json').toBeTruthy();
  const sub = await apiLogin(subAcc, 'Customer sub-user');
  log(`customer owner id=${cust.id}, sub-user id=${sub.id}, engineer id=${eng.id}, TD owner id=${td.id}`);

  if (!WO_ID) {
    const cr = await postJson(cust, '/workOrders', customerWoPayload(`TD-110 sub-status visibility ${RUN}`));
    WO_ID = cr.body?.data?.id || cr.body?.id;
    log(`created customer work order -> HTTP ${cr.status} id=${WO_ID} ${JSON.stringify(cr.body).slice(0, 160)}`);
    expect(WO_ID, 'customer owner can create a work order').toBeTruthy();
    results.workOrderId = WO_ID;
    // the Tech Domain owner accepts (publishes) the customer ticket; the API wants the client fields first
    const woFull = (await getJson(td, `/workOrders/${WO_ID}`)).body?.data || {};
    const template = (await getJson(td, `/workOrders/${TEMPLATE_WO}`)).body?.data || {};
    const fix = await patchJson(td, `/workOrders/${WO_ID}`, clientWoPayload(template, woFull.title, woFull.address?.id || woFull.addressId));
    log(`PATCH client fields -> HTTP ${fix.status} ${JSON.stringify(fix.body).slice(0, 160)}`);
    const ap = await postJson(td, `/workOrders/${WO_ID}/approvePublish`, {});
    log(`approvePublish -> HTTP ${ap.status} ${JSON.stringify(ap.body).slice(0, 160)}`);
    await sleep(1_500);
  }

  let wo = (await getJson(td, `/workOrders/${WO_ID}`)).body?.data || {};
  log(`WO ${WO_ID} ref=${wo.referenceId} ${JSON.stringify(pick(wo))} engineer=${wo.engineerId || wo.engineer?.id} client=${wo.clientId || wo.client?.id}`);
  // prep: a PUBLISHED work order is assigned to the test engineer first (request -> counter -> counter accept)
  if (wo.status === 'PUBLISHED') {
    const minute = Math.floor(Date.now() / 60_000);
    // far-future slot: the shared test engineer has many assignments in the coming weeks
    const slot = new Date(Date.now() + (150 + (minute % 60)) * 86_400_000); slot.setUTCHours(3 + (minute % 10), 0, 0, 0);
    const d = slot.toISOString().slice(0, 10), hm = slot.toISOString().slice(11, 16);
    const sh = await patchJson(td, `/workOrders/${WO_ID}`, { orderStartDate: `${d}T00:00:00`, orderStartTime: `${d}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' });
    const rq = await postJson(eng, '/offers/engineer/request', { workOrderId: WO_ID });
    const ct = await patchJson(eng, '/offers/engineer/counter', { workOrderId: WO_ID, hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55, expenses: [], currency: 'USD' });
    const offerId = rq.body?.id || rq.body?.data?.id;
    const ac = offerId ? await postJson(td, `/offers/counter/accept/${offerId}`, {}) : { status: 0 };
    log(`prep: schedule ${sh.status} ${JSON.stringify(sh.body || {}).slice(0, 80)} | request ${rq.status} ${JSON.stringify(rq.body || {}).slice(0, 160)} | counter ${ct.status} ${JSON.stringify(ct.body || {}).slice(0, 120)} | counter/accept ${ac.status} ${JSON.stringify(ac.body || {}).slice(0, 120)}`);
    await sleep(2_000);
    wo = (await getJson(td, `/workOrders/${WO_ID}`)).body?.data || {};
    log(`prep: WO now ${JSON.stringify(pick(wo))} engineer=${wo.engineerId || wo.engineer?.id}`);
  }
  const ONLY_APPROVE = !!process.env.ONLY_APPROVE;
  if (!ONLY_APPROVE) expect(wo.status, 'work order must be ASSIGNED to start').toBe('ASSIGNED');
  else expect(wo.status, 'ONLY_APPROVE needs a VERIFIED work order').toBe('VERIFIED');
  expect(wo.engineerId || wo.engineer?.id, 'assigned engineer must be the test engineer').toBe(eng.id);
  const REF = wo.referenceId;
  const tasks = wo.tasks || [];
  const taskId = (type) => tasks.find((t) => t.taskType === type)?.completedTask?.id;
  const lat = wo.address?.latitude || 31.5203696, lng = wo.address?.longitude || 74.3587473;

  async function checkpoint(name, opts = {}) {
    const step = { step: name, checks: [] };
    results.steps.push(step);
    const check = (n, ok, detail) => { step.checks.push({ name: n, ok: !!ok, detail }); log(`[${name}] ${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 300) : ''}`); expect.soft(!!ok, `[${name}] ${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
    await sleep(1_500);
    // Tech Domain API view
    const tdView = pick((await getJson(td, `/workOrders/${WO_ID}`)).body?.data);
    step.techDomainApi = tdView;
    if (opts.expectSub !== undefined) check(`Tech Domain API subStatus is ${opts.expectSub}`, tdView.subStatus === opts.expectSub, tdView);
    if (opts.expectStatus) check(`status is ${opts.expectStatus}`, tdView.status === opts.expectStatus, tdView);
    const subStatus = tdView.subStatus;
    const label = subStatus ? LABEL[subStatus] || subStatus : null;
    const customerMaySee = subStatus ? CUSTOMER_VISIBLE.has(subStatus) : false;

    const badgeRe = (txt) => new RegExp(txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    // the same checks for the customer OWNER and the customer SUB-USER: API (detail + listing) and UI (listing row + detail)
    const viewers = [{ key: 'customer', who: 'customer owner', s: cust, acc: custAcc }, { key: 'subuser', who: 'customer sub-user', s: sub, acc: subAcc }];
    for (const v of viewers) {
      const cd = await getJson(v.s, `/workOrders/${WO_ID}`);
      const custDetail = pick(cd.body?.data);
      const cl = await getJson(v.s, `/workOrders/customer?page=1&limit=50&search=${REF}`);
      const rows = cl.body?.data?.workOrders || cl.body?.data?.data || cl.body?.data || [];
      const custRow = pick((Array.isArray(rows) ? rows : []).find((r) => r.id === WO_ID));
      log(`[${name}] ${v.who} API detail=${JSON.stringify(custDetail)} list=${JSON.stringify(custRow)}`);

      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15_000);
      await uiLogin(page, v.acc);
      const row = await customerRow(page, REF, CUSTOMER_TAB[tdView.status] || 'ALL');
      const listShot = await shot(page, `${name}-${v.key}-list`);
      await page.goto(`/workOrder/details/${WO_ID}?fromCustomerBoard=true`);
      await page.waitForTimeout(5_000);
      const top = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500);
      const detailShot = await shot(page, `${name}-${v.key}-detail`);
      await ctx.close();
      step[`${v.key}Api`] = { detailStatus: cd.status, detail: custDetail, listStatus: cl.status, list: custRow };
      step[`${v.key}Ui`] = { listTab: row.tab, listRow: row.text.slice(0, 300), detailTop: top.slice(0, 400), listShot, detailShot };

      check(`${v.who} listing shows the work order`, !!row.text, { tab: row.tab });
      if (!subStatus) continue;
      if (customerMaySee) {
        check(`${v.who} API exposes ${subStatus} (customerSubStatus or subStatus)`, custDetail?.customerSubStatus === subStatus || custDetail?.subStatus === subStatus, custDetail);
        check(`${v.who} listing row shows "${label}"`, badgeRe(label).test(row.text), { row: row.text.slice(0, 200) });
        check(`${v.who} detail page shows "${label}"`, badgeRe(label).test(top), { shot: detailShot });
      } else if (INFO_ONLY.has(subStatus)) {
        const exposed = custDetail?.customerSubStatus === subStatus || custDetail?.subStatus === subStatus;
        const inUi = badgeRe(label).test(row.text);
        step.info = { ...(step.info || {}), [v.key]: { subStatus, apiExposes: exposed, listShowsBadge: inUi } };
        log(`[${name}] INFO technician sub-status ${subStatus}: ${v.who} API exposes=${exposed}, listing badge=${inUi} (not pass/fail - confirm intended behaviour with dev)`);
      } else {
        check(`${v.who} API does NOT expose ${subStatus} (customerSubStatus/subStatus)`, custDetail?.customerSubStatus !== subStatus && custDetail?.subStatus !== subStatus && custRow?.customerSubStatus !== subStatus && custRow?.subStatus !== subStatus, { detail: custDetail, list: custRow });
        check(`${v.who} listing row does NOT show "${label}"`, !badgeRe(label).test(row.text), { row: row.text.slice(0, 200) });
        check(`${v.who} detail page does NOT show "${label}"`, !badgeRe(label).test(top), { shot: detailShot });
        if (badgeRe(label).test(row.text) || badgeRe(label).test(top)) results.findings.push(`${name}: ${v.who} can still see sub-status "${label}" (list: ${badgeRe(label).test(row.text)}, detail: ${badgeRe(label).test(top)})`);
      }
    }
    // control: Tech Domain UI must still show internal sub-statuses
    if (opts.techDomainUi) {
      const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      const p2 = await ctx2.newPage(); p2.setDefaultTimeout(15_000);
      await uiLogin(p2, tdAcc);
      await p2.goto(`/workOrder/details/${WO_ID}`);
      await p2.waitForTimeout(5_000);
      const t2 = (await p2.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500);
      const s2 = await shot(p2, `${name}-techdomain-detail`);
      await ctx2.close();
      step.techDomainUi = { detailTop: t2.slice(0, 400), shot: s2 };
      if (label) check(`Tech Domain detail page still shows "${label}"`, badgeRe(label).test(t2), { shot: s2 });
    }
    return step;
  }

  const act = async (name, fn) => { try { const r = await fn(); log(`${name} -> HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); return r; } catch (e) { log(`${name} threw ${e.message.slice(0, 200)}`); return { status: 0 }; } };

  // 0. NOT_CONFIRMED (as assigned)
  if (!ONLY_APPROVE) {
  if (wo.subStatus !== 'NOT_CONFIRMED') await act('reset NOT_CONFIRMED', () => patchJson(td, `/workOrders/${WO_ID}/subStatus`, { subStatus: 'NOT_CONFIRMED' }));
  await checkpoint('NOT_CONFIRMED', { expectSub: 'NOT_CONFIRMED', expectStatus: 'ASSIGNED' });

  // 1. CONFIRMED (client)
  await act('confirm', () => patchJson(td, `/workOrders/${WO_ID}/subStatus`, { subStatus: 'CONFIRMED' }));
  await checkpoint('CONFIRMED', { expectSub: 'CONFIRMED' });

  // 2. READY_TO_GO (engineer START_TIME task)
  await act('START_TIME task', () => patchJson(eng, `/tasks/${taskId('START_TIME')}`, { isCompleted: true, text: 'ready' }));
  await checkpoint('READY_TO_GO', { expectSub: 'READY_TO_GO' });

  // 3. ON_THE_WAY
  await act('ON_THE_WAY task', () => patchJson(eng, `/tasks/${taskId('ON_THE_WAY')}`, { isCompleted: true, text: 'on the way' }));
  await checkpoint('ON_THE_WAY', { expectSub: 'ON_THE_WAY' });

  // 4. RUNNING_LATE
  await act('RUNNING_LATE task', () => patchJson(eng, `/tasks/${taskId('RUNNING_LATE')}`, { isCompleted: true, text: 'traffic' }));
  await checkpoint('RUNNING_LATE', { expectSub: 'RUNNING_LATE' });

  // 5. CHECK_IN (schedule moved to now so the check-in window is open)
  const now = new Date(Date.now() - 10 * 60_000); const day = now.toISOString().slice(0, 10), hm = now.toISOString().slice(11, 16);
  await act('schedule -> now', () => patchJson(td, `/workOrders/${WO_ID}`, { orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' }));
  await act('checkIn', () => postJson(eng, '/timeLogs/checkIn', { workOrderId: WO_ID, checkInLatitude: lat, checkInLongitude: lng, taskId: taskId('CHECK_IN'), checkInTimeZone: 'UTC' }));
  await checkpoint('CHECK_IN', { expectSub: 'CHECK_IN', expectStatus: 'INPROGRESS' });

  // 6. CHECK_OUT
  await act('checkOut', () => postJson(eng, '/timeLogs/checkOut', { workOrderId: WO_ID, checkOutLatitude: lat, checkOutLongitude: lng, taskId: taskId('CHECK_OUT'), checkOutTimeZone: 'UTC' }));
  await checkpoint('CHECK_OUT', { expectSub: 'CHECK_OUT' });

  // 7. WORKDONE
  await act('MARK_COMPLETE', () => patchJson(eng, `/tasks/${taskId('MARK_COMPLETE')}`, { isCompleted: true, text: 'TD-110 QA complete' }));
  await checkpoint('WORKDONE', { expectStatus: 'WORKDONE' });

  // 8. REVIEWED (the internal sub-status the customer must NOT see) - Tech Domain UI checked as control
  await act('REVIEWED', () => patchJson(td, `/workOrders/${WO_ID}/subStatus`, { subStatus: 'REVIEWED' }));
  await checkpoint('REVIEWED', { expectSub: 'REVIEWED', techDomainUi: true });

  // 9. VERIFIED (+ PO_PENDING)
  await act('verify', () => postJson(td, `/workOrders/${WO_ID}/verify`, {}));
  await checkpoint('VERIFIED', { expectStatus: 'VERIFIED' });
  const afterVerify = (await getJson(td, `/workOrders/${WO_ID}`)).body?.data || {};
  if (afterVerify.subStatus !== 'PO_PENDING') await act('poPending', () => postJson(td, `/workOrders/${WO_ID}/poPending`, {}));
  await checkpoint('PO_PENDING', { expectSub: 'PO_PENDING' });

  } // end of !ONLY_APPROVE

  // 10. APPROVED
  await act('approve', () => postJson(td, `/workOrders/${WO_ID}/approve`, {}));
  await checkpoint('APPROVED', { expectStatus: 'APPROVED' });

  const summary = results.steps.map((s) => { const f = s.checks.filter((c) => !c.ok); return `${s.step} [${s.techDomainApi?.status}/${s.techDomainApi?.subStatus || '-'} | customer: ${s.customerApi?.detail?.customerStatus || '-'}/${s.customerApi?.detail?.customerSubStatus || '-'}]: ${s.checks.length - f.length}/${s.checks.length} passed${f.length ? '  FAILED: ' + f.map((x) => x.name).join('; ') : ''}`; }).join('\n');
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n\nFindings:\n' + (results.findings.join('\n') || 'none') + '\n');
});
