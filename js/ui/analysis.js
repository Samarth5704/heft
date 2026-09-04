/**
 * analysis.js — the Analysis tab. Every chart is hand-written inline SVG.
 *
 * No charting library, no canvas, no markup hidden in template strings: the
 * SVG is built with createElementNS, which is also what makes each shape
 * addressable for the accessibility wiring below.
 *
 * Four panels, one switch. The switch says which of the three views —
 * expense, income, net — every panel is a view *of*, and it lives in the URL,
 * so "income, last six months" is a linkable screen. A panel never decides
 * for itself what it is summing: it is handed a view and asks
 * `analytics.viewAmount`, which is the single place the transfer rule lives.
 *
 * Accessibility is structural here, not a pass at the end. Every chart is a
 * <figure> whose SVG takes its accessible name from the panel title plus a
 * one-sentence plain-language takeaway, and is described by a visually-hidden
 * <table> carrying the same numbers — ungrouped, so a reader who cannot see
 * the ring still gets the categories the ring folded into "Other". The
 * insight first, then the data.
 */

import { applyFilters, describeFilters, hasNarrowingFilters, makeFilters } from '../lib/filters.js';
import { anchorOf } from '../lib/router.js';
import {
  addDays, formatMonth, isInRange, parts, periodLength, periodRange, periodsEndingAt,
} from '../lib/dates.js';
import {
  byCategory, dailySpendStatsForRange, dailyTotalsBetween, expenseTotalPaise,
  inRange, incomeTotalPaise, netPaise, periodTotalsSeries, rollingAverage,
} from '../lib/analytics.js';
import {
  OTHER_SLICE_ID, barSpanFor, bucketDays, enforceMinShare, groupSmallSlices,
  shadeFor, signedTicks,
} from '../lib/chart.js';
import { donutSegments, linePath } from '../lib/geometry.js';
import { formatAmount } from '../lib/money.js';
import { money, netMoney } from '../lib/format.js';
import { icon } from './icon.js';
import { paintChoice, wireChoice } from './choice.js';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

const svg = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
};

const el = (name, className, text) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * A share as a percentage. Anything that rounds to nothing is reported as
 * "<1%" rather than "0%", which would say a real amount was nothing at all.
 */
function pct(fraction) {
  const value = (fraction ?? 0) * 100;
  if (value > 0 && value < 0.5) return '<1%';
  return `${Math.round(value)}%`;
}

/* ----------------------------------------------------------- the views --
   One table, so a view is never half-implemented: whatever a panel needs to
   say about "expense" it finds here, in the same shape, for "net" too. */

const VIEW_META = {
  expense: {
    title: 'Expense overview',
    noun: 'spending',
    verb: 'spent',
    ring: 'Where the money went',
    daily: 'Day by day',
    periods: 'Six periods of spending',
    cost: 'What a day costs',
  },
  income: {
    title: 'Income overview',
    noun: 'income',
    verb: 'earned',
    ring: 'Where the money came from',
    daily: 'Day by day',
    periods: 'Six periods of income',
    cost: 'What a day brings in',
  },
  net: {
    title: 'Net overview',
    noun: 'net',
    verb: 'netted',
    ring: 'In against out',
    daily: 'Day by day',
    periods: 'Six periods, net',
    cost: 'What a day leaves you',
  },
};

/** How many bars the trailing average looks back over, by bucket width. */
const ROLLING_BARS = { 1: 7, 7: 4 };

/** The two pseudo-categories the net ring is made of. */
const NET_ROWS = [
  { id: 'in', name: 'Money in', sign: '+' },
  { id: 'out', name: 'Money out', sign: '−' },
];

