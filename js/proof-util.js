/* Words and numbers for the Proof screen. Pure functions: no DOM, no fetch, no globals.

   Names used below:
     app      a parsed data/engine/{ritzville,pullman}.json
     config   one entry of data/engine/fields.json (id, county, town, gaps, cost_source, ...)
     climate  a parsed data/engine/{id}-climate.json
     future   a parsed data/engine/future-rain.json

   Every builder returns null (or an empty list) when the data it needs is missing, so the screen
   can leave the part out instead of showing a broken number. */

import { optionIncomes, optionLabel, toTodayFactor } from './engine.js';
import {
  isNumber,
  money,
  mmToInches,
  percent,
  percentOfShare,
  plural,
  wordList,
  yearList,
  yearSpan,
} from './format.js';

const TREND_KEY = 'trend_at_field_1981_2025';
const TREND_START_YEAR = 1981;

/* The two ends of the region's rain bands, as the climate file names them. */
const DRY_BAND = { key: 'spring_rain_below_160mm', text: 'under 160 mm (6.3 in)' };
const WET_BAND = { key: '230mm_and_up', text: '230 mm (9 in) or more' };

/* Plain names for the ways of choosing a rotation that the split test compares. */
const STRATEGY_NAMES = {
  'model (best climate-adjusted bad year)': "Fieldproof's method",
  'keep current rotation': 'Keep what you grow now',
  'chase the best typical year': 'Pick the best typical year',
  "copy last year's best option": "Copy last year's best rotation",
  'copy what most neighbors grew': 'Copy what most neighbors grew',
};

const METHOD_STRATEGY = 'model (best climate-adjusted bad year)';
const KEEP_STRATEGY = 'keep current rotation';

/* ---------- small helpers ---------- */

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A percent as the data gives it: 45.2 -> "45.2%", 10 -> "10%". */
function plainPercent(value) {
  return percent(value, Number.isInteger(value) ? 0 : 1);
}

/* ---------- years ---------- */

/** First and last year of the engine record: [2005, 2025], or null. */
export function recordYears(app) {
  const years = app?.years;
  if (!Array.isArray(years) || years.length === 0) return null;
  return [years[0], years.at(-1)];
}

/** "2017-2025" -> [2017, 2025]; a single year "2021" -> [2021, 2021]; anything else -> null. */
export function parseYearRange(text) {
  const match = /^\s*(\d{4})(?:\s*[-–]\s*(\d{4}))?\s*$/.exec(String(text ?? ''));
  if (!match) return null;
  const first = Number(match[1]);
  const last = match[2] ? Number(match[2]) : first;
  return last >= first ? [first, last] : null;
}

/** The years the split test scored on, from its first row: [2017, 2025], or null. */
export function testYears(app) {
  return parseYearRange(app?.validation?.split?.[0]?.test_years);
}

/** The years the split test could see: the first record year to the year before scoring starts. */
export function trainYears(app) {
  const record = recordYears(app);
  const scored = testYears(app);
  if (!record || !scored || scored[0] <= record[0]) return null;
  return [record[0], scored[0] - 1];
}

/* ---------- 1. The replay ---------- */

/* The replay does not only test the farmer's own rotation. It starts from every rotation that has
   a full record, one at a time, and asks the method each time: stay, or switch? So "switch" in its
   count can mean a switch to the rotation this farmer already grows. The sentences below say so. */

/** A rotation's name inside a sentence: “Wheat, then rest”. */
function quotedLabel(option) {
  return `“${optionLabel(option.label)}”`;
}

/** The rotations the replay starts from (a full record) and the ones it leaves out (a shorter one). */
function optionsByRecord(app) {
  const options = Object.values(app?.options ?? {});
  return {
    full: options.filter((option) => option.full_record === true),
    short: options.filter((option) => option.full_record === false),
  };
}

function startsSentence(app) {
  const starts = optionsByRecord(app).full.length;
  if (starts < 2) return null;
  return `We started from each of the ${starts} rotations that have a full record, one at a time.`;
}

function switchResultSentence(validation) {
  const worst = validation.any_start_share_worst;
  const mean = validation.any_start_share_mean;
  if (!isNumber(worst) || !isNumber(mean)) return null;
  return `When it said to switch, the switch did at least as well as staying put in the worst year `
    + `${percentOfShare(worst)} of the time, and at least as well on average ${percentOfShare(mean)} of the time.`;
}

