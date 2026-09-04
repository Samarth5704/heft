/**
 * sample-data.js — ~3 months of plausible Indian money, so the demo is never
 * an empty screen.
 *
 * Pure and deterministic: the clock, the id factory and the random source are
 * all arguments. The same seed always produces the same ledger, which means
 * the shape of the topography in a screenshot is reproducible.
 *
 * v2: it generates transactions, not just expenses — a salary each month, the
 * card bill paid off as a transfer, and the spending in between. Without
 * income and transfers the Accounts tab would be a column of negative numbers
 * and the model would go undemonstrated.
 */

import { addDays, datesInMonth, dayOfWeek, monthKey, addMonths } from './dates.js';

/** The accounts the generated ledger spends from. */
export const SAMPLE_ACCOUNT_IDS = Object.freeze(['cash', 'bank', 'card']);

/** Small, fast, seedable PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Each entry: [note, categoryId, minRupees, maxRupees, accountIds] */
const BREAKFAST = [
  ['Filter coffee', 'food', 20, 60, ['cash', 'bank']],
  ['Chai and vada', 'food', 25, 70, ['cash']],
  ['Idli plate', 'food', 40, 90, ['cash', 'bank']],
];
const LUNCH = [
  ['Canteen lunch', 'food', 80, 190, ['bank', 'cash']],
  ['Swiggy', 'food', 220, 520, ['bank', 'card']],
  ['Zomato', 'food', 240, 610, ['bank', 'card']],
  ['Thali, Sagar', 'food', 130, 260, ['cash', 'bank']],
];
const EVENING = [
  ['Chai', 'food', 15, 40, ['cash']],
  ['Bakery', 'food', 60, 180, ['cash', 'bank']],
  ['Samosa run', 'food', 30, 90, ['cash']],
];
const COMMUTE = [
  ['Metro', 'transport', 30, 90, ['bank']],
  ['Auto to office', 'transport', 70, 180, ['cash', 'bank']],
  ['Uber', 'transport', 160, 420, ['bank', 'card']],
  ['Ola', 'transport', 150, 390, ['bank']],
  ['Rapido', 'transport', 45, 120, ['bank']],
];
const OCCASIONAL = [
  ['PVR, two tickets', 'entertainment', 400, 900, ['card', 'bank']],
  ['Netflix', 'entertainment', 199, 649, ['card']],
  ['Spotify', 'entertainment', 119, 179, ['card']],
  ['Pharmacy', 'health', 120, 900, ['cash', 'bank']],
  ['Gym, monthly', 'health', 900, 2200, ['card']],
  ['Doctor visit', 'health', 500, 1200, ['cash']],
  ['Amazon order', 'shopping', 350, 2600, ['card']],
  ['Myntra', 'shopping', 700, 3400, ['card']],
  ['Haircut', 'shopping', 150, 450, ['cash']],
  ['Udemy course', 'education', 449, 1299, ['card']],
  ['Books, Blossoms', 'education', 300, 1400, ['cash', 'card']],
  ['Stationery', 'education', 80, 400, ['cash']],
];
const GROCERY = [
  ['D-Mart, weekly run', 'groceries', 1200, 3800, ['card', 'bank']],
  ['BigBasket', 'groceries', 800, 2600, ['bank', 'card']],
  ['Sabzi mandi', 'groceries', 180, 620, ['cash']],
  ['Milk and eggs', 'groceries', 60, 220, ['cash', 'bank']],
];
const BIG = [
  ['Flight to Delhi', 'transport', 4200, 11000, ['card']],
  ['New phone', 'shopping', 18000, 42000, ['card']],
  ['Dentist', 'health', 3000, 9000, ['card']],
  ['Weekend trip, hotel', 'entertainment', 4000, 12000, ['card']],
  ['Laptop repair', 'shopping', 2500, 8000, ['card']],
];

/**
 * Generate a plausible ledger.
 * @param {{today: string, makeId: () => string, months?: number, seed?: number}} opts
 * @returns {Array} transactions, oldest first
 */
