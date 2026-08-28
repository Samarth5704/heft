# Heft

An expense manager where money has mass — the heavier the spend, the heavier the row.

![The Heft ledger: a month of expenses where each row's height, type size, ink density and rule thickness scale with the amount](docs/ledger.png)

**[Live demo →](https://samarth5704.github.io/heft/)** · No build step. No dependencies. Open the folder, serve it, done.

---

## Why the rows are different sizes

A normal expense list gives a ₹25 chai and a ₹32,000 rent the same visual weight, so you
read forty rows to find the two that mattered. Heft scales each row by its amount — height,
type size, ink density, rule thickness, and a spine at the left edge — so a month has a
shape you can see before you read a single digit. Peaks are rent, EMIs and flights. The
flat stretches are daily life.

Everything is text first. The topography is layered on top of a list that stays fully
readable: no amount ever renders below 15px, and the lightest ink still clears 4.5:1.

## Running it locally

ES modules will not load from `file://`, so it needs a server — any server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Click **Load sample data** for three months of plausible
Indian spending.

`python3 -m http.server` sends no cache headers, so while editing you may need a hard
reload to see changes. There is a no-cache version bundled for that:

```bash
python3 scripts/serve.py 8124
```

Nothing in the app depends on it. There is still no build step.

## Tests

417 assertions, no framework, no mocking. Open `tests.html` over HTTP for a pass/fail
list in the browser, or run the identical suite headlessly:

```bash
node --experimental-default-type=module scripts/run-tests.mjs
```

Covers money parsing and Indian digit grouping, date arithmetic across leap years and
month boundaries, every quick-add parser rule, the analytics, the weight scale's
degenerate cases, donut geometry, filters, storage migration, and import/export.

## Using it

Type into the line at the top and press Enter:

| You type | Heft records |
| --- | --- |
| `250 chai` | ₹250, today, Food & Dining, note "chai" |
| `chai 250` | the same — amount position is free |
| `1.2k rent` | ₹1,200, Rent & Bills |
| `1.5l deposit` | ₹1,50,000 |
| `swiggy 480 yesterday` | ₹480, yesterday, Food & Dining, note "swiggy" |
| `dmart 2400 23 jan` | ₹2,400, 23 January, Groceries |

A live preview under the input shows what it parsed before you commit it.

| Key | Does |
| --- | --- |
| <kbd>/</kbd> | Jump to the quick-add line |
| <kbd>Ctrl</kbd> <kbd>Enter</kbd> | Open the full form, keeping what you typed |
| <kbd>N</kbd> | Add an expense with the full form |
| <kbd>Ctrl</kbd> <kbd>Z</kbd> | Undo the delete you just made |
| <kbd>?</kbd> | Shortcuts and quick-add syntax |

Filters compose and live in the URL hash, so any view is a link you can keep:
`#month=2026-08&cat=food,transport&pay=upi&q=uber`.

---

## Design notes

### The percentile-log weight scale

This is the whole project, so it is worth being precise about.

Linear scaling fails immediately. Rent is roughly 400× a chai, so on a linear ramp
everything that is not rent collapses into the same invisible weight — you get one tall
row and thirty-nine identical stubs. Scaling by rank instead throws away magnitude: a
₹300 lunch and a ₹3,000 flight look one step apart.

So each amount is mapped **logarithmically** onto `[0, 1]` between the **5th and 95th
percentile of the currently visible set**, then clamped:

```
t = (log(amount) − log(p5)) / (log(p95) − log(p5))
```

Percentile bounds rather than min/max mean a single ₹80,000 outlier cannot crush the rest
of the list into nothing. Clamping rather than extending means that outlier still reads as
the heaviest thing on screen. Empty sets, a single expense, and all-identical amounts all
resolve to `t = 0.5` — a middle weight, never a division by zero.

Because the bounds come from the **visible** set, the topography re-normalises on every
filter change. Filter to Food & Dining and the scale rebuilds inside that category, so a
₹73 samosa run and a ₹360 Swiggy order become clearly different rows instead of both
flattening at the bottom. Measured on the sample data:

| Expense | `t` across the whole month | `t` within Food & Dining |
| --- | --- | --- |
| Chai and vada, ₹26 | 0.000 | 0.000 |
| Samosa run, ₹73 | 0.187 | 0.386 |
| Swiggy, ₹360 | 0.578 | 1.000 |

**JavaScript sets exactly one number per row** — `style="--t: 0.386"` — and touches nothing
else. Row padding, amount size, font weight, tracking, ink colour, rule thickness and
spine height are all interpolated in CSS with `calc()` and `color-mix()`. The two ends of
every ramp live together in `css/tokens.css`; changing the feel of the entire ledger is a
two-line edit that no JavaScript needs to know about.

### Money is an integer number of paise

`0.1 + 0.2 !== 0.3`, and that error compounds. Summing a few hundred float rupees drifts
by amounts that are individually invisible and collectively wrong — and a ledger that
disagrees with itself is worthless.

So money is only ever an integer. `toPaise()` parses at the boundary, all arithmetic is
integer, and `formatINR()` formats at the render boundary. Nothing in between sees a
decimal point. There is a test that sums 1,000 random amounts and checks the result
against a `BigInt` ground truth.

Formatting goes through `Intl.NumberFormat('en-IN', …)` because Indian grouping is not
Western grouping: ₹1,50,000 and ₹1,00,00,000, not ₹150,000 and ₹10,000,000. Hand-rolled
comma insertion gets lakhs and crores wrong almost every time.

### Dates are `'YYYY-MM-DD'` strings, never `Date` objects

An expense happens on a **calendar day**, not at an instant. The moment you store a
timestamp you have signed up for timezone and DST arithmetic in every comparison, and you
get expenses that jump to the previous day for anyone east of you.

So a date is a string. The helpers in `lib/dates.js` are pure string-in / string-out, and
ISO strings sort lexicographically in chronological order, which makes ordering free.
`Date` appears in exactly two places: reading today's clock (normalised to a string
immediately), and UTC arithmetic for adding days — UTC because it has no DST, so adding
86,400,000 ms is always exactly one day.

### Mean and median, side by side

Almost no expense tracker shows you both, and the gap between them is the most useful
number in the app.

Your mean daily spend is dragged upward by rent, EMIs and the occasional flight. It
answers "what does a month divided by thirty look like", which is a question nobody asks.
The median ignores the outliers and answers the question you actually have: **what does an
ordinary day cost me?**

On the sample month those are ₹2,260 and ₹795. The mean is nearly three times the median,
and that ratio is itself the insight — it tells you your spending is dominated by a few
large fixed costs rather than by daily habits. Both numbers are shown together with one
line of copy explaining why they differ.

The denominator is *days elapsed*, not *days with an expense*. A day you spent nothing on
is a real day, and dropping it flatters both figures.

### Budget pace, defined exactly

"You have spent 60% of your budget" is useless on the 3rd and alarming on the 28th. So
budgets are compared against the calendar:

```
expectedSpend = budget × (daysElapsed / daysInMonth)
```

`daysElapsed` counts today. Being ahead of pace means spending faster than the month is
passing. Within 2% of the budget either way counts as on track — a band, not a knife edge.
The bar carries a tick showing where you should be today, so pace is visible and not only
asserted. For a **past** month pace is meaningless, so it reports the result instead:
"Finished ₹9,502 over budget".

The overall row compares budgeted spend against budgeted money — not the whole month
against a plan that only covers part of it, which would guarantee an overrun. Spending
outside any budget gets its own line, and the two add up to the month total exactly.

### A few smaller decisions

- **Quick-add: a category name is consumed from the note, a synonym is not.** `480 food`
  leaves no note. `swiggy 480` files under Food & Dining but keeps "swiggy" — the synonym
  is what you spent it on, and losing it loses the only description you typed.
- **A bare `23 dec` typed in August means last December.** An expense you are logging has
  already happened, so the parser picks the most recent occurrence that is not in the future.
- **Deleting removes the row immediately** and keeps the record in memory for eight
  seconds. An undo that leaves the row on screen is a confirmation dialog, not an undo.
- **View Transitions are used for month changes only.** For filter changes the point is
  watching the rows re-weight in place, which a cross-fade snapshot would hide.
- **`null` budget ≠ `0` budget.** Blank means untracked; zero means you intend to spend
  nothing there. They are stored and displayed differently.
- **Deleting a category can never orphan its expenses.** It always asks first: move them
  somewhere, or delete them along with it.

## How it is put together

```
index.html          tests.html
css/    reset  tokens  layout  ledger  charts  budgets  forms
js/
  main.js           wiring only: the URL hash, the theme attribute, focus
  store.js          the only thing that mutates state or touches localStorage
  lib/              zero DOM, zero globals, zero clock reads — all pure
    money  dates  parse  analytics  geometry  filters  storage  transfer  sample-data
  ui/               read from the store, render
    ledger  quick-add  expense-form  charts  budgets  categories  data  announcer
  tests/            assert.js (30 lines) + suite.js
scripts/            run-tests.mjs   serve.py
```

Three rules hold the thing together: `lib/` is pure and therefore testable without mocks;
every mutation goes through the store, which notifies subscribers; and the ledger
**reconciles** rather than re-rendering — rows are cloned once from a `<template>`, kept in
a `Map` keyed by expense id, and updated field by field. Re-rendering a list with
`innerHTML` destroys focus, kills text selection and thrashes layout.

All charts and all icons are hand-written inline SVG. Each chart carries `role="img"`, an
accessible name built from its title and a one-sentence takeaway ("Rent & Bills was your
largest at ₹35,494, 56% of the month"), and a visually-hidden table of the same numbers.

Storage is versioned. `migrate()` upgrades old payloads forward and refuses anything from a
newer version rather than corrupting it. Only one schema version has ever shipped; the seam
exists so the second one is not an emergency.

## Accessibility

Full keyboard operation with designed focus rings. The ledger is a real list of real list
items with real buttons, labelled in context ("Delete ₹250, chai, 12 August") rather than
forty identical "Delete"s. Dialogs trap focus, close on Escape and return focus to their
trigger. Undo announces politely and is keyboard-reachable before it times out. Category
colours are chosen for lightness spread as much as hue — minimum pairwise separation under
simulated protanopia, deuteranopia and tritanopia is ΔE 9.0 in light and 8.7 in dark — and
are always paired with a text label. All motion is disabled under
`prefers-reduced-motion: reduce`.

## Deliberately not built

No backend, database, accounts or sync — your data is in your browser and nowhere else.
No npm, bundler or transpiler. No charting, date or utility library. No group expenses or
splitting, no bank import, no recurring expenses, no multi-currency. And no floats for
money, ever.

Modern evergreen browsers only. It uses ES modules, `@layer`, `:has()`, `color-mix()`,
`<dialog>` and the View Transitions API without polyfills.