/** The plain paragraph about the replay, or null when the engine file has no usable test. */
export function replayParagraph(app) {
  const record = recordYears(app);
  const validation = app?.validation;
  if (!record || !isNumber(validation?.any_start_switches) || !isNumber(validation?.any_start_windows)) {
    return null;
  }
  const sentences = [
    `We replayed ${yearSpan(...record)}.`,
    startsSentence(app),
    "Each time, the method could only see the years before, and it priced each year at that year's own price.",
    `It said to switch rotations in ${validation.any_start_switches} of ${validation.any_start_windows} tests.`,
    validation.any_start_switches > 0 ? switchResultSentence(validation) : null,
  ];
  return sentences.filter(Boolean).join(' ');
}

/** "Of the 36 tests, 9 start from the rotation you grow now. ...", or null when the file cannot
    say: the current rotation has a short record, or the tests do not divide evenly by start. */
function ownStartSentence(app) {
  const starts = optionsByRecord(app).full.length;
  const tests = app.validation.any_start_windows;
  const currentIsStart = app.options?.[app.current_option]?.full_record === true;
  if (!currentIsStart || starts < 2 || tests % starts !== 0) return null;
  return `Of the ${tests} tests, ${tests / starts} start from the rotation you grow now. `
    + 'The others start from one of the other rotations.';
}

/** "The rotation “Canola, then rest” has a shorter record, so it is not in this replay.", or null. */
function shortRecordSentence(app) {
  const labels = optionsByRecord(app).short.map(quotedLabel);
  if (labels.length === 0) return null;
  if (labels.length === 1) return `The rotation ${labels[0]} has a shorter record, so it is not in this replay.`;
  return `The rotations ${wordList(labels)} have shorter records, so they are not in this replay.`;
}

/** The split-test row of one strategy, as the engine file has it, or null. */
function splitRowOf(app, strategy) {
  const split = app?.validation?.split;
  return Array.isArray(split) ? split.find((row) => row.strategy === strategy) ?? null : null;
}

/** What the method picked in the split test, by name, or null when the file does not say. */
function methodPickSentence(app) {
  const picked = splitRowOf(app, METHOD_STRATEGY)?.picked;
  const option = app?.options?.[picked];
  if (!option) return null;
  const isCurrent = picked === app.current_option;
  return `In the split test below, the method picked ${quotedLabel(option)}${isCurrent ? ', which is what you grow now' : ''}.`;
}

/** What to keep in mind when reading the replay paragraph: how many tests start from the
    farmer's own rotation, which rotations are not in it, and what the method picked in the one
    test the page shows in full. An empty list when the engine file has no usable replay. */
export function replayNotes(app) {
  if (!replayParagraph(app)) return [];
  return [ownStartSentence(app), shortRecordSentence(app), methodPickSentence(app)].filter(Boolean);
}

/* ---------- 2. The split test ---------- */

/** A plain name for a strategy; one we have no name for is shown as written, with a capital. */
export function strategyName(strategy) {
  const text = String(strategy ?? '');
  return STRATEGY_NAMES[text] ?? capitalize(text);
}

/** "Chosen with 2005–2016, scored on 2017–2025.", or null when the years cannot be read. */
export function splitCaption(app) {
  const train = trainYears(app);
  const scored = testYears(app);
  if (!train || !scored) return null;
  return `Chosen with ${yearSpan(...train)}, scored on ${yearSpan(...scored)}.`;
}

function toToday(value, factor) {
  return isNumber(value) ? value * factor : null;
}

/** The rotation a strategy picked, by name. The one grown now says so in the Plan screen's words. */
function pickedLabel(app, optionId) {
  const option = app.options?.[optionId];
  if (!option) return String(optionId ?? '');
  const label = optionLabel(option.label);
  return optionId === app.current_option ? `${label} (what you grow now)` : label;
}

/** The split-test rows in today's dollars per acre (not rounded), or null when they cannot be
    shown: no split test in the file, or no wheat price to bring the dollars to today. */
export function splitRows(app) {
  const split = app?.validation?.split;
  const factor = app ? toTodayFactor(app) : null;
  if (!Array.isArray(split) || split.length === 0 || !isNumber(factor)) return null;
  return split.map((row) => ({
    strategy: strategyName(row.strategy),
    isMethod: row.strategy === METHOD_STRATEGY,
    isKeep: row.strategy === KEEP_STRATEGY,
    optionId: row.picked,
    picked: pickedLabel(app, row.picked),
    badYear: toToday(row.test_bad_year, factor),
    worstYear: toToday(row.test_worst_year, factor),
    average: toToday(row.test_mean, factor),
  }));
}

