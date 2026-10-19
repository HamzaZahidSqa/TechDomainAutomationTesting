// TD-87 "Regenerated User Access Cannot Login With Same Email" (Backend, Bug, High)
// https://techdomain.atlassian.net/browse/TD-87
//
// Flow (Tech Domain Work Board > Clients): create a parent customer -> "Generate Signup" (POST clients/owner/:id) with a
// Mailinator e-mail -> read the generated password from the welcome mail -> login #1 (baseline) -> "Delete Access"
// (DELETE clients/owner/:id) -> "Generate Signup" again with the SAME e-mail -> read the new password -> login #2.
// Expected: login #2 succeeds with the new password. Bug: "Invalid email/password".
//
// Run:  npx playwright test tests/td-87-regenerated-access-login.spec.js --reporter=line --trace off
// Evidence: evidence/TD-87-RegeneratedAccessLogin/run-<stamp>/

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-87-RegeneratedAccessLogin', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const EMAIL = `td87-owner-${RUN}@mailinator.com`;
const INBOX = EMAIL.split('@')[0];

test.setTimeout(900_000);
let shotNo = 0;
async function shot(page, name) { shotNo += 1; const f = path.join(EVIDENCE, `TD-87_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: true }).catch(() => { }); return path.basename(f); }
async function rawLogin(email, password) { const ctx = await pwRequest.newContext({ extraHTTPHeaders: H }); const res = await ctx.post(u('/auth/login'), { data: { email, password } }); const body = await res.json().catch(() => ({})); await ctx.dispose(); return { status: res.status(), body }; }
async function apiLogin(account, label) {
  const l = await rawLogin(account.email, account.password);
  if (!l.body.accessToken) throw new Error(`API login failed for ${account.email}: HTTP ${l.status}`);
  return { label, account, api: await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${l.body.accessToken}` } }), id: l.body.data?.id };
}
async function call(s, method, p, data, multipart) { const opts = multipart ? { multipart } : data === undefined ? undefined : { data }; const r = await s.api[method](u(p), opts); return { status: r.status(), body: await r.json().catch(async () => ({ text: await r.text().catch(() => '') })) }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Newest Mailinator mail matching `subject` (and newer than `afterCount` rows); returns body text.
async function readMail(page, subject, log, minRows = 1) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(INBOX)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4_000);
    const rows = page.locator('tr').filter({ hasText: subject }); const n = await rows.count();
    log(`Mailinator ${INBOX}: attempt ${attempt}, ${n} row(s) matching ${subject} (need ${minRows})`);
    if (n >= minRows) { await rows.first().click(); await page.waitForTimeout(4_000); let text = ''; for (const f of page.frames()) { try { text += '\n' + (await f.locator('body').innerText({ timeout: 3_000 })); } catch { } } return text; }
    await page.waitForTimeout(6_000);
  }
  return '';
}
const parsePassword = (text) => { const m = text.match(/password\s*[:\-–]?\s*([^\s<]+)/i); return m ? m[1] : null; };
const parseOtp = (text) => { const i = text.search(/OTP|code/i); const after = text.slice(Math.max(0, i), i + 300); return ((after.match(/(?:\d\s*){6}/) || [''])[0]).replace(/\s+/g, ''); };
async function loginWithOtp(page, email, password, log) { // API login; verify OTP from Mailinator when the API answers 307
  let l = await rawLogin(email, password);
  if (l.status === 307) {
    log(`${email}: login 307 (unverified) - reading OTP`);
    const text = await readMail(page, /OTP|Verify/i, log);
    const otp = parseOtp(text); log(`otp=${otp || 'not found'}`);
    if (otp) { const v = await pwRequest.newContext({ extraHTTPHeaders: H }); const vr = await v.post(u('/otps/verify'), { data: { email, code: otp } }); log(`otps/verify -> ${vr.status()}`); await v.dispose(); l = await rawLogin(email, password); }
  }
  return l;
}
async function uiLoginAttempt(page, email, password) {
  await page.goto('https://dev.techdomain.com.au/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email); await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(6_000);
  const txt = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  return { url: page.url(), loggedIn: !/\/login/i.test(page.url()), error: (txt.match(/invalid[^.]{0,60}|incorrect[^.]{0,60}|not found[^.]{0,40}/i) || [''])[0], text: txt.slice(0, 200) };
}

test('TD-87: delete customer owner access and regenerate it with the same e-mail, then log in', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, ticket: 'TD-87', email: EMAIL, checks: [], findings: [], steps: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); if (!ok) results.findings.push(n); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 700)}`); };
  const save = () => { const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n'); fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2)); fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), `TD-87 VERDICT: ${results.verdict || '?'}\n${summary}\n`); return summary; };

  const td = await apiLogin(accounts.find((a) => a.role === 'TechDomain User'), 'Tech Domain');
  const ref = (await call(td, 'get', '/clients/103')).body?.data || {};
  const mailCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const mail = await mailCtx.newPage(); mail.setDefaultTimeout(20_000);
  const uiCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const ui = await uiCtx.newPage(); ui.setDefaultTimeout(30_000);

  // 1. create a fresh parent customer (multipart, like the web form)
  const form = { clientName: `TD87 QA Customer ${RUN}`, managerName: 'TD87 Manager', addressLine1: '10 Test St', city: 'Sydney', state: 'NSW', zipCode: '2000', country: 'Australia', phoneNumber: '61400000187', email: EMAIL, teamEmail: '', website: '', policies: '', instructions: '', branchId: String(ref.branch?.id || 1), teamId: ref.team?.id || '', secondaryTeamId: ref.secondaryTeam?.id || '', isParentClient: 'true' };
  const cr = await call(td, 'post', '/clients', undefined, form);
  const CLIENT = cr.body?.data?.id || cr.body?.id;
  log(`POST clients -> ${cr.status} ${JSON.stringify(cr.body).slice(0, 200)}`);
  check(`1. Tech Domain created parent customer "${form.clientName}" (id ${CLIENT})`, cr.status < 300 && !!CLIENT, { status: cr.status, body: JSON.stringify(cr.body).slice(0, 200) });
  expect(CLIENT, 'customer created').toBeTruthy(); results.client = CLIENT;

  // 2. Generate Signup #1
  const g1 = await call(td, 'post', `/clients/owner/${CLIENT}`, { firstName: 'Td87', lastName: 'Owner', email: EMAIL, phone: '61400000187' });
  log(`POST clients/owner/${CLIENT} (#1) -> ${g1.status} ${JSON.stringify(g1.body).slice(0, 250)}`);
  let cl = (await call(td, 'get', `/clients/${CLIENT}`)).body?.data || {};
  const owner1 = cl.owner?.id || cl.ownerId; results.steps.gen1 = { status: g1.status, ownerId: owner1, ownerEmail: cl.owner?.email, ownerStatus: cl.owner?.status };
  check(`2. Generate Signup #1 with ${EMAIL} -> owner user ${owner1} created`, g1.status < 300 && !!owner1, results.steps.gen1);
  await sleep(8_000);
  const mail1 = await readMail(mail, /Welcome|Account|Signup|Credential|Password/i, log, 1); const s1 = await shot(mail, 'welcome-mail-1');
  const pw1 = parsePassword(mail1); results.steps.gen1.password = pw1; results.steps.gen1.mailSnippet = mail1.slice(Math.max(0, mail1.search(/password/i) - 60), mail1.search(/password/i) + 80);
  check('3. welcome e-mail #1 received with a generated password', !!pw1, { password: pw1, snippet: results.steps.gen1.mailSnippet, shot: s1 });

  // 3. baseline login with password #1 (API, OTP if needed) + UI
  let l1 = pw1 ? await loginWithOtp(mail, EMAIL, pw1, log) : { status: 0, body: {} };
  results.steps.login1 = { status: l1.status, ok: !!l1.body.accessToken, msg: l1.body.message, userId: l1.body.data?.id };
  check('4. baseline: login works with the FIRST generated credentials', !!l1.body.accessToken, results.steps.login1);
  const ui1 = pw1 ? await uiLoginAttempt(ui, EMAIL, pw1) : null; const s2 = await shot(ui, 'ui-login-1'); info('UI login #1', { ...ui1, shot: s2 });
  await uiCtx.clearCookies(); await ui.goto('https://dev.techdomain.com.au/login').catch(() => { }); await ui.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { } }).catch(() => { });

  // 4. Delete Access
  const del = await call(td, 'delete', `/clients/owner/${CLIENT}`);
  log(`DELETE clients/owner/${CLIENT} -> ${del.status} ${JSON.stringify(del.body).slice(0, 200)}`);
  await sleep(2_000); cl = (await call(td, 'get', `/clients/${CLIENT}`)).body?.data || {};
  results.steps.delete = { status: del.status, ownerAfter: cl.owner?.id || cl.ownerId || null };
  check('5. Delete Access -> customer has no owner any more', del.status < 300 && !(cl.owner?.id || cl.ownerId), results.steps.delete);
  const lDel = pw1 ? await rawLogin(EMAIL, pw1) : { status: 0, body: {} };
  info('login with the OLD credentials after Delete Access (expected to fail)', { status: lDel.status, ok: !!lDel.body.accessToken, msg: lDel.body.message });

  // 5. Generate Signup #2 with the SAME e-mail
  const g2 = await call(td, 'post', `/clients/owner/${CLIENT}`, { firstName: 'Td87', lastName: 'Owner', email: EMAIL, phone: '61400000187' });
  log(`POST clients/owner/${CLIENT} (#2, same e-mail) -> ${g2.status} ${JSON.stringify(g2.body).slice(0, 250)}`);
  await sleep(2_000); cl = (await call(td, 'get', `/clients/${CLIENT}`)).body?.data || {};
  const owner2 = cl.owner?.id || cl.ownerId; results.steps.gen2 = { status: g2.status, body: JSON.stringify(g2.body).slice(0, 200), ownerId: owner2, ownerEmail: cl.owner?.email, ownerStatus: cl.owner?.status, sameUserId: owner2 === owner1 };
  check(`6. Generate Signup #2 with the SAME e-mail succeeds -> owner user ${owner2} (first was ${owner1})`, g2.status < 300 && !!owner2, results.steps.gen2);
  await sleep(8_000);
  const mail2 = await readMail(mail, /Welcome|Account|Signup|Credential|Password/i, log, 2); const s3 = await shot(mail, 'welcome-mail-2');
  const pw2 = parsePassword(mail2); results.steps.gen2.password = pw2; results.steps.gen2.mailSnippet = mail2.slice(Math.max(0, mail2.search(/password/i) - 60), mail2.search(/password/i) + 80);
  check('7. welcome e-mail #2 received with a NEW generated password', !!pw2 && pw2 !== pw1, { password: pw2, differs: pw2 !== pw1, snippet: results.steps.gen2.mailSnippet, shot: s3 });

  // 6. login with the regenerated credentials (the ticket)
  let l2 = pw2 ? await loginWithOtp(mail, EMAIL, pw2, log) : { status: 0, body: {} };
  results.steps.login2 = { status: l2.status, ok: !!l2.body.accessToken, msg: l2.body.message, userId: l2.body.data?.id };
  check('8. TICKET: login works with the REGENERATED credentials (same e-mail, new password)', !!l2.body.accessToken, results.steps.login2);
  const ui2 = pw2 ? await uiLoginAttempt(ui, EMAIL, pw2) : null; const s4 = await shot(ui, 'ui-login-2-regenerated');
  check('8b. UI login with the regenerated credentials reaches the portal (no "Invalid email/password")', !!ui2 && ui2.loggedIn, { ...ui2, shot: s4 });
  if (!l2.body.accessToken && pw1) { const lOld = await rawLogin(EMAIL, pw1); info('diagnostic: does the OLD password still work after regeneration?', { status: lOld.status, ok: !!lOld.body.accessToken, msg: lOld.body.message }); }
  const users = (await call(td, 'get', `/users?search=${encodeURIComponent(EMAIL)}&limit=10`)); info('diagnostic: user records for the e-mail (Tech Domain search)', { status: users.status, body: JSON.stringify(users.body).slice(0, 300) });

  results.verdict = l2.body.accessToken && ui2?.loggedIn ? 'PASS (fixed)' : 'FAIL (bug still present)';
  const summary = save();
  log(`\nTD-87 VERDICT: ${results.verdict} | customer ${CLIENT}, e-mail ${EMAIL}, owner#1 ${owner1} owner#2 ${owner2}\n${summary}`);
  await mailCtx.close(); await uiCtx.close();
});
