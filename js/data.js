/* Loads the data files, once each. Every URL is relative, so the app works under any sub-path.

   Each loader returns a promise for the parsed file, unchanged:

     fieldsConfig()            data/engine/fields.json        { fields: [...], crop_codes: {...} }
     fieldConfigFor(county)    one entry of fields.json for that county, or null
     fieldConfigById(id)       one entry of fields.json by id ('ritzville', 'pullman'), or null
     engineFor(county)         the money engine file for that county, or null when there is none
     engineById(id)            the money engine file by id, or null
     climateFor(id)            data/engine/{id}-climate.json, or null when the file is not there
     futureRain()              data/engine/future-rain.json, or null when the file is not there
     cropNeeds()               data/crop-needs.json           [{ name, group, ..., local }, ...]
     places()                  data/us-places.json            { source, places: [[name, state, lat, lon, land_sq_mi], ...] }
     fieldsIndex()             data/fields-index.json         { source, counties: [{ county, file, fields, bbox }] }
     countyFields(county)      that county's field outlines (GeoJSON), or null for a county we have no file for
     nasaClimate([lon, lat])   { data, live }: NASA POWER long-term monthly averages for the point.
                               live is false when NASA could not be reached and `data` is the saved
                               Ritzville copy (CLIM_FALLBACK). Say which one was used.

   A file the app needs (fields.json, crop-needs.json, ...) rejects if it cannot be loaded: catch it
   and say what is missing. The optional files (climate, future rain) never reject: they give null. */

const ENGINE_DIR = 'data/engine/';

const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
const POWER_PARAMETERS = ['T2M', 'PRECTOTCORR', 'FROST_DAYS'];
const POWER_TIMEOUT_MS = 12000;
const POWER_MISSING = -900; // NASA POWER writes -999 where it has no value

/* NASA POWER long-term monthly averages at the WSU trial site near Ritzville, saved in case the
   live call fails. T2M: air temperature, deg C. PRECTOTCORR: rain, mm a day. FROST_DAYS: days. */
export const CLIM_FALLBACK = Object.freeze({
  T2M: Object.freeze({
    JAN: -0.53, FEB: 1.47, MAR: 5.75, APR: 9.7, MAY: 15.28, JUN: 19.22,
    JUL: 24.09, AUG: 23.11, SEP: 17.66, OCT: 10.24, NOV: 3.6, DEC: -0.74,
  }),
  PRECTOTCORR: Object.freeze({
    JAN: 1.4, FEB: 0.95, MAR: 1.14, APR: 0.84, MAY: 0.86, JUN: 0.73,
    JUL: 0.16, AUG: 0.24, SEP: 0.39, OCT: 0.9, NOV: 1.31, DEC: 1.55, ANN: 0.87,
  }),
  FROST_DAYS: Object.freeze({
    JAN: 26, FEB: 22.7, MAR: 13.9, APR: 4.7, MAY: 0.2, JUN: 0,
    JUL: 0, AUG: 0, SEP: 0, OCT: 2.3, NOV: 15.9, DEC: 26.6, ANN: 112.3,
  }),
});

const cache = new Map();

