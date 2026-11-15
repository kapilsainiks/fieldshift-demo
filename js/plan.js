/* Plan screen (#/plan), laid out as the approved mock _design/plan-v2.html: the field fills the
   first screen, the answer stands on it in big type, and one glass panel holds the money. Then one
   question a line (the price that would change the answer, can it grow here, your rotation, where
   the numbers come from) and the field again with the smallest safe test drawn on it.

   The screen reads only the shared state (the picked field, the answers, the price view). Every
   number comes from engine.js at runtime. The maps are pictures: every control is in the page. */

import { state } from './state.js';
import {
  cropNeeds, countyFields, engineFor, fieldConfigFor, fieldsConfig, fieldsIndex, futureRain, nasaClimate,
} from './data.js';
import { addPin, createMap, reducedMotion } from './map.js';
import { announce } from './live.js';
import {
  PRICE_RANGE, TEST_ACRES, WEATHER_SHIFT, breakEvenPrice, rank, scenarioWeights, shiftEvidence, toTodayFactor,
} from './engine.js';
import { USUAL, fieldWords, heatWords, lastSeasons, rainWords, seasonsSummary } from './seasons.js';
import { checkCrop, climateSummary, cropGroups } from './growcheck.js';
import {
  count, escapeHtml, fahrenheitChange, inches, money, signedPercent, wordList, yearList, yearSpan,
} from './format.js';
import { rotationFromCrops, satelliteRecordFor } from './finder-util.js';
import { geometryBounds, pointInGeometry } from './geometry.js';
import {
  PRICE_PERCENT_TODAY, PRIORITY_WORDS, REST_CODE, SOIL_POINTS_NOTE, YIELD_PERCENT_RANGE,
  MAX_PICKS, MAX_PICKS_SAY, chipFocusAfter, answerFirst, basisWords, cleanPicks, compareAnswer, compareView, togglePick, breakEvenPriceSentence, chipFor, cropCodeFor, cropSources, currentRotationNote, featuresNear,
  highlightPlan, insideCropMap, leadOnSharedYears, leaderCaution, leadsOnPaper,
  leftOutLabels, lowerName, metricWords, milesBetween, priceAtPercent, priceSourceSentence, quickCrops,
  rankPosition, restTestSentence, rotationName, rotationYears, rotationYearsShown, rowMarks, sharedRecord,
  shortAnswer, shortRecordNote, shownDollars, standingSentence, testDollars, tieFacts, verbFor, whatIfOptions,
  yieldValueText, rainOutlookNote, shiftedTestCost, weatherResultLine,
} from './plan-util.js';

const WHAT_IF_STORAGE_KEY = 'fieldproof.plan.whatif';
const ANNOUNCE_DELAY_MS = 600;
const STACKED = '(max-width: 1179px)';
const PHONE = '(max-width: 767px)';
const MAP_MIN_ZOOM = 11.2;
const NEIGHBOR_MARGIN_DEG = 0.05;
const HONEY = '#ffdfb5';
const NO_PADDING = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/* Shown closed: at most this many rotations in the panel. */
const SHOWN_ROWS = 3;

const REASON_WORDS = { ok: 'Good sign', mid: 'Caution', no: 'Problem' };

const SAVED_WEATHER = Object.freeze({ fieldId: 'ritzville', place: 'Ritzville, WA', miles: 20 });

const WEATHER_NOTICE = {
  saved: `NASA could not be reached just now. The weather checks below use a saved copy of NASA's record for ${SAVED_WEATHER.place}.`,
  none: 'We could not reach NASA\'s weather record, so we cannot check the weather fit right now.',
};

const WEATHER_SOURCE = {
  live: 'Weather: NASA POWER for this exact point.',
  saved: `Weather: a saved copy of NASA POWER for ${SAVED_WEATHER.place} (NASA could not be reached just now).`,
  none: 'Weather: NASA POWER could not be reached just now.',
};

const LOAD_PROBLEM = 'The crop list could not load. Check your connection, then try again.';
const MONEY_FILE_PROBLEM = 'The money numbers for this area could not load. Check your connection and reload the page.';

const UNIT_WORDS = { cwt: 'per 100 lb', bu: 'a bushel' };
const UNIT_SPOKEN = { cwt: 'per 100 pounds', bu: 'a bushel' };

const SORTED_BY = {
  steady: 'Sorted by: dry years first.',
  typical: 'Sorted by: normal years first.',
  soil: 'Sorted by: best for soil first.',
};

const PIN_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
const CHEV = '<span class="chev" aria-hidden="true"></span>';

const TEMPLATE = `
<div class="plan fa">
  <section class="first" data-el="first" aria-labelledby="plan-answer-h">
    <div class="photo" data-el="photo1">
      <div class="globe" data-el="map"></div>
      <div class="shade shade-low" aria-hidden="true"></div>
      <div class="shade shade-side" aria-hidden="true"></div>
      <div class="shade shade-top" aria-hidden="true"></div>
      <div class="shade shade-fade" aria-hidden="true"></div>
    </div>

    <div class="topleft" data-el="topleft">
      <a class="place glass" href="#/fields">
        ${PIN_ICON}
        <span class="where"><span class="name" data-el="title"></span><span class="size" data-el="meta"></span></span>
        <span class="verb">Edit<span class="visually-hidden"> field</span></span>
      </a>
      <div class="crops glass" role="group" aria-labelledby="plan-crop-lab" data-el="cropcontrols">
        <span class="crops-lab" id="plan-crop-lab">Crops<span class="crops-count" data-el="pickcount"></span></span>
        <span class="crops-btns" data-el="quick"></span>
        <button type="button" class="morebtn" data-el="morebtn" aria-expanded="false" aria-controls="plan-more">More crops <span class="plus" aria-hidden="true">+</span></button>
      </div>
      <div class="morecrops glass" id="plan-more" data-el="more" role="group" aria-labelledby="plan-more-lab" hidden>
        <div class="more-head">
          <label for="plan-crop" id="plan-more-lab">Find a crop</label>
          <p class="more-max" id="plan-more-max" data-el="moremax"></p>
        </div>
        <input type="search" id="plan-crop" data-el="crop" autocomplete="off" spellcheck="false"
          placeholder="Type a name, like barley" aria-describedby="plan-more-max">
        <div class="more-list" data-el="morelist"></div>
        <p class="more-empty" data-el="moreempty" hidden>No crop by that name.</p>
        <button type="button" class="more-done" data-el="moredone">Done</button>
      </div>
    </div>

    <div class="lower">
      <div class="banner" data-el="banner">
        <div class="notice" data-el="notice" hidden>
          <p data-el="noticetext"></p>
          <button type="button" class="textbtn" data-el="retry">Try again</button>
        </div>
        <h1 id="plan-answer-h" data-el="h1">Checking your field…</h1>
        <p class="sub" data-el="sub"></p>
        <a class="pill" href="#plan-test" data-el="totest" hidden>See the ${TEST_ACRES}-acre test</a>
        <p class="credit">Aerial photo: USGS (USDA NAIP)</p>
      </div>

      <section class="dock glass" data-el="dock" aria-labelledby="plan-money-h">
        <div class="dock-body" data-el="dockbody">
          <div class="answerbox" aria-live="polite" data-el="answerbox">
            <h2 class="dock-title" id="plan-money-h" data-el="moneyh">Loading the money numbers…</h2>
          </div>
          <p class="dock-cap" data-el="dockcap"></p>
          <ol id="plan-bars" data-el="bars" aria-label="Rotations compared"></ol>
          <div class="axis" aria-hidden="true" data-el="axiswrap">
            <div class="axis-in" data-el="axis">
              <span class="tickmark"></span>
              <span class="loss-word" data-el="axisloss">Loses money</span>
              <span class="zero-word">$0</span>
              <span class="gain-word" data-el="axisgain">Earns money</span>
            </div>
          </div>
          <details class="quiet cmp-more" data-el="cmpmore" hidden>
            <summary>Show more ${CHEV}</summary>
            <ul class="quiet-body fine-list" data-el="cmpmorebody"></ul>
          </details>
        </div>
        <div class="dock-foot" data-el="dockfoot" hidden>
          <button type="button" class="textbtn" data-el="allrows" aria-expanded="false" aria-controls="plan-bars"></button>
          <details class="prices">
            <summary><span class="visually-hidden">Prices used: </span><span data-el="vprices"></span> ${CHEV}</summary>
            <fieldset class="opts" data-el="priceview">
              <legend class="visually-hidden">Prices used</legend>
              <label class="opt"><input type="radio" name="plan-prices" value="today"><span>Today's prices</span></label>
              <label class="opt"><input type="radio" name="plan-prices" value="hist"><span>Each year's own price</span></label>
            </fieldset>
          </details>
        </div>
      </section>
    </div>
  </section>

  <div class="lines">
    <section class="line" aria-labelledby="plan-seasons-q" data-el="seasons" hidden>
      <h2 id="plan-seasons-q">What your field went through</h2>
      <div>
        <p class="big" data-el="seasonsbig"></p>
        <p class="line-sub" data-el="seasonssay"></p>
        <div class="seasons-box">
          <ul class="season-rows" data-el="seasonrows" aria-hidden="true"></ul>
          <p class="season-key" data-el="seasonkey" aria-hidden="true"></p>
          <table class="seasons visually-hidden" data-el="seasonstable"></table>
        </div>
        <details class="quiet">
          <summary>Where this comes from ${CHEV}</summary>
          <p class="quiet-body" data-el="seasonssrc"></p>
        </details>
      </div>
    </section>

    <section class="line" aria-labelledby="plan-price-q" data-el="priceline" hidden>
      <h2 id="plan-price-q" data-el="priceq"></h2>
      <div>
        <p class="big"><span data-el="pricefig"></span><span class="unit" data-el="priceunit"></span></p>
        <p class="line-sub" data-el="pricea"></p>
        <details class="quiet" data-el="try">
          <summary>Try your own price ${CHEV}</summary>
          <div class="quiet-body try">
          <div class="try-head">
            <label for="plan-price" data-el="pricelabel"></label>
            <output for="plan-price" data-el="priceout"></output>
          </div>
          <div class="ticks up" data-el="ticksup" aria-hidden="true"></div>
          <div class="rail">
            <div class="zone" aria-hidden="true"><i data-el="zonefill"></i></div>
            <input type="range" id="plan-price" data-el="price" step="1" aria-describedby="plan-price-say"
              min="${PRICE_RANGE.low * 100}" max="${PRICE_RANGE.high * 100}">
          </div>
          <div class="ticks down" data-el="ticksdown" aria-hidden="true"></div>
          <p class="zone-key" data-el="zonekeyline"><i aria-hidden="true"></i><span data-el="zonekey"></span></p>
          <p class="say" id="plan-price-say" data-el="say"></p>
          <button type="button" class="textbtn" data-el="reset">Back to today's price</button>
          </div>
        </details>
        <p class="line-sub" data-el="priceoff" hidden>The panel now uses each year's own price. Choose
          “Today's prices” in the panel to try another price.</p>
        <details class="quiet">
          <summary>Try a different harvest ${CHEV}</summary>
          <div class="quiet-body">
            <div class="try-head">
              <label for="plan-yield" data-el="yieldlabel"></label>
              <output for="plan-yield" data-el="yieldout"></output>
            </div>
            <div class="rail plain">
              <div class="zone" aria-hidden="true"></div>
              <input type="range" id="plan-yield" data-el="yield" step="1"
                min="${YIELD_PERCENT_RANGE.low}" max="${YIELD_PERCENT_RANGE.high}">
            </div>
            <p class="say" data-el="standing"></p>
          </div>
        </details>
        <details class="quiet">
          <summary>Where today's price comes from ${CHEV}</summary>
          <p class="quiet-body" data-el="pricesrc"></p>
        </details>
      </div>
    </section>

    <section class="line" aria-labelledby="plan-wx-q" data-el="wxline" hidden>
      <h2 id="plan-wx-q">What if the weather shifts?</h2>
      <div>
        <p class="line-sub">Drag to see which rotation holds up if springs get drier or summers hotter.
          No harvest is invented: the real years whose weather looks like that count more.</p>
        <div class="try">
          <div class="try-head">
            <label for="plan-rain">Spring rain, March to June</label>
            <output for="plan-rain" data-el="rainout"></output>
          </div>
          <div class="rail plain">
            <div class="zone" aria-hidden="true"></div>
            <input type="range" id="plan-rain" data-el="rain" aria-describedby="plan-wx-note plan-wx-say"
              min="${WEATHER_SHIFT.rainPct[0]}" max="${WEATHER_SHIFT.rainPct[1]}" step="${WEATHER_SHIFT.rainPct[2]}">
          </div>
          <p class="wx-note" id="plan-wx-note" data-el="wxnote"></p>
          <div class="try-head">
            <label for="plan-heat">Summer heat, June and July</label>
            <output for="plan-heat" data-el="heatout"></output>
          </div>
          <div class="rail plain">
            <div class="zone" aria-hidden="true"></div>
            <input type="range" id="plan-heat" data-el="heat" aria-describedby="plan-wx-say"
              min="${WEATHER_SHIFT.heatC[0]}" max="${WEATHER_SHIFT.heatC[1]}" step="${WEATHER_SHIFT.heatC[2]}">
          </div>
          <p class="wx-result" data-el="wxresult" aria-live="polite"></p>
          <p class="say" id="plan-wx-say" data-el="wxsay"></p>
          <button type="button" class="textbtn" data-el="wxreset">Back to normal weather</button>
        </div>
      </div>
    </section>

    <section class="line" aria-labelledby="plan-grow-q">
      <h2 id="plan-grow-q" data-el="growq">Can it grow here?</h2>
      <div>
        <p class="big" data-el="growbig">Checking…</p>
        <p class="line-sub" data-el="growsub">Checking NASA's weather record for this point…</p>
        <details class="quiet" data-el="growmore" hidden>
          <summary>See what was checked ${CHEV}</summary>
          <div class="quiet-body" data-el="growbody"></div>
        </details>
      </div>
    </section>

    <section class="line" aria-labelledby="plan-rotation-q" data-el="rotation" hidden>
      <h2 id="plan-rotation-q" data-el="rotationq"></h2>
      <div>
        <div data-el="rotrows"></div>
        <p class="src-line" data-el="rotnote"></p>
      </div>
    </section>

    <section class="line is-small" aria-labelledby="plan-src-q" data-el="srcline" hidden>
      <h2 id="plan-src-q">Where do these numbers come from?</h2>
      <div>
        <p class="big" data-el="srcfig"></p>
        <p class="line-sub" data-el="srca"></p>
        <details class="quiet">
          <summary>See every number ${CHEV}</summary>
          <div class="quiet-body">
            <div class="nums-box"><table class="nums" data-el="table"></table></div>
            <ul class="fine-list" data-el="tablenotes"></ul>
            <p><a class="textlink" href="#/proof">What this does not prove</a></p>
          </div>
        </details>
        <details class="quiet">
          <summary>Where these numbers come from ${CHEV}</summary>
          <div class="quiet-body" data-el="sources"></div>
        </details>
      </div>
    </section>
  </div>

  <section class="test" id="plan-test" tabindex="-1" data-el="test" aria-labelledby="plan-test-h" hidden>
    <div class="photo">
      <div class="globe" data-el="map2"></div>
      <div class="shade shade-side" aria-hidden="true"></div>
      <div class="shade shade-ends" aria-hidden="true"></div>
    </div>
    <div class="test-in" data-el="testin">
      <p class="kicker">The smallest safe test</p>
      <h2 id="plan-test-h" data-el="testh"></h2>
      <p class="key">
        <span><i class="sw-crop" aria-hidden="true"></i><span data-el="keycrop"></span></span>
        <span><i class="sw-base" aria-hidden="true"></i><span data-el="keybase"></span></span>
        <span class="key-say" data-el="keytotal"></span>
      </p>
      <div class="acrebar" data-el="acrebar" role="img"><i class="sw-crop" data-el="acrecrop"></i><i class="sw-base" data-el="acrebase"></i></div>
      <div data-el="testbody"></div>
    </div>
  </section>

  <div class="closing">
    <p class="closing-q">Did this advice hold up in past years?</p>
    <a class="pill" href="#/proof">See the proof <span aria-hidden="true">→</span></a>
  </div>
</div>`;

