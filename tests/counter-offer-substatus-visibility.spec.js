// Customer-side visibility of the counter-offer (proposal) sub-status BEFORE a customer work order is published.
// User rule (2026-10-16): the counter-related sub-status must be visible to the customer (detail header + work order listing),
// the customer must get a notification for it, and as soon as the work order is published the sub-status must disappear.
//
// WO A: customer creates -> Tech Domain counters (PENDING) -> customer ACCEPTS -> Tech Domain publishes
// WO B: customer creates -> Tech Domain counters -> customer DECLINES -> Tech Domain publishes
// WO C: customer creates -> Tech Domain counters -> Tech Domain WITHDRAWS -> Tech Domain publishes
// At every step: Tech Domain GET /workOrders/:id, customer GET /workOrders/:id + GET /workOrders/customer (listing),
// customer notifications diff (GET /notifications/others), and for WO A/B UI screenshots of the customer detail header
// and the customer Work Orders listing (Submitted tab).
//
// Run:  npx playwright test tests/counter-offer-substatus-visibility.spec.js --reporter=line --trace off
// Evidence: evidence/CounterOffer-SubStatusVisibility/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'CounterOffer-SubStatusVisibility', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const ENTITY_ID = 104, TEMPLATE_WO = 242, TEAM_SD3 = '8ae534d5-d80c-49d9-8ac3-849fc63a927f', TEAM_OP3 = 'cf0ed3db-521f-4c9f-887b-d5301383f8ce';
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const COUNTER = { hourlyRate: 60, minimumHours: 4, additionalHourlyRate: 65, expenses: [{ expenseType: 'TOOLS', description: 'Ladder hire', amount: 20 }] };
const PROPOSAL_WORDS = /proposal|counter/i;

test.setTimeout(900_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `CounterOffer_SubStatus_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: false }).catch(() => { }); return path.basename(f); }
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
const pick = (w) => w && ({ status: w.status, subStatus: w.subStatus, customerStatus: w.customerStatus, customerSubStatus: w.customerSubStatus });

function customerWoPayload(title, day) { return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'QA: counter-offer sub-status visibility before publish', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [{ expenseType: 'TRAVEL', description: 'Customer travel', amount: 30 }], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5, additionalHourlyRate: 50, nonBusinessHourRate: null, purchaseOrderNumber: '', halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }
function clientFixPayload(t, title, addressId, day, hm) { return { templateId: null, title, serviceLevelAgreeement: t.serviceLevelAgreeement || '', clientId: ENTITY_ID, projectId: t.project?.id || null, teamId: TEAM_SD3, secondaryTeamId: TEAM_OP3, teamName: 'Service Delivery 3', secondaryTeamName: 'Operation 3', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'QA: counter-offer sub-status visibility before publish', confidentialInformation: '', categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })), scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm}:00`, orderEndDate: null, orderEndTime: null, timeZone: 'UTC', addressId, qualificationSubTypes: (t.qualificationSubTypes || []).map((q) => q.id), expenses: [{ expenseType: 'TRAVEL', description: 'Customer travel', amount: 30 }], paymentType: 'HOURLY', paymentTerms: t.paymentTerms || '15 days', currency: t.currency || 'USD', hourlyRate: 45, minimumHours: 5, additionalHourlyRate: 50, nonBusinessHourRate: null, purchaseOrderNumber: '', halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }

async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 });
  await page.waitForTimeout(3_000);
}

