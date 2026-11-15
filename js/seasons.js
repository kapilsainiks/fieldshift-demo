/* "What your field went through": the last few seasons at a field, before any advice.
   Pure functions: no DOM, no fetch. Weather comes from the engine file the Plan already loads
   (app.weather, NASA POWER); the crop seen each season from the satellite record
   (finder-util.js satelliteRecordFor, NASA HLS). Nothing here is estimated. */

import { fahrenheitChange, inches, wordList } from './format.js';

/** Inside these the season reads "about usual". */
export const USUAL = Object.freeze({ rainPct: 10, heatC: 1 });

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The last `n` seasons with weather, oldest first:
    [{ year, rainMm, rainVsNormalPct, heatC, heatVsNormalC, dry, growing }]. `growing` is true
    (a crop), false (rest) or null (no satellite record for that year). Normal is the mean over
    every year in app.weather. Empty when the file has no usable weather. */
export function lastSeasons(app, record, n = 3) {
  const rows = (app?.weather ?? []).filter((row) =>
    Number.isFinite(row.rain_spring_mm) && Number.isFinite(row.heat_junjul_c));
  if (!rows.length) return [];
  const normalRain = mean(rows.map((row) => row.rain_spring_mm));
  const normalHeat = mean(rows.map((row) => row.heat_junjul_c));
  const dryYears = new Set(app.hot_dry_years ?? []);
  const seen = new Map((record?.years ?? []).map((entry) => [entry.year, entry.growing]));
  return [...rows]
    .sort((a, b) => a.year - b.year)
    .slice(-n)
    .map((row) => ({
      year: row.year,
      rainMm: row.rain_spring_mm,
      rainVsNormalPct: ((row.rain_spring_mm - normalRain) / normalRain) * 100,
      heatC: row.heat_junjul_c,
      heatVsNormalC: row.heat_junjul_c - normalHeat,
      dry: dryYears.has(row.year),
      growing: seen.has(row.year) ? seen.get(row.year) : null,
    }));
}

/** "3.7 in, 13% below normal" / "about usual". */
export function rainWords(row) {
  const pct = Math.round(row.rainVsNormalPct);
  if (Math.abs(row.rainVsNormalPct) < USUAL.rainPct) return `${inches(row.rainMm)}, about usual`;
  return `${inches(row.rainMm)}, ${Math.abs(pct)}% ${pct < 0 ? 'below' : 'above'} normal`;
}

/** "about usual" / "1.8°F hotter than normal". */
export function heatWords(row) {
  if (Math.abs(row.heatVsNormalC) < USUAL.heatC) return 'about usual';
  const change = fahrenheitChange(Math.abs(row.heatVsNormalC));
  return `${change} ${row.heatVsNormalC > 0 ? 'hotter' : 'cooler'} than normal`;
}

/** "Crop" / "Rest" / null. */
export function fieldWords(row) {
  if (row.growing === null) return null;
  return row.growing ? 'Crop' : 'Rest';
}

/** One plain sentence about the seasons, or '' when there are none. */
export function seasonsSummary(rows) {
  if (!rows.length) return '';
  const drier = rows.filter((row) => row.rainVsNormalPct <= -USUAL.rainPct);
  const wetter = rows.filter((row) => row.rainVsNormalPct >= USUAL.rainPct);
  const hotter = rows.filter((row) => row.heatVsNormalC >= USUAL.heatC);
  const driest = [...rows].sort((a, b) => a.rainVsNormalPct - b.rainVsNormalPct)[0];
  const of = (some) => `${some.length} of the last ${rows.length} springs ${some.length === 1 ? 'was' : 'were'}`;
  const parts = [];
  if (drier.length === rows.length) {
    parts.push(`All ${rows.length} of the last springs were drier than normal; ${driest.year} was the driest.`);
  } else if (drier.length) {
    parts.push(`${of(drier)} drier than normal (${wordList(drier.map((row) => row.year))}).`);
  } else if (wetter.length) {
    parts.push(`${of(wetter)} wetter than normal.`);
  } else {
    parts.push(`The last ${rows.length} springs brought about usual rain.`);
  }
  if (hotter.length) parts.push(`Summer ran hot in ${wordList(hotter.map((row) => row.year))}.`);
  const dry = rows.filter((row) => row.dry);
  if (dry.length) parts.push(`${wordList(dry.map((row) => row.year))} ${dry.length === 1 ? 'was one of' : 'were among'} the hot, dry years that cost the most here.`);
  const seen = rows.filter((row) => row.growing !== null);
  if (seen.length === rows.length) {
    parts.push(`Satellites saw ${wordList(rows.map((row) => `${row.growing ? 'a crop' : 'rest'} in ${row.year}`))}.`);
  }
  return parts.join(' ');
}
