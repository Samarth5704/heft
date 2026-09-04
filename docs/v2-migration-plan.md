# Migration plan: Heft v1 → v2 (MyMoney interaction model)

## A. Gap analysis

**Records tab (screenshot 1)**

| | |
|---|---|
| **Exists** | `ui/ledger.js` — reconciling keyed renderer, day grouping via `analytics.groupByDay`, day headers with per-day totals, `formatRelativeDay` for "Today/Yesterday". Month stepper: `main.js:stepMonth` + `#month-bar`, sticky. Filters bar. `analytics.monthDelta` for the header figure. |
| **Reshape** | The month header shows **one** total; needs the Expense / Income / Total triad. `ledger.js:updateRow` renders category + payment method; needs account name and a circular category icon (`Category.icon` exists in the schema and is **never rendered** — we draw a 0.5rem dot). `ledger.js:describe` builds "Delete ₹250, chai, 12 August" with no direction — needs "Income ₹200…". Our weight scale is the visual identity and MyMoney has none; keep it, but see E5. |
| **New** | Income rows, transfer rows, per-row account label, category icon glyphs (we have 9 named icons in `SEED_CATEGORIES`, no artwork for any of them), FAB. |

**Analysis tab (screenshot 2)** — closest to done. `ui/charts.js:categoryPanel` already draws the donut with real trigonometry, a legend with amounts and percentages, and the full-circle case. **Reshape:** the donut must exclude income and transfers (currently `byCategory` over everything); the ranked list needs proportional bars — reuse `.budget-track`/`.budget-fill` from `budgets.css`. **New:** the EXPENSE OVERVIEW ⌄ switcher (expense vs income view). Note we already exceed the screenshot here: daily bars, 30-day trend, 6-month comparison, mean-vs-median, top five.

**Budgets tab (screenshot 3)** — we are ahead on maths and behind on structure. `analytics.budgetReport` + `pace` already give pace, projection, and the budgeted/unbudgeted split; MyMoney shows neither pace nor projection. **Reshape:** `budgetReport` returns one aggregate unbudgeted row; screenshot 3 wants an itemised "Not budgeted this month" list with a per-row SET BUDGET. **New, and it is a schema change:** MyMoney budgets are **per month** ("no budget is applied for this month", "copy from past months"). Ours live on `Category.budgetPaise` — one value applied to every month forever. See B.

> Worth noting: screenshot 3 shows `TOTAL SPENT ₹0.00` in a month where ₹7,218 was spent. That is MyMoney meaning "spent inside budgets" and saying "spent". We already fixed this exact class of bug in Phase 5 — our overall row compares budgeted spend against budgeted money and the unbudgeted total is separate. Keep our version.

**Accounts tab (screenshot 4)** — **entirely new.** Nothing in the codebase models an account. The nearest thing is `Expense.paymentMethod: 'cash'|'upi'|'card'` (`storage.PAYMENT_METHODS`), which is a label, not a balance-bearing entity.

> Screenshot 4 does not reconcile: All Accounts ₹26,149 with lifetime expense ₹27,787 and income ₹23,836 (net −₹3,951). The gap is opening balances. This is exactly why the invariant says balances are derived from opening balance + transactions.

**Categories tab (screenshot 5)** — `ui/categories.js` already does rename, recolour, add, and remove-with-reassign-or-delete, plus `storage.canDeleteCategory` / `reassignExpenses` / `dropExpensesIn`. **Reshape:** one flat list → two lists; `Category` needs a `kind`. **New:** icon picker.

**Display options dialog (screenshot 6)** — **mostly new.** We have a month stepper and `filters.month` ∈ `'all' | 'YYYY-MM'`. Needed: a period model (daily/weekly/monthly/3/6/yearly), show-total toggle, and carry-over. Carry-over is not a display toggle — it is a computation that changes every number below it. `filters.js:parseFilterHash` / `filtersToHash` change shape, which breaks existing v1 bookmarks.

**Navigation drawer (screenshot 7)** — `ui/data.js` already implements Export (Blob + revoked object URL), Import (preview + merge/replace), and Delete-all (typed confirmation), in the `#data` section. **Reshape:** move into a drawer. **New:** a Preferences screen (theme, week start, default account, default category), and "Export Report" — note that is a *report*, distinct from our JSON backup, and CSV **import** stays out of scope per CLAUDE.md.