/** Whole dollars as money() rounds them: half goes away from zero. */
function wholeDollars(amount) {
  return Math.sign(amount) * Math.round(Math.abs(amount));
}

/* The dollars the table shows are whole dollars, so the gaps are taken between whole dollars too.
   A reader who subtracts two cells of the table gets the number the sentence gives. */
function wholeDollarGap(methodAmount, keepAmount) {
  if (!isNumber(methodAmount) || !isNumber(keepAmount)) return null;
  return wholeDollars(methodAmount) - wholeDollars(keepAmount);
}

/** "$15 behind", "$9 ahead" or "level". */
function gapWords(gap) {
  if (gap === 0) return 'level';
  return `${money(Math.abs(gap))} ${gap > 0 ? 'ahead' : 'behind'}`;
}

/** The first gap of the sentence also says per acre and next to what. */
function firstGapWords(gap) {
  if (gap === 0) return 'level with staying put';
  const amount = `${money(Math.abs(gap))} an acre`;
  return gap > 0 ? `${amount} ahead of staying put` : `${amount} behind staying put`;
}

function methodAgainstKeepSentence(method, keep) {
  if (method.optionId === keep.optionId) {
    return "In this split, Fieldproof's method said to keep what you grow now.";
  }
  const gaps = [
    wholeDollarGap(method.badYear, keep.badYear),
    wholeDollarGap(method.worstYear, keep.worstYear),
    wholeDollarGap(method.average, keep.average),
  ];
  if (gaps.includes(null)) return null;
  return `In this split, Fieldproof's pick came out ${firstGapWords(gaps[0])} in a bad year, `
    + `${gapWords(gaps[1])} in the worst year and ${gapWords(gaps[2])} on average.`;
}

function hasSharedPick(rows) {
  return new Set(rows.map((row) => row.optionId)).size < rows.length;
}

function smallTestSentence(app) {
  const windows = app.validation.any_start_windows;
  const replay = isNumber(windows) ? ` The replay above runs ${windows} tests.` : '';
  return `One split is a single check.${replay}`;
}

/** The split table read out in words: how the method's pick did next to keeping the current
    rotation. Null when the table cannot be shown or one of the two rows is not in it. */
export function splitReading(app) {
  const rows = splitRows(app);
  const method = rows?.find((row) => row.isMethod);
  const keep = rows?.find((row) => row.isKeep);
  const comparison = method && keep ? methodAgainstKeepSentence(method, keep) : null;
  if (!comparison) return null;
  const sentences = [comparison];
  if (hasSharedPick(rows)) sentences.push('Rows that picked the same rotation show the same numbers.');
  sentences.push(smallTestSentence(app));
  return sentences.join(' ');
}

/* ---------- 3. Hot, dry years ---------- */

/** One entry per year of the weather record, oldest first:
    { year, inches (null when the record has no spring rain for it), hotDry }. */
export function rainBars(app) {
  const weather = Array.isArray(app?.weather) ? app.weather : [];
  const hotDry = new Set(app?.hot_dry_years ?? []);
  return weather
    .filter((entry) => Number.isInteger(entry?.year))
    .map((entry) => ({
      year: entry.year,
      inches: isNumber(entry.rain_spring_mm) ? mmToInches(entry.rain_spring_mm) : null,
      hotDry: hotDry.has(entry.year),
    }))
    .sort((a, b) => a.year - b.year);
}

/** The top of the chart's scale: the next whole inch above the wettest spring. */
export function rainScaleMax(bars) {
  const wettest = Math.max(0, ...bars.map((bar) => bar.inches ?? 0));
  return Math.max(1, Math.ceil(wettest));
}

/** "Dry years: 2007, 2008 and 2021. Source: NASA POWER." */
export function hotDrySentence(app) {
  const years = [...(app?.hot_dry_years ?? [])].sort((a, b) => a - b);
  if (years.length === 0) return 'No year in this record is marked as a dry year. Source: NASA POWER.';
  return `Dry years: ${yearList(years)}. Source: NASA POWER.`;
}

/** Where the weather record was taken: at the sample farm itself, or near its town. */
export function weatherPlace(config, field) {
  if (field?.sampleId && field.sampleId === config?.id) return 'at this field';
  return config?.town ? `near ${config.town}` : 'near this field';
}

