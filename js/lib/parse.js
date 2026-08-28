/**
 * parse.js — the quick-add tokenizer.
 *
 * Turns a line like `swiggy 480 yesterday` into a structured draft expense.
 * A real tokenizer, not a chain of regex replaces: the input is split into
 * tokens once, then passes claim tokens in a fixed order and whatever is left
 * over becomes the note.
 *
 * Pass order matters. Dates are claimed first so the `23` in `23 jan` is not
 * mistaken for an amount; the amount is claimed next; categories last.
 *
 * Documented precedence rules
 * ---------------------------
 * Amount, when several numbers survive the date pass:
 *   1. a number carrying a currency mark  (rupee sign, `rs 250`)
 *   2. a number carrying a k / l suffix   (`1.2k`)
 *   3. a number written with decimals or grouping (`1,200`, `250.50`)
 *   4. otherwise the leftmost number
 * Category:
 *   explicit category name > synonym > caller's default
 * A category *name* is consumed from the note (`480 food` leaves no note).
 * A *synonym* is not (`swiggy 480` keeps "swiggy" as the note) — the synonym
 * is what you spent it on, and losing it would lose the only description.
 *
 * Pure module: no DOM, no globals, no clock. `today` is always an argument.
 */

import { toPaise } from './money.js';
import {
  addDays, daysInMonthOf, isAfter, isValid, parts, toISO,
} from './dates.js';

/** Synonym -> seed category id. Seed ids are stable even if names are edited. */
export const SYNONYMS = Object.freeze({
  swiggy: 'food', zomato: 'food', chai: 'food', tea: 'food', coffee: 'food',
  lunch: 'food', dinner: 'food', breakfast: 'food', snacks: 'food',
  cafe: 'food', restaurant: 'food', dosa: 'food', biryani: 'food',
  starbucks: 'food', dominos: 'food',

  dmart: 'groceries', bigbasket: 'groceries', blinkit: 'groceries',
  zepto: 'groceries', instamart: 'groceries', kirana: 'groceries',
  vegetables: 'groceries', milk: 'groceries', sabzi: 'groceries',

  uber: 'transport', ola: 'transport', petrol: 'transport', diesel: 'transport',
  fuel: 'transport', metro: 'transport', auto: 'transport', rapido: 'transport',
  cab: 'transport', bus: 'transport', train: 'transport', irctc: 'transport',
  flight: 'transport', indigo: 'transport', toll: 'transport',

  rent: 'rent', electricity: 'rent', water: 'rent', maintenance: 'rent',
  broadband: 'rent', wifi: 'rent', jio: 'rent', airtel: 'rent', gas: 'rent',
  recharge: 'rent',

  amazon: 'shopping', flipkart: 'shopping', myntra: 'shopping',
  ajio: 'shopping', clothes: 'shopping', shoes: 'shopping', nykaa: 'shopping',

  pharmacy: 'health', medicine: 'health', doctor: 'health', gym: 'health',
  apollo: 'health', hospital: 'health', dentist: 'health',

  netflix: 'entertainment', spotify: 'entertainment', movie: 'entertainment',
  pvr: 'entertainment', bookmyshow: 'entertainment', hotstar: 'entertainment',
  prime: 'entertainment', game: 'entertainment',

  course: 'education', udemy: 'education', books: 'education',
  coursera: 'education', tuition: 'education', fees: 'education',
});

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const DAY_KEYWORDS = {
  today: 0, tdy: 0, yesterday: -1, yday: -1, ydy: -1, tomorrow: 1, tmrw: 1,
};

const MULTIPLIERS = {
  k: 1000, l: 100000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000,
};

const NUMBER_RE = /^(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d+))?(k|l|lakhs?|lacs?)?$/i;
const SLASH_DATE_RE = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PREFIX_RE = /^(?:₹|rs\.?|inr)/i;

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Split on whitespace, keeping each token's original text and position. */
export function tokenize(input) {
  const out = [];
  const re = /\S+/g;
  let m = re.exec(input);
  while (m !== null) {
    const raw = m[0];
    const hasCurrency = CURRENCY_PREFIX_RE.test(raw);
    const bare = raw.replace(CURRENCY_PREFIX_RE, '').replace(/[.,;:!?]+$/, '');
    out.push({
      raw,
      bare,
      word: bare.toLowerCase().replace(/[^a-z0-9]/g, ''),
      hasCurrency,
      index: out.length,
      claimed: null,
    });
    m = re.exec(input);
  }
  return out;
}

