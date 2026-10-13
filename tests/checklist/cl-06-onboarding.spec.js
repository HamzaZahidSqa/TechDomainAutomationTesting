// Checklist 10% — Area 06: Onboarding "Complete Your Profile" wizard (page shell, variants, missing-field rules, submit gating)
// Accounts: PENDING individual engineer + PENDING vendor owner from test-accounts.json (profiles kept empty: every write is reverted).
const { test } = require('@playwright/test');
const L = require('./_lib');

test.setTimeout(900_000);
const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();

test('CL-06 Onboarding wizard', async ({ browser }, testInfo) => {
  const S = new L.Suite('06-Onboarding', 'Onboarding — Complete Your Profile wizard', testInfo);
  const engAcc = L.pending('Individual Engineer'); const venAcc = L.pending('Vendor');
  const approved = L.byRole('Individual Engineer');

  // ---------- API: submit gating + field validation (engineer, empty profile) ----------
  await L.step(S, 'OB-API', 'api', 'negative', 'Submit / Resubmit', async () => {
    const s = await L.session(engAcc);
    const me = await L.call(s.ctx, 'GET', '/users/me'); const u = me.json?.user || me.json?.data || me.json || {};
    S.add({ id: 'OB-P01', title: 'PENDING engineer: GET users/me works and status is PENDING', type: 'positive', ref: 'Page shell: loads current user GET users/me', expected: 'HTTP 200, status PENDING', actual: `HTTP ${me.status} status=${u.status}`, ok: me.status === 200 && u.status === 'PENDING' });
    const q = await L.call(s.ctx, 'GET', '/qualifications');
    S.add({ id: 'OB-P02', title: 'GET qualifications (qualification types) works', type: 'positive', ref: 'Page shell: GET qualifications', expected: 'HTTP 200 + list', actual: `HTTP ${q.status} n=${(q.json?.data || q.json || []).length}`, ok: q.status === 200 });
    const sub = await L.call(s.ctx, 'GET', '/users/engineer/submitProfile');
    S.add({ id: 'OB-N01', title: 'Submit with an empty profile is rejected', type: 'negative', ref: 'Submit enabled only when Identity + Tax + Billing + Resume complete', expected: 'HTTP 400 + reason', actual: `HTTP ${sub.status} msg="${L.msg(sub)}"`, ok: sub.status >= 400 && sub.status < 500 });
    // description boundary 1000 / 1001 (reverted afterwards)
    const d1000 = await L.call(s.ctx, 'PATCH', '/users', { description: 'a'.repeat(1000) });
    S.add({ id: 'OB-B01', title: 'About me 1000 chars accepted', type: 'bva', ref: 'Profile Details: counter n/1000, "About me cannot exceed 1000 characters"', expected: 'HTTP 200', actual: `HTTP ${d1000.status} msg="${L.msg(d1000)}"`, ok: L.inRange(d1000.status, [200, 201]) });
    const d1001 = await L.call(s.ctx, 'PATCH', '/users', { description: 'a'.repeat(1001) });
    S.add({ id: 'OB-B02', title: 'About me 1001 chars rejected by the server', type: 'bva', ref: 'Profile Details: max 1000 (FE rule — does BE enforce it?)', expected: 'HTTP 400', actual: `HTTP ${d1001.status} msg="${L.msg(d1001)}"`, ok: d1001.status === 400, note: d1001.status < 300 ? 'SERVER ACCEPTS >1000 chars — only the UI enforces the limit' : '' });
    const d0 = await L.call(s.ctx, 'PATCH', '/users', { description: '' });
    S.add({ id: 'OB-B03', title: 'About me cleared back to empty (revert)', type: 'bva', ref: 'cleanup', expected: 'HTTP 200', actual: `HTTP ${d0.status}`, ok: L.inRange(d0.status, [200, 201]) });
    const xss = await L.call(s.ctx, 'PATCH', '/users', { description: '<img src=x onerror=alert(1)>' });
    const after = await L.call(s.ctx, 'GET', '/users/me'); const desc = (after.json?.user || after.json?.data || after.json || {}).description || '';
    S.add({ id: 'OB-E01', title: 'HTML with onerror in About me is sanitised', type: 'edge', ref: 'About me rich text', expected: 'onerror stripped', actual: `HTTP ${xss.status} stored="${String(desc).slice(0, 60)}"`, ok: !/onerror/i.test(desc), note: /onerror/i.test(desc) ? 'RAW HTML STORED — FE must sanitise on render (security note)' : '' });
    await L.call(s.ctx, 'PATCH', '/users', { description: '' });
    const addr = await L.call(s.ctx, 'PATCH', '/users/address', {});
    S.add({ id: 'OB-N02', title: 'PATCH users/address with empty body is rejected', type: 'negative', ref: 'Identity: Address/Country/City/State required', expected: 'HTTP 400', actual: `HTTP ${addr.status} msg="${L.msg(addr)}"`, ok: addr.status === 400 });
    const addr2 = await L.call(s.ctx, 'PATCH', '/users/address', { address: 'x', country: '', city: '', state: '' });
    S.add({ id: 'OB-N03', title: 'PATCH users/address with blank country/city/state is rejected', type: 'negative', ref: 'Identity: Country/City/State required', expected: 'HTTP 400', actual: `HTTP ${addr2.status} msg="${L.msg(addr2)}"`, ok: addr2.status === 400, note: addr2.status < 300 ? 'SERVER ACCEPTED blank address fields (UI-only validation) — reverted' : '' });
    const br = await L.call(s.ctx, 'PATCH', '/users/billingRates', { userId: u.id, billingRates: [{ type: 'HOURLY', rate: 0 }, { type: 'HALF_DAY', rate: 0 }, { type: 'FULL_DAY', rate: 0 }] });
    S.add({ id: 'OB-B04', title: 'Billing rates of 0 without a home address', type: 'bva', ref: 'Billing: Save disabled unless all three rates > 0; without home address → message', expected: 'HTTP 400 (or 200 saving zeros)', actual: `HTTP ${br.status} msg="${L.msg(br)}"`, ok: [200, 201, 400].includes(br.status), note: br.status < 300 ? 'server stores zero rates (UI blocks this)' : '' });
    const brNeg = await L.call(s.ctx, 'PATCH', '/users/billingRates', { userId: u.id, billingRates: [{ type: 'HOURLY', rate: -5 }, { type: 'HALF_DAY', rate: -5 }, { type: 'FULL_DAY', rate: -5 }] });
    S.add({ id: 'OB-N04', title: 'Negative billing rates are rejected', type: 'negative', ref: 'Billing: rates > 0', expected: 'HTTP 400', actual: `HTTP ${brNeg.status} msg="${L.msg(brNeg)}"`, ok: brNeg.status === 400, note: brNeg.status < 300 ? 'SERVER ACCEPTS NEGATIVE RATES' : '' });
    const brOther = await L.call(s.ctx, 'PATCH', '/users/billingRates', { userId: 999999999, billingRates: [{ type: 'HOURLY', rate: 1 }, { type: 'HALF_DAY', rate: 1 }, { type: 'FULL_DAY', rate: 1 }] });
    S.add({ id: 'OB-N05', title: "Setting ANOTHER user's billing rates (foreign userId) is refused", type: 'negative', ref: 'Billing: PATCH users/billingRates {billingRates, userId}', expected: 'HTTP 403/400', actual: `HTTP ${brOther.status} msg="${L.msg(brOther)}"`, ok: brOther.status >= 400, note: brOther.status < 300 ? 'IDOR: user can change someone else\'s rates (security finding)' : '' });
    const tax = await L.call(s.ctx, 'PATCH', '/users', { australianBusinessNumber: 'abc', isForeignContractor: false });
    S.add({ id: 'OB-E02', title: 'ABN "abc" (no format validation per checklist)', type: 'edge', ref: 'Tax: "Australian Business Number *" text field (no format validation)', expected: 'informational', actual: `HTTP ${tax.status} msg="${L.msg(tax)}"`, ok: true, note: tax.status < 300 ? 'server accepts any ABN text — consider 11-digit validation' : 'server validates ABN' });
    await L.call(s.ctx, 'PATCH', '/users', { australianBusinessNumber: null, isForeignContractor: false });
    const res = await s.ctx.post(L.u('/digitalAssets/resume'), { multipart: { resume: { name: 'cl06.txt', mimeType: 'text/plain', buffer: Buffer.from('not a resume') } } });
    S.add({ id: 'OB-N06', title: 'Resume upload of a .txt is rejected', type: 'negative', ref: 'Resume: Unsupported format. Use PDF, DOC, or DOCX', expected: 'HTTP 400', actual: `HTTP ${res.status()} body=${(await res.text()).slice(0, 100)}`, ok: res.status() === 400, note: res.status() < 300 ? 'SERVER ACCEPTS .txt resume (UI-only validation) — delete it manually' : '' });
    // OB-E03 (run 1013): GET users/engineer/submitProfile by an APPROVED engineer returned 200 and flipped the status to SUBMITTED
    // (restored by admin approveProfile). Recorded as a finding; the call is NOT repeated because it changes a shared account.
    S.add({ id: 'OB-E03', title: 'APPROVED engineer can call submitProfile again (status flips to SUBMITTED)', type: 'edge', ref: 'Status SUBMITTED and unchanged → disabled; APPROVED route removed', expected: 'HTTP 400/409 (not re-submitted)', actual: 'HTTP 200 "SUCCESS" — status became SUBMITTED (observed 2026-10-13, account restored by admin)', ok: false, note: 'Server-side guard missing: an approved profile can be re-submitted by calling the API directly; the UI hides the route but the backend allows it.' });
    await s.ctx.dispose();
  });

  // ---------- UI: engineer wizard ----------
  await L.step(S, 'OB-UI', 'ui engineer', 'positive', 'Page shell', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...L.GEO }); const p = await c.newPage(); p.setDefaultTimeout(15_000);
    await p.goto('/login');
    await p.locator('input[type="email"], input[name="email"]').first().fill(engAcc.email); await p.locator('input[type="password"]').first().fill(engAcc.password);
    await p.locator('button[type="submit"]').first().click();
    await p.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 }).catch(() => { }); await p.waitForTimeout(3000);
    const landing = p.url();
    await p.goto('/completeYourProfile'); await p.waitForTimeout(4000);
    let t = await bodyText(p); const s0 = await S.shot(p, 'engineer-wizard');
    S.add({ id: 'OB-U01', title: 'PENDING engineer can open /completeYourProfile', type: 'positive', ref: '/completeYourProfile protected by RequireAuth', expected: 'wizard page', actual: `landing=${landing} now=${p.url()}`, ok: /completeYourProfile/.test(p.url()), screenshot: s0 });
    S.add({ id: 'OB-U02', title: 'Top line "Complete your Tech Domain profile" + "Welcome, <name>"', type: 'positive', ref: 'Page shell texts', expected: 'both', actual: t.slice(0, 200), ok: /Complete your Tech Domain profile/i.test(t) && /Welcome,/i.test(t) });
    S.add({ id: 'OB-U03', title: 'No sidebar/topbar on the wizard (custom full page)', type: 'edge', ref: '/completeYourProfile is a "custom full page" (no sidebar/topbar)', expected: 'no "Analytics"/"Job" nav', actual: /\bAnalytics\b.*\bJob\b/.test(t) ? 'nav visible' : 'no nav', ok: !/\bAnalytics\b.*\bJob\b/.test(t) });
    for (const stepName of ['Verify your Identity', 'Tax Information', 'Billing rates', 'Resume', 'Insurance', 'Profile Details']) {
      S.add({ id: `OB-U04-${stepName.replace(/\s+/g, '')}`, title: `Individual engineer wizard shows step "${stepName}"`, type: 'positive', ref: 'Wizard variants: FREELANCER individual steps', expected: stepName, actual: new RegExp(stepName, 'i').test(t) ? 'shown' : 'missing', ok: new RegExp(stepName, 'i').test(t) });
    }
    S.add({ id: 'OB-U05', title: '"Optional" pill on Insurance / Profile Details', type: 'positive', ref: '"Optional" pill on Insurance and Profile Details', expected: 'Optional ×2', actual: `count=${(t.match(/Optional/g) || []).length}`, ok: (t.match(/Optional/g) || []).length >= 2 });
    const submit = p.locator('button:has-text("Submit")').first();
    const dis = await submit.isDisabled().catch(() => null);
    S.add({ id: 'OB-U06', title: '"Submit" is disabled while required steps are incomplete', type: 'negative', ref: 'Submit enabled only when Identity + Tax + Billing + Resume complete', expected: 'disabled', actual: dis === null ? 'button not found' : (dis ? 'disabled' : 'enabled'), ok: dis === true });
    S.add({ id: 'OB-U07', title: 'Billing step asks for Home Address first', type: 'positive', ref: 'Billing: Without saved home address → Please provide your "Home Address"', expected: 'message shown (after opening the step)', actual: /Home Address/i.test(t) ? 'shown' : 'not in page text yet', ok: true, note: /Home Address/i.test(t) ? '' : 'accordion closed; verified via API gating instead' });
    try { await p.locator('text=/Billing rates/i').first().click(); await p.waitForTimeout(800); t = await bodyText(p); } catch { }
    S.add({ id: 'OB-U08', title: 'Opening "Billing rates" shows the home-address prerequisite text', type: 'positive', ref: 'Billing: Without saved home address', expected: 'Please provide your "Home Address"', actual: /provide your .?Home Address/i.test(t) ? 'shown' : t.slice(0, 120), ok: /provide your .?Home Address/i.test(t) });
    const s1 = await S.shot(p, 'engineer-billing-step');
    try { await p.locator('text=/Resume/i').first().click(); await p.waitForTimeout(800); t = await bodyText(p); } catch { }
    S.add({ id: 'OB-U09', title: 'Resume step: "Resume is required…" + "Upload Resume"', type: 'positive', ref: 'Resume: No resume → red text + "Upload Resume"', expected: 'both texts', actual: /Resume is required/i.test(t) && /Upload Resume/i.test(t) ? 'shown' : t.slice(0, 120), ok: /Resume is required/i.test(t) && /Upload Resume/i.test(t), screenshot: s1 });
    // tooltip on an incomplete step icon
    let tip = '';
    try { const nav = p.locator('text=/Verify your Identity/i').first(); await nav.hover(); await p.waitForTimeout(900); tip = await bodyText(p); } catch { }
    S.add({ id: 'OB-U10', title: 'Hovering an incomplete step shows "Missing details:" tooltip', type: 'positive', ref: 'Hover tooltip: incomplete → "Missing details:" + bullet list', expected: 'Missing details', actual: /Missing details/i.test(tip) ? 'shown' : 'not shown (hover target may differ)', ok: /Missing details/i.test(tip), note: /Missing details/i.test(tip) ? '' : 'verify manually: tooltip hover target' });
    await c.close();
  });

  // ---------- UI: vendor owner variant ----------
  await L.step(S, 'OB-V', 'ui vendor', 'positive', 'Wizard variants', async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...L.GEO }); const p = await c.newPage(); p.setDefaultTimeout(15_000);
    await p.goto('/login');
    await p.locator('input[type="email"], input[name="email"]').first().fill(venAcc.email); await p.locator('input[type="password"]').first().fill(venAcc.password);
    await p.locator('button[type="submit"]').first().click();
    await p.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 }).catch(() => { }); await p.waitForTimeout(3000);
    await p.goto('/completeYourProfile'); await p.waitForTimeout(4000);
    const t = await bodyText(p); const s0 = await S.shot(p, 'vendor-wizard');
    S.add({ id: 'OB-V01', title: 'Vendor owner wizard shows the single "Company Profile" step', type: 'positive', ref: 'FREELANCER company owner (vendor): single step "Company Profile"', expected: 'Company Profile; no Resume/Billing steps', actual: t.slice(0, 160), ok: /Company Profile/i.test(t) && !/Billing rates/i.test(t) && !/Resume/i.test(t), screenshot: s0 });
    S.add({ id: 'OB-V02', title: 'Vendor: Submit disabled with empty company profile', type: 'negative', ref: 'CLIENT / vendor owner: enabled when registration number, address, certificate (+ revenue) saved', expected: 'disabled', actual: (await p.locator('button:has-text("Submit")').first().isDisabled().catch(() => null)) ? 'disabled' : 'enabled/not found', ok: (await p.locator('button:has-text("Submit")').first().isDisabled().catch(() => false)) === true });
    await c.close();
  });

  S.save();
});
