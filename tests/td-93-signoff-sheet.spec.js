// TD-93: "Display signoff sheet to customer on approved status"  (Frontend, hotfix)
// https://techdomain.atlassian.net/browse/TD-93
//
// Expected: on an APPROVED work order the customer (owner and sub-user) sees the "Job Sign-Off" tab on the work-order
// page and the sign-off sheet content (customer name / designation / comment, signatures, physical sheet). The web
// app's tab config (main bundle) lists "Job Sign-Off" for roles CLIENT/FREELANCER/CUSTOMER with statuses
// WORKDONE, VERIFIED, APPROVED, INVOICED, DISPUTED, PAID, and hides it for CUSTOMER while the status is WORKDONE.
//
// Part 1 (WO_ID, default 976 = APPROVED customer work order with a full sheet uploaded by engineer 575):
//   customer owner, customer sub-user and Tech Domain owner: tab present + sheet page content + screenshots.
// Part 2 (unless SKIP_WALK=1): a fresh customer work order is created, assigned to engineer 575 and walked to
//   WORKDONE (sheet uploaded by the engineer) -> VERIFIED -> APPROVED; the customer owner view is checked at each
//   status (WORKDONE = tab expected hidden for the customer, VERIFIED/APPROVED = visible), the sub-user at APPROVED.
//
// Run:  npx playwright test tests/td-93-signoff-sheet.spec.js
//       WO_ID=976 SKIP_WALK=1 npx playwright test tests/td-93-signoff-sheet.spec.js
// Evidence: evidence/TD-93-SignOffSheet/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const td123Accounts = (() => { try { return require(path.join(__dirname, '..', 'td123-accounts.json')); } catch { return []; } })();
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-93-SignOffSheet', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const WO_ID = Number(process.env.WO_ID || 976);
const SKIP_WALK = !!process.env.SKIP_WALK;
const ENTITY_ID = 104;
const TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce', TEMPLATE_WO = Number(process.env.TEMPLATE_WO || 242);
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const SHEET = { clientName: 'QA Customer Signer', clientDesignation: 'Site Manager', clientComment: 'TD-93 QA client comment', engineerComment: 'TD-93 QA engineer comment' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

test.setTimeout(1_200_000);

let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-93_SignOff_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status}`);
  const s = { label, account, token: l.body.accessToken, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), user: l.body.data || {}, id: l.body.data?.id };
  s.relogin = async () => { const n = await rawLogin(account.email, account.password); if (!n.body.accessToken) return false; s.token = n.body.accessToken; s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${n.body.accessToken}` } }); return true; };
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