/* The screen now on the page, or null. Work that finishes after the screen has closed checks
   `view !== current` and stops. */
let view = null;

/* ---------- small helpers ---------- */

function collectElements(root) {
  const els = {};
  for (const el of root.querySelectorAll('[data-el]')) els[el.dataset.el] = el;
  return els;
}

function fieldKey(field) {
  return `${field.id}|${field.pin.join(',')}|${field.county}`;
}

function announceSoon(current, text) {
  window.clearTimeout(current.announceTimer);
  current.announceTimer = window.setTimeout(() => {
    if (view === current && text) announce(text);
  }, ANNOUNCE_DELAY_MS);
}

function isIrrigated() {
  return state.answers.water === 'Irrigated';
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dollarsText(value) {
  return `$${value.toFixed(2)}`;
}

/* "Earns $14", "Loses $41", "$0". */
function barWords(dollars) {
  if (dollars < 0) return `Loses ${money(-dollars)}`;
  return dollars === 0 ? '$0' : `Earns ${money(dollars)}`;
}

function inWords(dollars) {
  if (dollars < 0) return `loses ${money(-dollars)} an acre`;
  return dollars === 0 ? 'makes $0 an acre' : `earns ${money(dollars)} an acre`;
}

/* ---------- the slider values, kept for a reload ---------- */

function freshWhatIf(key) {
  return { key, pricePercent: PRICE_PERCENT_TODAY, yieldPercent: 0 };
}

function isWholeBetween(value, low, high) {
  return Number.isInteger(value) && value >= low && value <= high;
}

function savedWhatIf(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(WHAT_IF_STORAGE_KEY));
    const usable = saved?.key === key
      && isWholeBetween(saved.pricePercent, PRICE_RANGE.low * 100, PRICE_RANGE.high * 100)
      && isWholeBetween(saved.yieldPercent, YIELD_PERCENT_RANGE.low, YIELD_PERCENT_RANGE.high);
    return usable ? { key, pricePercent: saved.pricePercent, yieldPercent: saved.yieldPercent } : freshWhatIf(key);
  } catch {
    return freshWhatIf(key);
  }
}

/* Keep a slider's values for a reload. */
function saveForReload(storageKey, value) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Storage is full or blocked. The sliders still work; a reload starts them over.
  }
}

function saveWhatIf(whatIf) {
  saveForReload(WHAT_IF_STORAGE_KEY, whatIf);
}

function whatIfFor(current, key) {
  if (current.whatIf?.key !== key) current.whatIf = savedWhatIf(key);
  return current.whatIf;
}

/* ---------- the weather what-if, kept for a reload ---------- */

const WEATHER_STORAGE_KEY = 'fieldproof.plan.weather';
const NO_SHIFT = Object.freeze({ rainPct: 0, heatC: 0 });

function onStep(value, [low, high, step]) {
  return Number.isFinite(value) && value >= low && value <= high && Math.abs(value / step - Math.round(value / step)) < 1e-9;
}

function weatherShiftFor(current, fieldId) {
  if (current.weatherShift?.fieldId === fieldId) return current.weatherShift;
  let shift = { fieldId, ...NO_SHIFT };
  try {
    const saved = JSON.parse(sessionStorage.getItem(WEATHER_STORAGE_KEY));
    if (saved?.fieldId === fieldId && onStep(saved.rainPct, WEATHER_SHIFT.rainPct) && onStep(saved.heatC, WEATHER_SHIFT.heatC)) {
      shift = { fieldId, rainPct: saved.rainPct, heatC: saved.heatC };
    }
  } catch {
    // Nothing saved, or storage is blocked: start from normal weather.
  }
  current.weatherShift = shift;
  return shift;
}

function saveWeatherShift(shift) {
  saveForReload(WEATHER_STORAGE_KEY, shift);
}

/* ---------- the model: everything the money parts show ---------- */

function chosenCrop(current) {
  const { needs } = current.data;
  return needs.find((crop) => crop.name === state.answers.crop) ?? needs[0];
}

const NO_OVERRIDES = Object.freeze({ priceOverride: Object.freeze({}), yieldFactor: Object.freeze({}) });

function overridesFor(whatIf, code, todayPrice, prices) {
  const pricePercent = prices === 'today' ? whatIf.pricePercent : PRICE_PERCENT_TODAY;
  return whatIfOptions(code, todayPrice, pricePercent, whatIf.yieldPercent);
}

/* Null when no dollars can be shown. `canTry` says whether the price line and the test apply. */
function moneyModel(current, cropName) {
  const { app, config, fieldConfig } = current.data;
  const factor = app ? toTodayFactor(app) : null;
  if (!app || !config || !fieldConfig || factor === null) return null;

  const priority = state.answers.priority;
  const prices = state.priceView;
  const weatherShift = weatherShiftFor(current, fieldConfig.id);
  const code = cropCodeFor(cropName, config.crop_codes);
  const untouched = rank(app, { priority, prices, weatherShift });
  const plan = highlightPlan(untouched, code);
  const model = { app, fieldConfig, factor, priority, prices, weatherShift, code, plan, cropName };
  const today = app.prices_today?.[code];
  const canTry = plan.mode === 'option' && today?.nominal > 0;
  if (!canTry) return { ...model, canTry, moved: false, overrides: NO_OVERRIDES, ranking: untouched };

  const whatIf = whatIfFor(current, `${fieldConfig.id}:${code}`);
  const overrides = overridesFor(whatIf, code, today.nominal, prices);
  const moved = code in overrides.priceOverride || code in overrides.yieldFactor;
  return { ...model, canTry, moved, today, whatIf, overrides, ranking: rank(app, { priority, prices, weatherShift, ...overrides }) };
}

function rankingOptions(model) {
  return { priority: model.priority, prices: model.prices, weatherShift: model.weatherShift, ...model.overrides };
}

function leadOverNow(model, optionId) {
  return leadOnSharedYears(model.app, optionId, model.factor, rankingOptions(model));
}

/* Each rotation with the crop, and the price at which it matches what is grown now (today's
   prices, the yield slider counts), lowest first. price is null when no price in range is enough. */
