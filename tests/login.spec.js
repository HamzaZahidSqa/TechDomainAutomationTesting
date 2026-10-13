// UI login test for every account in accounts.json.
// Run: npx playwright test tests/login.spec.js   (add --headed to watch)
// Override login path with LOGIN_PATH env var if it is not /login.
const { test, expect } = require('@playwright/test');
const path = require('path');

const accounts = require(path.join(__dirname, '..', 'accounts.json'));
const LOGIN_PATH = process.env.LOGIN_PATH || '/login';

for (const account of accounts) {
  test(`login: ${account.role} (${account.email})`, async ({ page }, testInfo) => {
    // Capture the login API response so the failure reason is visible in the report.
    const loginResponse = page.waitForResponse(
      (res) => res.url().includes('/auth/login') && res.request().method() === 'POST',
      { timeout: 20_000 }
    );

    await page.goto(LOGIN_PATH);

    const email = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
    const password = page.locator('input[type="password"]').first();
    await expect(email).toBeVisible({ timeout: 15_000 });

    await email.fill(account.email);
    await password.fill(account.password);
    await page
      .locator('button[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")')
      .first()
      .click();

    const res = await loginResponse;
    const status = res.status();
    let body = '';
    try { body = JSON.stringify(await res.json()).slice(0, 300); } catch { }
    testInfo.annotations.push({ type: 'api', description: `HTTP ${status} ${status >= 400 || status === 307 ? body : ''}` });

    expect(status, `login API returned HTTP ${status}: ${body}`).toBeLessThan(300);

    // App should navigate away from the login page after a successful sign-in.
    await expect(page).not.toHaveURL(/login|sign-?in/i, { timeout: 20_000 });

    await page.screenshot({ path: testInfo.outputPath('after-login.png'), fullPage: true });
  });
}
