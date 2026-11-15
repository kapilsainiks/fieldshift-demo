/* Can this crop grow on this field? Pure functions: no DOM, no fetch, no globals.

   `crop` is one entry of data/crop-needs.json: FAO EcoCrop limits (tmin, tmax, topmn, topmx in °C;
   rmin, rmax, ropmn in mm of rain a year; gmin in days) and `local`, the 2025 state crop map counts
   per county: { Adams: { dry, irr, dry_ac, irr_ac }, ... }.

   `climate` is NASA POWER climatology for the field (properties.parameter of the API answer):
   T2M (°C) and FROST_DAYS by month, PRECTOTCORR in mm a day by month and for the year (ANN).

   The rules started as tempCheck, rainCheck and verdictFor in the click-through mock (SPEC
   section 6). The local counts are the picked field's county, or all counties together when there
   is no county. Three rules are stricter than the mock's, so the verdict never says more than the
   evidence does:
   - "Grows here" needs at least 20 local fields. From 5 to 19 it is amber, gives the count, and
     says so when the weather could not be checked either.
   - A county with too few fields of a crop to tell borrows the wider count to see that it is an
     irrigated crop (potatoes in Whitman County).
   - Yearly rain alone is not enough for "Should grow here": if the crop's best run of months is the
     dry part of the year, the verdict is "Possible, but risky here".
   - On dryland ground, a crop whose yearly rain need (crop-needs rmin to ropmn, mm a year) is
     clearly more than the field's yearly rain (mm a year), and that no dryland fields in the data
     grow, "Needs irrigation here" (hops at Ritzville). */

import { cToF, count, inches, mmToInches, monthRange, plural, wordList } from './format.js';

const MONTH_KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS_PER_YEAR = 365;
const DAYS_PER_MONTH = 30.4;
const DEFAULT_SEASON_DAYS = 90;

/* A score of at least this is a good fit; above zero but below it is a stretch. */
const GOOD_FIT = 0.5;

/* Local proof. This many fields nearby prove a crop; from FEW_FIELDS up it is "grown on only a few
   fields", a hint and not proof. Dryland fields count only when they are at least this share of
   all the local fields growing the crop. */
const PROVEN_FIELDS = 20;
const FEW_FIELDS = 5;
const PROVEN_DRY_SHARE = 0.25;

/* A crop is an irrigated crop around here when at least this many local fields irrigate it and
   under this share of its fields are dryland. */
const IRRIGATED_CROP_FIELDS = 10;
const IRRIGATED_CROP_DRY_SHARE = 0.1;

/* The crop's best run of months is the dry part of the year when it gets under this share of what
   an even spread of the year's rain would give it. */
const DRY_RUN_SHARE = 0.5;

const CROP_MAP = '2025 state crop map';

/* ---------- the crop list ---------- */

/** The crops of data/crop-needs.json by group, in the order the file lists them:
    [{ group, names: [...] }, ...]. Both crop selects are built from this. */
export function cropGroups(crops) {
  const groups = new Map();
  for (const crop of crops) {
    if (!groups.has(crop.group)) groups.set(crop.group, []);
    groups.get(crop.group).push(crop.name);
  }
  return [...groups].map(([group, names]) => ({ group, names }));
}

/* ---------- climate ---------- */

function hasWeather(climate) {
  return Boolean(climate?.T2M && climate?.PRECTOTCORR);
}

function monthlyValues(table) {
  return MONTH_KEYS.map(month => table[month]);
}

/** Rain in a year, in mm. */
export function annualRainMm(climate) {
  return climate.PRECTOTCORR.ANN * DAYS_PER_YEAR;
}

/** The facts behind the conditions cards, or null when the climate has no temperature or rain.
    Months are indexes where 0 is January. Returns
    { annualRainMm, annualRainIn, monthlyRainMm[12], monthlyRainIn[12],
      frostFreeMonths, frostDaysPerYear   (both null when the climate has no frost days),
      monthlyMeanC[12], monthlyMeanF[12], hottestMonth: { month, meanC, meanF } }
    Numbers are not rounded, except frostDaysPerYear (whole days). */
