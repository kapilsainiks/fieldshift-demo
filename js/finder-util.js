/* Pure helpers for the Fields screen (js/finder.js): town search, land codes, the field outlines
   of a county and the words shown for a field. No DOM and no fetch, so everything here runs in
   node:test. */

import { count, isNumber, pinText, plural } from './format.js';
import { boundsCentre, boundsHold, boundsTouch, geometryBounds, pointInGeometry, pointInRing } from './geometry.js';

/* ---------- Towns ---------- */

export const MIN_QUERY_LETTERS = 2;
export const MAX_TOWN_MATCHES = 8;
const HOME_STATE = 'WA';

/* Lower case, accents off, punctuation to spaces: "Cañon City" and "canon city" compare equal. */
export function foldText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* Turn the rows of data/us-places.json ([name, state, lat, lon, land_sq_mi]) into records that
   are quick to search. Do this once, when the file arrives. */
export function indexPlaces(rows) {
  return rows.map(([name, state, lat, lon, landSqMi]) => ({
    name,
    state,
    lat,
    lon,
    landSqMi,
    key: foldText(name),
  }));
}

/* "Ritzville, WA" */
export function placeLabel(place) {
  return `${place.name}, ${place.state}`;
}

/* Split what the farmer typed into a town part and an optional state part: "pullman, wa". */
function parseTownQuery(query) {
  const text = String(query ?? '');
  const comma = text.lastIndexOf(',');
  if (comma === -1) return { name: foldText(text), state: '' };
  return {
    name: foldText(text.slice(0, comma)),
    state: foldText(text.slice(comma + 1)).toUpperCase(),
  };
}

/* 0 when the town name starts with the typed letters, 1 when a later word does, -1 for no match. */
function matchTier(key, typed) {
  if (key.startsWith(typed)) return 0;
  if (key.includes(' ' + typed)) return 1;
  return -1;
}

function compareMatches(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const aHome = a.place.state === HOME_STATE;
  const bHome = b.place.state === HOME_STATE;
  if (aHome !== bHome) return aHome ? -1 : 1;
  if (a.exact !== b.exact) return a.exact ? -1 : 1;
  if (a.place.key !== b.place.key) return a.place.key < b.place.key ? -1 : 1;
  if (a.place.state !== b.place.state) return a.place.state < b.place.state ? -1 : 1;
  return b.place.landSqMi - a.place.landSqMi;
}

/* Towns that match what was typed: names that start with it first, then Washington first, then
   by name. Fewer than 2 letters gives nothing. Two places with the same name in one state would
   read the same in the list, so only the larger one is kept. */
export function searchPlaces(index, query, limit = MAX_TOWN_MATCHES) {
  const typed = parseTownQuery(query);
  if (typed.name.replace(/ /g, '').length < MIN_QUERY_LETTERS) return [];

  const matches = [];
  for (const place of index) {
    if (typed.state && !place.state.startsWith(typed.state)) continue;
    const tier = matchTier(place.key, typed.name);
    if (tier !== -1) matches.push({ place, tier, exact: place.key === typed.name });
  }
  matches.sort(compareMatches);

  const seen = new Set();
  const found = [];
  for (const { place } of matches) {
    const label = placeLabel(place);
    if (seen.has(label)) continue;
    seen.add(label);
    found.push(place);
    if (found.length === limit) break;
  }
  return found;
}

/* The zoom that shows a whole town plus the farmland around it. */
export function townZoom(landSqMi) {
  const area = Number.isFinite(landSqMi) ? Math.max(landSqMi, 1) : 1;
  const zoom = 11.5 - 0.5 * Math.log2(area);
  return Math.min(11.5, Math.max(8.5, zoom));
}

/* ---------- Land codes (Section, Township, Range) in Washington ---------- */

const BLM_SERVICE = 'https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer';
const BLM_SECTIONS_LAYER = 2;
const WHOLE_NUMBER = /^\d{1,3}$/;

/* Tiles of the survey grid (township and section lines) to lay over the photo. */
export const SURVEY_GRID_TILES = `${BLM_SERVICE}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857`
  + '&size=256,256&format=png32&transparent=true&layers=show:1,2&f=image';

function wholeNumber(text) {
  const trimmed = String(text ?? '').trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : NaN;
}