/* Run `load` once per key and share its promise. A failed load is forgotten, so it can be retried. */
function once(key, load) {
  if (!cache.has(key)) {
    const promise = load();
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (status ${response.status}).`);
  return response.json();
}

function requiredJson(url) {
  return once(url, () => fetchJson(url));
}

function sameName(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

/* ---------- Optional files ----------

   A browser writes every 404 to its console, even for a HEAD request, so the only quiet way to
   learn that a file is not there is not to ask for it. Simple static servers (python3 -m
   http.server) answer a folder URL with the list of its files. When we get such a list we trust it.
   On a host that gives no list we ask for the file itself and treat any failure as "not there".
   Such a host answers the folder request with a 404 of its own, so we remember for the rest of the
   session that it has no list and do not ask for the folder again. */

const NO_LISTING_KEY = 'fieldproof.engine-folder-unlisted';

/* Session storage can be missing or blocked. Then every page load asks for the folder once. */
function knownToHaveNoListing() {
  try {
    return sessionStorage.getItem(NO_LISTING_KEY) === 'yes';
  } catch {
    return false;
  }
}

function rememberNoListing() {
  try {
    sessionStorage.setItem(NO_LISTING_KEY, 'yes');
  } catch {
    // Nothing to do: the folder is asked for again on the next page load.
  }
}

/* The file names in a folder page, or null when the page is not a list of the engine files. */
async function listedNames(response) {
  const type = response.headers.get('content-type') || '';
  if (!response.ok || !type.includes('text/html')) return null;
  const names = [...(await response.text()).matchAll(/href="([^"?#]+)"/g)]
    .map((match) => decodeURIComponent(match[1]));
  // Only a real file list names fields.json. Anything else (an index page, say) is not one.
  return names.includes('fields.json') ? new Set(names) : null;
}

function engineDirListing() {
  return once('listing:' + ENGINE_DIR, async () => {
    if (knownToHaveNoListing()) return null;
    try {
      const names = await listedNames(await fetch(ENGINE_DIR));
      if (!names) rememberNoListing(); // the host answered, and what it sent is not a list
      return names;
    } catch {
      return null; // the network failed: that says nothing about the host, so nothing is remembered
    }
  });
}

function optionalEngineJson(name) {
  return once('optional:' + name, async () => {
    const listing = await engineDirListing();
    if (listing && !listing.has(name)) return null;
    try {
      return await fetchJson(ENGINE_DIR + name);
    } catch {
      return null;
    }
  });
}

/* ---------- Engine files ---------- */

export function fieldsConfig() {
  return requiredJson(ENGINE_DIR + 'fields.json');
}

export async function fieldConfigFor(county) {
  const config = await fieldsConfig();
  return config.fields.find((field) => sameName(field.county, county)) ?? null;
}

export async function fieldConfigById(id) {
  const config = await fieldsConfig();
  return config.fields.find((field) => field.id === id) ?? null;
}

export async function engineFor(county) {
  const field = await fieldConfigFor(county);
  return field ? requiredJson(field.engine) : null;
}

export async function engineById(id) {
  const field = await fieldConfigById(id);
  return field ? requiredJson(field.engine) : null;
}

export function climateFor(id) {
  return optionalEngineJson(`${id}-climate.json`);
}

export function futureRain() {
  return optionalEngineJson('future-rain.json');
}

/* ---------- Crops, towns, field outlines ---------- */

export function cropNeeds() {
  return requiredJson('data/crop-needs.json');
}

export function places() {
  return requiredJson('data/us-places.json');
}

export function fieldsIndex() {
  return requiredJson('data/fields-index.json');
}

export async function countyFields(countyName) {
  const index = await fieldsIndex();
  const entry = index.counties.find((county) => sameName(county.county, countyName));
  return entry ? requiredJson('data/' + entry.file) : null;
}

/* ---------- NASA POWER ---------- */

function powerUrl([lon, lat]) {
  return `${POWER_URL}?parameters=${POWER_PARAMETERS.join(',')}&community=AG`
    + `&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
}

function hasEveryParameter(parameter) {
  return POWER_PARAMETERS.every((name) => {
    const months = parameter?.[name];
    return months && Number.isFinite(months.JAN) && Object.values(months).every((value) => value > POWER_MISSING);
  });
}

async function fetchPower(point) {
  const response = await fetch(powerUrl(point), { signal: AbortSignal.timeout(POWER_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`NASA POWER answered with status ${response.status}.`);
  const parameter = (await response.json())?.properties?.parameter;
  if (!hasEveryParameter(parameter)) throw new Error('NASA POWER has no values for this point.');
  return parameter;
}

/* The answer for a point is kept for the session, the saved copy included, so a screen that asks
   again while NASA is unreachable does not wait a second time. */
export function nasaClimate(point) {
  const key = 'power:' + point.map((value) => value.toFixed(3)).join(',');
  return once(key, async () => {
    try {
      return { data: await fetchPower(point), live: true };
    } catch {
      return { data: CLIM_FALLBACK, live: false };
    }
  });
}