export function climateSummary(climate) {
  if (!hasWeather(climate)) return null;
  const monthlyRainMm = monthlyValues(climate.PRECTOTCORR).map(perDay => perDay * DAYS_PER_MONTH);
  const monthlyMeanC = monthlyValues(climate.T2M);
  const hottest = monthlyMeanC.indexOf(Math.max(...monthlyMeanC));
  const frost = climate.FROST_DAYS;
  return {
    annualRainMm: annualRainMm(climate),
    annualRainIn: mmToInches(annualRainMm(climate)),
    monthlyRainMm,
    monthlyRainIn: monthlyRainMm.map(mmToInches),
    frostFreeMonths: frost ? monthlyValues(frost).filter(days => days < 1).length : null,
    frostDaysPerYear: frost ? Math.round(frost.ANN) : null,
    monthlyMeanC,
    monthlyMeanF: monthlyMeanC.map(cToF),
    hottestMonth: { month: hottest, meanC: monthlyMeanC[hottest], meanF: cToF(monthlyMeanC[hottest]) },
  };
}

/* ---------- the two weather checks ---------- */

/** How well one month's mean temperature suits the crop: 0 outside its limits, 1 inside its best range. */
function monthScore(crop, temperature) {
  if (temperature < crop.tmin || temperature > crop.tmax) return 0;
  if (temperature < crop.topmn) return (temperature - crop.tmin) / (crop.topmn - crop.tmin);
  if (temperature > crop.topmx) return (crop.tmax - temperature) / (crop.tmax - crop.topmx);
  return 1;
}

/** The best run of months long enough for the crop's shortest season.
    Returns { score, start, need, warm }: score 0 to 1 (the worst month of the best run), start as a
    month index (0 is January), need in months, warm = months at or above the crop's coldest limit. */
export function tempCheck(crop, climate) {
  const temperatures = monthlyValues(climate.T2M);
  const need = Math.max(1, Math.ceil((crop.gmin || DEFAULT_SEASON_DAYS) / 30));
  let best = { score: 0, start: 0 };
  for (let start = 0; start < 12; start += 1) {
    let score = 1;
    for (let offset = 0; offset < need; offset += 1) {
      score = Math.min(score, monthScore(crop, temperatures[(start + offset) % 12]));
    }
    if (score > best.score) best = { score, start };
  }
  const warm = temperatures.filter(temperature => temperature >= crop.tmin).length;
  return { ...best, need, warm };
}

/** Yearly rain against the crop's limits.
    Returns { score, mm, wet }: score 0 when it is too dry or too wet, 1 at or above the crop's best
    range; wet is true only when the rain is above the crop's upper limit. */
export function rainCheck(crop, climate) {
  const mm = annualRainMm(climate);
  if (mm < crop.rmin) return { score: 0, mm, wet: false };
  if (mm > crop.rmax) return { score: 0, mm, wet: true };
  const score = mm >= crop.ropmn ? 1 : (mm - crop.rmin) / (crop.ropmn - crop.rmin);
  return { score, mm, wet: false };
}

/** The crop's best run of months (from tempCheck) when that run is the dry part of the year, else
    null. Returns { start, months, mm }: mm is the rain that falls in the run. */
function dryBestRun(climate, temp, rain) {
  if (!(temp.score > 0)) return null;
  const perDay = monthlyValues(climate.PRECTOTCORR);
  let mm = 0;
  for (let offset = 0; offset < temp.need; offset += 1) {
    mm += perDay[(temp.start + offset) % 12] * DAYS_PER_MONTH;
  }
  const evenShare = rain.mm * temp.need / 12;
  return mm < DRY_RUN_SHARE * evenShare ? { start: temp.start, months: temp.need, mm } : null;
}

/* ---------- local proof ---------- */

function countyTotals(counties) {
  return counties.reduce((sum, county) => ({ dry: sum.dry + (county.dry ?? 0), irr: sum.irr + (county.irr ?? 0) }),
    { dry: 0, irr: 0 });
}

function proofLevel(fields) {
  if (fields >= PROVEN_FIELDS) return 'proven';
  return fields >= FEW_FIELDS ? 'few' : 'none';
}

