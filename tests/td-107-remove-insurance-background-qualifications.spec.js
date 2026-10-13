// TD-107: "Need to remove Background check & Insurance from the Qualification section in Dev."
// https://techdomain.atlassian.net/browse/TD-107  (label: Backend, no description)
//
// Reading: the qualification TYPES "Insurance" (id 3) and "Background check" (id 4) must no longer be offered anywhere
// a qualification is picked - work order "Qualification Type" selector, engineer profile, admin Manage > Qualifications -
// and the backend must not return / accept them any more.
//
// Part A (API): GET /qualifications, GET /qualifications/subQualifications, GET /qualifications/subQualificationsByQualificationId/{3,4},
//   POST /users/qualifications with an Insurance / Background-check sub-type (should be rejected), legacy data still stored.
// Part B (UI): Tech Domain "Create New Work Order" > Qualification Type options; engineer Profile Settings (Insurance section,
//   Background Verification section, legacy rows); admin Manage > Qualifications; WO 242 (legacy Background check) details.
//
// Run:  npx playwright test tests/td-107-remove-insurance-background-qualifications.spec.js
// Evidence: evidence/TD-107-QualificationTypes/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-107-QualificationTypes', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const REMOVED = /insurance|background/i;
const INSURANCE_SUBTYPE = 71;   // "Professional Liability/Indemnity" (type 3 Insurance)
const BACKGROUND_SUBTYPE = 78;  // "Any Age" (type 4 Background check)
const LEGACY_WO = 242;          // template WO that still references sub-type 78

