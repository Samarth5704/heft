/**
 * icons.js — the icon registry. Pure data: path strings on a 24×24 grid, no
 * DOM. `ui/icon.js` turns an entry into an element.
 *
 * Every glyph is hand-drawn on the same grid with the same 1.9 stroke and
 * round joins, so the set reads as one hand.
 *
 * The rule that shaped the drawing: **each icon must be identifiable from its
 * silhouette alone.** The reference screenshots give Cab/Auto, Car and Fuel
 * three near-identical purple car glyphs, which is unreadable at a glance and
 * useless to anyone who cannot separate the hues. Here those three are a car
 * with a roof sign, a steering wheel, and a fuel pump — different shapes, not
 * different colours. `tests/icons.html` renders the whole set desaturated at
 * 40px and compares every pair pixel-wise; nothing ships above the similarity
 * threshold.
 *
 * `filled` is the solid variant, used by the active tab so the current tab is
 * marked by weight as well as by colour.
 */

/** @type {Record<string, {d: string[], filled?: string[], label: string}>} */
export const ICONS = Object.freeze({
  /* ------------------------------------------------------- expense set */

  food: { label: 'Food', d: [
    'M8 3v7a2 2 0 0 1-4 0V3', 'M6 10v11', 'M16.5 3c-1.4 1-2 2.6-2 4.6 0 1.7.7 2.8 2 3.2V21',
  ] },

  groceries: { label: 'Groceries', d: [
    'M3 8h18l-1.7 10.3a2 2 0 0 1-2 1.7H6.7a2 2 0 0 1-2-1.7z',
    'M8 8 10.5 3', 'M16 8 13.5 3',
  ] },

  // A bus: tall body, window band, two wheels below the sill.
  transport: { label: 'Transport', d: [
    'M5 4h14v12H5z', 'M5 8.5h14', 'M8 19a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z',
    'M19.2 19a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z', 'M7 16v1.6', 'M17 16v1.6',
  ] },

  // A cab: low car body with an unmistakable roof sign on top.
  cab: { label: 'Cab', d: [
    'M9 3.5h6v2H9z', 'M4 13.5 5.8 8.5A2 2 0 0 1 7.7 7h8.6a2 2 0 0 1 1.9 1.4L20 13.5',
    'M3 13.5h18v4H3z', 'M6.5 17.5V19', 'M17.5 17.5V19',
  ] },

  // A steering wheel: a ring with a hub and three spokes. Nothing like a car.
  car: { label: 'Car', d: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0z',
    'M12 3v5.8', 'M3.3 13.6l5.7-1.1', 'M20.7 13.6l-5.7-1.1',
  ] },

  // A pump: upright column, hose loop, and the nozzle arm at the side.
  fuel: { label: 'Fuel', d: [
    'M4 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16', 'M3 21h11', 'M6 7h5v4H6z',
    'M13 9h4a2 2 0 0 1 2 2v6a1.6 1.6 0 0 0 3.2 0v-6L19 7.5',
  ] },

  rent: { label: 'Rent & Bills', d: [
    'M3.5 10.5 12 3.5l8.5 7', 'M5.8 12.4V20h12.4v-7.6', 'M10 20v-4.6h4V20',
  ] },

  bills: { label: 'Bills', d: [
    'M6 2.5h8.5L19 7v14.5H6z', 'M14 2.5V7h5', 'M9 12h7', 'M9 15.5h7', 'M9 19h4',
  ] },

  shopping: { label: 'Shopping', d: [
    'M4.5 8h15l-1.2 12.5H5.7z', 'M8.7 8V6a3.3 3.3 0 0 1 6.6 0v2',
  ] },

  clothing: { label: 'Clothing', d: [
    'M9 3 5 5.2 3.2 9l3 1.6V21h11.6V10.6l3-1.6L19 5.2 15 3',
    'M9 3c0 1.7 1.3 2.6 3 2.6S15 4.7 15 3',
  ] },

  // A bold cross. Nothing else in the set is cruciform.
  health: { label: 'Health', d: [
    'M9.6 3h4.8v6.6H21v4.8h-6.6V21H9.6v-6.6H3V9.6h6.6z',
  ] },

  entertainment: { label: 'Entertainment', d: [
    'M3 8.6h18V21H3z', 'M3 8.6 5 3l15.2 2.6L21 8.6', 'M8.6 3.9 6.7 8.6', 'M14.2 4.9l-1.9 3.7',
  ] },

  education: { label: 'Education', d: [
    'M2.5 8.6 12 4.2l9.5 4.4L12 13z', 'M6.5 10.6V16c0 1.6 2.5 2.8 5.5 2.8s5.5-1.2 5.5-2.8v-5.4',
    'M21.5 8.6v5.2',
  ] },

  electronics: { label: 'Electronics', d: [
    'M8 3v4.5', 'M16 3v4.5', 'M5 7.5h14v4.7a7 7 0 0 1-14 0z', 'M12 19.2V21',
  ] },

  travel: { label: 'Travel', d: [
    'M12 2.6c1.1 0 1.8 1.2 1.8 2.8v3.2l7.4 4.3v2.4l-7.4-2.2v3.9l2.4 1.8v1.9L12 19.4l-4.2 1.3v-1.9l2.4-1.8v-3.9L2.8 15.3v-2.4l7.4-4.3V5.4c0-1.6.7-2.8 1.8-2.8z',
  ] },

  /* -------------------------------------------------------- income set */

  // Coins, not a banknote — `cash` is the banknote, and the two must not
  // collapse into the same shape.
  salary: { label: 'Salary', d: [
    'M18 6.2c0 1.5-2.7 2.7-6 2.7S6 7.7 6 6.2 8.7 3.5 12 3.5s6 1.2 6 2.7z',
    'M6 6.2V12c0 1.5 2.7 2.7 6 2.7s6-1.2 6-2.7V6.2',
    'M6 12v5.8c0 1.5 2.7 2.7 6 2.7s6-1.2 6-2.7V12',
  ] },

  refunds: { label: 'Refunds', d: [
    'M20.4 12a8.4 8.4 0 1 1-2.6-6.1', 'M20.8 4.2v4.6h-4.6',
  ] },

  returns: { label: 'Returns', d: [
    'M9.6 8.4a2.9 2.9 0 1 1-5.8 0 2.9 2.9 0 0 1 5.8 0z',
    'M20.2 8.4a2.9 2.9 0 1 1-5.8 0 2.9 2.9 0 0 1 5.8 0z',
    'M2.6 19.4c0-2.6 1.9-4.3 4.1-4.3s4.1 1.7 4.1 4.3',
    'M13.2 19.4c0-2.6 1.9-4.3 4.1-4.3s4.1 1.7 4.1 4.3',
  ] },

  interest: { label: 'Interest', d: [
    'M3 20.4h18', 'M6.2 20.4V13', 'M11.4 20.4V9.4', 'M16.6 20.4v-6',
    'M4.6 8.2 10 3.4l3.4 3 6-5.2', 'M16.2 2.6h4.2v4',
  ] },

  gifts: { label: 'Gifts', d: [
    'M3.4 11.6h17.2V21H3.4z', 'M2.4 7.4h19.2v4.2H2.4z', 'M12 7.4V21',
    'M12 7.4C12 5 10.4 3 8.7 3a2.2 2.2 0 0 0 0 4.4z',
    'M12 7.4C12 5 13.6 3 15.3 3a2.2 2.2 0 0 1 0 4.4z',
  ] },

  rental: { label: 'Rental', d: [
    'M15.4 9.6a3.9 3.9 0 1 1-7.8 0 3.9 3.9 0 0 1 7.8 0z',
    'M11 13.2 9.4 21', 'M9.4 21l3.4-1.4', 'M10.2 17.4l3-1.3',
  ] },

  stocks: { label: 'Stock market', d: [
    'M6.4 3v2.4', 'M6.4 16.2v4.8', 'M4.2 5.4h4.4v10.8H4.2z',
    'M17.6 3v6.6', 'M17.6 18v3', 'M15.4 9.6h4.4V18h-4.4z',
  ] },

  /* ------------------------------------------------------- account set */

  cash: { label: 'Cash', d: [
    'M2.6 6h18.8v12H2.6z', 'M14.6 12a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0z',
    'M5.8 12h.1', 'M18.1 12h.1',
  ] },

  bank: { label: 'Bank', d: [
    'M2.6 9.2 12 4l9.4 5.2', 'M5.4 11v7', 'M9.8 11v7', 'M14.2 11v7', 'M18.6 11v7',
    'M3 20.4h18',
  ] },

  card: { label: 'Card', d: [
    'M2.6 5.6h18.8v12.8H2.6z', 'M2.6 10h18.8', 'M6 14.4h3.6',
  ] },

  wallet: { label: 'Wallet', d: [
    'M3 7.4h14.6a2.4 2.4 0 0 1 2.4 2.4v7.8a2.4 2.4 0 0 1-2.4 2.4H4.2A1.2 1.2 0 0 1 3 18.8z',
    'M3 7.4V5.2A1.2 1.2 0 0 1 4.2 4h10.2v3.4',
    'M17.4 13.8h.1',
  ] },

  transfer: { label: 'Transfer', d: [
    'M3.4 8.6h12', 'M12.6 5.4 15.8 8.6 12.6 11.8',
    'M20.6 15.4h-12', 'M11.4 12.2 8.2 15.4l3.2 3.2',
  ] },

  other: { label: 'Other', d: ['M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'] },

  /* ------------------------------------------------------- shell icons */

  menu: { label: 'Menu', d: ['M3.6 6.6h16.8', 'M3.6 12h16.8', 'M3.6 17.4h16.8'] },
  search: { label: 'Search', d: ['M18 10.6a7.4 7.4 0 1 1-14.8 0 7.4 7.4 0 0 1 14.8 0z', 'M16 16l4.6 4.6'] },
  close: { label: 'Close', d: ['M5.6 5.6l12.8 12.8', 'M18.4 5.6L5.6 18.4'] },
  prev: { label: 'Previous', d: ['M15 4.6 7.6 12 15 19.4'] },
  next: { label: 'Next', d: ['M9 4.6 16.4 12 9 19.4'] },
  filter: { label: 'Filter', d: ['M3 4.6h18l-7 8.3v6.1l-4 2.4v-8.5z'] },
  // The same stroke as `next`, turned a quarter. A disclosure that rotates
  // rather than swapping glyph keeps the open and shut states one drawing.
  chevron: { label: 'Expand', d: ['M4.6 8.6 12 16l7.4-7.4'] },
  plus: { label: 'Add', d: ['M12 4.6v14.8', 'M4.6 12h14.8'] },
  settings: { label: 'Preferences', d: [
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
    'M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  ] },
  report: { label: 'Export report', d: [
    'M12 15.2V2.8', 'M7.8 7l4.2-4.2L16.2 7',
    'M4 13.4v5.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5.2',
  ] },
  backup: { label: 'Backup & restore', d: [
    'M4 4.6h13.4L20 7.2V19.4H4z', 'M7.4 4.6h9v5h-9z', 'M7.4 13.4h9v6h-9z',
  ] },
  danger: { label: 'Delete & reset', d: [
    'M4.4 6.6h15.2', 'M9.4 6.6V4.4h5.2v2.2', 'M6.6 6.6 7.7 20a1.4 1.4 0 0 0 1.4 1.3h5.8a1.4 1.4 0 0 0 1.4-1.3l1.1-13.4',
    'M10.4 10.6v6.4', 'M13.6 10.6v6.4',
  ] },
  // A pencil at the usual 45°, with the nib separated so it survives at 16px.
  edit: { label: 'Edit', d: [
    'M4 20h4.2L19.4 8.8a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8z',
    'M14.4 6.2l3.4 3.4',
  ] },

  // A box with its lid on: archiving puts a thing away, it does not destroy it.
  archive: { label: 'Archive', d: [
    'M3 4.6h18v4H3z', 'M4.6 8.6v10.8h14.8V8.6', 'M9.6 12.4h4.8',
  ] },

  // The lid coming back off, so restore is visibly the same drawing reversed.
  restore: { label: 'Restore', d: [
    'M3 8.6h18v4H3z', 'M4.6 12.6v6.8h14.8v-6.8', 'M12 8.2V2.6', 'M9 5.4 12 2.4l3 3',
  ] },

  // Two paths converging into one, with the arrow saying which way the
  // records travel. Nothing else in the set forks.
  merge: { label: 'Merge', d: [
    'M3 6h5a5 5 0 0 1 5 5v1', 'M3 18h5a5 5 0 0 0 5-5v-1',
    'M13 12h7', 'M16.8 8.6 20.2 12l-3.4 3.4',
  ] },

  more: { label: 'More actions', d: [
    'M12 6.4h.1', 'M12 12h.1', 'M12 17.6h.1',
  ] },

  check: { label: 'Chosen', d: ['M4.8 12.6 9.6 17.4 19.2 6.6'] },

  // A target: what a budget is, and the empty state's drawing.
  target: { label: 'Budget', d: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    'M16.6 12a4.6 4.6 0 1 1-9.2 0 4.6 4.6 0 0 1 9.2 0z',
    'M13.2 12a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z',
  ] },

  sun: { label: 'Light', d: [
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z', 'M12 2.6v2.2', 'M12 19.2v2.2',
    'M4.4 4.4 6 6', 'M18 18l1.6 1.6', 'M2.6 12h2.2', 'M19.2 12h2.2', 'M4.4 19.6 6 18', 'M18 6l1.6-1.6',
  ] },
  moon: { label: 'Dark', d: ['M20 13.4A8.4 8.4 0 0 1 10.6 4a8.4 8.4 0 1 0 9.4 9.4z'] },

  /* ---------------------------------------------------- the five tabs --
     Each has a filled twin. The active tab is accent-coloured *and* solid, so
     the current tab is never signalled by colour alone. */

  'tab-records': {
    label: 'Records',
    d: ['M5 2.8h14v18.4l-2.3-1.6-2.4 1.6-2.3-1.6-2.3 1.6-2.4-1.6L5 21.2z', 'M8.6 8h6.8', 'M8.6 12.4h6.8', 'M8.6 16.4h4'],
    filled: ['M5 2.8h14v18.4l-2.3-1.6-2.4 1.6-2.3-1.6-2.3 1.6-2.4-1.6L5 21.2z'],
    knockout: ['M8.6 8h6.8', 'M8.6 12.4h6.8', 'M8.6 16.4h4'],
  },
  'tab-analysis': {
    label: 'Analysis',
    d: ['M12 3.4a8.6 8.6 0 1 0 8.6 8.6H12z', 'M14.6 2.2v6.6h6.6a6.7 6.7 0 0 0-6.6-6.6z'],
    filled: ['M11 4.5a8.6 8.6 0 1 0 8.5 8.5H11z', 'M14.6 2.2v6.6h6.6a6.7 6.7 0 0 0-6.6-6.6z'],
  },
  'tab-budgets': {
    label: 'Budgets',
    d: ['M4.6 2.8h14.8v18.4H4.6z', 'M7.6 6h8.8v3.2H7.6z', 'M8 13h.1', 'M12 13h.1', 'M16 13h.1', 'M8 17h.1', 'M12 17h.1', 'M16 17h.1'],
    filled: ['M4.6 2.8h14.8v18.4H4.6z'],
    knockout: ['M7.6 6h8.8v3.2H7.6z', 'M8 13h.1', 'M12 13h.1', 'M16 13h.1', 'M8 17h.1', 'M12 17h.1', 'M16 17h.1'],
  },
  'tab-accounts': {
    label: 'Accounts',
    d: ['M3 6.4h18v11.2H3z', 'M16.4 12a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0z'],
    filled: ['M3 6.4h18v11.2H3z'],
    knockout: ['M16.4 12a1.7 1.7 0 1 1-3.4 0 1.7 1.7 0 0 1 3.4 0z'],
  },
  'tab-categories': {
    label: 'Categories',
    d: ['M3.4 11V4a.8.8 0 0 1 .8-.8h7l9.4 9.4-7.8 7.8z', 'M8.4 8.4a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0z'],
    filled: ['M3.4 11V4a.8.8 0 0 1 .8-.8h7l9.4 9.4-7.8 7.8z'],
    knockout: ['M8.4 8.4a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0z'],
  },
});

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** The ten category hues, as token names. Index is stable; order is not meaning. */
export const CATEGORY_TOKENS = Object.freeze([
  'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5',
  'cat-6', 'cat-7', 'cat-8', 'cat-9', 'cat-10',
]);

export const hasIcon = (name) => Object.hasOwn(ICONS, name);

/** Unknown names resolve to `other` rather than rendering an empty chip. */
export const iconOrFallback = (name) => (hasIcon(name) ? name : 'other');
