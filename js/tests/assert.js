/** A 30-line assertion helper. No dependencies, no mocking, no framework. */

const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

export function createRunner() {
  const results = [];
  let group = 'ungrouped';
  const push = (pass, label, detail) => results.push({ group, pass, label, detail });

  const t = {
    group(name) { group = name; },
    ok(value, label) {
      push(Boolean(value), label, value ? '' : `expected truthy, got ${show(value)}`);
    },
    eq(actual, expected, label) {
      const pass = Object.is(actual, expected) || actual === expected;
      push(pass, label, pass ? '' : `expected ${show(expected)}, got ${show(actual)}`);
    },
    deepEq(actual, expected, label) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      push(a === b, label, a === b ? '' : `expected ${b}, got ${a}`);
    },
    throws(fn, label) {
      try { fn(); push(false, label, 'expected a throw'); } catch { push(true, label, ''); }
    },
  };

  return {
    t,
    results,
    run(suite) {
      try {
        suite(t);
      } catch (err) {
        push(false, 'suite threw before finishing', err && err.stack ? err.stack : String(err));
      }
      const failed = results.filter((r) => !r.pass);
      return { results, failed, passed: results.length - failed.length, total: results.length };
    },
  };
}
