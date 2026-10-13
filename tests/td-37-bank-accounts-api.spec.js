// TD-37: "Separate Bank Account API from User Detail / invoice" - multiple bank accounts managed independently by id
// https://techdomain.atlassian.net/browse/TD-37   (labels: Backend, api; Platform: Web)
//
// Requirements from the ticket:
//   R1 unique accountId per bank account          R5 requested account must belong to the authenticated user
//   R2 retrieve ONE account by its id              R6 other users must not access someone else's account
//   R3 updating one account leaves the others      R7 sensitive data not exposed unnecessarily
//   R4 deleting one account leaves the others
//
// Part A (API, engineer A = Individual Engineer, B = Vendor Engineer, C = TechDomain client user, admin):
//   A1 create two accounts -> distinct ids                 A5 cross-user PATCH / DELETE / list (B, C)
//   A2 get-by-id: every candidate route + what the         A6 cross-user GET /bankDetails/<id>  (what it actually returns)
//      current GET /bankDetails/:x really keys on          A7 exposure: owner list, provider view, leak check
//   A3 update isolation                                     A8 ownership: userId in POST/PATCH body and DELETE path ignored?
//   A4 delete isolation
// Part B (UI, engineer Profile Settings > Bank Accounts): list, view, edit (PATCH by id), delete (DELETE by id) - the other account stays.
//
// Run:  npx playwright test tests/td-37-bank-accounts-api.spec.js --reporter=line --trace off
// Evidence: evidence/TD-37-BankAccountsApi/run-<stamp>/  (results.json, summary.txt, TD-37_BankAccounts_NN_*.png)

const { test, expect, request: pwRequest } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const API_URL = (process.env.API_URL || 'https://api.dev.techdomain.com.au/api').replace(/\/$/, '');
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(4);
const EVIDENCE = path.join(__dirname, '..', 'evidence', 'TD-37-BankAccountsApi', `run-${RUN}`);
const u = (p) => `${API_URL}/${String(p).replace(/^\//, '')}`;
const H = { Origin: 'https://dev.techdomain.com.au' };
const byRole = (r) => accounts.find((a) => a.role === r);
const SENSITIVE = ['accountNumber', 'iban', 'swiftCode', 'bsb', 'routingNumber', 'sortCode'];

