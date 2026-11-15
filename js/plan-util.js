/* Pure helpers for the Plan screen: no DOM, no fetch, no globals, so they can be tested in Node.

   Words used here:
     needs     the array in data/crop-needs.json
     app       a parsed engine file (data/engine/ritzville.json or pullman.json)
     ranking   what engine.rank(app, opts) returns
     row       one entry of ranking.ranked
     factor    engine.toTodayFactor(app): engine dollars times this are today's dollars
     code      an engine crop code ('WW', 'P', ...) */

import { TEST_ACRES, TIE_DOLLARS, metricKey, optionIncomes, optionLabel, rank, testCost } from './engine.js';
import { localCounts } from './growcheck.js';
import {
  NO_DATA, centsPerPound, count, wordList, fahrenheit, inches, isNumber, money, moneyWithLoss, monthName, monthRange,
  pinText, plural, price, yearSpan,
} from './format.js';
import { boundsHold, boundsTouch, geometryBounds } from './geometry.js';

/** What each priority is called in a sentence. */
export const PRIORITY_WORDS = Object.freeze({
  steady: 'steady income in dry years',
  typical: 'the best normal year',
  soil: 'better soil',
});

/* What the table is sorted by, for each priority. */
const RANKED_BY = {
  steady: 'the dry year',
  typical: 'the normal year',
  soil: 'what is best for the soil first',
};

/** The price slider runs in percent of today's price, so its middle stop is today's price exactly. */
export const PRICE_PERCENT_TODAY = 100;

/** The yield slider: percent above or below the average harvest. */
export const YIELD_PERCENT_RANGE = Object.freeze({ low: -40, high: 40 });

/** Years shown in a rotation row. */
export const ROTATION_YEARS = 6;

/** The engine's code for a rest year (fallow). */
export const REST_CODE = 'F';

const QUICK_MIN_FIELDS = 15;
const QUICK_MAX_CROPS = 9;
const QUICK_ALWAYS = ['Peas', 'Lentils', 'Potatoes'];

const CHIP_KINDS = { WW: 'wheat', SW: 'spring', F: 'rest' };

const EARTH_RADIUS_MILES = 3958.8;

/* ---------- words ---------- */