**Flaws to fix, not copy.** The FAB occludes content on four of the seven screenshots — the Fuel percentage in #2, the Entertainment amount in #1, a SET BUDGET button in #3. That is now the last line of CLAUDE.md. Income in #1 is encoded by colour and colour alone (expenses get a `−`, income gets no `+`); our invariant requires a sign, label, or icon. And no chart in #2 has a text alternative.

---

## B. Data model delta

> **Budgets superseded, 31 August 2026.** `budgetPaise` has now left
> `Category` as sketched below, in schema v3 — see the step 5/7/8 note at the
> end of F for the shape that shipped and for how a monthly budget is read
> over a period that is not a month.
>
> **Superseded in part, 30 August 2026.** The shipped schema splits the two
> fields differently from the sketch below: `kind` is `'transaction' |
> 'transfer'` and `direction` is `'expense' | 'income'`, so "is this a
> transfer" and "which way does the money go" are two independent questions
> rather than three values in one field. `analytics.isExpense` / `isIncome` /
> `isTransfer` are the predicates to use; nothing should test `kind` against
> `'expense'`. Three smaller divergences: `Account` names its type field
> `type`, not `kind`, so it does not collide with a transaction's; `Settings`
> carries `defaultExpenseCategoryId` and `defaultIncomeCategoryId` rather than
> one `defaultCategoryId`, because the sink differs per direction; and
> ~~**`budgetPaise` has *not* yet left `Category`**~~ — done in v3, above.
> Positive amounts, one record per transfer, and derived balances all shipped
> as written.

```
Transaction {
  id, kind: 'expense' | 'income' | 'transfer',
  direction: 'out' | 'in',        // 'out' for expense AND transfer (from accountId)
  amountPaise: positive integer,  // never signed
  date: 'YYYY-MM-DD', note, createdAt,
  accountId,                      // source for expense/transfer, destination for income
  toAccountId,                    // transfers only, else null
  categoryId,                     // expense/income only, null for transfers
}

Account { id, name, kind: 'cash'|'bank'|'card'|'wallet',
          openingBalancePaise: integer (may be negative),
          colorToken, icon, archived: boolean, createdAt }

Category { id, name, kind: 'expense'|'income', colorToken, icon }   // budgetPaise removed

budgets: { 'YYYY-MM': { categoryId: amountPaise } }   // absent = untracked ≠ 0

Settings { theme, weekStartsOn, defaultCategoryId, defaultAccountId,
           viewMode, showTotal, carryOver, schemaVersion }
```

Two decisions worth your sign-off: **a transfer is one record, not two legs** — two legs double the ids, double the delete/undo surface, and make "any total including a transfer is a bug" harder to enforce; balance derivation reads `accountId` and `toAccountId` explicitly instead. And **`budgetPaise` leaves `Category`** for a per-month map, because screenshot 3 requires it.

### Functions whose assumptions break

**`lib/analytics.js` — the blast radius.**

| Function | How it breaks |
|---|---|
| `totalPaise(expenses)` | Sums `amountPaise` over whatever it is given. With mixed kinds it silently adds income and transfers into an expense total. **The single most dangerous function in the codebase.** |
| `byCategory` | Buckets by `categoryId` regardless of kind; transfers have `categoryId: null` and would bucket under `undefined`; income categories land in the expense donut. |
| `byPaymentMethod` | Superseded by `byAccount`. |
| `dailyTotals`, `dailyTotalsBetween` | Sum all kinds per day → the ledger's day-header total and the daily bar chart both include income and transfers. |
| `groupByDay` | Structure survives; its per-day `totalPaise` is wrong for the same reason. |
| `topExpenses` | Sorts by `amountPaise` across all kinds — a ₹50,000 salary becomes your biggest "expense". |
| `dailySpendStats` | Denominator (days elapsed) fine; numerator wrong. |
| `monthOverMonth`, `monthDelta`, `weekendSkew` | Totals include income and transfers. |
| `budgetReport` | `spentBy` comes from `byCategory` (kind-blind), and `budgetPaise` now comes from the budgets map, not `cat.budgetPaise`. |
| `weightScale` | Survives, but see E5 — the *input* must be expense magnitudes only. |
| `pace`, `projectMonthEnd`, `daysElapsed`, `mean`, `median`, `rollingAverage`, `percentile`, `niceTicks` | **Kind-agnostic. Survive untouched.** |