export function generateSampleTransactions({ today, makeId, months = 3, seed = 20250813 }) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const chance = (p) => rand() < p;

  const out = [];
  let clock = 0;
  // Deterministic and monotonic, so same-day order is stable.
  const stamp = () => {
    clock += 1;
    return new Date(Date.UTC(2020, 0, 1) + clock * 60000).toISOString();
  };

  const add = (date, [note, categoryId, lo, hi, accounts]) => {
    out.push({
      id: makeId(),
      kind: 'transaction',
      direction: 'expense',
      amountPaise: between(lo, hi) * 100,
      date,
      accountId: pick(accounts),
      toAccountId: null,
      categoryId,
      note,
      createdAt: stamp(),
    });
  };

  const earn = (date, note, categoryId, lo, hi, accountId = 'bank') => {
    out.push({
      id: makeId(),
      kind: 'transaction',
      direction: 'income',
      amountPaise: between(lo, hi) * 100,
      date,
      accountId,
      toAccountId: null,
      categoryId,
      note,
      createdAt: stamp(),
    });
  };

  const move = (date, note, lo, hi, from, to) => {
    out.push({
      id: makeId(),
      kind: 'transfer',
      direction: null,
      amountPaise: between(lo, hi) * 100,
      date,
      accountId: from,
      toAccountId: to,
      categoryId: null,
      note,
      createdAt: stamp(),
    });
  };

  const startKey = addMonths(monthKey(today), -(months - 1));

  for (let m = 0; m < months; m += 1) {
    const key = addMonths(startKey, m);
    for (const date of datesInMonth(key)) {
      if (date > today) break;

      const dow = dayOfWeek(date);
      const weekend = dow === 0 || dow === 6;
      const dayOfMonth = Number(date.slice(8));

      // The monthly fixtures: salary on the 1st, rent behind it, bills after.
      if (dayOfMonth === 1) {
        earn(date, 'Salary', 'salary', 82000, 86000);
        add(date, ['Flat rent', 'rent', 28000, 32000, ['bank']]);
        add(date, ['Broadband', 'rent', 799, 1299, ['card']]);
      }
      if (dayOfMonth === 4) add(date, ['Electricity bill', 'rent', 900, 3200, ['bank']]);
      // Last month's card bill, paid off. Money moved, nothing spent.
      if (dayOfMonth === 5) move(date, 'Card bill', 6000, 14000, 'bank', 'card');
      if (dayOfMonth === 7) add(date, ['Phone recharge', 'rent', 239, 799, ['bank']]);
      if (dayOfMonth === 9) move(date, 'ATM withdrawal', 2000, 6000, 'bank', 'cash');
      if (dayOfMonth === 12) add(date, ['Society maintenance', 'rent', 1800, 2600, ['bank']]);
      if (dayOfMonth === 18 && chance(0.5)) {
        earn(date, 'Refund', 'refunds', 200, 2400, 'card');
      }

      // Daily life.
      if (chance(0.75)) add(date, pick(BREAKFAST));
      if (chance(weekend ? 0.5 : 0.85)) add(date, pick(LUNCH));
      if (chance(0.45)) add(date, pick(EVENING));
      if (!weekend && chance(0.8)) add(date, pick(COMMUTE));
      if (weekend && chance(0.55)) add(date, pick(COMMUTE));

      // Groceries cluster on the weekend, with top-ups midweek.
      if (weekend && chance(0.55)) add(date, pick(GROCERY));
      else if (chance(0.14)) add(date, pick(GROCERY));

      if (chance(0.16)) add(date, pick(OCCASIONAL));
      if (chance(0.012)) add(date, pick(BIG));

      // Fuel roughly every ten days.
      if (dayOfMonth % 10 === 3) add(date, ['Petrol', 'transport', 1200, 2600, ['card', 'bank']]);
    }
  }

  // A couple of very recent entries so "Today" is never empty.
  add(today, pick(BREAKFAST));
  add(today, pick(LUNCH));
  add(addDays(today, -1), pick(COMMUTE));

  return out;
}

/**
 * A plausible monthly plan to go with the generated ledger.
 *
 * Deliberately partial: five categories budgeted, the rest not, so the
 * Budgets tab demonstrates both of its sections — and, in particular, so
 * "not budgeted this period" has real money in it rather than being an empty
 * heading. The figures are set near the generator's own spending so the three
 * bands (under, near, over) all appear across a three-month sample.
 *
 * Pure: months in, map out.
 *
 * @param {{today: string, months?: number}} opts
 * @returns {Record<string, Record<string, number>>}
 */
export function generateSampleBudgets({ today, months = 3 }) {
  const plan = {
    food: 1200000,
    transport: 500000,
    rent: 2500000,
    entertainment: 300000,
    groceries: 800000,
  };
  const startKey = addMonths(monthKey(today), -(months - 1));
  const out = {};
  for (let m = 0; m < months; m += 1) out[addMonths(startKey, m)] = { ...plan };
  return out;
}
