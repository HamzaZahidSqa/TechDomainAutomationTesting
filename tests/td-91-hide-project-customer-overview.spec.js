// TD-91: "Hide project details from overview for customer role"  (label: Frontend, no description)
// https://techdomain.atlassian.net/browse/TD-91
//
// Reading: on the work order details page the "Overview" card (Company / Incident ID / Client / Project / SLA ...) must not
// show the Project row to CUSTOMER users (owner and sub-user), and the customer's "Edit Overview" form must not offer a
// Project field. CLIENT (Tech Domain) users keep seeing it.
//
// Part A (API, info only - backend is out of scope for a Frontend ticket): what GET /workOrders/:id and
//   GET /workOrders/customer return to a customer (project object still present?).
// Part B (UI): B1 customer owner WO details Overview, B2 customer "Edit Overview" form, B3 other tabs + create form,
//   B4 customer sub-user Overview, B5 control: Tech Domain user sees "Project:" + "Project *" in the edit form,
//   B6 observations: customer Work Orders grid "Project" column, dashboard.
//
// Run:  npx playwright test tests/td-91-hide-project-customer-overview.spec.js --reporter=line --trace off
// Evidence: evidence/TD-91-CustomerOverviewProject/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-91-CustomerOverviewProject', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const CUSTOMER_WO = Number(process.env.CUSTOMER_WO || 867);      // customer 93 WO with project "TD36 QA Project" (APPROVED)
const CUSTOMER_WO_EDITABLE = Number(process.env.CUSTOMER_WO_EDITABLE || 909); // PUBLISHED -> Overview pencil available
const CLIENT_WO = Number(process.env.CLIENT_WO || 252);          // Tech Domain WO with project "DC Project"
const PROJECT_ROW = /project\s*:/i;                               // the Overview row label "Project:"