**`lib/storage.js`** — `validateExpense` rejects `amountPaise <= 0` (keep; now load-bearing) but has no `kind`/`accountId` validation and forces `categoryId` to `'other'`, which is wrong for transfers. `canDeleteCategory` protects `'other'` — income needs an equivalent sink. **`normalise()` is the trap: it rebuilds each record field by field and silently drops anything it does not know about.** If it runs before it is v2-aware, it will strip `kind`, `accountId` and `toAccountId` from perfectly good data and you will not get an error.

**`lib/filters.js`** — `applyFilters` has no kind or account predicate; `methods` keys off `paymentMethod` and becomes `accountIds`; hash keys change (`pay=` → `acct=`), breaking saved v1 links.

**`lib/transfer.js`** — **name collision.** The module is about backup/restore; "transfer" now means an account-to-account transaction. Rename to `lib/backup.js` before anything else. `mergeStates` dedupes expenses and categories only — needs accounts and budgets or an import silently loses them.

**`lib/parse.js`** — `buildCategoryIndex` will index income categories, so an expense-context parse could match "salary". Needs kind scoping, plus a way to express kind (`+5000 salary`, `2000 idfc > cash`). `SYNONYMS` maps to expense ids only.

**`js/store.js`** — `addExpense`/`updateExpense`/`deleteExpense` rename and gain kind/account validation; `deleteCategory`'s reassign target `'other'` assumes expense kind; `loadSampleData`, `clearAll`, `importState` all need widening. **New and non-optional:** account CRUD with the same never-orphan rule we built for categories — deleting an account holding transactions must force reassign-or-delete.

---

## C. Migration path

Add `migrateV1toV2` beside `migrateV0toV1`; `migrate()` chains v0→v1→v2. **Make `normalise()` v2-aware first** — it runs at the end of every migration and will otherwise strip the fields you just added.

- Every v1 expense → `kind:'expense'`, `direction:'out'`, `toAccountId:null`; `amountPaise`, `date`, `categoryId`, `note`, `createdAt` unchanged.
- **Default account:** create one account per `paymentMethod` actually present in the data (Cash / UPI / Card), plus `Unassigned` for expenses with no method, and map each expense to its own. Flattening everything to a single "Cash" throws away information the v1 data genuinely has. `settings.defaultAccountId` = the most-used one. All opening balances 0, which makes every balance negative — the Accounts tab should say so and prompt for an opening balance rather than pretend.
- All v1 categories → `kind:'expense'`. Seed the eight income categories from screenshot 5, checking ids against `makeCategoryId` so a user's "Returns" expense category cannot collide.
- **Budgets:** a v1 `Category.budgetPaise` applies to *every* month. Writing it into every past month invents history you never set. Recommendation: write it into the **current month only**, and keep the value as `Category.defaultBudgetPaise` to prefill the new copy-from-past-month affordance. Flag it in the UI once, so the change is visible rather than silent.
- **A v1 export file imported into v2** flows through `readImport` → `migrate()` → chains to v2 and works, gaining the derived accounts. Needs a test with a real v1 file fixture.
- **A v2 file imported into the deployed v1 build** hits `version > CURRENT_SCHEMA_VERSION` → refused as `future-schema`, data untouched. Already correct, already tested.
- **Keep `STORAGE_KEY = 'heft:v1'`.** It is a storage key, not a version marker; changing it strands every existing user's data behind a key nothing reads.

---

## D. What survives

**Untouched, zero edits — ~135 assertions:**

- `lib/money.js` (37) — and `toPaise` rejecting negatives becomes load-bearing for the positive-amount invariant.
- `lib/dates.js` (43) — the entire period model builds on `addMonths`/`datesInMonth`/`compare`.
- `lib/geometry.js` (35) — donut and line maths are kind-blind.
- `weightScale`, `percentile`, `niceTicks` (20).
- `ui/announcer.js`, `css/reset.css`, the test harness (`js/tests/assert.js`, `tests.html`, `scripts/`).