/** Fields that grew the crop in the state crop map: the given county, or every county in the data
    when there is no county (or the county is not in the data).
    Returns { dry, irr, total, counties: [names], dryProof, anyProof }. The two proofs are
    'proven', 'few' or 'none': dryProof is what the dryland fields show for dryland ground, anyProof
    what all the fields show for irrigated ground. */
export function localCounts(crop, county) {
  const local = crop.local ?? {};
  const counties = county && local[county] ? [county] : Object.keys(local);
  const { dry, irr } = countyTotals(counties.map(name => local[name]));
  const total = dry + irr;
  const dryCounts = dry >= PROVEN_DRY_SHARE * total;
  return {
    dry,
    irr,
    total,
    counties,
    dryProof: dryCounts ? proofLevel(dry) : 'none',
    anyProof: proofLevel(total),
  };
}

/* What stands in for the counts when the pin is outside every county the crop map data covers. */
const NO_LOCAL_RECORD = Object.freeze({
  dry: 0, irr: 0, total: 0, counties: Object.freeze([]), dryProof: 'none', anyProof: 'none', known: false,
});

/** The counts that show the crop is an irrigated crop around here, or null when it is not one.
    The field's own counts decide when they hold enough fields of the crop to tell, or dryland
    fields of their own. Otherwise every county in the data is counted together.
    Returns { counts, wider }: wider is true when the counts are not the field's own. */
function irrigatedCropProof(crop, local) {
  if (local.known === false) return null;
  const ownCountsTell = local.total >= IRRIGATED_CROP_FIELDS || local.dryProof !== 'none';
  const counts = ownCountsTell ? local : localCounts(crop, null);
  const mostlyIrrigated = counts.irr >= IRRIGATED_CROP_FIELDS
    && counts.dry < IRRIGATED_CROP_DRY_SHARE * counts.total;
  return mostlyIrrigated ? { counts, wider: !ownCountsTell } : null;
}

/** "Adams County", "Adams, Lincoln and Whitman counties", or "nearby" when the data names no county. */
function placeName(counties, joiner) {
  if (counties.length === 0) return 'nearby';
  if (counties.length === 1) return `in ${counties[0]} County`;
  return `in ${wordList(counties, joiner)} counties`;
}

/* ---------- reasons ---------- */

function fitKind(score) {
  if (score >= GOOD_FIT) return 'ok';
  return score > 0 ? 'mid' : 'no';
}

function reason(kind, topic, mark, text) {
  return { kind, topic, mark, text };
}

function temperatureReason(crop, temp) {
  const months = `${temp.need} ${plural(temp.need, 'month', 'months')}`;
  const range = `${Math.round(cToF(crop.tmin))}–${Math.round(cToF(crop.tmax))}°F`;
  if (temp.score > 0) {
    return reason(fitKind(temp.score), 'temperature', '✓',
      `Warm enough: needs ${months} between ${range}. Best run here: ${monthRange(temp.start, temp.need)}.`);
  }
  return reason('no', 'temperature', '✗',
    `Too cold or too hot: it needs ${months} between ${range}. `
    + `This field has ${temp.warm} warm-enough ${plural(temp.warm, 'month', 'months')}.`);
}

function rainReason(crop, rain, irrigated) {
  const have = inches(rain.mm);
  const least = inches(crop.rmin, 0);
  if (irrigated) {
    return reason('ok', 'rain', '✓', `Water: irrigated, so rain isn't the limit. (Rain here: ${have} a year.)`);
  }
  if (rain.score > 0) {
    return reason(fitKind(rain.score), 'rain', '✓',
      `Rain: ${have} a year. It needs at least ${least}, and does best above ${inches(crop.ropmn, 0)}.`);
  }
  if (rain.wet) return reason('no', 'rain', '✗', `Too wet: ${have} a year.`);
  return reason('no', 'rain', '✗', `Rain: ${have} a year. It usually needs at least ${least}.`);
}

function irrigatedCropNote({ counts, wider }) {
  const share = `${count(counts.irr)} of ${count(counts.total)}`;
  const text = wider
    ? `It's an irrigated crop ${placeName(counts.counties, 'and')}: ${share} fields growing it are irrigated.`
    : `Around here it's an irrigated crop: ${share} local fields growing it are irrigated.`;
  return reason('no', 'note', '!', text);
}