/* ---------- 5. Where the weather is heading (spec 10.7) ---------- */

/* The trend blocks of the climate file, in the order the page shows them. Each knows its unit and
   the key that holds the same change in US units. The file gives both: nothing is converted here. */
const TREND_BLOCKS = [
  { key: 'heat_daily_high_junjul_c', unit: '°C', usKey: 'per_decade_f', usUnit: '°F' },
  { key: 'heat_junjul_c', unit: '°C', usKey: 'per_decade_f', usUnit: '°F' },
  { key: 'rain_spring_mm', unit: 'mm', usKey: 'per_decade_in', usUnit: 'in' },
];

/** One sentence about one trend block. "has risen" or "has fallen" only when the file says the
    trend is clear (`clear === true`); never from p_value alone. Null when the block is missing. */
export function trendSentence(measure, trend) {
  const known = TREND_BLOCKS.find((entry) => entry.key === measure);
  if (!known || !trend?.label) return null;
  const label = capitalize(String(trend.label));
  const metric = trend.per_decade;
  const us = trend[known.usKey];
  if (trend.clear === true && isNumber(metric) && isNumber(us) && metric !== 0) {
    const direction = metric > 0 ? 'risen' : 'fallen';
    return `${label} has ${direction} about ${Math.abs(metric)} ${known.unit} (${Math.abs(us)} ${known.usUnit}) `
      + `per decade since ${TREND_START_YEAR}.`;
  }
  const note = typeof trend.note === 'string' && trend.note.trim() ? ` ${trend.note.trim()}` : '';
  return `${label} shows no clear trend since ${TREND_START_YEAR}.${note}`;
}

/** The trend sentences of a climate file, in page order, and the file's place note. */
export function trendLines(climate) {
  const block = climate?.[TREND_KEY];
  const trends = TREND_BLOCKS.map((entry) => trendSentence(entry.key, block?.[entry.key])).filter(Boolean);
  const placeNote = typeof block?.place_note === 'string' && block.place_note ? block.place_note : null;
  return { trends, placeNote };
}

/** The first trend the file calls clear: { label, perDecade, perDecadeUs, unit, usUnit }, or null. */
export function clearTrend(climate) {
  const block = climate?.[TREND_KEY];
  for (const entry of TREND_BLOCKS) {
    const trend = block?.[entry.key];
    if (trend?.clear === true && isNumber(trend.per_decade) && isNumber(trend[entry.usKey])) {
      return {
        key: entry.key,
        label: capitalize(String(trend.label)),
        perDecade: trend.per_decade,
        perDecadeUs: trend[entry.usKey],
        unit: entry.unit,
        usUnit: entry.usUnit,
      };
    }
  }
  return null;
}

function hasBandShares(band) {
  return isNumber(band?.pulse_pct) && isNumber(band?.fallow_pct);
}

/** The two sentences about the driest and wettest parts of the region, or null. */
export function bandSentences(bands) {
  const dry = bands?.[DRY_BAND.key];
  const wet = bands?.[WET_BAND.key];
  if (!hasBandShares(dry) || !hasBandShares(wet)) return null;
  return `Across the region's dryland farms, where spring rain is ${DRY_BAND.text}, pulses are `
    + `${plainPercent(dry.pulse_pct)} of acres and ${plainPercent(dry.fallow_pct)} rests each year. `
    + `Where it is ${WET_BAND.text}: ${plainPercent(wet.pulse_pct)} and ${plainPercent(wet.fallow_pct)}.`;
}

/** The text of the weather card, or null when there is nothing to say. */
export function climateCard(climate) {
  const { trends, placeNote } = trendLines(climate);
  const bands = bandSentences(climate?.region?.bands);
  if (trends.length === 0 && !bands) return null;
  return { trends, placeNote, bands, source: 'Sources: NASA POWER, USDA Crop Sequence Boundaries.' };
}

/* ---------- 6. Springs to come (spec 10.8) ---------- */

/** The text of the "Springs to come" part for one study field, or null when the file has nothing
    for it. The scenario lines are the file's own `card_line`: no sentence is built from counts. */
