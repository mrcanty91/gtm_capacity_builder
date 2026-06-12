/* Reconciliation test — run `node tests/verify.js` after any engine change.
   Asserts the web engine reproduces the source workbook (Base scenario). */
const E = require('../js/engine.js');

const r = E.compute(E.defaultModel());
const t = r.summary.totals;
let fail = 0;
const check = (name, got, want, tol = 0.5) => {
  const ok = Math.abs(got - want) <= tol;
  console.log((ok ? 'PASS' : 'FAIL'), name, '| got', Number(got.toFixed(2)), '| want', want);
  if (!ok) fail++;
};

check('24-mo GTM run-cost', t.cost, 9812091.60);
check('24-mo total revenue', t.revenue, 11250000);
check('24-mo booked', t.booked, 10500000);
check('24-mo expansion', t.expansion, 750000);
check('Ending headcount', t.endingHeadcount, 26, 0);
check('Ending ARR', t.endingARR, 17138618.35);
check('Final CAC ratio', t.finalCAC, 0.7472, 0.001);

const teamWant = { 'Sales (AE)': 4732040.77, 'SDR / BDR': 499280.50, 'Marketing': 1366344.30, 'Partnerships': 1248145.83, 'Customer Success': 1447817.59, 'Account Management': 518462.61 };
r.teams.forEach(tm => { if (teamWant[tm.name] != null) check(tm.name + ' cost', tm.cost.reduce((a, b) => a + b, 0), teamWant[tm.name]); });

const rates = E.blendedRates(E.defaultModel());
check('Blended AE rate', rates['Account Executive'], 325808.39, 0.01);
check('Blended SDR rate', rates['SDR'], 62071.23, 0.01);
check('Blended AM rate', rates['Account Manager'], 185859.66, 0.01);

// structural resilience
const m36 = E.defaultModel(); m36.config.horizon = 36; m36.config.annualTargets = [6e6, 9e6, 12e6];
const r36 = E.compute(m36);
check('36-mo horizon computes', r36.H, 36, 0);

const mNoP = E.defaultModel(); mNoP.teams = mNoP.teams.filter(x => x.id !== 'partnerships');
const rNoP = E.compute(mNoP);
check('Team removal computes', rNoP.teams.length, 5, 0);
const orphan = rNoP.checks.some(c => c.title.includes('no team generating'));
console.log((orphan ? 'PASS' : 'FAIL'), 'Orphan channel flagged on team removal'); if (!orphan) fail++;

console.log(fail === 0 ? '\nALL CHECKS PASS — engine matches the workbook.' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
