# Heft — working rules

An expense manager where money has mass. Single user, offline, INR, no accounts.

## Tech stack — hard constraint

HTML, CSS and JavaScript only. **No build step, no bundler, no npm, no framework, no
CSS framework, no charting library, no date library, no polyfills, no ES5.** The site
runs from a static server with zero compilation. The only permitted external resource is
a Google Fonts `<link>`.

Modern browser features are used freely: ES modules, CSS custom properties, `@layer`,
container queries, `:has()`, `color-mix()`, `clamp()`, `<dialog>`, View Transitions.
All icons and all charts are hand-written inline SVG.

Local run: `python3 -m http.server` from the repo root. ES modules will not load from
`file://`.

## Non-negotiable technical rules

1. **Money is an integer number of paise. Never a float.** Parse to integer paise on
   entry (`toPaise`), do all arithmetic in paise, format only at the render boundary
   (`formatINR`). Both live in `js/lib/money.js` and are used everywhere.
2. **Format with `Intl.NumberFormat('en-IN', …)`** so grouping is ₹1,50,000, not
   ₹150,000. Never hand-roll comma insertion.
3. **Dates are `YYYY-MM-DD` local-date strings.** Never `Date` objects, never
   timestamps. An expense happened on a calendar day, not at an instant. `Date` appears
   only inside `dates.js` — for "what is today" and for UTC day arithmetic.
4. **Never re-render the list with `innerHTML`.** Build rows from a `<template>`, keep
   node references keyed by expense id, reconcile: create, remove, update changed fields
   only. Batch DOM writes; never interleave reads and writes.
5. **Every mutation goes through `js/store.js`** with subscribe/notify. No component
   writes to `localStorage` and no component mutates another's DOM.
6. **Persist on a debounced write.** Handle `QuotaExceededError` explicitly with a
   visible message, never a silent failure.
7. **`js/lib/` contains zero DOM access and zero global state.** Pure functions taking
   their inputs explicitly — including "today". That is what makes them testable without
   mocking.

## The weight scale — the architectural rule of this project

JavaScript computes **exactly one number per row**, `--t` in `[0,1]`, and touches nothing
else. All visual scaling — row padding, font size, font weight, ink colour via
`color-mix()`, rule thickness, spine height — is interpolated in CSS with `calc()`.

`t` comes from `weightScale()` in `js/lib/analytics.js`: the 5th and 95th percentile of
the **currently visible** (post-filter) amounts, mapped **logarithmically** and clamped.
Linear scaling fails — rent is 400× a chai, so everything but rent collapses to
invisible. Percentile bounds stop one outlier crushing the list; clamping keeps the
outlier the heaviest thing on screen. Empty set, a single expense, and all-identical
amounts all resolve to `t = 0.5`, never a division by zero.

Recompute on every filter change: the topography re-normalises, so filtering to one
category makes small differences inside it legible.

## Accessibility — do not skip or simplify

- **Visual weight is never the only signal.** Every amount is readable text; scaled font
  size never drops below ~13px; the lightest ink still meets 4.5:1.
- Every chart has a visually-hidden `<table>` with the same data plus a one-sentence
  plain-language takeaway. `role="img"` and an accessible name on meaningful SVG,
  `aria-hidden="true"` on decorative SVG.
- The ledger is a `<ul>` of `<li>`. Row actions are real `<button>`s with contextual
  names ("Delete ₹250, chai, 12 August"), never forty bare "Delete"s.
- `<dialog>` traps focus, closes on Escape, restores focus to the trigger.
- Undo after delete announces via `aria-live="polite"` and is keyboard-reachable
  **before it times out**.
- `/` focuses quick-add; shortcuts are documented in a help dialog.
- Category colours are colourblind-safe and always paired with a text label.
- `<time datetime="…">` for dates. `font-variant-numeric: tabular-nums` on every number.
- All motion is disabled under `prefers-reduced-motion: reduce`.

## Forbidden aesthetics

No default purple-to-blue gradient. No glassmorphism. No centered white card on
light-gray. No emoji as icons. No uniform `box-shadow: 0 4px 6px rgba(0,0,0,0.1)` on
every element. No card with a coloured left border for every category. Shadows are soft
and warm-tinted, never neutral gray, with a consistent light direction. Empty states are
drawn and written, not "No data".

If the result is indistinguishable from a Bootstrap admin template, it is wrong.

## Out of scope — do not build

No backend, database, auth, accounts or sync. No npm, bundler or transpiler. No
charting, date or utility library. No group expenses or splitting. No bank/CSV import.
No recurring expenses. No multi-currency. No floats for money, ever.

## Testing

`tests.html` served over HTTP runs the whole suite in the browser and renders a
pass/fail list. The suite lives in `js/tests/suite.js` and the ~30-line assertion helper
in `js/tests/assert.js`, so the identical suite also runs headlessly:

```bash
node --experimental-default-type=module scripts/run-tests.mjs
```

Every parser rule, every money edge case, and every degenerate case of the weight scale
has a test. Keep it green before writing UI.