function monthIndexOf(word) {
  if (!word || word.length < 3 || /\d/.test(word)) return -1;
  return MONTHS.findIndex((name) => name.startsWith(word));
}

/** Read a number token: value in paise, plus how it was written. */
function readNumber(tok) {
  const m = NUMBER_RE.exec(tok.bare);
  if (!m) return null;
  const suffix = m[3] ? m[3].toLowerCase() : null;
  const mult = suffix ? (MULTIPLIERS[suffix] ?? 1) : 1;
  const base = toPaise(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  if (base === null) return null;
  const paise = base * mult;
  if (!Number.isSafeInteger(paise)) return null;
  return {
    paise,
    hasSuffix: Boolean(suffix),
    hasShape: Boolean(m[2]) || m[1].includes(','),
  };
}

/**
 * Pick a year for a day/month with no year given: the most recent occurrence
 * that is not in the future. `23 dec` typed in August means last December.
 */
function resolveYear(day, month, todayISO) {
  const t = parts(todayISO);
  if (!t) return null;
  for (const year of [t.year, t.year - 1]) {
    const iso = makeDate(year, month, day);
    if (iso && !isAfter(iso, todayISO)) return iso;
  }
  return null;
}

const expandYear = (raw) => (raw.length === 4 ? Number(raw) : 2000 + Number(raw));

const makeDate = (year, month, day) => (
  day >= 1 && day <= daysInMonthOf(year, month) ? toISO(year, month, day) : null
);

/** Claim the first date expression found. Returns { date, claimed[] } or null. */
function findDate(tokens, todayISO) {
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.claimed) continue;

    if (Object.prototype.hasOwnProperty.call(DAY_KEYWORDS, tok.word)) {
      return { date: addDays(todayISO, DAY_KEYWORDS[tok.word]), claimed: [tok] };
    }

    if (ISO_DATE_RE.test(tok.bare) && isValid(tok.bare)) {
      return { date: tok.bare, claimed: [tok] };
    }

    const slash = SLASH_DATE_RE.exec(tok.bare);
    if (slash) {
      const day = Number(slash[1]);
      const month = Number(slash[2]);
      if (month >= 1 && month <= 12 && day >= 1) {
        const iso = slash[3]
          ? makeDate(expandYear(slash[3]), month, day)
          : resolveYear(day, month, todayISO);
        if (iso) return { date: iso, claimed: [tok] };
      }
    }

    // '23 jan' / 'jan 23', either optionally followed by a year.
    const next = tokens[i + 1];
    if (!next || next.claimed) continue;
    const dayFirst = /^\d{1,2}(?:st|nd|rd|th)?$/i.test(tok.bare)
      ? Number(tok.bare.replace(/\D/g, '')) : null;
    const daySecond = /^\d{1,2}(?:st|nd|rd|th)?$/i.test(next.bare)
      ? Number(next.bare.replace(/\D/g, '')) : null;

    let day = null;
    let month = null;
    if (dayFirst !== null && monthIndexOf(next.word) >= 0) {
      day = dayFirst;
      month = monthIndexOf(next.word) + 1;
    } else if (monthIndexOf(tok.word) >= 0 && daySecond !== null) {
      day = daySecond;
      month = monthIndexOf(tok.word) + 1;
    }
    if (day === null || day < 1) continue;

    let claimed = [tok, next];
    const after = tokens[i + 2];
    let year = null;
    if (after && !after.claimed && /^(?:\d{2}|\d{4})$/.test(after.bare)) {
      year = expandYear(after.bare);
      claimed = [tok, next, after];
    }
    const iso = year ? makeDate(year, month, day) : resolveYear(day, month, todayISO);
    if (iso) return { date: iso, claimed };
  }
  return null;
}

/**
 * Amount pass. Applies the documented precedence over surviving numbers.
 * A multiplier may also stand as its own word: `3 lakh car`.
 */
function findAmount(tokens) {
  const candidates = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.claimed) continue;
    const num = readNumber(tok);
    if (!num) continue;

    let { paise, hasSuffix } = num;
    let claimed = [tok];
    const next = tokens[i + 1];
    if (!hasSuffix && next && !next.claimed
        && Object.prototype.hasOwnProperty.call(MULTIPLIERS, next.word)) {
      const scaled = paise * MULTIPLIERS[next.word];
      if (Number.isSafeInteger(scaled)) {
        paise = scaled;
        hasSuffix = true;
        claimed = [tok, next];
      }
    }
    candidates.push({ tok, paise, hasSuffix, hasShape: num.hasShape, claimed });
  }
  if (candidates.length === 0) return null;

  const rank = (c) => {
    if (c.tok.hasCurrency) return 0;
    if (c.hasSuffix) return 1;
    if (c.hasShape) return 2;
    return 3;
  };
  let best = candidates[0];
  for (const c of candidates) {
    if (rank(c) < rank(best)) best = c;
  }
  return { paise: best.paise, claimed: best.claimed, extra: candidates.length - 1 };
}