/** "Peas" -> "peas", for the middle of a sentence. */
export function lowerName(name) {
  return String(name).toLowerCase();
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Pick the verb that fits the crop's name: "Peas start", "Canola starts". Names ending in s
    are plural (Peas, Lentils, Chickpeas); the rest are singular (Wheat, Barley, Canola). */
export function verbFor(cropName, singular, pluralForm) {
  return /s$/i.test(cropName) ? pluralForm : singular;
}

/** "in a dry year" for the steady priority, "in a normal year" for the other two. */
export function metricWords(priority) {
  return metricKey(priority) === 'typical' ? 'in a normal year' : 'in a dry year';
}

/** A price spelled out, for where it is first read: "$14.64 per 100 lb (14.6¢/lb)", "$5.88 a bushel". */
export function priceInWords(value, unit) {
  if (!isNumber(value)) return NO_DATA;
  const dollars = `$${value.toFixed(2)}`;
  return unit === 'cwt' ? `${dollars} per 100 lb (${centsPerPound(value)})` : `${dollars} a bushel`;
}

/** Where today's price comes from, as a sentence. The engine file's short note "US price x 1.01,
    Washington withheld" is spelled out; any other note is shown as it is written. */
export function priceSourceSentence(span, source, cropName) {
  const scaled = /^US price x ([\d.]+), Washington withheld$/.exec(source ?? '');
  if (scaled) {
    return `Source: USDA, ${span} average. USDA does not publish a Washington price for ${lowerName(cropName)} `
      + `for these months, so this is the US price times ${scaled[1]}.`;
  }
  return source ? `Source: USDA, ${span} average (${source}).` : `Source: USDA, ${span} average.`;
}

/* ---------- the quick buttons ---------- */

/** Names for the quick buttons: the crops most fields near here grow (the field's county, or every
    county for a bare pin), most common first, then Peas, Lentils and Potatoes if not there yet. */
export function quickCrops(needs, county) {
  const common = needs
    .map((crop) => ({ name: crop.name, fields: localCounts(crop, county).total }))
    .filter((crop) => crop.fields >= QUICK_MIN_FIELDS)
    .sort((a, b) => b.fields - a.fields)
    .slice(0, QUICK_MAX_CROPS)
    .map((crop) => crop.name);
  const known = new Set(needs.map((crop) => crop.name));
  const extra = QUICK_ALWAYS.filter((name) => known.has(name) && !common.includes(name));
  return [...common, ...extra];
}

/** The engine's code for a crop name ("Peas" -> "P"), or null when the engine does not know it. */
export function cropCodeFor(cropName, cropCodes) {
  return cropCodes?.[cropName] ?? null;
}

/* ---------- which rotations the chosen crop is in ---------- */

/** How the chosen crop sits in the ranking. Returns { mode, optionIds, option }:
      mode 'none'     no option grows the crop (or it has no engine code)
      mode 'current'  the rotation grown now already has it
      mode 'option'   another rotation has it; `option` is the best-ranked such row
    optionIds lists every ranked option that grows the crop, best first. */
export function highlightPlan(ranking, code) {
  const rows = code ? ranking.ranked.filter((row) => row.crops.includes(code)) : [];
  const optionIds = rows.map((row) => row.option_id);
  if (!rows.length) return { mode: 'none', optionIds, option: null };
  if (optionIds.includes(ranking.current_option)) return { mode: 'current', optionIds, option: null };
  return { mode: 'option', optionIds, option: rows[0] };
}

/** The sentence under the table heading that says where the chosen crop is. */
export function cropNote(mode, cropName) {
  const crop = lowerName(cropName);
  if (mode === 'none') {
    return `No rotation with ${crop} has been tested for this area yet. The table shows the rotations that have.`;
  }
  const marked = `Rotations with ${crop} are marked in the table.`;
  if (mode === 'current') return `${cropName} ${verbFor(cropName, 'is', 'are')} part of what you grow now. ${marked}`;
  return marked;
}

/* ---------- rotation names ---------- */

/** One crop of a rotation as a chip: { code, label, kind }. kind is 'wheat' (lines), 'spring'
    (plain wheat color), 'rest' (plain grey) or 'other' (hatch). */
export function chipFor(code, crops) {
  const label = code === REST_CODE ? 'Rest' : crops?.[code]?.name ?? code;
  return { code, label, kind: CHIP_KINDS[code] ?? 'other' };
}

/** The name a rotation goes by on the screen. The engine file words the rotation grown now as an
    instruction at some fields ("Keep chickpeas"). That is not a name, so that row is named by its
    crops instead: "Winter wheat, spring wheat, chickpeas". */
export function rotationName(app, optionId) {
  const option = app.options?.[optionId];
  if (!option) return '';
  const label = optionLabel(option.label);
  const isInstruction = /^(keep|swap)\b/i.test(label);
  if (!isInstruction) return label;
  return capitalize(option.crops.map((code) => lowerName(chipFor(code, app.crops).label)).join(', '));
}

/* ---------- the table ---------- */

/** Engine dollars as a number in today's dollars, or null when either part is missing. */
export function todayDollars(value, factor) {
  return isNumber(value) && isNumber(factor) ? value * factor : null;
}

/** A money cell: today's dollars, whole, and a loss says so ("−$12, a loss"). Null when missing. */
export function moneyCell(value, factor) {
  const dollars = todayDollars(value, factor);
  return dollars === null ? null : moneyWithLoss(dollars);
}

/** The whole dollars a cell shows, as a number, so sums in sentences agree with the table. */
export function shownDollars(value, factor) {
  const dollars = todayDollars(value, factor);
  if (dollars === null) return null;
  return Math.sign(dollars) * Math.round(Math.abs(dollars)) + 0;
}

/** The marks on a table row, as [{ kind, text }]. The top row is "Best for: ..." unless the top two
    are too close to call; then both say so. Ranked for soil, the top row says only that it ranks
    first, and every row shows the soil points it was ranked by. */
export function rowMarks({ row, index, ranking, priority, highlightIds = [], cropName = '', onPaper = false }) {
  const marks = [];
  if (ranking.tie && index < 2) marks.push({ kind: 'tie', text: 'Too close to call' });
  else if (index === 0 && onPaper) marks.push({ kind: 'paper', text: 'Might pay more' });
  else if (index === 0 && priority === 'soil') marks.push({ kind: 'best', text: 'Ranked first for soil' });
  else if (index === 0) marks.push({ kind: 'best', text: `Best for: ${PRIORITY_WORDS[priority]}` });
  if (row.option_id === ranking.current_option) marks.push({ kind: 'now', text: 'What you grow now' });
  if (highlightIds.includes(row.option_id)) marks.push({ kind: 'has', text: `Has ${lowerName(cropName)}` });
  if (priority === 'soil' && isNumber(row.soil_score)) marks.push({ kind: 'soil', text: `Soil points: ${row.soil_score}` });
  if (!row.full_record) marks.push({ kind: 'short', text: `Shorter record (${yearSpan(...row.years)})` });
  return marks;
}

/** The line that says how the table is ordered, and why. */
export function rankedBySentence(priority) {
  return `Ranked by ${RANKED_BY[priority]}, because you chose ${PRIORITY_WORDS[priority]}.`;
}

/** What the soil points are, and where they come from. The rule is soil_score() in
    fieldshift/pipeline.py with SOIL_POINTS in fieldshift/config.py. */
export const SOIL_POINTS_NOTE = 'Soil points are Fieldproof\'s own rule of thumb, not a soil test. '
  + 'A rotation gets points for peas, lentils and chickpeas, which add nitrogen, and for the crop that follows them. '
  + 'Barley and canola get a point for breaking up wheat after wheat. Wheat right after wheat loses a point. '
  + 'More points rank higher. A soil test should decide.';

/** What ranking for soil costs or earns: the top row next to what is grown now, in dollars.
    `lead` is leadOverCurrent() for the top row (null: it is the rotation grown now, or unknown). */
export function soilTradeOff({ topName, topIsCurrent, lead, years = null }) {
  if (topIsCurrent) return 'What you grow now ranks first for soil.';
  if (lead === null) return '';
  const when = `in a normal year${sharedYearsNote(years)}`;
  if (lead === 0) return `The top row, “${topName}”, earns about the same as what you grow now ${when}.`;
  const side = lead > 0 ? 'more' : 'less';
  return `The top row, “${topName}”, earns ${money(Math.abs(lead))} an acre ${side} than what you grow now ${when}.`;
}

/** The top two rows when they are too close to call, or null. `gap` is how far apart the two cells
    on screen are, in whole dollars; `threshold` is the engine's tie rule in today's dollars. */
export function tieFacts(ranking, priority, factor) {
  const [first, second] = ranking.ranked;
  if (!ranking.tie || !first || !second) return null;
  const key = metricKey(priority);
  const top = shownDollars(first[key], factor);
  const next = shownDollars(second[key], factor);
  if (top === null || next === null) return null;
  return {
    optionIds: [first.option_id, second.option_id],
    gap: Math.abs(top - next),
    threshold: Math.round(TIE_DOLLARS * factor),
  };
}

/** The note under the table when the top two are too close to call. The engine's rule is a gap
    under TIE_DOLLARS in its own dollars; the note names the gap and the rule in today's dollars,
    the dollars the table shows. */
export function tieSentence({ gap, threshold }, priority) {
  return `Too close to call. The top two are ${money(gap)} an acre apart ${metricWords(priority)}, `
    + `and we call anything under about ${money(threshold)} a tie. `
    + 'A soil test, your buyer and your equipment decide.';
}

/** The labels of options the engine could not rank (no usable years, or a missing price). */
export function leftOutLabels(app, ranking) {
  const ranked = new Set(ranking.ranked.map((row) => row.option_id));
  return Object.entries(app.options ?? {})
    .filter(([optionId]) => !ranked.has(optionId))
    .map(([, option]) => optionLabel(option.label));
}

/** Where an option stands: 1 is the top row. Null when it is not in the ranking. */
export function rankPosition(ranking, optionId) {
  const index = ranking.ranked.findIndex((row) => row.option_id === optionId);
  return index === -1 ? null : index + 1;
}

/** How many whole dollars an acre the option is ahead of what is grown now (negative: behind), on
    the stat the priority is judged by, from the same whole dollars the table shows. Null if unknown. */
export function leadOverCurrent(ranking, optionId, priority, factor) {
  const key = metricKey(priority);
  const option = ranking.ranked.find((row) => row.option_id === optionId);
  const current = ranking.ranked.find((row) => row.option_id === ranking.current_option);
  if (!option || !current) return null;
  const ahead = shownDollars(option[key], factor);
  const now = shownDollars(current[key], factor);
  return ahead === null || now === null ? null : ahead - now;
}

/* ---------- comparing two rotations on the same years ---------- */

function recordYears(app, optionId, prices) {
  return new Set(optionIncomes(app, optionId, { prices }).map(([year]) => year));
}

/** The engine file cut down to the years every one of `optionIds` has a record for, so that a
    rotation tracked since 2011 is not set against another one's 2005 to 2025.
    Returns { app, years }: years is [first, last] when years were dropped, and null when the
    rotations already cover the same years (then `app` is the file as it was given). */
export function sharedRecord(app, optionIds, prices = 'today') {
  const records = optionIds.map((optionId) => recordYears(app, optionId, prices));
  const shared = (app.years ?? []).filter((year) => records.every((record) => record.has(year)));
  const sameYears = records.every((record) => record.size === shared.length);
  if (sameYears || !shared.length) return { app, years: null };
  return { app: { ...app, years: shared }, years: [shared[0], shared.at(-1)] };
}

/** How far `optionId` is ahead of what is grown now, with both judged on the years both have a
    record for. `opts` are engine options (priority, prices and the sliders' overrides).
    Returns { lead, years, app }: lead as leadOverCurrent(), years and app as sharedRecord(). */
export function leadOnSharedYears(app, optionId, factor, opts) {
  const shared = sharedRecord(app, [optionId, app.current_option], opts.prices);
  const lead = leadOverCurrent(rank(shared.app, opts), optionId, opts.priority, factor);
  return { lead, years: shared.years, app: shared.app };
}

/** ", over the years both have records for (2011–2025)", or nothing when the whole record was used. */
function sharedYearsNote(years) {
  return years ? `, over the years both have records for (${yearSpan(...years)})` : '';
}

/** The table note for a rotation with a shorter record: what the rotation grown now shows over
    those same years. `now` is its row from rank() on the shared years. */
export function shortRecordNote({ name, years, now, factor }) {
  const typical = moneyCell(now?.typical, factor);
  const bad = moneyCell(now?.bad_year_climate, factor);
  const only = `“${name}” has a record for ${yearSpan(...years)} only.`;
  if (typical === null || bad === null) return only;
  return `${only} Over those same years, what you grow now shows ${typical} in a normal year. `
    + `In a dry year it shows ${bad}.`;
}

/* ---------- rotation rows ---------- */

/** Years shown in "Your rotation": 8 when either rotation shown is 4 years long, else 6. */
export function rotationYearsShown(...cropLists) {
  return cropLists.some((crops) => crops?.length === 4) ? 8 : ROTATION_YEARS;
}

/** A rotation's crops repeated to fill the years shown: ['WW', 'F'] -> WW F WW F WW F. */
export function rotationYears(crops, years = ROTATION_YEARS) {
  if (!crops?.length) return [];
  return Array.from({ length: years }, (_, year) => crops[year % crops.length]);
}

/* ---------- the two sliders ---------- */

/** The price at a slider stop, to the cent. 100 percent is today's price. */
export function priceAtPercent(todayPrice, percent) {
  return Math.round(todayPrice * percent) / 100;
}

/** The overrides to hand engine functions. A slider left at its start adds nothing, so the
    numbers are exactly the engine's own. */
export function whatIfOptions(code, todayPrice, pricePercent, yieldPercent) {
  const priceMoved = pricePercent !== PRICE_PERCENT_TODAY;
  return {
    priceOverride: priceMoved ? { [code]: priceAtPercent(todayPrice, pricePercent) } : {},
    yieldFactor: yieldPercent !== 0 ? { [code]: yieldPercent / 100 } : {},
  };
}

/** What a screen reader says for the price slider: "$12.37/cwt (12.4¢/lb), 20% above today's price". */
export function priceValueText(todayPrice, unit, percent) {
  const shown = price(priceAtPercent(todayPrice, percent), unit);
  if (percent === PRICE_PERCENT_TODAY) return `${shown}, today's price`;
  const gap = Math.abs(percent - PRICE_PERCENT_TODAY);
  return `${shown}, ${gap}% ${percent > PRICE_PERCENT_TODAY ? 'above' : 'below'} today's price`;
}

/** What the yield slider says: "10% above the average harvest". */
export function yieldValueText(percent) {
  if (percent === 0) return 'Same as the average harvest';
  return `${Math.abs(percent)}% ${percent > 0 ? 'above' : 'below'} the average harvest`;
}

/** Which prices and yield a number was worked out with, to start a sentence: "At today's prices",
    "At the price you set", "At each year's own price and the yield you set". `overrides` is
    whatIfOptions(); the price slider only counts with today's prices. */
export function basisWords(prices, overrides, code) {
  const yieldMoved = code in overrides.yieldFactor;
  if (prices !== 'today') return yieldMoved ? 'At each year\'s own price and the yield you set' : 'At each year\'s own price';
  const priceMoved = code in overrides.priceOverride;
  if (priceMoved) return yieldMoved ? 'At the price and yield you set' : 'At the price you set';
  return yieldMoved ? 'At today\'s prices and the yield you set' : 'At today\'s prices';
}

/* ---------- sentences ---------- */

/** The one line about the price that changes the answer.
    breakEven is engine.breakEvenPrice() (null: no price in range), today is today's price, lead is
    leadOverCurrent() at today's price. `years` is [first, last] when the two rotations were judged
    on the years both have a record for (sharedRecord), else null. */
export function breakEvenSentence({ cropName, label, breakEven, today, unit, lead, priority, years = null }) {
  if (breakEven === null) return `No ${lowerName(cropName)} price in this range changes the answer.`;
  if (breakEven > today) {
    const start = verbFor(cropName, 'starts', 'start');
    const judged = years ? ` Both are judged on ${yearSpan(...years)}, the years both have records for.` : '';
    return `${cropName} ${start} beating what you grow now at ${price(breakEven, unit)}. `
      + `Today: ${price(today, unit)}.${judged}`;
  }
  const when = `${metricWords(priority)}${sharedYearsNote(years)}`;
  if (!(lead > 0)) return `At today's price, “${label}” earns about the same as what you grow now ${when}.`;
  return `At today's price, “${label}” beats what you grow now by ${money(lead)} an acre ${when}.`;
}

/** Where the rotation stands in the table. With a slider moved (`moved`), also by how much it is
    ahead of or behind what is grown now: that is the short result read out after each change.
    `years` as in breakEvenSentence(). */
export function standingSentence({ label, position, total, lead, priority, moved, years = null }) {
  if (!moved) return `“${label}” is number ${position} of ${total} in the table.`;
  const place = `“${label}” is now number ${position} of ${total}.`;
  if (lead === null) return place;
  const when = `${metricWords(priority)}${sharedYearsNote(years)}`;
  if (lead === 0) return `${place} It earns the same as what you grow now ${when}.`;
  const side = lead > 0 ? 'more' : 'less';
  return `${place} It earns ${money(Math.abs(lead))} an acre ${side} than what you grow now ${when}.`;
}

/* ---------- the short answer ---------- */

function growClause(cropName, check) {
  if (check.cls === 'green') return `${cropName} can grow here`;
  if (check.cls === 'amber') {
    return `${cropName} might grow here, but ${verbFor(cropName, 'it is', 'they are')} not proven nearby`;
  }
  return `${cropName} ${verbFor(cropName, 'does', 'do')} not suit this field`;
}

/* "{start} earns $25 an acre less than what you grow now in a dry year." */
function earnsSentence(start, lead, when) {
  if (lead === 0) return `${start} earns about the same as what you grow now ${when}.`;
  const side = lead > 0 ? 'more' : 'less';
  return `${start} earns ${money(Math.abs(lead))} an acre ${side} than what you grow now ${when}.`;
}

/* The money half of the first sentence, for a crop that can grow here. */
function moneyClause(cropName, option) {
  if (option.tie) return ', but the money is too close to call';
  if (option.lead === null) return '';
  if (option.lead < 0) return `, but ${verbFor(cropName, 'it does', 'they do')} not pay yet`;
  if (option.lead === 0) return `, and ${verbFor(cropName, 'it pays', 'they pay')} about the same as what you grow now`;
  return `, and the numbers say ${verbFor(cropName, 'it pays', 'they pay')} more than what you grow now`;
}

/* The sentences for a rotation that is one of the top two, when those are too close to call.
   Tied with what is grown now over the same years, the gap between the two says it all. */
function tiedSentences({ basis, option }, when, versusNow) {
  const { name, tie, lead, years } = option;
  const other = tie.withCurrent ? 'what you grow now' : `“${tie.other}”`;
  const apart = `${basis}, “${name}” and ${other} are ${money(tie.gap)} an acre apart ${when}.`;
  const gapSaysItAll = tie.withCurrent && !years;
  if (gapSaysItAll || lead === null) return [apart];
  return [apart, earnsSentence('It', lead, versusNow)];
}

function priceNeededSentence(cropName, option) {
  if (option.needs) {
    const { unit } = option.needs;
    return breakEvenPriceSentence(cropName, option.needs.price, option.needs.today, unit);
  }
  return option.noPriceInRange ? `No ${lowerName(cropName)} price in the range we tried changes that.` : null;
}

function testAdvice(cropName, option) {
  const behind = option.lead < 0 && !option.tie;
  return behind
    ? `If you still want ${lowerName(cropName)}, check it against your own harvests first.`
    : `Check it against your own harvests before you change the whole field.`;
}

function optionDetails(cropName, facts) {
  const { basis, priority, option, canTest } = facts;
  const when = metricWords(priority);
  const versusNow = `${when}${sharedYearsNote(option.years)}`;
  const details = [];
  if (option.tie) {
    details.push(...tiedSentences(facts, when, versusNow));
  } else if (option.lead !== null) {
    const start = `${basis}, “${option.name}”, the best-ranked rotation with ${lowerName(cropName)},`;
    details.push(earnsSentence(start, option.lead, versusNow));
  }
  details.push(priceNeededSentence(cropName, option));
  if (canTest) details.push(testAdvice(cropName, option));
  return details.filter(Boolean);
}

function currentDetails({ basis, priority, now }) {
  const when = metricWords(priority);
  if (now.tie) {
    return [`${basis}, what you grow now and “${now.tie.other}” are ${money(now.tie.gap)} an acre apart ${when}. `
      + 'That is too close to call.'];
  }
  if (now.position === 1) {
    return [priority === 'soil'
      ? 'It ranks first for soil among the rotations we tested.'
      : `${basis}, no rotation we tested beats it ${when}.`];
  }
  if (now.topLead === null) return [`“${now.topName}” ranks first of ${now.total}.`];
  const start = priority === 'soil'
    ? `“${now.topName}” ranks first for soil. ${basis}, it`
    : `${basis}, the top row, “${now.topName}”,`;
  return [earnsSentence(start, now.topLead, `${when}${sharedYearsNote(now.topYears)}`)];
}

/** The answer in a few plain sentences, from numbers the screen already shows.
      cropName   the crop being checked
      check      growcheck.checkCrop(): { cls, headline }
      noMoney    why no dollars can be shown (a sentence), when `facts` is null
      facts      null, or { mode, basis, priority, canTest, option, now }:
        mode 'none'     no tested rotation has the crop
        mode 'option'   option = { name, lead, years, tie, needs, noPriceInRange } for the best-ranked
                        rotation with the crop. lead and years are leadOnSharedYears(). tie is null,
                        or { other, withCurrent, gap } when the rotation is one of the top two and
                        they are too close to call. needs is null, or { price, today, unit }: the
                        price at which the rotation matches what is grown now.
        mode 'current'  now = { position, total, tie, topName, topLead, topYears } for the rotation
                        grown now. tie is null or { other, gap }.
      basis is basisWords(); canTest says whether the smallest safe test is shown.
    Returns { lead, details }: the first sentence, then the sentences that back it up. */
export function shortAnswer({ cropName, check, facts, noMoney = '' }) {
  const grows = growClause(cropName, check);
  const whyNot = check.cls === 'red' ? [`${check.headline}.`] : [];
  const crop = lowerName(cropName);
  if (!facts) return { lead: `${grows}.`, details: [...whyNot, noMoney].filter(Boolean) };
  if (facts.mode === 'none') {
    const untested = `We have no money numbers for ${crop} here yet. No rotation with ${crop} has been tested for this area.`;
    return { lead: `${grows}.`, details: [...whyNot, untested] };
  }
  if (facts.mode === 'current') {
    const already = `${cropName} ${verbFor(cropName, 'is', 'are')} already part of what you grow now.`;
    return { lead: check.cls === 'red' ? `${grows}.` : already, details: [...whyNot, ...currentDetails(facts)] };
  }
  const lead = check.cls === 'green' ? `${grows}${moneyClause(cropName, facts.option)}.` : `${grows}.`;
  const tested = { ...facts, canTest: facts.canTest && check.cls !== 'red' };
  return { lead, details: [...whyNot, ...optionDetails(cropName, tested)] };
}

/* ---------- the smallest safe test ---------- */

/** "12 acres of peas, next to 12 acres of winter wheat". */
export function testHeadline(cropName, baselineName) {
  return `${TEST_ACRES} acres of ${lowerName(cropName)}, next to ${TEST_ACRES} acres of ${lowerName(baselineName)}`;
}

/* engine.testCost() per acre, as dollars today on the whole test strip. Null when a number is missing. */
export function testDollars(cost, factor) {
  const onTest = (perAcre) => {
    const dollars = todayDollars(perAcre, factor);
    return dollars === null ? null : dollars * TEST_ACRES;
  };
  const amounts = cost ? { typical: onTest(cost.typical), bad: onTest(cost.bad), fail: onTest(cost.fail) } : null;
  return amounts && Object.values(amounts).every((amount) => amount !== null) ? amounts : null;
}

/** engine.testCost() for the test, with the price and yield what-ifs in `overrides` and the active
    weather what-if, the same way the ranking and the break-even price get it. A missing or zero
    shift gives exactly testCost(app, cropCode, baselineCode, overrides). */
export function shiftedTestCost(app, cropCode, baselineCode, overrides = {}, weatherShift = null) {
  const shifted = weatherShift && (weatherShift.rainPct || weatherShift.heatC);
  return testCost(app, cropCode, baselineCode, shifted
    ? { ...overrides, weatherShift: { rainPct: weatherShift.rainPct ?? 0, heatC: weatherShift.heatC ?? 0 } }
    : overrides);
}

/** The three sentences of the smallest safe test. `cost` is engine.testCost() (dollars per acre, in
    engine dollars). Returns { typical, bad, fail } as text, or null when a number is missing. */
export function testSentences({ cost, factor, cropName, baselineName }) {
  const amounts = testDollars(cost, factor);
  if (!amounts) return null;
  const { typical, bad, fail } = amounts;

  const crop = lowerName(cropName);
  const baseline = lowerName(baselineName);
  const fails = `If the ${crop} ${verbFor(cropName, 'fails', 'fail')} completely`;
  const costsYou = `In a normal year this test costs you about ${money(typical)} next to growing ${baseline} `
    + `on those ${TEST_ACRES} acres.`;
  if (typical >= 0 && bad >= 0) {
    return {
      typical: costsYou,
      bad: `In a dry year, about ${money(bad)}.`,
      fail: `${fails}, about ${money(fail)}.`,
    };
  }
  return {
    typical: typical < 0
      ? `In a normal year it earns about ${money(-typical)} more than ${baseline} on those acres.`
      : costsYou,
    bad: bad < 0
      ? `In a dry year it still earns about ${money(-bad)} more.`
      : `In a dry year it costs you about ${money(bad)}.`,
    fail: `${fails}, it costs you about ${money(fail)}.`,
  };
}

/** The test again, next to ground left to rest: on a farm that rests ground, the new crop may go
    where the ground would have rested, not where the wheat would have been. `cost` is
    engine.testCost() against the rest year. Null when a number is missing. */
export function restTestSentence({ cost, factor, cropName }) {
  const amounts = testDollars(cost, factor);
  if (!amounts) return null;
  const { typical, bad, fail } = amounts;
  const crop = lowerName(cropName);
  const typicalYear = typical < 0 ? `comes out about ${money(-typical)} ahead` : `costs about ${money(typical)}`;
  const badYear = bad < 0 ? `still comes out about ${money(-bad)} ahead` : `costs about ${money(bad)}`;
  return `Your ground rests some years, so the ${crop} may go where it would have rested. `
    + `Next to resting ground, a normal year ${typicalYear}, a dry year ${badYear}, `
    + `and a failed crop costs about ${money(fail)}. `
    + `The wheat that follows may yield less after ${crop} than after rest. That is not counted.`;
}

/** What the test's numbers were worked out with: "At today's prices", "At your price", and the
    yield slider when it is moved. `overrides` is whatIfOptions(). */
export function testBasis(overrides, code, cropName) {
  const prices = code in overrides.priceOverride ? 'At your price' : 'At today\'s prices';
  const change = overrides.yieldFactor[code];
  if (!isNumber(change) || change === 0) return prices;
  const percent = Math.round(Math.abs(change) * 100);
  return `${prices}, with your ${lowerName(cropName)} yield ${percent}% ${change > 0 ? 'above' : 'below'} the average harvest`;
}

/** The test strips next to the whole field. Returns { fits, share, text }: share is the part of the
    field one strip takes (0 to 1), or null when the field's size is not known. */
export function testFootprint(acres) {
  const both = TEST_ACRES * 2;
  if (!isNumber(acres) || acres <= 0) return { fits: true, share: null, text: `${both} acres in all.` };
  if (acres < both) {
    return {
      fits: false,
      share: null,
      text: `This field is ${count(acres)} acres. The test needs ${both}, so it takes a bigger field.`,
    };
  }
  return { fits: true, share: TEST_ACRES / acres, text: `${both} of your ${count(acres)} acres.` };
}

/* ---------- the field ---------- */

/** The page title for the field. `sampleLabel` is the sample farm's name when it is one. */
export function fieldTitle(field, sampleLabel = null) {
  const acres = field.props?.ac;
  const name = sampleLabel ?? (field.props ? 'Your field' : 'Your pinned field');
  return isNumber(acres) ? `${name} · ${count(acres)} acres` : name;
}

/** The line under the title: water, what the state crop map says, the county, the pin. */
export function fieldMeta(field, water) {
  const parts = [water];
  if (field.props?.crop) {
    const rotates = field.props.rot ? ` (rotates with ${field.props.rot})` : '';
    parts.push(`State crop map: ${field.props.crop}${rotates}`);
  }
  if (field.county) parts.push(`${field.county} County`);
  parts.push(pinText(field.pin));
  return parts.join(' · ');
}

/** Is the field inside the area the state crop map covers? A field with a county is. A bare pin
    is when it falls inside a county's box; `counties` is the list in data/fields-index.json. */
export function insideCropMap(field, counties) {
  if (field.county) return true;
  return counties.some((county) => boundsHold(county.bbox, field.pin));
}

/** Miles between two [lon, lat] points, along the ground. */
export function milesBetween([lonA, latA], [lonB, latB]) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(latB - latA);
  const dLon = radians(lonB - lonA);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* What the farmer answered to "What do you grow now?", in the middle of a sentence. */
const ROTATION_ANSWERS = { wf: 'wheat, then rest', ww: 'wheat every year', other: 'something else' };

/** The note under the table about the row marked "What you grow now". `label` is the rotation the
    engine file compares against; `recorded` is that rotation as an answer to "What do you grow
    now?" ('wf', 'ww' or 'other'), and `answer` is what the farmer answered (or null). */
export function currentRotationNote(label, answer, recorded) {
  const unsure = `“What you grow now” is taken to be “${label}”. If you grow something else, your numbers will differ.`;
  if (!answer) return unsure;
  // "Something else" on both sides does not say the two rotations are the same one.
  if (answer === recorded) return answer === 'other' ? unsure : `“What you grow now” is “${label}”, as you told us.`;
  return `You told us you grow ${ROTATION_ANSWERS[answer]}. The records for this area cover “${label}”, `
    + 'so that is what “What you grow now” means here. Your numbers will differ.';
}

/* ---------- conditions ---------- */

function monthValues(values, digits) {
  return values.map((value, month) => `${monthName(month)} ${value.toFixed(digits)}`).join(', ');
}

/** The rain chart in words. `summary` is growcheck.climateSummary(). */
export function rainLine(summary) {
  return `${inches(summary.annualRainMm)} of rain a year. By month, in inches: ${monthValues(summary.monthlyRainIn, 1)}.`;
}

/** The frost card in words, or null when the weather record has no frost days. */
export function frostLine(summary) {
  if (summary.frostFreeMonths === null) return null;
  const months = `${summary.frostFreeMonths} ${plural(summary.frostFreeMonths, 'month', 'months')}`;
  return `${months} of the year average less than one frost day. `
    + `${count(summary.frostDaysPerYear)} frost days a year on average.`;
}

/** Does FAO EcoCrop give this crop a temperature range? Without one, no growing window can be
    worked out, which is not the same as there being none. */
export function hasTemperatureRange(crop) {
  return crop.tmin != null;
}

/** "May–Jun", "No window" when no run of months fits, or "Not known" when the crop has no
    temperature range to check against (`checked` false). `growWindow` is checkCrop().window. */
export function windowLabel(growWindow, checked = true) {
  if (!checked) return 'Not known';
  return growWindow ? monthRange(growWindow.startMonth, growWindow.months) : 'No window';
}

function bestMonthsSentence(growWindow, crop, checked) {
  if (!checked) return `FAO EcoCrop has no temperature range for ${crop}, so we can't say which months suit it.`;
  if (!growWindow) return `No run of months here is warm enough, long enough, for ${crop}.`;
  return `Best months for ${crop}: ${monthRange(growWindow.startMonth, growWindow.months)}.`;
}

/** The temperature chart in words. `checked` as in windowLabel(). */
export function windowLine(summary, growWindow, cropName, checked = true) {
  const { month, meanC } = summary.hottestMonth;
  const hottest = `Hottest month: ${monthName(month)}, ${fahrenheit(meanC)} on average.`;
  return `${bestMonthsSentence(growWindow, lowerName(cropName), checked)} ${hottest} `
    + `Average temperature by month, °F: ${monthValues(summary.monthlyMeanF, 0)}.`;
}

/** Which months (0 = January) the growing window covers. */
export function windowMonths(growWindow) {
  if (!growWindow) return [];
  return Array.from({ length: growWindow.months }, (_, offset) => (growWindow.startMonth + offset) % 12);
}

/* ---------- field outlines ---------- */

/** The features whose box touches `bounds`: the fields around the picked one. */
export function featuresNear(features, bounds) {
  return features.filter((feature) => {
    const box = geometryBounds(feature.geometry);
    return box !== null && boundsTouch(box, bounds);
  });
}

/* ---------- the answer first (spec 10.2), the caution (10.3) and the sources (10.5) ---------- */

/** The state-average crop codes of an option ([] when none or unknown). */
export function stateAverageCrops(app, optionId) {
  return app.options?.[optionId]?.yield_basis?.state_average ?? [];
}

/** Crop codes as lower-case names before "harvests": ['K'] -> "canola", ['P', 'L'] -> "dry pea and lentil". */
export function cropNames(app, codes) {
  return wordList(codes.map((code) => lowerName(app.crops?.[code]?.name ?? code).replace(/s$/, '')));
}

/** Does the top row lead only on paper: another rotation than the one grown now, whose harvests
    for some crop are Washington averages? */
export function leadsOnPaper(app, ranking) {
  const top = ranking.ranked[0];
  return Boolean(top) && top.option_id !== ranking.current_option && stateAverageCrops(app, top.option_id).length > 0;
}

function quoted(app, optionId) {
  return `“${lowerName(rotationName(app, optionId))}”`;
}

/** The one-sentence answer above everything (spec 10.2), from the ranking the screen shows.
    `checked` is null, or { cropName, lead, tie } for the best-ranked rotation with the crop being
    checked, when that is not what is grown now: lead is leadOnSharedYears().lead, tie is true when
    it is one of the top two and they are too close to call. When the top row leads only on
    state-average harvests, the checked crop's answer comes first, then the plain caution. */
export function answerFirst({ app, ranking, priority, prices, factor, checked = null }) {
  const [top, second] = ranking.ranked;
  if (!top) return '';
  const words = PRIORITY_WORDS[priority];
  if (ranking.tie && second) {
    const threshold = Math.round(TIE_DOLLARS * factor);
    const onPaper = stateAverageCrops(app, top.option_id).length > 0 && !checked?.tie;
    const first = onPaper ? checkedSentence(checked, priority) : null;
    return `${first ? `${first} ` : ''}Too close to call. “${capitalize(lowerName(rotationName(app, top.option_id)))}” and `
      + `${quoted(app, second.option_id)} are within ${money(threshold)} an acre for ${words}. `
      + 'Your own harvests decide it, so check them before you switch.';
  }
  if (top.option_id === ranking.current_option) {
    const at = prices === 'today' ? 'today\'s prices' : 'each year\'s own price';
    return `Keep ${lowerName(rotationName(app, top.option_id))}. Nothing tested beats it for ${words} at ${at}.`;
  }
  const key = metricKey(priority);
  const now = ranking.ranked.find((row) => row.option_id === ranking.current_option);
  const gap = now ? shownDollars(top[key], factor) - shownDollars(now[key], factor) : null;
  const name = `“${rotationName(app, top.option_id)}”`;
  const paper = stateAverageCrops(app, top.option_id);
  if (paper.length) {
    const first = checkedSentence(checked, priority);
    const note = paperNote(app, paper);
    return first ? `${first} ${note} Check it against your own harvests too.` : `${note} Check it against your own harvests before you switch.`;
  }
  if (!(gap > 0)) return `${name} comes out on top for ${words}.`;
  return `${name} comes out ahead of what you grow now by ${money(gap)} an acre for ${words}.`;
}

/* "What you grow now beats peas in a dry year." Null when there is no answer to give. */
function checkedSentence(checked, priority) {
  if (!checked || (checked.lead === null && !checked.tie)) return null;
  const { cropName } = checked;
  const crop = lowerName(cropName);
  const when = metricWords(priority);
  if (checked.tie) return `For ${PRIORITY_WORDS[priority]}, ${crop} and what you grow now are too close to call.`;
  if (checked.lead < 0) return `What you grow now beats ${crop} ${when}.`;
  if (checked.lead === 0) return `${cropName} ${verbFor(cropName, 'earns', 'earn')} about the same as what you grow now ${when}.`;
  return `${cropName} ${verbFor(cropName, 'beats', 'beat')} what you grow now ${when}.`;
}

/* "Canola might pay more, but we only have Washington-wide harvest numbers for it, not local ones." */
function paperNote(app, codes) {
  const names = codes.map((code) => app.crops?.[code]?.name ?? code);
  const subject = capitalize(lowerName(wordList(names)));
  const several = codes.length > 1 || /s$/i.test(names[0]);
  return `${subject} might pay more, but we only have Washington-wide harvest numbers for `
    + `${several ? 'them' : 'it'}, not local ones.`;
}

/** A yield cut as words: 0.3 -> "0.3", 20 -> "20". Under 1 keeps one decimal. */
export function cutPercent(factor) {
  const cut = (1 - factor) * 100;
  return cut < 1 ? cut.toFixed(1) : String(Math.round(cut));
}

/** The caution line under the money (spec 10.3), or null when the top row does not lead on paper.
    `moved` is true when a slider is off its start. */
export function leaderCaution({ app, ranking, priority, prices, moved }) {
  if (!leadsOnPaper(app, ranking)) return null;
  const top = ranking.ranked[0];
  const names = cropNames(app, stateAverageCrops(app, top.option_id));
  const row = (app.sensitivity?.leader_yield_sensitivity ?? [])
    .find((entry) => entry.priority === priority && entry.prices === prices);
  const usable = row && !moved && row.leader === top.option_id && isNumber(row.lead_lost_at_yield_factor) && row.flips_to;
  if (!usable) return `We only have Washington-wide ${names} harvest numbers, not local ones.`;
  const flips = `“${lowerName(rotationName(app, row.flips_to))}”`;
  const below = (factor) => `${cutPercent(factor)}% below the Washington average`;
  const parts = [];
  if (row.tie || !isNumber(row.tie_at_yield_factor)) {
    parts.push(`If ${names} harvests here are ${below(row.lead_lost_at_yield_factor)}, ${flips} comes out ahead.`);
  } else {
    parts.push(`If ${names} harvests here are ${below(row.tie_at_yield_factor)}, it is too close to call.`,
      `At ${cutPercent(row.lead_lost_at_yield_factor)}% below, ${flips} comes out ahead.`);
  }
  const same = row.same_years_check;
  if (same?.tie && !row.tie) parts.push(`On the same ${same.n_years} years, the top two are too close to call.`);
  return parts.join(' ');
}

/** "Peas would need to sell for $14.64 per 100 lb to break even (today: $10.31)." When today's
    price is already enough: "Peas sell for $14.64 per 100 lb today, above the $13.21 they need to break even." */
export function breakEvenPriceSentence(cropName, breakEven, today, unit) {
  const per = unit === 'cwt' ? 'per 100 lb' : unit === 'bu' ? 'a bushel' : `a ${unit}`;
  const dollars = (value) => `$${value.toFixed(2)}`;
  if (breakEven <= today) {
    return `${cropName} ${verbFor(cropName, 'sells', 'sell')} for ${dollars(today)} ${per} today, above the `
      + `${dollars(breakEven)} ${verbFor(cropName, 'it needs', 'they need')} to break even.`;
  }
  return `${cropName} would need to sell for ${dollars(breakEven)} ${per} to break even (today: ${dollars(today)}).`;
}

function sourceText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  return [value.document, value.table, value.caveat].filter(Boolean).join(' ');
}

