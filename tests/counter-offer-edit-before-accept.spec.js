// Scenario (user request 2026-10-16): customer creates a work order -> Tech Domain sends a counter offer -> BEFORE the
// customer accepts, Tech Domain EDITS the counter offer -> what does the customer see, and when the customer accepts,
// which values (first version or edited version) are applied to the work order?
//
// Expected: the customer always sees the latest (edited) proposal with "Awaiting your response"; the history keeps both
// versions; the customer is notified about the update; acceptance applies the EDITED rates/expenses (not the first ones).
//
// Run:  npx playwright test tests/counter-offer-edit-before-accept.spec.js --reporter=line --trace off
// Evidence: evidence/CounterOffer-EditBeforeAccept/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'CounterOffer-EditBeforeAccept', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const ENTITY_ID = 104;
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
// original customer rates / first counter / edited counter
const ORIG = { hourlyRate: 45, minimumHours: 5, additionalHourlyRate: 50, expense: ['TRAVEL', 'Customer travel', 30] };
const V1 = { hourlyRate: 60, minimumHours: 4, additionalHourlyRate: 65, expenses: [{ expenseType: 'TOOLS', description: 'Ladder hire (v1)', amount: 20 }] };
const V2 = { hourlyRate: 58, minimumHours: 6, additionalHourlyRate: 62, expenses: [{ expenseType: 'OTHER', description: 'Parking (edited v2)', amount: 10 }] }; // UI "Other" type = OTHER

