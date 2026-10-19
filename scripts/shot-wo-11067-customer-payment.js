// Screenshot the customer owner's view of WO 11067 (id 1073): details + Payment tab, and report whether the edit pencil exists.
const { chromium } = require('@playwright/test'); const path = require('path');
const acc = require('../test-accounts.json').find((a) => a.email === 'customer-10090955@mailinator.com');
const OUT = path.join(__dirname, '..', 'evidence', 'WO-11067-CustomerPOEdit'); const WO = process.env.WO_ID || 1073;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, geolocation: { latitude: 31.5, longitude: 74.3 }, permissions: ['geolocation'] });
  const p = await ctx.newPage(); const api = [];
  p.on('response', (r) => { if (/offers\/customer\/counter\/|workOrders\/\d+$|estimatedPayment/.test(r.url())) api.push(`${r.request().method()} ${r.url().replace(/.*\/api/, '')} -> ${r.status()}`); });
  await p.goto('https://dev.techdomain.com.au/login'); await p.locator('input[type="email"], input[name="email"]').first().fill(acc.email); await p.locator('input[type="password"]').first().fill(acc.password); await p.locator('button[type="submit"]').first().click();
  await p.waitForURL((u) => !/login/.test(u.href), { timeout: 30000 }); await p.waitForTimeout(2500);
  await p.goto(`https://dev.techdomain.com.au/workOrder/details/${WO}`); await p.waitForTimeout(4000); await p.screenshot({ path: path.join(OUT, '1_customer-details.png'), fullPage: true });
  const hdr = (await p.locator('body').innerText()).split('\n').slice(0, 25).join(' | '); console.log('DETAILS:', hdr.slice(0, 600));
  await p.goto(`https://dev.techdomain.com.au/workOrder/payment/${WO}`); await p.waitForTimeout(5000); await p.screenshot({ path: path.join(OUT, '2_customer-payment-tab.png'), fullPage: true });
  const pencils = await p.locator('i.fa-pencil, i[class*="fa-pencil"]').count(); const txt = await p.locator('body').innerText();
  console.log('PAYMENT pencil icons:', pencils); console.log('PAYMENT text:', txt.replace(/\s+/g, ' ').slice(0, 900)); console.log('API:', api.join('\n'));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