/** Where each crop's numbers come from (spec 10.5): [{ name, cost, harvest }] for every crop in
    `optionIds`, rest years left out, each crop once. */
export function cropSources(app, optionIds) {
  const codes = [...new Set(optionIds.flatMap((id) => app.options?.[id]?.crops ?? []))]
    .filter((code) => code !== REST_CODE && app.crops?.[code]);
  return codes.map((code) => ({
    name: app.crops[code].name,
    cost: sourceText(app.crops[code].cost_source),
    harvest: sourceText(app.crops[code].yield_source),
  }));
}

/* ---------- compare crops: up to four picks, side by side ---------- */

/** How many crops the farmer can compare at once. */
export const MAX_PICKS = 4;

/** Said when the last place is taken, and when a crop past the most is refused. */
export const MAX_PICKS_SAY = `${MAX_PICKS} crops picked, the most you can compare. Remove one to add another.`;

/** The chip to focus after the farmer pressed the chip `name`: the same chip when it is still
    there, else the next chip that was after it, else the one before it, else null (focus the
    "More crops" button). `before` and `after` are the chip names in order. */
export function chipFocusAfter(before, name, after) {
  if (after.includes(name)) return name;
  const at = before.indexOf(name);
  const next = before.slice(at + 1).find((chip) => after.includes(chip));
  if (next) return next;
  const previous = before.slice(0, Math.max(at, 0)).reverse().find((chip) => after.includes(chip));
  return previous ?? null;
}

