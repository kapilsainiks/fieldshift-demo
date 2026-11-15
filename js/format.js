/* Formatting helpers for Fieldproof. Pure functions: no DOM, no fetch, no globals.

   Every number formatter returns NO_DATA ("no data") when it is given something that is not a
   finite number, so a missing value can never show up as "$NaN". Screens should still check for
   missing data first and write a plain sentence instead of a number. */

export const MINUS = '−';
export const EN_DASH = '–';
export const NO_DATA = 'no data';

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

const MM_PER_INCH = 25.4;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Round half away from zero, so 12.5 and -12.5 both become 13 in size. */
function roundAwayFromZero(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** A number with a real minus sign and a fixed count of decimals: -0.04 gives "0.0", not "-0.0". */
function fixed(value, digits) {
  const text = Math.abs(value).toFixed(digits);
  const isZero = Number(text) === 0;
  return value < 0 && !isZero ? `${MINUS}${text}` : text;
}

/* ---------- money ---------- */

/** Whole dollars: 1234.4 -> "$1,234", -12.2 -> "−$12", -0.3 -> "$0". */
export function money(value) {
  if (!isNumber(value)) return NO_DATA;
  const dollars = roundAwayFromZero(value);
  const digits = Math.abs(dollars).toLocaleString('en-US');
  return dollars < 0 ? `${MINUS}$${digits}` : `$${digits}`;
}

/** Whole dollars, and a loss says so in words: -12.2 -> "−$12, a loss". Gains read like money(). */
export function moneyWithLoss(value) {
  if (!isNumber(value)) return NO_DATA;
  const text = money(value);
  return text.startsWith(MINUS) ? `${text}, a loss` : text;
}

/** Cents per pound from dollars per hundredweight (100 lb), so the two numbers are equal: "21.2¢/lb". */
export function centsPerPound(dollarsPerCwt) {
  if (!isNumber(dollarsPerCwt)) return NO_DATA;
  return `${fixed(dollarsPerCwt, 1)}¢/lb`;
}

/** A crop price in its own unit: (5.88, 'bu') -> "$5.88/bu"; (21.2, 'cwt') -> "$21.20/cwt (21.2¢/lb)". */
export function price(value, unit) {
  if (!isNumber(value)) return NO_DATA;
  const dollars = `$${fixed(value, 2)}/${unit}`;
  return unit === 'cwt' ? `${dollars} (${centsPerPound(value)})` : dollars;
}

/* ---------- rain and temperature ---------- */

export function mmToInches(mm) {
  return mm / MM_PER_INCH;
}

/** Millimetres shown as inches: (317.55) -> "12.5 in". */
export function inches(mm, digits = 1) {
  if (!isNumber(mm)) return NO_DATA;
  return `${fixed(mmToInches(mm), digits)} in`;
}

/** Millimetres as they are: (160) -> "160 mm". */
export function millimeters(mm, digits = 0) {
  if (!isNumber(mm)) return NO_DATA;
  return `${fixed(mm, digits)} mm`;
}

/** A temperature in °C as a number in °F. */
export function cToF(celsius) {
  return celsius * 9 / 5 + 32;
}

/** A change in °C as a change in °F (no 32 offset). */
export function cChangeToF(celsiusChange) {
  return celsiusChange * 9 / 5;
}

/** A temperature given in °C, shown in °F: (24.09) -> "75°F". */
export function fahrenheit(celsius, digits = 0) {
  if (!isNumber(celsius)) return NO_DATA;
  return `${fixed(cToF(celsius), digits)}°F`;
}

/** A temperature change given in °C, shown in °F: (0.5) -> "0.9°F". */
export function fahrenheitChange(celsiusChange, digits = 1) {
  if (!isNumber(celsiusChange)) return NO_DATA;
  return `${fixed(cChangeToF(celsiusChange), digits)}°F`;
}

/** A temperature or a temperature change in °C: (0.52) -> "0.5°C". */
export function celsius(value, digits = 1) {
  if (!isNumber(value)) return NO_DATA;
  return `${fixed(value, digits)}°C`;
}

/* ---------- places ---------- */

/** A pin in words: ([-118.4732, 47.1639]) -> "47.1639° N, 118.4732° W". The point is [lon, lat]. */
export function pinText([lon, lat], digits = 4) {
  const northSouth = lat >= 0 ? 'N' : 'S';
  const eastWest = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${northSouth}, ${Math.abs(lon).toFixed(digits)}° ${eastWest}`;
}

/* ---------- percent ---------- */

/** A number that is already a percent: (66.7) -> "67%". */
export function percent(value, digits = 0) {
  if (!isNumber(value)) return NO_DATA;
  return `${fixed(value, digits)}%`;
}

/** A share between 0 and 1 as a percent: (0.667) -> "67%". */
export function percentOfShare(share, digits = 0) {
  if (!isNumber(share)) return NO_DATA;
  return percent(share * 100, digits);
}

/** A percent change with its sign: (10) -> "+10%", (-40) -> "−40%", (0) -> "0%". */
export function signedPercent(value, digits = 0) {
  if (!isNumber(value)) return NO_DATA;
  const text = percent(value, digits);
  return value > 0 && Number(fixed(value, digits)) !== 0 ? `+${text}` : text;
}

/* ---------- months and years ---------- */

/** Month name from an index where 0 is January. Indexes wrap, so 12 is January again. */
export function monthName(index, style = 'short') {
  const names = style === 'long' ? MONTHS_LONG : MONTHS_SHORT;
  return names[((index % 12) + 12) % 12];
}

/** A run of months: (4, 2) -> "May–Jun"; (10, 3) -> "Nov–Jan"; (6, 1) -> "Jul". */
export function monthRange(startMonth, months, style = 'short') {
  const first = monthName(startMonth, style);
  if (months <= 1) return first;
  return `${first}${EN_DASH}${monthName(startMonth + months - 1, style)}`;
}

/** First and last year of a record: (2005, 2025) -> "2005–2025"; the same year twice -> "2021". */
export function yearSpan(first, last) {
  return first === last ? String(first) : `${first}${EN_DASH}${last}`;
}

/** Years in a sentence: [2007, 2008, 2021] -> "2007, 2008 and 2021". */
export function yearList(years) {
  return wordList(years);
}

/* ---------- words ---------- */

/** Items in a sentence: ['Adams', 'Lincoln', 'Whitman'] -> "Adams, Lincoln and Whitman". */
export function wordList(items, joiner = 'and') {
  const words = items.map(String);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${joiner} ${words.at(-1)}`;
}

/** A whole count with thousands separators: (12639) -> "12,639". */
export function count(value) {
  if (!isNumber(value)) return NO_DATA;
  return Math.round(value).toLocaleString('en-US');
}

/** Pick the word that fits the count: (1, 'field', 'fields') -> "field". */
export function plural(howMany, one, many) {
  return howMany === 1 ? one : many;
}

/** Make text from a data file or from the user safe to put inside innerHTML or an attribute. */
export function escapeHtml(text) {
  if (text == null) return '';
  return String(text).replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}
