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
| 4 | Records tab: Expense/Income/Total triad, income and transfer rows, account label, FAB with the bottom-padding invariant | Browser |
| 5 | Accounts tab | Browser + balance invariants |
| 6 | Analysis tab: expense/income switch, proportional bars | Browser + hidden-table equivalence |
| 7 | Per-month budgets + copy-from-past-month | Tests for the budgets map, then browser |
| 8 | Categories split by kind + icon picker | Browser |
| 9 | Display options: period model, show-total, carry-over | Carry-over tests **first** (E4), then browser. Last because the period model multiplies the surface of every aggregation |
| 10 | Drawer, Preferences, Export Report | Browser |

**Two decisions I need from you before step 4.** First, the FAB: we already have the quick-add command line at the top, which I think is better than a FAB→form round trip and is part of our identity. Does the FAB *replace* "Add with details", or do both exist? Second, CLAUDE.md's out-of-scope list says "No backend, database, auth, accounts or sync" — there "accounts" means *user accounts*, not money accounts, but a future session will read it as a contradiction of v2. That line needs rewording.