/** The picks as saved, made safe: known crop names, each once, at most MAX_PICKS. `focus` is the
    crop the rest of the screen checks (state.answers.crop). When the focus is not among the picks
    (a fresh session, or another screen changed the crop), the picks are just the focus.
    Returns { picks, focus }. */
export function cleanPicks(saved, focus, known) {
  const names = Array.isArray(saved)
    ? saved.filter((name, index) => known.includes(name) && saved.indexOf(name) === index).slice(0, MAX_PICKS)
    : [];
  if (names.includes(focus)) return { picks: names, focus };
  const only = known.includes(focus) ? focus : known[0];
  return { picks: only ? [only] : [], focus: only ?? null };
}

/** Add or take away one pick. The last pick stays (refused 'last'); a fifth is refused ('full').
    Taking away the focus crop moves the focus to the first pick left.
    Returns { picks, focus, refused }: refused is null when the change was made. */
export function togglePick(picks, name, focus) {
  if (picks.includes(name)) {
    if (picks.length === 1) return { picks, focus, refused: 'last' };
    const left = picks.filter((pick) => pick !== name);
    return { picks: left, focus: focus === name || !left.includes(focus) ? left[0] : focus, refused: null };
  }
  if (picks.length >= MAX_PICKS) return { picks, focus, refused: 'full' };
  return { picks: [...picks, name], focus, refused: null };
}

