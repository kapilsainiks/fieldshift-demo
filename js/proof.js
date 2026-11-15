/* The Proof screen (#/proof): did this advice hold up in past years?

   Laid out as the approved mock (_design/proof-v2.html): the answer and one chart first, then
   three takeaways, then one next step, then the long explanations folded behind "show more" rows.

   Everything shown comes from the engine file for the field's county, from fields.json and from
   two optional files (the climate file and the future-rain file). The sentences are built in
   proof-util.js; this file loads the data and draws the page. All text goes in with textContent;
   the chart's SVG holds only numbers and fixed words. */

import { state } from './state.js';
import { climateFor, engineFor, fieldConfigFor, fieldsConfig, futureRain } from './data.js';
import { TEST_ACRES } from './engine.js';
import { createMap, reducedMotion } from './map.js';
import { NO_DATA, money, moneyWithLoss, yearSpan } from './format.js';
import {
  chartFinding,
  clearTrend,
  climateCard,
  coverageSentence,
  futureDots,
  futureRainCard,
  dryYearDefinition,
  hotDrySentence,
  notTestableLine,
  lowestYearSentence,
  openingParagraphs,
  ownLooks,
  replayNotes,
  replayParagraph,
  splitCaption,
  splitReading,
  splitRows,
  trendSentence,
  verdictWords,
  weatherPlace,
  wheatPriceSentence,
  yearRows,
} from './proof-util.js';

const PLAN = '#/plan';
const FIELDS = '#/fields';
const SVG_NS = 'http://www.w3.org/2000/svg';
const HONEY = '#ffdfb5';

const SPLIT_COLUMNS = ['Strategy', 'Picked', 'Bad year', 'Worst year', 'Average'];

const STUDIES = [
  { text: 'Read the wheat yield study (Ahmed et al. 2017)', href: 'https://www.frontiersin.org/articles/10.3389/fevo.2017.00051/full' },
  { text: 'Read the fallow study (Karimi et al. 2017)', href: 'https://www.frontiersin.org/articles/10.3389/fevo.2017.00020/full' },
];

/* What the two studies say, and no more. Ahmed et al. modelled winter wheat only and found that
   most of the spread in its answers comes from the choice of crop model. Karimi et al. sorted the
   region's future climate into classes (wheat and fallow, or a crop every year); that is what the
   climate would suit, not a forecast of what farmers will plant. */
const WSU_NOTE = [
  'Washington State University crop-model studies for this region project dryland winter wheat yields '
    + 'rising in the coming decades, mostly because more CO2 helps wheat use scarce water (Ahmed et al. 2017). '
    + 'The models disagree a lot on how much.',
  'A second study projects that less of the region will have a climate suited to wheat and fallow, '
    + 'and more will suit a crop every year (Karimi et al. 2017).',
  'That makes “is it time to rest less ground?” a fair question. '
    + 'Fieldproof answers it for one field, with that field\'s own weather.',
];

const ADVICE_NOTE = 'The advice is the rotation Fieldproof ranks first for steady income in bad years.';

/* The Plan screen opens on today's prices and ranks with every year of the record. The replay
   prices each year at its own price and sees only the earlier years. */
const PLAN_DIFFERS_NOTE = "Your Plan starts with today's prices and uses every year of the record, "
  + "so the rotation at its top can differ from the method's picks here.";

let root = null; // the screen's own element, while it is mounted
let stopWatching = null; // ends the state subscription
let shownFieldKey = null; // which field the page is showing
let loads = 0; // counts page loads, so a slow one cannot draw over a newer one
let photo = null; // the aerial photo behind the page (a MapLibre map), or null
let chartRows = null; // the rows the chart is drawn from, for a redraw at a new width
let resizeTimer = null;

/* ---------- Small DOM helpers ---------- */

/** Make an element. `props.text` is its text, `props.class` its classes, the rest are attributes. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === 'text') node.textContent = value;
    else if (name === 'class') node.className = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function paragraph(text, className) {
  return el('p', className ? { class: className, text } : { text });
}

function hiddenText(text) {
  return el('span', { class: 'visually-hidden', text });
}

function headerRow(columns) {
  return el('thead', {}, [
    el('tr', {}, columns.map(([text, cls]) => el('th', cls ? { scope: 'col', class: cls, text } : { scope: 'col', text }))),
  ]);
}

function wholeMoney(value) {
  return money(value);
}

/** A table that may be wider than a phone: it scrolls on its own and can be reached by keyboard. */
function tableBox(table, label) {
  return el('div', { class: 'pf-tablebox', tabindex: '0', role: 'region', 'aria-label': label }, [table]);
}