**Survives with new fixtures, logic intact — ~100 assertions:** `pace`, `projectMonthEnd`, `daysElapsed`, `mean`, `median`, `rollingAverage`; the parser's amount, suffix, date and category-precedence rules (65) — the tokenizer is sound, it only needs new token classes; the category delete-without-orphaning tests (19), which become the template for accounts.

**Architecture that survives even where code changes:** the reconciling renderer in `ui/ledger.js`, the store's subscribe/notify contract, the panel + hidden-table pattern in `ui/charts.js`, and `css/tokens.css` (add account colour tokens and semantic income/expense tokens; the weight interpolation is untouched).

**Genuinely rewritten:** `filters.applyFilters`, `storage.validateExpense`, `analytics`' aggregation family, `sample-data.js`, and `transfer.js` (renamed and widened).

Rough split of the 417: ~135 verbatim, ~100 fixture-only changes, ~180 reworked.

---

## E. Five places most likely to be silently wrong

1. **`totalPaise` over mixed kinds.** Every month total, day header, chart axis and budget figure flows through it. A wrong answer here looks entirely plausible. *Test:* make the aggregation entry point require an explicit kind, then assert that adding one income and one transfer to a ledger leaves the expense total **bit-identical** to the expense-only ledger. Do the same for the day-header total, the donut, the daily bars and `topExpenses` — one test each, because they fail independently.

2. **Transfers double-counted in balances or net worth.** *Test:* a property test — for a random ledger and a random transfer between two accounts, `netWorth` must be unchanged, while both account balances must move by exactly ±the amount. Also assert no month total anywhere changes when a transfer is added.

3. **Budget "spent" polluted by income.** A refund filed as income in a same-named category must not reduce expense spend, and a negative amount must be impossible to store at all. *Test:* `budgetReport` spent for a category equals the sum of `kind:'expense'` only; a v2 record with a negative `amountPaise` is rejected by `validateTransaction`.

4. **Carry-over.** Surplus = income − expense for a month, added to the next; it compounds, months with no data must not break the chain, and transfers must not enter it. *Test:* over N months, the sum of monthly surpluses with carry-over on must equal the lifetime surplus computed independently; inserting a transfer must change nothing anywhere in that chain.

5. **The weight scale fed mixed kinds.** One ₹50,000 salary in the visible set moves p95 and flattens every expense row into invisibility — the exact failure the percentile-log scale exists to prevent. *Test:* assert that adding an income record to the ledger leaves every expense row's `--t` unchanged to three decimals. Then decide deliberately what weight income and transfer rows get (I would scale income on its own independent scale and give transfers a fixed neutral weight).

Sixth, briefly: **opening balances counted twice** — once as the opening figure and once as a synthetic transaction. Test that `balance(account)` with zero transactions equals exactly `openingBalancePaise`.

---

## F. Sequencing

Everything that can produce a silently wrong number is built and tested before any pixel moves.

| # | Step | Verifiable by |
|---|---|---|
| 0 | Rename `lib/transfer.js` → `lib/backup.js` | 417/417 still green; pure rename |
| 1 | v2 schema, `validateTransaction`, accounts, budgets map, `migrateV1toV2`, v2-aware `normalise` — **no UI** | New v1→v2 tests incl. a real v1 export fixture; the running v1 app still loads because migrate upgrades on read |
| 2 | Kind-aware analytics; every aggregation entry point takes an explicit kind | Tests, **plus** the running app shows numbers identical to today on expense-only data — the regression check that migration changed nothing visible |
| 3 | Account balances + net worth (still no Accounts tab) | The E2 and E6 invariants under random transfers |
| 4 | Records tab: Expense/Income/Total triad, income and transfer rows, account label, FAB with the bottom-padding invariant | Browser — **done, gate re-run below** |
| 5 | Accounts tab | Browser + balance invariants |
| 6 | Analysis tab: expense/income switch, proportional bars | Browser + hidden-table equivalence |
| 7 | Per-month budgets + copy-from-past-month | Tests for the budgets map, then browser |
| 8 | Categories split by kind + icon picker | Browser |
| 9 | Display options: period model, show-total, carry-over | Carry-over tests **first** (E4), then browser. Last because the period model multiplies the surface of every aggregation |
| 10 | Drawer, Preferences, Export Report | Browser — **done, see below** |