function dryRunNote(run, rain) {
  return reason('mid', 'note', '!',
    `Dry when it grows: ${monthRange(run.start, run.months)} gets ${inches(run.mm)} of the year's ${inches(rain.mm)} of rain.`);
}

function storedRainNote() {
  return reason('mid', 'note', '!', 'Drier than its usual range. Local farms get by on rain stored during fallow.');
}

function noLocalRecordReason(crop) {
  const counties = Object.keys(crop.local ?? {});
  const covered = counties.length ? `It covers ${wordList(counties)} counties in Washington.` : '';
  return reason('mid', 'local', '?',
    `No local proof to show: this pin is outside our state crop map. ${covered}`.trim());
}

function localReason(crop, local, irrigated) {
  if (local.known === false) return noLocalRecordReason(crop);
  if (local.total === 0) {
    return reason('no', 'local', '–', `No fields ${placeName(local.counties, 'or')} grew it in the ${CROP_MAP}.`);
  }
  const proof = irrigated ? local.anyProof : local.dryProof;
  const fields = `${count(local.dry)} ${plural(local.dry, 'field', 'fields')}`;
  const grow = plural(local.dry, 'grows', 'grow');
  return reason(proof === 'proven' ? 'ok' : 'mid', 'local', '★',
    `Local proof: ${fields} ${placeName(local.counties, 'and')} ${grow} it without irrigation, `
    + `${count(local.irr)} with irrigation (${CROP_MAP}).`);
}

function missingWeatherReason(crop, climate) {
  if (crop.tmin == null) {
    return reason('mid', 'note', '?', "No FAO EcoCrop record for this crop, so we can't check the weather fit.");
  }
  if (!hasWeather(climate)) {
    return reason('mid', 'note', '?', "We have no weather record for this field, so we can't check the weather fit.");
  }
  return null;
}

/* ---------- verdict ---------- */

/** The amber verdict for a crop a few local fields grow: "Grown on only 6 fields nearby".
    Irrigated ground counts every field growing the crop. */
function fewFieldsVerdict(local, irrigated, weatherChecked) {
  const fields = count(irrigated ? local.total : local.dry);
  const unknown = weatherChecked ? '' : ', weather fit unknown';
  return { cls: 'amber', headline: `Grown on only ${fields} fields nearby${unknown}` };
}

/** The amber verdict when too few local fields grow the crop to count: the weather check decides
    alone, if there was one. A best run in the dry part of the year is risky however much rain the
    year brings. */
function unprovenVerdict({ temp, rain, irrigated, dryRun }) {
  if (!temp) return { cls: 'amber', headline: 'Not proven nearby, weather fit unknown' };
  const risky = { cls: 'amber', headline: 'Possible, but risky here' };
  if (dryRun) return { ...risky, note: dryRunNote(dryRun, rain) };
  const rainIsGood = !rain || irrigated || rain.score >= GOOD_FIT;
  return temp.score >= GOOD_FIT && rainIsGood
    ? { cls: 'amber', headline: 'Should grow here, not proven nearby' }
    : risky;
}

/** Dryland ground, and the field's yearly rain is in the bottom half of the crop's range from its
    least rain to the rain it does best with (rainCheck score under GOOD_FIT: both sides are mm a
    year), and no dryland fields grow the crop, here or anywhere in the data. Irrigated ground is
    never blocked by rain; a crop dryland farms grow in the data is left to the other rules. */
function rainClearlyShort({ rain, irrigated, local, dryAnywhere }) {
  if (irrigated || !rain || rain.wet) return false;
  return rain.score < GOOD_FIT && local.dryProof === 'none' && !dryAnywhere;
}

function rainShortNote(rain) {
  return reason('no', 'note', '!', `Too dry here without irrigation: ${inches(rain.mm)} of rain a year is well below what it needs, `
    + 'and no dryland fields in the state crop map grow it.');
}

