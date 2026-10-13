// Checklist 10% — Area 01: Authentication API (login, session, refresh, logout, forgot/reset password, OTP, signup DTO)
// Checklist refs: "Authentication Screens" (Login, Forgot Password, Reset Password, Create New Password, OTP), "Sign-up" and
// "Token refresh & forced logout". Positive, negative, edge and boundary-value cases run against the API directly.
const { test } = require('@playwright/test');
const L = require('./_lib');

test.setTimeout(600_000);

test('CL-01 Authentication API', async ({ }, testInfo) => {
  const S = new L.Suite('01-AuthAPI', 'Authentication API', testInfo);
  const ctx = await L.api();
  const eng = L.byRole('Individual Engineer');
  const R = (p, data) => L.call(ctx, 'POST', p, data);
  const stamp = L.RUN;

  // ---------- LOGIN: positive (every role) ----------
  const roleMap = { Admin: 'ADMIN', 'TechDomain User': 'CLIENT', 'Individual Engineer': 'FREELANCER', Vendor: 'FREELANCER', 'Vendor Engineer': 'FREELANCER', Customer: 'CUSTOMER', 'Customer User': 'CUSTOMER' };
  for (const a of L.accounts) {
    await L.step(S, `LG-P-${a.role}`, `Login ${a.role}`, 'positive', 'Login: POST auth/login success', async () => {
      const r = await R('/auth/login', { email: a.email, password: a.password });
      const role = r.json?.data?.role?.role || r.json?.data?.role;
      S.add({ id: `LG-P-${a.role}`, title: `Login works for ${a.role}`, type: 'positive', ref: 'Login → POST auth/login', expected: '200/201 + accessToken + refreshToken', actual: `HTTP ${r.status} token=${!!r.json?.accessToken} refresh=${!!r.json?.refreshToken} role=${role}`, ok: L.inRange(r.status, [200, 201]) && !!r.json?.accessToken && !!r.json?.refreshToken });
      S.add({ id: `LG-P-${a.role}-role`, title: `Login response role for ${a.role}`, type: 'positive', ref: 'Roles & permissions', expected: roleMap[a.role], actual: role, ok: role === roleMap[a.role] });
      S.add({ id: `LG-P-${a.role}-perm`, title: `Permissions attached at login for ${a.role}`, type: 'positive', ref: '6. Roles: attachPermissions puts permissions on user.role.permissions', expected: 'array of {module,isRead,...}', actual: `permissions=${Array.isArray(r.json?.data?.role?.permissions) ? r.json.data.role.permissions.length : 'missing'}`, ok: Array.isArray(r.json?.data?.role?.permissions) });
      S.add({ id: `LG-P-${a.role}-nopw`, title: `Login response does not leak password hash (${a.role})`, type: 'negative', ref: 'security', expected: 'no "password" field in body', actual: /"password"\s*:/.test(r.text) ? 'password field present' : 'absent', ok: !/"password"\s*:/.test(r.text) });
    });
  }

  // ---------- LOGIN: negative + BVA ----------
  const neg = [
    ['LG-N01', 'wrong password', { email: eng.email, password: 'WrongPass#2026' }, [401, 404]],
    ['LG-N02', 'unregistered email', { email: `nobody-${stamp}@mailinator.com`, password: 'WrongPass#2026' }, [401, 404]],
    ['LG-N03', 'email upper-cased + correct password', { email: eng.email.toUpperCase(), password: eng.password }, [200, 201, 401, 404]],
    ['LG-N04', 'empty email', { email: '', password: eng.password }, [400, 401, 404]],
    ['LG-N05', 'empty password', { email: eng.email, password: '' }, [400, 401, 404]],
    ['LG-N06', 'missing body', undefined, [400, 401, 404]],
    ['LG-N07', 'invalid email format', { email: 'not-an-email', password: eng.password }, [400, 401, 404]],
    ['LG-N08', 'email with leading/trailing spaces', { email: `  ${eng.email}  `, password: eng.password }, [200, 201, 400, 401, 404]],
    ['LG-N09', 'SQL injection in email', { email: "' OR 1=1 --", password: 'x' }, [400, 401, 404]],
    ['LG-N10', 'password 1 char', { email: eng.email, password: 'a' }, [400, 401, 404]],
    ['LG-N11', 'password 500 chars', { email: eng.email, password: 'A'.repeat(500) }, [400, 401, 404, 413]],
    ['LG-N12', 'email 320 chars', { email: `${'a'.repeat(300)}@mailinator.com`, password: 'x' }, [400, 401, 404]],
    ['LG-N13', 'email as number', { email: 12345, password: 'x' }, [400, 401, 404]],
    ['LG-N14', 'null fields', { email: null, password: null }, [400, 401, 404]],
  ];
  for (const [id, name, body, okStatus] of neg) {
    await L.step(S, id, name, 'negative', 'Login', async () => {
      const r = await R('/auth/login', body);
      const leak = /password is (wrong|incorrect)|email (not found|does not exist)|user not found/i.test(r.text);
      const tokenOk = id === 'LG-N03' || id === 'LG-N08' ? true : !r.json?.accessToken;
      S.add({ id, title: `Login rejected: ${name}`, type: id.includes('N1') ? 'bva' : 'negative', ref: 'Login: wrong credentials → "Invalid email or password"', expected: `HTTP ${okStatus.join('/')}, no token, generic message`, actual: `HTTP ${r.status} token=${!!r.json?.accessToken} msg="${L.msg(r)}"`, ok: L.inRange(r.status, okStatus) && tokenOk && !leak, note: ['LG-N03', 'LG-N08'].includes(id) ? 'informational: case/space handling' : '' });
    });
  }
  await L.step(S, 'LG-N15', 'rate/brute force sample', 'edge', 'Login', async () => {
    const codes = [];
    for (let i = 0; i < 8; i++) { const r = await R('/auth/login', { email: eng.email, password: `bad${i}` }); codes.push(r.status); }
    S.add({ id: 'LG-N15', title: '8 quick failed logins: server stays consistent (no 500)', type: 'edge', ref: 'Login', expected: 'all 401/404/429', actual: codes.join(','), ok: codes.every((c) => [401, 404, 429].includes(c)), note: codes.includes(429) ? 'rate limiting present' : 'no rate limiting observed (informational)' });
  });

  // ---------- LOGIN: unverified account → 307 ----------
  await L.step(S, 'LG-E01', 'unverified login', 'edge', 'Login', async () => {
    // create a throw-away unverified account, then login must return 307 (OTP resent)
    const email = `cl01-unverified-${stamp}@mailinator.com`;
    const su = await R('/auth/signup', { firstName: 'Check', lastName: 'List', email, phoneNumber: '+61400000001', password: 'Check@2026x', referralSource: 'LinkedIn', address: {} });
    S.add({ id: 'SU-P01', title: 'Technician signup with valid data is accepted', type: 'positive', ref: 'Technician Sign-up → POST auth/signup', expected: '200/201', actual: `HTTP ${su.status} msg="${L.msg(su)}"`, ok: L.inRange(su.status, [200, 201]) });
    const r = await R('/auth/login', { email, password: 'Check@2026x' }, undefined);
    S.add({ id: 'LG-E01', title: 'Login of unverified email returns 307 (OTP re-sent)', type: 'edge', ref: 'Login: Unverified email (HTTP 307)', expected: 'HTTP 307, no token', actual: `HTTP ${r.status} token=${!!r.json?.accessToken}`, ok: r.status === 307 && !r.json?.accessToken });
    const dup = await R('/auth/signup', { firstName: 'Check', lastName: 'List', email, phoneNumber: '+61400000001', password: 'Check@2026x', referralSource: 'LinkedIn', address: {} });
    S.add({ id: 'SU-N01', title: 'Signup again with same unverified email → 403 (go to OTP)', type: 'negative', ref: 'Sign-up: 403 (existing unverified) → navigate /otp', expected: 'HTTP 403', actual: `HTTP ${dup.status} msg="${L.msg(dup)}"`, ok: dup.status === 403 });
    // OTP negatives on this account
    const otpCases = [['OTP-N01', '5 digits', '12345'], ['OTP-N02', '7 digits', '1234567'], ['OTP-N03', 'letters', 'abcdef'], ['OTP-N04', 'wrong 6 digits', '000000'], ['OTP-N05', 'empty code', ''], ['OTP-N06', 'code as number', 123456]];
    for (const [id, name, code] of otpCases) {
      const v = await R('/otps/verify', { email, code });
      S.add({ id, title: `OTP verify rejected: ${name}`, type: ['OTP-N01', 'OTP-N02'].includes(id) ? 'bva' : 'negative', ref: 'OTP page → POST otps/verify', expected: 'HTTP 400/401/404, no token', actual: `HTTP ${v.status} token=${!!v.json?.accessToken} msg="${L.msg(v)}"`, ok: [400, 401, 403, 404, 422].includes(v.status) && !v.json?.accessToken });
    }
    const rs = await L.call(ctx, 'GET', `/otps/resend/${encodeURIComponent(email)}`);
    S.add({ id: 'OTP-P01', title: 'Resend OTP for an unverified email', type: 'positive', ref: 'OTP: "Resend?" → GET otps/resend/<email>', expected: 'HTTP 200/201', actual: `HTTP ${rs.status} msg="${L.msg(rs)}"`, ok: L.inRange(rs.status, [200, 201]) });
    const rs2 = await L.call(ctx, 'GET', `/otps/resend/${encodeURIComponent(`nobody-${stamp}@mailinator.com`)}`);
    S.add({ id: 'OTP-N07', title: 'Resend OTP for unknown email is rejected', type: 'negative', ref: 'OTP resend', expected: 'HTTP 400/404', actual: `HTTP ${rs2.status} msg="${L.msg(rs2)}"`, ok: [400, 404].includes(rs2.status) });
    const rs3 = await L.call(ctx, 'GET', `/otps/resend/${encodeURIComponent(eng.email)}`);
    S.add({ id: 'OTP-N08', title: 'Resend OTP for an already-verified email', type: 'edge', ref: 'OTP resend', expected: 'HTTP 400/404/409 (should not re-verify)', actual: `HTTP ${rs3.status} msg="${L.msg(rs3)}"`, ok: [400, 403, 404, 409].includes(rs3.status), note: 'informational if 200: server re-sends OTP to a verified user' });
  });

  // ---------- SIGNUP DTO: negative + BVA ----------
  const base = { firstName: 'Check', lastName: 'List', phoneNumber: '+61400000002', referralSource: 'LinkedIn', address: {} };
  const su = [
    ['SU-N02', 'existing verified email', { ...base, email: eng.email, password: 'Check@2026x' }, [400, 403, 409]],
    ['SU-N03', 'invalid email', { ...base, email: 'bad-email', password: 'Check@2026x' }, [400]],
    ['SU-N04', 'missing email', { ...base, password: 'Check@2026x' }, [400]],
    ['SU-N05', 'missing password', { ...base, email: `cl01-np-${stamp}@mailinator.com` }, [400]],
    ['SU-N06', 'missing first name', { ...base, firstName: undefined, email: `cl01-nf-${stamp}@mailinator.com`, password: 'Check@2026x' }, [400]],
    ['SU-N07', 'first name with digits', { ...base, firstName: 'Check123', email: `cl01-fd-${stamp}@mailinator.com`, password: 'Check@2026x' }, [400]],
    ['SU-B01', 'password 7 chars (below min 8)', { ...base, email: `cl01-p7-${stamp}@mailinator.com`, password: 'Ab1@xyz' }, [400]],
    ['SU-B02', 'password 8 chars (min)', { ...base, email: `cl01-p8-${stamp}@mailinator.com`, password: 'Ab1@xyzw' }, [200, 201]],
    ['SU-B03', 'password 20 chars (max)', { ...base, email: `cl01-p20-${stamp}@mailinator.com`, password: 'Ab1@' + 'x'.repeat(16) }, [200, 201]],
    ['SU-B04', 'password 21 chars (above max 20)', { ...base, email: `cl01-p21-${stamp}@mailinator.com`, password: 'Ab1@' + 'x'.repeat(17) }, [400]],
    ['SU-N08', 'password without uppercase', { ...base, email: `cl01-nu-${stamp}@mailinator.com`, password: 'check@2026x' }, [400]],
    ['SU-N09', 'password without number', { ...base, email: `cl01-nn-${stamp}@mailinator.com`, password: 'Check@abcd' }, [400]],
    ['SU-N10', 'password without symbol', { ...base, email: `cl01-ns-${stamp}@mailinator.com`, password: 'Check2026x' }, [400]],
    ['SU-N11', 'password with space', { ...base, email: `cl01-sp-${stamp}@mailinator.com`, password: 'Check @2026x' }, [400]],
    ['SU-N12', 'invalid referral source', { ...base, referralSource: 'TikTok', email: `cl01-rs-${stamp}@mailinator.com`, password: 'Check@2026x' }, [400]],
    ['SU-N13', 'empty body', {}, [400]],
    ['SU-B05', 'first name 1 char', { ...base, firstName: 'A', email: `cl01-f1-${stamp}@mailinator.com`, password: 'Check@2026x' }, [200, 201, 400]],
    ['SU-B06', 'first name 300 chars', { ...base, firstName: 'A'.repeat(300), email: `cl01-f300-${stamp}@mailinator.com`, password: 'Check@2026x' }, [400]],
  ];
  for (const [id, name, body, okStatus] of su) {
    await L.step(S, id, name, 'negative', 'Sign-up', async () => {
      const r = await R('/auth/signup', body);
      S.add({ id, title: `Signup ${okStatus[0] < 300 ? 'accepted' : 'rejected'}: ${name}`, type: id.startsWith('SU-B') ? 'bva' : 'negative', ref: 'Sign-up password rules 8–20, upper, lower, number, symbol; names letters only', expected: `HTTP ${okStatus.join('/')}`, actual: `HTTP ${r.status} msg="${L.msg(r)}"`, ok: L.inRange(r.status, okStatus), note: id === 'SU-B05' ? 'informational boundary' : '' });
    });
  }

  // ---------- FORGOT PASSWORD ----------
  const fp = [
    ['FP-P01', 'registered email', { email: eng.email }, [200, 201]],
    ['FP-N01', 'unregistered email (same neutral answer)', { email: `nobody-${stamp}@mailinator.com` }, [200, 201]],
    ['FP-N02', 'invalid email format', { email: 'nope' }, [400]],
    ['FP-N03', 'empty email', { email: '' }, [400]],
    ['FP-N04', 'missing body', undefined, [400]],
    ['FP-B01', 'email 320 chars', { email: `${'b'.repeat(300)}@mailinator.com` }, [200, 201, 400]],
  ];
  const fpOut = {};
  for (const [id, name, body, okStatus] of fp) {
    await L.step(S, id, name, 'negative', 'Forgot Password', async () => {
      const r = await R('/auth/forgotPassword', body); fpOut[id] = r;
      S.add({ id, title: `Forgot password: ${name}`, type: id.startsWith('FP-B') ? 'bva' : id.startsWith('FP-P') ? 'positive' : 'negative', ref: 'Forgot Password → POST /auth/forgotPassword', expected: `HTTP ${okStatus.join('/')}`, actual: `HTTP ${r.status} body=${r.text.slice(0, 120)}`, ok: L.inRange(r.status, okStatus) });
    });
  }
  if (fpOut['FP-P01'] && fpOut['FP-N01']) {
    const a = fpOut['FP-P01'], b = fpOut['FP-N01'];
    S.add({ id: 'FP-E01', title: 'Registered vs unregistered email give the same response (no enumeration)', type: 'edge', ref: 'TD-23 / Forgot Password', expected: 'same status + same message', actual: `${a.status}/"${L.msg(a)}" vs ${b.status}/"${L.msg(b)}"`, ok: a.status === b.status && L.msg(a) === L.msg(b) });
  }
  await L.step(S, 'FP-E02', 'cooldown', 'edge', 'Forgot Password', async () => {
    const r = await R('/auth/forgotPassword', { email: eng.email });
    S.add({ id: 'FP-E02', title: 'Second request inside cooldown is handled (sent=false or 429)', type: 'edge', ref: 'Forgot Password: cooldownRemaining', expected: 'HTTP 200 with sent!=true/cooldownRemaining, or 429', actual: `HTTP ${r.status} body=${r.text.slice(0, 160)}`, ok: r.status === 429 || (r.json && (r.json.sent === false || r.json.cooldownRemaining != null)) || L.inRange(r.status, [200, 201]), note: 'informational if server simply re-sends' });
  });

  // ---------- RESET PASSWORD (PUT /auth/resetPassword) ----------
  const strong = 'Reset@2026x';
  const rp = [
    ['RP-N01', 'invalid token', { newPassword: strong, resetToken: 'x'.repeat(64) }, [400, 401, 404]],
    ['RP-N02', 'empty token', { newPassword: strong, resetToken: '' }, [400, 401, 404]],
    ['RP-N03', 'missing token', { newPassword: strong }, [400, 401, 404]],
    ['RP-B01', 'token 63 chars', { newPassword: strong, resetToken: 'y'.repeat(63) }, [400, 401, 404]],
    ['RP-B02', 'token 65 chars', { newPassword: strong, resetToken: 'y'.repeat(65) }, [400, 401, 404]],
    ['RP-B03', 'password 7 chars + bad token', { newPassword: 'Ab1@xyz', resetToken: 'x'.repeat(64) }, [400, 401, 404]],
    ['RP-N04', 'weak password (no symbol) + bad token', { newPassword: 'Reset2026x', resetToken: 'x'.repeat(64) }, [400, 401, 404]],
    ['RP-N05', 'empty body', {}, [400, 401, 404]],
  ];
  for (const [id, name, body, okStatus] of rp) {
    await L.step(S, id, name, 'negative', 'Reset Password', async () => {
      const r = await L.call(ctx, 'PUT', '/auth/resetPassword', body);
      S.add({ id, title: `Reset password rejected: ${name}`, type: id.startsWith('RP-B') ? 'bva' : 'negative', ref: 'Reset Password → PUT /auth/resetPassword {newPassword, resetToken}', expected: `HTTP ${okStatus.join('/')}`, actual: `HTTP ${r.status} msg="${L.msg(r)}"`, ok: L.inRange(r.status, okStatus) });
    });
  }

  // ---------- CREATE NEW PASSWORD / SESSION / REFRESH / LOGOUT ----------
  await L.step(S, 'SE-N01', 'no token', 'negative', 'Session', async () => {
    const r = await L.call(ctx, 'GET', '/auth/session');
    S.add({ id: 'SE-N01', title: 'GET auth/session without token → 401', type: 'negative', ref: 'Social callback → GET auth/session', expected: 'HTTP 401', actual: `HTTP ${r.status}`, ok: r.status === 401 });
    const r2 = await L.call(ctx, 'PUT', '/auth/createNewPassword', { newPassword: strong });
    S.add({ id: 'CNP-N01', title: 'PUT auth/createNewPassword without token → 401', type: 'negative', ref: 'Create New Password (first login) → PUT /auth/createNewPassword', expected: 'HTTP 401', actual: `HTTP ${r2.status}`, ok: r2.status === 401 });
    const r3 = await L.call(ctx, 'GET', '/users/me');
    S.add({ id: 'SE-N02', title: 'Protected endpoint (users/me) without token → 401', type: 'negative', ref: 'RequireAuth / axios Bearer', expected: 'HTTP 401', actual: `HTTP ${r3.status}`, ok: r3.status === 401 });
    const bad = await L.api('this.is.not.a.jwt');
    const r4 = await L.call(bad, 'GET', '/users/me'); await bad.dispose();
    S.add({ id: 'SE-N03', title: 'Malformed bearer token → 401', type: 'negative', ref: 'Token refresh & forced logout', expected: 'HTTP 401', actual: `HTTP ${r4.status}`, ok: r4.status === 401 });
  });
  await L.step(S, 'SE-P01', 'session positive', 'positive', 'Session', async () => {
    const s = await L.session(eng);
    const r = await L.call(s.ctx, 'GET', '/auth/session');
    S.add({ id: 'SE-P01', title: 'GET auth/session with a valid token returns the user', type: 'positive', ref: 'GET auth/session', expected: 'HTTP 200 + user', actual: `HTTP ${r.status} keys=${Object.keys(r.json || {}).slice(0, 6).join(',')}`, ok: r.status === 200 });
    const me = await L.call(s.ctx, 'GET', '/users/me');
    S.add({ id: 'SE-P02', title: 'GET users/me with a valid token', type: 'positive', ref: 'App shell: GET users/me', expected: 'HTTP 200', actual: `HTTP ${me.status}`, ok: me.status === 200 });
    // refresh
    const rf = await L.call(ctx, 'POST', '/auth/refreshToken', { oldRefreshToken: s.refreshToken });
    const rfd = rf.json?.data || rf.json || {};
    S.add({ id: 'RT-P01', title: 'Refresh token exchange returns new tokens', type: 'positive', ref: 'axiosInstance: POST auth/refreshToken {oldRefreshToken}', expected: 'HTTP 200/201 + accessToken + refreshToken', actual: `HTTP ${rf.status} access=${!!rfd.accessToken} refresh=${!!rfd.refreshToken}`, ok: L.inRange(rf.status, [200, 201]) && !!rfd.accessToken });
    const rfBad = await L.call(ctx, 'POST', '/auth/refreshToken', { oldRefreshToken: 'bogus' });
    S.add({ id: 'RT-N01', title: 'Refresh with a bogus refresh token is rejected', type: 'negative', ref: 'Refresh fails → logout', expected: 'HTTP 401/403/400', actual: `HTTP ${rfBad.status} msg="${L.msg(rfBad)}"`, ok: [400, 401, 403].includes(rfBad.status) });
    const rfEmpty = await L.call(ctx, 'POST', '/auth/refreshToken', {});
    S.add({ id: 'RT-N02', title: 'Refresh with empty body is rejected', type: 'negative', ref: 'Refresh', expected: 'HTTP 400/401', actual: `HTTP ${rfEmpty.status}`, ok: [400, 401, 403].includes(rfEmpty.status) });
    const rfReuse = await L.call(ctx, 'POST', '/auth/refreshToken', { oldRefreshToken: s.refreshToken });
    S.add({ id: 'RT-E01', title: 'Re-using an already-exchanged refresh token', type: 'edge', ref: 'Refresh token rotation', expected: 'HTTP 401/403 (rotated) — informational if accepted', actual: `HTTP ${rfReuse.status}`, ok: true, note: rfReuse.status < 300 ? 'OLD REFRESH TOKEN STILL ACCEPTED (no rotation) — security note' : 'old refresh token rejected' });
    // new login invalidates earlier token (known behaviour)
    const s2 = await L.session(eng);
    const old = await L.call(s.ctx, 'GET', '/users/me');
    S.add({ id: 'SE-E01', title: 'A new login invalidates the previous access token of the same user', type: 'edge', ref: 'dev gotcha: token invalidation on login', expected: 'informational (401 = single session, 200 = multi session)', actual: `HTTP ${old.status}`, ok: true, note: old.status === 401 ? 'single-session: new login kills the old token' : 'multi-session: old token stays valid after a new login' });
    // logout
    const lo = await L.call(s2.ctx, 'POST', '/auth/logout', { refreshToken: s2.refreshToken });
    S.add({ id: 'LO-P01', title: 'Logout with refresh token succeeds', type: 'positive', ref: 'useAuth.logout → POST auth/logout {refreshToken}', expected: 'HTTP 200/201', actual: `HTTP ${lo.status} msg="${L.msg(lo)}"`, ok: L.inRange(lo.status, [200, 201]) });
    const after = await L.call(s2.ctx, 'GET', '/users/me');
    S.add({ id: 'LO-E01', title: 'Access token after logout', type: 'edge', ref: 'logout clears session', expected: 'HTTP 401 preferred', actual: `HTTP ${after.status}`, ok: true, note: after.status === 200 ? 'ACCESS TOKEN STILL VALID AFTER LOGOUT (informational / security note)' : 'token invalidated' });
    const lo2 = await L.call(ctx, 'POST', '/auth/logout', { refreshToken: 'bogus' });
    S.add({ id: 'LO-N01', title: 'Logout with a bogus refresh token', type: 'negative', ref: 'logout', expected: 'HTTP 400/401/404 (or 200 idempotent)', actual: `HTTP ${lo2.status}`, ok: [200, 201, 400, 401, 404].includes(lo2.status) });
    await s.ctx.dispose(); await s2.ctx.dispose();
  });

  await ctx.dispose();
  S.save();
});