/** The crop check in a few words, from growcheck.checkCrop(): { kind, text }, or null before the
    weather record has arrived. kind is 'well', 'tight' (grows, but rain is below what the crop
    needs), 'maybe' (not proven nearby) or 'no'. A red check that only wants water on dryland
    ground says so, and has water: true. */
export function growVerdict(check) {
  if (!check) return null;
  if (check.cls === 'red' && check.water) return { kind: 'no', text: 'Needs irrigation here', water: true };
  if (check.cls === 'red') return { kind: 'no', text: 'Won\'t grow here' };
  const rainShort = check.reasons.some((reason) => reason.topic === 'rain' && reason.kind === 'no');
  if (rainShort) return { kind: 'tight', text: 'Grows, rain is tight' };
  if (check.cls === 'amber') return { kind: 'maybe', text: 'Might grow here' };
  return { kind: 'well', text: 'Grows well' };
}

/* One pick's money: the best-ranked rotation with the crop, as the money panel shows it. */
function pickMoney(app, ranking, code, factor, opts) {
  const plan = highlightPlan(ranking, code);
  const nowRow = ranking.ranked.find((row) => row.option_id === ranking.current_option);
  const row = plan.mode === 'option' ? plan.option : plan.mode === 'current' ? nowRow : null;
  if (!row) return null;
  const typical = shownDollars(row.typical, factor);
  const bad = shownDollars(row.bad_year_climate, factor);
  if (typical === null || bad === null) return null;
  const inNow = plan.mode === 'current';
  const tie = tieFacts(ranking, opts.priority, factor);
  const tiedWithNow = !inNow && Boolean(tie) && tie.optionIds.includes(row.option_id)
    && tie.optionIds.includes(ranking.current_option);
  return {
    optionId: row.option_id,
    rotation: rotationName(app, row.option_id),
    typical,
    bad,
    inNow,
    lead: inNow ? 0 : leadOnSharedYears(app, row.option_id, factor, opts).lead,
    tie: tiedWithNow,
    onPaper: !inNow && stateAverageCrops(app, row.option_id).includes(code),
  };
}

