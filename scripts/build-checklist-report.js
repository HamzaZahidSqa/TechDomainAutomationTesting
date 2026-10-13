// Builds the living checklist dashboard (reports/checklist-dashboard.html) and a PDF report
// (reports/Checklist-Report-<date>.pdf) from evidence/Checklist/results/*.json.
// Re-run after every checklist batch:  node scripts/build-checklist-report.js
// Options: --no-pdf  (dashboard only)   --pdf-only
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RESULTS = path.join(ROOT, 'evidence', 'Checklist', 'results');
const OUT = path.join(ROOT, 'reports');
const CHECKLIST = path.join(ROOT, 'FUNCTIONALITY_CHECKLIST.md');
fs.mkdirSync(OUT, { recursive: true });

// ---------- checklist progress (how much of the document is covered so far) ----------
const md = fs.readFileSync(CHECKLIST, 'utf8');
const totalItems = (md.match(/^\s*- \[[ x]\]/gm) || []).length;
// Each batch declares the checklist line range it covers (first 10% = lines 28-897 ≈ items 1-455)
const BATCHES = [{ name: 'Batch 1 — first 10% (Notifications, Emails, Sockets, Chat, Cron, Roles, Auth screens, Sign-up, Onboarding)', fromLine: 28, toLine: 897 }];
const batchItems = (b) => md.split('\n').slice(b.fromLine - 1, b.toLine).filter((l) => /^\s*- \[[ x]\]/.test(l)).length;
const coveredItems = BATCHES.reduce((a, b) => a + batchItems(b), 0);

