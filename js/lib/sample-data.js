/**
 * sample-data.js — ~3 months of plausible Indian spending, so the demo is
 * never an empty screen.
 *
 * Pure and deterministic: the clock, the id factory and the random source are
 * all arguments. The same seed always produces the same ledger, which means
 * the shape of the topography in a screenshot is reproducible.
 */

import { addDays, datesInMonth, dayOfWeek, monthKey, addMonths } from './dates.js';

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

/* Each entry: [note, categoryId, minRupees, maxRupees, methods] */
const BREAKFAST = [
  ['Filter coffee', 'food', 20, 60, ['cash', 'upi']],
  ['Chai and vada', 'food', 25, 70, ['cash']],
  ['Idli plate', 'food', 40, 90, ['cash', 'upi']],
];
const LUNCH = [
  ['Canteen lunch', 'food', 80, 190, ['upi', 'cash']],
  ['Swiggy', 'food', 220, 520, ['upi', 'card']],
  ['Zomato', 'food', 240, 610, ['upi', 'card']],
  ['Thali, Sagar', 'food', 130, 260, ['cash', 'upi']],
];
const EVENING = [
  ['Chai', 'food', 15, 40, ['cash']],
  ['Bakery', 'food', 60, 180, ['cash', 'upi']],
  ['Samosa run', 'food', 30, 90, ['cash']],
];
const COMMUTE = [
  ['Metro', 'transport', 30, 90, ['upi']],
  ['Auto to office', 'transport', 70, 180, ['cash', 'upi']],
  ['Uber', 'transport', 160, 420, ['upi', 'card']],
  ['Ola', 'transport', 150, 390, ['upi']],
  ['Rapido', 'transport', 45, 120, ['upi']],
];
const OCCASIONAL = [
  ['PVR, two tickets', 'entertainment', 400, 900, ['card', 'upi']],
  ['Netflix', 'entertainment', 199, 649, ['card']],
  ['Spotify', 'entertainment', 119, 179, ['card']],
  ['Pharmacy', 'health', 120, 900, ['cash', 'upi']],
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
  ['D-Mart, weekly run', 'groceries', 1200, 3800, ['card', 'upi']],
  ['BigBasket', 'groceries', 800, 2600, ['upi', 'card']],
  ['Sabzi mandi', 'groceries', 180, 620, ['cash']],
  ['Milk and eggs', 'groceries', 60, 220, ['cash', 'upi']],
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
 * @returns {Array} expenses, oldest first
 */
export function generateSampleExpenses({ today, makeId, months = 3, seed = 20250813 }) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const chance = (p) => rand() < p;

  const out = [];
  let clock = 0;
  const add = (date, [note, categoryId, lo, hi, methods]) => {
    clock += 1;
    out.push({
      id: makeId(),
      amountPaise: between(lo, hi) * 100,
      date,
      categoryId,
      note,
      // Deterministic and monotonic, so same-day order is stable.
      createdAt: new Date(Date.UTC(2020, 0, 1) + clock * 60000).toISOString(),
      paymentMethod: pick(methods),
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

      // The monthly fixtures: rent on the 1st, bills in the first week.
      if (dayOfMonth === 1) {
        add(date, ['Flat rent', 'rent', 28000, 32000, ['upi']]);
        add(date, ['Broadband', 'rent', 799, 1299, ['card']]);
      }
      if (dayOfMonth === 4) add(date, ['Electricity bill', 'rent', 900, 3200, ['upi']]);
      if (dayOfMonth === 7) add(date, ['Phone recharge', 'rent', 239, 799, ['upi']]);
      if (dayOfMonth === 12) add(date, ['Society maintenance', 'rent', 1800, 2600, ['upi']]);

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
      if (dayOfMonth % 10 === 3) add(date, ['Petrol', 'transport', 1200, 2600, ['card', 'upi']]);
    }
  }

  // A couple of very recent entries so "Today" is never empty.
  add(today, pick(BREAKFAST));
  add(today, pick(LUNCH));
  add(addDays(today, -1), pick(COMMUTE));

  return out;
}
