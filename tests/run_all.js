/* Run the full test battery: engine reconciliation + UI smoke suites + the E2E scenario.
   Usage:  node tests/run_all.js
   Needs:  jsdom for the UI suites — `npm install jsdom` (anywhere on NODE_PATH, or in this folder).
           Without jsdom, the engine reconciliation still runs. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const results = [];
let totalPass = 0, totalFail = 0;

function run(label, file) {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [file], {
      encoding: 'utf8', timeout: 120000,
      env: Object.assign({}, process.env, { NODE_PATH: [process.env.NODE_PATH, path.join(here, 'node_modules'), '/tmp/node_modules'].filter(Boolean).join(path.delimiter) })
    });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status == null ? 1 : e.status; }
  const pass = (out.match(/^PASS /gm) || []).length;
  const fail = (out.match(/^FAIL /gm) || []).length;
  const engineOK = /ALL CHECKS PASS/.test(out);
  totalPass += pass; totalFail += fail;
  const ok = fail === 0 && (pass > 0 || engineOK) && code === 0;
  results.push({ label, pass, fail, ok });
  console.log(`${ok ? '✓' : '✗'} ${label}: ${engineOK ? 'engine reconciles' : pass + ' pass, ' + fail + ' fail'}${code !== 0 && !ok ? ' (exit ' + code + ')' : ''}`);
  if (!ok) console.log(out.split('\n').filter(l => /^FAIL|Error|error:/.test(l)).slice(0, 6).map(l => '    ' + l).join('\n'));
  return ok;
}

console.log('=== Capacity Model Tool — full test battery ===\n');

// 1. engine reconciliation (no dependencies)
run('verify (engine vs workbook)', path.join(here, 'verify.js'));

// 2. UI suites (need jsdom)
let hasJsdom = false;
for (const p of [path.join(here, 'node_modules', 'jsdom'), 'jsdom', '/tmp/node_modules/jsdom']) {
  try { require.resolve(p); hasJsdom = true; break; } catch (e) { /* keep looking */ }
}
if (!hasJsdom) {
  console.log('\n! jsdom not found — skipping UI suites. Install with:  npm install jsdom  (run from the tests/ folder)');
} else {
  const smokeDir = path.join(here, 'smoke');
  fs.readdirSync(smokeDir).filter(f => f.endsWith('.js')).sort().forEach(f => run('smoke/' + f, path.join(smokeDir, f)));
  run('e2e_scenario (full journey)', path.join(here, 'e2e_scenario.js'));
}

console.log(`\n=== TOTAL: ${totalPass} pass, ${totalFail} fail across ${results.length} suites ===`);
const allOK = results.every(r => r.ok);
console.log(allOK ? 'ALL SUITES GREEN' : 'FAILURES — see above');
process.exit(allOK ? 0 : 1);