// engineer uploads the sign-off sheet (multipart, same fields as the web form)
async function uploadSheet(eng, woId, clientId) {
  const r = await eng.api.post(u('/workOrders/signOffSheet'), { multipart: {
    workOrderId: String(woId), clientId: String(clientId), engineerId: String(eng.id), ...SHEET,
    clientSignatureFile: { name: 'client-signature.png', mimeType: 'image/png', buffer: PNG },
    engineerSignatureFile: { name: 'engineer-signature.png', mimeType: 'image/png', buffer: PNG },
    physicalSheetFile: { name: 'physical-sheet.png', mimeType: 'image/png', buffer: PNG },
  } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
}

function customerWoPayload(title) {
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  return {
    templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'TD-93 QA automation (sign-off sheet visible to the customer)', confidentialInformation: '',
    categoryId: null, workOrderServices: [],
    scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi',
    addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000',
    latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL',
    qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5,
    nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null,
    isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [],
  };
}
function clientWoPayload(t, title, addressId) {
  const start = new Date(Date.now() + 3 * 86_400_000); start.setHours(10, 0, 0, 0);
  const day = start.toISOString().slice(0, 10);
  return {
    templateId: null, title, serviceLevelAgreeement: t.serviceLevelAgreeement || '', clientId: ENTITY_ID,
    projectId: t.project?.id || null, teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3',
    isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '',
    description: 'TD-93 QA automation (sign-off sheet visible to the customer)', confidentialInformation: '',
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

async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
}

// one viewer's look at the work order: tab list on the details page, then the sign-off sheet page
async function signOffView(browser, acc, woId, isCustomer, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(15_000);
  await uiLogin(page, acc);
  const q = isCustomer ? '?fromCustomerBoard=true' : '';
  await page.goto(`/workOrder/details/${woId}${q}`);
  await page.waitForTimeout(5_000);
  const tabs = (await page.locator('[role="tab"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const detailsShot = await shot(page, `${tag}-details-tabs`);
  const tabPresent = tabs.some((t) => /job sign-?off/i.test(t));
  if (tabPresent) {
    await page.locator('[role="tab"]', { hasText: /job sign-?off/i }).first().click().catch(() => { });
    await page.waitForTimeout(4_000);
    // the MUI tab click occasionally does not navigate (header re-render); fall back to the tab's URL
    if (!/signoffSheet/i.test(page.url())) await page.goto(`/workOrder/signoffSheet/${woId}${q}`);
  } else await page.goto(`/workOrder/signoffSheet/${woId}${q}`);
  await page.waitForTimeout(5_000);
  // the sheet renders name / designation / comments in (disabled) inputs and textareas, so their values are added to the text
  const fieldValues = await page.locator('input, textarea').evaluateAll((els) => els.map((e) => e.value || '').filter(Boolean).join(' ')).catch(() => '');
  const text = ((await page.locator('body').innerText().catch(() => '')) + ' ' + fieldValues).replace(/\s+/g, ' ');
  const imgs = await page.locator('img[src*="amazonaws"], img[src*="workOrders/"], img[src^="blob:"], img[src^="data:image"]').count();
  const sheet = { opened: /signoffSheet/i.test(page.url()), url: page.url(), text: text.slice(0, 1500), images: imgs, shot: await shot(page, `${tag}-signoff-page`) };
  await ctx.close();
  return { tabs, tabPresent, detailsShot, sheet };
}

test('TD-93: customer sees the Job Sign-Off tab and sheet on an approved work order', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 700) }); };
  const results = { run: RUN, approvedWorkOrderId: WO_ID, views: [], walk: null, findings: [] };
  const check = (scope, n, ok, detail) => { scope.checks.push({ name: n, ok: !!ok, detail }); log(`[${scope.step}] ${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 300) : ''}`); expect.soft(!!ok, `[${scope.step}] ${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const engAcc = accounts.find((a) => a.role === 'Individual Engineer');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const subAcc = td123Accounts.find((a) => a.role === 'Customer Sub-user');
  expect(subAcc, 'Customer Sub-user account in td123-accounts.json').toBeTruthy();
  const td = await apiLogin(tdAcc, 'TD owner');
  const eng = await apiLogin(engAcc, 'Engineer');
  const cust = await apiLogin(custAcc, 'Customer owner');
  const sub = await apiLogin(subAcc, 'Customer sub-user');

  // sheet checks shared by both parts
  const sheetChecks = (scope, who, v, expectTab) => {
    check(scope, `${who}: "Job Sign-Off" tab ${expectTab ? 'present' : 'hidden'} on the work-order page`, v.tabPresent === expectTab, { tabs: v.tabs, shot: v.detailsShot });
    if (!expectTab) return;
    check(scope, `${who}: sign-off page opens`, v.sheet.opened, { url: v.sheet.url });
    check(scope, `${who}: sheet shows "Customer Sign-Off" section`, /customer sign-?off/i.test(v.sheet.text), { shot: v.sheet.shot });
    check(scope, `${who}: sheet shows customer name "${SHEET.clientName}"`, v.sheet.text.includes(SHEET.clientName), { shot: v.sheet.shot });
    check(scope, `${who}: sheet shows designation "${SHEET.clientDesignation}"`, v.sheet.text.includes(SHEET.clientDesignation), { shot: v.sheet.shot });
    check(scope, `${who}: sheet shows customer comment`, v.sheet.text.includes(SHEET.clientComment), { shot: v.sheet.shot });
    check(scope, `${who}: at least one signature/sheet image rendered`, v.sheet.images >= 1, { images: v.sheet.images, shot: v.sheet.shot });
  };

  // ---------------- Part 1: APPROVED work order with a sheet
  {
    const scope = { step: `APPROVED WO ${WO_ID}`, checks: [] }; results.views.push(scope);
    let wo = (await getJson(td, `/workOrders/${WO_ID}`)).body?.data || {};
    log(`WO ${WO_ID} ref=${wo.referenceId} status=${wo.status}/${wo.subStatus} sheet=${JSON.stringify(wo.signOffSheet || {}).slice(0, 200)}`);
    expect(wo.status, 'WO_ID must be APPROVED').toBe('APPROVED');
    if (!wo.signOffSheet?.clientName) {
      const up = await uploadSheet(eng, WO_ID, cust.id);
      log(`upload sheet -> HTTP ${up.status} ${JSON.stringify(up.body).slice(0, 200)}`);
      wo = (await getJson(td, `/workOrders/${WO_ID}`)).body?.data || {};
    }
    const custApi = (await getJson(cust, `/workOrders/${WO_ID}`)).body?.data?.signOffSheet || {};
    const subApi = (await getJson(sub, `/workOrders/${WO_ID}`)).body?.data?.signOffSheet || {};
    check(scope, 'customer owner API returns the sheet (clientName + clientSignature)', custApi.clientName === SHEET.clientName && !!custApi.clientSignature, { clientName: custApi.clientName, hasSig: !!custApi.clientSignature });
    check(scope, 'customer sub-user API returns the sheet', subApi.clientName === SHEET.clientName && !!subApi.clientSignature, { clientName: subApi.clientName, hasSig: !!subApi.clientSignature });

    const vOwner = await signOffView(browser, custAcc, WO_ID, true, 'approved-customer');
    sheetChecks(scope, 'customer owner', vOwner, true);
    const vSub = await signOffView(browser, subAcc, WO_ID, true, 'approved-subuser');
    sheetChecks(scope, 'customer sub-user', vSub, true);
    const vTd = await signOffView(browser, tdAcc, WO_ID, false, 'approved-techdomain');
    sheetChecks(scope, 'Tech Domain owner (control)', vTd, true);
    scope.views = { owner: vOwner, subUser: vSub, techDomain: vTd };
  }

  // ---------------- Part 2: status coverage on a fresh work order (WORKDONE -> VERIFIED -> APPROVED)
  if (!SKIP_WALK) {
    const act = async (name, fn) => { try { const r = await fn(); log(`${name} -> HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`); return r; } catch (e) { log(`${name} threw ${e.message.slice(0, 200)}`); return { status: 0 }; } };
    let wid = Number(process.env.WALK_WO || 0); // WALK_WO=<id>: resume on a WORKDONE work order that already has the sheet
    if (!wid) {
    const cr = await postJson(cust, '/workOrders', customerWoPayload(`TD-93 sign-off sheet ${RUN}`));
    wid = cr.body?.data?.id || cr.body?.id;
    log(`created customer work order -> HTTP ${cr.status} id=${wid}`);
    expect(wid, 'customer owner can create a work order').toBeTruthy();
    }
    results.walk = { workOrderId: wid, steps: [] };
    if (process.env.WALK_WO) {
      const w0 = (await getJson(td, `/workOrders/${wid}`)).body?.data || {};
      log(`resuming on WO ${wid}: ${w0.status}/${w0.subStatus} sheet=${w0.signOffSheet?.clientName || '-'}`);
      expect(w0.status, 'WALK_WO must be WORKDONE').toBe('WORKDONE');
      if (!w0.signOffSheet?.clientName) { const up = await uploadSheet(eng, wid, cust.id); log(`engineer uploads sign-off sheet -> HTTP ${up.status}`); }
    } else {
    const woFull = (await getJson(td, `/workOrders/${wid}`)).body?.data || {};
    const template = (await getJson(td, `/workOrders/${TEMPLATE_WO}`)).body?.data || {};
    const fix = await patchJson(td, `/workOrders/${wid}`, clientWoPayload(template, woFull.title, woFull.address?.id || woFull.addressId));
    const ap = await postJson(td, `/workOrders/${wid}/approvePublish`, {});
    log(`PATCH client fields ${fix.status} | approvePublish ${ap.status} ${JSON.stringify(ap.body).slice(0, 120)}`);
    const minute = Math.floor(Date.now() / 60_000);
    const slot = new Date(Date.now() + (150 + (minute % 60)) * 86_400_000); slot.setUTCHours(3 + (minute % 10), 0, 0, 0);
    const d = slot.toISOString().slice(0, 10), hm = slot.toISOString().slice(11, 16);
    await patchJson(td, `/workOrders/${wid}`, { orderStartDate: `${d}T00:00:00`, orderStartTime: `${d}T${hm}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' });
    const rq = await postJson(eng, '/offers/engineer/request', { workOrderId: wid });
    await patchJson(eng, '/offers/engineer/counter', { workOrderId: wid, hourlyRate: 50, minimumHours: 5, additionalHourlyRate: 55, expenses: [], currency: 'USD' });
    const offerId = rq.body?.id || rq.body?.data?.id;
    const ac = offerId ? await postJson(td, `/offers/counter/accept/${offerId}`, {}) : { status: 0 };
    await sleep(2_000);
    const wo = (await getJson(td, `/workOrders/${wid}`)).body?.data || {};
    log(`assign: request ${rq.status} accept ${ac.status} -> WO ${wo.status}/${wo.subStatus} engineer=${wo.engineerId || wo.engineer?.id}`);
    expect(wo.status, 'walk work order must be ASSIGNED').toBe('ASSIGNED');
    const tasks = wo.tasks || []; const taskId = (type) => tasks.find((t) => t.taskType === type)?.completedTask?.id;
    const lat = wo.address?.latitude || 31.5203696, lng = wo.address?.longitude || 74.3587473;
    await act('confirm', () => patchJson(td, `/workOrders/${wid}/subStatus`, { subStatus: 'CONFIRMED' }));
    await act('START_TIME', () => patchJson(eng, `/tasks/${taskId('START_TIME')}`, { isCompleted: true, text: 'ready' }));
    await act('ON_THE_WAY', () => patchJson(eng, `/tasks/${taskId('ON_THE_WAY')}`, { isCompleted: true, text: 'on the way' }));
    const now = new Date(Date.now() - 10 * 60_000); const day = now.toISOString().slice(0, 10), hm2 = now.toISOString().slice(11, 16);
    await act('schedule -> now', () => patchJson(td, `/workOrders/${wid}`, { orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm2}:00`, scheduleType: 'HARD_START', timeZone: 'UTC' }));
    await act('checkIn', () => postJson(eng, '/timeLogs/checkIn', { workOrderId: wid, checkInLatitude: lat, checkInLongitude: lng, taskId: taskId('CHECK_IN'), checkInTimeZone: 'UTC' }));
    await act('checkOut', () => postJson(eng, '/timeLogs/checkOut', { workOrderId: wid, checkOutLatitude: lat, checkOutLongitude: lng, taskId: taskId('CHECK_OUT'), checkOutTimeZone: 'UTC' }));
    const up = await uploadSheet(eng, wid, cust.id); log(`engineer uploads sign-off sheet -> HTTP ${up.status} ${JSON.stringify(up.body).slice(0, 120)}`);
    await act('MARK_COMPLETE', () => patchJson(eng, `/tasks/${taskId('MARK_COMPLETE')}`, { isCompleted: true, text: 'TD-93 QA complete' }));
    } // end of create + walk to WORKDONE

    const walkStep = async (status, expectCustomerTab, withSub) => {
      await sleep(1_500);
      const w = (await getJson(td, `/workOrders/${wid}`)).body?.data || {};
      const scope = { step: `${status} WO ${wid}`, checks: [], status: w.status, subStatus: w.subStatus }; results.walk.steps.push(scope);
      check(scope, `status is ${status}`, w.status === status, { status: w.status, subStatus: w.subStatus });
      const vOwner = await signOffView(browser, custAcc, wid, true, `${status.toLowerCase()}-customer`);
      sheetChecks(scope, 'customer owner', vOwner, expectCustomerTab);
      scope.views = { owner: vOwner };
      if (!expectCustomerTab) {
        // informational: what the customer gets when opening the sign-off URL directly
        scope.directUrl = { url: vOwner.sheet.url, showsSheet: vOwner.sheet.text.includes(SHEET.clientName) };
        log(`[${scope.step}] INFO direct /signoffSheet URL for the customer -> ${vOwner.sheet.url} showsSheet=${scope.directUrl.showsSheet}`);
      }
      if (withSub) { const vSub = await signOffView(browser, subAcc, wid, true, `${status.toLowerCase()}-subuser`); sheetChecks(scope, 'customer sub-user', vSub, expectCustomerTab); scope.views.subUser = vSub; }
      const vTd = await signOffView(browser, tdAcc, wid, false, `${status.toLowerCase()}-techdomain`);
      sheetChecks(scope, 'Tech Domain owner (control)', vTd, true);
      scope.views.techDomain = vTd;
    };
    await walkStep('WORKDONE', false, false); // the web app hides the tab from CUSTOMER at WORKDONE
    await act('REVIEWED', () => patchJson(td, `/workOrders/${wid}/subStatus`, { subStatus: 'REVIEWED' })); // verify needs the review first
    await act('verify', () => postJson(td, `/workOrders/${wid}/verify`, {}));
    await walkStep('VERIFIED', true, false);
    await act('approve', () => postJson(td, `/workOrders/${wid}/approve`, {}));
    await walkStep('APPROVED', true, true);
  }

  const all = [...results.views, ...(results.walk?.steps || [])];
  const summary = all.map((s) => { const f = s.checks.filter((c) => !c.ok); return `${s.step}: ${s.checks.length - f.length}/${s.checks.length} passed${f.length ? '  FAILED: ' + f.map((x) => x.name).join('; ') : ''}`; }).join('\n');
  for (const s of all) for (const c of s.checks) if (!c.ok) results.findings.push(`${s.step}: ${c.name}`);
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n\nFindings:\n' + (results.findings.join('\n') || 'none') + '\n');
});