test.setTimeout(600_000);
let shotNo = 0;
async function shot(page, name, full = false) { shotNo += 1; const f = path.join(EVIDENCE, `TD-37_BankAccounts_${String(shotNo).padStart(2, '0')}_${name}.png`); await page.screenshot({ path: f, fullPage: full }).catch(() => { }); return path.basename(f); }
async function session(account) {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: H });
  const res = await ctx.post(u('/auth/login'), { data: { email: account.email, password: account.password } });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  if (!body.accessToken) throw new Error(`login failed for ${account.email}: ${res.status()}`);
  const api = await pwRequest.newContext({ extraHTTPHeaders: { ...H, Authorization: `Bearer ${body.accessToken}` } });
  const me = await (await api.get(u('/users/me'))).json().catch(() => ({}));
  const user = me.user || me.data || me;
  return { api, id: user.id, role: account.role, email: account.email };
}
async function req(s, method, p, data) {
  const res = await s.api.fetch(u(p), { method, data });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status(), body: json };
}
const listOf = (r) => { const d = r.body?.data?.data ?? r.body?.data ?? r.body; return Array.isArray(d) ? d : []; };
const brief = (rows) => rows.map((x) => ({ id: x.id, userId: x.userId, holder: x.accountHolderName, bank: x.bankName, accountNumber: x.accountNumber }));
const account = (n) => ({
  accountHolderName: `TD37 Holder ${n} ${RUN}`, bankName: `TD37 Bank ${n}`, bankAddress: `${n} Test St`,
  accountNumber: `9000${RUN}${n}`.slice(0, 12), iban: `AU${n}${RUN}0000`, swiftCode: `TDBK${n}AU`,
  accountType: 'SAVINGS', currency: 'AUD', bsb: `06${n}-00${n}`,
});
async function uiLogin(page, acc) {
  await page.goto('/login');
  await page.locator('input[type="email"], input[name="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.locator('button[type="submit"], button:has-text("Login")').first().click();
  await expect(page).not.toHaveURL(/\/login/i, { timeout: 30_000 });
  await page.waitForTimeout(2_500);
}
const texts = async (loc) => (await loc.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);

test('TD-37 bank accounts are independently manageable by id with owner-only access', async ({ browser }, testInfo) => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const log = (m) => { console.log(m); testInfo.annotations.push({ type: 'log', description: String(m).slice(0, 900) }); };
  const results = { run: RUN, checks: [], findings: [], api: {}, ui: {} };
  const check = (n, ok, detail) => { results.checks.push({ name: n, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} - ${n}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); expect.soft(!!ok, `${n} ${JSON.stringify(detail || '').slice(0, 300)}`).toBe(true); };
  const info = (n, detail) => { results.checks.push({ name: n, ok: true, info: true, detail }); log(`INFO - ${n} :: ${JSON.stringify(detail).slice(0, 600)}`); };

  const A = await session(byRole('Individual Engineer'));
  const B = await session(byRole('Vendor Engineer'));
  const C = await session(byRole('TechDomain User'));
  const AD = await session(byRole('Admin'));
  log(`A=${A.id} (${A.role}), B=${B.id} (${B.role}), C=${C.id} (${C.role}), admin=${AD.id}`);
  results.api.users = { A: A.id, B: B.id, C: C.id, admin: AD.id };
  const created = []; let bId = null;
  const mine = async (s) => listOf(await req(s, 'GET', `/bankDetails/user/${s.id}?page=1&limit=50`));
  const isTestRow = (x) => /^TD37/.test(x.bankName || '') || /^TD37/.test(x.accountHolderName || '');
  const cleanup = async (sessions) => {
    for (const s of sessions) { for (const x of await mine(s)) if (isTestRow(x)) { const r = await req(s, 'DELETE', `/bankDetails/${x.id}/${s.id}`); log(`cleanup ${s.role} ${x.id} -> ${r.status}`); } }
  };
  await cleanup([A, B]); // stale rows from earlier runs

  try {
    // ---------------- A1: create two accounts for A (+ one for B) ----------------
    for (const n of [1, 2]) {
      const r = await req(A, 'POST', '/bankDetails', account(n));
      const id = r.body?.data?.id; if (id) created.push(id);
      results.api[`create${n}`] = { status: r.status, id, keys: Object.keys(r.body?.data || {}) };
      log(`A POST /bankDetails #${n} -> ${r.status} id=${id}`);
    }
    const rb = await req(B, 'POST', '/bankDetails', { ...account(3), bankName: 'TD37 Bank B' }); bId = rb.body?.data?.id;
    const [id1, id2] = created;
    check('A1 (R1): two accounts created with distinct ids (uuid)', created.length === 2 && id1 !== id2 && /^[0-9a-f-]{36}$/.test(id1), { ids: created });
    const listA = await mine(A);
    results.api.listA = brief(listA);
    check('A1: owner list GET /bankDetails/user/:id shows both new accounts', created.every((id) => listA.some((x) => x.id === id)), { list: results.api.listA });

    // ---------------- A2 (R2): is there a get-ONE-account-by-id route? ----------------
    results.api.getById = {};
    const probes = [`/bankDetails/${id1}`, `/bankDetails/account/${id1}`, `/bankDetails/details/${id1}`, `/bankDetails/user/${A.id}/${id1}`, `/bankAccounts/${id1}`, `/bank-accounts/${id1}`, `/bankDetails/${id1}?userId=${A.id}`];
    for (const p of probes) {
      const r = await req(A, 'GET', p);
      const d = r.body?.data?.data ?? r.body?.data ?? r.body;
      const single = !!d && !Array.isArray(d) && d.id === id1;
      const arr = Array.isArray(d) ? d : null;
      results.api.getById[p] = { status: r.status, single, arrayLen: arr ? arr.length : null, ids: arr ? arr.map((x) => x.id) : undefined, sample: JSON.stringify(r.body).slice(0, 200) };
      log(`A GET ${p} -> ${r.status} single=${single} arrayLen=${arr ? arr.length : '-'}`);
    }
    const singleRoute = Object.entries(results.api.getById).find(([, v]) => v.status === 200 && v.single)?.[0] || null;
    check('A2 (R2): a route returns exactly ONE account for its id', !!singleRoute, { route: singleRoute, probed: Object.fromEntries(Object.entries(results.api.getById).map(([k, v]) => [k, `${v.status}${v.arrayLen != null ? ' array[' + v.arrayLen + ']' : ''}`])) });
    // what GET /bankDetails/:x really keys on: same answer for account id, garbage, numeric (= branch filter)
    const byAcc = listOf(await req(A, 'GET', `/bankDetails/${id1}`)), byOther = listOf(await req(A, 'GET', `/bankDetails/${id2}`)), byJunk = listOf(await req(A, 'GET', `/bankDetails/not-an-id`)), byNum = await req(A, 'GET', `/bankDetails/1`);
    results.api.getByIdSemantics = { byAccountId1: byAcc.map((x) => x.id), byAccountId2: byOther.map((x) => x.id), byJunk: byJunk.map((x) => x.id), byNumeric1: { status: byNum.status, len: listOf(byNum).length } };
    check('A2 (R2): GET /bankDetails/:id honours the account id (id1 -> only id1, id2 -> only id2)', byAcc.length === 1 && byAcc[0].id === id1 && byOther.length === 1 && byOther[0].id === id2, results.api.getByIdSemantics);

    // ---------------- A3 (R3): update isolation ----------------
    const before2 = (await mine(A)).find((x) => x.id === id2);
    const upd = await req(A, 'PATCH', `/bankDetails/${id1}`, { bankName: `TD37 Bank 1 UPDATED ${RUN}`, accountNumber: `7777${RUN}`.slice(0, 12) });
    const afterList = await mine(A);
    const after1 = afterList.find((x) => x.id === id1), after2 = afterList.find((x) => x.id === id2);
    results.api.update = { status: upd.status, acc1: { bank: after1?.bankName, accountNumber: after1?.accountNumber }, acc2Unchanged: JSON.stringify(before2) === JSON.stringify(after2), responseKeys: Object.keys(upd.body?.data || {}) };
    check('A3 (R3): PATCH /bankDetails/:id updates only that account', upd.status === 200 && /UPDATED/.test(after1?.bankName || '') && results.api.update.acc2Unchanged, results.api.update);
    const updMissing = await req(A, 'PATCH', `/bankDetails/00000000-0000-0000-0000-000000000000`, { bankName: 'x' });
    check('A3: PATCH on an unknown id -> 404', updMissing.status === 404, { status: updMissing.status, body: updMissing.body });

    // ---------------- A5 (R5/R6): other users cannot modify / list A's accounts ----------------
    results.api.crossUser = {};
    for (const [label, s] of [['B vendor-engineer', B], ['C client', C]]) {
      const p = await req(s, 'PATCH', `/bankDetails/${id2}`, { bankName: 'HACKED' });
      const p2 = await req(s, 'PATCH', `/bankDetails/${id2}`, { bankName: 'HACKED', userId: A.id });
      const d = await req(s, 'DELETE', `/bankDetails/${id2}/${A.id}`);
      const d2 = await req(s, 'DELETE', `/bankDetails/${id2}/${s.id}`);
      const l = await req(s, 'GET', `/bankDetails/user/${A.id}?limit=50`);
      const lRows = listOf(l);
      results.api.crossUser[label] = { patch: p.status, patchWithUserId: p2.status, deleteWithOwnerId: d.status, deleteWithOwnId: d2.status, listOfA: { status: l.status, rows: brief(lRows), showsA: lRows.some((x) => x.id === id2), ownerIds: [...new Set(lRows.map((x) => x.userId))] } };
      log(`${label}: PATCH=${p.status}/${p2.status} DELETE=${d.status}/${d2.status} list(A)=${l.status} rows=${lRows.length} owners=${results.api.crossUser[label].listOfA.ownerIds}`);
      check(`A5 (R5/R6) ${label}: PATCH on A's account refused`, [401, 403, 404].includes(p.status) && [401, 403, 404].includes(p2.status), { patch: p.status, patchWithUserId: p2.status, body: p.body });
      check(`A5 (R5/R6) ${label}: DELETE on A's account refused`, [401, 403, 404].includes(d.status) && [401, 403, 404].includes(d2.status), { d: d.status, d2: d2.status, body: d.body });
      check(`A5 (R6) ${label}: GET /bankDetails/user/<A.id> does not expose A's accounts`, !lRows.some((x) => x.id === id2) && !lRows.some((x) => x.userId === A.id), results.api.crossUser[label].listOfA);
    }
    const intact2 = (await mine(A)).find((x) => x.id === id2);
    check("A5: A's account 2 intact after the other users' attempts", !!intact2 && intact2.bankName === 'TD37 Bank 2', { acc2: intact2 && brief([intact2])[0] });

    // ---------------- A6 (R6/R7): what GET /bankDetails/<id> returns to OTHER users ----------------
    results.api.leak = {};
    for (const [label, s] of [['B vendor-engineer', B], ['C client', C], ['admin', AD]]) {
      const r = await req(s, 'GET', `/bankDetails/${id1}`);
      const rows = listOf(r);
      const foreign = rows.filter((x) => created.includes(x.id));
      const sens = foreign.length ? SENSITIVE.filter((k) => foreign[0][k] != null) : [];
      results.api.leak[label] = { status: r.status, rows: brief(rows), returnsAsAccounts: foreign.length, sensitiveFields: sens };
      log(`${label} GET /bankDetails/${id1} -> ${r.status} rows=${rows.length} A's accounts=${foreign.length} sensitive=${sens}`);
      if (label === 'admin') info(`A6 admin GET /bankDetails/<A's account id>`, results.api.leak[label]);
      else check(`A6 (R6/R7) ${label}: GET /bankDetails/<A's account id> must not return A's bank account details`, foreign.length === 0, results.api.leak[label]);
    }
    const bOwn = listOf(await req(B, 'GET', `/bankDetails/${id1}`));
    info("A6: B's answer to GET /bankDetails/<A's id> (B's own account list - param ignored)", { rows: brief(bOwn), bAccount: bId });

    // ---------------- A7 (R7): exposure ----------------
    const prov = await req(C, 'GET', `/bankDetails/user/${A.id}/bankAccountDetails`);
    const provRows = listOf(prov);
    results.api.providerView = { status: prov.status, rows: provRows, keys: Object.keys(provRows[0] || {}) };
    check('A7 (R7): provider view used by the invoice screen exposes only id / bankName / currency', prov.status === 200 && provRows.length > 0 && provRows.every((x) => !SENSITIVE.some((k) => k in x)), results.api.providerView);
    const provB = await req(B, 'GET', `/bankDetails/user/${A.id}/bankAccountDetails`);
    info('A7: provider view for a vendor engineer (B)', { status: provB.status, body: JSON.stringify(provB.body).slice(0, 150) });
    info('A7: owner list fields', { keys: Object.keys(listA[0] || {}) });

    // ---------------- A8: ownership comes from the token, not from ids in the request ----------------
    const forB = await req(A, 'POST', '/bankDetails', { ...account(4), userId: B.id });
    const forBId = forB.body?.data?.id; if (forBId) created.push(forBId);
    const whoHasIt = (await mine(A)).some((x) => x.id === forBId) ? 'A' : (await mine(B)).some((x) => x.id === forBId) ? 'B' : 'nobody';
    check('A8: POST with userId of another user in the body still creates the account for the caller', forB.status === 201 && whoHasIt === 'A', { status: forB.status, owner: whoHasIt });
    const moveOwner = await req(A, 'PATCH', `/bankDetails/${id2}`, { userId: B.id });
    const stillA = (await mine(A)).some((x) => x.id === id2);
    check('A8: PATCH userId cannot move an account to another user', stillA, { status: moveOwner.status, stillOwnedByA: stillA });
    const delWrongUser = await req(A, 'DELETE', `/bankDetails/${forBId}/${B.id}`);
    const goneWrong = !(await mine(A)).some((x) => x.id === forBId);
    info('A8: DELETE /bankDetails/:id/:userId with a WRONG userId (owner token) - userId path param ignored', { status: delWrongUser.status, body: delWrongUser.body, deleted: goneWrong });
    const delNoUser = await req(A, 'DELETE', `/bankDetails/${id2}`);
    info('A8: DELETE /bankDetails/:id without userId segment', { status: delNoUser.status });

    // ---------------- A4 (R4): delete isolation ----------------
    const del = await req(A, 'DELETE', `/bankDetails/${id1}/${A.id}`);
    const afterDel = await mine(A);
    results.api.delete = { status: del.status, body: del.body, acc1Gone: !afterDel.some((x) => x.id === id1), acc2Present: afterDel.some((x) => x.id === id2) };
    check('A4 (R4): DELETE /bankDetails/:id/:userId removes only that account', del.status === 200 && results.api.delete.acc1Gone && results.api.delete.acc2Present, results.api.delete);
    const delAgain = await req(A, 'DELETE', `/bankDetails/${id1}/${A.id}`);
    check('A4: deleting the same id twice -> 404', delAgain.status === 404, { status: delAgain.status, body: delAgain.body });

    // ================= Part B: UI (engineer Profile Settings > Bank Accounts) =================
    const ui1 = (await req(A, 'POST', '/bankDetails', { ...account(5), bankName: 'TD37 UI Bank 5' })).body?.data?.id;
    const ui2 = (await req(A, 'POST', '/bankDetails', { ...account(6), bankName: 'TD37 UI Bank 6' })).body?.data?.id;
    created.push(ui1, ui2);
    const ctx = await browser.newContext({ viewport: { width: 2400, height: 1000 }, geolocation: { latitude: 31.52, longitude: 74.36 }, permissions: ['geolocation'] });
    const page = await ctx.newPage(); page.setDefaultTimeout(15_000);
    const calls = [];
    page.on('request', (r) => { if (/\/api\/bankDetails/.test(r.url())) calls.push({ t: Date.now(), method: r.method(), path: r.url().replace(/^.*\/api\//, '/'), post: r.postData() || null }); });
    page.on('response', (r) => { const c = calls.find((x) => !x.status && x.method === r.request().method() && r.url().endsWith(x.path.slice(1))); if (c) c.status = r.status(); });
    const toasts = () => texts(page.locator('.Toastify__toast, [role="alert"], .MuiSnackbar-root, .MuiAlert-message'));
    await uiLogin(page, byRole('Individual Engineer'));
    const A2 = await session(byRole('Individual Engineer')); // the UI login invalidated A's API token
    const mineA = () => mine(A2);
    await page.goto('/user/settings'); await page.waitForTimeout(3_000);
    await page.locator('[role="tab"], .MuiTab-root, button').filter({ hasText: /^bank accounts$/i }).first().click();
    await page.waitForTimeout(4_000);
    const row = (id) => page.locator(`.MuiDataGrid-row[data-id="${id}"]`);
    const listCalls = calls.filter((c) => c.method === 'GET' && /bankDetails\/user\//.test(c.path));
    results.ui.listCalls = listCalls.map((c) => `${c.method} ${c.path} -> ${c.status}`);
    await shot(page, 'engineer-bank-accounts-list', true);
    check('B1: Bank Accounts tab lists both accounts (rows keyed by account id)', (await row(ui1).count()) === 1 && (await row(ui2).count()) === 1, { rows: await texts(page.locator('.MuiDataGrid-row')), calls: results.ui.listCalls });
    info('B1: list request sent by the UI (note the userId segment)', { calls: results.ui.listCalls });

    // B2: view one account (click holder name)
    calls.length = 0;
    await row(ui1).locator('[data-field="accountHolderName"] p').click();
    await page.waitForTimeout(2_000);
    const modalVals = async () => { const o = {}; for (const n of ['accountHolderName', 'bankName', 'accountNumber', 'iban', 'currency', 'accountType']) o[n] = await page.locator(`input[name="${n}"]:visible`).first().inputValue().catch(() => null); o.title = (await texts(page.locator('h1:visible, h2:visible, h3:visible, h4:visible, h5:visible, h6:visible'))).filter((t) => /bank account/i.test(t)).join(' | '); o.selects = await texts(page.locator('[role="combobox"]:visible, .MuiSelect-select:visible')); return o; };
    const view = await modalVals();
    await shot(page, 'engineer-view-account-1');
    results.ui.view = { ...view, calls: calls.map((c) => `${c.method} ${c.path} -> ${c.status}`) };
    info('B2: "Bank Account Details" modal content + API calls made to open it (none = rendered from the row)', results.ui.view);
    check('B2: view modal shows account 1 only (holder/bank of account 1, no API call needed)', view.bankName === 'TD37 UI Bank 5' && /Holder 5/.test(view.accountHolderName || ''), view);
    check('B2: view modal shows the account currency (AUD) rather than the PKR default', (view.selects || []).some((t) => /AUD/.test(t)) || view.currency === 'AUD', { selects: view.selects, currency: view.currency });
    const closeBtn = page.locator('button:visible').filter({ hasText: /^(close|cancel)$/i }).first();
    if (await closeBtn.count()) await closeBtn.click().catch(() => { }); else await page.keyboard.press('Escape');
    await page.waitForTimeout(1_000);

    // B3: edit account 1 via Actions > Edit
    const openActions = async (id) => {
      await page.evaluate(() => { const v = document.querySelector('.MuiDataGrid-virtualScroller'); if (v) v.scrollLeft = 10000; });
      await page.waitForTimeout(1_200);
      await row(id).locator('[data-field="actions"] i, [data-field="actions"] button, [data-field="actions"] svg').first().click({ force: true });
      await page.waitForTimeout(1_000);
      return texts(page.locator('[role="menuitem"]:visible'));
    };
    const menuItem = (re) => page.locator('[role="menuitem"]:visible').filter({ hasText: re }).first();
    const menu = await openActions(ui1);
    await shot(page, 'engineer-actions-menu');
    info('B3: row Actions menu', { menu });
    await menuItem(/^edit$/i).click({ force: true });
    await page.waitForTimeout(2_000);
    const bankInput = page.locator('input[name="bankName"]:visible').first();
    const editVals = await modalVals();
    const editTitle = editVals.title, prefill = editVals.bankName;
    await bankInput.fill('TD37 UI Bank 5 EDITED');
    await shot(page, 'engineer-edit-account-1-form');
    calls.length = 0;
    await page.locator('button:visible').filter({ hasText: /update|save/i }).first().click();
    const seen = new Set(); const t0 = Date.now();
    while (Date.now() - t0 < 6_000) { for (const t of await toasts()) seen.add(t); await page.waitForTimeout(300); }
    await shot(page, 'engineer-after-edit', true);
    const patch = calls.filter((c) => c.method === 'PATCH');
    results.ui.edit = { title: editTitle, prefill, calls: calls.map((c) => `${c.method} ${c.path} -> ${c.status} ${c.post || ''}`.slice(0, 300)), toasts: [...seen] };
    const listAfterEdit = await mineA();
    const e1 = listAfterEdit.find((x) => x.id === ui1), e2 = listAfterEdit.find((x) => x.id === ui2);
    check('B3 (R3): UI edit sends PATCH /bankDetails/<account id> and only account 1 changes', patch.length === 1 && patch[0].path === `/bankDetails/${ui1}` && patch[0].status === 200 && /EDITED/.test(e1?.bankName || '') && e2?.bankName === 'TD37 UI Bank 6', { ...results.ui.edit, acc1: e1?.bankName, acc2: e2?.bankName });
    check('B3: edit form was pre-filled with account 1 (not account 2)', prefill === 'TD37 UI Bank 5', { prefill, title: editTitle });
    await page.evaluate(() => { const v = document.querySelector('.MuiDataGrid-virtualScroller'); if (v) v.scrollLeft = 0; }); await page.waitForTimeout(800);
    check('B3: grid shows the edited name on row 1 and the old name on row 2', /EDITED/.test(await row(ui1).innerText().catch(() => '')) && /TD37 UI Bank 6/.test(await row(ui2).innerText().catch(() => '')), {});

    // B4: delete account 1 via Actions > Delete
    await openActions(ui1);
    await menuItem(/^delete$/i).click({ force: true });
    await page.waitForTimeout(1_500);
    const dlgTxt = (await texts(page.locator('p:visible, h2:visible, h3:visible, h4:visible'))).filter((t) => /delete|sure/i.test(t)).join(' ').slice(0, 300);
    await shot(page, 'engineer-delete-confirm');
    calls.length = 0; seen.clear();
    await page.locator('button:visible').filter({ hasText: /^delete$/i }).first().click();
    const t1 = Date.now();
    while (Date.now() - t1 < 6_000) { for (const t of await toasts()) seen.add(t); await page.waitForTimeout(300); }
    await shot(page, 'engineer-after-delete', true);
    const dels = calls.filter((c) => c.method === 'DELETE');
    results.ui.delete = { dialog: dlgTxt, calls: calls.map((c) => `${c.method} ${c.path} -> ${c.status}`), toasts: [...seen] };
    const listAfterDel = await mineA();
    check('B4 (R4): UI delete sends DELETE /bankDetails/<account id>/<userId>; account 1 gone, account 2 stays', dels.length === 1 && dels[0].path === `/bankDetails/${ui1}/${A.id}` && dels[0].status === 200 && !listAfterDel.some((x) => x.id === ui1) && listAfterDel.some((x) => x.id === ui2), { ...results.ui.delete, remaining: brief(listAfterDel) });
    check('B4: grid keeps account 2 and drops account 1 after delete', (await row(ui1).count()) === 0 && (await row(ui2).count()) === 1, { toasts: [...seen] });
    check('B4: confirm dialog names the account being deleted', /TD37 Holder 5/i.test(dlgTxt), { dialog: dlgTxt });
    await ctx.close();
  } finally {
    const A3 = await session(byRole('Individual Engineer'));
    await cleanup([A3, B]);
    const summary = results.checks.map((c) => `${c.info ? 'INFO' : c.ok ? 'PASS' : 'FAIL'} ${c.name}`).join('\n');
    for (const c of results.checks) if (!c.ok) results.findings.push(c.name);
    log(`\nSUMMARY\n${summary}\nFINDINGS: ${results.findings.join(' | ') || 'none'}`);
    fs.writeFileSync(path.join(EVIDENCE, 'results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(EVIDENCE, 'summary.txt'), summary + '\n');
  }
});
