/* Fieldproof money engine. Pure functions: no DOM, no fetch, no globals.

   This is a port of fieldshift/recommend.py. With no overrides, rank() gives the same answer as
   recommend() for every case in tests/fixtures/recommend.json.

   `app` is a parsed engine file (data/engine/ritzville.json or pullman.json).

   Units. Every dollar figure this module returns is dollars per acre per year, after yearly costs,
   in the engine file's own "real" dollars (app.real_dollar_year). To show it in today's dollars,
   multiply by toTodayFactor(app). Prices passed in or returned (priceOverride, breakEvenPrice) are
   today's nominal dollars in the crop's own unit: $/bu, or $/cwt for crops sold by the hundredweight.

   Options that can be passed to every function (all optional):
     priority       'steady' (default), 'typical' or 'soil'
     prices         'hist' (default: each year's own price) or 'today' (today's price in every year)
     pulseCut       0 to 50: how far below average this farm's pulse yields run, in percent
     priceOverride  { cropCode: nominalPrice }, used only when prices is 'today'
     yieldFactor    { cropCode: f }, multiplies that crop's yield by (1 + f) in both price views
     weatherShift   { rainPct, heatC }: a weather what-if. Spring rain (March to June) this many
                    percent above or below 2005-2025, June-July peak heat this many °C above. It
                    never invents a harvest: it gives more weight to the real years whose weather
                    looks like the shift (see scenarioWeights). { 0, 0 } is no shift.

   Missing data never turns into NaN. A year is skipped when any crop of the option has no harvest or
   price for it. An option with no usable years is left out of the ranking, and the single-option
   functions return null. */

/** The top two options are "too close to call" when they are less than this many dollars apart. */
export const TIE_DOLLARS = 10;

/** Acres of the new crop in the smallest safe test (and the same again of the baseline beside it). */
export const TEST_ACRES = 12;

/** The price range breakEvenPrice searches, as multiples of today's price. The price slider uses it too. */
export const PRICE_RANGE = Object.freeze({ low: 0.4, high: 2.5 });

/** The weather what-if sliders: [min, max, step]. minEvidenceYears: below this many years' worth
    of weight the shift is beyond what the record has shown, because one or two years decide it.
    Same values as SCENARIO in fieldshift/config.py on the varun/p0-features branch. */
export const WEATHER_SHIFT = Object.freeze({
  rainPct: Object.freeze([-40, 10, 5]),
  heatC: Object.freeze([0, 3, 0.5]),
  minEvidenceYears: 6,
});

const PRIORITIES = ['steady', 'typical', 'soil'];
const PRICE_VIEWS = ['hist', 'today'];

/* What each priority sorts the rounded rows by, exactly as recommend() does. */
const SORT_KEYS = {
  steady: row => row.bad_year_climate,
  typical: row => row.typical,
  soil: row => (row.soil_score ?? 0) * 1000 + row.bad_year_climate,
};

/* ---------- Python equivalents ---------- */

function ascending(values) {
  return [...values].sort((a, b) => a - b);
}

/** statistics.median: the middle value, or the mean of the two middle values. */
function median(values) {
  const sorted = ascending(values);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** _bad_year: the value at share p of the list, counted from the low end. */
function badYear(values, p) {
  const sorted = ascending(values);
  return sorted[Math.max(1, Math.ceil(p * sorted.length)) - 1];
}

/** The same rule as badYear, counted from the high end: the costly 1-in-5 year when p is 0.2. */
function badYearFromHighEnd(values, p) {
  const sorted = ascending(values);
  return sorted[sorted.length - Math.max(1, Math.ceil(p * sorted.length))];
}

/** _weighted_pct: the first value, low to high, where the running share of weight reaches p.
    `pairs` is [[value, weight], ...]. Python sorts the whole tuples; sorting by value alone gives
    the same answer, because equal values return the same number in any order. */
function weightedPercentile(pairs, p) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, weight]) => sum + weight, 0);
  let cumulative = 0;
  for (const [value, weight] of sorted) {
    cumulative += weight / total;
    if (cumulative >= p - 1e-9) return value;
  }
  return sorted.at(-1)[0];
}