**Progress, 30 August 2026.** Steps 0–3 landed in `c56ddb5`, along with the
period model and carry-over that step 9 needs. Step 4 landed on 30 August,
and the Records tab was built out on the new shell the same day — ledger,
filters, detail sheet, undo, empty states, the three quick-add kinds, and the
Display options sheet, which took step 9's period model and carry-over with
it. Steps 5–8 and 10 are open.

Two vocabulary breaks were found and closed while wiring it up, both of the
kind that fail silently rather than loudly:

- `router.VIEW_MODES` named `quarterly` / `halfyearly` while `dates.js` named
  `3-month` / `6-month`. A route carrying either of the router's names
  produced a null range from `periodRange` and would have emptied the pane
  with no error. The router now names the same six modes `dates.js` does, and
  a test asserts the two lists are identical rather than merely compatible.
- The seed categories pointed at sprite icon names (`bowl`, `basket`,
  `roof`…) that the icon registry does not define, and at colour tokens
  (`cat-neutral`, `inc-*`, `acct-*`) that `tokens.css` does not define. Every
  seed category would have drawn the fallback glyph on a transparent disc.
  Seeds now use registry names, `--cat-neutral` is defined and measured in
  both themes, and the accounts palette aliases the hues already checked.

The route's `period` also widened from `YYYY-MM` to accept `YYYY-MM-DD`,
because daily and weekly have to say which day. `anchorOf` collapses both
forms to the date `periodRange` wants and `periodFor` decides which form a
mode writes back, so the URL stays short for the modes that do not need a day.

**Step 4's gate, re-run against the running app on the new shell.** Sample
data, three months, 299 records:

- adding a ₹9,999 transfer moves the expense figure, the income figure and
  every day-header net by exactly nothing (E2);
- adding a ₹90,000 income moves the income figure and leaves the expense
  total and every visible expense row's `--t` unchanged (E1, E5);
- carry-over on reports a total that matches an independently computed net of
  everything before the period start, to the paise (E4);
- the reconciler holds: 100 rows monthly, 8 daily, 299 yearly, with no
  accumulation across mode switches — the inflated counts seen mid-switch are
  rows still animating out;
- at the bottom of the scroll the last row ends above the FAB, so the
  clearance invariant holds rather than being asserted.

**Known breakage.** `legacy.html` → `js/main.js` still calls
`createLedger({onEdit, onDelete})` and reads the old row template. The
renderer now takes `onOpen` and builds the reference's row anatomy, so the v1
page's ledger no longer runs. Keeping one renderer answering to two row
designs is worse than retiring the page it was written for; `legacy.html` and
`js/main.js` should go when steps 5–10 have taken the rest of their panes.

That commit shipped the whole data layer without touching `js/ui/`, which left
the app throwing on boot for the duration — so **step 2's verification gate was
never run at the time**. It has now been run as part of step 4, against the
running app rather than only the suite:

- adding a ₹90,000 income leaves the expense total, every day-header total and
  the ledger's "spent" figure bit-identical (E1), and leaves all 95 visible
  expense rows' `--t` unchanged to three decimals (E5);
- deleting a transfer changes no total anywhere (E2);
- filtering to income and transfers alone reports `₹0 spent`.

The lesson for steps 5–10: a step whose verification says "the running app
shows…" cannot be marked done while the UI for it does not run. Land the view
alongside the logic, or record the gate as outstanding.

**Step 6 landed, 31 August 2026 — the Analysis tab.** Four panels under one
switch: the donut with its ranked list, daily bars with a trailing average,
six periods, and mean vs median. The switch is expense / income / **net**, and
it lives in the URL as `view=`, so `#/analysis?view=net&mode=yearly` is a
linkable screen. Three things the step added that were not in the sketch:

- `lib/chart.js`, the shaping layer between `analytics` and the SVG. Small
  slices fold into "Other" (below 3%, or past seven, and never a tail of one);
  a surviving slice is floored to a legible arc by taking the sliver from the
  slices above it, total preserved; a period longer than 62 days is bucketed
  into weeks rather than drawn as 365 pickets. All pure, all tested — 40 new
  assertions, 866 in total.
- `analytics.viewAmount`, the one place the transfer rule now lives for every
  series. `dailyTotals`, `dailyTotalsBetween` and `dailySpendStatsForRange`
  take a view and default to expense, so no existing caller changed meaning.
- `ui/choice.js`: the radiogroup behaviour the two sheets already had, lifted
  out so the view switch is the same control rather than a third copy of it.

Step 6's gate, run against the running app on 297 sample records:

- adding a ₹1,234 expense from the FAB while the Analysis tab is showing
  repaints every panel through the store's subscription — total and every
  share recomputed, no second rendering path;
- the hidden table under each chart resolves through `aria-describedby`, and
  the donut's table lists **all seven** categories where the ring draws six:
  the grouping is a drawing decision and a reader who cannot see the drawing
  does not inherit it;
- a transfer and an income move nothing in the expense view's ring, bars,
  six-period series or day-cost figures (E1, E2), which is now asserted in the
  suite against the series themselves rather than only the ledger;
- both themes, and the light theme is where the slice ramp is most visible;
- the empty period is drawn and written, not four empty panels.

One real bug this found, worth recording because it is the same failure the
view-transition watchdog in `app.js` was written for: the draw-in animations
were first written with `backwards` fill and a per-mark delay, which makes a
mark's *resting* state invisible until its animation runs. In a document that
is not producing frames — hidden, throttled, driven headlessly — it never
runs, and the charts render blank rather than merely undecorated. Motion may
decorate a drawing; it may never be the thing that makes it appear.

The two questions this section originally left open — the FAB, and the CLAUDE.md
"accounts" wording — are now settled. See G.

**Steps 5, 7 and 8 landed, 31 August 2026 — the last three tabs.** Budgets,
Accounts and Categories, on the same shell. 933 assertions, 67 of them new.

**The schema moved to v3**, which is what step 7 always was: `budgetPaise`
finally left `Category` for `budgets['YYYY-MM'][categoryId]`, and
`migrateV2toV3` lifts the old per-category figure into **the current month
only**. Writing it into every month would have invented a history nobody set —
a budget added last week would suddenly have been in force since 2019, and
last year's "over budget" would become a fact about this week's decision. The
field itself is gone rather than left behind, so a budget has one place it can
be read from. `migrate` now takes `today`, so which month inherits is a
decision the caller makes and a test can pin.

Three things the steps decided that the sketch in B did not:

- **A budget is monthly; a period is whatever the stepper says.** Six view
  modes times one budgets map would have been six sets of budgets free to
  disagree. Instead `budgetForRange` prorates: a whole month returns its own
  figure with no arithmetic at all, a week takes its share of the month, a
  straddling week draws on both months, and six months add up. The sheet names
  the months it will write to, every time, so a weekly view never looks as
  though it has a separate plan.
- **"Not budgeted" is a list, not a lump**, and it holds every unbudgeted
  expense category, spent-in or not — it is simultaneously the report of money
  outside the plan (largest first) and the place a budget gets set, so a
  category with no spending yet still has to be reachable.
- **Merge archives the source rather than deleting it**, so a period from
  before the merge still resolves the name it was filed under, and the two
  categories' budgets are added rather than one of them quietly vanishing.

Two assumptions the tests caught as wrong on the way, both mine rather than the
code's: spending *exactly* the budget is not "under" — there is nothing left,
and the bar has to say so, so it is `near`; and the unbudgeted list is longer
than the number of categories with spending, for the reason above.

The gate, re-run against the running app on the sample ledger and a plan
covering five of nine categories:

- adding a ₹9,999 transfer from the FAB leaves **every** budget figure
  bit-identical — rows, bands, pace sentences, the overall row and the
  unbudgeted total — while moving exactly two balances by exactly ±₹9,999 and
  leaving net worth, lifetime expense and lifetime income untouched (E2, E6);
- adding ₹90,000 of income leaves every budget figure bit-identical and moves
  the income and net figures by exactly that (E1);