/* Which sentence a pick gets in the answer. */
function pickKind(grow, cash) {
  if (grow?.kind === 'no') return grow.water ? 'water' : 'no';
  if (!cash) return 'none';
  if (cash.inNow) return 'now';
  if (cash.tie || cash.lead === 0 || cash.lead === null) return 'same';
  if (cash.lead > 0) return cash.onPaper ? 'paper' : 'more';
  return cash.typical < 0 ? 'loss' : 'less';
}

/** The compare view, worked out from the same ranking the money panel shows.
      app, factor        the engine file and engine.toTodayFactor(app)
      ranking            engine.rank(app, { priority, prices, ...overrides })
      priority, prices   the farmer's choice and the price view
      overrides          the slider overrides the ranking was made with (whatIfOptions()), or none
      picks              [{ name, code, check }]: code is cropCodeFor() (or null), check is
                         growcheck.checkCrop() (or null while the weather loads)
    Returns { baseline, rows, low, high }: baseline is { rotation, typical, bad } for what is grown
    now (null without a ranked row), each row is { name, grow, money, kind, canTest }, and low and
    high are the ends of the shared dollar scale (0 is always inside). Without an engine file, pass
    app null: every row then has no money. */
export function compareView({ app, factor, ranking, priority, prices, picks, overrides = {} }) {
  const opts = { priority, prices, ...overrides };
  const nowRow = ranking?.ranked.find((row) => row.option_id === ranking.current_option) ?? null;
  const baseline = app && nowRow && shownDollars(nowRow.typical, factor) !== null
    ? { rotation: rotationName(app, nowRow.option_id), typical: shownDollars(nowRow.typical, factor), bad: shownDollars(nowRow.bad_year_climate, factor) ?? 0 }
    : null;
  const rows = picks.map(({ name, code, check }) => {
    const grow = growVerdict(check);
    const cash = app && ranking && code ? pickMoney(app, ranking, code, factor, opts) : null;
    const today = code ? app?.prices_today?.[code]?.nominal : null;
    const canTest = Boolean(cash) && !cash.inNow && today > 0 && grow?.kind !== 'no';
    return { name, grow, money: cash, kind: pickKind(grow, cash), canTest };
  });
  // Crops with dollars first, the biggest lead over what is grown now on top; then no dollars; then won't grow.
  const place = (row) => (row.kind === 'no' || row.kind === 'water' ? 2 : row.kind === 'none' ? 1 : 0);
  const lead = (row) => row.money?.lead ?? -Infinity;
  // The sort is stable: ties keep the order the crops were picked in, so rows don't swap when one is added.
  rows.sort((a, b) => place(a) - place(b) || lead(b) - lead(a));
  const all = [baseline, ...rows.map((row) => row.money)].filter(Boolean).flatMap((entry) => [entry.typical, entry.bad]);
  return { baseline, rows, low: Math.min(0, ...all), high: Math.max(0, ...all) };
}