test.setTimeout(900_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `CounterOffer_EditBeforeAccept_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
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
const counterOf = async (s, wo) => { const r = await getJson(s, `/offers/customer/counter/${wo}`); return { status: r.status, data: r.body?.data, msg: r.body?.message }; };
const brief = (co) => co.data ? { id: co.data.id, status: co.data.status, hourly: co.data.customerHourlyRate, min: co.data.customerMinimumHours, add: co.data.customerAdditionalHourlyRate, expenses: (co.data.expenses || []).map((e) => `${e.expenseType}:${e.amount}`), history: (co.data.offerHistory || []).map((h) => `${h.status}/${h.customerHourlyRate}/${h.customerMinimumHours}/${h.customerAdditionalHourlyRate}`) } : { status: co.status, msg: co.msg };
const rates = (pay) => { const c = pay?.clientRates || {}; return { hourlyRate: c.hourlyRate, minimumHours: c.minimumHours, additionalHourlyRate: c.additionalHourlyRate, totalLabourCost: c.totalLabourCost, totalExpenseCost: c.totalExpenseCost, totalWorkOrderCost: c.totalWorkOrderCost, expenses: (c.expenses || []).map((e) => `${e.expenseType}:${e.amount}`) }; };

function customerWoPayload(title) { const start = new Date(Date.now() + 5 * 86_400_000); const day = start.toISOString().slice(0, 10); return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'QA: counter offer edited before customer acceptance', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [{ expenseType: ORIG.expense[0], description: ORIG.expense[1], amount: ORIG.expense[2] }], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: ORIG.hourlyRate, minimumHours: ORIG.minimumHours, additionalHourlyRate: ORIG.additionalHourlyRate, nonBusinessHourRate: null, purchaseOrderNumber: '', halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }

async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"]').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 });
  await page.waitForTimeout(3_000);
}
async function newPage(browser, account) { const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(20_000); await uiLogin(page, account); return { ctx, page }; }

test('Counter offer edited by Tech Domain before the customer accepts', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, checks: [], findings: [], steps: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const custAcc = testAccounts.find((a) => a.role === 'Customer');
  const td = await apiLogin(tdAcc, 'Tech Domain');
  const cust = await apiLogin(custAcc, 'Customer owner');
  log(`Tech Domain ${td.id} "${td.name}", customer owner ${cust.id} "${cust.name}"`);

  // 1. customer creates the work order
  const title = `Counter edit before accept ${RUN}`;
  const cr = await postJson(cust, '/workOrders', customerWoPayload(title));
  let WO = cr.body?.data?.id || cr.body?.id;
  if (!WO) { const list = await getJson(cust, `/workOrders/customer?page=1&limit=5&search=${encodeURIComponent(title)}`); WO = (list.body?.data?.workOrders || list.body?.data?.data || list.body?.data || [])[0]?.id; }
  expect(WO, 'customer WO created').toBeTruthy();
  const wo0 = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
  const REF = wo0.referenceId;
  results.steps.create = { wo: WO, ref: REF, status: wo0.status, subStatus: wo0.subStatus };
  check(`1. customer created WO ${WO} (#${REF}) with rates 45/5/50 + Travel 30, status ${wo0.status}`, cr.status < 300 && wo0.status === 'PENDING_APPROVAL', results.steps.create);
  const pay0 = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
  info('original estimated payment (customer rates)', pay0);
  const n0 = await getJson(cust, `/notifications/others?userId=${cust.id}&limit=5`);
  const maxId0 = Math.max(0, ...(n0.body?.data?.data || n0.body?.data || []).map((r) => Number(r.id) || 0)); // id-based diff (local clock may differ from the server)

  // 2. Tech Domain sends counter offer v1
  const c1 = await postJson(td, '/offers/customer/counter', { workOrderId: WO, ...V1 });
  const coId = c1.body?.data?.id || c1.body?.id;
  log(`POST offers/customer/counter -> ${c1.status} ${JSON.stringify(c1.body).slice(0, 200)}`);
  check('2. Tech Domain sent counter offer v1 (60/4/65 + Tools 20)', c1.status < 300 && !!coId, { status: c1.status, id: coId });
  await sleep(3_000);
  const custV1 = await counterOf(cust, WO);
  results.steps.customerViewV1 = brief(custV1);
  check('3. customer can read the pending proposal v1 (GET offers/customer/counter/:wo -> 200 PENDING with 60/4/65)', custV1.status === 200 && custV1.data?.status === 'PENDING' && Number(custV1.data?.customerHourlyRate) === 60, brief(custV1));
  const canRead = custV1.status === 200;

  // customer UI before the edit
  { const { ctx, page } = await newPage(browser, custAcc);
    await page.goto(`/workOrder/proposals/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
    const tabs = await page.locator('[role=tab]').allInnerTexts().catch(() => []);
    const art = (await page.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    const s = await shot(page, 'customer-proposal-v1-before-edit');
    results.steps.customerUiV1 = { tabs, card: art.slice(0, 600), shot: s };
    check('4. customer UI shows proposal v1 (USD 60.00, 4 hrs, Ladder hire) with Accept/Decline, before the edit', /60\.00/.test(art) && /Ladder hire/.test(art) && (await page.locator('article').first().getByRole('button', { name: 'Accept', exact: true }).isVisible().catch(() => false)), { tabs, card: art.slice(0, 300), shot: s });
    await ctx.close(); }

  // 3. Tech Domain EDITS the counter offer before the customer responds
  const e = await patchJson(td, `/offers/customer/counter/${coId}`, { workOrderId: WO, ...V2 });
  log(`PATCH offers/customer/counter/${coId} -> ${e.status} ${JSON.stringify(e.body).slice(0, 200)}`);
  check('5. Tech Domain edited the pending counter offer to v2 (58/6/62 + Parking 10) - PATCH offers/customer/counter/:id', e.status < 300, { status: e.status, body: JSON.stringify(e.body).slice(0, 200) });
  await sleep(3_000);
  const tdV2 = await counterOf(td, WO); results.steps.tdViewV2 = brief(tdV2);
  check('6. counter record (Tech Domain view) now holds v2 values, same id, still PENDING, history keeps v1', tdV2.data?.id === coId && tdV2.data?.status === 'PENDING' && Number(tdV2.data?.customerHourlyRate) === 58 && Number(tdV2.data?.customerMinimumHours) === 6 && (tdV2.data?.expenses || []).some((x) => x.expenseType === 'OTHER' && Number(x.amount) === 10) && (tdV2.data?.offerHistory || []).length >= 1, brief(tdV2));
  const v1Expense = (tdV2.data?.expenses || []).some((x) => x.expenseType === 'TOOLS');
  info('does the edited proposal still carry the v1 expense (Tools 20)?', { v1ExpenseStillPresent: v1Expense, expenses: brief(tdV2).expenses });

  const custV2 = await counterOf(cust, WO); results.steps.customerViewV2 = brief(custV2);
  check('7. customer API shows the EDITED proposal v2 (58/6/62 + Parking 10), still PENDING / awaiting response', custV2.status === 200 && custV2.data?.status === 'PENDING' && Number(custV2.data?.customerHourlyRate) === 58 && Number(custV2.data?.customerMinimumHours) === 6 && Number(custV2.data?.customerAdditionalHourlyRate) === 62, brief(custV2));
  const n = await getJson(cust, `/notifications/others?userId=${cust.id}&limit=30`);
  const rows = (n.body?.data?.data || n.body?.data || []).filter((r) => Number(r.id) > maxId0 && (String(r.title).includes(String(REF)) || r.workOrderId === WO)).map((r) => ({ type: r.type, title: r.title, content: plain(r.content), url: r.url }));
  results.steps.customerNotifications = rows;
  check('8. customer got notifications for the proposal AND for the update', rows.length >= 2 && rows.some((r) => /updat/i.test(r.title + r.content)), rows);
  const wo1 = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
  const pay1 = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
  check('9. while pending (after edit) the work order keeps the ORIGINAL rates 45/5/50 and total 255', pay1.hourlyRate === 45 && pay1.minimumHours === 5 && pay1.totalWorkOrderCost === 255, { status: wo1.status, pay: pay1 });

  // customer UI after the edit + Tech Domain UI banner
  let acceptedVia = null;
  { const { ctx, page } = await newPage(browser, custAcc);
    await page.goto(`/workOrder/proposals/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
    const art = page.locator('article').first();
    const at = (await art.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const s = await shot(page, 'customer-proposal-v2-after-edit');
    results.steps.customerUiV2 = { card: at.slice(0, 700), shot: s };
    check('10. customer UI shows the EDITED proposal (USD 58.00, 6 hrs, Parking) and no longer the v1 values (60.00 / Ladder hire) as the pending one', /58\.00/.test(at) && /6 hrs/.test(at) && /Parking/.test(at), { card: at.slice(0, 400), shot: s });
    info('customer UI: are the v1 values still mentioned anywhere on the proposals page (history)?', { v1_60_visible: /60\.00/.test(body), ladderHireVisible: /Ladder hire/.test(body), awaiting: /Awaiting your response/.test(at) });
    // bell
    await page.locator('i[class*="fa-bell"]').first().click().catch(() => { }); await page.waitForTimeout(3_000);
    const s2 = await shot(page, 'customer-bell-after-edit'); info('customer bell after the edit', { shot: s2 });
    await page.keyboard.press('Escape').catch(() => { });
    // 4. customer ACCEPTS the (edited) proposal - UI first, API fallback
    await page.goto(`/workOrder/proposals/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
    const btn = page.locator('article').first().getByRole('button', { name: 'Accept', exact: true });
    if (await btn.isVisible().catch(() => false)) {
      await btn.click(); await page.waitForTimeout(1_000);
      const dlg = page.locator('[role=dialog], .MuiModal-root:visible, .MuiDialog-root:visible').last(); // "Accept Proposal" is a MUI modal
      const dt = (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ');
      const s3 = await shot(page, 'customer-accept-dialog');
      info('accept confirmation dialog', { text: dt.slice(0, 400), shot: s3 });
      await dlg.getByRole('button', { name: 'Accept', exact: true }).last().click().catch(() => { });
      await page.waitForTimeout(4_000);
      const after = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const s4 = await shot(page, 'customer-after-accept');
      acceptedVia = { via: 'ui', toast: /Proposal Accepted/i.test(after), shot: s4 };
    } else {
      const r = await postJson(cust, `/offers/customer/counter/accept/${coId}`, {});
      acceptedVia = { via: 'api', status: r.status, body: JSON.stringify(r.body).slice(0, 200) };
    }
    await page.goto(`/workOrder/proposals/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
    const at2 = (await page.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    const s5 = await shot(page, 'customer-proposal-after-accept');
    results.steps.customerUiAccepted = { card: at2.slice(0, 600), shot: s5 };
    check('11. customer accepted the proposal', acceptedVia.via === 'ui' ? acceptedVia.toast || /Accepted/.test(at2) : acceptedVia.status < 300, acceptedVia);
    // the accepted card is collapsed: it shows only the totals (CURRENT 225.00 / PROPOSED 348.00 = 58 x 6)
    check('12. proposal card after acceptance shows "Accepted … by Customer Owner" with the v2 total (USD 348.00 = 58 x 6), not the v1 total 240.00', /Accepted/.test(at2) && /348\.00/.test(at2) && !/240\.00/.test(at2), { card: at2.slice(0, 300), shot: s5 });
    await page.goto(`/workOrder/details/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(4_000);
    await page.getByRole('tab', { name: /Payment/i }).first().click().catch(() => { }); await page.waitForTimeout(3_000);
    const payTxt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const s6 = await shot(page, 'customer-payment-tab-after-accept');
    info('customer Payment tab after acceptance', { has58: /58\.00/.test(payTxt), has60: /60\.00/.test(payTxt), has45: /45\.00/.test(payTxt), parking: /Parking/.test(payTxt), ladder: /Ladder/.test(payTxt), shot: s6 });
    await ctx.close(); }

  // 5. which values were applied?
  await sleep(2_000);
  const coFinal = await counterOf(td, WO); results.steps.counterFinal = brief(coFinal);
  const wo2 = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
  const pay2 = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data);
  results.steps.afterAccept = { status: wo2.status, subStatus: wo2.subStatus, woRates: { hourlyRate: wo2.hourlyRate, minimumHours: wo2.minimumHours, additionalHourlyRate: wo2.additionalHourlyRate }, pay: pay2 };
  check('13. counter offer status is ASSIGNED (accepted) after the customer accepts', coFinal.data?.status === 'ASSIGNED', brief(coFinal));
  check('14. work order now carries the EDITED (v2) rates 58/6/62 - not the v1 values 60/4/65 and not the original 45/5/50', pay2.hourlyRate === 58 && pay2.minimumHours === 6 && pay2.additionalHourlyRate === 62, results.steps.afterAccept);
  check('15. expenses after acceptance = original Travel 30 + edited Parking 10 (v1 Tools 20 NOT added), total 58x6=348 + 40 = 388', pay2.expenses.includes('TRAVEL:30') && pay2.expenses.includes('OTHER:10') && !pay2.expenses.some((x) => x.startsWith('TOOLS')) && pay2.totalWorkOrderCost === 388, pay2);

  // Tech Domain UI after acceptance
  { const { ctx, page } = await newPage(browser, tdAcc);
    await page.goto(`/workOrder/details/${WO}`); await page.waitForTimeout(5_000);
    const bt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const s = await shot(page, 'techdomain-detail-after-accept');
    const btns = await page.getByRole('button').allInnerTexts().catch(() => []);
    info('Tech Domain detail after acceptance (banner + buttons)', { accepted: /Counter Offer Accepted/i.test(bt), counterButtons: btns.filter((b) => /Counter/i.test(b)), shot: s });
    await page.getByRole('tab', { name: /Payment/i }).first().click().catch(() => { }); await page.waitForTimeout(3_000);
    const pt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const s2 = await shot(page, 'techdomain-payment-tab-after-accept');
    check('16. Tech Domain Payment tab shows the edited rate 58.00 and Parking, not Ladder hire', /58\.00/.test(pt) && /Parking/.test(pt) && !/Ladder/.test(pt), { has58: /58\.00/.test(pt), has60: /60\.00/.test(pt), parking: /Parking/.test(pt), ladder: /Ladder/.test(pt), shot: s2 });
    await ctx.close(); }

  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.length}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