// ---------- load results ----------
const files = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json')).sort() : [];
const areas = files.map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')));
const all = areas.flatMap((a) => a.checks.map((c) => ({ ...c, area: a.area, section: a.section, run: a.run, date: a.date })));
const n = (arr) => arr.length, pass = (arr) => arr.filter((c) => c.ok).length, fail = (arr) => arr.filter((c) => !c.ok).length;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const types = ['positive', 'negative', 'edge', 'bva'];
const typeLabel = { positive: 'Positive', negative: 'Negative', edge: 'Edge case', bva: 'Boundary value' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const now = new Date();
const stamp = now.toISOString().slice(0, 10);
const lastRun = areas.map((a) => a.date).sort().pop() || '';
const findings = all.filter((c) => !c.ok || /SERVER ERROR|CONFIRMED|security|IDOR|ACCEPT|STORED|GAP|ALLOWED|finding|still valid/i.test(c.note || ''));
const sev = (c) => (/500|IDOR|security|ALLOWED|STORED|token still|still valid/i.test(`${c.note} ${c.actual}`) ? 'High' : (!c.ok ? 'Medium' : 'Low'));

// ---------- dashboard HTML ----------
const areaRows = areas.map((a) => {
  const t = Object.fromEntries(types.map((ty) => [ty, a.checks.filter((c) => c.type === ty)]));
  return `<tr><td><b>${esc(a.area)}</b><br><small>${esc(a.section)}</small></td><td>${a.checks.length}</td><td class="g">${pass(a.checks)}</td><td class="r">${fail(a.checks)}</td>
  <td><div class="bar"><div style="width:${pct(pass(a.checks), a.checks.length)}%"></div></div>${pct(pass(a.checks), a.checks.length)}%</td>
  ${types.map((ty) => `<td>${pass(t[ty])}/${t[ty].length}</td>`).join('')}<td><small>${esc(a.date?.slice(0, 16).replace('T', ' '))}</small></td></tr>`;
}).join('');

const rows = all.map((c, i) => `<tr class="${c.ok ? 'ok' : 'ko'}" data-area="${esc(c.area)}" data-type="${c.type}" data-ok="${c.ok}" data-text="${esc((c.id + ' ' + c.title + ' ' + c.ref + ' ' + c.note).toLowerCase())}">
<td>${i + 1}</td><td><code>${esc(c.id)}</code></td><td>${esc(c.area)}</td><td><span class="tag ${c.type}">${typeLabel[c.type] || c.type}</span></td>
<td>${esc(c.title)}<br><small class="ref">${esc(c.ref)}</small></td><td>${esc(c.expected)}</td><td>${esc(c.actual)}</td>
<td class="${c.ok ? 'g' : 'r'}"><b>${c.ok ? 'PASS' : 'FAIL'}</b></td><td>${esc(c.note)}${c.screenshot ? `<br><a href="../${esc(c.screenshot)}" target="_blank">screenshot</a>` : ''}</td></tr>`).join('');

const dash = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TDP Checklist Dashboard</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1f2328;--mut:#656d76;--g:#1a7f37;--r:#cf222e;--a:#0969da;--b:#d0d7de}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--ink:#e6edf3;--mut:#8b949e;--g:#3fb950;--r:#f85149;--a:#58a6ff;--b:#30363d}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 "Segoe UI",system-ui,Arial,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:20px 16px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:26px 0 8px} small{color:var(--mut)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0}
.card{background:var(--card);border:1px solid var(--b);border-radius:10px;padding:14px}
.card .v{font-size:28px;font-weight:700} .card .l{color:var(--mut);font-size:12px}
.g{color:var(--g)} .r{color:var(--r)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--b);border-radius:8px;overflow:hidden}
th,td{border-bottom:1px solid var(--b);padding:6px 8px;text-align:left;vertical-align:top;font-size:13px} th{background:rgba(127,127,127,.08);position:sticky;top:0}
tr.ko td{background:rgba(207,34,46,.06)}
.bar{height:8px;background:rgba(127,127,127,.2);border-radius:4px;overflow:hidden;margin-bottom:3px;min-width:80px}.bar div{height:100%;background:var(--g)}
.tag{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;border:1px solid var(--b)}
.tag.positive{background:rgba(26,127,55,.12)} .tag.negative{background:rgba(207,34,46,.12)} .tag.edge{background:rgba(130,80,223,.12)} .tag.bva{background:rgba(9,105,218,.12)}
.ref{color:var(--mut)} code{font-size:12px}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;align-items:center}
.filters input,.filters select{padding:6px 8px;border:1px solid var(--b);border-radius:6px;background:var(--card);color:var(--ink)}
.prog{height:16px;background:rgba(127,127,127,.2);border-radius:8px;overflow:hidden}.prog div{height:100%;background:var(--a)}
@media(max-width:700px){th:nth-child(6),td:nth-child(6),th:nth-child(7),td:nth-child(7){display:none}}
</style></head><body><div class="wrap">
<h1>Tech Domain Platform — Functionality Checklist Dashboard</h1>
<small>Environment: dev.techdomain.com.au · Generated ${esc(now.toISOString().slice(0, 16).replace('T', ' '))} · Last test run ${esc(lastRun.slice(0, 16).replace('T', ' '))} · Source: evidence/Checklist/results/*.json · Rebuild with <code>node scripts/build-checklist-report.js</code></small>

<h2>Checklist progress</h2>
<div class="card">
<div><b>${coveredItems}</b> of <b>${totalItems}</b> checklist items covered so far (${pct(coveredItems, totalItems)}%)</div>
<div class="prog" style="margin:8px 0"><div style="width:${pct(coveredItems, totalItems)}%"></div></div>
${BATCHES.map((b) => `<div><small>✔ ${esc(b.name)} — checklist lines ${b.fromLine}–${b.toLine}, ${batchItems(b)} items</small></div>`).join('')}
</div>

<div class="cards">
<div class="card"><div class="v">${n(all)}</div><div class="l">Test checks executed</div></div>
<div class="card"><div class="v g">${pass(all)}</div><div class="l">Passed</div></div>
<div class="card"><div class="v r">${fail(all)}</div><div class="l">Failed</div></div>
<div class="card"><div class="v">${pct(pass(all), n(all))}%</div><div class="l">Pass rate</div></div>
${types.map((ty) => `<div class="card"><div class="v">${pass(all.filter((c) => c.type === ty))}/${n(all.filter((c) => c.type === ty))}</div><div class="l">${typeLabel[ty]} (pass/total)</div></div>`).join('')}
<div class="card"><div class="v r">${findings.filter((c) => sev(c) === 'High').length}</div><div class="l">High-severity findings</div></div>
</div>

<h2>Per area</h2>
<table><tr><th>Area</th><th>Checks</th><th>Pass</th><th>Fail</th><th>Pass rate</th><th>Positive</th><th>Negative</th><th>Edge</th><th>BVA</th><th>Run</th></tr>${areaRows}</table>

<h2>All checks</h2>
<div class="filters">
<input id="q" placeholder="search id / title / note…" size="36">
<select id="fa"><option value="">all areas</option>${areas.map((a) => `<option>${esc(a.area)}</option>`).join('')}</select>
<select id="ft"><option value="">all types</option>${types.map((t) => `<option value="${t}">${typeLabel[t]}</option>`).join('')}</select>
<select id="fo"><option value="">pass + fail</option><option value="false">fail only</option><option value="true">pass only</option></select>
<small id="cnt"></small>
</div>
<table id="t"><tr><th>#</th><th>ID</th><th>Area</th><th>Type</th><th>Check / checklist reference</th><th>Expected</th><th>Actual</th><th>Result</th><th>Note / evidence</th></tr>${rows}</table>
<script>
const q=document.getElementById('q'),fa=document.getElementById('fa'),ft=document.getElementById('ft'),fo=document.getElementById('fo'),cnt=document.getElementById('cnt');
function apply(){const s=q.value.toLowerCase();let k=0;for(const tr of document.querySelectorAll('#t tr[data-area]')){const ok=(!s||tr.dataset.text.includes(s))&&(!fa.value||tr.dataset.area===fa.value)&&(!ft.value||tr.dataset.type===ft.value)&&(!fo.value||tr.dataset.ok===fo.value);tr.style.display=ok?'':'none';if(ok)k++;}cnt.textContent=k+' shown';}
[q,fa,ft,fo].forEach(e=>e.addEventListener('input',apply));apply();
</script>
</div></body></html>`;
fs.writeFileSync(path.join(OUT, 'checklist-dashboard.html'), dash);
console.log(`dashboard: reports/checklist-dashboard.html (${all.length} checks, ${pass(all)} pass, ${fail(all)} fail)`);

if (process.argv.includes('--no-pdf')) process.exit(0);

// ---------- PDF (easy wording) ----------
const simple = {
  positive: 'Normal use (should work)', negative: 'Wrong input (should be refused)', edge: 'Unusual situation', bva: 'Limit value (min / max / just outside)',
};
const areaSummary = areas.map((a) => `<tr><td>${esc(a.section)}</td><td>${a.checks.length}</td><td class="g">${pass(a.checks)}</td><td class="r">${fail(a.checks)}</td><td>${pct(pass(a.checks), a.checks.length)}%</td></tr>`).join('');
const findRows = findings.sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[sev(a)] - { High: 0, Medium: 1, Low: 2 }[sev(b)])).map((c) => `<tr><td class="${sev(c) === 'High' ? 'r' : ''}"><b>${sev(c)}</b></td><td><code>${esc(c.id)}</code><br><small>${esc(c.area)}</small></td><td>${esc(c.title)}</td><td>${esc(c.expected)}</td><td>${esc(c.actual)}</td><td>${esc(c.note)}</td></tr>`).join('');
const detail = areas.map((a) => `<h2 class="pb">${esc(a.section)} <small>(${pass(a.checks)} pass / ${fail(a.checks)} fail)</small></h2>
<table><tr><th>ID</th><th>Kind</th><th>What we checked</th><th>What should happen</th><th>What happened</th><th>Result</th></tr>
${a.checks.map((c) => `<tr><td><code>${esc(c.id)}</code></td><td>${esc(simple[c.type] || c.type)}</td><td>${esc(c.title)}${c.note ? `<br><small>Note: ${esc(c.note)}</small>` : ''}</td><td>${esc(c.expected)}</td><td>${esc(c.actual)}</td><td class="${c.ok ? 'g' : 'r'}"><b>${c.ok ? 'PASS' : 'FAIL'}</b></td></tr>`).join('')}</table>`).join('');
const shots = all.filter((c) => c.screenshot && !c.ok).slice(0, 12).map((c) => { const p = path.join(ROOT, c.screenshot); return fs.existsSync(p) ? `<div class="shot"><small>${esc(c.id)} — ${esc(c.title)}</small><br><img src="data:image/png;base64,${fs.readFileSync(p).toString('base64')}"></div>` : ''; }).join('');

const pdfHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:"Segoe UI",Arial,sans-serif;font-size:10.5px;color:#222;margin:26px}
h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:2px} h3{font-size:12px;margin:10px 0 4px}
table{border-collapse:collapse;width:100%;margin:4px 0} td,th{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top} th{background:#eee}
.g{color:#0a7d2c;font-weight:bold} .r{color:#c00;font-weight:bold} small{color:#555} code{font-size:9.5px}
.box{border:1px solid #999;background:#f6f6f6;padding:6px 8px;margin:6px 0} .pb{page-break-before:always}
.shot{margin:8px 0;page-break-inside:avoid} .shot img{max-width:100%;border:1px solid #999}
ul{margin:4px 0 6px 18px;padding:0} li{margin:2px 0}
</style></head><body>
<h1>Tech Domain Platform — Checklist Test Report (Batch 1: first 10%)</h1>
<small>Website: https://dev.techdomain.com.au · API: https://api.dev.techdomain.com.au/api · Date: ${stamp} · Tool: Playwright (API + browser) · Tests: tests/checklist/*.spec.js · Evidence: evidence/Checklist/</small>

<h2>1. In short</h2>
<div class="box">
<ul>
<li>We tested the <b>first ${coveredItems} items (${pct(coveredItems, totalItems)}%)</b> of the ${totalItems}-item functionality checklist: notifications, emails/sockets rules that are visible from the API, chat & inbox rules, roles & permissions, login / forgot / reset password, OTP, sign-up forms and the "Complete Your Profile" wizard.</li>
<li>For every feature we ran <b>normal cases, wrong-input cases, unusual situations and limit values</b> (for example password length 7 / 8 / 20 / 21, list sizes 0 / 1 / max / max+1, ids like 0, -1, "abc").</li>
<li><b>${n(all)} checks ran: ${pass(all)} passed, ${fail(all)} failed (${pct(pass(all), n(all))}% pass rate).</b></li>
<li><b>${findings.filter((c) => sev(c) === 'High').length} high-severity findings</b> need developer attention first (server crashes on bad input, validation only in the browser, security notes). Full list in section 3.</li>
<li>A live dashboard is in the project at <b>reports/checklist-dashboard.html</b>; it is rebuilt after every batch, so progress keeps updating as more of the checklist is tested.</li>
</ul></div>

<h2>2. Results per area</h2>
<table><tr><th>Area</th><th>Checks</th><th>Passed</th><th>Failed</th><th>Pass rate</th></tr>${areaSummary}
<tr><th>Total</th><th>${n(all)}</th><th class="g">${pass(all)}</th><th class="r">${fail(all)}</th><th>${pct(pass(all), n(all))}%</th></tr></table>
<h3>By kind of test</h3>
<table><tr><th>Kind</th><th>Meaning</th><th>Checks</th><th>Passed</th><th>Failed</th></tr>
${types.map((t) => `<tr><td>${typeLabel[t]}</td><td>${simple[t]}</td><td>${n(all.filter((c) => c.type === t))}</td><td class="g">${pass(all.filter((c) => c.type === t))}</td><td class="r">${fail(all.filter((c) => c.type === t))}</td></tr>`).join('')}</table>

<h2>3. Findings (things to fix or decide)</h2>
<small>High = server error, security or data problem · Medium = behaves differently from the checklist · Low = informational, product decision</small>
<table><tr><th>Severity</th><th>ID / area</th><th>Check</th><th>Should happen</th><th>Did happen</th><th>Note</th></tr>${findRows || '<tr><td colspan="6">No findings</td></tr>'}</table>

<h2>4. How to read the IDs</h2>
<ul><li><b>-P</b> = positive (normal) case, <b>-N</b> = negative (wrong input), <b>-E</b> = edge case, <b>-B</b> = boundary value.</li>
<li>LG login · SU sign-up · OTP one-time code · FP forgot password · RP reset password · SE/RT/LO session, refresh, logout · UL/UR/UF/URP/UO/UG/UT/UC UI screens · NA/NB/NR/NRA notifications · CU/IN/CHH/IT/SM/RD/RA chat & inbox · PM/XR/UI roles · OB onboarding.</li>
<li>Every browser check saved a screenshot under evidence/Checklist/&lt;area&gt;/run-&lt;stamp&gt;/; API checks saved results.json in the same folder.</li></ul>

${detail}

${shots ? '<h2 class="pb">6. Screenshots of failed browser checks</h2>' + shots : ''}
</body></html>`;

(async () => {
  const { chromium } = require('@playwright/test');
  const tmp = path.join(OUT, '.checklist-report.html'); fs.writeFileSync(tmp, pdfHtml);
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file:///' + tmp.replace(/\\/g, '/')); await p.waitForTimeout(500);
  const pdfPath = path.join(OUT, `Checklist-Report-Batch1-${stamp}.pdf`);
  await p.pdf({ path: pdfPath, format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' }, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#777">Tech Domain checklist report · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  await b.close(); fs.unlinkSync(tmp);
  console.log(`pdf: ${path.relative(ROOT, pdfPath)}`);
})();
