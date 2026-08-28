/**
 * Headless runner for the same suite tests.html renders in the browser.
 * A convenience, not a build step — no dependencies, no npm.
 *
 *   node --experimental-default-type=module scripts/run-tests.mjs
 *
 * (The flag is needed only because the project has no package.json; the
 * browser loads the identical .js files as modules without it.)
 */

import { createRunner } from '../js/tests/assert.js';
import suite from '../js/tests/suite.js';

const { results, failed, passed, total } = createRunner().run(suite);

let group = null;
for (const r of results) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n  ${group}`);
  }
  if (!r.pass) console.log(`    FAIL  ${r.label}\n          ${r.detail}`);
}

console.log(`\n  ${passed}/${total} passed, ${failed.length} failed\n`);
process.exit(failed.length ? 1 : 0);