/** Build lookup tables from the caller's categories. */
export function buildCategoryIndex(categories = []) {
  const names = new Map();
  for (const cat of categories) {
    const full = norm(cat.name);
    if (!full) continue;
    if (!names.has(full)) names.set(full, cat.id);
    for (const word of full.split(' ')) {
      if (word.length >= 3 && word !== 'and' && !names.has(word)) {
        names.set(word, cat.id);
      }
    }
  }
  const ids = new Set(categories.map((c) => c.id));
  const synonyms = new Map();
  for (const [key, id] of Object.entries(SYNONYMS)) {
    if (ids.has(id) && !names.has(key)) synonyms.set(key, id);
  }
  return { names, synonyms };
}

/** Longest contiguous run of unclaimed words matching a category name. */
function findCategoryName(tokens, index) {
  const free = tokens.filter((t) => !t.claimed);
  for (let len = Math.min(3, free.length); len >= 1; len -= 1) {
    for (let start = free.length - len; start >= 0; start -= 1) {
      const span = free.slice(start, start + len);
      const contiguous = span.every((t, k) => k === 0 || t.index === span[k - 1].index + 1);
      if (!contiguous) continue;
      const id = index.names.get(norm(span.map((t) => t.bare).join(' ')));
      if (id) return { id, claimed: span };
    }
  }
  return null;
}

function findSynonym(tokens, index) {
  for (const tok of tokens) {
    if (tok.claimed) continue;
    const id = index.synonyms.get(tok.word);
    if (id) return { id, token: tok };
  }
  return null;
}

/**
 * Parse a quick-add line into a draft expense.
 * @param {string} input
 * @param {{categories: Array, today: string, defaultCategoryId?: string}} ctx
 * @returns {{ok: boolean, amountPaise: number|null, date: string,
 *   categoryId: string|null, note: string, matchedBy: string,
 *   error: string|null, message: string|null, warnings: string[]}}
 */
export function parseQuickAdd(input, ctx = {}) {
  const categories = ctx.categories ?? [];
  const todayISO = ctx.today;
  const fallback = ctx.defaultCategoryId ?? categories[0]?.id ?? null;

  const base = {
    ok: false,
    amountPaise: null,
    date: todayISO,
    categoryId: fallback,
    note: '',
    matchedBy: 'default',
    error: null,
    message: null,
    warnings: [],
  };

  if (typeof input !== 'string' || input.trim() === '') {
    return { ...base, error: 'empty', message: 'Type an amount to get started.' };
  }

  const tokens = tokenize(input);
  const index = buildCategoryIndex(categories);

  const dateHit = findDate(tokens, todayISO);
  if (dateHit) for (const t of dateHit.claimed) t.claimed = 'date';

  const amountHit = findAmount(tokens);
  if (amountHit) for (const t of amountHit.claimed) t.claimed = 'amount';

  let categoryId = fallback;
  let matchedBy = 'default';
  const nameHit = findCategoryName(tokens, index);
  if (nameHit) {
    categoryId = nameHit.id;
    matchedBy = 'name';
    for (const t of nameHit.claimed) t.claimed = 'category';
  } else {
    const synHit = findSynonym(tokens, index);
    if (synHit) {
      categoryId = synHit.id;
      matchedBy = 'synonym';
      // Deliberately not claimed: the synonym stays in the note.
    }
  }

  const note = tokens.filter((t) => !t.claimed).map((t) => t.raw).join(' ').trim();
  const warnings = [];
  if (amountHit && amountHit.extra > 0) {
    warnings.push('More than one number found — used the most amount-like one.');
  }

  const resolved = {
    ...base,
    date: dateHit ? dateHit.date : todayISO,
    categoryId,
    matchedBy,
    note,
    warnings,
  };

  if (!amountHit) {
    return {
      ...resolved,
      error: 'no-amount',
      message: 'No amount found. Try “250 chai” or “1.2k rent”.',
    };
  }
  if (amountHit.paise <= 0) {
    return { ...resolved, error: 'zero-amount', message: 'Amount must be more than zero.' };
  }

  return { ...resolved, ok: true, amountPaise: amountHit.paise };
}
