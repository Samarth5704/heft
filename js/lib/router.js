/**
 * router.js — the whole router. No library, no dependencies, no DOM.
 *
 * The URL is the view state. `#/analysis?period=2026-08&mode=monthly&cat=food`
 * says which tab, which period, which view mode and which filters, so any
 * screen is linkable, survives a reload, and steps backwards with the browser
 * button rather than trapping the user on one pane.
 *
 * Parsing is total: an unknown tab, a malformed period or a junk view mode
 * each fall back rather than throwing. A hand-edited URL should degrade to
 * something sensible, never break the app.
 */

export const TABS = Object.freeze(['records', 'analysis', 'budgets', 'accounts', 'categories']);
/** The same six names `dates.periodRange` accepts. There is one vocabulary
 *  for view modes and this is it — a route carrying a mode `dates.js` cannot
 *  read would produce a null range and an empty pane. */
export const VIEW_MODES = Object.freeze(['daily', 'weekly', 'monthly', '3-month', '6-month', 'yearly']);
/** The same three names `analytics.VIEWS` uses. One vocabulary, again. */
export const ANALYSIS_VIEWS = Object.freeze(['expense', 'income', 'net']);

export const DEFAULT_ROUTE = Object.freeze({
  tab: 'records',
  // 'YYYY-MM' or 'YYYY-MM-DD'; null means "whatever today is in". The month
  // form is what the month-and-longer modes need, and it keeps the common URL
  // short. Daily and weekly need to say which day, so they write the full
  // date. Both parse; `anchorOf` collapses them to the one thing every
  // consumer actually wants, a date to hand `periodRange`.
  period: null,
  mode: 'monthly',
  // Which figures the Analysis tab is analysing. It belongs in the URL for
  // the same reason the period does: "income, last six months" is a screen
  // worth linking to, and a back button that stepped the period but not the
  // view would take you somewhere you had never been.
  view: 'expense',
  kinds: [],
  categoryIds: [],
  accountIds: [],
  query: '',
});

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isPeriod = (v) => MONTH_RE.test(v) || DATE_RE.test(v);
const SEP = ',';

const listOf = (params, key) => {
  const raw = params.get(key);
  return raw === null ? [] : raw.split(SEP).map((s) => s.trim()).filter(Boolean);
};

/** @returns {typeof DEFAULT_ROUTE} */
export function parseRoute(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const segment = pathPart.replace(/^\/+/, '').split('/')[0]?.toLowerCase() ?? '';
  const params = new URLSearchParams(queryPart);

  const period = params.get('period');
  const mode = params.get('mode');
  const view = params.get('view');

  return {
    tab: TABS.includes(segment) ? segment : DEFAULT_ROUTE.tab,
    period: period && isPeriod(period) ? period : null,
    mode: mode && VIEW_MODES.includes(mode) ? mode : DEFAULT_ROUTE.mode,
    view: view && ANALYSIS_VIEWS.includes(view) ? view : DEFAULT_ROUTE.view,
    kinds: listOf(params, 'kind'),
    categoryIds: listOf(params, 'cat'),
    accountIds: listOf(params, 'acct'),
    query: params.get('q') ?? '',
  };
}

/**
 * Serialise back to a hash. Defaults are omitted, so the common case is a
 * clean `#/records` rather than a wall of empty parameters.
 */
export function routeToHash(route) {
  const r = { ...DEFAULT_ROUTE, ...route };
  const params = new URLSearchParams();
  if (r.period) params.set('period', r.period);
  if (r.mode !== DEFAULT_ROUTE.mode) params.set('mode', r.mode);
  if (r.view !== DEFAULT_ROUTE.view) params.set('view', r.view);
  if (r.kinds.length) params.set('kind', r.kinds.join(SEP));
  if (r.categoryIds.length) params.set('cat', r.categoryIds.join(SEP));
  if (r.accountIds.length) params.set('acct', r.accountIds.join(SEP));
  if (r.query.trim()) params.set('q', r.query.trim());
  // `URLSearchParams` percent-encodes the comma, which turns a readable
  // `cat=food,rent` into `cat=food%2Crent`. A comma is a legal sub-delimiter
  // in a query and is not a separator URLSearchParams itself honours, so
  // putting it back is safe in both directions — and these URLs are meant to
  // be copied and read by people. Category and account ids are slugs, so a
  // comma can never appear inside a value and become ambiguous.
  const qs = params.toString().replace(/%2C/g, ',');
  return `#/${r.tab}${qs ? `?${qs}` : ''}`;
}

export const sameRoute = (a, b) => routeToHash(a) === routeToHash(b);

/**
 * The route's period as a full date, which is what `periodRange` takes.
 *
 * A month key anchors on its first day. That is not arbitrary: every
 * month-and-longer range is derived from the anchor's *month*, so any day in
 * it produces the same range, and the first is the one that reads cleanly if
 * it ever surfaces in a URL.
 *
 * @param {{period: string|null}} route
 * @param {string} todayISO used when the route names no period at all
 */
export function anchorOf(route, todayISO) {
  const period = route?.period ?? null;
  if (period && DATE_RE.test(period)) return period;
  if (period && MONTH_RE.test(period)) return `${period}-01`;
  return todayISO;
}

/**
 * How a mode wants its anchor written back into the URL. Daily and weekly
 * need the day; the rest would only be carrying noise, and a mode switch from
 * daily to monthly should leave `#/records?period=2026-08`, not a date.
 */
export function periodFor(mode, anchorISO) {
  return mode === 'daily' || mode === 'weekly' ? anchorISO : anchorISO.slice(0, 7);
}

/**
 * The live router. `window` is injected so the whole thing is testable
 * headlessly against a stub.
 *
 * @param {{win?: Window, onChange: (route, prev) => void}} opts
 */
export function createRouter({ win = globalThis, onChange }) {
  let current = parseRoute(win.location?.hash ?? '');
  /** Set while we are the ones writing, so our own write is not read back. */
  let writing = false;

  function read() {
    if (writing) return;
    const next = parseRoute(win.location.hash);
    if (sameRoute(next, current)) return;
    const prev = current;
    current = next;
    onChange(current, prev);
  }

  /**
   * @param {object} patch partial route
   * @param {{replace?: boolean}} [opts] `replace` for changes that should not
   *   add a history entry — normalising the URL on first paint, mostly.
   */
  function go(patch, { replace = false } = {}) {
    const next = { ...current, ...patch };
    const hash = routeToHash(next);
    const url = `${win.location.pathname}${win.location.search}${hash}`;
    const changed = !sameRoute(next, current);
    const prev = current;
    current = next;

    writing = true;
    if (replace) win.history.replaceState(null, '', url);
    else win.history.pushState(null, '', url);
    writing = false;

    if (changed) onChange(current, prev);
  }

  win.addEventListener('hashchange', read);
  win.addEventListener('popstate', read);

  return {
    get route() { return current; },
    go,
    /** Normalise whatever came in and paint once. */
    start() {
      go(current, { replace: true });
      onChange(current, null);
      return current;
    },
    stop() {
      win.removeEventListener('hashchange', read);
      win.removeEventListener('popstate', read);
    },
  };
}