const KIND_ORDER = ['more', 'paper', 'same', 'less', 'loss', 'now', 'none', 'water', 'no'];

function kindClause(kind, names, isBest) {
  const subject = wordList(names.map(lowerName));
  const verb = (one, many) => (names.length > 1 ? many : verbFor(names[0], one, many));
  switch (kind) {
    case 'more': return isBest ? `${subject} ${verb('pays', 'pay')} best` : `${subject} ${verb('pays', 'pay')} more too`;
    case 'paper': return isBest ? `${subject} might pay more, but check your own harvests` : `${subject} might pay more too`;
    case 'same': return `${subject} ${verb('earns', 'earn')} about the same as now`;
    case 'less': return `${subject} ${verb('pays', 'pay')} less than what you grow now`;
    case 'loss': return `${subject} ${verb('loses', 'lose')} money here`;
    case 'now': return `${subject} ${verb('is', 'are')} already in what you grow now`;
    case 'none': return `${subject} ${verb('has', 'have')} no price data yet`;
    case 'water': return `${subject} ${verb('needs', 'need')} irrigation here`;
    default: return `${subject} won't grow here`;
  }
}

/** The one plain answer above the compare rows: "Of your picks, canola might pay more, but test
    it small; peas lose money here; hops won't grow here." The pick that leads what is grown now by
    the most comes first; when its harvests are Washington averages, it only "might pay more". */