/** Python's round(x, 1): the nearest tenth of the exact stored number, exact halves going to the
    even tenth (0.25 -> 0.2, 0.75 -> 0.8). toFixed is right except on those exact halves. */
function roundToTenth(x) {
  const quarters = x * 4;
  const isExactHalf = Number.isInteger(quarters) && Math.abs(quarters) % 2 === 1;
  if (!isExactHalf) return Number(x.toFixed(1)) + 0;
  const lower = Math.floor(x * 10);
  return (lower % 2 === 0 ? lower : lower + 1) / 10 + 0;
}

/* ---------- reading the engine file ---------- */

function withDefaults(opts = {}) {
  const settings = {
    priority: opts.priority ?? 'steady',
    prices: opts.prices ?? 'hist',
    pulseCut: opts.pulseCut ?? 0,
    priceOverride: opts.priceOverride ?? {},
    yieldFactor: opts.yieldFactor ?? {},
    weatherShift: { rainPct: opts.weatherShift?.rainPct ?? 0, heatC: opts.weatherShift?.heatC ?? 0 },
  };
  if (!PRIORITIES.includes(settings.priority)) throw new RangeError(`Unknown priority "${settings.priority}"`);
  if (!PRICE_VIEWS.includes(settings.prices)) throw new RangeError(`Unknown price view "${settings.prices}"`);
  return settings;
}

function withoutKey(object, key) {
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
}

/** _crop_years: crop code -> year -> the crop_year row. */
function cropYearRows(app) {
  const byCrop = new Map();
  for (const row of app.crop_year ?? []) {
    if (!byCrop.has(row.crop)) byCrop.set(row.crop, new Map());
    byCrop.get(row.crop).set(row.year, row);
  }
  return byCrop;
}

/** The crop's row for a year, or null when the harvest or that year's price is missing. */
function usableRow(byCrop, code, year) {
  const row = byCrop.get(code)?.get(year);
  return row && row.yield != null && row.price_real != null ? row : null;
}

/** The price to use for a crop, in real dollars per unit, or null when there is none. */
function realPrice(app, code, row, settings) {
  if (settings.prices !== 'today') return row.price_real;
  const override = settings.priceOverride[code];
  if (override != null) {
    const factor = toTodayFactor(app);
    return factor == null ? null : override / factor;
  }
  return app.prices_today?.[code]?.real ?? null;
}

/** One crop's return over yearly costs for one year, in real dollars per acre, or null. */
function cropMargin(app, code, row, settings) {
  const crop = app.crops?.[code];
  const price = realPrice(app, code, row, settings);
  if (!crop || price == null) return null;
  const unit = crop.unit === 'bu' ? 1 : 0.01;
  let harvest = row.yield * (crop.pulse ? 1 - settings.pulseCut / 100 : 1);
  const change = settings.yieldFactor[code];
  if (change != null) harvest *= 1 + change;
  const margin = harvest * price * unit - crop.cost;
  return Number.isFinite(margin) ? margin : null;
}

/** The margins of every crop in an option for one year, or null if any of them is missing. */
function optionMargins(app, byCrop, crops, year, settings) {
  const margins = [];
  for (const code of crops) {
    const row = usableRow(byCrop, code, year);
    const margin = row ? cropMargin(app, code, row, settings) : null;
    if (margin == null) return null;
    margins.push(margin);
  }
  return margins;
}

function incomesFor(app, optionId, settings) {
  const option = app.options?.[optionId];
  if (!option?.crops?.length) return [];
  const byCrop = cropYearRows(app);
  const incomes = [];
  for (const year of app.years ?? []) {
    const margins = optionMargins(app, byCrop, option.crops, year, settings);
    if (!margins) continue;
    const total = margins.reduce((sum, margin) => sum + margin, 0);
    incomes.push([year, total / option.crops.length]);
  }
  return incomes;
}