/* ---------- The aerial photo behind the page ---------- */

function around(ring) {
  const [x, y] = ring[0];
  const outer = [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x - 1, y - 1]];
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [outer, ring] } };
}

function outerRing(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates[0];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates[0]?.[0];
  return null;
}

/* Put the field in the part of the first screen the words leave free: right of the headline on a
   wide screen, above the words on a phone. */
function placePhoto(field) {
  if (!photo || !root) return;
  const ring = outerRing(field.geometry);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const phone = vw < 768;
  const padding = phone
    ? { top: 76, bottom: Math.max(80, vh - 250), left: 32, right: 32 }
    : { top: 96, bottom: Math.max(80, vh - 430), left: Math.max(vw * 0.57, 420), right: 64 };
  photo.resize();
  if (ring) {
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    photo.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding, animate: false, maxZoom: 14.4 });
  } else if (field.pin) {
    photo.jumpTo({ center: field.pin, zoom: 13.6 });
  }
}

function startPhoto(host, field) {
  photo?.remove();
  photo = createMap(host, {
    name: 'proof',
    interactive: false,
    attributionControl: false, // the credit line at the end of the page says what the picture is
    center: field.pin ?? [-118.48, 47.17],
    zoom: 13.6,
  });
  if (!photo) return;
  const map = photo;
  map.on('load', () => {
    if (map !== photo) return;
    // The brightest ground is held back a little, so white words keep 4.5:1 over any part of it.
    map.setPaintProperty('usgs', 'raster-brightness-max', 0.86);
    const ring = outerRing(field.geometry);
    if (ring) {
      map.addSource('around', { type: 'geojson', data: around(ring) });
      map.addLayer({ id: 'mask', type: 'fill', source: 'around', paint: { 'fill-color': '#000', 'fill-opacity': 0.28 } });
      map.addSource('field', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: field.geometry } });
      map.addLayer({ id: 'picked-fill', type: 'fill', source: 'field', paint: { 'fill-color': HONEY, 'fill-opacity': 0.07 } });
      map.addLayer({ id: 'picked-case', type: 'line', source: 'field', layout: { 'line-join': 'round' }, paint: { 'line-color': '#1c140a', 'line-width': 6.5, 'line-opacity': 0.7 } });
      map.addLayer({ id: 'picked-line', type: 'line', source: 'field', layout: { 'line-join': 'round' }, paint: { 'line-color': HONEY, 'line-width': 3 } });
    }
    placePhoto(field);
  });
}

/* ---------- The chart: drawn to the width it has, so its type is always real size ---------- */