export function compareAnswer(rows) {
  if (!rows.length) return '';
  const leaders = rows.filter((row) => row.kind === 'more' || row.kind === 'paper')
    .sort((a, b) => b.money.lead - a.money.lead);
  const best = leaders[0] ?? null;
  const clauses = best ? [kindClause(best.kind, [best.name], true)] : [];
  for (const kind of KIND_ORDER) {
    const names = rows.filter((row) => row.kind === kind && row !== best).map((row) => row.name);
    if (names.length) clauses.push(kindClause(kind, names, false));
  }
  return `Of your picks, ${clauses.join('; ')}.`;
}

/* ---------- the weather what-if ---------- */

/** The short line under the weather sliders, built from the panel's own ranking:
    "With this weather: “wheat, then rest” still comes out ahead. Canola needs $24.10 a bushel to
    match what you grow now." `untouchedTopId` is the top option with no weather shift, so "still"
    is only said when the shift did not change the top. `breakEven` is { price, unit } for the
    checked crop, { price: null } when no price in range is enough, or null to leave it out. */
export function weatherResultLine({ ranking, shifted, untouchedTopId = null, cropName = '', breakEven = null }) {
  const lead = shifted ? 'With this weather' : 'With usual weather';
  const [top, second] = ranking?.ranked ?? [];
  if (!top) return '';
  const name = (row) => `“${optionLabel(row.label)}”`;
  const parts = [];
  if (second && ranking.tie) {
    parts.push(`${lead}: ${name(top)} and ${name(second)} are too close to call.`);
  } else {
    const still = shifted && untouchedTopId === top.option_id ? 'still ' : '';
    parts.push(`${lead}: ${name(top)} ${still}comes out ahead.`);
  }
  if (breakEven && cropName) {
    if (isNumber(breakEven.price)) {
      const per = breakEven.unit === 'cwt' ? 'per 100 lb' : breakEven.unit === 'bu' ? 'a bushel' : `a ${breakEven.unit}`;
      parts.push(`${cropName} ${verbFor(cropName, 'needs', 'need')} $${breakEven.price.toFixed(2)} ${per} to match what you grow now.`);
    } else {
      parts.push(`No ${lowerName(cropName)} price we tried matches what you grow now.`);
    }
  }
  return parts.join(' ');
}

/** The plain what-if sentence, used alone when the climate-model file has nothing to say. */
export const WHAT_IF_NOT_FORECAST = 'This is a what-if, not a forecast.';

/** One honest line for next to the rain slider, from data/engine/future-rain.json. It says the
    models show no clear change only when the file itself says so for every scenario at this field
    (the middle, lowest and highest model all inside what chance alone gives). Otherwise, or when the
    file is missing, just the what-if sentence. `place` is "here" or "around the X sample farm". */
export function rainOutlookNote(future, fieldId, place = 'here') {
  const scenarios = Object.values(future?.fields?.[fieldId]?.scenarios ?? {});
  const noClearChange = scenarios.length > 0 && scenarios.every((scenario) =>
    scenario?.dry_springs_per_20yr?.median_inside_chance_range === true
    && scenario?.dry_springs_per_20yr?.lowest_and_highest_inside_chance_range === true);
  const models = Array.isArray(future?.models) ? future.models.length : 0;
  const [from, to] = Array.isArray(future?.future_years) ? future.future_years : [];
  if (!noClearChange || !models || !isNumber(from) || !isNumber(to)) return WHAT_IF_NOT_FORECAST;
  return `NASA's ${models} climate models show no clear change in dry springs ${place} for ${from} to ${to}. `
    + WHAT_IF_NOT_FORECAST;
}