/** The weight of each real year under a weather shift, summing to 1: { year: weight }. Null when
    there is no shift or the engine file has no usable weather. Port of scenario_weights in
    fieldshift/recommend.py on the varun/p0-features branch: fit a two-variable normal to the
    years' spring rain and June-July heat, then tilt it (exponential tilting) so its mean moves by
    the shift. Years that look like the shift count more; no harvest is invented.
    The fit uses every year in app.weather, not app.years, so a file cut down to fewer years
    (plan-util.js sharedRecord) keeps the same tilt as the full ranking. In both engine files the
    two lists are the same 2005-2025 years, so this matches the Python. */
export function scenarioWeights(app, rainPct = 0, heatC = 0) {
  if (!rainPct && !heatC) return null;
  const byYear = new Map((app.weather ?? []).map((row) => [row.year, row]));
  const years = [...byYear.keys()].sort((a, b) => a - b).filter((year) =>
    Number.isFinite(byYear.get(year)?.rain_spring_mm) && Number.isFinite(byYear.get(year)?.heat_junjul_c));
  if (years.length < 3) return null;
  const points = years.map((year) => [byYear.get(year).rain_spring_mm, byYear.get(year).heat_junjul_c]);
  const n = points.length;
  const meanRain = points.reduce((sum, [r]) => sum + r, 0) / n;
  const meanHeat = points.reduce((sum, [, h]) => sum + h, 0) / n;
  const covariance = (f) => points.reduce((sum, point) => sum + f(point), 0) / (n - 1);
  const srr = covariance(([r]) => (r - meanRain) ** 2);
  const shh = covariance(([, h]) => (h - meanHeat) ** 2);
  const srh = covariance(([r, h]) => (r - meanRain) * (h - meanHeat));
  const det = srr * shh - srh * srh;
  if (!(det > 0)) return null;
  const dRain = (meanRain * rainPct) / 100;
  const dHeat = heatC;
  // inverse covariance times the shift of the mean
  const aRain = (shh * dRain - srh * dHeat) / det;
  const aHeat = (srr * dHeat - srh * dRain) / det;
  const logWeights = points.map(([r, h]) => (r - meanRain) * aRain + (h - meanHeat) * aHeat);
  const top = Math.max(...logWeights);
  const raw = logWeights.map((v) => Math.exp(v - top));
  const total = raw.reduce((sum, w) => sum + w, 0);
  return Object.fromEntries(years.map((year, i) => [year, raw[i] / total]));
}

/** How many years' worth of evidence a set of weights holds (effective sample size, 1 / sum w²),
    and the three years it leans on most. */
export function shiftEvidence(weights, years) {
  const usable = years.filter((year) => weights[year] > 0);
  const own = usable.reduce((sum, year) => sum + weights[year], 0);
  if (!(own > 0)) return { evidenceYears: 0, leansOn: [] };
  const evidenceYears = 1 / usable.reduce((sum, year) => sum + (weights[year] / own) ** 2, 0);
  const leansOn = [...usable].sort((a, b) => weights[b] - weights[a]).slice(0, 3);
  return { evidenceYears, leansOn };
}

function statsFor(app, optionId, settings) {
  const incomes = incomesFor(app, optionId, settings);
  if (!incomes.length) return null;
  const weighted = incomes.map(([year, income]) => [income, app.climate_weights?.[String(year)]]);
  if (weighted.some(([, weight]) => !(weight >= 0))) return null;
  const p = app.bad_year_percentile;
  if (!(p > 0 && p <= 1)) return null;
  const values = incomes.map(([, income]) => income);
  const { rainPct, heatC } = settings.weatherShift;
  const shift = scenarioWeights(app, rainPct, heatC);
  if (shift) {
    const shifted = incomes.filter(([year]) => shift[year] > 0);
    if (shifted.length) {
      const evidence = shiftEvidence(shift, shifted.map(([year]) => year));
      return {
        typical: weightedPercentile(shifted.map(([year, income]) => [income, shift[year]]), 0.5),
        bad_year: badYear(values, p),
        worst: Math.min(...values),
        bad_year_climate: weightedPercentile(
          shifted.map(([year, income]) => [income, app.climate_weights[String(year)] * shift[year]]), p),
        years: [incomes[0][0], incomes.at(-1)[0]],
        evidence_years: evidence.evidenceYears,
        leans_on: evidence.leansOn,
      };
    }
  }
  return {
    typical: median(values),
    bad_year: badYear(values, p),
    worst: Math.min(...values),
    bad_year_climate: weightedPercentile(weighted, p),
    years: [incomes[0][0], incomes.at(-1)[0]],
  };
}