/** The verdict. `temp` and `rain` are null when that check could not be made; `irrigatedCrop` and
    `dryRun` are null when they do not apply. Returns { cls, headline } and sometimes a `note`
    reason to add. The rules, first match wins:
    1. Too cold or too hot is red.
    2. Dryland ground and an irrigated crop around here is red.
    3. Dryland ground, too little rain and no dryland fields to say otherwise is red.
    3b. Dryland ground, rain clearly short of what the crop needs (rainClearlyShort) is red.
    4. Proven on local fields is green, with or without a weather check: 20 fields growing the
       crop say more than a table of crop limits. (They already outrank a failed rain check.)
    5. A few local fields is amber.
    6. Otherwise the weather check decides alone, and it is amber. */
function verdict({ temp, rain, local, irrigated, irrigatedCrop, dryRun, dryAnywhere }) {
  const tempFits = !temp || temp.score > 0;
  const rainFits = irrigated || !rain || rain.score > 0;
  const proof = irrigated ? local.anyProof : local.dryProof;

  if (!tempFits) return { cls: 'red', headline: 'Too cold or short a season here' };
  if (irrigatedCrop) {
    return { cls: 'red', headline: 'Only with irrigation', water: true, note: irrigatedCropNote(irrigatedCrop) };
  }
  if (!rainFits && local.dryProof === 'none') {
    return { cls: 'red', headline: local.irr >= FEW_FIELDS ? 'Only with irrigation' : 'Too dry without irrigation', water: true };
  }
  if (rainClearlyShort({ rain, irrigated, local, dryAnywhere })) {
    return { cls: 'red', headline: 'Needs irrigation here', water: true, note: rainShortNote(rain) };
  }
  if (proof === 'proven') return { cls: 'green', headline: 'Grows here' };
  if (proof === 'few') return fewFieldsVerdict(local, irrigated, Boolean(temp));
  return unprovenVerdict({ temp, rain, irrigated, dryRun });
}

/** Can `crop` grow on this field?
    opts: { irrigated = false, county = null, covered = true }. `county` is the picked field's county
    name as it is spelled in crop.local ("Adams"); leave it out for a bare pin to count every county
    in the data. `covered: false` says the pin is outside every county the crop map data covers:
    fields that far away prove nothing, so no local proof is counted and the reason says so.

    Returns {
      cls: 'green' | 'amber' | 'red',
      headline: short verdict,
      reasons: [{ kind: 'ok' | 'mid' | 'no', topic: 'temperature' | 'rain' | 'local' | 'note', mark, text }],
      window: { startMonth, months } | null   best growing run; startMonth 0 is January
      water: true when it is red only for want of water on dryland ground (irrigation would answer it)
    }
    `mark` is the mock's one-character sign for the reason (✓ ✗ ★ – ! ?); it is decoration, the
    text carries the meaning. */
export function checkCrop(crop, climate, { irrigated = false, county = null, covered = true } = {}) {
  const weather = hasWeather(climate);
  const temp = weather && crop.tmin != null ? tempCheck(crop, climate) : null;
  const rain = weather && crop.rmin != null ? rainCheck(crop, climate) : null;
  const local = covered ? localCounts(crop, county) : NO_LOCAL_RECORD;
  const irrigatedCrop = irrigated ? null : irrigatedCropProof(crop, local);
  const dryRun = !irrigated && temp && rain ? dryBestRun(climate, temp, rain) : null;

  const reasons = [];
  const missing = missingWeatherReason(crop, climate);
  if (missing) reasons.push(missing);
  if (temp) reasons.push(temperatureReason(crop, temp));
  if (rain) reasons.push(rainReason(crop, rain, irrigated));
  reasons.push(localReason(crop, local, irrigated));

  const dryAnywhere = localCounts(crop, null).dryProof !== 'none';
  const result = verdict({ temp, rain, local, irrigated, irrigatedCrop, dryRun, dryAnywhere });
  if (result.note) reasons.push(result.note);
  const tooDryOnPaper = !irrigated && rain && rain.score === 0 && !rain.wet;
  if (result.cls === 'green' && tooDryOnPaper) reasons.push(storedRainNote());

  return {
    cls: result.cls,
    headline: result.headline,
    water: Boolean(result.water),
    reasons,
    window: temp && temp.score > 0 ? { startMonth: temp.start, months: temp.need } : null,
  };
}
