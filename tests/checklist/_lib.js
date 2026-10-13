// Shared helpers for the functionality-checklist test suite (tests/checklist/*.spec.js).
// Every spec records its checks through `Suite` into evidence/Checklist/results/<area>.json;
// scripts/build-checklist-report.js turns those files into the HTML dashboard + PDF.
const { request: pwRequest, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const accounts = require(path.join(ROOT, 'accounts.json'));
const testAccounts = require(path.join(ROOT, 'test-accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const BASE_URL = process.env.BASE_URL || 'https://dev.techdomain.com.au';
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const H = { Origin: BASE_URL };
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const byRole = (r) => accounts.find((a) => a.role === r);
const pending = (r) => testAccounts.find((a) => a.role === r);
const GEO = { geolocation: { latitude: 31.4689, longitude: 74.2636 }, permissions: ['geolocation'] };

async function api(token) {
  return pwRequest.newContext({ extraHTTPHeaders: token ? { ...H, Authorization: `Bearer ${token}` } : H });
}
async function call(ctx, method, p, data, opts = {}) {
  const res = await ctx.fetch(u(p), { method, data, ...opts });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { }
  return { status: res.status(), json, text, headers: res.headers() };
}
async function login(account) {
  const ctx = await api();
  const r = await call(ctx, 'POST', '/auth/login', { email: account.email, password: account.password });
  await ctx.dispose();
  return r;
}
async function session(account) {
  const r = await login(account);
  if (!r.json?.accessToken) throw new Error(`login failed for ${account.role}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  const ctx = await api(r.json.accessToken);
  return { ctx, token: r.json.accessToken, refreshToken: r.json.refreshToken, user: r.json.data || {}, account };
}

// ---------- result collector ----------
class Suite {
  constructor(area, section, testInfo) {
    this.area = area; this.section = section; this.testInfo = testInfo;
    this.checks = []; this.shotNo = 0;
    this.dir = path.join(ROOT, 'evidence', 'Checklist', area, `run-${RUN}`);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(path.join(ROOT, 'evidence', 'Checklist', 'results'), { recursive: true });
  }
  log(m) { console.log(m); this.testInfo?.annotations.push({ type: 'log', description: String(m).slice(0, 600) }); }
  // type: positive | negative | edge | bva ; ref: checklist line/section text
  add({ id, title, type, ref, expected, actual, ok, note, screenshot }) {
    const c = { id, title, type, ref, expected: String(expected), actual: String(actual).slice(0, 400), ok: !!ok, note: note || '', screenshot: screenshot || '' };
    this.checks.push(c);
    this.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | expected: ${expected} | actual: ${String(actual).slice(0, 160)}`);
    expect.soft(ok, `${id} ${title}: expected ${expected}, got ${String(actual).slice(0, 200)}`).toBe(true);
    return c;
  }
  async shot(page, name) {
    this.shotNo += 1;
    const file = `${this.area}_${String(this.shotNo).padStart(2, '0')}_${name}.png`;
    try { await page.screenshot({ path: path.join(this.dir, file) }); } catch (e) { this.log(`screenshot failed: ${e.message}`); }
    return path.relative(ROOT, path.join(this.dir, file)).replace(/\\/g, '/');
  }
  save() {
    const out = { area: this.area, section: this.section, run: RUN, date: new Date().toISOString(), env: { ui: BASE_URL, api: API_URL }, checks: this.checks,
      summary: { total: this.checks.length, pass: this.checks.filter((c) => c.ok).length, fail: this.checks.filter((c) => !c.ok).length } };
    fs.writeFileSync(path.join(this.dir, 'results.json'), JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join(ROOT, 'evidence', 'Checklist', 'results', `${this.area}.json`), JSON.stringify(out, null, 2));
    this.log(`saved ${this.area}: ${out.summary.pass} pass / ${out.summary.fail} fail`);
    return out;
  }
}

// run a step; any thrown error becomes a failed check instead of aborting the spec
async function step(suite, id, title, type, ref, fn) {
  try { await fn(); }
  catch (e) { suite.add({ id, title, type, ref, expected: 'step completes', actual: `ERROR: ${e.message}`, ok: false }); }
}

const inRange = (s, list) => (Array.isArray(list) ? list.includes(s) : s === list);
const msg = (r) => { const m = r.json?.message; return Array.isArray(m) ? m.join(' | ') : (m ?? r.text.slice(0, 200)); };

module.exports = { ROOT, accounts, testAccounts, API_URL, BASE_URL, RUN, H, u, byRole, pending, GEO, api, call, login, session, Suite, step, inRange, msg };
