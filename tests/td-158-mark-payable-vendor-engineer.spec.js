// TD-158 "Mark payable not working when work order is assigned to vendor's engineer" (Backend, Hotfix)
// https://techdomain.atlassian.net/browse/TD-158
//
// Web app rule: Tech Domain sees "Mark Payable" on a work order whose status is CANCELLED (customerStatus null);
// confirm -> POST /workOrders/:id/markPayable -> toast "Work Order Payable" -> status stays CANCELLED, customerStatus = CANCELLED_PAYABLE (badge "Cancelled -> Payable").
// Test: two Tech Domain work orders (template 242), one assigned to the VENDOR MEMBER (611 via owner 609, company 79),
// one to the individual engineer (575) as control; Tech Domain cancels both while ASSIGNED and marks them payable
// from the UI (API fallback). Expected: both reach CANCELLED_PAYABLE and the engineer payment is shown.
//
// Run:  npx playwright test tests/td-158-mark-payable-vendor-engineer.spec.js --reporter=line --trace off
// Evidence: evidence/TD-158-MarkPayableVendorEngineer/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-158-MarkPayableVendorEngineer', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const TEMPLATE_WO = Number(process.env.TEMPLATE_WO || 242);

test.setTimeout(900_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-158_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status}`);
  const s = { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), id: l.body.data?.id, name: `${l.body.data?.firstName || ''} ${l.body.data?.lastName || ''}`.trim() };
  s.relogin = async () => { const n = await rawLogin(account.email, account.password); if (!n.body.accessToken) return false; s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${n.body.accessToken}` } }); return true; };
  return s;
}
async function call(s, method, p, data) { const opts = data === undefined ? undefined : { data }; let r = await s.api[method](u(p), opts); if (r.status() === 401 && (await s.relogin())) r = await s.api[method](u(p), opts); return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) }; }
const getJson = (s, p) => call(s, 'get', p); const postJson = (s, p, d) => call(s, 'post', p, d); const patchJson = (s, p, d) => call(s, 'patch', p, d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const woBrief = (w) => ({ id: w.id, ref: w.referenceId, status: w.status, subStatus: w.subStatus, customerStatus: w.customerStatus, engineer: w.engineer?.id, engineerCompany: w.engineerCompany?.id, cancellationReason: w.cancellationReason });
const engPay = (p) => { const c = p?.engineerRates || {}; return { hourlyRate: c.hourlyRate, minimumHours: c.minimumHours, totalHoursApproved: c.totalHoursApproved, totalLabourCost: c.totalLabourCost, totalWorkOrderCost: c.totalWorkOrderCost, grandTotal: c.grandTotal }; };
async function uiLogin(page, account) { await page.goto('/login', { waitUntil: 'networkidle' }); await page.locator('input[type="email"], input[name="email"]').first().fill(account.email); await page.locator('input[type="password"]').first().fill(account.password); await page.locator('button[type="submit"]').first().click(); await expect(page).not.toHaveURL(/\/login/i, { timeout: 60_000 }); await page.waitForTimeout(3_000); }
const bodyText = async (page) => (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');

test('TD-158: Mark Payable on a cancelled work order assigned to a vendor engineer (and to a freelancer as control)', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, ticket: 'TD-158', checks: [], findings: [], scenarios: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };

  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const td = await apiLogin(tdAcc, 'Tech Domain');
  const vendor = await apiLogin(accounts.find((a) => a.role === 'Vendor'), 'Vendor owner');
  const worker = await apiLogin(accounts.find((a) => a.role === 'Vendor Engineer'), 'Vendor engineer');
  const eng = await apiLogin(accounts.find((a) => a.role === 'Individual Engineer'), 'Engineer');
  const t = (await getJson(td, `/workOrders/${TEMPLATE_WO}`)).body?.data; expect(t, 'template readable').toBeTruthy();
  log(`Tech Domain ${td.id}; vendor ${vendor.id} "${vendor.name}", member ${worker.id} "${worker.name}"; engineer ${eng.id} "${eng.name}"; template client ${t.client?.id} "${t.client?.name || ''}"`);

  const createWo = async (title) => {
    const minute = Math.floor(Date.now() / 60_000); const start = new Date(Date.now() + (120 + (minute % 60)) * 86_400_000); start.setUTCHours(3 + (minute % 10), 0, 0, 0); const day = start.toISOString().slice(0, 10), hm = start.toISOString().slice(11, 16);
    const payload = { templateId: null, title, serviceLevelAgreeement: t.serviceLevelAgreeement || '', clientId: t.client?.id, projectId: t.project?.id || null, teamId: t.team?.id, secondaryTeamId: t.secondaryTeam?.id || null, teamName: t.team?.name, secondaryTeamName: t.secondaryTeam?.name || '', isExportDisable: false, isCounterOffersDisable: false, isGpsRequire: false, incidentId: '', description: 'TD-158 QA automation', confidentialInformation: '', categoryId: t.category?.id, workOrderServices: (t.workOrderServices || []).map((s) => ({ serviceId: s.serviceId || s.id })), scheduleType: 'HARD_START', orderStartDate: `${day}T00:00:00`, orderStartTime: `${day}T${hm}:00`, orderEndDate: null, orderEndTime: null, timeZone: 'UTC', addressId: t.address?.id || t.addressId, qualificationSubTypes: [], expenses: [], paymentType: 'HOURLY', paymentTerms: t.paymentTerms || '15 days', currency: t.currency || 'USD', hourlyRate: t.hourlyRate || 20, minimumHours: t.minimumHours || 4, nonBusinessHourRate: null, purchaseOrderNumber: '', additionalHourlyRate: null, halfDayRate: null, fullDayRate: null, fthRate: null, customHours: null, customHoursRate: null, fixedAmount: null, engineerExpenses: [], engineerPaymentType: 'HOURLY', engineerCurrency: 'USD', engineerHourlyRate: 15, engineerAdditionalHourlyRate: null, engineerHalfDayRate: null, engineerFullDayRate: null, engineerFthRate: null, engineerFixedAmount: null, engineerMinimumHours: 4, isDraft: false, tasks: ['START_TIME', 'ON_THE_WAY', 'RUNNING_LATE', 'MARK_COMPLETE', 'CHECK_IN', 'CHECK_OUT', 'CLOSE_NOTES'].map((tt) => ({ taskType: tt, title: tt, emailsToNotify: [] })), contacts: [], workOrderManagerId: t.workOrderManager?.id || null, customerFiles: [] };
    const r = await postJson(td, '/workOrders', payload); const id = r.body?.data?.id || r.body?.id; log(`create "${title}" -> ${r.status} id ${id} ${JSON.stringify(r.body).slice(0, 120)}`); return id;
  };

  const scenarios = [
    { key: 'vendor', label: 'vendor engineer (member 611 of company 79)', assign: async (wo) => { const route = await postJson(td, '/offers/route', { workOrderId: wo, userId: vendor.id }); const offerId = route.body?.data?.id || (route.body?.data || [])[0]?.id; const acc = await postJson(vendor, `/offers/route/accept/${offerId}`, { referredEngineerId: worker.id }); const asg = await postJson(td, '/offers/assign', { workOrderId: wo, userId: vendor.id, referredEngineerId: worker.id }); return { route: route.status, accept: acc.status, assign: asg.status, assignBody: JSON.stringify(asg.body).slice(0, 150) }; }, engineerId: worker.id, companyId: 79 },
    { key: 'freelancer', label: 'individual engineer 575 (control)', assign: async (wo) => { const route = await postJson(td, '/offers/route', { workOrderId: wo, userIds: [eng.id] }); const offerId = (route.body?.data || [])[0]?.id || route.body?.data?.id; const acc = await postJson(eng, `/offers/route/accept/${offerId}`, {}); const asg = await postJson(td, '/offers/assign', { workOrderId: wo, userId: eng.id }); return { route: route.status, accept: acc.status, assign: asg.status, assignBody: JSON.stringify(asg.body).slice(0, 150) }; }, engineerId: eng.id, companyId: null },
  ];

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage(); page.setDefaultTimeout(30_000); await uiLogin(page, tdAcc);
  for (const sc of scenarios) {
    const S = results.scenarios[sc.key] = {};
    const WO = await createWo(`TD-158 ${sc.key} mark payable ${RUN}`); expect(WO, `${sc.key} WO created`).toBeTruthy(); S.wo = WO;
    const a = await sc.assign(WO); await sleep(2_500);
    let wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; S.ref = wo.referenceId; S.assigned = woBrief(wo);
    check(`${sc.key}-1. WO ${WO} (#${wo.referenceId}) assigned to ${sc.label}`, wo.status === 'ASSIGNED' && wo.engineer?.id === sc.engineerId && (sc.companyId === null || wo.engineerCompany?.id === sc.companyId), { ...a, wo: woBrief(wo) });
    expect(wo.status, 'must be ASSIGNED').toBe('ASSIGNED');
    // Tech Domain cancels while ASSIGNED
    const can = await postJson(td, `/workOrders/client/cancel/${WO}`, { cancellationReason: 'CLIENT_REQUESTED', reason: 'TD-158 QA: cancel to test Mark Payable' });
    await sleep(2_500); wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {}; S.cancelled = woBrief(wo);
    check(`${sc.key}-2. Tech Domain cancelled the assigned work order -> CANCELLED`, can.status < 300 && wo.status === 'CANCELLED', { cancel: can.status, body: JSON.stringify(can.body).slice(0, 120), wo: woBrief(wo) });
    const payBefore = engPay((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data); S.payBefore = payBefore;
    info(`${sc.key}: engineer estimated payment while CANCELLED`, payBefore);
    // UI: Mark Payable button
    await page.goto(`/workOrder/details/${WO}`); await page.waitForTimeout(5_000);
    const btns = await page.getByRole('button').allInnerTexts().catch(() => []); const txt0 = await bodyText(page);
    const s1 = await shot(page, `${sc.key}-cancelled-detail`);
    const mp = page.getByRole('button', { name: 'Mark Payable', exact: true }).first(); const visible = await mp.isVisible().catch(() => false);
    check(`${sc.key}-3. Tech Domain detail page of the CANCELLED work order shows the "Mark Payable" button`, visible, { buttons: btns.filter((b) => b.trim()).slice(0, 15), customerStatus: wo.customerStatus, shot: s1 });
    let via = null, toast = null, errToast = null, apiLog = [];
    page.on('response', (r) => { if (/markPayable/.test(r.url())) apiLog.push(`${r.request().method()} ${r.url().replace(/.*\/api/, '')} -> ${r.status()}`); });
    if (visible) {
      await mp.click(); await page.waitForTimeout(1_500);
      const dlg = page.locator('[role=dialog], .MuiModal-root:visible, .MuiDialog-root:visible').last(); const dt = (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ');
      const s2 = await shot(page, `${sc.key}-confirm-payable-dialog`); info(`${sc.key}: confirm dialog`, { text: dt.slice(0, 200), shot: s2 });
      await dlg.getByRole('button', { name: 'Mark Payable', exact: true }).last().click().catch(() => { });
      for (let i = 0; i < 16; i++) { await page.waitForTimeout(500); const tx = await bodyText(page); if (/Work Order Payable/i.test(tx)) { toast = 'Work Order Payable'; break; } const m = tx.match(/(error|failed|not found|cannot|unable|something went wrong)[^.]{0,120}/i); if (m && !/No rows/.test(m[0])) { errToast = m[0]; } }
      await page.waitForTimeout(3_000); via = 'ui';
      S.uiAfter = { toast, errToast, api: apiLog }; const s3 = await shot(page, `${sc.key}-after-mark-payable`); S.uiAfter.shot = s3;
    }
    wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    if (wo.customerStatus !== 'CANCELLED_PAYABLE') { // API fallback / direct check of the backend
      const r = await postJson(td, `/workOrders/${WO}/markPayable`, {}); S.apiMarkPayable = { status: r.status, body: JSON.stringify(r.body).slice(0, 300) }; log(`${sc.key}: POST markPayable (fallback) -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); via = via ? 'ui+api' : 'api'; await sleep(2_500); wo = (await getJson(td, `/workOrders/${WO}`)).body?.data || {};
    }
    S.final = woBrief(wo); S.via = via;
    check(`${sc.key}-4. Mark Payable works for the ${sc.label}: status CANCELLED_PAYABLE (via ${via}; toast "${toast}")`, wo.customerStatus === 'CANCELLED_PAYABLE' && wo.status === 'CANCELLED', { via, toast, errToast, api: apiLog, apiFallback: S.apiMarkPayable, wo: woBrief(wo) });
    const payAfter = engPay((await getJson(td, `/workOrders/estimatedPayment/${WO}`)).body?.data); S.payAfter = payAfter;
    info(`${sc.key}: engineer estimated payment after Mark Payable (15/h x 4 min h = 60 expected)`, payAfter);
    await page.goto(`/workOrder/details/${WO}`); await page.waitForTimeout(5_000); const tx = await bodyText(page); const s4 = await shot(page, `${sc.key}-payable-detail`);
    await page.getByRole('tab', { name: /Payment/i }).first().click().catch(() => { }); await page.waitForTimeout(3_000); const pt = await bodyText(page); const s5 = await shot(page, `${sc.key}-payable-payment-tab`);
    check(`${sc.key}-5. Tech Domain UI shows the "Payable" badge and the engineer payment on the Payment tab`, /Payable/.test(tx) && /Engineer Rates/.test(pt), { badge: /Payable/.test(tx), paymentTab: pt.slice(pt.indexOf('Engineer Rates'), pt.indexOf('Engineer Rates') + 250), shots: [s4, s5] });
    // engineer side view
    const engSide = await getJson(sc.key === 'vendor' ? worker : eng, `/workOrders/${WO}`); const ownerSide = sc.key === 'vendor' ? await getJson(vendor, `/workOrders/${WO}`) : null;
    info(`${sc.key}: engineer-side view of the payable work order`, { engineer: engSide.status + ' ' + (engSide.body?.data?.status || ''), vendorOwner: ownerSide && ownerSide.status + ' ' + (ownerSide.body?.data?.status || '') });
    page.removeAllListeners('response');
  }
  await ctx.close();

  const v = results.scenarios.vendor, f = results.scenarios.freelancer;
  const verdict = v?.final?.customerStatus === 'CANCELLED_PAYABLE' ? 'PASS (fixed)' : 'FAIL (bug still present)';
  results.verdict = verdict;
  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  log(`\nTD-158 VERDICT: ${verdict} | vendor WO ${v?.wo} #${v?.ref} -> ${v?.final?.status} | freelancer WO ${f?.wo} #${f?.ref} -> ${f?.final?.status}\n${summary}\nFINDINGS: ${results.findings.length}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2)); fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), `TD-158 VERDICT: ${verdict}\n${summary}\n`);
});