function rankedRow(app, optionId, settings) {
  const stats = statsFor(app, optionId, settings);
  if (!stats) return null;
  const option = app.options[optionId];
  return {
    option_id: optionId,
    label: option.label,
    crops: option.crops,
    soil_score: option.soil_score,
    full_record: option.full_record,
    typical: roundToTenth(stats.typical),
    bad_year: roundToTenth(stats.bad_year),
    worst: roundToTenth(stats.worst),
    bad_year_climate: roundToTenth(stats.bad_year_climate),
    years: stats.years,
    ...(stats.evidence_years != null && { evidence_years: roundToTenth(stats.evidence_years) }),
  };
}

/* ---------- public API ---------- */

/** Multiply an engine dollar figure by this to show it in today's dollars. Null if it can't be worked out. */
export function toTodayFactor(app) {
  const wheat = app.prices_today?.WW;
  if (!wheat || !(wheat.real > 0) || !(wheat.nominal > 0)) return null;
  return wheat.nominal / wheat.real;
}

/** The stat each priority is judged by in money terms. 'soil' is judged on the typical year. */
export function metricKey(priority = 'steady') {
  return priority === 'steady' ? 'bad_year_climate' : 'typical';
}

/** An option's label without the engine file's own "(current)" tag. The screens say which
    rotation is grown now in their own words ("What you grow now"). */
export function optionLabel(label) {
  return String(label).replace(/\s*\(current\)\s*$/i, '');
}

/** One option's income for every usable year: [[year, dollarsPerAcre], ...], oldest first.
    Real dollars, not rounded. Empty when the option has no usable years. */
export function optionIncomes(app, optionId, opts) {
  return incomesFor(app, optionId, withDefaults(opts));
}

/** One option's numbers, not rounded: { typical, bad_year, worst, bad_year_climate, years: [first, last] }
    in real dollars per acre, or null when the option has no usable years. */
export function optionStats(app, optionId, opts) {
  return statsFor(app, optionId, withDefaults(opts));
}

/** Every option, best first for the farmer's priority. Row numbers are rounded to one decimal, as
    recommend() does, and the order, gap and tie are worked out from the rounded numbers.
    Returns { pick, runner_up, tie, gap, current_option, ranked: [row, ...] }.
    pick, runner_up and gap are null when there are not two options to compare. */
export function rank(app, opts) {
  const settings = withDefaults(opts);
  const key = SORT_KEYS[settings.priority];
  const ranked = Object.keys(app.options ?? {})
    .map(optionId => rankedRow(app, optionId, settings))
    .filter(row => row !== null);
  ranked.sort((a, b) => key(b) - key(a));
  const [first, second] = ranked;
  const gap = first && second ? key(first) - key(second) : null;
  return {
    pick: first?.option_id ?? null,
    runner_up: second?.option_id ?? null,
    tie: gap !== null && settings.priority !== 'soil' && gap < TIE_DOLLARS,
    gap: gap === null ? null : roundToTenth(gap),
    current_option: app.current_option,
    ranked,
  };
}

/** The lowest price for `cropCode` (today's nominal dollars per bu or cwt, to the cent) at which
    option `optionId` does at least as well as the current option, or null.

    - Searched between PRICE_RANGE.low and PRICE_RANGE.high times today's price.
    - Always uses today's prices, whatever opts.prices says.
    - "Does as well" compares the priority's stat (metricKey), not rounded.
    - The current option is held at today's price for `cropCode`. Other overrides in opts
      (yieldFactor, pulseCut, prices of other crops) apply to both sides.
    - A result at or below today's price means the option already wins today.
    - null: the option does not grow the crop, a number is missing, or no price in range is enough. */
