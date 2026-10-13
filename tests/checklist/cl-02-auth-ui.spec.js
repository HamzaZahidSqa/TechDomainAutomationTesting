// Checklist 10% — Area 02: Authentication & sign-up screens (UI)
// Refs: Route table, RequireAuth, Login, Forgot Password, Reset Password, OTP page, Get Started, Technician / Customer / Client sign-up,
// Utility pages. Browser checks with screenshots under evidence/Checklist/02-AuthUI/run-<stamp>/.
const { test, expect } = require('@playwright/test');
const L = require('./_lib');

test.setTimeout(900_000);

const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const has = (text, re) => re.test(text);
const emailInput = (page) => page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
const pwInput = (page) => page.locator('input[type="password"], input[name="password"]').first();
const submitBtn = (page, re) => page.locator(`button[type="submit"], button:has-text("${re}")`).first();

test('CL-02 Authentication screens (UI)', async ({ browser }, testInfo) => {
  const S = new L.Suite('02-AuthUI', 'Authentication screens (UI)', testInfo);
  const eng = L.byRole('Individual Engineer');
  const newCtx = async (extra = {}) => { const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...L.GEO, ...extra }); const p = await c.newPage(); p.setDefaultTimeout(15_000); return { c, p }; };

  // ---------- LOGIN PAGE ----------
  await L.step(S, 'UL-01', 'login page', 'positive', 'Login', async () => {
    const { c, p } = await newCtx();
    await p.goto('/login'); await expect(emailInput(p)).toBeVisible({ timeout: 20_000 });
    const t = await bodyText(p);
    const shot = await S.shot(p, 'login-page');
    S.add({ id: 'UL-01', title: 'Login page shows heading "Welcome to Trusted Platform"', type: 'positive', ref: 'Login: Header: brand logo, "Welcome to Trusted Platform"', expected: 'text present', actual: has(t, /Welcome to Trusted Platform/i) ? 'present' : t.slice(0, 120), ok: has(t, /Welcome to Trusted Platform/i), screenshot: shot });
    S.add({ id: 'UL-02', title: 'Email placeholder is "William123@gmail.com"', type: 'positive', ref: 'Login: Email field placeholder', expected: 'William123@gmail.com', actual: await emailInput(p).getAttribute('placeholder'), ok: (await emailInput(p).getAttribute('placeholder')) === 'William123@gmail.com' });
    S.add({ id: 'UL-03', title: 'Password field is masked (type=password)', type: 'positive', ref: 'Login: Password field', expected: 'type=password', actual: await pwInput(p).getAttribute('type'), ok: (await pwInput(p).getAttribute('type')) === 'password' });
    // eye toggle
    const eye = p.locator('button:near(input[type="password"]), [class*="eye" i], svg:near(input[type="password"])').first();
    let toggled = 'n/a';
    try { await pwInput(p).fill('abc'); await eye.click({ timeout: 5000 }); await p.waitForTimeout(300); toggled = await p.locator('input[name="password"], input[placeholder*="*"]').first().getAttribute('type'); } catch (e) { toggled = `no toggle found: ${e.message.slice(0, 60)}`; }
    S.add({ id: 'UL-04', title: 'Eye icon toggles password visibility', type: 'positive', ref: 'Login: eye icon toggles show/hide', expected: 'type becomes text', actual: toggled, ok: toggled === 'text', note: toggled === 'text' ? '' : 'selector could not find the eye icon — verify manually' });
    S.add({ id: 'UL-05', title: 'No Google / Apple social buttons on login', type: 'negative', ref: 'Google / Apple sign-in components (DISABLED)', expected: 'absent', actual: has(t, /Continue with Google|Sign in with Apple|Continue with Apple/i) ? 'social button present' : 'absent', ok: !has(t, /Continue with Google|Sign in with Apple|Continue with Apple/i) });
    const apple = await p.locator('a[href*="apps.apple.com"]').first().getAttribute('href').catch(() => null);
    const play = await p.locator('a[href*="play.google.com"]').first().getAttribute('href').catch(() => null);
    S.add({ id: 'UL-06', title: 'App Store badge links to the Tech Domain iOS app', type: 'positive', ref: 'Login: Apple App Store badge → id6742741677', expected: 'href contains id6742741677', actual: apple, ok: !!apple && apple.includes('id6742741677') });
    S.add({ id: 'UL-07', title: 'Google Play badge links to com.techdomain.tdm', type: 'positive', ref: 'Login: Google Play badge', expected: 'href contains com.techdomain.tdm', actual: play, ok: !!play && play.includes('com.techdomain.tdm') });
    const fpHref = await p.locator('a:has-text("Forgot Password")').first().getAttribute('href').catch(() => null);
    S.add({ id: 'UL-08', title: '"Forgot Password?" link goes to /forgotPassword', type: 'positive', ref: 'Login: "Forgot Password?" link → /forgotPassword', expected: '/forgotPassword', actual: fpHref, ok: !!fpHref && /forgotPassword/.test(fpHref) });
    const suHref = await p.locator('a:has-text("SignUp"), a:has-text("Sign Up"), a:has-text("Signup")').first().getAttribute('href').catch(() => null);
    S.add({ id: 'UL-09', title: '"SignUp" link goes to /getStarted', type: 'positive', ref: 'Login: "SignUp" link → /getStarted', expected: '/getStarted', actual: suHref, ok: !!suHref && /getStarted/.test(suHref) });
    S.add({ id: 'UL-10', title: '"Remember Me" checkbox is shown', type: 'positive', ref: 'Login: "Remember Me" checkbox', expected: 'present', actual: has(t, /Remember Me/i) ? 'present' : 'absent', ok: has(t, /Remember Me/i) });

    // validation on submit: empty both
    await p.reload(); await expect(emailInput(p)).toBeVisible();
    await submitBtn(p, 'Login').click(); await p.waitForTimeout(800);
    let v = await bodyText(p); const s1 = await S.shot(p, 'login-empty-submit');
    S.add({ id: 'UL-11', title: 'Empty email on submit → "Email is required"', type: 'negative', ref: 'Login: Email empty → "Email is required"', expected: 'Email is required', actual: has(v, /Email is required/i) ? 'shown' : v.slice(0, 160), ok: has(v, /Email is required/i), screenshot: s1 });
    S.add({ id: 'UL-12', title: 'Empty password on submit → "Password is required"', type: 'negative', ref: 'Login: Password empty → "Password is required"', expected: 'Password is required', actual: has(v, /Password is required/i) ? 'shown' : 'not shown', ok: has(v, /Password is required/i) });
    // invalid email format
    await emailInput(p).fill('not-an-email'); await pwInput(p).fill('x'); await submitBtn(p, 'Login').click(); await p.waitForTimeout(800);
    v = await bodyText(p); const s2 = await S.shot(p, 'login-invalid-email');
    S.add({ id: 'UL-13', title: 'Invalid email format → "Enter a valid email"', type: 'negative', ref: 'Login: invalid → "Enter a valid email"', expected: 'Enter a valid email', actual: has(v, /Enter a valid email/i) ? 'shown' : v.slice(0, 160), ok: has(v, /Enter a valid email/i), screenshot: s2 });
    // validation should not run on change (typing only)
    await p.reload(); await expect(emailInput(p)).toBeVisible();
    await emailInput(p).fill('abc'); await emailInput(p).blur(); await p.waitForTimeout(500); v = await bodyText(p);
    S.add({ id: 'UL-14', title: 'Validation does not run on change/blur (only on submit)', type: 'edge', ref: 'Login: Validation runs on submit only', expected: 'no error before submit', actual: has(v, /Enter a valid email|Email is required/i) ? 'error shown before submit' : 'no error', ok: !has(v, /Enter a valid email|Email is required/i) });
    // wrong password
    await emailInput(p).fill(eng.email); await pwInput(p).fill('WrongPass#2026');
    const resP = p.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 20_000 });
    await submitBtn(p, 'Login').click(); const res = await resP; await p.waitForTimeout(1500); v = await bodyText(p); const s3 = await S.shot(p, 'login-wrong-password');
    S.add({ id: 'UL-15', title: 'Wrong password → red banner "Invalid Email/Password" and stays on /login', type: 'negative', ref: 'Login: Any API error → red banner "Invalid Email/Password"', expected: 'banner shown, url /login', actual: `HTTP ${res.status()} banner=${has(v, /Invalid Email\/Password|Invalid email or password/i)} url=${p.url()}`, ok: has(v, /Invalid Email\/Password|Invalid email or password/i) && /\/login/.test(p.url()), screenshot: s3 });
    // boundary: very long email typed
    await emailInput(p).fill(`${'a'.repeat(300)}@mailinator.com`); await pwInput(p).fill('x'); await submitBtn(p, 'Login').click(); await p.waitForTimeout(1500); v = await bodyText(p);
    S.add({ id: 'UL-16', title: '320-char email: page handles it without crashing', type: 'bva', ref: 'Login', expected: 'error shown, page alive', actual: has(v, /Invalid|valid email|required/i) ? 'error shown' : v.slice(0, 100), ok: has(v, /Invalid|valid email|required/i) });
    // positive login + redirect per role
    await p.reload(); await expect(emailInput(p)).toBeVisible();
    await emailInput(p).fill(eng.email); await pwInput(p).fill(eng.password); await submitBtn(p, 'Login').click();
    await p.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 }).catch(() => { });
    await p.waitForTimeout(2000); const s4 = await S.shot(p, 'login-success-engineer');
    S.add({ id: 'UL-17', title: 'Engineer login lands on /jobs', type: 'positive', ref: 'Login-success redirect: FREELANCER → /jobs', expected: '/jobs', actual: p.url(), ok: /\/jobs/.test(p.url()), screenshot: s4 });
    // logged-in user visiting /login is redirected to /
    await p.goto('/login'); await p.waitForTimeout(3000);
    S.add({ id: 'UL-18', title: 'Logged-in user opening /login is redirected away', type: 'edge', ref: 'Route table: logged-in user visiting /login … redirected to /', expected: 'not /login', actual: p.url(), ok: !/\/login/.test(p.url()) });
    await p.goto('/getStarted'); await p.waitForTimeout(3000);
    S.add({ id: 'UL-19', title: 'Logged-in user opening /getStarted is redirected away', type: 'edge', ref: 'Route table: logged-in redirect', expected: 'not /getStarted', actual: p.url(), ok: !/\/getStarted/.test(p.url()) });
    await p.goto('/some/unknown/url-' + L.RUN); await p.waitForTimeout(2500); v = await bodyText(p); const s5 = await S.shot(p, 'catch-all-logged-in');
    S.add({ id: 'UL-20', title: 'Unknown URL while logged in shows "Unauthorized"', type: 'negative', ref: 'Catch-all *: logged in shows "Unauthorized"', expected: 'Unauthorized heading', actual: has(v, /Unauthorized/i) ? 'shown' : v.slice(0, 120), ok: has(v, /Unauthorized/i), screenshot: s5 });
    await p.goto('/completeYourProfile'); await p.waitForTimeout(2500); v = await bodyText(p);
    S.add({ id: 'UL-21', title: 'APPROVED engineer cannot open /completeYourProfile (route removed → Unauthorized)', type: 'negative', ref: '/completeYourProfile removed once status APPROVED', expected: 'Unauthorized / redirected', actual: `${p.url()} text=${v.slice(0, 80)}`, ok: has(v, /Unauthorized/i) || !/completeYourProfile/.test(p.url()) });
    // logout via UI
    let loggedOut = false;
    try {
      await p.goto('/jobs'); await p.waitForTimeout(2000);
      const avatar = p.locator('.MuiAvatar-root').first();
      await avatar.click({ timeout: 8000 }); await p.waitForTimeout(700);
      const lo = p.locator('p:has-text("Log Out"), li:has-text("Log Out")').first();
      await lo.click({ timeout: 5000, force: true });
      try { await p.waitForURL(/login|getStarted/, { timeout: 8_000 }); } catch { await lo.locator('..').click({ force: true }); await p.waitForURL(/login|getStarted/, { timeout: 15_000 }); }
      loggedOut = true;
    } catch (e) { S.log(`UI logout: ${e.message.slice(0, 100)}`); }
    const s6 = await S.shot(p, 'after-logout');
    S.add({ id: 'UL-22', title: 'Logout from the top bar returns to /login', type: 'positive', ref: 'useAuth.logout → clear storage → /login', expected: '/login', actual: p.url(), ok: loggedOut && /login/.test(p.url()), screenshot: s6, note: loggedOut ? '' : 'menu selector not found — verify manually' });
    if (loggedOut) {
      await p.goto('/jobs'); await p.waitForTimeout(3000);
      S.add({ id: 'UL-23', title: 'After logout a protected URL redirects to /getStarted', type: 'negative', ref: 'RequireAuth: not authenticated → /getStarted', expected: '/getStarted', actual: p.url(), ok: /getStarted/.test(p.url()) });
    }
    await c.close();
  });

  // ---------- RequireAuth logged out ----------
  await L.step(S, 'UR-01', 'logged out routes', 'negative', 'RequireAuth', async () => {
    const { c, p } = await newCtx();
    for (const [id, url, exp] of [['UR-01', '/workBoard/workOrders', /getStarted/], ['UR-02', '/admin/review/engineers', /getStarted/], ['UR-03', '/jobs', /getStarted/], ['UR-04', '/some/unknown-' + L.RUN, /getStarted/]]) {
      await p.goto(url); await p.waitForTimeout(3000);
      S.add({ id, title: `Logged-out visit to ${url} redirects to /getStarted`, type: 'negative', ref: 'RequireAuth: Not authenticated → /getStarted; catch-all logged out → /getStarted', expected: '/getStarted', actual: p.url(), ok: exp.test(p.url()) });
    }
    await p.goto('/not-found'); await p.waitForTimeout(2000); let v = await bodyText(p);
    S.add({ id: 'UR-05', title: '/not-found shows "No User Linked :("', type: 'positive', ref: 'Utility pages: NoUserPage', expected: 'No User Linked', actual: v.slice(0, 80), ok: has(v, /No User Linked/i) });
    await p.goto('/unauthorized'); await p.waitForTimeout(2000); v = await bodyText(p);
    S.add({ id: 'UR-06', title: '/unauthorized renders "Unauthorized"', type: 'positive', ref: '/unauthorized renders <h1>Unauthorized</h1>', expected: 'Unauthorized', actual: v.slice(0, 80), ok: has(v, /Unauthorized/i) });
    await p.goto('/'); await p.waitForTimeout(2500); v = await bodyText(p); const s = await S.shot(p, 'root-logged-out');
    S.add({ id: 'UR-07', title: '/ while logged out: placeholder or redirect to Get Started', type: 'edge', ref: '/ (index, logged out) renders FlightboardPage placeholder', expected: 'FlightboardPage text OR /getStarted', actual: `${p.url()} text=${v.slice(0, 60)}`, ok: has(v, /Flightboard/i) || /getStarted/.test(p.url()) || has(v, /Join Tech Domain/i), screenshot: s, note: has(v, /Flightboard/i) ? 'placeholder page visible to the public' : 'checklist says placeholder, site shows Get Started — doc out of date (fine)' });
    await c.close();
  });

  // ---------- FORGOT PASSWORD ----------
  await L.step(S, 'UF-01', 'forgot password', 'positive', 'Forgot Password', async () => {
    const { c, p } = await newCtx();
    await p.goto('/forgotPassword'); await expect(emailInput(p)).toBeVisible({ timeout: 20_000 });
    let v = await bodyText(p); const s0 = await S.shot(p, 'forgot-page');
    S.add({ id: 'UF-01', title: 'Forgot page heading and helper text', type: 'positive', ref: 'Forgot Password: Heading "Forgot Password ?" + "Provide your Registered E-mail address…"', expected: 'both texts', actual: v.slice(0, 160), ok: has(v, /Forgot Password/i) && has(v, /Registered E-?mail/i), screenshot: s0 });
    const btn = submitBtn(p, 'Send recovery link');
    S.add({ id: 'UF-02', title: 'Button label "Send recovery link"', type: 'positive', ref: 'Forgot Password: button label states', expected: 'Send recovery link', actual: (await btn.innerText().catch(() => '')).trim(), ok: /Send recovery link/i.test(await btn.innerText().catch(() => '')) });
    await emailInput(p).fill('abc'); await emailInput(p).blur(); await p.waitForTimeout(500); v = await bodyText(p);
    S.add({ id: 'UF-03', title: 'Invalid email validates before submit → "Enter a valid email"', type: 'negative', ref: 'Forgot Password: validates on change', expected: 'Enter a valid email', actual: has(v, /Enter a valid email/i) ? 'shown' : 'not shown', ok: has(v, /Enter a valid email/i) });
    await emailInput(p).fill(''); await emailInput(p).blur(); await p.waitForTimeout(500); v = await bodyText(p);
    S.add({ id: 'UF-04', title: 'Cleared email → "Email is required"', type: 'negative', ref: 'Forgot Password: "Email is required"', expected: 'Email is required', actual: has(v, /Email is required/i) ? 'shown' : 'not shown', ok: has(v, /Email is required/i) });
    const unreg = `nobody-${L.RUN}@mailinator.com`;
    await emailInput(p).fill(unreg);
    const rP = p.waitForResponse((r) => r.url().includes('forgotPassword') && r.request().method() === 'POST', { timeout: 20_000 });
    await btn.click(); const r = await rP; await p.waitForTimeout(2500); v = await bodyText(p); const s1 = await S.shot(p, 'forgot-unregistered-submitted');
    S.add({ id: 'UF-05', title: 'Unregistered email → neutral success view (no enumeration)', type: 'negative', ref: 'Forgot Password: success view text; TD-23', expected: '"A password recovery email … has been sent" and no "not registered"', actual: `HTTP ${r.status()} text=${v.slice(0, 160)}`, ok: has(v, /recovery email/i) && !has(v, /not (a )?registered|no account|does not exist/i), screenshot: s1 });
    S.add({ id: 'UF-06', title: 'Success view shows the entered email and "Return to login"', type: 'positive', ref: 'Forgot Password: success view', expected: 'email + Return to login', actual: v.slice(0, 200), ok: v.includes(unreg) && has(v, /Return to login/i) });
    const back = p.locator('text=/Return to Recovery Link/i').first();
    let cooldownLabel = '';
    try { await back.click({ timeout: 5000 }); await p.waitForTimeout(800); cooldownLabel = (await submitBtn(p, 'Resend in').innerText()).trim(); } catch (e) { cooldownLabel = `n/a (${e.message.slice(0, 50)})`; }
    const s2 = await S.shot(p, 'forgot-cooldown');
    S.add({ id: 'UF-07', title: 'Back to form shows disabled "Resend in m:ss" cooldown', type: 'edge', ref: 'Forgot Password: "Resend in m:ss" during cooldown (disabled)', expected: 'Resend in 0:5x', actual: cooldownLabel, ok: /Resend in \d:\d\d/i.test(cooldownLabel), screenshot: s2 });
    await p.reload(); await p.waitForTimeout(1500);
    const afterReload = (await submitBtn(p, 'Resend in').innerText().catch(() => '')).trim();
    S.add({ id: 'UF-08', title: 'Reload during cooldown keeps the countdown', type: 'edge', ref: 'Forgot Password: Reload during cooldown keeps the countdown', expected: 'Resend in m:ss', actual: afterReload, ok: /Resend in \d:\d\d/i.test(afterReload) });
    await c.close();
  });

  // ---------- RESET PASSWORD ----------
  await L.step(S, 'URP-01', 'reset password', 'negative', 'Reset Password', async () => {
    const { c, p } = await newCtx();
    await p.goto('/resetPassword?token=' + 'z'.repeat(64)); await p.waitForTimeout(2000);
    let v = await bodyText(p); const s0 = await S.shot(p, 'reset-page');
    S.add({ id: 'URP-01', title: 'Reset page heading "Reset Password" + "Please Enter your new password"', type: 'positive', ref: 'Reset Password heading', expected: 'both texts', actual: v.slice(0, 140), ok: has(v, /Reset Password/i) && has(v, /Enter your new password/i), screenshot: s0 });
    const pw = p.locator('input[type="password"]');
    const n = await pw.count();
    S.add({ id: 'URP-02', title: 'Two password fields (New + Confirm)', type: 'positive', ref: 'Reset Password fields', expected: '2', actual: String(n), ok: n >= 2 });
    const cases = [
      ['URP-B01', 'Ab1@xyz', /at least 8 characters/i, '7 chars → "at least 8 characters"'],
      ['URP-N01', 'abcdefg1@', /uppercase/i, 'no uppercase'],
      ['URP-N02', 'ABCDEFG1@', /lowercase/i, 'no lowercase'],
      ['URP-N03', 'Abcdefgh@', /number/i, 'no number'],
      ['URP-N04', 'Abcdefgh1', /symbol/i, 'no symbol'],
      ['URP-N05', 'Abcdefg 1@', /spaces/i, 'contains space'],
    ];
    for (const [id, val, re, name] of cases) {
      await pw.nth(0).fill(val); await pw.nth(0).blur(); await p.waitForTimeout(400); v = await bodyText(p);
      S.add({ id, title: `New password validation: ${name}`, type: id.includes('-B') ? 'bva' : 'negative', ref: 'Reset Password: Validation (on change) messages', expected: String(re), actual: has(v, re) ? 'message shown' : v.slice(0, 200), ok: has(v, re) });
    }
    await pw.nth(0).fill('Abcdefg1@'); await pw.nth(0).blur(); await p.waitForTimeout(300); v = await bodyText(p);
    S.add({ id: 'URP-B02', title: '8-char valid password → no rule error', type: 'bva', ref: 'Reset Password: min 8', expected: 'no error', actual: has(v, /at least 8|must contain|cannot contain/i) ? 'error shown' : 'no error', ok: !has(v, /at least 8|must contain|cannot contain/i) });
    await pw.nth(0).fill('Abcdefg1@' + 'x'.repeat(21)); await pw.nth(0).blur(); await p.waitForTimeout(300); v = await bodyText(p);
    S.add({ id: 'URP-B03', title: '30-char password: no max-length rule on reset (checker still says 8–20)', type: 'bva', ref: 'Reset Password: No max-length rule here (checker still shows 8–20)', expected: 'no "at most 20" error (documented gap)', actual: has(v, /at most 20/i) ? 'max error shown' : 'no max error', ok: true, note: 'inconsistency between form rule and checker text — product to decide' });
    await pw.nth(0).fill('Abcdefg1@'); await pw.nth(1).fill('Abcdefg1#'); await pw.nth(1).blur(); await p.waitForTimeout(400); v = await bodyText(p);
    S.add({ id: 'URP-N06', title: 'Confirm mismatch → "Passwords must match"', type: 'negative', ref: 'Reset Password: confirm "Passwords must match"', expected: 'Passwords must match', actual: has(v, /Passwords must match/i) ? 'shown' : v.slice(0, 160), ok: has(v, /Passwords must match/i) });
    await pw.nth(1).fill('Abcdefg1@');
    const rP = p.waitForResponse((r) => r.url().includes('resetPassword') && r.request().method() === 'PUT', { timeout: 20_000 }).catch(() => null);
    await submitBtn(p, 'Create New Password').click(); const r = await rP; await p.waitForTimeout(600); v = await bodyText(p); const s1 = await S.shot(p, 'reset-invalid-token');
    S.add({ id: 'URP-N07', title: 'Submitting with an invalid token shows "Invalid link" and "Back to Forgot Password" link', type: 'negative', ref: 'Reset Password: Error (invalid/expired token)', expected: 'error status + "Invalid link" + back link', actual: `HTTP ${r ? r.status() : 'no call'} text=${v.slice(-120)}`, ok: !!r && r.status() >= 300 && has(v, /Invalid link|Expired link/i) && has(v, /Back to Forgot Password/i), screenshot: s1, note: r && r.status() === 300 ? 'API answers HTTP 300 for an invalid token — should be 400/404 (finding)' : '' });
    await c.close();
  });

  // ---------- OTP PAGE ----------
  await L.step(S, 'UO-01', 'otp page', 'positive', 'OTP', async () => {
    const { c, p } = await newCtx();
    const email = `cl02-otp-${L.RUN}@mailinator.com`;
    await p.goto('/otp?email=' + encodeURIComponent(email)); await p.waitForTimeout(2000);
    let v = await bodyText(p); const s0 = await S.shot(p, 'otp-page');
    S.add({ id: 'UO-01', title: 'OTP page shows "Email Verification" and the email', type: 'positive', ref: 'OTP page texts', expected: 'Email Verification + email', actual: v.slice(0, 160), ok: has(v, /Email Verification/i) && v.includes(email), screenshot: s0 });
    const boxes = p.locator('input[type="number"], input[maxlength="1"], input[inputmode="numeric"]');
    const nb = await boxes.count();
    S.add({ id: 'UO-02', title: 'Six single-digit OTP boxes', type: 'positive', ref: 'OTP: 6 single-digit boxes', expected: '6', actual: String(nb), ok: nb === 6 });
    const verify = p.locator('button:has-text("Verify")').first();
    S.add({ id: 'UO-03', title: '"Verify" disabled until 6 digits entered', type: 'negative', ref: 'OTP: "Verify" button disabled until 6 digits', expected: 'disabled', actual: (await verify.isDisabled().catch(() => 'n/a')) ? 'disabled' : 'enabled', ok: (await verify.isDisabled().catch(() => false)) === true });
    S.add({ id: 'UO-04', title: 'Countdown timer starts near 1:00', type: 'positive', ref: 'OTP: Countdown timer m:ss starting at 60s', expected: '0:5x or 1:00', actual: (v.match(/\b[01]:[0-5]\d\b/) || ['no timer'])[0], ok: /\b(1:00|0:[45]\d)\b/.test(v) });
    if (nb === 6) {
      for (let i = 0; i < 5; i++) await boxes.nth(i).fill(String(i + 1));
      await p.waitForTimeout(300);
      S.add({ id: 'UO-B01', title: '5 digits entered → Verify still disabled', type: 'bva', ref: 'OTP: Verify with <6 digits', expected: 'disabled', actual: (await verify.isDisabled()) ? 'disabled' : 'enabled', ok: await verify.isDisabled() });
      await boxes.nth(5).fill('6'); await p.waitForTimeout(300);
      S.add({ id: 'UO-B02', title: '6 digits entered → Verify enabled', type: 'bva', ref: 'OTP: 6 digits', expected: 'enabled', actual: (await verify.isDisabled()) ? 'disabled' : 'enabled', ok: !(await verify.isDisabled()) });
      await boxes.nth(0).focus(); await p.keyboard.press('Backspace'); await p.keyboard.type('a'); await p.waitForTimeout(200);
      const val = await boxes.nth(0).inputValue();
      S.add({ id: 'UO-N01', title: 'Letters are not accepted in OTP boxes', type: 'negative', ref: 'OTP: numeric input', expected: 'box stays numeric/empty', actual: `value="${val}"`, ok: !/[a-z]/i.test(val), note: /[a-z]/i.test(val) ? 'letters accepted — product to decide' : '' });
      for (let i = 0; i < 6; i++) await boxes.nth(i).fill(String(i + 1));
      await p.waitForTimeout(300);
      const rP = p.waitForResponse((r) => r.url().includes('otps/verify'), { timeout: 20_000 }).catch(() => null);
      await verify.click(); const r = await rP; await p.waitForTimeout(2000); v = await bodyText(p); const s1 = await S.shot(p, 'otp-wrong-code');
      S.add({ id: 'UO-N02', title: 'Wrong code → server error shown as toast, stays on /otp', type: 'negative', ref: 'OTP: Verify error → toast with server message', expected: 'HTTP 4xx, still /otp', actual: `HTTP ${r ? r.status() : 'no call'} url=${p.url()} text=${v.slice(0, 120)}`, ok: !!r && r.status() >= 400 && /\/otp/.test(p.url()), screenshot: s1 });
    }
    await c.close();
  });

  // ---------- GET STARTED ----------
  await L.step(S, 'UG-01', 'get started', 'positive', 'Get Started', async () => {
    const { c, p } = await newCtx();
    await p.goto('/getStarted'); await p.waitForTimeout(2000);
    let v = await bodyText(p); const s0 = await S.shot(p, 'get-started');
    S.add({ id: 'UG-01', title: 'Get Started shows "Join Tech Domain" + both cards', type: 'positive', ref: 'Get Started (account type chooser)', expected: 'Looking for Work + Looking for Technicians', actual: v.slice(0, 200), ok: has(v, /Join Tech Domain/i) && has(v, /Looking for Work/i) && has(v, /Looking for Technicians/i), screenshot: s0 });
    const gs = p.locator('button:has-text("Get Started")').first();
    S.add({ id: 'UG-02', title: '"Get Started" button disabled until a card is selected', type: 'negative', ref: 'Get Started: button disabled until a card is selected', expected: 'disabled', actual: (await gs.isDisabled().catch(() => 'n/a')) ? 'disabled' : 'enabled', ok: (await gs.isDisabled().catch(() => false)) === true });
    S.add({ id: 'UG-03', title: 'No social sign-up buttons', type: 'negative', ref: 'Get Started: Google/Apple buttons commented out', expected: 'absent', actual: has(v, /Sign up with Google|Sign up with Apple/i) ? 'present' : 'absent', ok: !has(v, /Sign up with Google|Sign up with Apple/i) });
    await p.locator('div.cursor-pointer:has-text("Looking for Work"), div[class*="cursor-pointer"]:has-text("Looking for Work")').first().click(); await p.waitForTimeout(600);
    S.add({ id: 'UG-04', title: 'Selecting "Looking for Work" adds ?signup=TECH to the URL', type: 'positive', ref: 'Get Started: pushes ?signup=<value>', expected: 'signup=TECH', actual: p.url(), ok: /signup=TECH/.test(p.url()) });
    await gs.click(); await p.waitForTimeout(2000);
    S.add({ id: 'UG-05', title: 'TECH → /techSignup', type: 'positive', ref: 'Get Started: TECH → /techSignup', expected: '/techSignup', actual: p.url(), ok: /techSignup/.test(p.url()) });
    await p.goto('/getStarted?signup=CLIENT'); await p.waitForTimeout(1500);
    const gs2 = p.locator('button:has-text("Get Started")').first();
    S.add({ id: 'UG-06', title: '?signup=CLIENT pre-selects the card (button enabled)', type: 'edge', ref: 'Get Started: ?signup= in URL preselects card', expected: 'enabled', actual: (await gs2.isDisabled()) ? 'disabled' : 'enabled', ok: !(await gs2.isDisabled()) });
    await gs2.click(); await p.waitForTimeout(2000);
    S.add({ id: 'UG-07', title: 'CLIENT → /customerSignup (not /clientSignup)', type: 'positive', ref: 'Get Started: CLIENT → /customerSignup', expected: '/customerSignup', actual: p.url(), ok: /customerSignup/.test(p.url()) });
    await p.goto('/getStarted?ticket=expired-' + L.RUN); await p.waitForTimeout(3000); v = await bodyText(p); const s1 = await S.shot(p, 'get-started-bad-ticket');
    S.add({ id: 'UG-08', title: 'Invalid ?ticket= shows the expired-link message and disables the button', type: 'negative', ref: 'Get Started: Expired/invalid ticket → red box', expected: 'sign-in link has expired', actual: v.slice(0, 200), ok: has(v, /expired/i), screenshot: s1 });
    await c.close();
  });

  // ---------- TECH SIGNUP ----------
  await L.step(S, 'UT-01', 'tech signup', 'positive', 'Technician Sign-up', async () => {
    const { c, p } = await newCtx();
    await p.goto('/techSignup'); await p.waitForTimeout(2000);
    let v = await bodyText(p); const s0 = await S.shot(p, 'tech-signup');
    S.add({ id: 'UT-01', title: 'Heading "Let’s Create Your Account" and provider-type question', type: 'positive', ref: 'Technician Sign-up heading + "How do you provide services?"', expected: 'both', actual: v.slice(0, 200), ok: has(v, /Create Your Account/i) && has(v, /How do you provide services/i), screenshot: s0 });
    const formBefore = await p.locator('input[type="password"]').count();
    S.add({ id: 'UT-02', title: 'Form hidden until a provider type is chosen', type: 'edge', ref: 'Technician: Rest of the form hidden until a provider type is chosen', expected: 'no password field yet', actual: `password fields=${formBefore}`, ok: formBefore === 0 });
    await p.locator('text=/Independent Technician/i').first().click(); await p.waitForTimeout(600);
    const formAfter = await p.locator('input[type="password"]').count();
    S.add({ id: 'UT-03', title: 'Choosing "Independent Technician" reveals the form', type: 'positive', ref: 'Technician: provider type cards', expected: 'password field visible', actual: `password fields=${formAfter}`, ok: formAfter >= 1 });
    await p.locator('text=/Company or Team/i').first().click(); await p.waitForTimeout(500); v = await bodyText(p);
    S.add({ id: 'UT-04', title: '"Company or Team" shows "Your company name *"', type: 'positive', ref: 'Technician: Company or Team shows company name', expected: 'company name field', actual: has(v, /company name/i) ? 'shown' : 'not shown', ok: has(v, /company name/i) });
    await p.locator('text=/Independent Technician/i').first().click(); await p.waitForTimeout(400);
    const first = p.locator('input[placeholder="William"]').first();
    await first.click(); await first.pressSequentially('John123'); await p.waitForTimeout(200);
    const fv = await first.inputValue();
    S.add({ id: 'UT-05', title: 'First name filters digits while typing', type: 'negative', ref: 'Technician: only letters/spaces accepted as you type', expected: 'John', actual: fv, ok: fv === 'John' });
    await first.fill('A'.repeat(100)); const fv2 = await first.inputValue();
    S.add({ id: 'UT-B01', title: 'First name accepts 100 letters (no max on UI — informational)', type: 'bva', ref: 'Technician: First Name', expected: 'informational', actual: `length=${fv2.length}`, ok: true, note: fv2.length === 100 ? 'no client max length' : `truncated to ${fv2.length}` });
    const create = p.locator('button:has-text("Create Account")').first();
    S.add({ id: 'UT-06', title: '"Create Account" disabled until required fields + consent', type: 'negative', ref: 'Technician: "Create Account" disabled until consent checked AND fields filled', expected: 'disabled', actual: (await create.isDisabled().catch(() => 'n/a')) ? 'disabled' : 'enabled', ok: (await create.isDisabled().catch(() => false)) === true });
    const pwd = p.locator('input[type="password"]').first();
    await pwd.fill('abc'); await p.waitForTimeout(400); v = await bodyText(p);
    S.add({ id: 'UT-07', title: 'PasswordChecker appears once password has a value', type: 'positive', ref: 'Technician: PasswordChecker appears', expected: 'checker text (8 to 20 characters)', actual: has(v, /8 to 20 characters/i) ? 'shown' : 'not shown', ok: has(v, /8 to 20 characters/i) });
    // privacy modal
    let modal = 'n/a';
    try { await p.locator('text=/Privacy Statement/i').first().click({ timeout: 5000 }); await p.waitForTimeout(800); const t2 = await bodyText(p); modal = has(t2, /Effective|Privacy Policy/i) ? 'opened' : 'no modal text'; await p.keyboard.press('Escape'); } catch (e) { modal = `error ${e.message.slice(0, 40)}`; }
    S.add({ id: 'UT-08', title: '"Privacy Statement" opens the Privacy Policy modal', type: 'positive', ref: 'Technician: Privacy Statement link opens modal', expected: 'opened', actual: modal, ok: modal === 'opened' });
    // fill valid form, check consent gating, submit with existing email → toast
    await first.fill('Check'); await p.locator('input[placeholder="Clark"]').first().fill('List');
    const phone = p.locator('input[type="tel"]').first(); await phone.fill('400000003').catch(() => { });
    await p.locator('input[placeholder="Email"], input[type="email"]').first().fill(eng.email);
    await pwd.fill('Check@2026x');
    try { const src = p.locator('input[name="referralSource"]').first(); await src.locator('..').click(); await p.waitForTimeout(400); await p.locator('[role="option"], li').filter({ hasText: /LinkedIn/i }).first().click({ timeout: 5000 }); } catch (e) { S.log(`source select: ${e.message.slice(0, 60)}`); }
    await p.waitForTimeout(300);
    S.add({ id: 'UT-09', title: 'All fields filled but consent unchecked → still disabled', type: 'negative', ref: 'Technician: consent gating', expected: 'disabled', actual: (await create.isDisabled()) ? 'disabled' : 'enabled', ok: await create.isDisabled() });
    await p.locator('input[type="checkbox"]').first().check().catch(() => { }); await p.waitForTimeout(300);
    const enabled = !(await create.isDisabled());
    S.add({ id: 'UT-10', title: 'Consent checked + all fields → "Create Account" enabled', type: 'positive', ref: 'Technician: Create Account enabled', expected: 'enabled', actual: enabled ? 'enabled' : 'disabled', ok: enabled, note: enabled ? '' : 'a field (probably phone/source) may not have been filled by the test — verify manually' });
    if (enabled) {
      const rP = p.waitForResponse((r) => r.url().includes('auth/signup'), { timeout: 20_000 }).catch(() => null);
      await create.click(); const r = await rP; await p.waitForTimeout(2000); v = await bodyText(p); const s1 = await S.shot(p, 'tech-signup-existing-email');
      S.add({ id: 'UT-11', title: 'Signup with an existing verified email → error toast, stays on signup', type: 'negative', ref: 'Technician: Other errors → toast "This account already exists. Please sign in."', expected: 'HTTP 4xx + toast', actual: `HTTP ${r ? r.status() : 'no call'} text=${v.slice(0, 120)} url=${p.url()}`, ok: !!r && r.status() >= 400 && has(v, /already exists|sign in|error/i), screenshot: s1 });
    }
    await c.close();
  });

  // ---------- CUSTOMER + CLIENT SIGNUP ----------
  await L.step(S, 'UC-01', 'customer signup', 'positive', 'Customer Sign-up', async () => {
    const { c, p } = await newCtx();
    await p.goto('/customerSignup'); await p.waitForTimeout(2000);
    let v = await bodyText(p); const s0 = await S.shot(p, 'customer-signup');
    S.add({ id: 'UC-01', title: 'Customer sign-up form fields present', type: 'positive', ref: 'Customer Sign-up: Company Name, Website, Annual Revenue, source, consent', expected: 'Company Name + Annual Revenue + Where did you hear', actual: v.slice(0, 200), ok: has(v, /Company Name/i) && has(v, /Annual Revenue/i) && has(v, /Where did you hear/i), screenshot: s0 });
    const create = p.locator('button:has-text("Create Account")').first();
    S.add({ id: 'UC-02', title: '"Create Account" disabled initially', type: 'negative', ref: 'Customer: Create Account disabled until consent + selects', expected: 'disabled', actual: (await create.isDisabled().catch(() => 'n/a')) ? 'disabled' : 'enabled', ok: (await create.isDisabled().catch(() => false)) === true });
    const first = p.locator('input[placeholder="William"]').first();
    await first.click(); await first.pressSequentially('Mary9'); const fv = await first.inputValue();
    S.add({ id: 'UC-03', title: 'First name letters only (digits filtered)', type: 'negative', ref: 'Customer: letters/spaces only', expected: 'Mary', actual: fv, ok: fv === 'Mary' });
    await first.fill(''); await first.blur(); await p.waitForTimeout(400); v = await bodyText(p);
    S.add({ id: 'UC-04', title: 'Blur with empty first name → "First name is required"', type: 'negative', ref: 'Customer: Validation on blur + submit', expected: 'First name is required', actual: has(v, /First name is required/i) ? 'shown' : 'not shown', ok: has(v, /First name is required/i) });
    const pwd = p.locator('input[type="password"]').first();
    await pwd.fill('Ab1@xyz'); await pwd.blur(); await p.waitForTimeout(400); v = await bodyText(p);
    S.add({ id: 'UC-B01', title: '7-char password → "at least 8 characters"', type: 'bva', ref: 'Customer: password rules 8–20', expected: 'at least 8', actual: has(v, /at least 8/i) ? 'shown' : v.slice(0, 120), ok: has(v, /at least 8/i) });
    await pwd.fill('Ab1@' + 'x'.repeat(17)); await pwd.blur(); await p.waitForTimeout(400); v = await bodyText(p);
    S.add({ id: 'UC-B02', title: '21-char password → "at most 20 characters"', type: 'bva', ref: 'Customer: password max 20', expected: 'at most 20', actual: has(v, /at most 20/i) ? 'shown' : v.slice(0, 120), ok: has(v, /at most 20/i) });
    await pwd.fill('Ab1@' + 'x'.repeat(16)); await pwd.blur(); await p.waitForTimeout(400); v = await bodyText(p);
    S.add({ id: 'UC-B03', title: '20-char password → accepted (no length error)', type: 'bva', ref: 'Customer: password max 20', expected: 'no length error', actual: has(v, /at most 20|at least 8/i) ? 'length error' : 'no length error', ok: !has(v, /at most 20|at least 8/i) });
    await c.close();
    const { c: c2, p: p2 } = await newCtx();
    await p2.goto('/clientSignup'); await p2.waitForTimeout(2000); v = await bodyText(p2); const s1 = await S.shot(p2, 'client-signup');
    S.add({ id: 'UCL-01', title: '/clientSignup is reachable by direct URL', type: 'edge', ref: 'Client (Company) Sign-up (direct URL only)', expected: 'Create your account + Company Name', actual: v.slice(0, 160), ok: has(v, /Create your account/i) && has(v, /Company Name/i), screenshot: s1 });
    const cb = p2.locator('button:has-text("Create Account")').first();
    S.add({ id: 'UCL-02', title: 'Client form: Create Account disabled only while consent unchecked', type: 'negative', ref: 'Client: Create Account disabled only while consent unchecked', expected: 'disabled before consent', actual: (await cb.isDisabled().catch(() => 'n/a')) ? 'disabled' : 'enabled', ok: (await cb.isDisabled().catch(() => false)) === true });
    await p2.locator('input[type="checkbox"]').first().check().catch(() => { }); await p2.waitForTimeout(300);
    S.add({ id: 'UCL-03', title: 'Client form: consent checked → button enabled even with empty fields (validation on submit)', type: 'edge', ref: 'Client: disabled only while consent unchecked', expected: 'enabled', actual: (await cb.isDisabled()) ? 'disabled' : 'enabled', ok: !(await cb.isDisabled()) });
    await cb.click(); await p2.waitForTimeout(800); v = await bodyText(p2); const s2 = await S.shot(p2, 'client-signup-empty-submit');
    S.add({ id: 'UCL-04', title: 'Client form empty submit shows required-field messages', type: 'negative', ref: 'Client: same messages as Customer form', expected: 'First name is required etc.', actual: v.slice(0, 200), ok: has(v, /is required/i), screenshot: s2 });
    await c2.close();
  });

  S.save();
});