- a past period drops the projection and the pace mark and reports the result
  instead; a future period says it has not started rather than claiming to be
  perfectly on track; a yearly period puts the pace mark at 67% (243/365) and
  shows all three bands at once, with "On track" landing where the fill meets
  the mark;
- archiving an account takes it off the list and changes the total by nothing,
  because archived money is still money;
- an opening balance of −₹4,000 moves that account's balance and net worth by
  exactly −₹4,000, derived both times, never stored;
- deleting a category with records refuses without an explicit choice and
  states the count in both directions before either is taken;
- both themes, and the bottom of every pane clears the FAB by 196px.

**Two renames and one gap closed.** `ui/budgets.js` and `ui/categories.js`
became `ui/legacy-budgets.js` and `ui/legacy-categories.js` (with
`css/budgets.css` → `css/legacy-budgets.css`), the same move step 0 made for
`transfer.js` — two files named `budgets.js` meaning different things is
precisely the two-vocabularies failure this project keeps closing. And
`css/dialogs.css` is new: the v2 shell had shipped the transaction dialog's
markup and behaviour in step 4 but none of its styling, which lived only in the
v1 `forms.css`. The three new sheets need the same field, error and segmented
primitives, so there is now one copy that every dialog uses.

`.claude/launch.json` now runs `scripts/serve.py` rather than bare
`http.server`. The bare server sends no cache headers, so the browser served a
stale module graph that read the new v3 payload as a future schema and locked
the app read-only — a convincing impression of a migration bug, caused entirely
by the tooling. `serve.py` exists for exactly this and was simply not wired up.

**Step 10 landed, 31 August 2026 — the drawer's data tools, and the end of
the table.** Export Report, Backup & Restore and Delete & Reset, in
`ui/manage-data.js`. 973 assertions, 40 of them new. That closes steps 0-10;
nothing in F is outstanding.

`ui/data.js` was the starting point as expected, and none of it survived
unchanged — it was written against the v1 schema and against a drawer that
did not exist. What carried over is its shape: read and apply are two steps,
the preview is stated in numbers, and deleting requires typing the word.

Four things the step decided that the sketch did not:

- **Export and restore are different sheets, and only one of them downloads.**
  "Export Report" owns every download; "Backup & Restore" owns reading a file
  back and links across to the other rather than growing a second download
  path that could drift from the first. The formats are named for what they
  are for: the JSON backup says it is the only one that comes back, because
  offering an undifferentiated "export" is how someone ends up holding a CSV
  they expected to restore.
- **CSV is a new pure module, `lib/csv.js`, with 35 assertions**, because the
  quoting is the whole risk. A note is free text and free text is where a
  hand-rolled writer breaks: a comma splits one column into two, a quote ends
  the field early, and a newline splits one row into two. The last is the one
  that gets missed — it survives a glance at the file and corrupts a row three
  thousand lines down. All three have a test, together and separately, and the
  pipeline was re-run against the real 299-record ledger: 299 records still
  produce 299 record lines. The BOM lives on the Blob in `ui/`, never in the
  module, so the pure function keeps no opinion about who will read it.
- **`summariseImport` gained `conflicts` and `transactionsUpdated`.** The
  preview needed a word for the one place the two modes disagree — merge keeps
  yours, replace takes theirs — and merge reporting **"Changed: 0"** is the
  point of the whole module rather than a line it can leave out.
  `replace.transactionsRemoved` also changed meaning: it now counts what is
  lost *for good*, excluding the records the file overwrites, because a record
  that is replaced is not a record that is gone.
- **Delete and reset are two actions with two different words.** Emptying the
  ledger and throwing away the accounts, categories, plan and preferences
  built around it are not degrees of the same thing. `store.resetAll` is new
  beside `clearAll`, and the confirmation is `CLEAR` for one and `RESET` for
  the other so that having typed one does not carry you through the other.

**The quota banner was missing entirely, and that is the real find.** CLAUDE.md
has required a visible, actionable message on `QuotaExceededError` since v1,
`storage.saveState` has always reported it, and `store` has always carried it
in `ui.saveError` — but the v2 shell never read it. Only the retired
`js/main.js` did. So from step 4 until now, a failed write was silent: the
number on screen was right, the number on disk was not, and nothing said so.
It is the exact failure mode the rule exists to prevent, and it survived six
steps because it is invisible until storage is actually full.

