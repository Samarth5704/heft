/**
 * charts.js — every chart in the app, hand-drawn as inline SVG.
 *
 * No charting library, no canvas. Panels come from a <template>; the
 * data-driven SVG is built with createElementNS rather than HTML strings, so
 * there is no markup hidden in JavaScript.
 *
 * Accessibility is not an afterthought here. Each panel is a <figure> whose
 * SVG carries role="img", takes its accessible name from the title plus a
 * one-sentence takeaway, and is described by a visually-hidden <table> holding
 * the same numbers. A screen-reader user gets the insight, then the data.
 */

import { formatAmount, formatINR } from '../lib/money.js';
import { addDays, endOfMonth, formatMonth, startOfMonth } from '../lib/dates.js';
import {
  byCategory, dailySpendStats, dailyTotals, dailyTotalsBetween, monthOverMonth,
  niceTicks, rollingAverage, topExpenses, totalPaise,
} from '../lib/analytics.js';
import { donutSegments, linePath } from '../lib/geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ROLLING_WINDOW = 30;

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

const pct = (fraction) => `${Math.round(fraction * 100)}%`;

export function createCharts({ root, panelTemplate }) {
  let drawnFor = null;
  let uid = 0;

  /** Build a panel shell from the template and register its a11y wiring. */
  function panel({ title, summary, tableCaption, columns, rows }) {
    uid += 1;
    const figure = panelTemplate.content.firstElementChild.cloneNode(true);
    const titleEl = figure.querySelector('.panel-title');
    const summaryEl = figure.querySelector('.panel-summary');
    const body = figure.querySelector('.panel-body');
    const tableWrap = figure.querySelector('.panel-table-wrap');
    const table = tableWrap.querySelector('.panel-table');

    const titleId = `chart-${uid}-title`;
    const summaryId = `chart-${uid}-summary`;
    const tableId = `chart-${uid}-table`;

    titleEl.id = titleId;
    titleEl.textContent = title;
    summaryEl.id = summaryId;
    summaryEl.textContent = summary;
    table.id = tableId;
    table.querySelector('caption').textContent = tableCaption;

    // A panel whose content is already text needs no hidden duplicate of it.
    if (!columns) {
      tableWrap.remove();
      return { figure, body, ids: { titleId, summaryId, tableId: null } };
    }

    const head = table.querySelector('thead tr');
    head.replaceChildren(...columns.map((label, i) => {
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

    return { figure, body, ids: { titleId, summaryId, tableId } };
  }

  /** Wire an SVG into its panel's labels. */
  function chartSvg(ids, viewBox, extraClass) {
    return svg('svg', {
      viewBox,
      class: `chart ${extraClass ?? ''}`.trim(),
      role: 'img',
      'aria-labelledby': `${ids.titleId} ${ids.summaryId}`,
      'aria-describedby': ids.tableId ?? null,
      preserveAspectRatio: 'xMidYMid meet',
    });
  }

  /* ------------------------------------------------- mean versus median */

  function meanMedianPanel(expenses, key, today) {
    const stats = dailySpendStats(expenses, key, today);
    const ratio = stats.medianPaise ? stats.meanPaise / stats.medianPaise : null;

    const summary = stats.days === 0
      ? 'No days have elapsed in this month yet.'
      : stats.totalPaise === 0
        ? `Nothing spent across ${stats.days} ${stats.days === 1 ? 'day' : 'days'} so far.`
        : ratio && ratio >= 1.25
          ? `An ordinary day costs ${formatINR(stats.medianPaise)}. The average is ${formatINR(stats.meanPaise)}, pulled up by the big one-offs.`
          : `An ordinary day costs ${formatINR(stats.medianPaise)}, close to the average of ${formatINR(stats.meanPaise)} — this month had few outliers.`;

    const built = panel({
      title: 'What a day costs',
      summary,
      // No hidden table: both figures below are already readable text.
    });

    const pair = el('div', 'figure-pair');
    for (const [label, value, note] of [
      ['Median', stats.medianPaise, 'an ordinary day'],
      ['Mean', stats.meanPaise, 'the average day'],
    ]) {
      const cell = el('div', 'figure-cell');
      cell.append(
        el('p', 'figure-label', label),
        (() => {
          const p = el('p', 'figure-value num');
          const sym = el('span', 'sym', '₹');
          sym.setAttribute('aria-hidden', 'true');
          p.append(sym, formatAmount(value));
          return p;
        })(),
        el('p', 'figure-note', note),
      );
      pair.append(cell);
    }
    built.body.append(pair);

    // The one line of copy that explains why both numbers are here.
    built.body.append(el(
      'p',
      'figure-explainer',
      'Rent and one-off buys drag the mean upward. The median ignores them, so it is the number that tells you what a normal day actually costs.',
    ));
    return built.figure;
  }

  /* --------------------------------------------------------- the donut */

  function categoryPanel(expenses, key, categoriesById) {
    const rows = byCategory(expenses);
    const total = totalPaise(expenses);
    const top = rows[0];

    const summary = rows.length === 0
      ? `Nothing recorded in ${formatMonth(key)}.`
      : rows.length === 1
        ? `Every rupee this month went to ${categoriesById[top.categoryId]?.name ?? 'one category'} — ${formatINR(top.totalPaise)}.`
        : `${categoriesById[top.categoryId]?.name ?? 'One category'} was your largest at ${formatINR(top.totalPaise)}, ${pct(top.share)} of the month.`;

    const built = panel({
      title: 'Where the month went',
      summary,
      tableCaption: `Spending by category for ${formatMonth(key)}`,
      columns: ['Category', 'Amount', 'Share'],
      rows: rows.map((r) => [
        categoriesById[r.categoryId]?.name ?? r.categoryId,
        formatINR(r.totalPaise),
        pct(r.share),
      ]),
    });

    if (rows.length === 0) {
      built.body.append(emptyNote('No spending to divide up yet.'));
      return built.figure;
    }

    const wrap = el('div', 'donut-wrap');
    const node = chartSvg(built.ids, '0 0 200 200', 'donut');

    const segments = donutSegments(rows.map((r) => r.totalPaise), {
      cx: 100, cy: 100, rOuter: 88, rInner: 58,
    });
    segments.forEach((segment, i) => {
      const token = categoriesById[rows[segment.index].categoryId]?.colorToken ?? 'cat-neutral';
      node.append(svg('path', {
        d: segment.path,
        fill: `var(--${token})`,
        // The full ring is two subpaths; evenodd punches out the middle.
        'fill-rule': segment.isFullCircle ? 'evenodd' : null,
        class: 'donut-seg',
        style: `--i: ${i}`,
      }));
    });

    const centre = svg('text', { x: 100, y: 96, class: 'donut-total', 'text-anchor': 'middle' });
    centre.textContent = formatINR(total);
    const centreLabel = svg('text', { x: 100, y: 116, class: 'donut-label', 'text-anchor': 'middle' });
    centreLabel.textContent = formatMonth(key, { short: true });
    node.append(centre, centreLabel);

    const legend = el('ul', 'legend');
    legend.setAttribute('role', 'list');
    for (const row of rows) {
      const item = el('li', 'legend-row');
      const dot = el('span', 'cat-dot');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.setProperty('--cat', `var(--${categoriesById[row.categoryId]?.colorToken ?? 'cat-neutral'})`);
      item.append(
        dot,
        el('span', 'legend-name', categoriesById[row.categoryId]?.name ?? row.categoryId),
        el('span', 'legend-value num', formatINR(row.totalPaise)),
        el('span', 'legend-share num', pct(row.share)),
      );
      legend.append(item);
    }

    wrap.append(node, legend);
    built.body.append(wrap);
    return built.figure;
  }

  /* ------------------------------------- daily bars + rolling average */

  function dailyPanel(expenses, key, today) {
    const days = dailyTotals(expenses, key);
    const max = Math.max(0, ...days.map((d) => d.totalPaise));
    const axis = niceTicks(max / 100, 4); // ticks in rupees, not paise

    // A trailing 30-day average must reach back before the 1st, or the line
    // would restart from nothing every month.
    const first = startOfMonth(`${key}-01`);
    const last = endOfMonth(`${key}-01`);
    const window = dailyTotalsBetween(expenses, addDays(first, -(ROLLING_WINDOW - 1)), last);
    const averaged = rollingAverage(window.map((d) => d.totalPaise), ROLLING_WINDOW)
      .slice(ROLLING_WINDOW - 1);

    const busiest = days.reduce((a, b) => (b.totalPaise > a.totalPaise ? b : a), days[0] ?? null);
    const spentDays = days.filter((d) => d.totalPaise > 0).length;
    const summary = max === 0
      ? `No spending recorded on any day of ${formatMonth(key)}.`
      : `You spent on ${spentDays} of ${days.length} days; the heaviest was ${Number(busiest.date.slice(8))} ${formatMonth(key, { short: true }).split(' ')[0]} at ${formatINR(busiest.totalPaise)}.`;

    const built = panel({
      title: 'Day by day',
      summary,
      tableCaption: `Daily spending and 30-day trailing average for ${formatMonth(key)}`,
      columns: ['Day', 'Spent', '30-day average'],
      rows: days.map((d, i) => [
        `${Number(d.date.slice(8))} ${formatMonth(key, { short: true })}`,
        formatINR(d.totalPaise),
        formatINR(averaged[i] ?? 0),
      ]),
    });

    if (max === 0) {
      built.body.append(emptyNote('Nothing spent this month yet.'));
      return built.figure;
    }

    const W = 660;
    const H = 240;
    const PAD = { top: 14, right: 12, bottom: 26, left: 52 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const yMaxPaise = axis.max * 100;
    const y = (paise) => PAD.top + plotH - (paise / yMaxPaise) * plotH;
    const step = plotW / days.length;
    const barW = Math.max(2, step * 0.62);

    const node = chartSvg(built.ids, `0 0 ${W} ${H}`, 'bars');

    // Gridlines and axis labels, from the nice-numbers algorithm — so the
    // labels read 0 / 500 / 1,000 rather than max divided by five.
    for (const tick of axis.ticks) {
      const yy = y(tick * 100);
      node.append(svg('line', {
        x1: PAD.left, x2: W - PAD.right, y1: yy, y2: yy, class: 'grid-line',
      }));
      const label = svg('text', { x: PAD.left - 8, y: yy + 4, class: 'axis-label', 'text-anchor': 'end' });
      label.textContent = formatAmount(tick * 100);
      node.append(label);
    }

    const barGroup = svg('g', { class: 'bar-group' });
    days.forEach((day, i) => {
      const height = Math.max(day.totalPaise > 0 ? 1.5 : 0, (day.totalPaise / yMaxPaise) * plotH);
      const x = PAD.left + i * step + (step - barW) / 2;
      const isToday = day.date === today;
      barGroup.append(svg('rect', {
        x, y: PAD.top + plotH - height, width: barW, height,
        class: `bar${isToday ? ' bar-today' : ''}`,
        style: `--i: ${i}; --bar-base: ${PAD.top + plotH}px`,
      }));
      const dayNumber = Number(day.date.slice(8));
      if (dayNumber === 1 || dayNumber % 7 === 0 || isToday) {
        const label = svg('text', {
          x: x + barW / 2, y: H - 8,
          class: `axis-label day-label${isToday ? ' is-today' : ''}`,
          'text-anchor': 'middle',
        });
        label.textContent = isToday ? 'today' : String(dayNumber);
        node.append(label);
      }
    });
    node.append(barGroup);

    const points = days.map((day, i) => ({
      x: PAD.left + i * step + step / 2,
      y: y(Math.min(averaged[i] ?? 0, yMaxPaise)),
    }));
    node.append(svg('path', { d: linePath(points), class: 'trend-line', fill: 'none' }));

    built.body.append(node);
    built.body.append(legendKey([
      { className: 'key-bar', label: 'Spent that day' },
      { className: 'key-line', label: '30-day trailing average' },
    ]));
    return built.figure;
  }

  /* --------------------------------------------------- month over month */

  function monthsPanel(expenses, key) {
    const series = monthOverMonth(expenses, key, 6);
    const max = Math.max(0, ...series.map((m) => m.totalPaise));
    const current = series[series.length - 1];
    const previous = series[series.length - 2];
    const summary = max === 0
      ? 'No spending in the last six months.'
      : previous && previous.totalPaise > 0
        ? `${formatMonth(key, { short: true })} is ${current.totalPaise >= previous.totalPaise ? 'above' : 'below'} ${formatMonth(previous.monthKey, { short: true })} by ${formatINR(Math.abs(current.totalPaise - previous.totalPaise))}.`
        : `${formatMonth(key, { short: true })} totals ${formatINR(current.totalPaise)}.`;

    const built = panel({
      title: 'Six months',
      summary,
      tableCaption: 'Monthly totals for the last six months',
      columns: ['Month', 'Total'],
      rows: series.map((m) => [formatMonth(m.monthKey), formatINR(m.totalPaise)]),
    });

    if (max === 0) {
      built.body.append(emptyNote('No history to compare yet.'));
      return built.figure;
    }

    const W = 480;
    const H = 170;
    const PAD = { top: 22, bottom: 30 };
    const plotH = H - PAD.top - PAD.bottom;
    const step = W / series.length;
    const barW = step * 0.5;

    const node = chartSvg(built.ids, `0 0 ${W} ${H}`, 'months');
    series.forEach((month, i) => {
      const height = Math.max(month.totalPaise > 0 ? 2 : 0, (month.totalPaise / max) * plotH);
      const x = i * step + (step - barW) / 2;
      const isCurrent = month.monthKey === key;
      node.append(svg('rect', {
        x, y: PAD.top + plotH - height, width: barW, height,
        rx: 1,
        class: `mom-bar${isCurrent ? ' is-current' : ''}`,
        style: `--i: ${i}; --bar-base: ${PAD.top + plotH}px`,
      }));

      const label = svg('text', {
        x: x + barW / 2, y: H - 10,
        class: `axis-label${isCurrent ? ' is-today' : ''}`,
        'text-anchor': 'middle',
      });
      label.textContent = formatMonth(month.monthKey, { short: true }).split(' ')[0];
      node.append(label);

      if (isCurrent) {
        const value = svg('text', {
          x: x + barW / 2, y: PAD.top + plotH - height - 7,
          class: 'bar-value', 'text-anchor': 'middle',
        });
        value.textContent = formatINR(month.totalPaise);
        node.append(value);
      }
    });

    built.body.append(node);
    return built.figure;
  }

  /* ---------------------------------------------------- top expenses */

  function topPanel(expenses, key, categoriesById, today) {
    const rows = topExpenses(expenses, 5);
    const monthTotal = totalPaise(expenses);
    const summary = rows.length === 0
      ? 'No expenses to rank yet.'
      : `Your largest single expense was ${formatINR(rows[0].amountPaise)}${rows[0].note ? ` on ${rows[0].note}` : ''}, ${pct(monthTotal ? rows[0].amountPaise / monthTotal : 0)} of the month.`;

    const built = panel({
      title: 'Biggest five',
      summary,
      // No hidden table: the list below is already a readable list.
    });

    if (rows.length === 0) {
      built.body.append(emptyNote('Nothing recorded this month.'));
      return built.figure;
    }

    const list = el('ol', 'top-list');
    list.setAttribute('role', 'list');
    for (const expense of rows) {
      const item = el('li', 'top-row');
      const left = el('div', 'top-main');
      left.append(el('p', 'top-note', expense.note || (categoriesById[expense.categoryId]?.name ?? 'Expense')));

      const meta = el('p', 'top-meta');
      const dot = el('span', 'cat-dot');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.setProperty('--cat', `var(--${categoriesById[expense.categoryId]?.colorToken ?? 'cat-neutral'})`);
      const time = document.createElement('time');
      time.setAttribute('datetime', expense.date);
      time.textContent = expense.date === today
        ? 'Today'
        : `${Number(expense.date.slice(8))} ${formatMonth(key, { short: true })}`;
      meta.append(dot, categoriesById[expense.categoryId]?.name ?? 'Other', ' · ', time);
      left.append(meta);

      const amount = el('p', 'top-amount num');
      const sym = el('span', 'sym', '₹');
      sym.setAttribute('aria-hidden', 'true');
      amount.append(sym, formatAmount(expense.amountPaise));

      item.append(left, amount);
      list.append(item);
    }
    built.body.append(list);
    return built.figure;
  }

  /* ------------------------------------------------------------ helpers */

  function emptyNote(text) {
    return el('p', 'panel-empty', text);
  }

  function legendKey(items) {
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

  /**
   * @param {object[]} expenses already filtered, already scoped to the month
   * @param {object[]} allExpenses for the six-month history
   */
  function render({ expenses, allExpenses, monthKey: key, categoriesById, today }) {
    // Charts are small and rebuilt whole; the reconciling renderer is for the
    // ledger, where identity, focus and selection actually matter.
    root.replaceChildren(
      meanMedianPanel(expenses, key, today),
      categoryPanel(expenses, key, categoriesById),
      dailyPanel(expenses, key, today),
      monthsPanel(allExpenses, key),
      topPanel(expenses, key, categoriesById, today),
    );

    // Draw in on first paint, and again when the month changes — but not on
    // every keystroke of a search box.
    const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (motion && drawnFor !== key) {
      drawnFor = key;
      root.dataset.draw = 'true';
      setTimeout(() => { delete root.dataset.draw; }, 1400);
    }
  }

  return { render };
}