function breakEvens(model) {
  const { app, code, priority, factor, overrides } = model;
  const opts = { priority, prices: 'today', yieldFactor: overrides.yieldFactor, weatherShift: model.weatherShift };
  return model.plan.optionIds
    .filter((id) => id !== app.current_option)
    .map((id) => {
      const shared = leadOnSharedYears(app, id, factor, opts);
      return { id, price: breakEvenPrice(shared.app, id, code, opts), lead: shared.lead, years: shared.years };
    })
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

/* ---------- field ---------- */

function renderField(current) {
  const field = state.field;
  const sample = current.data?.config?.fields.find((entry) => entry.id === field.sampleId);
  const acres = field.props?.ac;
  current.els.title.textContent = sample?.label ?? (field.props ? 'Your field' : 'Your pinned field');
  const water = lowerName(state.answers.water ?? 'dryland');
  current.els.meta.textContent = Number.isFinite(acres) ? `${count(acres)} acres, ${water}` : water;
}

/* ---------- the weather record ---------- */

function savedWeatherFits(field, config) {
  if (field.sampleId === SAVED_WEATHER.fieldId) return true;
  const site = config?.fields.find((entry) => entry.id === SAVED_WEATHER.fieldId);
  return Boolean(site) && milesBetween(field.pin, site.pin) <= SAVED_WEATHER.miles;
}

function weatherFrom(answer, field, config) {
  if (answer.live) return { climate: answer.data, source: 'live' };
  if (savedWeatherFits(field, config)) return { climate: answer.data, source: 'saved' };
  return { climate: null, source: 'none' };
}

function renderWeatherNotice(current) {
  const text = WEATHER_NOTICE[current.data.weather?.source];
  current.els.notice.hidden = !text;
  current.els.retry.hidden = false;
  if (text) current.els.noticetext.textContent = text;
}

/* ---------- crop controls ---------- */

function fillCropControls(current) {
  const { needs } = current.data;
  current.els.morelist.innerHTML = cropGroups(needs).map(({ group, names }) => {
    const items = names.map((name) => {
      const safe = escapeHtml(name);
      return `<label class="more-item" data-name="${escapeHtml(name.toLowerCase())}"><input type="checkbox" value="${safe}"><span>${safe}</span></label>`;
    }).join('');
    return `<fieldset class="more-group"><legend>${escapeHtml(group)}</legend>${items}</fieldset>`;
  }).join('');
  current.quick = triedCrops(current) ?? quickCrops(needs, state.field.county).slice(0, 3);
}

/* The crops picked to compare, and the one the rest of the screen checks. */
function currentPicks(current) {
  return cleanPicks(state.answers.picks, state.answers.crop, current.data.needs.map((crop) => crop.name));
}

const REFUSED = {
  full: MAX_PICKS_SAY,
  last: 'Keep at least one crop picked.',
};

/* Add or take away one pick. Returns false when the change was refused (and says why). */
function togglePickFor(current, name) {
  const { picks, focus } = currentPicks(current);
  const next = togglePick(picks, name, focus);
  if (next.refused) {
    current.els.moremax.textContent = REFUSED[next.refused];
    announce(REFUSED[next.refused]);
    return false;
  }
  state.update({ answers: { picks: next.picks, crop: next.focus } });
  // The last free place is taken: say so, since the other crops can't be added now.
  if (next.picks.length === MAX_PICKS && next.picks.length > picks.length) {
    current.els.moremax.textContent = MAX_PICKS_SAY;
    announce(MAX_PICKS_SAY);
  }
  return true;
}

function filterCropList(current) {
  const { els } = current;
  const query = els.crop.value.trim().toLowerCase();
  let shown = 0;
  for (const group of els.morelist.querySelectorAll('.more-group')) {
    let inGroup = 0;
    for (const item of group.querySelectorAll('.more-item')) {
      const match = !query || item.dataset.name.includes(query);
      item.hidden = !match;
      if (match) inGroup += 1;
    }
    group.hidden = inGroup === 0;
    shown += inGroup;
  }
  els.moreempty.hidden = shown > 0;
}

function setMoreOpen(current, open) {
  const { els } = current;
  els.more.hidden = !open;
  els.morebtn.setAttribute('aria-expanded', String(open));
  placeMore(current);
  if (open) els.crop.focus();
}

/* The dropdown hangs just under the chips, inside the top-left column (so never over the panel). */
function placeMore(current) {
  const { els } = current;
  if (els.more.hidden) return;
  const chips = els.cropcontrols;
  const room = els.topleft.clientWidth - els.more.offsetWidth;
  els.more.style.left = `${Math.max(0, Math.min(chips.offsetLeft, room))}px`;
  els.more.style.top = `${chips.offsetTop + chips.offsetHeight + 8}px`;
}

/* The quick buttons: the crops the money comparison tries that are not grown now (at most two),
   so each button leads to a rotation and a test. Null without a money file. */
const WHEAT_AND_REST = new Set(['WW', 'SW', REST_CODE]);
function triedCrops(current) {
  const { app, config, needs } = current.data;
  if (!app || !config) return null;
  const now = new Set(app.options[app.current_option]?.crops ?? []);
  const codes = new Set(Object.values(app.options).flatMap((option) => option.crops)
    .filter((code) => !now.has(code) && !WHEAT_AND_REST.has(code)));
  const names = needs.map((crop) => crop.name)
    .filter((name) => codes.has(cropCodeFor(name, config.crop_codes)));
  const order = ['Lentils', 'Peas', 'Canola'];
  const place = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  names.sort((a, b) => place(a) - place(b));
  return names.length ? names.slice(0, 2) : null;
}

/* The chips: the quick crops, then any other pick. Each chip is a toggle. */
function renderCropButtons(current, picks) {
  const { els } = current;
  const names = [...current.quick, ...picks.filter((name) => !current.quick.includes(name))];
  els.quick.innerHTML = names.map((name) => {
    const on = picks.includes(name);
    const safe = escapeHtml(name);
    return `<button type="button" data-crop="${safe}" aria-pressed="${on}"><span class="tick" aria-hidden="true"></span>${safe}</button>`;
  }).join('');
  els.pickcount.innerHTML = ` <b>${picks.length}</b><span class="of"> of ${MAX_PICKS}</span><span class="visually-hidden"> picked</span>`;
  const full = picks.length >= MAX_PICKS;
  for (const box of els.morelist.querySelectorAll('input[type="checkbox"]')) {
    box.checked = picks.includes(box.value);
    // aria-disabled, not disabled: the box stays in the Tab order, and choosing it says why it can't be added.
    if (full && !box.checked) box.setAttribute('aria-disabled', 'true');
    else box.removeAttribute('aria-disabled');
  }
  els.moremax.textContent = full
    ? `${MAX_PICKS} picked, the most. Uncheck one to pick another.`
    : `Pick up to ${MAX_PICKS} to compare. ${picks.length} picked.`;
  placeMore(current);
}

/* ---------- can it grow here ---------- */

function cropCheck(current, crop) {
  const { data } = current;
  if (!data.weather) return null;
  return checkCrop(crop, data.weather.climate, {
    irrigated: isIrrigated(),
    county: state.field.county,
    covered: data.insideCropMap,
  });
}

function inchWords(mm) {
  return inches(mm).replace(/ in$/, ' inches');
}

function rainBarsHtml(summary, crop) {
  const need = crop.rmin ?? null;
  if (!summary || !(need > 0)) return '';
  const here = summary.annualRainMm;
  const most = Math.max(here, need);
  const name = crop.name;
  const needs = verbFor(name, 'needs', 'need');
  return `<div class="rainbars" role="img" aria-label="Rain here is ${inchWords(here)} a year. ${escapeHtml(name)} usually ${needs} at least ${inchWords(need)}.">
    <div class="hbar"><span>Rain here in a year</span><span class="hbar-track"><span class="hbar-fill" style="width:${(here / most * 100).toFixed(1)}%"></span></span><b>${inchWords(here)}</b></div>
    <div class="hbar"><span>${escapeHtml(name)} usually ${needs}</span><span class="hbar-track"><span class="hbar-fill need" style="width:${(need / most * 100).toFixed(1)}%"></span></span><b>${inchWords(need)}</b></div>
  </div>`;
}

function renderGrow(current, crop, check) {
  const { els, data } = current;
  els.growq.textContent = `Can ${lowerName(crop.name)} grow here?`;
  if (!check) {
    els.growbig.textContent = 'Checking…';
    els.growsub.textContent = 'Checking NASA\'s weather record for this point…';
    els.growmore.hidden = true;
    return;
  }
  const rainTight = check.reasons.some((reason) => reason.kind === 'no' && reason.topic === 'rain');
  const summary = data.weather.climate ? climateSummary(data.weather.climate) : null;
  const big = { green: rainTight ? `${crop.name} will grow here, but rain is short.` : 'Yes.', amber: 'Maybe.', red: 'Not here.' };
  els.growbig.textContent = big[check.cls] ?? check.headline;
  const lowRain = rainTight && summary ? ` Low rain: ${inchWords(summary.annualRainMm)} a year.` : '';
  els.growsub.textContent = `${check.headline}.${lowRain}`;
  const reasons = check.reasons.map((reason) => `<li>
      <span class="mark" aria-hidden="true">${escapeHtml(reason.mark)}</span>
      <span><b>${REASON_WORDS[reason.kind] ?? 'Note'}</b>${escapeHtml(reason.text)}</span></li>`).join('');
  els.growbody.innerHTML = `<ul class="reasons">${reasons}</ul>
    ${rainBarsHtml(summary, crop)}
    <p class="src-line">${WEATHER_SOURCE[data.weather.source]} Crop needs: FAO EcoCrop. Local fields: Washington state crop map, 2025.</p>`;
  els.growmore.hidden = false;
}

/* ---------- the answer on the field ---------- */

function tieWith(model, optionId) {
  const tie = tieFacts(model.ranking, model.priority, model.factor);
  if (!tie || !tie.optionIds.includes(optionId)) return null;
  const otherId = tie.optionIds.find((id) => id !== optionId);
  return { other: rotationName(model.app, otherId), withCurrent: otherId === model.app.current_option, gap: tie.gap };
}

function answerFacts(model) {
  if (!model) return null;
  const { plan, priority, prices, overrides, code, app, ranking } = model;
  const facts = { mode: plan.mode, priority, basis: basisWords(prices, overrides, code), canTest: model.canTry };
  if (plan.mode === 'option') {
    const optionId = plan.option.option_id;
    const { lead, years } = leadOverNow(model, optionId);
    return { ...facts, option: { name: rotationName(app, optionId), lead, years, tie: tieWith(model, optionId), needs: null, noPriceInRange: false } };
  }
  if (plan.mode === 'current') {
    const nowId = ranking.current_option;
    const top = ranking.ranked[0];
    const ahead = top.option_id === nowId ? { lead: null, years: null } : leadOverNow(model, top.option_id);
    return {
      ...facts,
      now: {
        position: rankPosition(ranking, nowId),
        total: ranking.ranked.length,
        tie: tieWith(model, nowId),
        topName: rotationName(app, top.option_id),
        topLead: ahead.lead,
        topYears: ahead.years,
      },
    };
  }
  return facts;
}

/* The line under the big answer: short, and it ends on what to do. */
function bannerSub(crop, check, facts, answer) {
  const name = lowerName(crop.name);
  if (!facts || facts.mode !== 'option' || check.cls === 'red') return answer.details.slice(0, 2).join(' ');
  const { option, priority } = facts;
  const tryIt = (anyway) => (anyway ? `See below what would change that.` : `See below what would change the answer.`);
  if (option.tie) {
    return `For ${PRIORITY_WORDS[priority]}, ${name} ${verbFor(crop.name, 'does', 'do')} not clearly beat what you grow now. ${tryIt(false)}`;
  }
  if (option.lead > 0) {
    return `${facts.basis}, the best rotation with ${name} earns more than what you grow now `
      + `${metricWords(priority)}. See below what would change the answer.`;
  }
  return `${facts.basis}, what you grow now earns more ${metricWords(priority)} than any rotation with ${name}. ${tryIt(true)}`;
}

function renderBanner(current, crop, check, model) {
  const { els } = current;
  if (!check) {
    els.h1.textContent = `Checking ${lowerName(crop.name)} on your field…`;
    els.sub.textContent = '';
    current.testCrop = null;
    els.totest.hidden = true;
    return null;
  }
  const facts = answerFacts(model);
  const answer = shortAnswer({ cropName: crop.name, check, facts, noMoney: model ? '' : noMoneySentence(current) });
  const at = model?.prices === 'hist' ? 'at each year\'s own price' : 'at today\'s prices';
  els.h1.textContent = answer.lead.replace(/ do not pay yet\.$/, ` do not pay ${at}.`);
  els.h1.classList.toggle('is-long', els.h1.textContent.length > 58);
  els.sub.textContent = bannerSub(crop, check, facts, answer);
  current.testCrop = null;
  els.totest.textContent = `See the ${TEST_ACRES}-acre test`;
  els.totest.hidden = !model?.canTry || check.cls === 'red';
  return answer;
}

function noMoneySentence(current) {
  const { app, config, moneyProblem } = current.data;
  if (moneyProblem) return moneyProblem;
  if (app) return 'Today\'s wheat price is missing from the data for this area, so no dollars are shown.';
  const counties = config?.fields.map((entry) => entry.county) ?? [];
  return `The money comparison covers ${wordList(counties)} counties so far. The crop check works everywhere.`;
}

/* ---------- the glass panel: the money ---------- */

/* The checked crop's answer for the panel's first sentence: the best-ranked rotation with the
   crop, next to what is grown now. Null when the crop is not in a tested rotation, or is grown now. */
function checkedFacts(model) {
  if (model.plan.mode !== 'option') return null;
  const optionId = model.plan.option.option_id;
  return { cropName: model.cropName, lead: leadOverNow(model, optionId).lead, tie: Boolean(tieWith(model, optionId)) };
}

/* The rows in the order shown. When the top row leads only on state-average harvests, what is
   grown now and the best rotation with the checked crop come first; the rest keep their rank. */
function displayOrder(model, rows, onPaper) {
  if (!onPaper) return { rows, reordered: false };
  const { ranking, plan } = model;
  const firstIds = [ranking.current_option];
  if (plan.mode === 'option' && plan.option.option_id !== ranking.current_option) firstIds.push(plan.option.option_id);
  const first = firstIds.map((id) => rows.find((entry) => entry.row.option_id === id)).filter(Boolean);
  const rest = rows.filter((entry) => !firstIds.includes(entry.row.option_id));
  return { rows: [...first, ...rest], reordered: true };
}

/* Shown closed: the top row (both when tied), what is grown now, the best rotation with the crop. */
function shownIds(model) {
  const { ranking, plan } = model;
  const ids = new Set([ranking.ranked[0].option_id]);
  if (ranking.tie && ranking.ranked[1]) ids.add(ranking.ranked[1].option_id);
  ids.add(ranking.current_option);
  if (plan.mode === 'option') ids.add(plan.option.option_id);
  for (const row of ranking.ranked) {
    if (ids.size >= SHOWN_ROWS) break;
    ids.add(row.option_id);
  }
  return ids;
}

const TAG_WORDS = { now: 'You grow this now' };

function tagFor(model, row, index, onPaper) {
  const { ranking, priority, plan, cropName } = model;
  const marks = rowMarks({ row, index, ranking, priority, highlightIds: plan.optionIds ?? [], cropName, onPaper });
  return marks
    .filter((mark) => mark.kind !== 'short')
    .map((mark) => (mark.kind === 'has' ? `With ${lowerName(cropName)}` : TAG_WORDS[mark.kind] ?? mark.text))
    .join(' · ');
}

function pairHtml(dollars, zero, span, label) {
  const width = Math.abs(dollars) / span * 100;
  const left = dollars < 0 ? zero - width : zero;
  const bar = dollars === 0 ? ''
    : `<i class="bar ${dollars < 0 ? 'neg' : 'pos'}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></i>`;
  return `<div class="pair"><span class="lab">${label}</span><span class="track">${bar}</span>`
    + `<span class="val">${barWords(dollars)}</span></div>`;
}

function barsHtml(model, caution) {
  const { app, ranking, factor } = model;
  const ranked = ranking.ranked.map((row, rankIndex) => ({
    row,
    rankIndex,
    typical: shownDollars(row.typical, factor) ?? 0,
    bad: shownDollars(row.bad_year_climate, factor) ?? 0,
  }));
  const all = ranked.flatMap((entry) => [entry.typical, entry.bad]);
  const low = Math.min(0, ...all);
  const high = Math.max(0, ...all);
  const span = high - low || 1;
  const zero = (0 - low) / span * 100;
  const shown = shownIds(model);
  const onPaper = leadsOnPaper(app, ranking);
  const { rows, reordered } = displayOrder(model, ranked, onPaper);
  const html = rows.map(({ row, rankIndex, typical, bad }, index) => {
    const isNow = row.option_id === ranking.current_option;
    const tag = tagFor(model, row, rankIndex, onPaper);
    const number = reordered ? '' : `Number ${index + 1} of ${rows.length}. `;
    const hidden = model.showAll || shown.has(row.option_id) ? '' : ' hidden';
    const short = row.full_record ? '' : ` Its record covers ${yearSpan(...row.years)} only.`;
    return `<li class="rot${isNow ? ' is-now' : ''}"${hidden} data-option="${escapeHtml(row.option_id)}">
      <span class="rank" aria-hidden="true">${reordered ? "" : index + 1}</span>
      ${tag ? `<p class="rot-tag">${escapeHtml(tag)}</p>` : ''}
      <h3 class="rot-name">${escapeHtml(rotationName(app, row.option_id))}</h3>
      <div class="plot" aria-hidden="true" style="--zero:${(zero / 100).toFixed(4)}">
        ${pairHtml(typical, zero, span, 'Normal year')}
        ${pairHtml(bad, zero, span, 'Dry year')}
        <span class="zero"></span>
      </div>
      <p class="visually-hidden">${number}In a normal year it ${inWords(typical)}. In a dry year it ${inWords(bad)}.${short}</p>
      ${rankIndex === 0 && caution ? `<p class="rot-note">${escapeHtml(caution)}</p>` : ''}
    </li>`;
  }).join('');
  return { html, zero, low, high, hiddenCount: rows.length - (model.showAll ? rows.length : shown.size), total: rows.length, reordered };
}

function renderMoney(current, model) {
  const { els } = current;
  els.dockfoot.hidden = !model;
  els.axiswrap.hidden = !model;
  if (!model) {
    els.moneyh.textContent = current.data ? noMoneySentence(current) : 'Loading the money numbers…';
    els.dockcap.textContent = '';
    els.bars.innerHTML = '';
    return;
  }
  model.showAll = current.showAll;
  els.moneyh.textContent = answerFirst({ ...model, checked: checkedFacts(model) });
  const caution = leaderCaution(model);
  const bars = barsHtml(model, caution);
  els.dockcap.textContent = [`Dollars per acre, per year, at today's money.${bars.reordered ? '' : ` ${SORTED_BY[model.priority]}`}`, shiftNote(model)]
    .filter(Boolean).join(' ');
  els.bars.innerHTML = bars.html;
  els.axis.style.setProperty('--zero', (bars.zero / 100).toFixed(4));
  els.axisloss.hidden = !(bars.low < 0);
  els.axisgain.hidden = !(bars.high > 0);
  els.allrows.hidden = bars.hiddenCount === 0 && !current.showAll;
  els.allrows.setAttribute('aria-expanded', String(current.showAll));
  els.allrows.textContent = current.showAll ? 'See fewer rotations' : `See all ${bars.total} rotations`;
  els.vprices.textContent = model.prices === 'today' ? 'Today\'s prices' : 'Each year\'s own price';
  for (const radio of els.priceview.querySelectorAll('input')) radio.checked = radio.value === model.prices;
}

/* ---------- compare: two to four crops, side by side ---------- */

/* `model` is moneyModel() for the focus crop, as the single-crop panel uses it: the same ranking,
   price view and slider overrides, so the sliders move the compare rows too. Null: no dollars. */
function compareFor(current, picks, model) {
  const { app, config, needs } = current.data;
  const usable = Boolean(model);
  const factor = usable ? model.factor : null;
  const priority = state.answers.priority;
  const prices = usable ? model.prices : state.priceView;
  const ranking = usable ? model.ranking : null;
  const overrides = usable ? model.overrides : undefined;
  const rows = picks.map((name) => ({
    name,
    code: usable ? cropCodeFor(name, config.crop_codes) : null,
    check: cropCheck(current, needs.find((crop) => crop.name === name)),
  }));
  const compared = compareView({ app: usable ? app : null, factor, ranking, priority, prices, picks: rows, overrides });
  return { ...compared, usable, priority, prices, app: usable ? app : null };
}

const GROW_WAIT = { kind: 'wait', text: 'Checking…' };

function compareRowHtml({ name, grow, money: cash, canTest, kind }, zero, span) {
  const safe = escapeHtml(name);
  const verdict = grow ?? GROW_WAIT;
  const head = `<div class="cmp-head"><h3 class="rot-name">${safe}</h3>`
    + `<span class="grow grow-${verdict.kind}"><span class="visually-hidden">Will it grow here? </span>${escapeHtml(verdict.text)}</span></div>`;
  if (!cash) {
    return `<li class="rot cmp is-empty">${head}<p class="cmp-none">No price data for this crop yet</p></li>`;
  }
  const where = cash.inNow ? 'Already in what you grow now' : `In “${cash.rotation}”`;
  const paper = cash.onPaper ? ' · Washington averages' : '';
  const test = canTest
    ? `<button type="button" class="cmp-test" data-test-crop="${safe}">See the ${TEST_ACRES}-acre test<span class="visually-hidden"> for ${escapeHtml(lowerName(name))}</span> <span aria-hidden="true">→</span></button>` : '';
  return `<li class="rot cmp${kind === 'no' || kind === 'water' ? ' is-out' : ''}">${head}
    <p class="rot-tag">${escapeHtml(where + paper)}</p>
    <div class="plot" aria-hidden="true" style="--zero:${(zero / 100).toFixed(4)}">
      ${pairHtml(cash.typical, zero, span, 'Normal year')}
      ${pairHtml(cash.bad, zero, span, 'Dry year')}
      <span class="zero"></span>
    </div>
    <p class="visually-hidden">In a normal year it ${inWords(cash.typical)}. In a dry year it ${inWords(cash.bad)}.</p>
    ${test}
  </li>`;
}

function compareHtml(compared) {
  const { baseline, rows, low, high } = compared;
  const span = high - low || 1;
  const zero = (0 - low) / span * 100;
  const now = baseline ? `<li class="rot cmp is-now">
      <p class="rot-tag">You grow this now</p>
      <h3 class="rot-name">${escapeHtml(baseline.rotation)}</h3>
      <div class="plot" aria-hidden="true" style="--zero:${(zero / 100).toFixed(4)}">
        ${pairHtml(baseline.typical, zero, span, 'Normal year')}
        ${pairHtml(baseline.bad, zero, span, 'Dry year')}
        <span class="zero"></span>
      </div>
      <p class="visually-hidden">In a normal year it ${inWords(baseline.typical)}. In a dry year it ${inWords(baseline.bad)}.</p>
    </li>` : '';
  return { html: now + rows.map((row) => compareRowHtml(row, zero, span)).join(''), zero, low, high };
}

function compareMoreItems(compared) {
  const items = [`Each crop is shown in its best rotation for ${PRIORITY_WORDS[compared.priority]}.`,
    'Dollars are an acre, a year, at today\'s money, after seed, fertilizer, fuel and other yearly costs. '
      + 'A dry year is the 1 year in 5 at the low end.'];
  const paper = compared.rows.filter((row) => row.money?.onPaper).map((row) => lowerName(row.name));
  if (paper.length) {
    items.push(`Harvests for ${wordList(paper)} are Washington averages, not local ones. Your field may do better or worse, so check your own harvests first.`);
  }
  const none = compared.rows.filter((row) => !row.money).map((row) => lowerName(row.name));
  if (none.length && compared.usable) {
    items.push(`We have no harvest and price record for ${wordList(none)} in this area yet, so no dollars are shown.`);
  }
  items.push('“Will it grow here?” uses NASA\'s weather record for this spot and FAO crop needs.');
  return items;
}

function renderCompare(current, picks, model) {
  const { els } = current;
  const compared = compareFor(current, picks, model);
  const ready = Boolean(current.data.weather);
  const answer = ready ? compareAnswer(compared.rows) : `Checking your ${picks.length} crops on your field…`;
  els.h1.setAttribute('aria-live', 'polite');
  els.h1.textContent = answer;
  els.h1.classList.remove('is-long');
  els.h1.classList.add('is-compare');
  // The same button as with one crop, for the pick that does best (rows come best first).
  const best = ready ? compared.rows.find((row) => row.canTest) : null;
  els.sub.textContent = best
    ? `Each crop in its best rotation, next to what you grow now.`
    : 'Each crop in its best rotation, next to what you grow now.';
  current.testCrop = best?.name ?? null;
  els.totest.textContent = best ? `See the ${TEST_ACRES}-acre test for ${lowerName(best.name)}` : `See the ${TEST_ACRES}-acre test`;
  els.totest.hidden = !best;

  els.dockfoot.hidden = !compared.usable;
  els.allrows.hidden = true;
  els.moneyh.textContent = compared.usable ? 'Your picks, side by side' : noMoneySentence(current);
  els.dockcap.textContent = compared.usable ? ['Dollars an acre, a year, at today\'s money.', shiftNote(model)].filter(Boolean).join(' ') : '';
  const drawn = compareHtml(compared);
  els.bars.setAttribute('aria-label', 'Your crops compared');
  els.bars.innerHTML = drawn.html;
  els.axiswrap.hidden = !compared.usable;
  els.axis.style.setProperty('--zero', (drawn.zero / 100).toFixed(4));
  els.axisloss.hidden = !(drawn.low < 0);
  els.axisgain.hidden = !(drawn.high > 0);
  els.cmpmore.hidden = false;
  els.cmpmorebody.innerHTML = compareMoreItems(compared).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  if (compared.usable) {
    els.vprices.textContent = compared.prices === 'today' ? 'Today\'s prices' : 'Each year\'s own price';
    for (const radio of els.priceview.querySelectorAll('input')) radio.checked = radio.value === compared.prices;
  }
  return ready ? answer : null;
}

/* Back to one crop: undo what the compare view changed on the shared parts. */
function leaveCompare(current) {
  const { els } = current;
  els.h1.removeAttribute('aria-live');
  els.h1.classList.remove('is-compare');
  els.bars.setAttribute('aria-label', 'Rotations compared');
  els.cmpmore.hidden = true;
}

/* ---------- the price that would change the answer ---------- */

function priceAnswer(model, breaks, at) {
  const { cropName, priority } = model;
  const name = lowerName(cropName);
  const when = metricWords(priority);
  const met = breaks.filter((entry) => entry.price !== null && at >= entry.price);
  const first = breaks.find((entry) => entry.price !== null);
  const text = dollarsText(at);
  if (!first) return `<strong>No price in range.</strong> No ${name} price we tried makes a rotation with ${name} match what you grow now ${when}.`;
  if (!met.length) {
    return `<strong>Not yet.</strong> At ${text}, ${name} still ${verbFor(cropName, 'earns', 'earn')} less than what you grow now ${when}. `
      + `${verbFor(cropName, 'It starts', 'They start')} to match at ${dollarsText(first.price)}.`;
  }
  const withPrice = breaks.filter((entry) => entry.price !== null);
  if (met.length < withPrice.length) {
    const next = withPrice[met.length];
    return `<strong>Partly.</strong> At ${text}, “${escapeHtml(rotationName(model.app, met.at(-1).id))}” matches what you grow now ${when}. `
      + `“${escapeHtml(rotationName(model.app, next.id))}” needs ${dollarsText(next.price)}.`;
  }
  const one = withPrice.length === 1;
  return `<strong>Yes.</strong> At ${text}, ${one ? `the ${name} rotation matches` : `every ${name} rotation matches`} what you grow now ${when}, or beats it.`
    + (one ? ` Below ${dollarsText(first.price)} it would not.` : '');
}

function placeOnRail(percent) {
  const low = PRICE_RANGE.low * 100;
  const high = PRICE_RANGE.high * 100;
  return `${Math.min(100, Math.max(0, (percent - low) / (high - low) * 100)).toFixed(2)}%`;
}

function renderPriceLine(current, model) {
  const { els } = current;
  const shown = Boolean(model?.canTry);
  els.priceline.hidden = !shown;
  if (!shown) return;
  const { today, whatIf, cropName, app, prices } = model;
  const name = lowerName(cropName);
  const one = name.replace(/s$/, '');
  const unit = UNIT_WORDS[today.unit] ?? `a ${today.unit}`;
  const breaks = breakEvens(model);
  const first = breaks.find((entry) => entry.price !== null);

  els.priceq.textContent = `What ${one} price would change the answer?`;
  els.pricefig.textContent = first ? dollarsText(first.price) : 'No price';
  els.priceunit.textContent = first ? unit : 'in the range we tried';
  els.pricea.textContent = first
    ? breakEvenPriceSentence(cropName, first.price, today.nominal, today.unit)
    : `Today ${name} ${verbFor(cropName, 'sells', 'sell')} for ${dollarsText(today.nominal)}.`;

  const usesToday = prices === 'today';
  els.try.hidden = !usesToday;
  els.priceoff.hidden = usesToday;
  const at = priceAtPercent(today.nominal, whatIf.pricePercent);
  els.pricelabel.textContent = `Try a ${one} price, ${unit}`;
  els.price.value = String(whatIf.pricePercent);
  els.priceout.textContent = dollarsText(at);
  const gap = Math.abs(whatIf.pricePercent - PRICE_PERCENT_TODAY);
  const spoken = UNIT_SPOKEN[today.unit] ?? '';
  els.price.setAttribute('aria-valuetext', whatIf.pricePercent === PRICE_PERCENT_TODAY
    ? `${dollarsText(at)} ${spoken}, today's price`
    : `${dollarsText(at)} ${spoken}, ${gap}% ${whatIf.pricePercent > PRICE_PERCENT_TODAY ? 'above' : 'below'} today's price`);
  const percentOf = (value) => value / today.nominal * 100;
  els.ticksdown.innerHTML = `<span class="tick" style="left:${placeOnRail(100)}"><b>${dollarsText(today.nominal)}</b>today</span>`;
  els.ticksup.innerHTML = breaks.filter((entry) => entry.price !== null)
    .map((entry) => `<span class="tick" style="left:${placeOnRail(percentOf(entry.price))}"><b>${dollarsText(entry.price)}</b></span>`).join('');
  els.zonefill.hidden = !first;
  if (first) els.zonefill.style.left = placeOnRail(percentOf(first.price));
  els.zonekeyline.hidden = !first;
  els.zonekey.textContent = `Green line: ${name} ${verbFor(cropName, 'matches', 'match')} what you grow now, or ${verbFor(cropName, 'beats', 'beat')} it.`;
  els.say.innerHTML = priceAnswer(model, breaks, at);
  els.reset.hidden = whatIf.pricePercent === PRICE_PERCENT_TODAY && whatIf.yieldPercent === 0;

  els.yieldlabel.textContent = `Your ${name} harvest next to the average`;
  els.yield.value = String(whatIf.yieldPercent);
  els.yield.setAttribute('aria-valuetext', yieldValueText(whatIf.yieldPercent));
  els.yieldout.textContent = whatIf.yieldPercent === 0 ? 'Same as average' : signedPercent(whatIf.yieldPercent);
  els.standing.textContent = standingText(model);
  els.pricesrc.textContent = priceSourceSentence(app.prices_today_span, today.source, cropName);
}

function standingText(model) {
  const { app, ranking, plan, priority } = model;
  const { lead, years } = leadOverNow(model, plan.option.option_id);
  return standingSentence({
    moved: model.moved,
    label: rotationName(app, plan.option.option_id),
    position: rankPosition(ranking, plan.option.option_id),
    total: ranking.ranked.length,
    lead,
    years,
    priority,
  });
}

/* ---------- your rotation ---------- */

function rotationRowHtml(model, row, title, years) {
  const { app, code } = model;
  const chips = rotationYears(row.crops, years).map((cropCode, year) => {
    const chip = chipFor(cropCode, app.crops);
    const chosen = chip.code === code ? ' chosen' : '';
    return `<li class="chip chip-${chip.kind}${chosen}"><span class="visually-hidden">Year ${year + 1}: </span>${escapeHtml(chip.label)}</li>`;
  });
  return `<div class="rotrow">
    <p class="rot-tag">${escapeHtml(title)}</p>
    <h3 class="rot-name">${escapeHtml(rotationName(app, row.option_id))}</h3>
    <ol class="rotyears">${chips.join('')}</ol>
  </div>`;
}

function renderRotation(current, model) {
  const { els } = current;
  const now = model?.ranking.ranked.find((row) => row.option_id === model.ranking.current_option);
  els.rotation.hidden = !now;
  if (!now) return;
  const other = model.plan.mode === 'option'
    ? model.ranking.ranked.find((row) => row.option_id === model.plan.option.option_id) : null;
  const years = rotationYearsShown(now.crops, other?.crops);
  els.rotationq.textContent = `Your rotation, ${years} years`;
  const rows = [rotationRowHtml(model, now, 'What you grow now', years)];
  if (other) rows.push(rotationRowHtml(model, other, `With ${lowerName(model.cropName)}`, years));
  els.rotrows.innerHTML = rows.join('');
  els.rotnote.textContent = 'Each box is one year.';
}

/* ---------- where the numbers come from ---------- */

function countsHotDryYearsMore(app) {
  const weights = Object.values(app.climate_weights ?? {});
  return weights.some((weight) => Math.abs(weight - weights[0]) > 1e-9);
}

function shortRecordNotes(model) {
  const { app, ranking, factor } = model;
  const nowId = ranking.current_option;
  const notes = [];
  for (const row of ranking.ranked) {
    const shared = row.option_id === nowId ? null : sharedRecord(app, [row.option_id, nowId], model.prices);
    if (!shared?.years) continue;
    const now = rank(shared.app, rankingOptions(model)).ranked.find((entry) => entry.option_id === nowId);
    notes.push(shortRecordNote({ name: rotationName(app, row.option_id), years: shared.years, now, factor }));
  }
  return notes;
}

function tableNotes(model) {
  const { app, ranking, fieldConfig } = model;
  const now = app.options[app.current_option];
  const notes = [`Today's prices are USDA's ${app.prices_today_span} averages.`, shiftNote(model)];
  if (now) {
    notes.push(currentRotationNote(rotationName(app, app.current_option), state.answers.rotation, rotationFromCrops(now.crops)));
  }
  if (isIrrigated()) notes.push('These rotations are dryland. Your field is irrigated, so the numbers may not fit it.');
  if (model.priority === 'soil') notes.push(SOIL_POINTS_NOTE);
  notes.push(...shortRecordNotes(model));
  if (countsHotDryYearsMore(app)) {
    notes.push(`In the dry-year column, hot, dry years (${yearList(app.hot_dry_years)}) count a little more, `
      + 'because they came more often in the later half of the record. Source: NASA POWER.');
  }
  const leftOut = leftOutLabels(app, ranking);
  if (leftOut.length) notes.push(`Left out, because a harvest or price record is missing: ${wordList(leftOut)}.`);
  notes.push(...(fieldConfig.gaps ?? []));
  return notes.filter(Boolean);
}

function cellHtml(value, factor) {
  const dollars = shownDollars(value, factor);
  if (dollars === null) return '<td>no data</td>';
  return `<td>${money(dollars)}${dollars < 0 ? '<span class="visually-hidden">, a loss</span>' : ''}</td>`;
}

function renderSources(current, model) {
  const { els } = current;
  els.srcline.hidden = !model;
  if (!model) return;
  const { app, ranking, factor, prices, fieldConfig } = model;
  const [first, last] = [app.years[0], app.years.at(-1)];
  const pricesWords = prices === 'today' ? 'at today\'s prices' : 'each at its own year\'s price';
  els.srcfig.textContent = `${last - first + 1} years of harvests`;
  els.srca.textContent = `Harvests from ${yearSpan(first, last)}, ${pricesWords}.`;
  const rows = ranking.ranked.map((row) => {
    const now = row.option_id === ranking.current_option ? ' (you grow this now)' : '';
    const short = row.full_record ? '' : `<br><span class="dim">${yearSpan(...row.years)} only</span>`;
    return `<tr><th scope="row">${escapeHtml(rotationName(app, row.option_id))}${now}${short}</th>
      ${cellHtml(row.typical, factor)}${cellHtml(row.bad_year_climate, factor)}${cellHtml(row.worst, factor)}</tr>`;
  }).join('');
  els.table.innerHTML = `<caption>Dollars an acre, a year, in today's dollars, after seed, fertilizer, fuel and other yearly
      costs, ${pricesWords}. Land and machinery payments are not counted. A dry year is the 1 year in 5 at the low end.
      Costs: ${escapeHtml(fieldConfig.cost_source)}, adjusted for inflation.</caption>
    <thead><tr><th scope="col">Rotation</th><th scope="col">Normal year</th><th scope="col">Dry year <span class="nowrap">(1 in 5)</span></th><th scope="col">Worst year</th></tr></thead>
    <tbody>${rows}</tbody>`;
  els.tablenotes.innerHTML = tableNotes(model).map((note) => `<li>${escapeHtml(note)}</li>`).join('');
  const shownOptions = ranking.ranked.map((row) => row.option_id);
  els.sources.innerHTML = `<dl class="sources">${cropSources(app, shownOptions).map((entry) => `
      <dt>${escapeHtml(entry.name)}</dt>
      <dd><b>Cost.</b> ${escapeHtml(entry.cost || 'No source given.')}</dd>
      <dd><b>Harvests.</b> ${escapeHtml(entry.harvest || 'No source given.')}</dd>`).join('')}</dl>`;
}

/* ---------- the smallest safe test ---------- */

function testNumbersHtml(amounts, cropName, baselineName) {
  const name = lowerName(cropName);
  const baseline = lowerName(baselineName);
  const gains = amounts.typical < 0 || amounts.bad < 0;
  const stat = (value) => (gains ? (value < 0 ? '+' : '−') : '') + money(Math.abs(value));
  const fails = `if the ${name} ${verbFor(cropName, 'fails', 'fail')}`;
  const word = (value, when) => {
    if (!gains) return when;
    return value < 0 ? `more than ${baseline}, ${when}` : `given up ${when}`;
  };
  const items = [
    [amounts.typical, word(amounts.typical, 'in a normal year')],
    [amounts.bad, word(amounts.bad, 'in a dry year')],
    [amounts.fail, gains ? `given up ${fails}` : fails],
  ];
  return `<ul class="teststats">${items.map(([value, words]) => `<li><strong>${stat(value)}</strong><span>${escapeHtml(words)}</span></li>`).join('')}</ul>`;
}

function renderTest(current, model, check) {
  const { els } = current;
  const shown = Boolean(model?.canTry) && check?.cls !== 'red';
  els.test.hidden = !shown;
  if (!shown) return;
  const { app, fieldConfig, code, factor, overrides, cropName } = model;
  const name = lowerName(cropName);
  const baselineName = app.crops[fieldConfig.baseline_crop]?.name;
  current.testNames = baselineName ? { crop: cropName, baseline: baselineName } : null;
  if (!baselineName) {
    els.testh.textContent = `${TEST_ACRES} acres of ${name}.`;
    els.testbody.innerHTML = '<p class="test-sub">We have no crop to compare the test against for this area, so no cost is shown.</p>';
    return;
  }
  const baseline = lowerName(baselineName);
  const acres = state.field.props?.ac;
  els.testh.textContent = `${TEST_ACRES} acres of ${name} next to ${TEST_ACRES} acres of ${baseline}.`;
  els.keycrop.textContent = cropName;
  els.keybase.textContent = baselineName;
  els.keytotal.textContent = Number.isFinite(acres)
    ? `${TEST_ACRES * 2} of your ${count(acres)} acres. You choose where they go.`
    : `${TEST_ACRES * 2} acres in all. You choose where they go.`;
  const share = Number.isFinite(acres) && acres > 0 ? `${(TEST_ACRES / acres * 100).toFixed(2)}%` : '0';
  els.acrecrop.style.width = share;
  els.acrebase.style.width = share;
  els.acrebar.setAttribute('aria-label', `A line for your whole field. Two short marks at one end are the test: `
    + `${TEST_ACRES} acres of ${name} and ${TEST_ACRES} acres of ${baseline}.`);

  const cost = shiftedTestCost(app, code, fieldConfig.baseline_crop, overrides, model.weatherShift);
  const amounts = testDollars(cost, factor);
  if (!amounts) {
    els.testbody.innerHTML = '<p class="test-sub">The harvest or price record for this pair of crops is missing, so we can\'t say what the test costs.</p>';
    return;
  }
  const gains = amounts.typical < 0 || amounts.bad < 0;
  const atPrice = code in overrides.priceOverride ? 'at the price you set' : 'at today\'s prices';
  const paper = stateAverageCodes(app, model.plan.option.option_id).includes(code);
  const sub = gains
    ? `What the test changes, next to ${escapeHtml(baseline)} on those ${TEST_ACRES} acres, ${atPrice}.`
      + (paper ? `<span class="test-paper">On paper only: ${escapeHtml(name)} harvests are Washington averages, not local ones.</span>` : '')
    : `Most you could lose on the ${TEST_ACRES} acres, compared with ${escapeHtml(baseline)}`
      + `${code in overrides.priceOverride ? ', at the price you set' : ''}:`;
  const restsNow = app.options[app.current_option]?.crops.includes(REST_CODE);
  const rest = restsNow && fieldConfig.baseline_crop !== REST_CODE && app.crops[REST_CODE]
    ? restTestSentence({ cost: shiftedTestCost(app, code, REST_CODE, overrides, model.weatherShift), factor, cropName }) : null;
  const math = (gains
    ? `Each number is what ${TEST_ACRES} acres of ${name} earn, less what ${TEST_ACRES} acres of ${baseline} earn, in the same year`
    : `Each number is what ${TEST_ACRES} acres of ${baseline} earn, less what ${TEST_ACRES} acres of ${name} earn, in the same year`)
    + `, from the ${yearSpan(...cost.years)} harvests, in today's dollars. `
    + `If the ${name} ${verbFor(cropName, 'fails', 'fail')}, ${verbFor(cropName, 'it is', 'they are')} sown and ${verbFor(cropName, 'brings', 'bring')} in nothing. `
    + `Costs: ${fieldConfig.cost_source}.`;
  els.testbody.innerHTML = `<p class="test-sub">${sub}</p>
    ${testNumbersHtml(amounts, cropName, baselineName)}
    ${shiftNote(model) ? `<p class="test-sub test-shift">${escapeHtml(shiftNote(model))}</p>` : ''}
    <details class="quiet">
      <summary>Show the math ${CHEV}</summary>
      <div class="quiet-body"><p>${escapeHtml(math)}</p>${rest ? `<p>${escapeHtml(rest)}</p>` : ''}</div>
    </details>`;
}

function stateAverageCodes(app, optionId) {
  return app.options?.[optionId]?.yield_basis?.state_average ?? [];
}

/* ---------- what the field went through ---------- */

/* The rain bar runs from no rain to SEASON_SCALE times normal; the line marks normal. */
const SEASON_SCALE = 1.5;

/* "13% below" / "9% above" / "usual": the short label by the rain bar. */
function rainShort(row) {
  if (Math.abs(row.rainVsNormalPct) < USUAL.rainPct) return 'usual';
  const pct = Math.round(row.rainVsNormalPct);
  return `${Math.abs(pct)}% ${pct < 0 ? 'below' : 'above'}`;
}

/* One season as a picture: year, crop or rest, spring rain against normal. Hidden from screen
   readers: the table next to it says the same in full. */
function seasonRowHtml(row, showField) {
  const share = Math.max(0, 1 + row.rainVsNormalPct / 100);
  const width = Math.min(100, share / SEASON_SCALE * 100).toFixed(1);
  const field = fieldWords(row);
  const chip = showField
    ? `<span class="season-chip${row.growing ? '' : ' is-rest'}">${escapeHtml(field ?? 'no record')}</span>` : '';
  const tag = row.dry ? 'hot, dry year' : row.heatVsNormalC >= USUAL.heatC ? 'hot summer' : '';
  return `<li class="season-row">
      <span class="season-year">${row.year}</span>${chip}
      <span class="season-rain"><span class="season-track"><i style="width:${width}%"></i>`
    + `<b style="left:${(100 / SEASON_SCALE).toFixed(1)}%"></b></span>`
    + `<span class="season-pct${row.rainVsNormalPct <= -USUAL.rainPct ? ' is-dry' : ''}">${escapeHtml(rainShort(row))}</span></span>
      ${tag ? `<span class="season-tag">${tag}</span>` : ''}
    </li>`;
}

function renderSeasons(current) {
  const { els } = current;
  const { app, fieldConfig } = current.data ?? {};
  const record = state.field ? satelliteRecordFor(state.field) : null;
  const rows = app ? lastSeasons(app, record) : [];
  els.seasons.hidden = !rows.length;
  if (!rows.length) return;
  const showField = rows.some((row) => row.growing !== null);
  els.seasonsbig.textContent = yearSpan(rows[0].year, rows.at(-1).year);
  els.seasonssay.textContent = seasonsSummary(rows);
  els.seasonrows.innerHTML = rows.map((row) => seasonRowHtml(row, showField)).join('');
  els.seasonkey.innerHTML = `<i></i>Line: normal spring rain, the ${yearSpan(app.weather[0].year, app.weather.at(-1).year)} average`;
  els.seasonstable.innerHTML = `
    <caption>Each season next to this place's normal (the ${yearSpan(app.weather[0].year, app.weather.at(-1).year)} average).</caption>
    <thead><tr><th scope="col">Season</th>${showField ? '<th scope="col">Field, seen from space</th>' : ''}<th scope="col">Spring rain</th><th scope="col">Summer heat</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><th scope="row">${row.year}${row.dry ? ' <span class="dim">a hot, dry year</span>' : ''}</th>${
      showField ? `<td>${escapeHtml(fieldWords(row) ?? 'no record')}</td>` : ''}<td>${escapeHtml(rainWords(row))}</td><td>${escapeHtml(heatWords(row))}</td></tr>`).join('')}</tbody>`;
  const ownSample = state.field?.sampleId === fieldConfig?.id;
  const place = fieldConfig?.town ? `the ${fieldConfig.town} sample farm` : 'the sample farm';
  const heatLabel = app.hot_dry_signal?.heat_label ?? 'the June and July high';
  const lines = [
    `Weather: NASA POWER (MERRA-2) for the grid square around ${place}${ownSample ? '' : ', not this field’s own'}. Summer heat is ${heatLabel}.`,
    showField
      ? 'Field: NASA HLS satellite greenness (Landsat and Sentinel-2): a crop when the field turned green that season, rest when it did not.'
      : 'No satellite record of this field’s crops yet.',
    `${rows.at(-1).year + 1} is not in the record yet.`,
  ];
  els.seasonssrc.textContent = lines.join(' ');
}

/* ---------- the weather what-if ---------- */

function shiftWords(shift) {
  const rain = shift.rainPct === 0 ? 'usual rain' : `${Math.abs(shift.rainPct)}% ${shift.rainPct < 0 ? 'less' : 'more'} spring rain`;
  const heat = shift.heatC === 0 ? 'usual heat' : `summers ${fahrenheitChange(shift.heatC)} hotter`;
  return `${rain}, ${heat}`;
}

/* Under every money figure while a weather shift is on, so no shifted number goes unlabelled.
   '' with no shift. */
function shiftNote(model) {
  const shift = model?.weatherShift;
  if (!shift || (shift.rainPct === 0 && shift.heatC === 0)) return '';
  const words = shiftWords(shift);
  return `Weather what-if on (${words}): the real years that look like that count more. Normal and dry years are for that weather.`;
}

function renderWeatherWhatIf(current, model) {
  const { els } = current;
  els.wxline.hidden = !model;
  if (!model) return null;
  const shift = model.weatherShift;
  els.rain.value = String(shift.rainPct);
  els.heat.value = String(shift.heatC);
  els.rainout.textContent = shift.rainPct === 0 ? 'As usual' : signedPercent(shift.rainPct);
  els.heatout.textContent = shift.heatC === 0 ? 'As usual' : `+${fahrenheitChange(shift.heatC)}`;
  els.rain.setAttribute('aria-valuetext', els.rainout.textContent);
  els.heat.setAttribute('aria-valuetext', els.heatout.textContent);
  els.wxreset.hidden = shift.rainPct === 0 && shift.heatC === 0;
  els.wxnote.textContent = rainNoteFor(current, model);
  els.wxresult.textContent = weatherResult(model);
  const { app } = model;
  const weights = scenarioWeights(app, shift.rainPct, shift.heatC);
  if (!weights) {
    els.wxsay.textContent = `Using the weather of ${yearSpan(app.years[0], app.years.at(-1))} as it was.`;
    return els.wxsay.textContent;
  }
  const evidence = shiftEvidence(weights, app.years);
  const parts = [];
  if (evidence.evidenceYears < WEATHER_SHIFT.minEvidenceYears) {
    parts.push(`Beyond what ${app.years.length} years have shown: treat this as a guess.`);
  }
  parts.push(`This leans most on ${yearList(evidence.leansOn)}: about ${(Math.round(evidence.evidenceYears * 10) / 10).toFixed(1)} years’ worth of evidence out of ${app.years.length}.`);
  els.wxsay.textContent = parts.join(' ');
  return els.wxsay.textContent;
}

/* The honest line by the rain slider, from NASA's climate-model file. */
function rainNoteFor(current, model) {
  const { fieldConfig } = model;
  const ownSample = state.field?.sampleId === fieldConfig.id;
  const place = ownSample || !fieldConfig.town ? 'here' : `around the ${fieldConfig.town.replace(/,.*$/, '')} sample farm`;
  return rainOutlookNote(current.data.futureRain, fieldConfig.id, place);
}

/* The live line under the sliders: the panel's own ranking, and the checked crop's break-even. */
function weatherResult(model) {
  const shift = model.weatherShift;
  const shifted = shift.rainPct !== 0 || shift.heatC !== 0;
  const untouchedTopId = shifted
    ? rank(model.app, { ...rankingOptions(model), weatherShift: NO_SHIFT }).ranked[0]?.option_id ?? null : null;
  let breakEven = null;
  if (model.canTry) {
    const first = breakEvens(model).find((entry) => entry.price !== null);
    breakEven = { price: first ? first.price : null, unit: model.today.unit };
  }
  return weatherResultLine({ ranking: model.ranking, shifted, untouchedTopId, cropName: model.cropName, breakEven });
}

function onWeatherInput(current) {
  const shift = current.weatherShift;
  if (!shift) return;
  shift.rainPct = Number(current.els.rain.value);
  shift.heatC = Number(current.els.heat.value);
  saveWeatherShift(shift);
  // The line under the sliders is a polite live region: it says the new result.
  render(current);
}

function onWeatherReset(current) {
  const shift = current.weatherShift;
  if (!shift) return;
  Object.assign(shift, NO_SHIFT);
  saveWeatherShift(shift);
  render(current);
  current.els.rain.focus();
}

/* ---------- drawing it all ---------- */

function render(current) {
  renderField(current);
  if (!current.data?.needs) return null;
  const { picks } = currentPicks(current);
  const crop = chosenCrop(current);
  renderCropButtons(current, picks);
  renderWeatherNotice(current);
  const check = cropCheck(current, crop);
  const model = moneyModel(current, crop.name);
  let answer = null;
  let compare = null;
  if (picks.length > 1) {
    compare = renderCompare(current, picks, model);
  } else {
    leaveCompare(current);
    answer = renderBanner(current, crop, check, model);
    renderMoney(current, model);
  }
  current.comparing = picks.length > 1;
  renderSeasons(current);
  renderPriceLine(current, model);
  const weatherSay = renderWeatherWhatIf(current, model);
  renderGrow(current, crop, check);
  renderRotation(current, model);
  renderSources(current, model);
  renderTest(current, model, check);
  fitSoon(current);
  return { crop, model, answer, compare, weatherSay };
}

function cropAnnouncement({ crop, answer, model }) {
  const first = model ? answerFirst({ ...model, checked: checkedFacts(model) }) : '';
  if (!answer) return `${crop.name}. ${first}`.trim();
  return [answer.lead, first].filter(Boolean).join(' ');
}

/* ---------- reacting ---------- */

function snapshot() {
  const picks = Array.isArray(state.answers.picks) ? state.answers.picks.join('|') : '';
  return { crop: state.answers.crop, priceView: state.priceView, picks };
}

function onStateChange(current) {
  if (view !== current || !state.field) return;
  if (fieldKey(state.field) !== current.fieldKey) {
    const { container } = current;
    unmount();
    mount(container);
    return;
  }
  const before = current.shown;
  const wasComparing = current.comparing;
  current.shown = snapshot();
  const result = render(current);
  if (!result) return;
  if (before.picks !== current.shown.picks) fadeRows(current);
  // Comparing, the answer on the field speaks for itself (aria-live) once it is there.
  if (result.compare) {
    if (!wasComparing) announceSoon(current, result.compare);
    return;
  }
  // The answer box speaks for itself (aria-live); a new crop also says the crop's own answer.
  if (before.crop !== current.shown.crop || wasComparing) announceSoon(current, result.answer?.lead ?? `${result.crop.name}.`);
}

/* A short fade on the rows when the picks change, so the change reads as one step (none with reduced motion: see plan.css). */
function fadeRows(current) {
  const { bars } = current.els;
  bars.classList.remove('fading');
  void bars.offsetWidth; // restart the animation
  bars.classList.add('fading');
}

function onSliderInput(current) {
  const { els, whatIf } = current;
  if (!whatIf) return;
  whatIf.pricePercent = Number(els.price.value);
  whatIf.yieldPercent = Number(els.yield.value);
  saveWhatIf(whatIf);
  render(current);
}

function onReset(current) {
  if (!current.whatIf) return;
  current.whatIf = freshWhatIf(current.whatIf.key);
  saveWhatIf(current.whatIf);
  render(current);
  current.els.price.focus();
}

function wireEvents(current) {
  const { els } = current;
  els.quick.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-crop]');
    if (!button || !current.data?.needs) return;
    const name = button.dataset.crop;
    const before = [...els.quick.querySelectorAll('button[data-crop]')].map((chip) => chip.dataset.crop);
    togglePickFor(current, name);
    const after = [...els.quick.querySelectorAll('button[data-crop]')].map((chip) => chip.dataset.crop);
    const target = chipFocusAfter(before, name, after);
    const chip = target ? els.quick.querySelector(`button[data-crop="${CSS.escape(target)}"]`) : null;
    (chip ?? els.morebtn).focus();
  });
  els.morebtn.addEventListener('click', () => setMoreOpen(current, els.more.hidden));
  els.moredone.addEventListener('click', () => {
    setMoreOpen(current, false);
    els.morebtn.focus();
  });
  els.more.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setMoreOpen(current, false);
    els.morebtn.focus();
  });
  els.morelist.addEventListener('change', (event) => {
    const box = event.target.closest('input[type="checkbox"]');
    if (!box || !current.data?.needs) return;
    if (!togglePickFor(current, box.value)) box.checked = !box.checked;
  });
  els.crop.addEventListener('input', () => filterCropList(current));
  els.crop.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = [...els.morelist.querySelectorAll('.more-item:not([hidden]) input:not([aria-disabled="true"])')]
      .find((box) => !box.closest('[hidden]'));
    if (first) togglePickFor(current, first.value);
  });
  els.bars.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-test-crop]');
    if (!button) return;
    state.update({ answers: { crop: button.dataset.testCrop } });
    if (els.test.hidden) return;
    els.test.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    els.test.focus({ preventScroll: true });
  });
  els.priceview.addEventListener('change', (event) => {
    if (event.target.name === 'plan-prices') state.update({ priceView: event.target.value });
  });
  els.allrows.addEventListener('click', () => {
    current.showAll = !current.showAll;
    render(current);
    announceSoon(current, current.showAll ? 'All rotations are shown.' : 'Fewer rotations are shown.');
  });
  els.price.addEventListener('input', () => onSliderInput(current));
  els.yield.addEventListener('input', () => onSliderInput(current));
  els.reset.addEventListener('click', () => onReset(current));
  els.rain.addEventListener('input', () => onWeatherInput(current));
  els.heat.addEventListener('input', () => onWeatherInput(current));
  els.wxreset.addEventListener('click', () => onWeatherReset(current));
  els.retry.addEventListener('click', () => window.location.reload());
  els.totest.addEventListener('click', (event) => {
    event.preventDefault();
    if (current.testCrop) state.update({ answers: { crop: current.testCrop } });
    if (els.test.hidden) return;
    els.test.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    els.test.focus({ preventScroll: true });
  });
}

/* ---------- the maps: pictures of the field ---------- */

const mercX = (lon) => (lon + 180) / 360;
function mercY(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
const unMercY = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/* The camera that fits a box of ground into the part of the picture left free by `room`. */
function cameraFor(box, [west, south, east, north], room, maxZoom) {
  const width = box.clientWidth;
  const height = box.clientHeight;
  const freeW = Math.max(120, width - room.left - room.right);
  const freeH = Math.max(120, height - room.top - room.bottom);
  const spanX = mercX(east) - mercX(west);
  const spanY = mercY(south) - mercY(north);
  const fit = Math.min(spanX > 0 ? freeW / (spanX * 512) : Infinity, spanY > 0 ? freeH / (spanY * 512) : Infinity);
  const zoom = Math.max(MAP_MIN_ZOOM, Math.min(maxZoom, Number.isFinite(fit) ? Math.log2(fit) : maxZoom));
  const world = 512 * 2 ** zoom;
  const offX = room.left + freeW / 2 - width / 2;
  const offY = room.top + freeH / 2 - height / 2;
  const x = (mercX(west) + mercX(east)) / 2 - offX / world;
  const y = (mercY(north) + mercY(south)) / 2 - offY / world;
  return { center: [x * 360 - 180, unMercY(y)], zoom, padding: NO_PADDING };
}

function fieldBounds(current) {
  const pin = state.field.pin;
  return geometryBounds(current.geometry) ?? [pin[0] - 0.006, pin[1] - 0.004, pin[0] + 0.006, pin[1] + 0.004];
}

function textRight(...elements) {
  return Math.max(...elements.filter((el) => el && !el.hidden).map((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().right;
  }));
}

function fitFirst(current) {
  const { map, els } = current;
  if (!map) return;
  const section = els.first.getBoundingClientRect();
  const words = els.banner.getBoundingClientRect();
  const top = els.topleft.getBoundingClientRect().bottom - section.top + 26;
  const stacked = window.matchMedia(STACKED).matches;
  els.photo1.style.height = stacked ? `${Math.round(els.sub.getBoundingClientRect().bottom - section.top + 110)}px` : '';
  map.resize();
  const box = els.map;
  const bounds = fieldBounds(current);
  let rooms;
  if (stacked) {
    rooms = [{ top: top - 6, right: 26, bottom: box.clientHeight - (words.top - section.top) + 26, left: 26 }];
  } else {
    const under = box.clientHeight - section.height;
    const panel = section.right - els.dock.getBoundingClientRect().left + 40;
    const wordsRight = textRight(els.h1, els.sub, els.totest) - section.left;
    rooms = [
      { top, right: panel, bottom: under + 70, left: wordsRight + 48 },
      { top, right: panel, bottom: box.clientHeight - (words.top - section.top) + 30, left: 48 },
    ];
  }
  const camera = rooms.map((room) => cameraFor(box, bounds, room, 14.4))
    .reduce((best, next) => (next.zoom > best.zoom ? next : best));
  map.jumpTo(camera);
}

function fitTest(current) {
  const { map2, els } = current;
  if (!map2 || els.test.hidden) return;
  map2.resize();
  const section = els.test.getBoundingClientRect();
  const room = window.matchMedia(STACKED).matches
    ? { top: 44, right: 30, bottom: 64, left: 30 }
    : { top: 120, right: 96, bottom: 120, left: els.testin.getBoundingClientRect().right - section.left + 110 };
  map2.jumpTo(cameraFor(els.map2, fieldBounds(current), room, 14.6));
}

/* The panel scrolls inside only when the screen is too short for it. Then the keyboard can reach it. */
function markScroll(current) {
  const body = current.els.dockbody;
  const scrolls = body.scrollHeight > body.clientHeight + 1;
  body.classList.toggle('scrolls', scrolls);
  if (scrolls) {
    body.tabIndex = 0;
    body.setAttribute('role', 'group');
    body.setAttribute('aria-label', 'Rotations compared. Scroll for more.');
  } else {
    body.removeAttribute('tabindex');
    body.removeAttribute('role');
    body.removeAttribute('aria-label');
  }
}

function setStripTags(current) {
  const names = current.testNames;
  if (!names || !current.tags.length) return;
  const phone = window.matchMedia(PHONE).matches;
  current.tags[0].textContent = phone ? names.crop : `${TEST_ACRES} acres of ${lowerName(names.crop)}`;
  current.tags[1].textContent = phone ? names.baseline : `${TEST_ACRES} acres of ${lowerName(names.baseline)}`;
  current.map2?.getCanvas().setAttribute('aria-label', `Aerial photo of your field, outlined. Two small strips show the `
    + `${TEST_ACRES}-acre test drawn to size: ${lowerName(names.crop)} on the left, ${lowerName(names.baseline)} on the right.`);
}

/* The cameras are set once, when the maps and the first answer are in, and again only when the
   window is resized (a new field mounts the screen afresh). Picking crops or opening "More crops"
   never moves the pictures. */
function fitSoon(current, reframe = false) {
  window.clearTimeout(current.fitTimer);
  current.fitTimer = window.setTimeout(() => {
    if (view !== current || !state.field) return; // the field was cleared while the screen was open
    markScroll(current);
    const ready = current.mapsReady && Boolean(current.data && (current.data.weather || !current.data.needs));
    if (ready && (reframe || !current.framed)) {
      current.framed = true;
      fitFirst(current);
      fitTest(current);
    }
    setStripTags(current);
  }, 60);
}

/* Two strips of 12 acres each (100 m by 485.6 m), side by side, as close to the pin as they fit.
   Null when no place within 700 m fits: the acre bar then carries the size on its own. */
function placeStrips(pin, geometry) {
  if (!geometry) return null;
  const [lon, lat] = pin;
  const mLat = 1 / 111320;
  const mLon = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const W = 100;
  const H = TEST_ACRES * 4046.86 / W;
  const spots = [];
  for (let dx = -700; dx <= 700; dx += 50) for (let dy = -700; dy <= 700; dy += 50) spots.push([dx, dy]);
  spots.sort((a, b) => Math.hypot(a[0] + 220, a[1]) - Math.hypot(b[0] + 220, b[1]));
  for (const [dx, dy] of spots) {
    if (Math.abs(dx) < W + 110 && Math.abs(dy) < H / 2 + 60) continue;
    const x0 = lon + (dx - W) * mLon;
    const y0 = lat + (dy - H / 2) * mLat;
    const points = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 10; j++) points.push([x0 + i * 0.5 * W * mLon, y0 + j * 0.1 * H * mLat]);
    if (!points.every((point) => pointInGeometry(point, geometry))) continue;
    const rect = (west) => ({ type: 'Polygon', coordinates: [[[west, y0], [west + W * mLon, y0], [west + W * mLon, y0 + H * mLat], [west, y0 + H * mLat], [west, y0]]] });
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { part: 'crop' }, geometry: rect(x0) },
        { type: 'Feature', properties: { part: 'base' }, geometry: rect(x0 + W * mLon) },
      ],
    };
  }
  return null;
}

function maskAround(geometry) {
  const [west, south, east, north] = geometryBounds(geometry);
  const box = [[west - 3, south - 2], [east + 3, south - 2], [east + 3, north + 2], [west - 3, north + 2], [west - 3, south - 2]];
  const holes = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((rings) => rings[0]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [box, ...holes] } };
}

function hatchImage() {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data.set((x + y) % 8 < 3 ? [159, 211, 107, 255] : [15, 36, 9, 240], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

function makeMap(container, name) {
  const map = createMap(container, {
    name, center: state.field.pin, zoom: 13, interactive: false, attributionControl: false,
  });
  if (!map) return null;
  const canvas = map.getCanvas();
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('tabindex', '-1');
  canvas.setAttribute('aria-label', 'Aerial photo of your field, outlined, with a pin on it.');
  return map;
}

function drawField(map, geometry, neighbors) {
  if (neighbors.length) {
    map.addSource('near', { type: 'geojson', data: { type: 'FeatureCollection', features: neighbors } });
    map.addLayer({ id: 'near-line', type: 'line', source: 'near', paint: { 'line-color': '#fff', 'line-opacity': 0.75, 'line-width': 1.2 } });
  }
  if (!geometry) return;
  const outline = { type: 'Feature', properties: {}, geometry };
  map.addSource('mask', { type: 'geojson', data: maskAround(geometry) });
  map.addLayer({ id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#000', 'fill-opacity': 0.28 } });
  map.addSource('picked', { type: 'geojson', data: outline });
  map.addLayer({ id: 'picked-fill', type: 'fill', source: 'picked', paint: { 'fill-color': HONEY, 'fill-opacity': 0.07 } });
  map.addLayer({ id: 'picked-case', type: 'line', source: 'picked', layout: { 'line-join': 'round' }, paint: { 'line-color': '#1c140a', 'line-width': 7.5, 'line-opacity': 0.7 } });
  map.addLayer({ id: 'picked-line', type: 'line', source: 'picked', layout: { 'line-join': 'round' }, paint: { 'line-color': HONEY, 'line-width': 3.5 } });
}

function drawStrips(current, strips) {
  const map = current.map2;
  map.addImage('hatch', hatchImage(), { pixelRatio: 2 });
  map.addSource('test', { type: 'geojson', data: strips });
  map.addLayer({ id: 'test-crop', type: 'fill', source: 'test', filter: ['==', ['get', 'part'], 'crop'], paint: { 'fill-pattern': 'hatch' } });
  map.addLayer({ id: 'test-base', type: 'fill', source: 'test', filter: ['==', ['get', 'part'], 'base'], paint: { 'fill-color': '#fff', 'fill-opacity': 0.96 } });
  map.addLayer({ id: 'test-line', type: 'line', source: 'test', paint: { 'line-color': '#fff', 'line-width': 1.5 } });
  const [cropRing, baseRing] = strips.features.map((feature) => feature.geometry.coordinates[0]);
  const mid = (cropRing[0][1] + cropRing[2][1]) / 2;
  for (const [lon, anchor, offset] of [[cropRing[0][0], 'right', [-10, 0]], [baseRing[1][0], 'left', [10, 0]]]) {
    const element = document.createElement('div');
    element.className = 'maptag';
    element.setAttribute('aria-hidden', 'true');
    current.tags.push(element);
    new window.maplibregl.Marker({ element, anchor, offset }).setLngLat([lon, mid]).addTo(map);
  }
  setStripTags(current);
}

async function countyOutlines(county) {
  if (!county) return null;
  try {
    return await countyFields(county);
  } catch {
    return null; // the outlines are extra: the pin still shows where the field is
  }
}

async function startMaps(current) {
  const field = state.field;
  current.map = makeMap(current.els.map, 'plan');
  current.map2 = makeMap(current.els.map2, 'plan-test');
  if (!current.map2) current.els.testin.closest('.plan').classList.add('nostrips');
  const loaded = (map) => (map ? new Promise((resolve) => map.once('load', resolve)) : Promise.resolve());
  const [collection] = await Promise.all([countyOutlines(field.county), loaded(current.map), loaded(current.map2)]);
  if (view !== current) return;
  const features = collection?.features ?? [];
  const geometry = field.geometry ?? features.find((feature) => feature.id === field.id)?.geometry ?? null;
  current.geometry = geometry;
  const bounds = geometryBounds(geometry) ?? [field.pin[0], field.pin[1], field.pin[0], field.pin[1]];
  const box = [bounds[0] - NEIGHBOR_MARGIN_DEG * 3, bounds[1] - NEIGHBOR_MARGIN_DEG * 2, bounds[2] + NEIGHBOR_MARGIN_DEG * 3, bounds[3] + NEIGHBOR_MARGIN_DEG * 2];
  const neighbors = featuresNear(features, box).filter((feature) => feature.id !== field.id);
  if (current.map) {
    drawField(current.map, geometry, neighbors);
    addPin(current.map, field.pin);
  }
  if (current.map2) {
    drawField(current.map2, geometry, neighbors);
    const strips = placeStrips(field.pin, geometry);
    current.els.testin.closest('.plan').classList.toggle('nostrips', !strips);
    if (strips) drawStrips(current, strips);
  }
  current.mapsReady = true;
  fitSoon(current);
}

/* ---------- loading ---------- */

async function loadMoney(county) {
  let config = null;
  try {
    config = await fieldsConfig();
    const [fieldConfig, app] = await Promise.all([fieldConfigFor(county), engineFor(county)]);
    return { config, fieldConfig, app, moneyProblem: null };
  } catch {
    return { config, fieldConfig: null, app: null, moneyProblem: MONEY_FILE_PROBLEM };
  }
}

async function loadCropNeeds() {
  try {
    return await cropNeeds();
  } catch {
    return null;
  }
}

async function loadFutureRain() {
  try {
    return await futureRain();
  } catch {
    return null;
  }
}

async function loadInsideCropMap(field) {
  try {
    return insideCropMap(field, (await fieldsIndex()).counties);
  } catch {
    return true;
  }
}

async function loadClimate(current, field) {
  const answer = await nasaClimate(field.pin);
  if (view !== current) return;
  current.data.weather = weatherFrom(answer, field, current.data.config);
  render(current);
  if (current.data.weather.source !== 'live') announceSoon(current, WEATHER_NOTICE[current.data.weather.source]);
}

function showLoadProblem(current) {
  const { els } = current;
  renderField(current);
  els.cropcontrols.hidden = true;
  els.notice.hidden = false;
  els.noticetext.textContent = LOAD_PROBLEM;
  els.h1.textContent = 'This page could not load.';
  els.moneyh.textContent = 'The money comparison could not load. Check your connection, then try again.';
  els.axiswrap.hidden = true; // no rows to put a dollar scale under
  els.growbig.textContent = 'Not checked';
  els.growsub.textContent = 'The conditions at your field could not load.';
  announceSoon(current, LOAD_PROBLEM);
  fitSoon(current);
}

async function loadData(current) {
  const field = state.field;
  const [needs, moneyData, inside, future] = await Promise.all([
    loadCropNeeds(), loadMoney(field.county), loadInsideCropMap(field), loadFutureRain()]);
  if (view !== current) return;
  current.data = { needs, ...moneyData, insideCropMap: inside, weather: null, futureRain: future };
  if (!needs) {
    showLoadProblem(current);
    return;
  }
  fillCropControls(current);
  render(current);
  loadClimate(current, field);
}

/* ---------- mount and unmount ---------- */

export async function mount(container) {
  const field = state.field;
  if (!field) return; // the router only opens this screen with a field

  const holder = document.createElement('div');
  holder.innerHTML = TEMPLATE;
  const root = holder.firstElementChild;
  container.replaceChildren(root);

  const current = {
    container,
    els: collectElements(root),
    data: null,
    whatIf: null,
    map: null,
    map2: null,
    geometry: field.geometry ?? null,
    tags: [],
    testNames: null,
    quick: [],
    showAll: false,
    comparing: false,
    announceTimer: 0,
    fitTimer: 0,
    mapsReady: false,
    framed: false,
    testCrop: null,
    fieldKey: fieldKey(field),
    shown: snapshot(),
    onResize: null,
    stopState: null,
  };
  view = current;

  current.onResize = () => fitSoon(current, true);
  window.addEventListener('resize', current.onResize);
  current.stopState = state.subscribe(() => onStateChange(current));
  wireEvents(current);
  renderField(current);
  startMaps(current);
  await loadData(current);
}

export function unmount() {
  const current = view;
  if (!current) return;
  view = null;
  window.clearTimeout(current.announceTimer);
  window.clearTimeout(current.fitTimer);
  current.stopState?.();
  window.removeEventListener('resize', current.onResize);
  current.map?.remove();
  current.map2?.remove();
  current.map = null;
  current.map2 = null;
}