The lesson is the same one step 2 taught in a different key. There, a step was
marked done while the UI for it did not run; here, a rule was satisfied in the
data layer and quietly dropped on the way to the new shell. **A guarantee that
lives in the store is not a guarantee until something renders it.**

Verified against the running app: a forced `QuotaExceededError` raises a
banner naming what happened, what is still true and what to do, with the
export attached to it as a real button and one announcement per distinct
problem rather than one per keystroke.

**`legacy.html` and `js/main.js` are now fully superseded.** `ui/data.js` was
the last thing they held that the v2 app did not, and `ui/manage-data.js` has
taken it. `js/main.js` still writes `Category.budgetPaise` and
`legacy-budgets.js` still calls `budgetReport` with the v2 four-argument
signature, so the page has not run since step 4 and cannot without being
rewritten against v3. Retiring `legacy.html`, `js/main.js`, `js/ui/data.js`,
`js/ui/legacy-budgets.js`, `js/ui/legacy-categories.js` and the four v1
stylesheets (`layout`, `ledger`, `charts`, `forms`, `legacy-budgets`) is now
a deletion with nothing behind it. Left in place here deliberately: it is a
separate commit from the one that shipped the tools, and it is not this
step's to make.

---

## G. Decisions taken

Recorded 29 August 2026. These close the two questions left open at the end of F.

### G1. "Account" always means a money account

CLAUDE.md's out-of-scope list read *"No backend, database, auth, accounts or sync"*, where "accounts" meant **user** accounts. A v2 session would reasonably have read that as forbidding the Accounts tab. It now reads:

> No backend or database. No user accounts, no authentication, no sign-in, no sync.
> (Everywhere else in this codebase "account" means a money account — Cash, Bank,
> Card — matching the Accounts tab.)

Throughout this codebase **account** means a money account — Cash, Bank, Card — matching the Accounts tab name. There is no competing sense of the word. Keep the domain term everywhere: do not rename `Account`, `accountId`, `toAccountId` or `defaultAccountId` to dodge an ambiguity that no longer exists.

### G2. One FAB, opening a form with a segmented kind control

One floating action button. **Not** a speed-dial, and not a fanned or radial menu.

It opens the transaction form with a segmented **Expense / Income / Transfer** control at the top, defaulting to **Expense**.

- Selecting **Transfer** replaces the category field with a destination account field, and hides the direction control.
- The segmented control is a **real radio group** — `role="radiogroup"` with radio children, arrow-key navigation, roving tabindex and a correct accessible name — not a row of buttons styled to look like one.

Consequences for the build:

- This is the first place `kind` becomes a user-facing choice, so step 4 must not start before step 2 lands.
- `ui/expense-form.js` grows a mode switch and is renamed to match the transaction vocabulary. Its `openAdd` / `openEdit` split, validation, and focus-restoration behaviour carry over unchanged.
- The FAB must obey the last invariant in CLAUDE.md: nothing may sit underneath it, and scroll containers get bottom padding greater than its height plus its offset. This is the flaw that mars four of the seven MyMoney screenshots.

Two loose ends, flagged rather than assumed:

1. ~~**The fate of the existing "Add with details" button was not stated.**~~
   **Settled 30 August 2026: it goes.** The FAB is the single full-form entry
   point and the quick-add command line stays the fast path. `#add-details` is
   removed from the markup; `n` and the FAB both open the same dialog.
2. **"Hides the direction control" implies a direction control exists in the form.**
   *Confirmed in the build:* there is nothing separate to hide. The segmented
   control is the only direction input, and selecting Transfer swaps the
   category field for a destination account, renames "Account" to "From
   account", and scopes the category list by kind.

   Original note follows. For expense and income, `direction` is fully determined by `kind` (`out` and `in` respectively), and for a transfer it is fixed `out` of the source account — so on the model as specified in B, the segmented control *is* the only direction input and there is nothing separate to hide. Recorded as stated; if a distinct direction control is intended, say what it is for.
