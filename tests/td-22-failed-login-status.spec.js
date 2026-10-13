// TD-22: "Failed login returns HTTP 404 instead of 401 Unauthorized" (test cases LG-N05, LG-N06, LG-N07)
// https://techdomain.atlassian.net/browse/TD-22
//
// API: POST /auth/login with (a) registered email + wrong password, (b) unregistered email,
//      (c) wrong password with different casing of the email, (d) valid credentials as control.
//      Expected: (a)-(c) HTTP 401 with the generic message "Invalid email or password"; (d) 201 with accessToken.
// UI:  the login page shows the generic error for a wrong password (screenshot) and stays on /login.
// Evidence: evidence/TD-22-LoginStatusCode/run-<stamp>/TD-22_Login_NN_<step>.png + results JSON

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-22-LoginStatusCode', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const byRole = (r) => accounts.find((a) => a.role === r);

test.setTimeout(180_000);

let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  await page.screenshot({ path: path.join(EVIDENCE, `TD-22_Login_${String(shotNo).padStart(2, '0')}_${name}.png`) });
}

test('TD-22: failed login returns 401 Unauthorized with a generic message', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 600) }); };
  const acc = byRole('Individual Engineer');
  const api = await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au' } });

  const cases = [
    { id: 'LG-N05', name: 'registered email + wrong password', body: { email: acc.email, password: 'WrongPass#2026' }, expectStatus: 401 },
    { id: 'LG-N06', name: 'unregistered email', body: { email: `no-such-user-${RUN}@mailinator.com`, password: 'WrongPass#2026' }, expectStatus: 401 },
    { id: 'LG-N07', name: 'registered email (different case) + wrong password', body: { email: acc.email.toUpperCase(), password: 'WrongPass#2026' }, expectStatus: 401 },
    { id: 'control', name: 'valid credentials', body: { email: acc.email, password: acc.password }, expectStatus: [200, 201] },
  ];
  const results = [];
  for (const c of cases) {
    const res = await api.post(u('/auth/login'), { data: c.body });
    const text = await res.text();
    let json = {}; try { json = JSON.parse(text); } catch { }
    const r = { id: c.id, name: c.name, email: c.body.email, status: res.status(), message: json.message, error: json.error, hasToken: !!json.accessToken, expectStatus: c.expectStatus };
    results.push(r);
    log(`${c.id} ${c.name}: HTTP ${r.status} message="${r.message}" error="${r.error}" token=${r.hasToken}`);
  }
  await api.dispose();

  // UI: wrong password on the login page
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  const ui = { };
  await page.goto('/login');
  const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await expect(email).toBeVisible({ timeout: 20_000 });
  await email.fill(acc.email);
  await page.locator('input[type="password"]').first().fill('WrongPass#2026');
  const respP = page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 20_000 });
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")').first().click();
  const resp = await respP;
  ui.status = resp.status();
  await page.waitForTimeout(2_000);
  await shot(page, 'wrong-password-error-shown');
  const body = await page.locator('body').innerText();
  ui.showsGenericMessage = /invalid email or password/i.test(body);
  ui.staysOnLogin = /\/login/.test(page.url());
  ui.leaksField = /password is (wrong|incorrect)|email (not found|does not exist)|user not found/i.test(body);
  log(`UI wrong password: HTTP ${ui.status}, generic message shown=${ui.showsGenericMessage}, stays on /login=${ui.staysOnLogin}, field leak=${ui.leaksField}`);
  await ctx.close();

  fs.writeFileSync(path.join(EVIDENCE, `TD-22_results_${RUN}.json`), JSON.stringify({ api: results, ui }, null, 2));

  for (const r of results) {
    const ok = Array.isArray(r.expectStatus) ? r.expectStatus.includes(r.status) : r.status === r.expectStatus;
    expect.soft(ok, `${r.id} ${r.name}: expected HTTP ${JSON.stringify(r.expectStatus)}, got ${r.status} (${r.message})`).toBe(true);
    if (r.id !== 'control') {
      expect.soft(String(r.message), `${r.id}: generic message`).toMatch(/invalid email or password/i);
      expect.soft(r.hasToken, `${r.id}: no token on failure`).toBe(false);
    } else expect.soft(r.hasToken, 'control login returns a token').toBe(true);
  }
  expect.soft(ui.status, 'UI wrong password: API status').toBe(401);
  expect.soft(ui.showsGenericMessage, 'UI shows the generic error').toBe(true);
  expect.soft(ui.staysOnLogin, 'UI stays on the login page').toBe(true);
  expect.soft(ui.leaksField, 'UI must not reveal which field is wrong').toBe(false);
});
