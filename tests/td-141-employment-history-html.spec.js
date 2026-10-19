// TD-141 "Remove html tags from employment history display" (Frontend)
// https://techdomain.atlassian.net/browse/TD-141
//
// Background (bundle diff, 2026-10-16): the Employment description is saved as Quill HTML (modal "Description" rich-text editor).
// Production build main.3f79de71 rendered it in the profile view (/user/details/profile/:id, card "Employment") as plain text
// `<p className="text-xs">{description}</p>` -> raw "<p>...</p>" tags were visible to Tech Domain / admin / customer viewers.
// Dev build main.2a8246fe renders it with `<div className="ql-editor ..." dangerouslySetInnerHTML>` in all three places
// (profile view, own Profile Settings, Complete Your Profile card).
//
// Test: seed employment records via the API (rich HTML, HTML-injection probe, escaped literal), then check every display:
//   1. engineer own Profile Settings > Profile tab (Employment History card) + edit one record through the rich-text modal
//   2. Tech Domain (CLIENT) viewing /user/details/profile/<engineer>
//   3. Admin viewing the same (tabbed view)
//   4. Customer viewing the same
//   5. Vendor owner viewing own member's profile
//   6. PENDING engineer: /completeYourProfile > Profile Details > Employment History card
// Expected: formatted text shown, NO literal "<p>", "<strong>", "<ul>" etc. in the visible text, markup rendered as elements.
// Security probe: an <img onerror> description must NOT execute in the viewer's browser (dangerouslySetInnerHTML without sanitising = stored XSS).
//
// Run:  npx playwright test tests/td-141-employment-history-html.spec.js --reporter=line --trace off
// Env:  KEEP=1 keeps the seeded records (default: deleted at the end)
// Evidence: evidence/TD-141-EmploymentHistoryHtml/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const testAccounts = require(path.join(__dirname, '..', 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-141-EmploymentHistoryHtml', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const GEO = { geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'] };

test.setTimeout(900_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-141_EmploymentHistory_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status} ${JSON.stringify(l.body).slice(0, 200)}`);
  const s = { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), id: l.body.data?.id, role: l.body.data?.role?.role, status: l.body.data?.status, name: `${l.body.data?.firstName || ''} ${l.body.data?.lastName || ''}`.trim() };
  s.relogin = async () => { const n = await rawLogin(account.email, account.password); if (!n.body.accessToken) return false; s.api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${n.body.accessToken}` } }); return true; };
  return s;
}
async function call(s, method, p, data) { const opts = data === undefined ? undefined : { data }; let r = await s.api[method](u(p), opts); if (r.status() === 401 && (await s.relogin())) r = await s.api[method](u(p), opts); return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) }; }
const getJson = (s, p) => call(s, 'get', p); const postJson = (s, p, d) => call(s, 'post', p, d); const delJson = (s, p) => call(s, 'delete', p);
async function uiLogin(page, account) { await page.goto('/login', { waitUntil: 'networkidle' }); await page.locator('input[type="email"], input[name="email"]').first().fill(account.email); await page.locator('input[type="password"]').first().fill(account.password); await page.locator('button[type="submit"]').first().click(); await expect(page).not.toHaveURL(/\/login/i, { timeout: 60_000 }); await page.waitForTimeout(3_000); }

// Seed descriptions
const RICH = '<p>Led the <strong>network operations</strong> team for <em>enterprise</em> clients.</p><ul><li>Cisco &amp; Juniper routing</li><li>Firewall migrations</li></ul><p>Reported to the <u>CTO</u>.</p>';
const PROBE = '<p>Probe record</p><img src="x" onerror="window.__td141xss=(window.__td141xss||0)+1">';
const LITERAL = '<p>Typed literal &lt;tag&gt; and &lt;p&gt; text stays visible</p>';
const TAG_RE = /<\/?(p|strong|em|u|ul|ol|li|br|b|i|div|span|img)\b[^>]*>/i;

function employmentBody(company, designation, description, present = true) {
  return { companyName: company, designation, country: 'PK', city: 'Lahore', isPresent: present, startDate: '2021-03-01T00:00:00.000Z', endDate: present ? null : '2024-06-30T00:00:00.000Z', description };
}