export function futureRainCard(future, fieldId) {
  const entry = future?.fields?.[fieldId];
  const scenarios = entry?.scenarios;
  if (!scenarios) return null;
  const lines = Object.values(scenarios)
    .filter((scenario) => scenario?.label && typeof scenario.card_line === 'string' && scenario.card_line)
    .map((scenario) => `${scenario.label}: ${scenario.card_line}`);
  if (lines.length === 0) return null;
  const models = Array.isArray(future.models) ? future.models.length : 0;
  return {
    scenarios: lines,
    definition: entry.dry_spring_definition_only || entry.dry_spring_definition || null,
    placeNote: entry.place_note || null,
    source: `Source: NASA NEX-GDDP-CMIP6, ${models} climate models.`,
  };
}

/** Each scenario's dots: { label, reading, baseline, counts: [[modelName, drySprings], ...] }. */
export function futureDots(future, fieldId) {
  const scenarios = future?.fields?.[fieldId]?.scenarios;
  if (!scenarios) return [];
  return Object.values(scenarios)
    .filter((scenario) => Array.isArray(scenario?.per_model) && isNumber(scenario?.dry_springs_per_20yr?.baseline))
    .map((scenario) => ({
      label: scenario.label,
      reading: typeof scenario.reading === 'string' ? scenario.reading : '',
      baseline: scenario.dry_springs_per_20yr.baseline,
      counts: scenario.per_model
        .filter((model) => isNumber(model?.dry_springs))
        .map((model) => [model.model, model.dry_springs]),
    }));
}

/* ---------- The opening (spec 10.6) ---------- */

const VERDICT_WORDS = [
  ['NOT SUPPORTED', 'Did not hold up', 'no'],
  ['NOT TESTABLE', 'Not enough history to prove it here.', 'unknown'],
  ['SUPPORTED', 'Held up', 'yes'],
  ['MIXED', 'Mixed', 'mixed'],
];

/** "Dry years are the 5 years of 21 with ..." The engine file calls them hot, dry years: the
    years with the least water, counted together with summer heat where heat tracks harvests. */
export function dryYearDefinition(app) {
  const text = app?.hot_dry_signal?.text;
  return typeof text === 'string' ? text.replace(/^Hot, dry years/, 'Dry years') : null;
}

/** The verdict in words, from the start of validation.verdict: { text, kind }, or null. */
export function verdictWords(app) {
  const verdict = String(app?.validation?.verdict ?? '').toUpperCase();
  const found = VERDICT_WORDS.find(([key]) => verdict.startsWith(key));
  return found ? { text: found[1], kind: found[2] } : null;
}

/** True when the method only ever kept the farmer's current rotation. */
export function onlyKeptCurrent(app) {
  const picks = app?.validation?.model_picks;
  if (!picks || typeof picks !== 'object') return false;
  const keys = Object.keys(picks);
  return keys.length === 1 && keys[0] === app.current_option && isNumber(picks[keys[0]]);
}

/** The short line under "Not enough history": "This ground grew wheat, then rest every time we
    checked, so there was no switch to judge. That's why Fieldproof says: test it on 12 acres."
    `rotation` is the current rotation in lower case. Null unless the method only ever kept it. */
export function notTestableLine(app, rotation, acres) {
  if (!onlyKeptCurrent(app) || !rotation) return null;
  return `This ground grew ${rotation} every time we checked, so there was no switch to judge. `
    + 'So check the numbers against your own harvests before you switch.';
}

/** "keep wheat, then rest"; a label that already starts with "Keep" is not given a second one. */
function keepWords(label) {
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  return /^keep\b/.test(lower) ? lower : `keep ${lower}`;
}

/** The opening paragraphs under the h1, as a list of paragraphs. Empty when the file has no test. */
export function openingParagraphs(app) {
  const record = recordYears(app);
  const validation = app?.validation;
  if (!record || !validation) return [];
  if (onlyKeptCurrent(app)) {
    const times = validation.model_picks[app.current_option];
    const option = app.options?.[app.current_option];
    const keep = option ? optionLabel(option.label) : 'what you grow now';
    const paragraphs = [
      `We replayed ${yearSpan(...record)}. Each time, the method could only see the years before, and we `
        + `scored its pick on the years after. For this farm it gave the same answer all ${times} times: `
        + `${keepWords(keep)}. So the past can't show whether a switch would `
        + 'have paid here. There was no switch to judge.',
    ];
    if (isNumber(validation.any_start_switches) && isNumber(validation.any_start_windows)
      && isNumber(validation.any_start_share_worst)) {
      paragraphs.push(`For farms starting on other rotations, it said to switch in ${validation.any_start_switches} `
        + `of ${validation.any_start_windows} tests, and the switch did at least as well in the worst year `
        + `${percentOfShare(validation.any_start_share_worst)} of the time. No mapped field near this one runs `
        + 'those rotations twice in a row, so that is background, not proof.');
    }
    paragraphs.push('That is why Fieldproof shows what would change the answer, and why your own harvests have the last word.');
    return paragraphs;
  }
  const text = replayParagraph(app);
  if (!text) return [];
  const here = validation.grown_here;
  const grown = isNumber(here?.switches) && here.switches > 0 && isNumber(here.share_worst)
    ? ` Counting only rotations grown near this field: ${here.switches} switches, `
      + `${percentOfShare(here.share_worst)} did at least as well in the worst year.`
    : '';
  return [text + grown];
}

