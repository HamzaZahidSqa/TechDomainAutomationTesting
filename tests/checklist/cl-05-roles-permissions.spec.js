// Checklist 10% — Area 05: Roles & permissions (§6, §6.1 default module matrix, §6.2 screen access, RequireAuth role landing)
// Every account in accounts.json: API login → permission matrix checks; UI login → landing page + sidebar items; cross-role API 403s.
const { test, expect } = require('@playwright/test');
const L = require('./_lib');

test.setTimeout(900_000);

const perm = (perms, mod) => perms.find((p) => p.module === mod);
const crud = (p) => (p ? `${p.isRead ? 'R' : '-'}${p.isWrite ? 'W' : '-'}${p.isUpdate ? 'U' : '-'}${p.isDelete ? 'D' : '-'}` : 'none');
const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();

test('CL-05 Roles & permissions', async ({ browser }, testInfo) => {
  const S = new L.Suite('05-RolesPermissions', 'Roles & permissions (§6)', testInfo);
  const sessions = {};

  // ---------- permission matrix from the login payload ----------
  const expectMatrix = {
    Admin: { has: { ADMIN_NEW_USERS_MANAGEMENT: 'RWUD', MANAGE: 'RWUD', COMPANIES: 'RWUD', USERS: 'RWUD', WORK_EXPERIENCE: 'RWUD', QUALIFICATIONS: 'RWUD' }, not: ['WORK_ORDERS', 'JOBS'] },
    'TechDomain User': { has: { WORK_ORDERS: 'RWUD', COMPANIES: 'RWUD', USER_PERMISSIONS: 'RWUD', JOBS: 'RWUD', INVOICE: 'RWUD', TASK_BOARD: 'RWUD', CUSTOMER_WORK_ORDERS: 'RWUD', ACTION_APPROVE_WORK_ORDER: 'RWUD' }, not: ['ADMIN_NEW_USERS_MANAGEMENT', 'MANAGE', 'CLIENT_WORK_ORDERS'] },
    'Individual Engineer': { has: { JOBS: /RWU/, USERS: /R/ }, not: ['WORK_ORDERS', 'COMPANIES', 'INVOICE', 'ADMIN_NEW_USERS_MANAGEMENT'] },
    Vendor: { has: { JOBS: /RWU/, USERS: /R/ }, not: ['WORK_ORDERS', 'ADMIN_NEW_USERS_MANAGEMENT'] },
    'Vendor Engineer': { has: { JOBS: /RWU/, USERS: /R/ }, not: ['WORK_ORDERS', 'FREELANCE_COMPANY_WORKERS', 'ADMIN_NEW_USERS_MANAGEMENT'] },
    Customer: { has: { CLIENT_WORK_ORDERS: 'RWUD', INVOICE: /R/, CUSTOMER_INVOICE: /R/, ACTION_SEND_CUSTOMER_INVOICE: /RW/, USERS: 'RWUD' }, not: ['ACTION_VERIFY_CUSTOMER_INVOICE', 'WORK_ORDERS', 'ADMIN_NEW_USERS_MANAGEMENT', 'ACTION_PAID_CUSTOMER_INVOICE'] },
    'Customer User': { has: { CLIENT_WORK_ORDERS: 'RWUD', ACTION_SEND_CUSTOMER_INVOICE: /RW/ }, not: ['ACTION_VERIFY_CUSTOMER_INVOICE', 'CUSTOMER_USERS', 'WORK_ORDERS'] },
  };
  for (const a of L.accounts) {
    await L.step(S, `PM-${a.role}`, a.role, 'positive', '§6.1 matrix', async () => {
      const s = await L.session(a); sessions[a.role] = s;
      const perms = s.user?.role?.permissions || [];
      const ex = expectMatrix[a.role];
      for (const [mod, want] of Object.entries(ex.has)) {
        const got = crud(perm(perms, mod));
        const ok = want instanceof RegExp ? want.test(got) : got === want;
        S.add({ id: `PM-${a.role}-${mod}`, title: `${a.role} has ${mod} = ${want}`, type: 'positive', ref: '§6.1 Default module × role matrix', expected: String(want), actual: got, ok });
      }
      for (const mod of ex.not) {
        const got = perm(perms, mod);
        S.add({ id: `PM-${a.role}-no-${mod}`, title: `${a.role} has NO ${mod} row`, type: 'negative', ref: '§6.1 matrix (– = no row)', expected: 'none', actual: crud(got), ok: !got || (!got.isRead && !got.isWrite && !got.isUpdate && !got.isDelete) });
      }
      if (a.role === 'TechDomain User') {
        for (const mod of ['WORK_FORCE_ENGINEERS', 'WORK_FORCE_TALENT_POOL', 'WORK_FORCE_COVERAGE_MAP']) {
          const got = crud(perm(perms, mod));
          S.add({ id: `PM-BUG-${mod}`, title: `Client owner ${mod} (checklist [BUG?]: missing for self-signup owners / R-only coverage map)`, type: 'edge', ref: '§6.1 [BUG?] Clients who signed up themselves lack WORK_FORCE_ENGINEERS/TALENT_POOL; Coverage Map R-only for login-auto owners', expected: 'RWUD ideally', actual: got, ok: got !== 'none', note: got === 'none' ? 'CONFIRMED: module missing → Work Force menu hidden for this client' : (got !== 'RWUD' ? 'partial rights (informational)' : '') });
        }
      }
      S.add({ id: `PM-${a.role}-dup`, title: `${a.role}: no duplicate module rows`, type: 'edge', ref: '§6 permissions rows', expected: 'unique modules', actual: `rows=${perms.length} unique=${new Set(perms.map((p) => p.module)).size}`, ok: perms.length === new Set(perms.map((p) => p.module)).size });
    });
  }

  // ---------- cross-role API access (expect 401/403) ----------
  const deny = [
    ['XR-01', 'Individual Engineer', 'POST', '/admin/inviteEngineer', { email: `x-${L.RUN}@mailinator.com` }, 'ADMIN only'],
    ['XR-02', 'Customer', 'POST', '/admin/inviteEngineer', { email: `x-${L.RUN}@mailinator.com` }, 'ADMIN only'],
    ['XR-03', 'Individual Engineer', 'GET', '/clients', undefined, 'CLIENT_CUSTOMER read'],
    ['XR-04', 'Customer', 'GET', '/teams', undefined, 'COMPANIES read'],
    ['XR-05', 'Individual Engineer', 'GET', '/projects', undefined, 'CLIENT_PROJECT read'],
    ['XR-06', 'Customer', 'POST', '/offers/route', { workOrderId: 1, engineerId: 1 }, 'WORK_ORDERS write'],
    ['XR-07', 'TechDomain User', 'GET', '/admin/review/engineers', undefined, 'ADMIN only'],
    ['XR-08', 'Individual Engineer', 'GET', '/admin/approveProfile/999999999', undefined, 'ADMIN only'],
    ['XR-09', 'Customer User', 'POST', '/customerUsers/createUser', { firstName: 'x', lastName: 'y', email: `x-${L.RUN}@mailinator.com`, phoneNumber: '+61400000000' }, 'CUSTOMER_USERS (sub-user has none)'],
    ['XR-10', 'Vendor Engineer', 'POST', '/freelanceCompany/createEngineer', { firstName: 'x', lastName: 'y', email: `x-${L.RUN}@mailinator.com`, phoneNumber: '+61400000000', password: 'Check@2026x' }, 'company owner only'],
    ['XR-11', 'Individual Engineer', 'GET', '/customerUsers', undefined, 'CUSTOMER only'],
    ['XR-12', 'Customer', 'GET', '/users/engineer/submitProfile', undefined, 'FREELANCER only'],
  ];
  for (const [id, role, m, p, body, why] of deny) {
    await L.step(S, id, p, 'negative', '§6.2 backend @RequiredPermissions', async () => {
      const s = sessions[role]; if (!s) throw new Error(`no session for ${role}`);
      const r = await L.call(s.ctx, m, p, body);
      S.add({ id, title: `${role} → ${m} ${p} is refused (${why})`, type: 'negative', ref: '§6.2 Test each with a role that is missing the module and expect 403', expected: 'HTTP 401/403 (404 acceptable)', actual: `HTTP ${r.status} msg="${L.msg(r)}"`, ok: [401, 403, 404].includes(r.status), note: r.status < 300 ? 'ACCESS ALLOWED — permission gap' : (r.status === 500 ? 'SERVER ERROR 500' : (r.status === 400 ? 'validation ran before the permission check (informational)' : '')) });
    });
  }

  // ---------- UI: landing page + sidebar per role ----------
  const uiExpect = {
    Admin: { land: /\/admin\/review\/engineers/, items: ['Accounts', 'Manage'], notItems: ['Work Board', 'Job'] },
    'TechDomain User': { land: /\/workBoard\/workOrders/, items: ['Dashboard', 'Work Board', 'Task Board', 'Invoices'], notItems: ['Accounts', 'Manage'] },
    'Individual Engineer': { land: /\/jobs/, items: ['Analytics', 'Job'], notItems: ['Workers', 'Work Board', 'Invoices'] },
    Vendor: { land: /\/jobs/, items: ['Analytics', 'Job', 'Workers'], notItems: ['Work Board'] },
    'Vendor Engineer': { land: /\/jobs/, items: ['Analytics', 'Job'], notItems: ['Workers', 'Work Board'] },
    Customer: { land: /\/workOrders/, items: ['Dashboard', 'Work Orders', 'Invoices'], notItems: ['Task Board', 'Accounts'] },
    'Customer User': { land: /\/workOrders/, items: ['Dashboard', 'Work Orders'], notItems: ['Task Board', 'Accounts'] },
  };
  for (const a of L.accounts) {
    await L.step(S, `UI-${a.role}`, a.role, 'positive', '§6.2 screens per role', async () => {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...L.GEO }); const p = await c.newPage(); p.setDefaultTimeout(15_000);
      await p.goto('/login');
      await p.locator('input[type="email"], input[name="email"]').first().fill(a.email); await p.locator('input[type="password"]').first().fill(a.password);
      await p.locator('button[type="submit"]').first().click();
      await p.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 }).catch(() => { });
      await p.waitForTimeout(3500);
      const ex = uiExpect[a.role];
      const shot = await S.shot(p, `${a.role.replace(/\s+/g, '')}-landing`);
      S.add({ id: `UI-${a.role}-land`, title: `${a.role} lands on ${ex.land}`, type: 'positive', ref: 'RequireAuth / setLoginSuccessful role redirect', expected: String(ex.land), actual: p.url(), ok: ex.land.test(p.url()), screenshot: shot });
      const links = await p.locator('a, [role="button"], li').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean));
      const side = links.join(' | ');
      for (const it of ex.items) S.add({ id: `UI-${a.role}-has-${it}`, title: `${a.role} sidebar shows "${it}"`, type: 'positive', ref: '§6.2 sidebar per role', expected: it, actual: side.slice(0, 200), ok: links.some((t) => new RegExp(`^${it}$`, 'i').test(t) || new RegExp(`\\b${it}\\b`, 'i').test(t)) });
      for (const it of ex.notItems) S.add({ id: `UI-${a.role}-no-${it}`, title: `${a.role} sidebar hides "${it}"`, type: 'negative', ref: '§6.2 sidebar per role', expected: 'hidden', actual: links.some((t) => new RegExp(`^${it}$`, 'i').test(t)) ? 'shown' : 'hidden', ok: !links.some((t) => new RegExp(`^${it}$`, 'i').test(t)) });
      // unauthorized screen for a foreign route
      const foreign = a.role === 'Admin' ? '/workBoard/workOrders' : '/admin/review/engineers';
      await p.goto(foreign); await p.waitForTimeout(3000); const t = await bodyText(p); const s2 = await S.shot(p, `${a.role.replace(/\s+/g, '')}-foreign-route`);
      S.add({ id: `UI-${a.role}-foreign`, title: `${a.role} opening ${foreign} gets Unauthorized / redirected`, type: 'negative', ref: 'Unmatched protected URL → /unauthorized; catch-all Unauthorized', expected: 'Unauthorized text or redirect away', actual: `${p.url()} text=${t.slice(0, 60)}`, ok: /Unauthorized/i.test(t) || !p.url().includes(foreign), screenshot: s2, note: p.url().includes(foreign) && !/Unauthorized/i.test(t) ? 'FOREIGN ROUTE RENDERED — check what data is visible' : '' });
      await c.close();
    });
  }

  for (const s of Object.values(sessions)) await s.ctx.dispose();
  S.save();
});