test('TD-141: employment history description renders without raw HTML tags in every view', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, ticket: 'TD-141', bundle: null, checks: [], findings: [], seeded: [], views: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };

  // ---- bundle in use
  try { const ctx = await pwRequest.newContext(); const html = await (await ctx.get('https://dev.techdomain.com.au/')).text(); results.bundle = (html.match(/static\/js\/main\.[a-z0-9]+\.js/) || [])[0]; await ctx.dispose(); } catch { }
  info('dev bundle', results.bundle);

  // ---- API sessions
  const eng = await apiLogin(accounts.find((a) => a.role === 'Individual Engineer'), 'Engineer');
  const worker = await apiLogin(accounts.find((a) => a.role === 'Vendor Engineer'), 'Vendor engineer');
  const pendingAcc = testAccounts.find((a) => a.role === 'Individual Engineer');
  let pending = null; try { pending = await apiLogin(pendingAcc, 'Pending engineer'); } catch (e) { log(`pending engineer login failed: ${e.message}`); }
  log(`engineer ${eng.id} "${eng.name}" (${eng.status}); vendor engineer ${worker.id} "${worker.name}"; pending engineer ${pending?.id} (${pending?.status})`);

  // ---- seed records
  const seed = async (s, body) => { const r = await postJson(s, '/employment', body); const rec = r.body?.data || r.body; const id = rec?.id; results.seeded.push({ user: s.id, id, company: body.companyName, status: r.status }); return { status: r.status, id, rec }; };
  const richCo = `TD141 Rich Co ${RUN}`, probeCo = `TD141 Probe Co ${RUN}`, literalCo = `TD141 Literal Co ${RUN}`, workerCo = `TD141 Worker Co ${RUN}`, pendCo = `TD141 Pending Co ${RUN}`;
  const sRich = await seed(eng, employmentBody(richCo, 'Network Lead', RICH));
  const sProbe = await seed(eng, employmentBody(probeCo, 'Probe', PROBE, false));
  const sLiteral = await seed(eng, employmentBody(literalCo, 'Literal', LITERAL, false));
  const sWorker = await seed(worker, employmentBody(workerCo, 'Field Engineer', RICH));
  const sPend = pending ? await seed(pending, employmentBody(pendCo, 'Junior Engineer', RICH)) : null;
  check('API: employment records seeded (201)', [sRich, sProbe, sLiteral, sWorker, ...(sPend ? [sPend] : [])].every((x) => x.status === 201 && x.id), results.seeded);
  const list = await getJson(eng, `/employment/${eng.id}`);
  const stored = (list.body?.data || []).find((x) => x.id === sRich.id);
  info('API GET /employment/:userId returns the description as stored HTML (no server-side stripping)', { status: list.status, description: stored?.description });
  check('API: rich description stored verbatim', stored?.description === RICH, { stored: stored?.description });

  // ---- helper: inspect one employment entry on the page
  async function inspectEntry(page, cardLocator, company, label) {
    const entry = cardLocator.locator(`xpath=.//*[normalize-space(text())=${JSON.stringify(company)}]/ancestor::div[.//div[contains(@class,"ql-editor")]][1]`).first();
    const found = await entry.count();
    if (!found) { const bodyTxt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' '); return { found: false, bodyHasCompany: bodyTxt.includes(company) }; }
    const text = (await entry.innerText()).replace(/\s+/g, ' ').trim();
    const ql = entry.locator('.ql-editor').first();
    const html = await ql.innerHTML().catch(() => '');
    const strong = await ql.locator('strong').count(); const li = await ql.locator('li').count(); const em = await ql.locator('em').count();
    const r = { found: true, text, rawTagsVisible: TAG_RE.test(text), strongCount: strong, liCount: li, emCount: em, qlHtml: html.slice(0, 400) };
    results.views[label] = results.views[label] || {}; results.views[label][company] = r;
    return r;
  }
  const settingsCard = (page) => page.locator('xpath=//h6[normalize-space()="Employment History"]/ancestor::div[contains(@class,"mt-6")][1]').first();
  const profileCard = (page) => page.locator('xpath=//h6[normalize-space()="Employment"]/ancestor::div[contains(@class,"MuiPaper-root")][1]').first();
  const onboardingCard = (page) => page.locator('xpath=//p[normalize-space()="Employment History"]/ancestor::div[contains(@class,"MuiPaper-root")][1]').first();

  async function checkRichEntry(page, card, company, label) {
    const r = await inspectEntry(page, card, company, label);
    check(`${label}: entry "${company}" shown`, r.found, r);
    if (!r.found) return r;
    check(`${label}: no raw HTML tags visible in the description text`, !r.rawTagsVisible, { text: r.text });
    check(`${label}: description text readable (contains seeded sentence + list items)`, /Led the network operations team/.test(r.text) && /Cisco & Juniper routing/.test(r.text) && /Firewall migrations/.test(r.text), { text: r.text });
    check(`${label}: markup rendered as elements (strong/em/li)`, r.strongCount >= 1 && r.liCount === 2 && r.emCount >= 1, { strong: r.strongCount, li: r.liCount, em: r.emCount });
    return r;
  }
  async function checkLiteralEntry(page, card, label) {
    const r = await inspectEntry(page, card, literalCo, label);
    if (!r.found) { info(`${label}: literal entry not found`, r); return; }
    check(`${label}: escaped literal "<tag>" typed by the user stays visible as text`, /<tag> and <p> text stays visible/.test(r.text), { text: r.text });
  }
  async function xssProbe(page, label) {
    const fired = await page.evaluate(() => window.__td141xss || 0).catch(() => -1);
    const probe = await inspectEntry(page, page.locator('body'), probeCo, label);
    results.views[label] = results.views[label] || {}; results.views[label].xssProbeFired = fired;
    check(`${label}: SECURITY - injected <img onerror> in a description must not execute in the viewer's browser`, fired === 0, { onerrorFired: fired, probeShown: probe.found, probeText: probe.text });
  }

  // ---- 1. engineer own Profile Settings
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, ...GEO }); const page = ctx.pages()[0] || await ctx.newPage(); page.setDefaultTimeout(15_000);
    await uiLogin(page, eng.account);
    await page.goto(`/user/settings/profile/${eng.id}`); await page.waitForTimeout(5_000);
    await settingsCard(page).scrollIntoViewIfNeeded().catch(() => { });
    await shot(page, 'engineer-profile-settings-employment-card');
    const card = settingsCard(page);
    check('engineer settings: Employment History card present', await card.count() > 0);
    await checkRichEntry(page, card, richCo, 'engineer settings');
    await checkLiteralEntry(page, card, 'engineer settings');
    await xssProbe(page, 'engineer settings (self)');

    // edit through the rich-text modal
    try {
      const entry = card.locator(`xpath=.//*[normalize-space(text())=${JSON.stringify(richCo)}]/ancestor::div[.//div[contains(@class,"ql-editor")]][1]`).first();
      // the icons column is a sibling of the text column -> look in the entry's parent row
      await entry.locator('xpath=..').locator('i.fa-pencil').first().click();
      const modal = page.locator('.MuiModal-root:visible, [role="dialog"]:visible').last();
      await expect(modal.getByText('Employement History')).toBeVisible();
      await shot(page, 'engineer-edit-modal-rich-text-prefilled');
      const editor = modal.locator('.ql-editor').first();
      const prefilled = await editor.innerHTML();
      check('edit modal: Description editor shows the saved formatting (not raw tags)', /<strong>/.test(prefilled) && !/&lt;strong&gt;/.test(prefilled), { prefilled: prefilled.slice(0, 300) });
      await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
      await page.keyboard.type('Updated via UI ');
      const boldBtn = modal.locator('.ql-bold').first(); if (await boldBtn.count()) await boldBtn.click();
      await page.keyboard.type('BOLD-UI');
      await shot(page, 'engineer-edit-modal-description-edited');
      const [patch] = await Promise.all([
        page.waitForResponse((r) => /\/employment\/\d+$/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 20_000 }),
        modal.getByRole('button', { name: /^Update$/ }).click(),
      ]);
      const pb = await patch.json().catch(() => ({}));
      info('edit modal: PATCH /employment/:id', { status: patch.status(), description: (pb?.data || pb)?.description });
      await page.waitForTimeout(2_500);
      await shot(page, 'engineer-settings-after-edit');
      const after = await inspectEntry(page, settingsCard(page), richCo, 'engineer settings after edit');
      check('engineer settings after edit: updated text shown, no raw tags, bold rendered', after.found && /Updated via UI/.test(after.text) && !after.rawTagsVisible && /BOLD-UI/.test(after.text), after);
      check('engineer settings after edit: new bold text is a <strong> element', /<strong>[^<]*BOLD-UI/.test(after.qlHtml) || (await settingsCard(page).locator('.ql-editor strong', { hasText: 'BOLD-UI' }).count()) > 0, { html: after.qlHtml });
    } catch (e) { check('engineer settings: edit through the rich-text modal', false, e.message.slice(0, 300)); await shot(page, 'engineer-edit-modal-error'); }
    await ctx.close();
  }

  // ---- 2..4 Tech Domain / Admin / Customer viewing the engineer's profile
  for (const [role, label] of [['TechDomain User', 'Tech Domain view'], ['Admin', 'Admin view'], ['Customer', 'Customer view']]) {
    const acc = accounts.find((a) => a.role === role);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); const page = ctx.pages()[0] || await ctx.newPage(); page.setDefaultTimeout(15_000);
    try {
      await uiLogin(page, acc);
      await page.goto(`/user/details/profile/${eng.id}`); await page.waitForTimeout(6_000);
      const unauthorized = await page.getByText(/^Unauthorized$/).count();
      const card = profileCard(page);
      if (await card.count()) await card.scrollIntoViewIfNeeded().catch(() => { });
      await shot(page, `${label.replace(/\s+/g, '-').toLowerCase()}-engineer-profile-employment`);
      if (unauthorized && !(await card.count())) { info(`${label}: profile page shows "Unauthorized" (role not allowed to view the engineer profile)`, { url: page.url() }); await ctx.close(); continue; }
      check(`${label}: Employment card present on /user/details/profile/${eng.id}`, await card.count() > 0, { url: page.url() });
      await checkRichEntry(page, card, richCo, label);
      await checkLiteralEntry(page, card, label);
      const pencil = await card.locator('i.fa-pencil').count(); const plus = await card.locator('i.fa-circle-plus').count();
      info(`${label}: edit controls on the Employment card (ADMIN only by design)`, { pencil, plus });
      await xssProbe(page, label);
    } catch (e) { check(`${label}: profile view`, false, e.message.slice(0, 300)); await shot(page, `${label.replace(/\s+/g, '-').toLowerCase()}-error`); }
    await ctx.close();
  }

  // ---- 5. vendor owner viewing own member
  {
    const acc = accounts.find((a) => a.role === 'Vendor');
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, ...GEO }); const page = ctx.pages()[0] || await ctx.newPage(); page.setDefaultTimeout(15_000);
    try {
      await uiLogin(page, acc);
      await page.goto(`/user/details/profile/${worker.id}`); await page.waitForTimeout(6_000);
      const card = profileCard(page); if (await card.count()) await card.scrollIntoViewIfNeeded().catch(() => { });
      await shot(page, 'vendor-owner-view-member-profile-employment');
      check(`vendor owner view: Employment card present on member profile ${worker.id}`, await card.count() > 0, { url: page.url() });
      await checkRichEntry(page, card, workerCo, 'vendor owner view');
    } catch (e) { check('vendor owner view', false, e.message.slice(0, 300)); }
    await ctx.close();
  }

  // ---- 6. pending engineer onboarding card
  if (pending && sPend?.id) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, ...GEO }); const page = ctx.pages()[0] || await ctx.newPage(); page.setDefaultTimeout(15_000);
    try {
      await uiLogin(page, pendingAcc);
      await page.goto('/completeYourProfile'); await page.waitForTimeout(5_000);
      const step = page.getByText('Profile Details', { exact: true }).first(); if (await step.count()) await step.click().catch(() => { });
      await page.waitForTimeout(2_500);
      const card = onboardingCard(page); if (await card.count()) await card.scrollIntoViewIfNeeded().catch(() => { });
      await shot(page, 'pending-engineer-complete-profile-employment-card');
      check('onboarding: Employment History card present under Profile Details', await card.count() > 0, { url: page.url() });
      await checkRichEntry(page, card, pendCo, 'onboarding card');
    } catch (e) { check('onboarding card', false, e.message.slice(0, 300)); await shot(page, 'onboarding-error'); }
    await ctx.close();
  }

  // ---- cleanup
  if (!process.env.KEEP) {
    const del = [];
    for (const r of [sRich, sProbe, sLiteral]) if (r.id) del.push({ id: r.id, status: (await delJson(eng, `/employment/${r.id}`)).status });
    if (sWorker.id) del.push({ id: sWorker.id, status: (await delJson(worker, `/employment/${sWorker.id}`)).status });
    if (sPend?.id) del.push({ id: sPend.id, status: (await delJson(pending, `/employment/${sPend.id}`)).status });
    info('cleanup: seeded records deleted', del);
  }

  fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
  log(`Evidence: ${EVIDENCE}`);
  log(`Findings: ${results.findings.length ? results.findings.join(' | ') : 'none'}`);
});