export function createAnalysis({ store, router, announce, today }) {
  const els = {
    pane: $('pane-analysis'),
    panels: $('analysis-panels'),
    empty: $('analysis-empty'),
    emptyBody: $('analysis-empty-body'),
    note: $('analysis-note'),
    toggle: $('view-toggle'),
    title: $('view-title'),
    choices: $('opt-view'),
    template: $('tpl-panel'),
  };

  els.toggle.append(icon('chevron'));

  let snap = store.getState();
  let uid = 0;

  /** Whether the grouped "Other" row is expanded. Survives every repaint. */
  let otherOpen = false;

  const display = () => ({ showDecimals: snap.data.settings.showDecimals !== false });
  const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));
  const weekStart = () => snap.data.settings.weekStartsOn ?? 1;
  const amount = (paise) => money(paise, display());

  /* --------------------------------------------------------- the switch */

  wireChoice(els.choices, (value) => {
    if (!VIEW_META[value]) return;
    router.go({ view: value });
    announce.say(`${VIEW_META[value].title} shown.`);
  });

  els.toggle.addEventListener('click', () => {
    const open = els.toggle.getAttribute('aria-expanded') === 'true';
    els.toggle.setAttribute('aria-expanded', String(!open));
    els.choices.hidden = open;
    if (!open) els.choices.querySelector('[aria-checked="true"]')?.focus();
  });

  /* ---------------------------------------------------------- the panel */

  /**
   * A panel shell: title, one-sentence summary, a body for the drawing, and
   * the hidden table that carries the same numbers.
   */
  function panel({ title, summary, tableCaption, columns, rows }) {
    uid += 1;
    const figure = els.template.content.firstElementChild.cloneNode(true);
    const titleEl = figure.querySelector('.panel-title');
    const summaryEl = figure.querySelector('.panel-summary');
    const body = figure.querySelector('.panel-body');
    const tableWrap = figure.querySelector('.panel-table-wrap');
    const table = tableWrap.querySelector('.panel-table');

    const ids = {
      titleId: `chart-${uid}-title`,
      summaryId: `chart-${uid}-summary`,
      tableId: `chart-${uid}-table`,
    };

    titleEl.id = ids.titleId;
    titleEl.textContent = title;
    summaryEl.id = ids.summaryId;
    summaryEl.textContent = summary;
    table.id = ids.tableId;
    table.querySelector('caption').textContent = tableCaption ?? '';

    // A panel whose content is already text needs no hidden duplicate of it.
    if (!columns) {
      tableWrap.remove();
      ids.tableId = null;
      return { figure, body, ids };
    }

    table.querySelector('thead tr').replaceChildren(...columns.map((label, i) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      if (i > 0) th.className = 'num';
      return th;
    }));

    table.querySelector('tbody').replaceChildren(...rows.map((cells) => {
      const tr = document.createElement('tr');
      tr.append(...cells.map((value, i) => {
        const cell = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) cell.scope = 'row';
        else cell.className = 'num';
        cell.textContent = value;
        return cell;
      }));
      return tr;
    }));

    return { figure, body, ids };
  }

  /** An SVG wired into its panel's name and description. */
  const chartSvg = (ids, viewBox, extraClass, view) => svg('svg', {
    viewBox,
    class: `chart ${extraClass ?? ''}`.trim(),
    // Which view is being drawn decides whether a mark carries a sign at all.
    'data-view': view ?? null,
    role: 'img',
    'aria-labelledby': `${ids.titleId} ${ids.summaryId}`,
    'aria-describedby': ids.tableId ?? null,
    preserveAspectRatio: 'xMidYMid meet',
  });

  const emptyNote = (text) => el('p', 'panel-empty', text);

  /* ---------------------------------------------------------- the slices --
     The ring's rows, whatever the view. Expense and income come from the
     category aggregation; net has exactly two, because a "net by category"
     would be a category's income minus its expense, which is a number nobody
     has ever wanted. In against out answers the question the view asks. */

  function slicesFor(view, scoped, categoriesById) {
    if (view === 'net') {
      const rows = [
        { categoryId: 'in', totalPaise: incomeTotalPaise(scoped) },
        { categoryId: 'out', totalPaise: expenseTotalPaise(scoped) },
      ].filter((r) => r.totalPaise > 0);
      const total = rows.reduce((sum, r) => sum + r.totalPaise, 0);
      return {
        slices: rows.map((r) => ({ ...r, share: total ? r.totalPaise / total : 0 })),
        other: null,
        total,
      };
    }

    const rows = byCategory(scoped, view);
    const total = rows.reduce((sum, r) => sum + r.totalPaise, 0);
    const { slices, other } = groupSmallSlices(rows);
    return { slices, other, total, rows, categoriesById };
  }

  /** The look of one slice: its hue, and how far down the value ramp it sits. */
  function sliceStyle(view, row, index, count, categoriesById) {
    if (view === 'net') {
      const meta = NET_ROWS.find((n) => n.id === row.categoryId);
      return { hue: `var(--money-${meta.id})`, shade: 0, name: meta.name, sign: meta.sign };
    }
    if (row.categoryId === OTHER_SLICE_ID) {
      return {
        hue: 'var(--cat-neutral)', shade: shadeFor(index, count), name: 'Other', icon: 'other',
      };
    }
    const cat = categoriesById[row.categoryId];
    return {
      hue: `var(--${cat?.colorToken ?? 'cat-neutral'})`,
      shade: shadeFor(index, count),
      name: cat?.name ?? row.categoryId,
      icon: cat?.icon ?? 'other',
    };
  }

  /**
   * The one colour a slice and its row in the list both use, so the ring and
   * the list can be matched by eye — including in greyscale, where the ramp
   * is the only thing left to match on.
   */
  const sliceColour = (style) => (style.shade
    ? `color-mix(in oklab, ${style.hue}, var(--ink) ${style.shade}%)`
    : style.hue);

  /* ------------------------------------------------- the donut + ranking */

  function ringPanel(view, scoped, range, categoriesById) {
    const meta = VIEW_META[view];
    const { slices, other, total } = slicesFor(view, scoped, categoriesById);
    const styles = slices.map((row, i) => sliceStyle(view, row, i, slices.length, categoriesById));
    const summary = summariseRing(view, slices, styles, total, range);

    // The hidden table lists every category, ungrouped: the grouping is a
    // drawing decision, and a reader who cannot see the drawing should not
    // inherit its compromises.
    const tableRows = view === 'net'
      ? [
        ['Money in', amount(incomeTotalPaise(scoped)), pct(total ? incomeTotalPaise(scoped) / total : 0)],
        ['Money out', amount(expenseTotalPaise(scoped)), pct(total ? expenseTotalPaise(scoped) / total : 0)],
        ['Net', netMoney(netPaise(scoped), display()).text, ''],
      ]
      : byCategory(scoped, view).map((r) => [
        categoriesById[r.categoryId]?.name ?? r.categoryId,
        amount(r.totalPaise),
        pct(r.share),
      ]);

    const built = panel({
      title: meta.ring,
      summary,
      tableCaption: `${view === 'net' ? 'Money in and out' : `${capitalise(meta.noun)} by category`} for ${range?.label ?? 'the period'}`,
      columns: [view === 'net' ? 'Direction' : 'Category', 'Amount', 'Share'],
      rows: tableRows,
    });

    if (slices.length === 0) {
      built.body.append(emptyNote(`Nothing ${meta.verb} in ${range?.label ?? 'this period'}.`));
      return built.figure;
    }

    /* The ring. Values are floored to a minimum arc first, so a 0.4% slice is
       still visible; the amounts printed beside it are the true ones. */
    const node = chartSvg(built.ids, '0 0 200 200', 'donut', view);
    const drawn = enforceMinShare(slices.map((s) => s.totalPaise));
    const segments = donutSegments(drawn, { cx: 100, cy: 100, rOuter: 88, rInner: 58 });

    segments.forEach((segment, i) => {
      const style = styles[segment.index];
      node.append(svg('path', {
        d: segment.path,
        fill: sliceColour(style),
        // The full ring is two subpaths; evenodd is what punches out the hole.
        'fill-rule': segment.isFullCircle ? 'evenodd' : null,
        class: 'donut-seg',
        'data-other': slices[segment.index].categoryId === OTHER_SLICE_ID ? 'true' : null,
      }));
    });

    const centreTotal = view === 'net' ? netMoney(netPaise(scoped), display()).text : amount(total);
    const centre = svg('text', {
      x: 100, y: 97, class: 'donut-total', 'text-anchor': 'middle',
      // The hole is 116 units across and the figure inside it is not: '₹9,998'
      // and '−₹1,50,019.00' are the same element. A digit in this face runs
      // about 0.58 of its size, so the width a string wants is length × 0.58F
      // — solve that for the hole, less a margin, and the long figure stays
      // inside the ring instead of lying across two slices.
      'font-size': `${Math.max(12, Math.min(27, 104 / (centreTotal.length * 0.58)))}px`,
    });
    centre.textContent = centreTotal;
    const centreLabel = svg('text', { x: 100, y: 117, class: 'donut-label', 'text-anchor': 'middle' });
    centreLabel.textContent = view === 'net' ? 'net' : meta.verb;
    node.append(centre, centreLabel);

    const wrap = el('div', 'ring-wrap');
    wrap.append(node, rankedList(view, slices, styles, total, categoriesById));
    built.body.append(wrap);
    return built.figure;
  }

  /** The takeaway sentence: what a reader should learn without the drawing. */
  function summariseRing(view, slices, styles, total, range) {
    const meta = VIEW_META[view];
    const where = range?.label ?? 'this period';
    if (slices.length === 0) return `Nothing ${meta.verb} in ${where}.`;

    if (view === 'net') {
      const income = slices.find((s) => s.categoryId === 'in')?.totalPaise ?? 0;
      const expense = slices.find((s) => s.categoryId === 'out')?.totalPaise ?? 0;
      const net = income - expense;
      if (net === 0) return `${where} broke even: ${amount(income)} in, ${amount(expense)} out.`;
      return net > 0
        ? `You kept ${amount(net)} of the ${amount(income)} that came in during ${where}.`
        : `You spent ${amount(-net)} more than came in during ${where} — ${amount(expense)} out against ${amount(income)} in.`;
    }

    const top = slices[0];
    const name = styles[0].name;
    if (slices.length === 1) {
      return `Every rupee ${meta.verb} in ${where} went to ${name} — ${amount(top.totalPaise)}.`;
    }
    return `${name} was your largest ${view === 'income' ? 'source' : 'category'} at ${amount(top.totalPaise)}, ${pct(top.share)} of ${where}.`;
  }

  /**
   * The ranked list: icon, name, amount, a proportional bar, the percentage.
   * The bar and the number together are read faster than either alone, which
   * is the whole reason both are here.
   */
  function rankedList(view, slices, styles, total, categoriesById) {
    const list = el('ol', 'rank');
    list.setAttribute('role', 'list');
    const biggest = slices[0]?.totalPaise || 1;

    slices.forEach((row, i) => {
      const style = styles[i];
      const isOther = row.categoryId === OTHER_SLICE_ID;
      const item = el('li', 'rank-row');
      item.style.setProperty('--slice', sliceColour(style));

      const content = rankContent(view, row, style, biggest);

      if (!isOther) {
        item.append(content);
        list.append(item);
        return;
      }

      // "Other" is the one row that is a control: it is standing in for
      // several real categories, and tapping it says which.
      const button = el('button', 'rank-open');
      button.type = 'button';
      button.setAttribute('aria-expanded', String(otherOpen));
      button.dataset.focusKey = 'rank-other';
      button.append(content, icon('chevron'));
      button.addEventListener('click', () => {
        otherOpen = !otherOpen;
        announce.say(otherOpen
          ? `Other expanded: ${row.members.length} categories.`
          : 'Other collapsed.');
        repaint();
      });

      const sub = el('ul', 'rank-sub');
      sub.setAttribute('role', 'list');
      sub.hidden = !otherOpen;
      for (const member of row.members) {
        const cat = categoriesById[member.categoryId];
        const subItem = el('li', 'rank-row rank-row-sub');
        subItem.style.setProperty('--slice', `var(--${cat?.colorToken ?? 'cat-neutral'})`);
        subItem.append(rankContent(view, member, {
          hue: `var(--${cat?.colorToken ?? 'cat-neutral'})`,
          shade: 0,
          name: cat?.name ?? member.categoryId,
          icon: cat?.icon ?? 'other',
        }, biggest));
        sub.append(subItem);
      }

      item.append(button);
      list.append(item, sub);
    });

    return list;
  }

  /** One row's contents, shared by a plain row and by the "Other" button. */
  function rankContent(view, row, style, biggest) {
    const frag = document.createDocumentFragment();

    if (view === 'net') {
      // A swatch carrying the sign: colour, sign and word all say the same
      // thing, so none of them is doing the work alone.
      const swatch = el('span', 'rank-swatch', style.sign);
      swatch.setAttribute('aria-hidden', 'true');
      frag.append(swatch);
    } else {
      const chip = el('span', 'cat-chip rank-chip');
      chip.setAttribute('aria-hidden', 'true');
      chip.style.setProperty('--chip-color', 'var(--slice)');
      chip.append(icon(style.icon ?? 'other'));
      frag.append(chip);
    }

    const main = el('div', 'rank-main');
    main.append(el('p', 'rank-name', style.name));

    const track = el('div', 'rank-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'rank-fill');
    // Proportional to the largest row, not to the total: at 74% of a month
    // the leader's bar should be nearly full, or the ranking reads as flat.
    fill.style.inlineSize = `${Math.max(2, (row.totalPaise / biggest) * 100)}%`;
    track.append(fill);
    main.append(track);

    const figures = el('div', 'rank-figures');
    figures.append(
      el('p', 'rank-amount num', amount(row.totalPaise)),
      el('p', 'rank-share num', pct(row.share)),
    );

    frag.append(main, figures);
    return frag;
  }

  /* -------------------------------------------- daily bars + trailing line */

  function dailyPanel(view, scoped, range) {
    const meta = VIEW_META[view];
    const days = periodLength(range);
    const span = barSpanFor(days);
    const window = ROLLING_BARS[span];

    // The trailing average has to reach back before the period starts, or the
    // line would restart from nothing on the first of every month. The lead-in
    // is a whole number of buckets, so the period's own buckets stay aligned
    // to the period rather than to the lead-in.
    const lead = window * span;
    const series = dailyTotalsBetween(scoped, addDays(range.start, -lead), range.end, view);
    const buckets = bucketDays(series, span);
    const averaged = rollingAverage(buckets.map((b) => b.totalPaise), window).slice(window);
    const bars = buckets.slice(window);

    const values = bars.map((b) => b.totalPaise);
    const maxPaise = Math.max(0, ...values);
    const minPaise = Math.min(0, ...values);
    const axis = signedTicks(minPaise / 100, maxPaise / 100, 4);

    const busiest = bars.reduce(
      (a, b) => (Math.abs(b.totalPaise) > Math.abs(a?.totalPaise ?? -1) ? b : a),
      null,
    );
    const active = bars.filter((b) => b.totalPaise !== 0).length;
    const unit = span === 1 ? 'day' : 'week';

    const summary = maxPaise === 0 && minPaise === 0
      ? `Nothing ${meta.verb} on any ${unit} of ${range.label}.`
      : `You ${meta.verb} something on ${active} of ${bars.length} ${unit}s; the heaviest was ${labelFor(busiest, span)} at ${amount(Math.abs(busiest.totalPaise))}.`;

    const built = panel({
      title: span === 1 ? meta.daily : 'Week by week',
      summary,
      tableCaption: `${span === 1 ? 'Daily' : 'Weekly'} ${meta.noun} and its ${window}-${unit} trailing average for ${range.label}`,
      columns: [span === 1 ? 'Day' : 'Week', 'Amount', 'Trailing average'],
      rows: bars.map((bar, i) => [
        labelFor(bar, span, { full: true }),
        signedAmount(view, bar.totalPaise),
        signedAmount(view, averaged[i] ?? 0),
      ]),
    });

    if (maxPaise === 0 && minPaise === 0) {
      built.body.append(emptyNote(`Nothing ${meta.verb} in ${range.label} yet.`));
      return built.figure;
    }

    const W = 660;
    const H = 240;
    const PAD = { top: 14, right: 12, bottom: 28, left: 56 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const hi = axis.max * 100;
    const lo = axis.min * 100;
    const y = (paise) => PAD.top + plotH - ((paise - lo) / (hi - lo)) * plotH;
    const zero = y(0);
    const step = plotW / bars.length;
    const barW = Math.max(2, step * 0.62);

    const node = chartSvg(built.ids, `0 0 ${W} ${H}`, 'bars', view);

    // Gridlines from the nice-numbers algorithm, so the labels read
    // 0 / 500 / 1,000 rather than the maximum divided by five.
    for (const tick of axis.ticks) {
      const yy = y(tick * 100);
      node.append(svg('line', {
        x1: PAD.left, x2: W - PAD.right, y1: yy, y2: yy,
        class: `grid-line${tick === 0 ? ' grid-zero' : ''}`,
      }));
      const label = svg('text', {
        x: PAD.left - 8, y: yy + 4, class: 'axis-label', 'text-anchor': 'end',
      });
      label.textContent = formatAmount(tick * 100);
      node.append(label);
    }

    const nowIndex = bars.findIndex((b) => isInRange(today, { start: b.start, end: b.end }));

    const barGroup = svg('g', { class: 'bar-group' });
    bars.forEach((bar, i) => {
      const value = bar.totalPaise;
      const top = value >= 0 ? y(value) : zero;
      const height = Math.max(value !== 0 ? 1.5 : 0, Math.abs(y(value) - zero));
      const x = PAD.left + i * step + (step - barW) / 2;
      const isNow = isInRange(today, { start: bar.start, end: bar.end });

      barGroup.append(svg('rect', {
        x, y: top, width: barW, height,
        class: `bar${isNow ? ' bar-today' : ''}`,
        'data-tone': value < 0 ? 'out' : 'in',
        style: `--bar-base: ${zero}px`,
      }));

      const label = tickLabelFor(bar, bars[i - 1], i, bars.length, span, isNow, nowIndex);
      if (label) {
        const text = svg('text', {
          x: x + barW / 2, y: H - 9,
          class: `axis-label day-label${isNow ? ' is-today' : ''}`,
          'text-anchor': 'middle',
        });
        text.textContent = label;
        node.append(text);
      }
    });
    node.append(barGroup);

    const points = bars.map((bar, i) => ({
      x: PAD.left + i * step + step / 2,
      y: y(Math.min(hi, Math.max(lo, averaged[i] ?? 0))),
    }));
    node.append(svg('path', { d: linePath(points), class: 'trend-line', fill: 'none' }));

    // The key describes the marks that are actually on the chart. In the net
    // view that is two of them, because a bar there can point either way.
    built.body.append(node, chartKey(view === 'net' ? [
      { className: 'key-bar key-bar-in', label: `Ended that ${unit} up` },
      { className: 'key-bar key-bar-out', label: `Ended that ${unit} down` },
      { className: 'key-line', label: `${window}-${unit} trailing average` },
    ] : [
      { className: 'key-bar', label: `${capitalise(meta.noun)} that ${unit}` },
      { className: 'key-line', label: `${window}-${unit} trailing average` },
    ]));
    return built.figure;
  }

  /* ----------------------------------------------- period over period */

  function periodsPanel(view, scoped, route, range) {
    const meta = VIEW_META[view];
    const anchor = anchorOf(route, today);
    const periods = periodsEndingAt(route.mode, anchor, 6, weekStart());
    const series = periodTotalsSeries(scoped, periods);
    const values = series.map((p) => valueOf(view, p));

    const extent = Math.max(...values.map(Math.abs), 0);
    const current = values[values.length - 1] ?? 0;
    const previous = values[values.length - 2] ?? 0;

    const summary = extent === 0
      ? `No ${meta.noun} in the last six periods.`
      : previous !== 0
        ? `${range.label} is ${Math.abs(current) >= Math.abs(previous) ? 'above' : 'below'} ${periods[periods.length - 2].label} by ${amount(Math.abs(current - previous))}.`
        : `${range.label} totals ${signedAmount(view, current)}.`;

    const built = panel({
      title: meta.periods,
      summary,
      tableCaption: `${capitalise(meta.noun)} for the last six periods`,
      columns: ['Period', capitalise(meta.noun)],
      rows: series.map((p, i) => [p.label, signedAmount(view, values[i])]),
    });

    if (extent === 0) {
      built.body.append(emptyNote('No history to compare against yet.'));
      return built.figure;
    }

    const W = 480;
    const H = 176;
    const PAD = { top: 26, bottom: 32 };
    const plotH = H - PAD.top - PAD.bottom;
    const hasNegative = values.some((v) => v < 0);
    const hi = extent;
    const lo = hasNegative ? -extent : 0;
    const y = (v) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
    const zero = y(0);
    const step = W / series.length;
    const barW = step * 0.5;

    const node = chartSvg(built.ids, `0 0 ${W} ${H}`, 'periods', view);
    if (hasNegative) {
      node.append(svg('line', { x1: 0, x2: W, y1: zero, y2: zero, class: 'grid-line grid-zero' }));
    }

    series.forEach((period, i) => {
      const value = values[i];
      const isCurrent = i === series.length - 1;
      const height = Math.max(value !== 0 ? 2 : 0, Math.abs(y(value) - zero));
      const x = i * step + (step - barW) / 2;

      node.append(svg('rect', {
        x, y: value >= 0 ? y(value) : zero, width: barW, height, rx: 1,
        class: `period-bar${isCurrent ? ' is-current' : ''}`,
        'data-tone': value < 0 ? 'out' : 'in',
        style: `--bar-base: ${zero}px`,
      }));

      const label = svg('text', {
        x: x + barW / 2, y: H - 11,
        class: `axis-label${isCurrent ? ' is-today' : ''}`,
        'text-anchor': 'middle',
      });
      label.textContent = shortLabel(route.mode, period);
      node.append(label);

      if (isCurrent) {
        const figure = svg('text', {
          x: x + barW / 2,
          y: (value >= 0 ? y(value) : zero + height) - (value >= 0 ? 8 : -16),
          class: 'bar-value', 'text-anchor': 'middle',
        });
        figure.textContent = amount(Math.abs(value));
        node.append(figure);
      }
    });

    built.body.append(node);
    return built.figure;
  }

  /* ---------------------------------------------------- mean vs median */

  function dayCostPanel(view, scoped, range) {
    const meta = VIEW_META[view];
    const stats = dailySpendStatsForRange(scoped, range, today, view);
    const ratio = stats.medianPaise ? stats.meanPaise / stats.medianPaise : null;

    const summary = summariseDayCost(view, stats, ratio);
    const built = panel({ title: meta.cost, summary });

    const pair = el('div', 'figure-pair');
    for (const [label, value, note] of [
      ['Median', stats.medianPaise, 'an ordinary day'],
      ['Mean', stats.meanPaise, 'the average day'],
    ]) {
      const cell = el('div', 'figure-cell');
      const figure = el('p', 'figure-value num');
      const sym = el('span', 'money-sym', '₹');
      sym.setAttribute('aria-hidden', 'true');
      // The tile and the sentence above it are the same figure, so they take
      // the same decimals setting — one saying ₹2,420 while the other says
      // ₹2,419.97 reads as two different numbers.
      figure.append(
        value < 0 ? '−' : '', sym,
        formatAmount(Math.abs(value), { paise: display().showDecimals }),
      );
      cell.append(el('p', 'figure-label', label), figure, el('p', 'figure-note', note));
      pair.append(cell);
    }
    built.body.append(pair, el('p', 'figure-explainer', EXPLAINER[view]));
    return built.figure;
  }

  const EXPLAINER = {
    expense: 'Rent and one-off buys drag the mean upward. The median ignores them, so it is the number that tells you what a normal day actually costs.',
    income: 'Income arrives in a few lumps and the mean spreads them across every day of the period. The median is what most days actually bring in — usually nothing, which is the point.',
    net: 'The mean is the period divided evenly; the median is the middle day. A large gap between them means a few days did most of the damage, or most of the earning.',
  };

  function summariseDayCost(view, stats, ratio) {
    const meta = VIEW_META[view];
    if (stats.days === 0) return 'No days have elapsed in this period yet.';
    if (stats.totalPaise === 0) {
      return `Nothing ${meta.verb} across ${stats.days} ${stats.days === 1 ? 'day' : 'days'} so far.`;
    }
    if (view === 'net') {
      const median = stats.medianPaise;
      const word = median < 0 ? 'costs you' : median > 0 ? 'leaves you up' : 'breaks even at';
      return `An ordinary day ${word} ${amount(Math.abs(median))}, against a mean of ${signedAmount(view, stats.meanPaise)} — the mean carries the lumps.`;
    }
    if (view === 'income' && stats.medianPaise === 0) {
      return `Most days bring in nothing; the ${amount(stats.totalPaise)} arrived on a few of them, which is why the mean says ${amount(stats.meanPaise)}.`;
    }
    return ratio && ratio >= 1.25
      ? `An ordinary day ${view === 'income' ? 'brings in' : 'costs'} ${amount(stats.medianPaise)}. The mean is ${amount(stats.meanPaise)}, pulled up by the big one-offs.`
      : `An ordinary day ${view === 'income' ? 'brings in' : 'costs'} ${amount(stats.medianPaise)}, close to the mean of ${amount(stats.meanPaise)} — this period had few outliers.`;
  }

  /* ------------------------------------------------------------ helpers */

  const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const valueOf = (view, totals) => {
    if (view === 'income') return totals.incomePaise;
    if (view === 'net') return totals.netPaise;
    return totals.expensePaise;
  };

  /** Signed only where a sign means something: net can go either way. */
  const signedAmount = (view, paise) => (view === 'net'
    ? netMoney(paise, display()).text
    : amount(Math.abs(paise)));

  function chartKey(items) {
    const wrap = el('div', 'chart-key');
    for (const item of items) {
      const entry = el('span', 'chart-key-item');
      const swatch = el('span', `key-swatch ${item.className}`);
      swatch.setAttribute('aria-hidden', 'true');
      entry.append(swatch, item.label);
      wrap.append(entry);
    }
    return wrap;
  }

  /** '12 Aug' for a day, '12–18 Aug' for a bucket. */
  function labelFor(bucket, span, { full = false } = {}) {
    if (!bucket) return '';
    const a = parts(bucket.start);
    const b = parts(bucket.end);
    const mon = (p) => formatMonth(`${p.year}-${String(p.month).padStart(2, '0')}`, { short: true });
    if (span === 1) return full ? `${a.day} ${mon(a)}` : `${a.day} ${mon(a).split(' ')[0]}`;
    if (a.month === b.month) return `${a.day}–${b.day} ${mon(b)}`;
    return `${a.day} ${mon(a).split(' ')[0]} – ${b.day} ${mon(b)}`;
  }

  /** Which bars get a label. Too many is a smear; none is a mystery. */
  function tickLabelFor(bar, before, i, count, span, isNow, nowIndex) {
    if (isNow) return span === 1 ? 'today' : 'now';
    if (span === 1) {
      const day = Number(bar.start.slice(8));
      const dense = count > 40;
      return (day === 1 || day % (dense ? 14 : 7) === 0) ? String(day) : null;
    }
    // Weekly buckets are labelled by the month they open, not by their own
    // dates: fifty-three '23–29's along one axis is a smear, and the thing a
    // reader is placing a week against is the month anyway.
    const here = parts(bar.start);
    const previous = before ? parts(before.start) : null;
    if (previous && previous.month === here.month) return null;
    // 'now' takes the space its neighbour would have used. Where the two
    // would land on top of each other, the month is the one that gives way:
    // it repeats twelve times a year and the marker happens once.
    if (nowIndex >= 0 && Math.abs(i - nowIndex) <= 1) return null;
    return formatMonth(`${here.year}-${String(here.month).padStart(2, '0')}`, { short: true })
      .split(' ')[0];
  }

  /** A period's name, short enough to sit under a bar. */
  function shortLabel(mode, range) {
    const a = parts(range.start);
    const b = parts(range.end);
    const short = (p) => formatMonth(`${p.year}-${String(p.month).padStart(2, '0')}`, { short: true });
    if (mode === 'yearly') return String(a.year);
    if (mode === 'daily') return `${a.day} ${short(a).split(' ')[0]}`;
    if (mode === 'weekly') return `${a.day} ${short(a).split(' ')[0]}`;
    if (mode === 'monthly') {
      // January says which January. Six bars crossing a new year otherwise
      // show two identically named months side by side.
      return a.month === 1 ? short(a) : short(a).split(' ')[0];
    }
    return `${short(a).split(' ')[0]}–${short(b).split(' ')[0]}`;
  }

  /* ---------------------------------------------------------- the paint */

  /**
   * Analysis reads the same URL filters the Records tab does, minus `kinds`:
   * on this tab the view switch is the kind control, and honouring both would
   * let a route ask for the expense view of income records and get a blank
   * pane with nothing to explain it. Everything else narrows the numbers, so
   * the note says so rather than leaving the figures quietly wrong-looking.
   */
  function filtersFor(route) {
    return makeFilters({
      categoryIds: route.categoryIds,
      accountIds: route.accountIds,
      query: route.query,
    });
  }

  let lastRoute = null;

  function paint(route = router.route) {
    lastRoute = route;
    const view = VIEW_META[route.view] ? route.view : 'expense';
    const meta = VIEW_META[view];
    const range = periodRange(route.mode, anchorOf(route, today), weekStart());

    els.title.textContent = meta.title;
    paintChoice(els.choices, view);

    const filters = filtersFor(route);
    const scoped = applyFilters(snap.data.transactions, filters);
    const inPeriod = inRange(scoped, range);
    const categoriesById = byId(snap.data.categories);

    // The note is only worth a line when something is actually narrowing.
    const narrowed = hasNarrowingFilters(filters);
    els.note.hidden = !narrowed;
    if (narrowed) {
      els.note.textContent = `Counting only ${describeFilters(filters, categoriesById, byId(snap.data.accounts))}.`;
    }

    const nothing = view === 'net'
      ? incomeTotalPaise(inPeriod) === 0 && expenseTotalPaise(inPeriod) === 0
      : valueOf(view, {
        expensePaise: expenseTotalPaise(inPeriod),
        incomePaise: incomeTotalPaise(inPeriod),
        netPaise: 0,
      }) === 0;

    els.empty.hidden = !nothing;
    els.panels.hidden = nothing;
    if (nothing) {
      els.emptyBody.textContent = snap.data.transactions.length === 0
        ? 'There is nothing recorded yet. Add a few transactions and this fills in on its own.'
        : `No ${meta.noun} in ${range?.label ?? 'this period'}. Step to another period, or switch what you are looking at.`;
      els.panels.replaceChildren();
      return;
    }

    // Charts are small and rebuilt whole; the reconciling renderer exists for
    // the ledger, where identity, focus and selection actually matter. What
    // does matter here is the one control inside the rebuilt subtree, so the
    // key it carries is what focus is restored to.
    const focusKey = document.activeElement?.dataset?.focusKey ?? null;

    els.panels.replaceChildren(
      ringPanel(view, inPeriod, range, categoriesById),
      dailyPanel(view, scoped, range),
      periodsPanel(view, scoped, route, range),
      dayCostPanel(view, scoped, range),
    );

    if (focusKey) els.panels.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  const repaint = () => paint(lastRoute ?? router.route);

  store.subscribe((next) => {
    snap = next;
    if (!els.pane.hidden) repaint();
  });

  return { paint };
}