/** How often the method looked back from the farmer's own rotation, and how often it said switch. */
export function ownLooks(app) {
  const own = (app?.validation?.by_start ?? []).find((row) => row.start === app.current_option);
  if (!own || !isNumber(own.windows) || !isNumber(own.switches)) return null;
  return { looks: own.windows, switches: own.switches, keeps: own.windows - own.switches };
}

/* ---------- The chart: every year of the farmer's own rotation ---------- */

/** One row per year of the current rotation: { year, today, hist, inches, hotDry }, in today's
    dollars an acre (not rounded). `today` sells every harvest at today's prices; `hist` at that
    year's own price. Empty when the file cannot give them. */
export function yearRows(app) {
  const factor = app ? toTodayFactor(app) : null;
  if (!isNumber(factor) || !app.options?.[app.current_option]) return [];
  const today = optionIncomes(app, app.current_option, { prices: 'today' });
  const hist = new Map(optionIncomes(app, app.current_option, { prices: 'hist' }));
  const rain = new Map(rainBars(app).map((bar) => [bar.year, bar.inches]));
  const hotDry = new Set(app.hot_dry_years ?? []);
  return today.map(([year, value]) => ({
    year,
    today: value * factor,
    hist: hist.has(year) ? hist.get(year) * factor : null,
    inches: rain.get(year) ?? null,
    hotDry: hotDry.has(year),
  }));
}

/** "all 5 dry years lost money at today's prices. So did 4 other years." Counted in whole
    dollars, as the chart shows them. Null with no years. */
export function chartFinding(rows) {
  if (!rows?.length) return null;
  const lost = (row) => wholeDollars(row.today) < 0;
  const hot = rows.filter((row) => row.hotDry);
  const hotLost = hot.filter(lost).length;
  const otherLost = rows.filter((row) => !row.hotDry && lost(row)).length;
  let first;
  if (hot.length === 0) first = 'no year here was a dry year.';
  else if (hotLost === hot.length) first = `all ${hot.length} dry years lost money at today's prices.`;
  else if (hotLost === 0) first = `none of the ${hot.length} dry years lost money at today's prices.`;
  else first = `${hotLost} of the ${hot.length} dry years lost money at today's prices.`;
  let second;
  if (otherLost === 0) second = hotLost > 0 ? 'No other year did.' : 'No year did.';
  else if (hotLost === 0) second = `${otherLost} other ${plural(otherLost, 'year', 'years')} did.`;
  else second = `So did ${otherLost} other ${plural(otherLost, 'year', 'years')}.`;
  return `${first} ${second}`;
}

/** "The lowest year, 2023, was not a dry year." */
export function lowestYearSentence(rows) {
  if (!rows?.length) return null;
  const lowest = rows.reduce((a, b) => (b.today < a.today ? b : a));
  return `The lowest year, ${lowest.year}, was ${lowest.hotDry ? '' : 'not '}a dry year.`;
}

/** "Today's wheat price: $5.88 a bushel (Jul to Sep 2026)." or null. */
export function wheatPriceSentence(app) {
  const wheat = app?.prices_today?.WW;
  if (!isNumber(wheat?.nominal)) return null;
  const span = app.prices_today_span ? ` (${app.prices_today_span})` : '';
  return `Today's wheat price: $${wheat.nominal.toFixed(2)} a bushel${span}.`;
}

/* ---------- Fields the test does not cover ---------- */

/** "The past-years test covers Adams and Whitman counties so far." `fields` is fields.json's list. */
export function coverageSentence(fields) {
  const counties = (fields ?? []).map((field) => field.county).filter(Boolean);
  if (counties.length === 0) return 'The past-years test does not cover any county yet.';
  const word = plural(counties.length, 'County', 'counties');
  return `The past-years test covers ${wordList(counties)} ${word} so far.`;
}
