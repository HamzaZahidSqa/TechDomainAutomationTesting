// TD-23: "Forgot Password allows email enumeration via different messages" (test case FP-N04)
// https://techdomain.atlassian.net/browse/TD-23
//
// API: POST /auth/forgotPassword for an unregistered and a registered email -> status code, message and
//      response shape must be identical (timing is recorded for information).
// UI:  /forgotPassword page: submit an unregistered email, then a registered one -> the on-screen message
//      must be the same neutral text, and the page must not say "not a registered email".
// Mail: the registered account's Mailinator inbox should receive the reset email (sent only when the account exists).
// Evidence: evidence/TD-23-ForgotPasswordEnumeration/run-<stamp>/TD-23_ForgotPw_NN_<step>.png + results JSON

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-23-ForgotPasswordEnumeration', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const byRole = (r) => accounts.find((a) => a.role === r);
const LEAK = /not a registered email|not registered|no account|does not exist|user not found|email not found/i;

test.setTimeout(240_000);

let shotNo = 0;
async function shot(page, name) {
  shotNo += 1;
  await page.screenshot({ path: path.join(EVIDENCE, `TD-23_ForgotPw_${String(shotNo).padStart(2, '0')}_${name}.png`) });
}

async function submitForgot(page, email) {
  await page.goto('/forgotPassword');
  const input = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill(email);
  const respP = page.waitForResponse((r) => r.url().includes('/auth/forgotPassword') && r.request().method() === 'POST', { timeout: 20_000 });
  await page.locator('button[type="submit"], button:has-text("Send"), button:has-text("Submit"), button:has-text("Reset")').first().click();
  const resp = await respP;
  await page.waitForTimeout(2_500);
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
  return { status: resp.status(), url: page.url().replace(/^https?:\/\/[^/]+/, ''), text };
}

test('TD-23: forgot password gives the same response for registered and unregistered emails', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 600) }); };
  const acc = byRole('Individual Engineer');
  const unregistered = `no-account-${RUN}@mailinator.com`;
  const api = await pwRequest.newContext({ extraHTTPHeaders: { Origin: 'https://dev.techdomain.com.au' } });
  const results = { api: {}, ui: {} };

  // ---------- API ----------
  for (const [label, email] of [['unregistered', unregistered], ['registered', acc.email]]) {
    const t0 = Date.now();
    const res = await api.post(u('/auth/forgotPassword'), { data: { email } });
    const ms = Date.now() - t0;
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { }
    results.api[label] = { email, status: res.status(), ms, body: json ?? text.slice(0, 300), keys: json ? Object.keys(json).sort() : null };
    log(`API ${label}: HTTP ${res.status()} in ${ms} ms -> ${text.slice(0, 200)}`);
  }
  await api.dispose();
  const a = results.api.unregistered, b = results.api.registered;
  results.api.sameStatus = a.status === b.status;
  results.api.sameMessage = JSON.stringify(a.body?.message ?? a.body) === JSON.stringify(b.body?.message ?? b.body);
  results.api.sameShape = JSON.stringify(a.keys) === JSON.stringify(b.keys);
  results.api.leak = LEAK.test(JSON.stringify(a.body)) || LEAK.test(JSON.stringify(b.body));

  // ---------- UI (fresh browser context per submit: the page keeps a 60 s resend cooldown in localStorage) ----------
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  results.ui.unregistered = await submitForgot(page, unregistered);
  await shot(page, 'unregistered-email-response');
  log(`UI unregistered: HTTP ${results.ui.unregistered.status} url=${results.ui.unregistered.url} text="${results.ui.unregistered.text.slice(0, 200)}"`);
  await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  results.ui.registered = await submitForgot(page, acc.email);
  await shot(page, 'registered-email-response');
  log(`UI registered: HTTP ${results.ui.registered.status} url=${results.ui.registered.url} text="${results.ui.registered.text.slice(0, 200)}"`);
  const norm = (s) => s.replace(unregistered, '<email>').replace(acc.email, '<email>').replace(/\d{1,2}:\d{2}/g, '');
  results.ui.sameScreen = norm(results.ui.unregistered.text) === norm(results.ui.registered.text) && results.ui.unregistered.url === results.ui.registered.url;
  results.ui.leak = LEAK.test(results.ui.unregistered.text) || LEAK.test(results.ui.registered.text);

  // ---------- Mail (registered account only) ----------
  const inbox = acc.email.split('@')[0];
  await page.goto(`https://www.mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(inbox)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5_000);
  const mailText = await page.locator('body').innerText();
  results.mail = { inbox, resetMailListed: /reset|password/i.test(mailText) };
  await shot(page, 'registered-mailinator-inbox');
  log(`Mailinator ${inbox}: reset mail listed=${results.mail.resetMailListed}`);
  await ctx.close();

  fs.writeFileSync(path.join(EVIDENCE, `TD-23_results_${RUN}.json`), JSON.stringify(results, null, 2));

  expect.soft(results.api.sameStatus, `API status codes differ: unregistered ${a.status} vs registered ${b.status}`).toBe(true);
  expect.soft(results.api.sameMessage, `API messages differ: ${JSON.stringify(a.body)} vs ${JSON.stringify(b.body)}`).toBe(true);
  expect.soft(results.api.sameShape, 'API response shapes differ').toBe(true);
  expect.soft(results.api.leak, 'API response reveals registration status').toBe(false);
  expect.soft(results.ui.unregistered.status, 'UI unregistered: API status').toBe(results.ui.registered.status);
  expect.soft(results.ui.sameScreen, 'UI shows the same screen/message for both emails').toBe(true);
  expect.soft(results.ui.leak, 'UI reveals registration status').toBe(false);
});