test('Counter-offer sub-status is visible to the customer before publish and disappears on publish', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, checks: [], findings: [], workOrders: {}, steps: [] };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const td = await apiLogin(tdAcc, 'Tech Domain');
  const cust = await apiLogin(custAcc, 'Customer owner');
  log(`Tech Domain ${td.id} "${td.name}", customer owner ${cust.id} "${cust.name}"`);
  const template = (await getJson(td, `/workOrders/${TEMPLATE_WO}`)).body?.data || {};
  const minute = Math.floor(Date.now() / 60_000);
  const slot = new Date(Date.now() + (200 + (minute % 60)) * 86_400_000); slot.setUTCHours(2 + (minute % 12), 0, 0, 0);
  const slotDay = slot.toISOString().slice(0, 10), slotHm = slot.toISOString().slice(11, 16);

  // ---------------- notification reader (id-based diff) ----------------
  const seen = new Set();
  async function readNew(ref, woId) {
    const n = await getJson(cust, `/notifications/others?userId=${cust.id}&limit=60`);
    const all = n.body?.data?.data || n.body?.data?.notifications || n.body?.data || [];
    const rows = (Array.isArray(all) ? all : []).filter((r) => String(r.title).includes(String(ref)) || r.workOrderId === woId || plain(r.content).includes(String(ref)));
    const fresh = rows.filter((r) => !seen.has(r.id)); for (const r of fresh) seen.add(r.id);
    return fresh.map((r) => ({ id: r.id, type: r.type, title: r.title, content: plain(r.content), createdAt: r.createdAt }));
  }
  async function customerView(woId, ref) {
    const cd = await getJson(cust, `/workOrders/${woId}`);
    const cl = await getJson(cust, `/workOrders/customer?page=1&limit=50&search=${ref}`);
    const rows = cl.body?.data?.workOrders || cl.body?.data?.data || cl.body?.data || [];
    const row = (Array.isArray(rows) ? rows : []).find((r) => r.id === woId);
    return { detail: pick(cd.body?.data), list: pick(row), listHasRow: !!row };
  }
  async function createWo(tag) {
    const title = `Counter sub-status ${tag} ${RUN}`;
    const cr = await postJson(cust, '/workOrders', customerWoPayload(title, slotDay));
    let id = cr.body?.data?.id || cr.body?.id;
    if (!id) { const list = await getJson(cust, `/workOrders/customer?page=1&limit=5&search=${encodeURIComponent(title)}`); id = (list.body?.data?.workOrders || list.body?.data?.data || list.body?.data || [])[0]?.id; }
    expect(id, `customer WO ${tag} created`).toBeTruthy();
    const w = (await getJson(td, `/workOrders/${id}`)).body?.data || {};
    results.workOrders[tag] = { id, ref: w.referenceId, title, status: w.status, subStatus: w.subStatus, addressId: w.address?.id || w.addressId };
    log(`WO ${tag}: ${id} (#${w.referenceId}) ${w.status}/${w.subStatus}`);
    await sleep(2_000); await readNew(w.referenceId, id); // consume creation notifications
    return results.workOrders[tag];
  }
  async function publish(w) {
    const fix = await patchJson(td, `/workOrders/${w.id}`, clientFixPayload(template, w.title, w.addressId, slotDay, slotHm));
    const ap = await postJson(td, `/workOrders/${w.id}/approvePublish`, {});
    log(`publish WO ${w.id}: PATCH fix -> ${fix.status}; approvePublish -> ${ap.status} ${JSON.stringify(ap.body).slice(0, 160)}`);
    return ap;
  }

  // ---------------- UI capture: customer detail header + Work Orders listing ----------------
  async function customerUi(w, name) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(20_000);
    const out = {};
    try {
      await uiLogin(page, custAcc);
      await page.goto(`/workOrder/details/${w.id}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const head = body.slice(0, body.indexOf(`#${w.ref}`) + 12);
      out.detailHeader = head.slice(-120);
      out.detailShot = await shot(page, `${name}-customer-detail`);
      out.tabs = await page.getByRole('tab').allInnerTexts().catch(() => []);
      // listing: Work Orders page, tab by label, then search for the reference
      await page.goto('/'); await page.waitForTimeout(4_000);
      const tabLabel = w.expectTab || 'Submitted';
      await page.getByText(tabLabel, { exact: false }).first().click().catch(() => { }); await page.waitForTimeout(3_000);
      const search = page.locator('input[placeholder*="earch" i]').first();
      if (await search.isVisible().catch(() => false)) { await search.fill(String(w.ref)); await page.keyboard.press('Enter'); await page.waitForTimeout(4_000); }
      const row = page.locator('[role=row], tr', { hasText: String(w.ref) }).first();
      out.listRow = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      out.listRowNoTitle = out.listRow.replace(w.title, '').trim(); // the WO title contains the word "Counter" - keep it out of the badge check
      out.listShot = await shot(page, `${name}-customer-listing`);
      info(`UI ${name}: customer detail header + listing row captured`, out);
    } catch (e) { log(`customerUi ${name} failed: ${e.message.slice(0, 200)}`); }
    finally { await ctx.close(); }
    return out;
  }

  async function checkpoint(w, name, { expectVisible, expectNotified, kind }) {
    await sleep(5_000);
    const step = { wo: w.id, ref: w.ref, step: name };
    step.techDomainApi = pick((await getJson(td, `/workOrders/${w.id}`)).body?.data);
    step.customerView = await customerView(w.id, w.ref);
    step.notifications = await readNew(w.ref, w.id);
    const cv = step.customerView;
    const sub = cv.detail?.customerSubStatus || cv.detail?.subStatus || null;
    const listSub = cv.list?.customerSubStatus || cv.list?.subStatus || null;
    step.customerSubStatus = sub; step.listSubStatus = listSub;
    log(`[${name}] TD ${JSON.stringify(step.techDomainApi)} | customer detail ${JSON.stringify(cv.detail)} | listing ${JSON.stringify(cv.list)} | notif ${step.notifications.map((r) => `${r.type} | ${r.title} | ${r.content.slice(0, 80)}`).join(' ;; ') || '-'}`);
    results.steps.push(step);
    if (expectVisible) {
      check(`[${name}] customer API detail shows a counter/proposal sub-status`, !!sub && PROPOSAL_WORDS.test(sub), cv.detail);
      check(`[${name}] customer listing row carries the same sub-status (${sub})`, cv.listHasRow && listSub === sub, { list: cv.list, listHasRow: cv.listHasRow });
    } else {
      check(`[${name}] customer API detail has NO counter/proposal sub-status any more`, !(sub && PROPOSAL_WORDS.test(sub)), cv.detail);
      check(`[${name}] customer listing row has NO counter/proposal sub-status any more`, !(listSub && PROPOSAL_WORDS.test(listSub)), cv.list);
    }
    if (expectNotified === true) {
      check(`[${name}] customer got a notification for it`, step.notifications.length > 0, step.notifications.map((r) => `${r.type} | ${r.title}: ${r.content.slice(0, 100)}`));
      if (step.notifications.length) check(`[${name}] notification text is about the proposal/counter offer`, step.notifications.some((r) => PROPOSAL_WORDS.test(r.title + ' ' + r.content)), step.notifications.map((r) => `${r.title}: ${r.content.slice(0, 100)}`));
    } else if (expectNotified === false) {
      check(`[${name}] customer got NO notification (own action)`, step.notifications.length === 0, step.notifications.map((r) => `${r.type} | ${r.title}`));
    } else {
      info(`[${name}] customer notifications (${kind || 'info'})`, step.notifications.map((r) => `${r.type} | ${r.title}: ${r.content.slice(0, 100)}`));
    }
    return step;
  }

  // ================= WO A: counter -> customer ACCEPTS -> publish =================
  const A = await createWo('A-accept');
  await checkpoint(A, 'A0 submitted (no counter yet)', { expectVisible: false, kind: 'baseline' });
  const cA = await postJson(td, '/offers/customer/counter', { workOrderId: A.id, ...COUNTER });
  const coA = cA.body?.data?.id || cA.body?.id; log(`counter A -> ${cA.status} id ${coA}`);
  expect(cA.status, 'counter A').toBeLessThan(300);
  const sA1 = await checkpoint(A, 'A1 counter sent (pending)', { expectVisible: true, expectNotified: true });
  sA1.ui = await customerUi(A, 'A1-counter-pending');
  check('[A1] customer UI detail header shows the proposal sub-status badge', /Proposal|Counter/i.test(sA1.ui.detailHeader || ''), { header: sA1.ui.detailHeader });
  check('[A1] customer UI listing row shows the proposal sub-status', /Proposal|Counter/i.test(sA1.ui.listRowNoTitle || ''), { row: sA1.ui.listRow });

  const accA = await postJson(cust, `/offers/customer/counter/accept/${coA}`, {}); log(`customer accept A -> ${accA.status} ${JSON.stringify(accA.body).slice(0, 120)}`);
  check('[A2] customer accepted the proposal (API)', accA.status < 300, { status: accA.status });
  const sA2 = await checkpoint(A, 'A2 customer accepted', { expectVisible: true, kind: 'own action' });
  sA2.ui = await customerUi(A, 'A2-accepted');
  check('[A2] customer UI detail header shows "Proposal Accepted"', /Proposal Accepted|Accepted/i.test(sA2.ui.detailHeader || ''), { header: sA2.ui.detailHeader });

  const apA = await publish(A); check('[A3] Tech Domain published WO A (approvePublish)', apA.status < 300, { status: apA.status });
  const sA3 = await checkpoint(A, 'A3 published', { expectVisible: false, kind: 'publish' });
  check('[A3] work order status is PUBLISHED on both sides', sA3.techDomainApi?.status === 'PUBLISHED' && sA3.customerView.detail?.status === 'PUBLISHED', { td: sA3.techDomainApi, customer: sA3.customerView.detail });
  A.expectTab = 'Accepted';
  sA3.ui = await customerUi(A, 'A3-published');
  check('[A3] customer UI detail header no longer shows a proposal badge', !/Proposal|Counter/i.test(sA3.ui.detailHeader || ''), { header: sA3.ui.detailHeader });
  check('[A3] customer UI listing row no longer shows a proposal sub-status', !!sA3.ui.listRow && !/Proposal|Counter/i.test(sA3.ui.listRowNoTitle || ''), { row: sA3.ui.listRow });
  const coAfinal = await getJson(td, `/offers/customer/counter/${A.id}`); info('[A3] counter record after publish', { status: coAfinal.body?.data?.status });

  // ================= WO B: counter -> customer DECLINES -> publish =================
  const B = await createWo('B-decline');
  const cB = await postJson(td, '/offers/customer/counter', { workOrderId: B.id, ...COUNTER });
  const coB = cB.body?.data?.id || cB.body?.id; log(`counter B -> ${cB.status} id ${coB}`);
  await checkpoint(B, 'B1 counter sent (pending)', { expectVisible: true, expectNotified: true });
  const decB = await postJson(cust, `/offers/customer/counter/decline/${coB}`, {}); log(`customer decline B -> ${decB.status} ${JSON.stringify(decB.body).slice(0, 120)}`);
  check('[B2] customer declined the proposal (API)', decB.status < 300, { status: decB.status });
  const sB2 = await checkpoint(B, 'B2 customer declined', { expectVisible: true, kind: 'own action' });
  sB2.ui = await customerUi(B, 'B2-declined');
  info('[B2] customer UI after decline', { header: sB2.ui.detailHeader, row: sB2.ui.listRow });
  const apB = await publish(B); check('[B3] Tech Domain published WO B', apB.status < 300, { status: apB.status });
  const sB3 = await checkpoint(B, 'B3 published', { expectVisible: false, kind: 'publish' });
  B.expectTab = 'Accepted';
  sB3.ui = await customerUi(B, 'B3-published');
  check('[B3] customer UI detail header no longer shows a proposal badge', !/Proposal|Counter/i.test(sB3.ui.detailHeader || ''), { header: sB3.ui.detailHeader });

  // ================= WO C: counter -> Tech Domain WITHDRAWS -> publish =================
  const C = await createWo('C-withdraw');
  const cC = await postJson(td, '/offers/customer/counter', { workOrderId: C.id, ...COUNTER });
  const coC = cC.body?.data?.id || cC.body?.id; log(`counter C -> ${cC.status} id ${coC}`);
  await checkpoint(C, 'C1 counter sent (pending)', { expectVisible: true, expectNotified: true });
  const wdC = await postJson(td, `/offers/customer/counter/withdraw/${coC}`, {}); log(`TD withdraw C -> ${wdC.status} ${JSON.stringify(wdC.body).slice(0, 120)}`);
  check('[C2] Tech Domain withdrew the proposal (API)', wdC.status < 300, { status: wdC.status });
  const sC2 = await checkpoint(C, 'C2 withdrawn by Tech Domain', { kind: 'withdraw' });
  info('[C2] customer sub-status after withdraw (detail / listing)', { detail: sC2.customerView.detail, list: sC2.customerView.list });
  const apC = await publish(C); check('[C3] Tech Domain published WO C', apC.status < 300, { status: apC.status });
  await checkpoint(C, 'C3 published', { expectVisible: false, kind: 'publish' });

  // ---------------- summary ----------------
  const table = results.steps.map((s) => `${s.step.padEnd(32)} TD=${(s.techDomainApi?.status || '-') + '/' + (s.techDomainApi?.subStatus || '-')}`.padEnd(70) + ` customer detail=${s.customerView?.detail?.status || '-'}/${s.customerSubStatus || '-'} listing=${s.listSubStatus || '-'}`.padEnd(60) + ` notif=${s.notifications.length} [${s.notifications.map((r) => r.title).join(' ; ')}]`);
  const summary = table.join('\n') + '\n\n' + results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.length}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