test.setTimeout(600_000);
let shotNo = 0;
async function shot(target, name, full = false) { shotNo += 1; const f = path.join(EVIDENCE, `TD-91_CustomerOverview_${String(shotNo).padStart(2, '0')}_${name}.png`); await target.screenshot({ path: f, fullPage: full }).catch(() => { }); return path.basename(f); }
async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({})); await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`);
  return { api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } }), id: body.data?.id, role: body.data?.role?.role };
}
const getJson = async (s, p) => { const r = await s.api.get(u(p)); return { status: r.status(), body: await r.json().catch(() => null) }; };
async function uiLogin(page, account) {
  await page.goto('/login'); await page.waitForTimeout(2_000);
  await page.locator('input[type="email"], input[name="email"]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login")').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 });
  await page.waitForTimeout(3_000);
}
const texts = async (loc) => (await loc.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
const bodyText = async (page) => (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
const projectHits = (txt) => (txt.match(/.{0,50}project.{0,50}/gi) || []).filter((h) => !/helps providers understand your project/i.test(h)).slice(0, 8);
const overviewCard = (page) => page.locator('h6').filter({ hasText: /^overview$/i }).first().locator('xpath=ancestor::div[contains(@class,"MuiPaper-root")][1]');
async function readOverview(page, woId) {
  await page.goto(`/workOrder/details/${woId}`);
  await page.waitForResponse((r) => /\/workOrders\/\d+/.test(r.url()) && r.request().method() === 'GET', { timeout: 30_000 }).catch(() => null);
  await page.waitForTimeout(4_000);
  const card = overviewCard(page);
  const present = await card.count();
  const txt = present ? (await card.innerText()).replace(/\s+/g, ' ') : '';
  const rows = present ? await texts(card.locator('p.font-normal')) : [];
  return { present, txt, rows, pencils: present ? await card.locator('i.fa-pencil').count() : 0, tabs: await texts(page.locator('[role="tab"]')) };
}

test('TD-91 Project details hidden from the work order Overview for customers', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, checks: [], findings: [], api: {}, ui: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 600)}`); };
  const custAcc = accounts.find((a) => a.role === 'Customer');
  const subAcc = accounts.find((a) => a.role === 'Customer User');
  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');

  // ---------------- Part A: API (info) ----------------
  const cust = await apiLogin(custAcc);
  const det = await getJson(cust, `/workOrders/${CUSTOMER_WO}`);
  const wo = det.body?.data || det.body;
  results.api.customerDetails = { status: det.status, role: cust.role, project: wo?.project || null, client: wo?.client?.clientName };
  info(`A1: customer GET /workOrders/${CUSTOMER_WO} still returns the project object (backend, out of scope)`, results.api.customerDetails);
  check('A1: the test WO really has a project (precondition)', det.status === 200 && !!wo?.project?.title, { project: wo?.project });
  const list = await getJson(cust, '/workOrders/customer?page=1&limit=50');
  const rows = list.body?.data?.workOrders || list.body?.data?.data || [];
  results.api.customerList = { status: list.status, count: rows.length, withProject: rows.filter((r) => r.project).length, sample: rows.slice(0, 3).map((r) => ({ id: r.id, status: r.status, project: r.project?.title })) };
  info('A2: customer GET /workOrders/customer rows carry project (backend, out of scope)', results.api.customerList);
  const editable = rows.find((r) => r.id === CUSTOMER_WO_EDITABLE) || rows.find((r) => /PUBLISHED|PENDING/.test(r.status));
  const editableId = editable?.id || CUSTOMER_WO_EDITABLE;
  await cust.api.dispose();

  // ---------------- Part B: UI ----------------
  const mk = async () => { const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, geolocation: { latitude: 31.52, longitude: 74.36 }, permissions: ['geolocation'] }); const page = await ctx.newPage(); page.setDefaultTimeout(15_000); return { ctx, page }; };

  // B1 customer owner - Overview card
  let { ctx, page } = await mk();
  await uiLogin(page, custAcc);
  const listHeaders = await texts(page.locator('.MuiDataGrid-columnHeaderTitle'));
  await shot(page, 'customer-work-orders-list', true);
  const ov = await readOverview(page, CUSTOMER_WO);
  await shot(overviewCard(page), 'customer-overview-card');
  await shot(page, 'customer-wo-details-full', true);
  results.ui.customerOverview = ov;
  check('B1: customer WO details has the Overview card', ov.present === 1, { tabs: ov.tabs });
  check('B1: customer Overview card has NO "Project:" row', ov.present === 1 && !PROJECT_ROW.test(ov.txt) && !/TD36 QA Project/.test(ov.txt), { overview: ov.txt.slice(0, 300), rows: ov.rows });
  check('B1: customer Overview still shows Company / Incident ID / Client / SLA', ['Company', 'Incident ID', 'Client', 'SLA'].every((l) => ov.rows.some((r) => r.startsWith(l))), { rows: ov.rows });
  const detailsTxt = await bodyText(page);
  check('B1: no project title anywhere on the customer Details tab', !/TD36 QA Project/.test(detailsTxt) && projectHits(detailsTxt).length === 0, { hits: projectHits(detailsTxt) });
  for (const t of ['Payment', 'Job Sign-Off']) {
    const tab = page.locator('[role="tab"]').filter({ hasText: new RegExp('^' + t, 'i') }).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(2_500); const tt = await bodyText(page); check(`B3: customer "${t}" tab shows no project details`, !/TD36 QA Project/.test(tt) && projectHits(tt).length === 0, { hits: projectHits(tt) }); }
  }

  // B2 customer owner - Edit Overview form
  const ov2 = await readOverview(page, editableId);
  results.ui.customerEditable = { id: editableId, status: editable?.status, pencils: ov2.pencils };
  if (ov2.pencils) {
    await overviewCard(page).locator('i.fa-pencil').first().click(); await page.waitForTimeout(3_000);
    const labels = await texts(page.locator('label:visible'));
    await shot(page, 'customer-edit-overview-form', true);
    results.ui.customerEditLabels = labels;
    check(`B2: customer "Edit Overview" form (WO ${editableId}) has no Project field`, labels.length > 0 && !labels.some((l) => /^project/i.test(l)), { labels });
    const cancel = page.locator('button:visible').filter({ hasText: /^cancel$/i }).first(); if (await cancel.count()) await cancel.click().catch(() => { });
  } else info(`B2: no editable customer WO found (WO ${editableId} has no Overview pencil)`, results.ui.customerEditable);

  // B3 customer create form + dashboard
  await page.goto('/workOrder/create/summary'); await page.waitForTimeout(5_000);
  const createLabels = await texts(page.locator('label:visible'));
  await shot(page, 'customer-create-wo-summary', true);
  check('B3: customer Create Work Order form has no Project field', createLabels.length > 0 && !createLabels.some((l) => /^project/i.test(l)), { labels: createLabels });
  await page.goto('/dashboard'); await page.waitForTimeout(4_000);
  const dashTxt = await bodyText(page);
  info('B6: customer dashboard project mentions', { hits: projectHits(dashTxt) });
  info('B6 (observation): customer Work Orders grid columns - "Project" column still present?', { headers: listHeaders, hasProjectColumn: listHeaders.some((h) => /^project$/i.test(h)) });
  await ctx.close();

  // B4 customer sub-user
  ({ ctx, page } = await mk());
  await uiLogin(page, subAcc);
  const ovSub = await readOverview(page, CUSTOMER_WO);
  await shot(overviewCard(page), 'customer-subuser-overview-card');
  results.ui.subUserOverview = ovSub;
  check('B4: customer sub-user Overview card has NO "Project:" row', ovSub.present === 1 && !PROJECT_ROW.test(ovSub.txt) && !/TD36 QA Project/.test(ovSub.txt), { overview: ovSub.txt.slice(0, 300) });
  await ctx.close();

  // B5 control: Tech Domain (CLIENT) user still sees the project
  ({ ctx, page } = await mk());
  await uiLogin(page, tdAcc);
  const ovTd = await readOverview(page, CLIENT_WO);
  await shot(overviewCard(page), 'techdomain-overview-card-with-project');
  results.ui.clientOverview = ovTd;
  check('B5 (control): Tech Domain user Overview still shows the "Project:" row', ovTd.present === 1 && PROJECT_ROW.test(ovTd.txt), { overview: ovTd.txt.slice(0, 300) });
  if (ovTd.pencils) {
    await overviewCard(page).locator('i.fa-pencil').first().click(); await page.waitForTimeout(3_000);
    const labels = await texts(page.locator('label:visible'));
    await shot(page, 'techdomain-edit-overview-form-with-project', true);
    check('B5 (control): Tech Domain "Edit Overview" form still has the Project field', labels.some((l) => /^project/i.test(l)), { labels: labels.filter((l) => /project|client|team/i.test(l)) });
  }
  await ctx.close();

  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  for (const c of results.checks) if (!c.ok) results.findings.push(c.name);
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