test.setTimeout(600_000);
let shotNo = 0;
async function shot(page, name, full = false) { shotNo += 1; const f = path.join(EVIDENCE, `TD-107_Qual_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: full }).catch(() => { }); return path.basename(f); }
async function apiLogin(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({})); await ctx.dispose();
  if (!body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${res.status()}`);
  return { api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } }), id: body.data?.id };
}
async function call(s, method, p, data) { const r = await s.api[method](u(p), data === undefined ? undefined : { data }); return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) }; }
const getJson = (s, p) => call(s, 'get', p);
const postJson = (s, p, d) => call(s, 'post', p, d);
const delJson = (s, p) => call(s, 'delete', p);
async function uiLogin(page, account) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first().fill(account.email);
  await page.locator('input[type="password"]').first().fill(account.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in")').first().click();
  await expect(page).not.toHaveURL(/\/login|sign-?in/i, { timeout: 30_000 });
  await page.waitForTimeout(2_500);
}
const texts = async (loc) => (await loc.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
const bodyText = async (page) => (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
const hits = (txt) => (txt.match(/.{0,60}(insurance|background ?check|background verification).{0,60}/gi) || []).slice(0, 8);

test('TD-107 Insurance & Background check removed from qualifications', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, checks: [], findings: [], api: {}, ui: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 600)}`); };
  const tdAcc = accounts.find((a) => a.role === 'TechDomain User');
  const engAcc = accounts.find((a) => a.role === 'Individual Engineer');
  const admAcc = accounts.find((a) => a.role === 'Admin');
  const td = await apiLogin(tdAcc), eng = await apiLogin(engAcc), adm = await apiLogin(admAcc);

  // ---------------- Part A: API ----------------
  for (const [who, s] of [['engineer', eng], ['techdomain', td], ['admin', adm]]) {
    const q = await getJson(s, '/qualifications');
    const names = (q.body?.data?.data || []).map((x) => `${x.id}:${x.name}`);
    results.api[`qualifications_${who}`] = names;
    check(`A1 ${who}: GET /qualifications no longer lists Insurance / Background check`, q.status === 200 && names.length > 0 && !names.some((n) => REMOVED.test(n)), { status: q.status, names });
  }
  check('A1: the remaining types are Certification, Licences, Equipment', ['Certification', 'Licences', 'Equipment'].every((n) => results.api.qualifications_engineer.some((x) => x.endsWith(':' + n))) && results.api.qualifications_engineer.length === 3, { names: results.api.qualifications_engineer });

  const sub = await getJson(eng, '/qualifications/subQualifications?limit=5000&page=1');
  const subs = sub.body?.data?.data || [];
  const subTypes = [...new Set(subs.map((x) => `${x.qualificationType?.id}:${x.qualificationType?.name}`))];
  const badSubs = subs.filter((x) => REMOVED.test(x.qualificationType?.name || ''));
  check('A2: GET /qualifications/subQualifications contains no Insurance / Background-check sub-types', sub.status === 200 && subs.length > 0 && badSubs.length === 0, { total: sub.body?.data?.total ?? subs.length, types: subTypes, bad: badSubs.slice(0, 5).map((x) => `${x.id}:${x.name}`) });
  for (const [id, label] of [[3, 'Insurance'], [4, 'Background check']]) {
    const r = await getJson(eng, `/qualifications/subQualificationsByQualificationId/${id}`);
    check(`A3: sub-qualifications of type ${id} (${label}) are empty`, r.status === 200 && Array.isArray(r.body?.data) && r.body.data.length === 0, { status: r.status, n: r.body?.data?.length });
  }

  // A4: the backend should refuse to store a removed sub-type on the engineer
  const before = (await getJson(eng, '/users/qualifications')).body?.data || [];
  const legacy = before.filter((x) => REMOVED.test(x.qualificationType || ''));
  info('A5: engineer 575 legacy qualifications still stored (Insurance / Background check rows)', { legacy: legacy.map((x) => `${x.id}:${x.qualificationType}/${x.qualificationSubType}`), total: before.length });
  const created = [];
  for (const [subId, label] of [[INSURANCE_SUBTYPE, 'Insurance "Professional Liability/Indemnity"'], [BACKGROUND_SUBTYPE, 'Background check "Any Age"']]) {
    const r = await postJson(eng, '/users/qualifications', { qualificationSubTypeId: subId });
    const newId = r.body?.data?.id;
    if (r.status < 300 && newId && !before.some((x) => x.id === newId)) created.push(newId);
    check(`A4: POST /users/qualifications with removed sub-type ${subId} (${label}) is rejected`, r.status >= 400, { status: r.status, message: r.body?.message, returnedId: newId, returnedType: r.body?.data?.qualificationSubType?.qualificationType?.name });
  }
  for (const id of created) { const d = await delJson(eng, `/users/qualifications/${id}`); log(`cleanup: DELETE users/qualifications/${id} -> ${d.status}`); }
  const wo = (await getJson(td, `/workOrders/${LEGACY_WO}`)).body?.data || {};
  info(`A6: legacy work order ${LEGACY_WO} still carries a Background-check requirement`, { qualificationSubTypes: (wo.qualificationSubTypes || []).map((q) => `${q.id}:${q.name} (${q.qualificationType?.name})`) });

  // ---------------- Part B: UI ----------------
  // B1 Tech Domain: Create New Work Order > Qualification Type
  let ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  let page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  await uiLogin(page, tdAcc);
  await page.goto('/workOrder/create/summary'); await page.waitForTimeout(5_000);
  const qLabel = page.locator('label').filter({ hasText: /qualification type/i }).first();
  await qLabel.scrollIntoViewIfNeeded().catch(() => { });
  const qInput = page.locator('[id="select-Qualification Type"]').first();
  await qInput.click();
  await page.waitForTimeout(1_500);
  const qOptions = await texts(page.locator('[role="option"], .MuiAutocomplete-option'));
  await shot(page, 'td-create-wo-qualification-type');
  log(`Qualification Type options: ${qOptions.join(' | ')}`);
  results.ui.qualificationTypeOptions = qOptions;
  check('B1: Create Work Order > "Qualification Type" offers no Insurance / Background check', qOptions.length > 0 && !qOptions.some((o) => REMOVED.test(o)), { options: qOptions });
  check('B1: Create Work Order > "Qualification Type" = Certification, Equipment, Licences', ['Certification', 'Equipment', 'Licences'].every((o) => qOptions.includes(o)) && qOptions.length === 3, { options: qOptions });
  await page.keyboard.press('Escape');
  const helpText = await bodyText(page);
  info('B1: static help text on the create page mentioning insurance', { snippets: hits(helpText) });
  // B4 legacy WO details
  await page.goto(`/workOrder/details/${LEGACY_WO}`); await page.waitForTimeout(5_000);
  const legacyTxt = await bodyText(page);
  await shot(page, 'td-wo242-legacy-background-check', true);
  info(`B4: work order ${LEGACY_WO} details page still shows the legacy Background-check qualification`, { snippets: hits(legacyTxt) });
  await ctx.close();

  // B2 engineer profile settings
  ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, geolocation: { latitude: 31.52, longitude: 74.36 }, permissions: ['geolocation'] });
  page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  await uiLogin(page, engAcc);
  await page.goto('/user/settings'); await page.waitForTimeout(4_000);
  const personalHeadings = await texts(page.locator('h1,h2,h3,h4,h5,h6'));
  const personalTxt = await bodyText(page);
  await shot(page, 'eng-personal-info', true);
  log(`engineer Personal Info headings: ${personalHeadings.join(' | ')}`);
  results.ui.engineerPersonalHeadings = personalHeadings;
  const insHeading = page.locator('h1,h2,h3,h4,h5,h6').filter({ hasText: /^insurance$/i }).first();
  const insPresent = (await insHeading.count()) > 0;
  check('B2: engineer Profile Settings > Personal Info has no "Insurance" qualification section', !insPresent, { headings: personalHeadings });
  let insuranceModal = null;
  if (insPresent) {
    const sec = insHeading.locator('xpath=ancestor::div[2]');
    const secText = (await sec.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const legacyShown = /liability|indemnity|QA Ins|policy/i.test(secText.replace(/^Insurance/, ''));
    info('B2: legacy Insurance rows rendered in the Insurance section', { sectionText: secText.slice(0, 300), legacyShown });
    await sec.locator('i.fa-circle-plus, button, svg').first().click({ force: true }).catch(() => { });
    await page.waitForTimeout(2_000);
    const dlg = page.locator('[role="dialog"], .MuiModal-root').last();
    const dlgText = (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const typeCtl = dlg.locator('[role="combobox"], .MuiSelect-select, input').first();
    await typeCtl.click({ force: true }).catch(() => { });
    await page.waitForTimeout(1_200);
    const insOptions = await texts(page.locator('[role="option"], .MuiAutocomplete-option, .MuiMenuItem-root'));
    await shot(page, 'eng-upload-insurance-modal');
    insuranceModal = { text: dlgText.slice(0, 300), options: insOptions };
    info('B2: "+" on the Insurance section still opens "Upload Insurance"; Insurance Type options', insuranceModal);
    check('B2: no Insurance sub-type can be chosen in the Upload Insurance modal', insOptions.length === 0 || insOptions.every((o) => /no options/i.test(o)), { options: insOptions });
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await dlg.locator('button', { hasText: /cancel/i }).first().click({ force: true }).catch(() => { });
    await page.waitForTimeout(800);
  }
  await page.locator('[role="tab"], .MuiTab-root').filter({ hasText: /^profile$/i }).first().click();
  await page.waitForTimeout(4_000);
  const profileHeadings = await texts(page.locator('h1,h2,h3,h4,h5,h6'));
  const profileTxt = await bodyText(page);
  await shot(page, 'eng-profile-tab', true);
  log(`engineer Profile headings: ${profileHeadings.join(' | ')}`);
  results.ui.engineerProfileHeadings = profileHeadings;
  check('B2: engineer Profile tab shows no "Insurance" section', !profileHeadings.some((h) => /insurance/i.test(h)), { headings: profileHeadings });
  const bgHeading = page.locator('h1,h2,h3,h4,h5,h6').filter({ hasText: /background/i }).first();
  const bgPresent = (await bgHeading.count()) > 0;
  // "Background Verification" on the Profile tab is the Education / Working-Rights document upload, not the removed "Background check" qualification type
  info('B2: engineer Profile tab "Background Verification" section present (document upload feature, not the qualification type)', { present: bgPresent });
  check('B2: legacy "Any Age" (Background check) and "Professional Liability" (Insurance) rows are not rendered on the Profile tab', !/any age|professional liability|indemnity/i.test(profileTxt), { snippets: hits(profileTxt) });
  if (bgPresent) {
    const sec = bgHeading.locator('xpath=ancestor::div[2]');
    info('B2: Background Verification section content', { text: (await sec.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300) });
    await sec.locator('i.fa-circle-plus, button, svg').first().click({ force: true }).catch(() => { });
    await page.waitForTimeout(2_000);
    const dlg = page.locator('[role="dialog"], .MuiModal-root').last();
    const dlgText = (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ');
    const typeCtl = dlg.locator('[role="combobox"], .MuiSelect-select, input').first();
    await typeCtl.click({ force: true }).catch(() => { });
    await page.waitForTimeout(1_200);
    const bgOptions = await texts(page.locator('[role="option"], .MuiAutocomplete-option, .MuiMenuItem-root'));
    await shot(page, 'eng-background-verification-modal');
    info('B2: "+" on Background Verification opens a modal; its type options', { text: dlgText.slice(0, 300), options: bgOptions });
    check('B2: no Background-check sub-type can be chosen in the Background Verification modal', bgOptions.length === 0 || bgOptions.every((o) => /no options/i.test(o)), { options: bgOptions });
    await page.keyboard.press('Escape');
  }
  await ctx.close();

  // B3 admin Manage > Qualifications
  ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await ctx.newPage(); page.setDefaultTimeout(20_000);
  await uiLogin(page, admAcc);
  await page.locator('a, button, div, span').filter({ hasText: /^manage$/i }).first().click().catch(() => { });
  await page.waitForTimeout(1_500);
  await shot(page, 'admin-manage-menu');
  const qLink = page.locator('a, button, [role="menuitem"], li, p, span').filter({ hasText: /^qualifications$/i }).first();
  let adminTxt = '', adminTabs = [];
  if (await qLink.count()) {
    await qLink.click(); await page.waitForTimeout(5_000);
    adminTxt = await bodyText(page);
    adminTabs = await texts(page.locator('[role="tab"], .MuiTab-root, h1,h2,h3,h4,h5,h6, .MuiDataGrid-columnHeaderTitle, th'));
    await shot(page, 'admin-qualifications', true);
    log(`admin Qualifications page ${page.url()} :: ${adminTabs.slice(0, 30).join(' | ')}`);
    // try the type filter / dropdown if present
    const typeSel = page.locator('[id*="Qualification" i][role="combobox"], [role="combobox"]').first();
    let adminTypeOptions = [];
    if (await typeSel.count()) { await typeSel.click({ force: true }).catch(() => { }); await page.waitForTimeout(1_200); adminTypeOptions = await texts(page.locator('[role="option"], .MuiAutocomplete-option, .MuiMenuItem-root')); await shot(page, 'admin-qualifications-type-dropdown'); await page.keyboard.press('Escape'); }
    results.ui.admin = { url: page.url(), tabs: adminTabs.slice(0, 40), typeOptions: adminTypeOptions, snippets: hits(adminTxt) };
    info('B3: admin Manage > Qualifications page content', results.ui.admin);
    check('B3: admin Manage > Qualifications offers no Insurance / Background check type', !adminTabs.some((t) => REMOVED.test(t)) && !adminTypeOptions.some((t) => REMOVED.test(t)) && !/insurance|background check/i.test(adminTxt), { tabs: adminTabs.filter((t) => REMOVED.test(t)), typeOptions: adminTypeOptions, snippets: hits(adminTxt) });
  } else info('B3: admin Manage > Qualifications link not found', {});
  await ctx.close();

  const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
  for (const c of results.checks) if (!c.ok) results.findings.push(c.name);
  log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
});
