// Compare two sets of checklist result JSONs (evidence/Checklist/results) check-by-check.
// usage: node scripts/compare-checklist-runs.js <baselineDir> [currentDir=evidence/Checklist/results] [--md out.md]
const fs = require('fs');
const path = require('path');
const mdI = process.argv.indexOf('--md');
const positional = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--md');
const [baseDir, curDirArg] = positional;
const mdIdx = process.argv.indexOf('--md');
const mdOut = mdIdx > -1 ? process.argv[mdIdx + 1] : null;
const curDir = curDirArg || path.join(__dirname, '..', 'evidence', 'Checklist', 'results');
const load = (d) => Object.fromEntries(fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))]));
const base = load(baseDir), cur = load(curDir);
const lines = [], rows = [];
const tot = { same: 0, fixed: 0, regressed: 0, added: 0, missing: 0 };
for (const f of Object.keys({ ...base, ...cur }).sort()) {
  const b = base[f], c = cur[f];
  if (!b || !c) { lines.push(`## ${f}: ${b ? 'missing in current run' : 'new area'}`); continue; }
  const bm = new Map(b.checks.map((x) => [x.id + '|' + x.title, x]));
  const cm = new Map(c.checks.map((x) => [x.id + '|' + x.title, x]));
  const s = { same: 0, fixed: 0, regressed: 0, added: 0, missing: 0 };
  const detail = [];
  for (const [k, cc] of cm) {
    const bc = bm.get(k);
    if (!bc) { s.added++; if (!cc.ok) detail.push(`- NEW FAIL ${cc.id} ${cc.title}\n  - now: ${cc.actual}`); continue; }
    if (bc.ok === cc.ok) s.same++;
    else if (cc.ok) { s.fixed++; detail.push(`- FIXED ${cc.id} ${cc.title}\n  - before: ${bc.actual}\n  - now: ${cc.actual}`); }
    else { s.regressed++; detail.push(`- REGRESSED ${cc.id} ${cc.title}\n  - expected: ${cc.expected}\n  - before: ${bc.actual}\n  - now: ${cc.actual}`); }
  }
  for (const k of bm.keys()) if (!cm.has(k)) { s.missing++; detail.push(`- MISSING ${bm.get(k).id} ${bm.get(k).title} (was ${bm.get(k).ok ? 'PASS' : 'FAIL'})`); }
  for (const k in s) tot[k] += s[k];
  rows.push({ area: f.replace('.json', ''), before: `${b.summary.pass}/${b.summary.total}`, after: `${c.summary.pass}/${c.summary.total}`, ...s, baseRun: b.run, curRun: c.run });
  lines.push(`## ${f.replace('.json', '')} (run ${b.run} -> ${c.run})`, `pass before ${b.summary.pass}/${b.summary.total}, after ${c.summary.pass}/${c.summary.total}; same ${s.same}, fixed ${s.fixed}, regressed ${s.regressed}, new ${s.added}, missing ${s.missing}`, ...detail, '');
}
const table = ['| Area | Pass before | Pass after | Same | Fixed | Regressed | New | Missing |', '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.area} | ${r.before} | ${r.after} | ${r.same} | ${r.fixed} | ${r.regressed} | ${r.added} | ${r.missing} |`)];
const out = [`# Checklist regression compare`, `baseline: ${baseDir}`, `current: ${curDir}`, '', ...table, '', `Totals: same ${tot.same}, fixed ${tot.fixed}, regressed ${tot.regressed}, new ${tot.added}, missing ${tot.missing}`, '', ...lines].join('\n');
console.log(out);
if (mdOut) fs.writeFileSync(mdOut, out);