/* The three boxes of a land code: what each must hold, and what to say when it does not. */
const LAND_CODE_PARTS = [
  {
    part: 'section',
    allows: (value) => value >= 1 && value <= 36,
    message: 'Section must be a whole number from 1 to 36.',
  },
  {
    part: 'township',
    allows: (value) => value >= 1,
    message: 'Township must be a whole number, 1 or more, like 19.',
  },
  {
    part: 'range',
    allows: (value) => value >= 1,
    message: 'Range must be a whole number, 1 or more, like 34.',
  },
];

/* What is wrong with what was typed, box by box and in the order of the boxes:
   [{ part: 'township', message }]. Empty when all three are fine. */
export function landCodeProblems(typed) {
  return LAND_CODE_PARTS
    .filter(({ part, allows }) => !allows(wholeNumber(typed?.[part])))
    .map(({ part, message }) => ({ part, message }));
}

/* What was typed, as numbers: { section, township, range }. null when it is not a land code:
   the section must be 1 to 36, township and range whole numbers from 1 up. */
export function parseLandCode(typed) {
  if (landCodeProblems(typed).length) return null;
  return {
    section: wholeNumber(typed.section),
    township: wholeNumber(typed.township),
    range: wholeNumber(typed.range),
  };
}

/* "Section 1, T19N, R34E" */
export function landCodeText({ section, township, range }) {
  return `Section ${section}, T${township}N, R${range}E`;
}

/* The survey's own name for a township: Washington ("WA"), Willamette Meridian ("33"),
   township north, range east. */
export function plssId({ township, range }) {
  const pad = (value) => String(value).padStart(3, '0');
  return `WA33${pad(township)}0N${pad(range)}0E0`;
}

