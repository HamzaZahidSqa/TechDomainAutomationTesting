// User request 2026-10-16: the customer SUB-USER creates a work order and Tech Domain sends a counter offer -
// can the customer OWNER see and accept it? (and, as info, can the sub-user see/accept it; and the reverse case:
// owner creates, sub-user tries to accept)
//
// Run:  npx playwright test tests/subuser-wo-owner-accepts-counter.spec.js --reporter=line --trace off
// Evidence: evidence/SubUser-WO-OwnerAcceptsCounter/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const td123 = require(path.join(__dirname, '..', 'td123-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'SubUser-WO-OwnerAcceptsCounter', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const ENTITY_ID = 104;
const DEFAULT_TASKS = ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] }));
const COUNTER = { hourlyRate: 60, minimumHours: 4, additionalHourlyRate: 65, expenses: [{ expenseType: 'TOOLS', description: 'Ladder hire', amount: 20 }] };

test.setTimeout(600_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status} ${JSON.stringify(l.body).slice(0, 150)}`);
  const s = { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), id: l.body.data?.id, name: `${l.body.data?.firstName || ''} ${l.body.data?.lastName || ''}`.trim(), role: l.body.data?.role?.role, isOwner: l.body.data?.isCompanyOwner };
  s.relogin = async () => { const n = await rawLogin(account.email, account.password); if (!n.body.accessToken) return false; s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${n.body.accessToken}` } }); return true; };
  return s;
}
async function call(s, method, p, data) { const opts = data === undefined ? undefined : { data }; let r = await s.api[method](u(p), opts); if (r.status() === 401 && (await s.relogin())) r = await s.api[method](u(p), opts); return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) }; }
const getJson = (s, p) => call(s, 'get', p); const postJson = (s, p, d) => call(s, 'post', p, d); const patchJson = (s, p, d) => call(s, 'patch', p, d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const counterOf = async (s, wo) => { const r = await getJson(s, `/offers/customer/counter/${wo}`); return { status: r.status, data: r.body?.data, msg: r.body?.message }; };
const brief = (co) => co.data ? { id: co.data.id, status: co.data.status, hourly: co.data.customerHourlyRate, min: co.data.customerMinimumHours, add: co.data.customerAdditionalHourlyRate } : { status: co.status, msg: co.msg };
const rates = (pay) => { const c = pay?.clientRates || {}; return { hourlyRate: c.hourlyRate, minimumHours: c.minimumHours, additionalHourlyRate: c.additionalHourlyRate, totalWorkOrderCost: c.totalWorkOrderCost, expenses: (c.expenses || []).map((e) => `${e.expenseType}:${e.amount}`) }; };
function customerWoPayload(title) { const start = new Date(Date.now() + 5 * 86_400_000); const day = start.toISOString().slice(0, 10); return { templateId: null, title, serviceLevelAgreeement: '', clientId: ENTITY_ID, projectId: null, teamId: null, secondaryTeamId: null, teamName: '', secondaryTeamName: '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'QA: sub-user WO, owner accepts counter', confidentialInformation: '', categoryId: null, workOrderServices: [], scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T10:00:00`, orderEndDate: null, orderEndTime: null, timeZone: 'Asia/Karachi', addressId: null, isRemote: false, addressLine1: 'Lahore, Pakistan', addressLine2: '', city: 'Lahore', country: 'Pakistan', state: 'Punjab', zipCode: '54000', latitude: 31.5203696, longitude: 74.3587473, displayName: 'lahore', locationType: 'RESIDENTIAL', qualificationSubTypes: [], expenses: [{ expenseType: 'TRAVEL', description: 'Customer travel', amount: 30 }], paymentType: 'HOURLY', paymentTerms: '15 days', currency: 'USD', hourlyRate: 45, minimumHours: 5, additionalHourlyRate: 50, nonBusinessHourRate: null, purchaseOrderNumber: '', halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, isDraft: false, tasks: DEFAULT_TASKS, contacts: [], workOrderManagerId: null, customerFiles: [] }; }
async function uiLogin(page, account) { await page.goto('/login', { waitUntil: 'networkidle' }); await page.locator('input[type="email"], input[name="email"]').first().fill(account.email); await page.locator('input[type="password"]').first().fill(account.password); await page.locator('button[type="submit"]').first().click(); await expect(page).not.toHaveURL(/\/login/i, { timeout: 60_000 }); await page.waitForTimeout(3_000); }
async function newPage(browser, account) { const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(30_000); await uiLogin(page, account); return { ctx, page }; }
const bodyText = async (page) => (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');

test('Sub-user creates the work order; Tech Domain counters; the customer OWNER sees and accepts it', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, checks: [], findings: [], steps: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const ownerAcc = testAccounts.find((a) => a.role === 'Customer');
  const subAcc = td123.find((a) => a.role === 'Customer Sub-user');
  const td = await apiLogin(tdAcc, 'Tech Domain'); const owner = await apiLogin(ownerAcc, 'Customer owner'); const sub = await apiLogin(subAcc, 'Customer sub-user');
  log(`TD ${td.id}; owner ${owner.id} "${owner.name}" owner=${owner.isOwner}; sub-user ${sub.id} "${sub.name}" owner=${sub.isOwner}`);

  // ---------- A. sub-user creates, owner accepts ----------
  const title = `Sub-user WO, owner accepts counter ${RUN}`;
  const cr = await postJson(sub, '/workOrders', customerWoPayload(title));
  const WO = cr.body?.data?.id || cr.body?.id; expect(WO, 'sub-user WO created').toBeTruthy();
  const wo0 = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; const REF = wo0.referenceId; results.wo = WO; results.ref = REF;
  check(`A1. sub-user ${sub.id} created WO ${WO} (#${REF}) -> PENDING_APPROVAL, createdBy sub-user`, cr.status < 300 && wo0.status === 'PENDING_APPROVAL', { status: wo0.status, createdBy: wo0.createdBy?.id || wo0.createdById, manager: wo0.workOrderManager?.id });
  const ownerSees = (await getJson(owner, `/workOrders/${WO}`)); const ownerList = (await getJson(owner, `/workOrders/customer?page=1&limit=100`)).body?.data || [];
  check('A2. owner can open the sub-user\'s work order (API detail 200 + listed on the customer board)', ownerSees.status === 200 && (Array.isArray(ownerList) ? ownerList : ownerList.workOrders || []).some((w) => w.id === WO), { detail: ownerSees.status, listed: (Array.isArray(ownerList) ? ownerList : []).some((w) => w.id === WO) });
  const n0o = Math.max(0, ...((await getJson(owner, `/notifications/others?userId=${owner.id}&limit=5`)).body?.data?.data || []).map((r) => Number(r.id) || 0));
  const n0s = Math.max(0, ...((await getJson(sub, `/notifications/others?userId=${sub.id}&limit=5`)).body?.data?.data || []).map((r) => Number(r.id) || 0));
  const c1 = await postJson(td, '/offers/customer/counter', { workOrderId: WO, ...COUNTER }); const coId = c1.body?.data?.id || c1.body?.id;
  check('A3. Tech Domain sent a counter offer (60/4/65 + Tools 20)', c1.status < 300 && !!coId, { status: c1.status, id: coId });
  await sleep(3_000);
  const ownerCo = await counterOf(owner, WO); const subCo = await counterOf(sub, WO);
  check('A4. OWNER can read the pending counter (GET offers/customer/counter/:wo -> 200 PENDING 60/4/65)', ownerCo.status === 200 && ownerCo.data?.status === 'PENDING' && Number(ownerCo.data?.customerHourlyRate) === 60, brief(ownerCo));
  info('sub-user view of the counter (API)', brief(subCo));
  const notes = async (s, min) => ((await getJson(s, `/notifications/others?userId=${s.id}&limit=30`)).body?.data?.data || []).filter((r) => Number(r.id) > min && (String(r.title).includes(String(REF)) || r.workOrderId === WO)).map((r) => ({ type: r.type, title: r.title, content: plain(r.content) }));
  const no = await notes(owner, n0o), ns = await notes(sub, n0s);
  check('A5. owner notified about the proposal', no.some((r) => /proposal|counter/i.test(r.title + r.content)), no);
  info('sub-user notifications about the proposal', ns);

  // owner UI: proposals page -> Accept
  let acceptedVia = null;
  { const { ctx, page } = await newPage(browser, ownerAcc);
    await page.goto(`/workOrder/details/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
    const dt = await bodyText(page); const s0 = await shot(page, 'owner-wo-detail'); info('owner WO detail page (banner / proposal link)', { shot: s0, proposalMention: /proposal|counter/i.test(dt), snippet: dt.slice(0, 300) });
    await page.goto(`/workOrder/proposals/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
    const art = page.locator('article').first(); const at = (await art.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const acceptBtn = art.getByRole('button', { name: 'Accept', exact: true });
    const s1 = await shot(page, 'owner-proposals-page');
    check('A6. owner UI proposals page shows the proposal (USD 60.00, 4 hrs, Ladder hire) with an Accept button', /60\.00/.test(at) && /Ladder hire/.test(at) && (await acceptBtn.isVisible().catch(() => false)), { card: at.slice(0, 400), shot: s1 });
    if (await acceptBtn.isVisible().catch(() => false)) {
      await acceptBtn.click(); await page.waitForTimeout(1_000);
      const dlg = page.locator('[role=dialog], .MuiModal-root:visible, .MuiDialog-root:visible').last();
      const s2 = await shot(page, 'owner-accept-dialog');
      await dlg.getByRole('button', { name: 'Accept', exact: true }).last().click().catch(() => { });
      await page.waitForTimeout(4_000);
      const after = await bodyText(page); const s3 = await shot(page, 'owner-after-accept');
      acceptedVia = { via: 'ui', toast: /Proposal Accepted/i.test(after), dialogShot: s2, shot: s3 };
    } else { const r = await postJson(owner, `/offers/customer/counter/accept/${coId}`, {}); acceptedVia = { via: 'api', status: r.status, body: JSON.stringify(r.body).slice(0, 200) }; }
    await page.goto(`/workOrder/proposals/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
    const at2 = (await page.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' '); const s4 = await shot(page, 'owner-proposal-after-accept');
    check('A7. OWNER accepted the counter offer (UI) -> card shows Accepted … by Customer Owner', (acceptedVia.via === 'ui' ? (acceptedVia.toast || /Accepted/.test(at2)) : acceptedVia.status < 300) && /Accepted/.test(at2), { ...acceptedVia, card: at2.slice(0, 300), shot: s4 });
    await page.goto(`/workOrder/details/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(4_000); await page.getByRole('tab', { name: /Payment/i }).first().click().catch(() => { }); await page.waitForTimeout(3_000);
    const pt = await bodyText(page); const s5 = await shot(page, 'owner-payment-tab-after-accept'); info('owner Payment tab after acceptance', { has60: /60\.00/.test(pt), ladder: /Ladder/.test(pt), shot: s5 });
    await ctx.close(); }
  await sleep(2_000);
  const coF = await counterOf(td, WO); const pay = rates((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data); const wo1 = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
  check('A8. counter ASSIGNED, work order carries the counter rates 60/4/65 + Travel 30 + Tools 20 = 290', coF.data?.status === 'ASSIGNED' && pay.hourlyRate === 60 && pay.minimumHours === 4 && pay.additionalHourlyRate === 65 && pay.totalWorkOrderCost === 290, { counter: brief(coF), pay, status: wo1.status, acceptedBy: coF.data?.acceptedBy || coF.data?.updatedBy || null });
  // sub-user view after owner's acceptance
  { const { ctx, page } = await newPage(browser, subAcc);
    await page.goto(`/workOrder/proposals/${WO}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
    const at = (await page.locator('article').first().innerText().catch(() => '')).replace(/\s+/g, ' '); const s = await shot(page, 'subuser-proposals-after-owner-accept');
    info('sub-user (creator) proposals page after the owner accepted', { card: at.slice(0, 300), accepted: /Accepted/.test(at), shot: s });
    await ctx.close(); }

  // ---------- B. reverse: owner creates, sub-user tries to accept ----------
  const cr2 = await postJson(owner, '/workOrders', customerWoPayload(`Owner WO, sub-user tries to accept ${RUN}`));
  const WO2 = cr2.body?.data?.id || cr2.body?.id; results.wo2 = WO2;
  if (WO2) {
    const c2 = await postJson(td, '/offers/customer/counter', { workOrderId: WO2, ...COUNTER }); const coId2 = c2.body?.data?.id || c2.body?.id; await sleep(2_500);
    const subCo2 = await counterOf(sub, WO2); const subDetail = await getJson(sub, `/workOrders/${WO2}`);
    info(`B1. owner created WO ${WO2}; sub-user view: WO detail ${subDetail.status}, counter`, brief(subCo2));
    let subUi = null;
    { const { ctx, page } = await newPage(browser, subAcc);
      await page.goto(`/workOrder/proposals/${WO2}?fromCustomerBoard=true`); await page.waitForTimeout(5_000);
      const art = page.locator('article').first(); const at = (await art.innerText().catch(() => '')).replace(/\s+/g, ' ');
      const btn = art.getByRole('button', { name: 'Accept', exact: true }); const vis = await btn.isVisible().catch(() => false);
      const s = await shot(page, 'subuser-proposals-owner-wo'); subUi = { card: at.slice(0, 300), acceptVisible: vis, shot: s };
      if (vis) { await btn.click(); await page.waitForTimeout(1_000); const dlg = page.locator('[role=dialog], .MuiModal-root:visible, .MuiDialog-root:visible').last(); await dlg.getByRole('button', { name: 'Accept', exact: true }).last().click().catch(() => { }); await page.waitForTimeout(4_000); subUi.after = (await bodyText(page)).slice(0, 200); subUi.shot2 = await shot(page, 'subuser-after-accept-attempt'); }
      await ctx.close(); }
    const co2 = await counterOf(td, WO2);
    let apiTry = null; if (co2.data?.status === 'PENDING') { apiTry = await postJson(sub, `/offers/customer/counter/accept/${coId2}`, {}); }
    const co2b = await counterOf(td, WO2);
    info('B2. sub-user accepting the counter on the OWNER\'s work order: UI + API result', { ui: subUi, apiAccept: apiTry && { status: apiTry.status, body: JSON.stringify(apiTry.body).slice(0, 150) }, counterNow: brief(co2b) });
  }

  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  log(`\nSUMMARY WO ${WO} #${REF} (sub-user) / WO ${results.wo2} (owner)\n${summary}\nFINDINGS: ${results.findings.length}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2)); fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