export function breakEvenPrice(app, optionId, cropCode, opts) {
  const today = app.prices_today?.[cropCode]?.nominal;
  if (!(today > 0) || !app.options?.[optionId]?.crops?.includes(cropCode)) return null;

  const settings = { ...withDefaults(opts), prices: 'today' };
  const metric = metricKey(settings.priority);
  const otherPrices = withoutKey(settings.priceOverride, cropCode);
  const target = statsFor(app, app.current_option, { ...settings, priceOverride: otherPrices })?.[metric];
  if (target == null) return null;

  const reachesTarget = cents => {
    const priceOverride = { ...otherPrices, [cropCode]: cents / 100 };
    const stats = statsFor(app, optionId, { ...settings, priceOverride });
    return stats !== null && stats[metric] >= target;
  };

  let low = Math.ceil(today * PRICE_RANGE.low * 100 - 1e-6);
  let high = Math.floor(today * PRICE_RANGE.high * 100 + 1e-6);
  if (reachesTarget(low)) return low / 100;
  if (!reachesTarget(high)) return null;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (reachesTarget(middle)) high = middle;
    else low = middle;
  }
  return high / 100;
}

/** What one acre of `cropCode` gives up next to one acre of `baselineCropCode`, at today's prices
    with the overrides in opts. Real dollars per acre, not rounded: multiply by TEST_ACRES and by
    toTodayFactor(app) to show the cost of the test.

    For each year where both crops have a harvest, d = margin(baseline) - margin(crop).
      typical  median d. Negative means the new crop earned more.
      bad      the 1-in-5 costly year: the bad-year rule (app.bad_year_percentile) from the high end of d.
      fail     median margin(baseline) + the new crop's cost: the new crop is sown and brings in nothing.
      years    [first, last] year used.
    With a weatherShift the same three numbers are weighted the way rank() weights a rotation:
    the real years whose weather looks like the shift count more (scenarioWeights). typical and
    fail become weighted medians, bad the weighted 1-in-5 from the high end. No shift gives
    exactly the numbers above.
    Returns null when a crop is unknown, a price is missing or the crops share no years. */
export function testCost(app, cropCode, baselineCropCode, opts) {
  const settings = { ...withDefaults(opts), prices: 'today' };
  const byCrop = cropYearRows(app);
  const years = [];
  const givenUp = [];
  const baselineMargins = [];
  for (const year of app.years ?? []) {
    const margins = optionMargins(app, byCrop, [baselineCropCode, cropCode], year, settings);
    if (!margins) continue;
    const [baseline, crop] = margins;
    years.push(year);
    givenUp.push(baseline - crop);
    baselineMargins.push(baseline);
  }
  const p = app.bad_year_percentile;
  if (!years.length || !(p > 0 && p <= 1)) return null;
  const { rainPct, heatC } = settings.weatherShift;
  const shift = scenarioWeights(app, rainPct, heatC);
  const kept = shift ? years.map((year, i) => [year, i]).filter(([year]) => shift[year] > 0) : [];
  if (kept.length) {
    const weighted = (values) => kept.map(([year, i]) => [values[i], shift[year]]);
    return {
      typical: weightedPercentile(weighted(givenUp), 0.5),
      // the costly 1-in-5 from the high end: the same rule on the values turned around
      bad: -weightedPercentile(weighted(givenUp.map((d) => -d)), p),
      fail: weightedPercentile(weighted(baselineMargins), 0.5) + app.crops[cropCode].cost,
      years: [years[0], years.at(-1)],
    };
  }
  return {
    typical: median(givenUp),
    bad: badYearFromHighEnd(givenUp, p),
    fail: median(baselineMargins) + app.crops[cropCode].cost,
    years: [years[0], years.at(-1)],
  };
}