/* The address that answers with the outline of one section, as GeoJSON. */
export function sectionQueryUrl(code) {
  const where = `PLSSID='${plssId(code)}' AND FRSTDIVNO='${String(code.section).padStart(2, '0')}'`;
  const query = new URLSearchParams({
    where,
    outFields: 'PLSSID',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  return `${BLM_SERVICE}/${BLM_SECTIONS_LAYER}/query?${query}`;
}

/* ---------- Field outlines ---------- */

/* One record per field of a county file, with its box worked out once. */
export function indexFields(collection) {
  const fields = [];
  for (const feature of collection?.features ?? []) {
    const bounds = geometryBounds(feature.geometry);
    if (bounds) fields.push({ id: feature.id, feature, bounds, centre: boundsCentre(bounds) });
  }
  return fields;
}

/* The field under a point, or null. */
export function fieldAt(fields, point) {
  for (const field of fields) {
    if (boundsHold(field.bounds, point) && pointInGeometry(point, field.feature.geometry)) return field.feature;
  }
  return null;
}

/* Squared distance between two points close to each other, in degrees of latitude. */
function distanceSquared([lonA, latA], [lonB, latB]) {
  const dLon = (lonA - lonB) * Math.cos((latA * Math.PI) / 180);
  const dLat = latA - latB;
  return dLon * dLon + dLat * dLat;
}

/* The fields in the view, nearest the centre first. A field the centre is on comes first. */
export function fieldsNear(fields, centre, viewBounds, limit = 12) {
  const near = [];
  for (const field of fields) {
    if (!boundsTouch(field.bounds, viewBounds)) continue;
    const onIt = boundsHold(field.bounds, centre) && pointInGeometry(centre, field.feature.geometry);
    near.push({ feature: field.feature, distance: onIt ? 0 : distanceSquared(centre, field.centre) });
  }
  near.sort((a, b) => a.distance - b.distance || a.feature.id - b.feature.id);
  return near.slice(0, limit).map((entry) => entry.feature);
}

/* The entries of fields-index.json whose box touches the view. */
export function countiesTouching(counties, viewBounds) {
  return counties.filter((county) => boundsTouch(county.bbox, viewBounds));
}

/* ---------- Words for a field ---------- */

const NOT_IRRIGATED = new Set(['none', 'unknown', '']);

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/* The answer to "Dryland or irrigated?" that the state crop map gives for a field. */
export function waterAnswer(irr) {
  return NOT_IRRIGATED.has(cleanText(irr).toLowerCase()) ? 'Dryland' : 'Irrigated';
}

/* "no irrigation", "center pivot irrigation", "irrigation not recorded" */
export function irrigationText(irr) {
  const kind = cleanText(irr).toLowerCase();
  if (kind === 'none') return 'no irrigation';
  if (kind === 'unknown' || kind === '') return 'irrigation not recorded';
  return `${kind} irrigation`;
}

function acresShort(acres) {
  return isNumber(acres) ? `${count(acres)} ac` : 'size not recorded';
}

function acresLong(acres) {
  return isNumber(acres) ? `${count(acres)} ${plural(acres, 'acre', 'acres')}` : 'size not recorded';
}

/* The words on a "Fields in view" button: "Wheat Fallow · 620 ac · no irrigation". */
export function fieldLabel(props) {
  const crop = cleanText(props?.crop) || 'Crop not recorded';
  return `${crop} · ${acresShort(props?.ac)} · ${irrigationText(props?.irr)}`;
}

/* "620 acres. State crop map (2024): Wheat Fallow, no irrigation." */
export function fieldSummary(props) {
  const crop = cleanText(props?.crop) || 'crop not recorded';
  const survey = cleanText(props?.surv);
  const map = survey ? `State crop map (${survey})` : 'State crop map';
  return `${acresLong(props?.ac)}. ${map}: ${crop}, ${irrigationText(props?.irr)}.`;
}

/* The line next to "See my plan" once a field is picked: "Ritzville sample farm · 620 acres picked".
   `sampleLabel` is the sample farm's name when the field is one. */
export function pickedLine(field, sampleLabel = null) {
  if (!field.props) return `${sampleLabel ?? 'Your pin'} · ${pinText(field.pin)}`;
  const name = sampleLabel ?? 'Your field';
  return isNumber(field.props.ac) ? `${name} · ${acresLong(field.props.ac)} picked` : `${name} picked`;
}

/* The crop the field rotates with, or '' when the state crop map does not say. */
export function rotatesWith(props) {
  const partner = cleanText(props?.rot);
  return /unknown/i.test(partner) ? '' : partner;
}

/* ---------- "What do you grow now?" ---------- */

const WHEAT = /wheat/i;
const FALLOW = /fallow/i;

/* A first answer to "What do you grow now?" from the state crop map's crop and rotation crop:
   'wf' wheat then rest, 'ww' wheat every year, 'other', or null when the map does not say enough. */
export function guessRotation(props) {
  const crop = cleanText(props?.crop);
  const partner = rotatesWith(props);
  if (!crop) return null;
  const both = `${crop} ${partner}`;
  if (WHEAT.test(both) && FALLOW.test(both)) return 'wf';
  if (WHEAT.test(crop) && WHEAT.test(partner)) return 'ww';
  if (WHEAT.test(crop) || FALLOW.test(crop)) return null;
  return 'other';
}

const WHEAT_CODES = new Set(['WW', 'SW']);
const FALLOW_CODE = 'F';

/* The same answer from a rotation in an engine file, given as crop codes: ['WW', 'F'] is 'wf'. */
export function rotationFromCrops(crops) {
  if (!Array.isArray(crops) || !crops.length) return null;
  const grown = crops.filter((code) => code !== FALLOW_CODE);
  const rests = grown.length < crops.length;
  const onlyWheat = grown.length > 0 && grown.every((code) => WHEAT_CODES.has(code));
  if (onlyWheat && rests && grown.length === 1) return 'wf';
  if (onlyWheat && !rests) return 'ww';
  return 'other';
}

/* An engine rotation in plain words: ['WW', 'SW', 'CP'] is "winter wheat, spring wheat, then
   chickpeas" and ['WW', 'F'] is "winter wheat, then rest". `cropTable` is the engine file's
   `crops` ({ WW: { name: 'Winter wheat' } }). '' when a crop has no name there. */
export function rotationWords(crops, cropTable) {
  if (!Array.isArray(crops) || !crops.length) return '';
  const names = crops.map((code) => (code === FALLOW_CODE ? 'rest' : cleanText(cropTable?.[code]?.name).toLowerCase()));
  if (names.some((name) => !name)) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')}, then ${names[names.length - 1]}`;
}

/* ---------- Sample farms ---------- */

const RAIN_FIGURE = /:?\s*about [\d.,]+ inches of rain a year/i;

/* The words under a sample farm's name, from its `blurb` in data/engine/fields.json. A rain figure
   in the blurb has no source next to it and can differ from the NASA number the Plan shows for the
   same pin, so it is left out here: "Dry country: about 12 inches of rain a year. Wheat one year,
   rest the next." reads "Dry country. Wheat one year, rest the next." */
export function sampleBlurb(blurb) {
  return cleanText(blurb).replace(RAIN_FIGURE, '');
}

/* ---------- The three traced fields with a satellite record ---------- */

/* Three fields next to the WSU trial site near Ritzville. Outlines traced on the USDA photo.
   years: 1 where NASA HLS (Landsat and Sentinel-2) greenness went over 0.35 that season. */
export const TRACED_FIELDS = Object.freeze({
  A: {
    acres: 147,
    ring: [[-118.483424, 47.169209], [-118.473308, 47.169053], [-118.473308, 47.161942], [-118.483424, 47.162272], [-118.483424, 47.169209]],
    years: { 2013: 1, 2014: 0, 2015: 1, 2016: 0, 2017: 1, 2018: 0, 2019: 1, 2020: 0, 2021: 1, 2022: 0, 2023: 1, 2024: 0, 2025: 1, 2026: 0 },
  },
  B: {
    acres: 151,
    ring: [[-118.462541, 47.161786], [-118.452129, 47.161855], [-118.452129, 47.154814], [-118.462541, 47.154778], [-118.462541, 47.161786]],
    years: { 2013: 0, 2014: 1, 2015: 0, 2016: 1, 2017: 0, 2018: 1, 2019: 0, 2020: 1, 2021: 0, 2022: 1, 2023: 0, 2024: 1, 2025: 0, 2026: 1 },
  },
  C: {
    acres: 267,
    ring: [
      [-118.473073, 47.169176], [-118.452068, 47.169314], [-118.452068, 47.165914], [-118.458375, 47.165793],
      [-118.463134, 47.163365], [-118.463968, 47.162827], [-118.462986, 47.162722], [-118.456591, 47.163799],
      [-118.452068, 47.164751], [-118.452068, 47.162168], [-118.470156, 47.16196], [-118.470156, 47.163139],
      [-118.473073, 47.163139], [-118.473073, 47.169176],
    ],
    years: { 2013: 1, 2014: 0, 2015: 1, 2016: 0, 2017: 1, 2018: 0, 2019: 1, 2020: 0, 2021: 1, 2022: 0, 2023: 1, 2024: 0, 2025: 1, 2026: 0 },
  },
});

const TRACED = Object.values(TRACED_FIELDS).map((traced) => ({
  ...traced,
  centre: boundsCentre(geometryBounds({ type: 'Polygon', coordinates: [traced.ring] })),
}));

/* The traced field a picked field takes its satellite record from. A field with an outline takes
   the traced field whose middle it holds, wherever on it the pin sits, so the same field always
   shows the same record. A bare pin takes the traced field it stands on. */
function tracedFieldOf(field) {
  if (field.geometry) return TRACED.find((traced) => pointInGeometry(traced.centre, field.geometry));
  return TRACED.find((traced) => pointInRing(field.pin, traced.ring));
}

/* The satellite record for a picked field (state.field): { acres, years: [{ year, growing }] },
   oldest year first. `acres` is the size of the traced field the record was made on. null when the
   field is none of the three. */
export function satelliteRecordFor(field) {
  const traced = tracedFieldOf(field);
  if (!traced) return null;
  const years = Object.entries(traced.years)
    .map(([year, growing]) => ({ year: Number(year), growing: growing === 1 }))
    .sort((a, b) => a.year - b.year);
  return { acres: traced.acres, years };
}

/* A traced field this close to the outline's size is taken to be the whole field. */
const WHOLE_FIELD_SHARE = 0.9;

/* The line over the satellite strip. It says how much of the picked field the record covers:
   the traced fields were drawn by hand and can be smaller than the state crop map's outline. */
export function satelliteLead(record, field) {
  if (!field.props) return `NASA satellites saw this on the ${count(record.acres)} acres around your pin:`;
  const acres = field.props.ac;
  if (isNumber(acres) && record.acres < acres * WHOLE_FIELD_SHARE) {
    return `NASA satellites saw this on ${count(record.acres)} of this field’s ${count(acres)} acres:`;
  }
  return 'NASA satellites saw this on your field:';
}