function svgNode(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawChart(host, rows, grow) {
  const W = Math.floor(host.clientWidth);
  if (!W || rows.length === 0) return;
  const small = W < 640;
  const values = rows.map((row) => Math.round(row.today));
  const n = rows.length;
  const up = Math.max(1, ...values);
  const down = Math.max(1, ...values.map((v) => -v));
  const H = small ? 204 : Math.max(190, Math.min(300, window.innerHeight - 590));
  const left = small ? 26 : 36;
  const slotU = small ? 3 : 2.1;
  const gapU = 0.35;
  const u = (W - left) / (n + gapU + slotU);
  const top = small ? 4 : 28;
  const pad = 22;
  const foot = 28;
  const k = (H - 2 * pad) / (up + down);
  const zero = top + pad + up * k;
  const total = top + H + foot;
  const r = (v) => Math.round(v * 10) / 10;
  const best = values.indexOf(up);
  const worst = values.findIndex((v) => -v === down);
  const bw = small ? Math.max(5, u * 0.5) : Math.min(20, u * 0.38);

  const svg = svgNode('svg', { viewBox: `0 0 ${W} ${total}`, width: W, height: total, focusable: 'false' });
  const defs = svgNode('defs', {});
  const gradient = svgNode('linearGradient', { id: 'pv-band', x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.append(
    svgNode('stop', { offset: 0, 'stop-color': HONEY, 'stop-opacity': 0.2 }),
    svgNode('stop', { offset: 1, 'stop-color': HONEY, 'stop-opacity': 0.07 }),
  );
  defs.append(gradient);
  svg.append(defs);

  // Dry years: a soft band behind the year. Years in a row share one band and one label.
  rows.forEach((row, i) => {
    if (!row.hotDry || (i > 0 && rows[i - 1].hotDry)) return;
    let span = 1;
    while (i + span < n && rows[i + span].hotDry) span += 1;
    const x = left + i * u;
    svg.append(svgNode('rect', { x: r(x + 1), y: 0, width: r(span * u - 2), height: total, rx: 4, fill: 'url(#pv-band)' }));
    if (!small) svg.append(svgNode('text', { class: 'bandlab', x: r(x + (span * u) / 2), y: 18, 'text-anchor': 'middle' }, 'Dry year'));
  });

  svg.append(svgNode('line', { class: 'zero', x1: left - 6, y1: r(zero), x2: r(left + n * u), y2: r(zero) }));
  svg.append(svgNode('text', { class: 'tick', x: left - 12, y: r(zero + 4), 'text-anchor': 'end' }, '$0'));

  rows.forEach((row, i) => {
    const v = values[i];
    const cx = left + (i + 0.5) * u;
    const loss = v < 0;
    const h = Math.max(Math.abs(v) * k, 1.5);
    const y = loss ? zero : zero - h;
    const bar = loss
      ? svgNode('rect', { class: 'bar loss', x: r(cx - bw / 2 + 0.5), y: r(y), width: r(bw - 1), height: r(h) })
      : svgNode('rect', { class: 'bar gain', x: r(cx - bw / 2), y: r(y), width: r(bw), height: r(h), rx: 1.5 });
    if (grow) bar.style.animationDelay = `${i * 24}ms`;
    svg.append(bar);
    if (!small || i === best || i === worst) {
      const label = svgNode('text', { class: 'val', x: r(cx), y: r(loss ? y + h + 15 : y - 7), 'text-anchor': 'middle' }, money(v));
      if (grow) label.style.animationDelay = `${i * 24 + 260}ms`;
      svg.append(label);
    }
    if (!small || (row.year % 5 === 0 && i < n - 2)) {
      svg.append(svgNode('text', { class: row.hotDry ? 'yr hot' : 'yr', x: r(cx), y: top + H + 19, 'text-anchor': 'middle' }, String(row.year)));
    }
  });

  // After the last year: an open place, drawn with a dashed edge, for the farmer's own test.
  const sx = left + (n + gapU) * u;
  const sw = slotU * u - 1;
  const mid = sx + sw / 2;
  svg.append(svgNode('rect', { class: 'slot', x: r(sx + 0.5), y: top + 0.5, width: r(sw - 1), height: H - 1, rx: 10 }));
  if (small) {
    svg.append(svgNode('text', { class: 'slotlab', transform: `translate(${r(mid + 5)} ${r(top + H / 2)}) rotate(-90)`, 'text-anchor': 'middle' }, 'Next season'));
  } else {
    const label = svgNode('text', { class: 'slotlab', 'text-anchor': 'middle' });
    label.append(
      svgNode('tspan', { x: r(mid), y: r(top + H / 2 - 4) }, 'Next'),
      svgNode('tspan', { x: r(mid), dy: 19 }, 'season'),
    );
    svg.append(label);
  }
  svg.append(svgNode('text', { class: 'yr next', x: r(mid), y: top + H + 19, 'text-anchor': 'middle' }, 'Next'));

  host.classList.toggle('grow', Boolean(grow));
  host.replaceChildren(svg);
}

/** The chart in words, for screen readers: "2005: −$4, a loss, a dry year". */
function chartText(rows, unitText) {
  const items = rows.map((row) => {
    const v = Math.round(row.today);
    return el('li', { text: `${row.year}: ${money(v)}${v < 0 ? ', a loss' : ''}${row.hotDry ? ', a dry year' : ''}` });
  });
  items.push(el('li', { text: 'Next: no record yet.' }));
  return el('ol', { class: 'visually-hidden', 'aria-label': unitText }, items);
}

/* ---------- First screen: the answer, the field, the chart ---------- */

function eyebrowText({ field, config }) {
  const acres = field.props?.ac;
  const name = field.sampleId && field.sampleId === config.id
    ? config.label
    : `${field.county ?? field.props?.co} County field`;
  return Number.isFinite(acres) ? `${name} · ${Math.round(acres)} acres` : name;
}

function verdictLine(app) {
  const words = verdictWords(app);
  if (!words) return null;
  const icon = el('span', { class: `pv-verdict-icon is-${words.kind}`, 'aria-hidden': 'true' });
  return el('p', { class: 'pv-verdict', 'data-proof-verdict': words.kind }, [
    icon,
    el('span', {}, [hiddenText('Verdict: '), document.createTextNode(words.text)]),
  ]);
}

function rotationWords(app) {
  const option = app.options?.[app.current_option];
  const plain = String(option?.label ?? '').replace(/\s*\(current\)\s*$/i, '');
  if (!/^keep\b/i.test(plain)) return plain.charAt(0).toLowerCase() + plain.slice(1);
  // "Keep chickpeas" names a choice, not a rotation: name the crops instead.
  const names = (option?.crops ?? []).map((code) => String(app.crops?.[code]?.name ?? code).toLowerCase());
  return names.join(', ');
}

function heroSection(page) {
  const { app } = page;
  const opening = openingParagraphs(app);
  const words = el('div', { class: 'pv-words' }, [
    paragraph(eyebrowText(page), 'pv-eyebrow'),
    el('h1', { id: 'pv-title', text: 'Did this advice hold up in past years?' }),
  ]);
  const verdict = verdictLine(app);
  if (verdict) words.append(verdict);
  const plain = verdictWords(app)?.kind === 'unknown' ? notTestableLine(app, rotationWords(app), TEST_ACRES) : null;
  if (plain) words.append(paragraph(plain, 'pv-lede'));
  if (opening.length > 0) {
    // The full replay story stays one tap away, closed, for anyone who wants to check our work.
    words.append(el('details', { class: 'pv-how', 'data-proof': 'how-checked' }, [
      el('summary', { text: 'Show how we checked' }),
      ...opening.map((text) => paragraph(text, 'pv-lede-more')),
    ]));
  }

  const section = el('section', { class: 'pv-hero', 'data-proof': 'replay', 'aria-labelledby': 'pv-title' }, [words]);
  const rows = yearRows(app);
  if (rows.length > 0) section.append(chartFigure(page, rows));
  return section;
}

function chartFigure({ app }, rows) {
  const unit = `Dollars an acre a year from ${rotationWords(app)}, at today's prices`;
  const finding = chartFinding(rows);
  const title = el('h2', { id: 'pv-chart-title' }, [el('span', { text: 'What the past does show:' }), document.createTextNode(` ${finding}`)]);
  const drawing = el('div', { class: 'pv-chart', 'aria-hidden': 'true' });
  const open = el('a', { href: '#pv-years', text: 'See this as a table' });
  open.addEventListener('click', (event) => {
    const row = root?.querySelector('#pv-years');
    if (!row) return;
    event.preventDefault();
    row.open = true;
    row.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    row.querySelector('summary').focus({ preventScroll: true });
  });
  const foot = [wheatPriceSentence(app), lowestYearSentence(rows)].filter(Boolean).join(' ');
  chartRows = rows;
  return el('figure', { class: 'pv-figure', 'data-proof': 'chart', 'aria-labelledby': 'pv-chart-title' }, [
    el('div', { class: 'pv-chart-head' }, [title, paragraph(unit, 'pv-unit')]),
    drawing,
    chartText(rows, `${unit}, ${yearSpan(rows[0].year, rows.at(-1).year)}. A minus sign is a loss.`),
    el('figcaption', { class: 'pv-chart-foot' }, [
      el('span', { class: 'pv-key', 'aria-hidden': 'true' }, [el('i'), document.createTextNode('Shaded: a dry year')]),
      el('span', { text: foot }),
      open,
    ]),
  ]);
}

/* ---------- Three takeaways ---------- */

function tallyRow(word, count) {
  const marks = el('span', { class: count ? 'marks' : 'marks none', 'aria-hidden': 'true' },
    Array.from({ length: count }, () => el('i')));
  return [el('span', { 'aria-hidden': 'true', text: word }), marks, el('b', { 'aria-hidden': 'true', text: String(count) })];
}

function lookTake(app) {
  const looks = ownLooks(app);
  if (!looks) return null;
  const option = app.options?.[app.current_option];
  const keep = rotationWords(app);
  const line = looks.switches === 0
    ? `All ${looks.looks} times we looked back from ${keep}, the advice was: keep it. So the past has no switch to judge.`
    : `Of ${looks.looks} looks back from ${keep}, the advice said switch ${looks.switches} times.`;
  const tally = el('div', {
    class: 'tally',
    role: 'img',
    'aria-label': `Of ${looks.looks} looks back, ${looks.keeps} said keep and ${looks.switches} said switch.`,
  }, [...tallyRow('Keep', looks.keeps), ...tallyRow('Switch', looks.switches)]);
  return el('li', {}, [
    el('h3', { text: 'Looking back' }),
    paragraph(`${looks.switches} ${looks.switches === 1 ? 'switch' : 'switches'}`, 'big'),
    paragraph(option ? line : '', 'line'),
    el('div', { class: 'fig' }, [tally]),
  ]);
}

function heatTake(climate) {
  const trend = clearTrend(climate);
  if (!trend) return null;
  const sign = trend.perDecadeUs > 0 ? '+' : '−';
  const big = el('p', { class: 'big' }, [
    el('span', { text: `${sign}${Math.abs(trend.perDecadeUs)}${trend.usUnit}` }),
    document.createTextNode(' '),
    el('small', { text: 'every 10 years' }),
  ]);
  return el('li', {}, [
    el('h3', { text: 'Summer heat' }),
    big,
    paragraph(trendSentence(trend.key, climate.trend_at_field_1981_2025[trend.key]), 'line'),
    el('div', { class: 'fig' }, [paragraph('This does not say what hotter summers do to harvests here.', 'aside')]),
  ]);
}

function dotsFigure(scenario, wide) {
  const counts = Array(13).fill(0);
  for (const [, n] of scenario.counts) if (n >= 0 && n <= 12) counts[n] += 1;
  const parts = counts.map((n, at) => (n ? `${n} ${n === 1 ? 'model' : 'models'} at ${at}` : '')).filter(Boolean);
  const label = `${scenario.label}, dry springs in 20 years: ${parts.join('; ')}. Before, it was about ${scenario.baseline}.`;
  const cols = counts.map((n, at) => el('span', { class: at === scenario.baseline ? 'col is-before' : 'col' },
    Array.from({ length: n }, () => el('i'))));
  const axis = counts.map((_, at) => el('span', { text: at % 4 === 0 ? String(at) : '' }));
  return el('div', { class: wide ? 'pf-dotfig is-wide' : 'pf-dotfig' }, [
    el('div', { class: 'pf-dots', role: 'img', 'aria-label': label }, cols),
    el('div', { class: 'pf-dotaxis', 'aria-hidden': 'true' }, axis),
  ]);
}

function futureTake(future, config) {
  const [first] = futureDots(future, config.id);
  if (!first) return null;
  const big = first.reading.split('. ')[0].replace(/\.$/, '');
  const years = Array.isArray(future.future_years) ? ` for ${yearSpan(...future.future_years)}` : '';
  const models = Array.isArray(future.models) ? future.models.length : first.counts.length;
  return el('li', {}, [
    el('h3', { text: 'Springs ahead' }),
    paragraph(big, 'big'),
    paragraph(`in dry springs${years}, across NASA's ${models} climate models (${first.label.toLowerCase()}).`, 'line'),
    el('div', { class: 'fig' }, [
      dotsFigure(first, false),
      paragraph(`Dry springs in 20 years. Before: about ${first.baseline}.`, 'figcap'),
    ]),
  ]);
}

function takeaways(page) {
  const items = [lookTake(page.app), heatTake(page.climate), futureTake(page.future, page.config)].filter(Boolean);
  if (items.length === 0) return null;
  return el('section', { 'aria-labelledby': 'pv-take-title', 'data-proof': 'takeaways' }, [
    el('h2', { class: 'visually-hidden', id: 'pv-take-title', text: 'Three takeaways' }),
    el('ul', { class: `take take-${items.length}` }, items),
  ]);
}

function nextStep() {
  return el('section', { class: 'next', 'aria-labelledby': 'pv-next-title', 'data-proof': 'next' }, [
    el('div', {}, [
      el('h2', { id: 'pv-next-title', text: 'That is why your plan shows what would change the answer.' }),
      paragraph('A dry year, a lower harvest, a price drop: the plan tells you which one flips it, before you seed.'),
    ]),
    el('a', { class: 'pill', href: PLAN, text: 'Back to your plan' }),
  ]);
}

/* ---------- The details: quiet rows that open in place ---------- */

function chevron() {
  const svg = svgNode('svg', { class: 'chev', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgNode('path', { d: 'M6 9l6 6 6-6' }));
  return svg;
}

function detailRow(id, name, title, hint, body) {
  return el('details', { id, 'data-proof': name }, [
    el('summary', {}, [el('h3', { text: title }), el('span', { class: 'hint', text: hint }), chevron()]),
    el('div', { class: 'pf-body' }, body),
  ]);
}

function gapsRow({ config }) {
  const gaps = Array.isArray(config.gaps) ? config.gaps : [];
  if (gaps.length === 0) return null;
  return detailRow('pv-gaps', 'gaps', 'What this does not prove', `${gaps.length} limits of the records and our advice`, [
    el('ul', {}, gaps.map((gap) => el('li', { text: gap }))),
  ]);
}

function yearsRow({ app, config, field }) {
  const rows = yearRows(app);
  if (rows.length === 0) return null;
  const body = rows.map((row) => el('tr', row.hotDry ? { class: 'is-hot' } : {}, [
    el('th', { scope: 'row', text: String(row.year) }),
    el('td', { class: 'num', text: wholeMoney(row.today) }),
    el('td', { class: 'num', text: row.hist === null ? NO_DATA : wholeMoney(row.hist) }),
    el('td', {}, row.inches === null ? [document.createTextNode(NO_DATA)] : [
      el('span', { class: 'pf-rainbar', style: `--w:${row.inches.toFixed(2)}`, 'aria-hidden': 'true' }),
      document.createTextNode(`${row.inches.toFixed(1)} in`),
    ]),
    el('td', {}, row.hotDry ? [document.createTextNode('Dry year')] : [hiddenText('No')]),
  ]));
  const place = weatherPlace(config, field);
  const table = el('table', { class: 'pf-table' }, [
    el('caption', { class: 'visually-hidden', text: `Dollars an acre and spring rain by year ${place}, ${yearSpan(rows[0].year, rows.at(-1).year)}. A minus sign means a loss.` }),
    headerRow([['Year'], ["At today's prices", 'num'], ["At that year's prices", 'num'], ['Spring rain, March to June'], ['Dry year']]),
    el('tbody', {}, body),
  ]);
  return detailRow('pv-years', 'weather', `All ${rows.length} years`, 'The chart as a table, with spring rain', [
    paragraph("The chart sells every harvest at today's prices, so the bars show the harvest and not the price of the day. The next column prices each year at its own price."),
    tableBox(table, 'Table of every year'),
    paragraph(hotDrySentence(app)),
    ...(dryYearDefinition(app) ? [paragraph(dryYearDefinition(app), 'pf-fine')] : []),
    paragraph("Dollars an acre a year after seed, fertilizer, fuel and other yearly costs, in today's dollars. "
      + 'A minus sign means a loss. Land and machinery payments are not counted.', 'pf-fine'),
  ]);
}

function splitRow(row) {
  const amounts = [row.badYear, row.worstYear, row.average];
  return el('tr', row.isMethod ? { class: 'is-method' } : {}, [
    el('th', { scope: 'row', text: row.strategy }),
    el('td', { text: row.picked }),
    ...amounts.map((amount) => el('td', { class: 'num', text: moneyWithLoss(amount) })),
  ]);
}

function byStartTable(app) {
  const starts = app.validation?.by_start;
  if (!Array.isArray(starts) || starts.length === 0) return null;
  const rows = starts.map((start) => el('tr', {}, [
    el('th', { scope: 'row' }, [
      document.createTextNode(String(start.label ?? start.start).replace(/\s*\(current\)\s*$/i, '')),
      ...(start.start === app.current_option ? [el('span', { class: 'pf-you', text: 'what you grow now' })] : []),
    ]),
    el('td', { class: 'num', text: String(start.windows) }),
    el('td', { class: 'num', text: String(start.switches) }),
  ]));
  const looks = starts.reduce((sum, start) => sum + (start.windows ?? 0), 0);
  const switches = starts.reduce((sum, start) => sum + (start.switches ?? 0), 0);
  return tableBox(el('table', { class: 'pf-table' }, [
    el('caption', { text: 'What Fieldproof said, by the rotation it started from' }),
    headerRow([['Starting from'], ['Looks back', 'num'], ['Said “switch”', 'num']]),
    el('tbody', {}, rows),
    el('tfoot', {}, [el('tr', {}, [
      el('th', { scope: 'row', text: `All ${starts.length}` }),
      el('td', { class: 'num', text: String(looks) }),
      el('td', { class: 'num', text: String(switches) }),
    ])]),
  ]), 'Table of looks back by starting rotation');
}

function lookRow({ app, config }) {
  const text = replayParagraph(app);
  const looks = ownLooks(app);
  const hint = looks ? `${looks.looks} looks back from your rotation, and why they cannot settle it` : 'How the past-years test works';
  const body = [];
  if (!text) {
    body.push(paragraph('The record for this field has no past-years test yet, so there is nothing to show here.'));
  } else {
    body.push(paragraph(ADVICE_NOTE), paragraph(text));
    const notes = replayNotes(app);
    if (notes.length > 0) body.push(paragraph(notes.join(' ')));
    const starts = byStartTable(app);
    if (starts) body.push(starts);
  }
  const rows = splitRows(app);
  if (rows) {
    body.push(el('h4', { text: 'Choose with the early years, score on the later years' }));
    body.push(paragraph('A second check. Each way of choosing picked one rotation using only the early years. '
      + 'The table shows what that rotation then earned in the later years.'));
    body.push(tableBox(el('table', { class: 'pf-table proof-split' }, [
      el('caption', { text: splitCaption(app) ?? 'What each way of choosing earned in the later years.' }),
      headerRow(SPLIT_COLUMNS.map((column, index) => [column, index > 1 ? 'num' : null])),
      el('tbody', {}, rows.map(splitRow)),
    ]), 'Table of the split test'));
    const reading = splitReading(app);
    if (reading) body.push(paragraph(reading));
    body.push(paragraph('Bad year: about 1 year in 5 is this low or lower. Worst year: the lowest of the scored years. '
      + 'Average: across all the scored years.', 'pf-fine'));
  }
  body.push(paragraph(PLAN_DIFFERS_NOTE));
  const place = config.town ? ` for the ${config.town} area` : '';
  body.push(paragraph(`Source: Fieldproof's replay of harvests and prices (USDA NASS) and weather (NASA POWER)${place}.`, 'pf-fine'));
  return detailRow('pv-look', 'split', 'How we looked back', hint, body);
}

function weatherRow({ climate, config, field }) {
  const text = climateCard(climate);
  if (!text) return null;
  const body = [];
  if (text.trends.length > 0) {
    body.push(paragraph(`From the weather record ${weatherPlace(config, field)}:`));
    body.push(el('ul', { class: 'pf-trends' }, text.trends.map((sentence) => el('li', { text: sentence }))));
  }
  if (text.placeNote) body.push(paragraph(text.placeNote, 'pf-fine'));
  body.push(paragraph('This page does not say what warmer summers will do to harvests here.'));
  if (text.bands) {
    body.push(paragraph(text.bands), paragraph('Pulses are peas, lentils, chickpeas and dry beans.', 'pf-fine'));
  }
  body.push(paragraph(text.source, 'pf-fine'));
  const clear = clearTrend(climate);
  const hint = clear ? `${clear.label} has risen. See which trends are clear.` : 'Which trends are clear, and which are not';
  return detailRow('pv-weather', 'climate', 'The weather since 1981', hint, body);
}

function futureRow({ future, config }) {
  const text = futureRainCard(future, config.id);
  const body = [];
  let title = 'What NASA\'s climate models show';
  let hint = 'Dry springs in years to come';
  if (text) {
    const years = Array.isArray(future.future_years) ? yearSpan(...future.future_years) : null;
    if (years) title = `What NASA's climate models show for ${years}`;
    const dots = futureDots(future, config.id);
    hint = `${future.models?.length ?? ''} models, ${dots.length} possible futures`.trim();
    body.push(paragraph('Each dot is one climate model. It sits on the number of dry springs that model shows in 20 years.'));
    for (const [index, scenario] of dots.entries()) {
      body.push(el('div', { class: 'pf-dotrow' }, [
        paragraph(text.scenarios[index] ?? scenario.label),
        dotsFigure(scenario, true),
      ]));
    }
    if (dots.length === 0) body.push(el('ul', {}, text.scenarios.map((line) => el('li', { text: line }))));
    const fine = [text.definition, text.placeNote, text.source].filter(Boolean).join(' ');
    body.push(paragraph(fine, 'pf-fine'));
  }
  body.push(el('h4', { text: 'What crop-model studies project' }));
  body.push(...WSU_NOTE.map((note) => paragraph(note)));
  body.push(el('p', { class: 'pf-links' }, STUDIES.map((study) => el('a', { href: study.href, text: study.text }))));
  return detailRow('pv-future', 'future', title, hint, body);
}

function sourcesRow({ app, config }) {
  const items = [
    ['Harvests and prices:', `USDA NASS. ${wheatPriceSentence(app) ?? ''}`],
    ['Weather:', 'NASA POWER, 1981 to 2025.'],
    ['Springs ahead:', 'NASA NEX-GDDP-CMIP6.'],
    ...(config.cost_source ? [['Costs:', `${config.cost_source}, adjusted for inflation.`]] : []),
    ['Looking back:', "Fieldproof's own check, run on the harvests, prices and weather above."],
    ['Aerial photo:', 'USGS The National Map (USDA NAIP).'],
  ];
  return detailRow('pv-sources', 'sources', 'Where the numbers come from', 'USDA harvests, NASA weather, crop budgets', [
    el('ul', {}, items.map(([head, text]) => el('li', {}, [el('strong', { text: head }), document.createTextNode(` ${text}`)]))),
  ]);
}

function detailsSection(page) {
  const rows = [gapsRow(page), yearsRow(page), lookRow(page), weatherRow(page), futureRow(page), sourcesRow(page)].filter(Boolean);
  return el('section', { class: 'more', 'aria-labelledby': 'pv-more-title' }, [
    el('h2', { id: 'pv-more-title', text: 'The details' }),
    el('div', { class: 'rows' }, rows),
    paragraph('Aerial photo · USGS and USDA · Field outline: Washington state crop map', 'credit'),
  ]);
}

/* ---------- Whole pages ---------- */

function simpleTop() {
  return el('div', { class: 'pv-hero' }, [
    el('div', { class: 'pv-words' }, [el('h1', { text: 'Did this advice hold up in past years?' })]),
  ]);
}

function loadingPage() {
  return [simpleTop(), el('div', { class: 'below' }, [el('p', { class: 'proof-note', role: 'status', text: 'Loading the past-years record…' })])];
}

function uncoveredPage(fields) {
  return [
    simpleTop(),
    el('div', { class: 'below' }, [
      el('section', { 'data-proof': 'no-engine', class: 'pv-plain' }, [
        paragraph(coverageSentence(fields), 'pv-lede'),
        el('a', { class: 'pill', href: PLAN, text: 'Back to your plan' }),
      ]),
    ]),
  ];
}

function failedPage(retry) {
  const button = el('button', { type: 'button', class: 'pill', text: 'Try again' });
  button.addEventListener('click', retry);
  return [
    simpleTop(),
    el('div', { class: 'below' }, [
      el('section', { 'data-proof': 'failed', role: 'alert', class: 'pv-plain' }, [
        paragraph('The past-years record could not load. Check your connection, then try again.', 'pv-lede'),
        button,
      ]),
    ]),
  ];
}

function testedPage(page) {
  const below = el('div', { class: 'below' }, [takeaways(page), nextStep(), detailsSection(page)].filter(Boolean));
  return [heroSection(page), below];
}

/* ---------- Loading ---------- */

/** Everything the page needs for one field. `config` is null when the test does not cover it. */
async function gather(field) {
  const county = field.county ?? field.props?.co ?? null;
  const [fieldsFile, config, app] = await Promise.all([fieldsConfig(), fieldConfigFor(county), engineFor(county)]);
  if (!config || !app) return { field, fields: fieldsFile.fields, config: null };
  const [climate, future] = await Promise.all([climateFor(config.id), futureRain()]);
  return { field, fields: fieldsFile.fields, config, app, climate, future };
}

function content() {
  return root.querySelector('.pv-content');
}

function redrawChart(grow) {
  const host = root?.querySelector('.pv-chart');
  if (host && chartRows) drawChart(host, chartRows, grow);
}

async function showField(field) {
  loads += 1;
  const thisLoad = loads;
  const isCurrent = () => root !== null && thisLoad === loads;
  chartRows = null;
  content().replaceChildren(...loadingPage());
  try {
    const page = await gather(field);
    if (!isCurrent()) return;
    content().replaceChildren(...(page.config ? testedPage(page) : uncoveredPage(page.fields)));
    redrawChart(!reducedMotion());
    placePhoto(field);
  } catch (error) {
    if (!isCurrent()) return;
    console.error('The proof screen could not load its data:', error);
    content().replaceChildren(...failedPage(() => retry(field)));
  }
}

/* "Try again" is taken off the page while the data loads, so keyboard focus is put on <main>
   (the router made it focusable); otherwise the next Tab would start from the top of the page. */
async function retry(field) {
  const main = root.parentElement;
  await showField(field);
  if (root) main.focus({ preventScroll: true });
}

function fieldKey(field) {
  return JSON.stringify([field.id, field.county, field.props?.co ?? null, field.sampleId, field.pin]);
}

/* Runs at mount and after every state change. The page is redrawn only when the field changed. */
function onState() {
  const field = state.field;
  if (!field) {
    // The field was cleared while this screen was open: this screen needs one, so go and pick one.
    window.location.hash = FIELDS;
    return;
  }
  const key = fieldKey(field);
  if (key === shownFieldKey) return;
  shownFieldKey = key;
  startPhoto(root.querySelector('.pv-photo'), field);
  showField(field);
}

/* A new window size: draw the chart again at its new width (no growing this time), move the field. */
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    redrawChart(false);
    if (state.field) placePhoto(state.field);
  }, 150);
}

export function mount(container) {
  root = el('div', { class: 'proof' }, [
    el('div', { class: 'pv-bg', 'aria-hidden': 'true' }, [el('div', { class: 'pv-photo' })]),
    el('div', { class: 'pv-content' }),
  ]);
  container.replaceChildren(root);
  window.addEventListener('resize', onResize);
  stopWatching = state.subscribe(onState);
  onState();
}

export function unmount() {
  stopWatching?.();
  stopWatching = null;
  window.removeEventListener('resize', onResize);
  clearTimeout(resizeTimer);
  photo?.remove();
  photo = null;
  chartRows = null;
  root = null;
  shownFieldKey = null;
  loads += 1; // a load still on its way will see it is no longer current
}

