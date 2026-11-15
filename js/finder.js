/* Fields screen (#/fields), built from the approved mock _design/fields-a.html: the globe is the
   page. Four stages, set on the root as data-stage:
     start    one question ("Where is your farm?"), the town field, other ways and sample farms
     flying   the place name in big type while the camera travels
     arrived  one instruction over the aerial photo, and buttons to pick a field without the map
     found    the field's size in big type, and a glass panel with the four answers
   The field and the answers are written to js/state.js, so Plan and Proof read them, and coming
   back here shows the same field. */

import { state } from './state.js';
import { addPin, createMap, fly, reducedMotion } from './map.js';
import { announce } from './live.js';
import { cropNeeds, places, fieldsConfig, fieldsIndex, countyFields, engineById, satelliteHeat, satelliteZone } from './data.js';
import { count, pinText, plural, wordList, yearSpan } from './format.js';
import { boundsAround, boundsCentre, boundsHold, geometryBounds, pointInside } from './geometry.js';
import { cropGroups } from './growcheck.js';
import {
  MIN_QUERY_LETTERS,
  SURVEY_GRID_TILES,
  countiesTouching,
  fieldAt,
  fieldsNear,
  foldText,
  guessRotation,
  indexFields,
  indexPlaces,
  irrigationText,
  landCodeProblems,
  landCodeText,
  parseLandCode,
  placeLabel,
  rotatesWith,
  rotationFromCrops,
  rotationWords,
  FIELD_HEAT_RAMP,
  HEAT_FADE,
  HEAT_MAX_ZOOM,
  HEAT_OPACITY,
  fieldHeatRange,
  fieldHeatShown,
  heatCounts,
  heatedFields,
  heatHint,
  heatKey,
  SATELLITE_SOURCE,
  VIEW_YEARS,
  cropYearLine,
  heatTiles,
  heatYearLine,
  recordedFields,
  sampleBlurb,
  satelliteGapLine,
  satelliteRecordFor,
  searchPlaces,
  setFieldHeat,
  setSatelliteZone,
  sectionQueryUrl,
  townZoom,
  waterAnswer,
  yearCounts,
} from './finder-util.js';

const ZOOM = {
  start: 4.5, // below this the whole globe shows and the screen is the Start stage
  area: 8, // from here a click means "my farm is near this spot"
  outlines: 10, // county outline files load from here
  drawn: 10.5, // field outlines are drawn from here, faint at first
  pick: 12, // fields can be picked from here, on the map and in the list
  section: 13.2,
  field: 14.3,
  sample: 14.4, // the closest the map goes to show a whole field
  wholeField: 11.2, // the farthest out it goes to show one
  standing: 15,
  backOut: 12.6,
};

const SPIN = { degrees: 2, ms: 1000 }; // one slow turn in three minutes
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const MAX_LISTED = 12;
const LOOKUP_TIMEOUT_MS = 15000;
const LOCATION_TIMEOUT_MS = 10000;
const MAP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_']);
const HONEY = '#ffdfb5';
const GREW = '#7cc94f'; // crop or rest view: a crop was growing (also the darker of the two)
const RESTED = '#e8c98f'; // and resting: a light, muted ochre
const PLAY_MS = 1000; // one year a second

const ROTATION_WORDS = { wf: 'Wheat, then rest', ww: 'Wheat every year', other: 'Something else' };
const WATER_WORDS = { Dryland: 'Dryland, rain only', Irrigated: 'Irrigated' };
const PRIORITY_WORDS = { steady: 'Steady income in bad years', typical: 'The best typical year', soil: 'Better soil' };

const TEXT = {
  mapLabel: 'Map of your farm area. Arrow keys move it, plus and minus zoom. '
    + 'To pick a field without a mouse, use Pick from a list.',
  landHelp: 'Section, Township, Range. It is on your deed, lease or property tax statement. Washington only.',
  needField: 'Find your farm first: search for your town, or try a sample farm.',
  townLoading: 'Loading the town list…',
  townFailed: 'The town list could not load. Check your connection, or use section and township.',
  lookupFailed: 'Could not reach the land survey map. Search for your town instead.',
  noLocation: 'This browser cannot share your location. Search for your town instead.',
  cropsFailed: 'The crop list could not load. You can pick a crop on the next screen.',
  cropNote: 'Not sure? Leave it on peas. You can switch crops on the next screen.',
};

/* What the browser tells us when it cannot give a location, by its error code. */
const LOCATION_ERRORS = {
  1: 'Location is blocked for this page. Allow it in your browser, or search for your town.',
  2: 'Your device could not work out where you are. Try again outside, or search for your town.',
  3: 'Finding you took too long. Try again, or search for your town.',
};

const ARROW = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const TEMPLATE = `
<div class="fa" id="fa" data-stage="start" data-mode="town" data-view="map">
  <div class="shade shade-start" aria-hidden="true"></div>
  <div class="shade shade-low" aria-hidden="true"></div>
  <div class="shade shade-side" aria-hidden="true"></div>
  <div class="shade shade-top" aria-hidden="true"></div>
  <div class="crosshair" aria-hidden="true"></div>
  <div class="hoverchip" id="hoverchip" aria-hidden="true"></div>
  <p class="nomap" id="nomap" hidden>The map could not start on this device. You can still find your field: search for your town, then pick your field from the list.</p>

  <section class="hero piece" id="hero" aria-labelledby="hero-title">
    <h1 id="hero-title">Where is your farm?</h1>
    <p class="lede">Type your town and we will fly you there. About a minute. No account needed.</p>

    <form class="field" id="town-form" novalidate>
      <div class="seg">
        <label for="town-input">Town</label>
        <input id="town-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
          aria-controls="town-list" aria-describedby="fa-status" autocomplete="off" spellcheck="false"
          placeholder="Like Ritzville, WA">
      </div>
      <button class="go" type="submit" aria-label="Fly to this town">${ARROW}</button>
      <ul id="town-list" class="town-list" role="listbox" aria-label="Towns" hidden></ul>
    </form>

    <form class="field" id="land-form" novalidate hidden>
      <div class="seg" data-part="section">
        <label for="land-sec">Section</label>
        <div class="entry"><input id="land-sec" type="text" inputmode="numeric" maxlength="2" autocomplete="off" placeholder="1"></div>
      </div>
      <div class="seg" data-part="township">
        <label for="land-twp">Township</label>
        <div class="entry"><input id="land-twp" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="19"><span class="unit" aria-hidden="true">N</span></div>
      </div>
      <div class="seg" data-part="range">
        <label for="land-rng">Range</label>
        <div class="entry"><input id="land-rng" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="34"><span class="unit" aria-hidden="true">E</span></div>
      </div>
      <button class="go" type="submit" aria-label="Find this section and township">${ARROW}</button>
    </form>

    <p class="status" id="fa-status" role="status"></p>

    <div class="row" role="group" aria-label="Other ways to find your farm">
      <span class="lab" aria-hidden="true">Other ways</span>
      <button type="button" class="chip" data-way="town">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>A town
      </button>
      <button type="button" class="chip" data-way="land">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></svg>Section and township
      </button>
      <button type="button" class="chip" data-way="gps">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>I'm at my field
      </button>
    </div>

    <div class="row" role="group" aria-label="Sample farms" id="sample-row" hidden>
      <span class="lab" aria-hidden="true">Sample farms</span>
    </div>
  </section>

  <div class="topleft piece off" id="topleft">
    <button type="button" class="place glass" id="place">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>
      <span class="name" id="place-name"></span>
      <span class="verb">Edit<span class="visually-hidden"> place</span></span>
    </button>
    <div class="zoom glass" role="group" aria-label="Zoom the map" id="zoom-group">
      <button type="button" id="zoom-out" aria-label="Zoom out"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button>
      <button type="button" id="zoom-in" aria-label="Zoom in"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg></button>
    </div>
    <div class="views glass" role="group" aria-label="Map view" id="views">
      <button type="button" data-show="map" aria-pressed="true">Map</button>
      <button type="button" data-show="crop" aria-pressed="false">Crop or rest</button>
      <button type="button" data-show="heat" aria-pressed="false">Heat</button>
    </div>
  </div>

  <div class="lower" id="lower">
    <section class="mvbar glass piece off" id="mvbar" aria-label="Year on the map">
      <div class="mv-top">
        <p class="mv-line" id="mv-line" aria-live="polite"></p>
        <p class="mv-key" id="mv-key-crop"><span><i class="sw grew" aria-hidden="true"></i>Crop growing</span><span><i class="sw rested" aria-hidden="true"></i>Resting</span></p>
        <p class="mv-key" id="mv-key-heat" hidden><span id="heat-low">Cooler, 60°F</span><i class="ramp" aria-hidden="true"></i><span id="heat-high">135°F, hotter</span></p>
      </div>
      <p class="mv-hint" id="mv-hint" aria-live="polite"></p>
      <div class="mv-row">
        <button type="button" class="mv-play" id="mv-play" aria-label="Play the years"></button>
        <label class="visually-hidden" for="mv-year">Year</label>
        <span class="mv-end" aria-hidden="true">${VIEW_YEARS.first}</span>
        <input type="range" id="mv-year" min="${VIEW_YEARS.first}" max="${VIEW_YEARS.last}" step="1" value="${VIEW_YEARS.last}">
        <span class="mv-end" aria-hidden="true">${VIEW_YEARS.last}</span>
      </div>
    </section>

    <section class="banner piece off" id="banner" aria-labelledby="banner-title">
      <p class="eyebrow" id="banner-eyebrow"></p>
      <h1 id="banner-title" tabindex="-1"></h1>
      <p class="sub" id="banner-sub"></p>
      <details class="know" id="know" hidden>
        <summary>How we know</summary>
        <p class="know-crop" id="know-crop"></p>
        <div class="sat" id="sat" hidden>
          <div class="sat-bars" id="sat-bars" aria-hidden="true"></div>
          <p><span id="sat-words"></span><span class="sat-more" id="sat-more"></span></p>
        </div>
      </details>
    </section>

    <div class="actions piece off" id="actions">
      <button type="button" class="ghost" id="zoom-middle" hidden>Zoom in on the middle</button>
      <button type="button" class="ghost" id="open-list" aria-expanded="false" aria-controls="dock" hidden>Pick from a list</button>
      <button type="button" class="ghost" id="pin-middle" hidden>Pin the middle of the map</button>
    </div>

    <section class="dock glass piece off" id="dock" aria-labelledby="dock-title">
      <div class="dock-body" id="dock-answers">
        <h2 class="dock-title" id="dock-title"><span class="lead" id="dock-lead">We filled in four answers.</span> <span id="dock-rest">Edit any that are off.</span></h2>

        <div class="ans" data-key="rotation">
          <div class="ans-head">
            <div><span class="ans-label" id="l-rotation">You grow now</span><span class="ans-value" id="v-rotation"></span></div>
            <button type="button" class="change" aria-expanded="false" aria-controls="m-rotation"><span class="word">Edit</span><span class="visually-hidden"> what you grow now</span></button>
          </div>
          <div class="ans-more" id="m-rotation"><div>
            <fieldset class="opts" aria-labelledby="l-rotation">
              <label class="opt"><input type="radio" name="rotation" value="wf"><span>Wheat, then rest</span></label>
              <label class="opt"><input type="radio" name="rotation" value="ww"><span>Wheat every year</span></label>
              <label class="opt"><input type="radio" name="rotation" value="other"><span>Something else</span></label>
            </fieldset>
            <p class="ans-note" id="n-rotation"></p>
          </div></div>
        </div>

        <div class="ans" data-key="water">
          <div class="ans-head">
            <div><span class="ans-label" id="l-water">Water</span><span class="ans-value" id="v-water"></span></div>
            <button type="button" class="change" aria-expanded="false" aria-controls="m-water"><span class="word">Edit</span><span class="visually-hidden"> the water answer</span></button>
          </div>
          <div class="ans-more" id="m-water"><div>
            <fieldset class="opts" aria-labelledby="l-water">
              <label class="opt"><input type="radio" name="water" value="Dryland"><span>Dryland, rain only</span></label>
              <label class="opt"><input type="radio" name="water" value="Irrigated"><span>Irrigated</span></label>
            </fieldset>
            <p class="ans-note" id="n-water"></p>
          </div></div>
        </div>

        <div class="ans" data-key="crop">
          <div class="ans-head">
            <div><span class="ans-label" id="l-crop">Crop to check</span><span class="ans-value" id="v-crop"></span></div>
            <button type="button" class="change" aria-expanded="false" aria-controls="m-crop"><span class="word">Edit</span><span class="visually-hidden"> the crop to check</span></button>
          </div>
          <div class="ans-more" id="m-crop"><div>
            <label class="visually-hidden" for="crop-find">Find a crop</label>
            <input class="crop-find" id="crop-find" type="text" autocomplete="off" spellcheck="false" placeholder="Find a crop">
            <fieldset class="crop-box" id="crop-box" aria-labelledby="l-crop"></fieldset>
            <p class="ans-note" id="n-crop" role="status">${TEXT.cropNote}</p>
          </div></div>
        </div>

        <div class="ans" data-key="priority">
          <div class="ans-head">
            <div><span class="ans-label" id="l-priority">What matters most</span><span class="ans-value" id="v-priority"></span></div>
            <button type="button" class="change" aria-expanded="false" aria-controls="m-priority"><span class="word">Edit</span><span class="visually-hidden"> what matters most</span></button>
          </div>
          <div class="ans-more" id="m-priority"><div>
            <fieldset class="opts" aria-labelledby="l-priority">
              <label class="opt"><input type="radio" name="priority" value="steady"><span>Steady income in bad years</span></label>
              <label class="opt"><input type="radio" name="priority" value="typical"><span>The best typical year</span></label>
              <label class="opt"><input type="radio" name="priority" value="soil"><span>Better soil</span></label>
            </fieldset>
            <p class="ans-note">This sets the order of your results. The dollars stay the same.</p>
          </div></div>
        </div>
      </div>
      <div class="dock-foot" id="dock-answers-foot">
        <div class="cta"><a class="pill" id="see-plan" href="#/plan">See my plan <span aria-hidden="true">→</span></a></div>
        <button type="button" class="textbtn" id="other-field">Pick a different field</button>
        <p class="credit-in" id="credit-in"></p>
      </div>

      <div class="dock-body" id="dock-list">
        <div class="list-head">
          <h2 id="list-title" tabindex="-1">Fields in view</h2>
          <button type="button" class="close" id="close-list" aria-label="Close the list"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>
        <p class="list-note" id="list-note"></p>
        <ul id="field-list" role="list"></ul>
      </div>
      <div class="dock-foot" id="dock-list-foot">
        <button type="button" class="textbtn" id="pin-middle-2">None of these? Pin the middle of the map</button>
      </div>
    </section>
  </div>

  <p class="credit" id="credit"></p>
  <button type="button" class="spin piece" id="spin" hidden>Stop the globe</button>

  <!-- The map is last in the page, so the keyboard reaches the words and buttons first. -->
  <div class="globe" id="globe"></div>
</div>`;

/* The screen now on the page, or null. Slow work keeps the screen it started on and stops when
   that is no longer this one. */
let ui = null;

const fieldIndexCache = new WeakMap();
const townIndexCache = new WeakMap();

const phone = () => window.matchMedia('(max-width: 767px)').matches;
const coarse = () => window.matchMedia('(pointer: coarse)').matches;
const clean = (text) => (typeof text === 'string' ? text.trim() : '');
const verb = () => (coarse() ? 'Tap' : 'Click');

function $(id) {
  return ui.root.querySelector(`#${id}`);
}

function newScreen(container) {
  return {
    root: container.querySelector('.fa'),
    map: null,
    marker: null,
    mapWarned: false,
    styleReady: false,
    afterStyle: [],
    stage: 'start',
    mode: 'town',
    place: '',
    listOpen: false,
    yours: {}, // answers the farmer changed by hand on this screen
    spinning: false,
    spinAsked: false,
    searches: 0,
    hasSection: false,
    textView: { centre: [-100, 38], zoom: 2, bounds: [-180, -85, 180, 85] },
    samples: [],
    sampleFacts: new Map(),
    index: null,
    indexFailed: false,
    indexRequest: null,
    counties: new Map(), // county name -> { entry, status, fields, source, request }
    hovered: null,
    listed: new Map(),
    listKey: '',
    bannerKey: '',
    bannerCopy: { title: '' },
    townIndex: null,
    townsRequest: null,
    townMatches: [],
    townActive: -1,
    townOpen: false,
    stopWatching: null,
    onResize: null,
    resizeTimer: 0,
    view: 'map', // the map view: map, crop (crop or rest) or heat
    year: VIEW_YEARS.last,
    playTimer: 0,
    heatYear: 0,
    barWatch: null,
  };
}

function setStatus(text, bad = false) {
  const status = $('fa-status');
  status.textContent = text;
  status.classList.toggle('bad', bad);
}

/* Each way to find the farm starts a new search. The function this gives back says whether that
   search is still the newest one, so a slow, older search never finishes on top of a newer one. */
function newSearch() {
  const screen = ui;
  screen.searches += 1;
  const mine = screen.searches;
  return () => screen === ui && screen.searches === mine;
}

function show(element, on) {
  element.classList.toggle('off', !on);
}

function focusTitle() {
  $('banner-title').focus({ preventScroll: true });
}

/* ---------- The view ---------- */

function view() {
  if (!ui.map) return ui.textView;
  const centre = ui.map.getCenter();
  const bounds = ui.map.getBounds();
  return {
    centre: [centre.lng, centre.lat],
    zoom: ui.map.getZoom(),
    bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
  };
}

/* Move the camera: a flight, or a jump under reduced motion; with no map, just the view. */
async function move(options) {
  const screen = ui;
  if (!screen.map) {
    const centre = options.center ?? screen.textView.centre;
    const zoom = options.zoom ?? screen.textView.zoom;
    screen.textView = { centre, zoom, bounds: boundsAround(centre, 50000 / 2 ** zoom) };
    refreshView(); // no moveend without a map: load the outlines for the new spot here
    return;
  }
  stopSpin();
  preloadCounties(options);
  await fly(screen.map, { curve: 1.5, speed: 0.95, maxDuration: 7000, padding: ZERO, ...options });
}

function preloadCounties({ center, zoom }) {
  if (!center || zoom < ZOOM.outlines) return;
  for (const entry of countyEntriesAt(center)) loadCounty(entry);
}

/* The start: a large globe, low and to the right, with most of it off the page. */
function startView(lng = -86) {
  const width = ui.root.clientWidth || 1280;
  const height = ui.root.clientHeight || 800;
  const small = phone();
  const radius = small ? width * 0.98 : height * 0.82;
  const centreX = small ? width * 0.5 : width * 0.76;
  const centreY = small ? height * 1.02 : height * 0.86;
  const lat = 10;
  // MapLibre's camera stands 1.5 screen heights off the ground. From there a globe of radius R
  // shows with radius c * tan(asin(R / (R + c))). Solve that for R, then for the zoom.
  const c = 1.5 * height;
  const sin = (radius / c) / Math.hypot(1, radius / c);
  const R = (c * sin) / (1 - sin);
  const zoom = Math.log2((R * 2 * Math.PI * Math.cos((lat * Math.PI) / 180)) / 512);
  const padding = {
    left: Math.max(0, 2 * centreX - width), right: 0,
    top: Math.max(0, 2 * centreY - height), bottom: 0,
  };
  return { center: [lng, lat], zoom: Math.min(zoom, ZOOM.start - 0.3), padding };
}

/* The camera that shows the whole picked field in the free part of the Found screen: right of the
   words and left of the panel, or above the words. On a phone, above the sheet. */
function fieldCamera(field) {
  const bounds = geometryBounds(field.geometry) ?? [field.pin[0], field.pin[1], field.pin[0], field.pin[1]];
  const fallback = { center: field.pin, zoom: ZOOM.sample, padding: ZERO };
  if (!ui.map) return fallback;
  const width = ui.root.clientWidth;
  const height = ui.root.clientHeight;
  const rooms = phone()
    ? [{ top: 140, right: 32, bottom: Math.round(height * 0.64), left: 32 }]
    : [
      { top: 156, right: 480, bottom: 64, left: Math.min(492, Math.max(48, width - 520 - 44)) },
      { top: 156, right: 480, bottom: 420, left: 48 },
    ];
  const [[west, south], [east, north]] = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
  let best = null;
  for (const room of rooms) {
    if (room.left + room.right >= width - 80 || room.top + room.bottom >= height - 80) continue;
    const camera = cameraFor(bounds, room, width, height);
    if (!best || camera.zoom > best.zoom) best = camera;
  }
  if (!best) return fallback;
  return { ...best, zoom: Math.max(best.zoom, ZOOM.wholeField), padding: ZERO };
}

/* Web Mercator, as a share of the world: x from 0 at 180°W, y from 0 at the top. */
const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/* The camera that fits a box into one room of the screen. MapLibre's own cameraForBounds cannot
   be used while the globe is far out, so this works it out in Mercator, as the map is close in. */
function cameraFor([west, south, east, north], room, width, height) {
  const boxW = Math.max(mercX(east) - mercX(west), 1e-7);
  const boxH = Math.max(mercY(south) - mercY(north), 1e-7);
  const roomW = width - room.left - room.right;
  const roomH = height - room.top - room.bottom;
  const zoom = Math.min(ZOOM.sample, Math.log2(Math.min(roomW / (boxW * 512), roomH / (boxH * 512))));
  const scale = 512 * 2 ** zoom;
  const x = (mercX(west) + mercX(east)) / 2 - (room.left - room.right) / 2 / scale;
  const y = (mercY(north) + mercY(south)) / 2 - (room.top - room.bottom) / 2 / scale;
  return { center: [x * 360 - 180, mercLat(y)], zoom };
}

/* ---------- County outline files ---------- */

async function loadIndex() {
  const screen = ui;
  try {
    screen.index = await fieldsIndex();
  } catch (error) {
    console.warn('The list of field outline files did not load:', error);
    screen.indexFailed = true;
  }
  if (screen === ui) refreshView();
}

/* The MODIS crop-or-rest record for the fields of the three counties. When it lands after a field was
   picked, the Found words are written again so they show it. */
async function loadSatelliteZone() {
  const screen = ui;
  setSatelliteZone(await satelliteZone());
  if (screen !== ui) return;
  for (const record of ui.counties.values()) record.recorded = null;
  paintView();
  if (ui.view === 'crop') writeYearLine(false);
  if (ui.stage === 'found' && state.field) setBanner(foundCopy(state.field), true);
  showCredit();
}

function indexedFields(collection) {
  if (!fieldIndexCache.has(collection)) fieldIndexCache.set(collection, indexFields(collection));
  return fieldIndexCache.get(collection);
}

function loadCounty(entry) {
  const known = ui.counties.get(entry.county);
  if (known) return known.request;
  const screen = ui;
  const record = { entry, status: 'loading', fields: [], source: `fields-${entry.county.toLowerCase()}`, request: null };
  record.request = countyFields(entry.county)
    .then((collection) => {
      record.fields = indexedFields(collection);
      record.status = 'ready';
      if (screen === ui) addCountyToMap(record, collection);
    })
    .catch((error) => {
      console.warn(`The field outlines for ${entry.county} County did not load:`, error);
      record.status = 'failed';
    })
    .then(() => {
      if (screen === ui) refreshView();
      return record;
    });
  screen.counties.set(entry.county, record);
  return record.request;
}

async function fieldsOfCounty(countyName) {
  const screen = ui;
  await screen.indexRequest;
  const entry = screen.index?.counties.find((county) => county.county === countyName);
  if (!entry || screen !== ui) return null;
  const record = await loadCounty(entry);
  return record.status === 'ready' ? record.fields : null;
}

function countyEntriesAt(point) {
  return ui.index ? ui.index.counties.filter((county) => boundsHold(county.bbox, point)) : [];
}

function countiesInView(v) {
  if (!ui.index || v.zoom < ZOOM.outlines) return [];
  return countiesTouching(ui.index.counties, v.bounds);
}

function recordsInView(v, status) {
  return countiesInView(v).map((entry) => ui.counties.get(entry.county)).filter((record) => record?.status === status);
}

async function outlinesLoadedAt(point) {
  const screen = ui;
  await screen.indexRequest;
  if (screen !== ui) return;
  await Promise.all(countyEntriesAt(point).map(loadCounty));
}

function findField(point) {
  for (const record of ui.counties.values()) {
    const feature = record.status === 'ready' ? fieldAt(record.fields, point) : null;
    if (feature) return feature;
  }
  return null;
}

/* ---------- The map ---------- */

function startMap() {
  const field = state.field;
  const start = field ? { center: field.pin, zoom: ZOOM.sample } : startView();
  const map = createMap($('globe'), {
    name: 'globe',
    attributionControl: false, // the credit line at the bottom left says what the picture is
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    center: start.center,
    zoom: start.zoom,
  });
  if (!map) {
    ui.textView = { centre: start.center, zoom: start.zoom, bounds: boundsAround(start.center, 50000 / 2 ** start.zoom) };
    $('nomap').hidden = false;
    return;
  }
  ui.map = map;
  map.jumpTo(field ? fieldCamera(field) : startView());
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.getCanvas().setAttribute('aria-label', TEXT.mapLabel);
  map.on('error', warnMapError);
  map.on('style.load', onStyleLoad);
  map.once('load', () => {
    showCredit();
    if (ui?.stage === 'start') startSpin();
  });
  map.on('moveend', onMoveEnd);
  map.on('zoom', () => showCredit());
  map.on('click', onMapClick);
  for (const type of ['mousedown', 'touchstart', 'wheel']) map.on(type, stopSpin);
  map.getCanvas().addEventListener('keydown', (event) => {
    if (MAP_KEYS.has(event.key)) stopSpin();
  });
}

function warnMapError(event) {
  if (!ui || ui.mapWarned) return;
  ui.mapWarned = true;
  console.warn('Part of the map did not load:', event.error?.message ?? 'unknown error');
}

function onStyleLoad() {
  const { map } = ui;
  map.setProjection({ type: 'globe' });
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('plss', { type: 'raster', tileSize: 256, tiles: [SURVEY_GRID_TILES] });
  map.addLayer({ id: 'plss', type: 'raster', source: 'plss', minzoom: 11, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.35 } });
  // Heat view: NASA land surface temperature, under the field outlines. Hidden, it loads nothing.
  map.addSource('heat', { type: 'raster', tileSize: 256, maxzoom: HEAT_MAX_ZOOM, tiles: [heatTiles(ui.year)] });
  // Close in, a 1 km square is one flat colour over every field: the heat fades out (heatHint).
  const heatOpacity = ['interpolate', ['linear'], ['zoom'], HEAT_FADE.from, HEAT_OPACITY, HEAT_FADE.to, 0];
  map.addLayer({ id: 'heat', type: 'raster', source: 'heat', layout: { visibility: 'none' }, paint: { 'raster-opacity': heatOpacity, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } });
  ui.heatYear = ui.year;
  // The ground around the picked field goes a little darker, so the field stands out.
  map.addSource('mask', { type: 'geojson', data: empty });
  map.addLayer({ id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': '#000', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 0.28] } });
  map.addSource('sec', { type: 'geojson', data: empty });
  map.addLayer({ id: 'sec', type: 'line', source: 'sec', paint: { 'line-color': '#fff', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
  map.addSource('picked', { type: 'geojson', data: empty });
  map.addLayer({ id: 'picked-fill', type: 'fill', source: 'picked', paint: { 'fill-color': HONEY, 'fill-opacity': 0.07 } });
  map.addLayer({ id: 'picked-case', type: 'line', source: 'picked', layout: { 'line-join': 'round' }, paint: { 'line-color': '#1c140a', 'line-width': 7.5, 'line-opacity': 0.7 } });
  map.addLayer({ id: 'picked-line', type: 'line', source: 'picked', layout: { 'line-join': 'round' }, paint: { 'line-color': HONEY, 'line-width': 3.5 } });
  ui.styleReady = true;
  for (const work of ui.afterStyle.splice(0)) work();
}

function whenStyleReady(work) {
  if (!ui.map) return;
  if (ui.styleReady) work();
  else ui.afterStyle.push(work);
}

function addCountyToMap(record, collection) {
  whenStyleReady(() => {
    const { map } = ui;
    const { source } = record;
    map.addSource(source, { type: 'geojson', data: collection });
    map.addLayer({
      id: `${source}-fill`, type: 'fill', source, minzoom: ZOOM.drawn,
      paint: { 'fill-color': '#fff', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.2, 0] },
    }, 'mask');
    map.addLayer({
      id: `${source}-line`, type: 'line', source, minzoom: ZOOM.drawn,
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], HONEY, '#fff'],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11, 0.4, 12.5, 0.75],
        'line-width': ['interpolate', ['linear'], ['zoom'],
          10.5, ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.5],
          13, ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.2]],
      },
    }, 'sec');
    map.on('mousemove', `${source}-fill`, (event) => showHover({ source, id: event.features[0].id }, event));
    map.on('mouseleave', `${source}-fill`, () => showHover(null));
    quietOutlines();
    paintCounty(record);
    if (ui.view === 'heat') writeHeatHint();
  });
}

/* The other outlines stay, so another field can be clicked, but they step back. */
function quietOutlines() {
  whenStyleReady(() => {
    const top = state.field ? 0.42 : 0.78;
    for (const record of ui.counties.values()) {
      if (ui.map.getLayer(`${record.source}-line`)) {
        ui.map.setPaintProperty(`${record.source}-line`, 'line-opacity', ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11, 0.4, 12.5, top]);
      }
    }
  });
}

function showHover(outline, event) {
  const chip = $('hoverchip');
  const canPick = ui.map.getZoom() >= ZOOM.pick && ui.stage !== 'flying';
  const next = canPick ? outline : null;
  if (ui.hovered && (ui.hovered.source !== next?.source || ui.hovered.id !== next?.id)) ui.map.setFeatureState(ui.hovered, { hover: false });
  if (next) ui.map.setFeatureState(next, { hover: true });
  ui.hovered = next;
  ui.map.getCanvas().style.cursor = next ? 'pointer' : '';
  if (!next || !event || coarse()) {
    chip.classList.remove('on');
    return;
  }
  const props = event.features[0].properties;
  chip.textContent = `${clean(props.crop) || 'Crop not recorded'} · ${Number.isFinite(props.ac) ? `${count(props.ac)} acres` : 'size not recorded'}`;
  const x = Math.min(event.point.x + 16, ui.root.clientWidth - chip.offsetWidth - 12);
  chip.style.transform = `translate(${x}px, ${event.point.y + 18}px)`;
  chip.classList.add('on');
}

/* Draw one outline as lit, from the list. */
function lightOutline(feature) {
  if (!ui.map || !ui.styleReady) return;
  const record = feature ? ui.counties.get(feature.properties.co) : null;
  if (ui.hovered) ui.map.setFeatureState(ui.hovered, { hover: false });
  ui.hovered = record ? { source: record.source, id: feature.id } : null;
  if (ui.hovered) ui.map.setFeatureState(ui.hovered, { hover: true });
}

function onMoveEnd(event) {
  if (!ui) return;
  if (event.spin) {
    queueMicrotask(spinStep);
    return;
  }
  refreshView();
  // A move the farmer made by hand can change the stage: far out is the start, close in is "arrived".
  if (event.flight === undefined && ui.stage !== 'flying') settle();
}

// Field outlines and land codes cover Washington only.
const WASHINGTON = { west: -124.9, east: -116.9, south: 45.5, north: 49.1 };
function inWashington([lng, lat]) {
  return lng >= WASHINGTON.west && lng <= WASHINGTON.east && lat >= WASHINGTON.south && lat <= WASHINGTON.north;
}

function onMapClick(event) {
  if (ui.stage === 'flying') {
    if (ui.map.isMoving()) return;
    settle(); // a flight that was cut short: carry on from where the map is now
  }
  const point = [event.lngLat.lng, event.lngLat.lat];
  if (!inWashington(point)) {
    const message = 'Fieldproof covers farms in Washington for now. Type your town, or click on Washington.';
    if (ui.stage === 'start') setStatus(message, true);
    else setBanner({ eyebrow: 'Outside Washington', title: 'Click on Washington.', sub: 'Field outlines cover Washington farms for now.' });
    return;
  }
  const zoom = ui.map.getZoom();
  if (zoom < ZOOM.area) goNear(point, Math.min(zoom + 3.4, ZOOM.area + 1));
  else if (zoom < ZOOM.pick) zoomToFarm(point);
  else pickAt(point);
}

async function goNear(point, zoom) {
  const mine = newSearch();
  setStage('flying');
  setBanner({ eyebrow: 'Flying in', title: ui.place || 'Closer' });
  await move({ center: point, zoom, speed: 1.1 });
  if (mine()) settle();
}

async function zoomToFarm(point) {
  const mine = newSearch();
  await move({ center: point, zoom: ZOOM.field, speed: 1.1 });
  if (mine()) settle();
}

/* ---------- Spin ---------- */

function spinStep() {
  if (!ui?.spinning || !ui.map || ui.stage !== 'start' || ui.map.isMoving()) return;
  const centre = ui.map.getCenter();
  ui.map.easeTo({
    center: [centre.lng - SPIN.degrees, centre.lat],
    duration: SPIN.ms,
    easing: (t) => t,
    essential: ui.spinAsked, // under reduced motion the globe turns only when asked to
  }, { spin: true });
}

function stopSpin() {
  if (!ui?.spinning) return;
  ui.spinning = false;
  showSpin();
}

function startSpin(asked = false) {
  if (!ui.map || (reducedMotion() && !asked)) {
    showSpin();
    return;
  }
  ui.spinning = true;
  ui.spinAsked = asked;
  showSpin();
  spinStep();
}

function showSpin() {
  const spin = $('spin');
  spin.textContent = ui.spinning ? 'Stop the globe' : 'Spin the globe';
  spin.hidden = !ui.map || ui.stage !== 'start';
}

/* ---------- Stages ---------- */

function setStage(stage) {
  const was = ui.stage;
  ui.stage = stage;
  if (stage !== 'arrived') ui.listOpen = false;
  const { root } = ui;
  root.dataset.stage = stage;
  const dock = stage === 'found' ? 'answers' : stage === 'arrived' && ui.listOpen ? 'list' : '';
  if (dock) root.dataset.dock = dock;
  else delete root.dataset.dock;
  $('dock-answers-foot').hidden = dock !== 'answers';
  $('dock-list-foot').hidden = dock !== 'list';
  $('dock').setAttribute('aria-labelledby', dock === 'list' ? 'list-title' : 'dock-title');

  show($('hero'), stage === 'start');
  show($('topleft'), stage === 'arrived' || stage === 'found');
  if (stage === 'start' && ui.view !== 'map') setView('map', false);
  showViewBar();
  show($('banner'), stage !== 'start');
  show($('actions'), stage === 'arrived' && !ui.listOpen);
  show($('dock'), Boolean(dock));
  $('zoom-group').hidden = !ui.map;
  $('views').hidden = !ui.map;
  $('open-list').setAttribute('aria-expanded', String(dock === 'list'));
  root.classList.toggle('aim', dock === 'list');
  if (dock !== 'list') root.querySelector('.crosshair').style.top = '';
  showSpin();
  if (stage !== 'arrived' && stage !== 'found') $('hoverchip').classList.remove('on');
  $('place-name').textContent = ui.place || 'On the map';
  if (stage === 'start' && was !== 'start') closeRows();
  return was;
}

function writeBanner({ eyebrow = '', title, sub = '', know = '', sat = null }) {
  $('banner-eyebrow').textContent = eyebrow;
  $('banner-eyebrow').hidden = !eyebrow;
  $('banner-title').textContent = title;
  $('banner-sub').textContent = sub;
  $('banner-sub').hidden = !sub;
  // "How we know": the crop map and satellite lines, closed until asked for.
  $('know').hidden = !know && !sat;
  $('know').open = false;
  $('know-crop').textContent = know;
  $('know-crop').hidden = !know;
  $('sat').hidden = !sat;
  if (sat) {
    $('sat-bars').hidden = !sat.years.length; // a field with no record gets one line and no bars
    $('sat-bars').replaceChildren(...sat.years.map(({ growing }) => {
      const bar = document.createElement('i');
      bar.className = growing ? 'grew' : 'rested';
      return bar;
    }));
    $('sat-words').textContent = sat.words;
    $('sat-more').textContent = sat.more;
  }
}

/* Words in the banner fade out, change, and fade in. `instant` writes them at once. */
function setBanner(copy, instant = false) {
  const key = [copy.eyebrow, copy.title, copy.sub, copy.know ?? '', copy.sat ? copy.sat.words : ''].join('|');
  if (key === ui.bannerKey) return;
  ui.bannerKey = key;
  ui.bannerCopy = copy;
  const banner = $('banner');
  if (instant || reducedMotion() || banner.classList.contains('off')) {
    writeBanner(copy);
    banner.classList.remove('swap');
    return;
  }
  banner.classList.add('swap');
  const screen = ui;
  setTimeout(() => {
    if (screen !== ui || ui.bannerKey !== key) return;
    writeBanner(copy);
    banner.classList.remove('swap');
  }, 180);
}

function coverageNames() {
  return ui.index ? wordList(ui.index.counties.map((county) => county.county)) : '';
}

/* What the Arrived banner says depends on how close the map is. */
function arrivedCopy(v) {
  const eyebrow = ui.place || 'On the map';
  if (v.zoom < ZOOM.area) return { eyebrow, title: 'Zoom in on your farm.', sub: `${verb()} the map where your farm is, or search for your town.` };
  if (v.zoom < ZOOM.pick) return { eyebrow, title: `${verb()} near your farm.`, sub: 'We will zoom in so you can pick your field.' };
  if (recordsInView(v, 'loading').length) return { eyebrow, title: `${verb()} your field.`, sub: 'Loading field outlines…' };
  const failed = recordsInView(v, 'failed');
  if (failed.length || ui.indexFailed) {
    const names = failed.length ? `Field outlines for ${wordList(failed.map((record) => `${record.entry.county} County`))} could not load.` : 'Field outlines could not load.';
    return { eyebrow, title: `${verb()} your field to drop a pin.`, sub: `${names} Your pin still works.` };
  }
  if (countiesInView(v).length) {
    const section = ui.hasSection ? 'Your square mile is outlined in white. ' : '';
    return { eyebrow, title: `${verb()} your field.`, sub: `${section}No outline on your field? ${verb()} it anyway to drop a pin.` };
  }
  const names = coverageNames();
  const cover = names ? `Field outlines cover ${names} counties so far. ` : '';
  return { eyebrow, title: `${verb()} your field to drop a pin.`, sub: `${cover}Your pin works everywhere.` };
}

function alternates(years) {
  return years.every((entry, i) => i === 0 || entry.growing !== years[i - 1].growing);
}

function sampleOf(field) {
  return field?.sampleId ? ui.samples.find((entry) => entry.id === field.sampleId) ?? null : null;
}

function foundCopy(field) {
  const sample = sampleOf(field);
  const sampleLabel = sample?.label ?? (field.sampleId ? 'Sample farm' : '');
  if (!field.props) {
    const outside = ui.index && !ui.index.counties.some((county) => boundsHold(county.bbox, field.pin));
    const cover = outside ? ` Field outlines cover ${coverageNames()} counties so far.` : '';
    return {
      eyebrow: sampleLabel || 'Your pin',
      title: 'Pin dropped.',
      sub: `${pinText(field.pin)}. There is no field outline here, so tell us what you grow.${cover}`,
    };
  }
  const { props } = field;
  const survey = clean(String(props.surv ?? '')) ? `, ${props.surv}` : '';
  const copy = {
    eyebrow: [sampleLabel || 'Your field', field.county ? `${field.county} County` : ''].filter(Boolean).join(' · '),
    title: Number.isFinite(props.ac) ? `${count(props.ac)} ${plural(props.ac, 'acre', 'acres')}.` : 'Field found.',
    know: `State crop map${survey}: ${clean(props.crop) || 'no crop recorded'}, ${irrigationText(props.irr)}.`,
  };
  const record = satelliteRecordFor(field);
  if (record) {
    const { years } = record;
    const first = years[0].year;
    const last = years.at(-1).year;
    const part = Number.isFinite(props.ac) && record.acres < props.ac * 0.9 ? ` on ${count(record.acres)} of these acres` : ' here';
    const grew = years.filter((entry) => entry.growing).length;
    const often = alternates(years) ? 'every other year' : `in ${grew} of ${years.length} years`;
    copy.sat = {
      years,
      words: `${SATELLITE_SOURCE[record.source]} saw a crop ${often}${part}, ${yearSpan(first, last)}.`,
      more: alternates(years) ? ' That looks like wheat, then rest.' : '',
    };
  } else {
    const gap = satelliteGapLine(field);
    if (gap) copy.sat = { years: [], words: gap, more: '' };
  }
  return copy;
}

function showArrived(v = view()) {
  setBanner(arrivedCopy(v));
  const close = v.zoom >= ZOOM.pick;
  const ready = close ? recordsInView(v, 'ready') : [];
  $('zoom-middle').hidden = !(v.zoom >= ZOOM.area && !close);
  $('open-list').hidden = !ready.length;
  $('pin-middle').hidden = !close;
  if (ui.listOpen && !ready.length) closeList(false);
  if (ui.listOpen) showList(v, ready);
}

function showCredit(v = view()) {
  if (!ui) return;
  let text = '';
  if (ui.map) {
    text = 'The Earth from space · NASA Blue Marble';
    if (v.zoom >= 6) {
      text = 'Real aerial photo · USGS and USDA';
      if (v.zoom >= ZOOM.drawn && recordsInView(v, 'ready').length) text += ' · Field outlines: Washington state crop map';
      if (ui.hasSection && v.zoom >= 11) text += ' · Square mile: BLM land survey';
      const record = ui.stage === 'found' && state.field ? satelliteRecordFor(state.field) : null;
      // In the heat view the heat is named instead of the crop-or-rest record, so the line stays short.
      if (ui.view === 'heat') text += fieldHeatShown(v.zoom) && ui.heatLoaded ? ' · Heat: NASA ECOSTRESS' : ' · Heat: NASA MODIS';
      else if (record) text += record.source === 'modis' ? ' · Satellite record: NASA MODIS' : ' · Satellite record: NASA HLS';
    }
  }
  $('credit').textContent = text;
  $('credit-in').textContent = text;
}

/* Everything that depends on where the map is looking. */
function refreshView() {
  if (!ui) return;
  const v = view();
  for (const entry of countiesInView(v)) loadCounty(entry);
  showCredit(v);
  if (ui.stage === 'arrived') showArrived(v);
  if (ui.view !== 'map') writeYearLine(false);
  writeHeatHint(v);
  writeHeatKey(v);
}

/* After a move the farmer made (or a flight that ended): which stage is this? */
function settle() {
  if (state.field) {
    if (ui.stage !== 'found') showFound();
    return;
  }
  const v = view();
  if (v.zoom < ZOOM.start) {
    if (ui.stage !== 'start') goStart({ focus: false, flyOut: false });
    return;
  }
  setStage('arrived');
  showArrived(v);
  if (ui.map) {
    const padding = ui.map.getPadding();
    // Marked as a move of our own (flight 0): when a new flight cuts it short, its end must not
    // settle the screen again (that put "Edit" back on the map it had just left).
    if (padding.left || padding.top) ui.map.easeTo({ padding: ZERO, duration: reducedMotion() ? 0 : 700 }, { flight: 0 });
  }
}

async function goStart({ focus = true, flyOut = true } = {}) {
  newSearch();
  clearField();
  ui.place = '';
  ui.hasSection = false;
  whenStyleReady(() => {
    ui.map.getSource('sec').setData({ type: 'FeatureCollection', features: [] });
    ui.map.setLayoutProperty('plss', 'visibility', 'none');
  });
  setStage('start');
  setStatus(ui.mode === 'land' ? TEXT.landHelp : '');
  const screen = ui;
  if (flyOut) {
    const lng = ui.map ? ui.map.getCenter().lng + 30 : -86;
    await move({ ...startView(Math.max(-130, Math.min(-70, lng))), speed: 1.3 });
  }
  if (screen !== ui || ui.stage !== 'start') return;
  showCredit();
  startSpin();
  if (focus) (ui.mode === 'land' ? $('land-sec') : $('town-input')).focus({ preventScroll: true });
}

/* ---------- Picking: a field outline, or a bare pin ---------- */

function setField(feature, point, { sampleId = null, rotation = null } = {}) {
  const props = feature.properties;
  ui.yours = {};
  state.update({
    field: { id: feature.id, props, pin: point, county: props.co ?? null, sampleId, geometry: feature.geometry },
    answers: { water: waterAnswer(props.irr), rotation: rotation ?? guessRotation(props) },
  });
}

function setPin(point, { county = null, sampleId = null, rotation = null } = {}) {
  ui.yours = {};
  state.update({
    field: { id: null, props: null, pin: point, county, sampleId, geometry: null },
    answers: { rotation },
  });
}

function clearField() {
  if (state.field) state.update({ field: null });
}

/* The picked field on the map: its outline, the darker ground around it, and the pin. */
function drawField() {
  if (!ui.map) return;
  const field = state.field;
  whenStyleReady(() => {
    const empty = { type: 'FeatureCollection', features: [] };
    const outline = field?.geometry ? { type: 'Feature', properties: {}, geometry: field.geometry } : null;
    ui.map.getSource('picked').setData(outline ?? empty);
    ui.map.getSource('mask').setData(outline ? maskAround(field.geometry) : empty);
  });
  quietOutlines();
  if (!field) {
    ui.marker?.remove();
    ui.marker = null;
  } else if (!ui.marker) {
    ui.marker = addPin(ui.map, field.pin);
  } else {
    ui.marker.setLngLat(field.pin);
  }
}

/* A wide box of ground with the field cut out of it. */
function maskAround(geometry) {
  const [west, south, east, north] = geometryBounds(geometry);
  const box = [[west - 3, south - 2], [east + 3, south - 2], [east + 3, north + 2], [west - 3, north + 2], [west - 3, south - 2]];
  const holes = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((rings) => rings[0]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [box, ...holes] } };
}

/* Pick the field under a point; where there is no outline, drop a pin there. The outlines for
   that spot may still be on their way, so this waits for them first. */
async function pickAt(point) {
  const mine = newSearch();
  if (ui.stage === 'arrived') setBanner({ ...arrivedCopy(view()), sub: 'Loading field outlines…' });
  await outlinesLoadedAt(point);
  if (!mine()) return null;
  const feature = findField(point);
  if (feature) setField(feature, point);
  else setPin(point);
  await arriveAtField(mine);
  return feature;
}

async function pickFeature(feature) {
  const mine = newSearch();
  setField(feature, pointInside(feature.geometry));
  await arriveAtField(mine, true);
}

/* Show the found field: fill the panel, glide so the whole field sits in the free part of the
   screen, then bring the words and the panel in. */
async function arriveAtField(mine, fromKeyboard = false) {
  showAnswers();
  setBanner(foundCopy(state.field), true);
  setStage('found');
  await move({ ...fieldCamera(state.field), speed: 1.2, curve: 1.2 });
  if (!mine()) return;
  showFound(fromKeyboard);
}

function showFound(moveFocus = false, quiet = false) {
  showAnswers();
  setBanner(foundCopy(state.field), true);
  setStage('found');
  showCredit();
  if (quiet) return;
  const field = state.field;
  announce(field.props && Number.isFinite(field.props.ac)
    ? `Field found: ${count(field.props.ac)} ${plural(field.props.ac, 'acre', 'acres')}. Check the four answers, then press See my plan.`
    : 'Pin dropped. Check the four answers, then press See my plan.');
  const active = document.activeElement;
  if (moveFocus || !ui.root.contains(active) || active.closest('.off')) focusTitle();
}

/* ---------- The four answers ---------- */

function rotationValue() {
  const { rotation } = state.answers;
  const field = state.field;
  const words = field?.sampleId ? sampleFacts(field.sampleId).facts?.words : '';
  if (words && !ui.yours.rotation && rotation === sampleFacts(field.sampleId).facts?.answer) return words[0].toUpperCase() + words.slice(1);
  return rotation ? ROTATION_WORDS[rotation] : 'Not chosen yet';
}

function showAnswers() {
  if (!ui) return;
  const field = state.field;
  const { rotation, water, crop, priority } = state.answers;
  $('v-rotation').textContent = rotationValue();
  $('v-water').textContent = WATER_WORDS[water] ?? water;
  $('v-crop').textContent = crop;
  $('v-priority').textContent = PRIORITY_WORDS[priority] ?? priority;
  const checked = { rotation, water, crop, priority };
  for (const radio of $('dock').querySelectorAll('input[type="radio"]')) radio.checked = checked[radio.name] === radio.value;

  const fromMap = Boolean(field?.props);
  const said = (key, source) => (ui.yours[key] ? 'your answer' : source);
  const rotationSource = field?.sampleId ? 'set for this sample farm' : fromMap && rotation ? 'from the state crop map' : 'tell us';
  $('l-rotation').textContent = `You grow now · ${said('rotation', rotationSource)}`;
  $('l-water').textContent = `Water · ${said('water', fromMap ? 'from the state crop map' : 'our first guess')}`;
  $('l-crop').textContent = `Crop to check${ui.yours.crop ? ' · your answer' : ''}`;
  $('l-priority').textContent = `What matters most${ui.yours.priority ? ' · your answer' : ''}`;
  const partner = fromMap ? rotatesWith(field.props) : '';
  const recorded = fromMap ? [clean(field.props.crop), partner ? `rotates with ${partner}` : ''].filter(Boolean).join(', ') : '';
  $('n-rotation').textContent = recorded ? `The state crop map lists this field as ${recorded}.` : 'The state crop map has nothing for this spot.';
  $('n-water').textContent = fromMap ? `The state crop map says: ${irrigationText(field.props.irr)}.` : 'Most fields here are dryland.';
  $('dock-lead').textContent = rotation ? 'We filled in four answers.' : 'Tell us what you grow now.';
  $('dock-rest').textContent = rotation ? 'Edit any that are off.' : 'We filled in the rest. Edit any that are off.';
  const rotationRow = ui.root.querySelector('.ans[data-key="rotation"]');
  if (!rotationRow.classList.contains('open')) rotationRow.querySelector('.change .word').textContent = rotation ? 'Edit' : 'Choose';
}

function openRow(row, open) {
  for (const other of ui.root.querySelectorAll('.ans.open')) {
    if (other !== row || !open) setRow(other, false);
  }
  if (open) setRow(row, true);
}

function setRow(row, open) {
  row.classList.toggle('open', open);
  ui.root.classList.toggle('editing', Boolean(ui.root.querySelector('.ans.open')));
  const button = row.querySelector('.change');
  button.setAttribute('aria-expanded', String(open));
  const key = row.dataset.key;
  button.querySelector('.word').textContent = open ? 'Done' : key === 'rotation' && !state.answers.rotation ? 'Choose' : 'Edit';
}

function closeRows() {
  for (const row of ui.root.querySelectorAll('.ans.open')) setRow(row, false);
}

function wireAnswers() {
  for (const row of ui.root.querySelectorAll('.ans')) {
    const button = row.querySelector('.change');
    button.addEventListener('click', () => {
      const open = !row.classList.contains('open');
      openRow(row, open);
      if (!open) return;
      const first = row.dataset.key === 'crop' && !coarse()
        ? $('crop-find')
        : row.querySelector('input[type="radio"]:checked') ?? row.querySelector('input[type="radio"]');
      first?.focus({ preventScroll: true });
      if (row.dataset.key === 'crop') {
        const box = $('crop-box');
        const picked = box.querySelector('input:checked')?.closest('.opt');
        if (picked) box.scrollTop = Math.max(0, picked.offsetTop - box.offsetTop - 60);
      }
    });
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !row.classList.contains('open')) return;
      setRow(row, false);
      button.focus();
    });
    row.addEventListener('change', (event) => {
      const { name, value } = event.target;
      if (!['rotation', 'water', 'crop', 'priority'].includes(name)) return;
      ui.yours[name] = true;
      state.update({ answers: { [name]: value } });
      announce(`${row.querySelector('.ans-label').textContent.split(' · ')[0]}: ${row.querySelector('.ans-value').textContent}.`);
    });
    // A choice made with the mouse or a finger closes the row. Arrow keys keep it open.
    row.addEventListener('click', (event) => {
      if (event.target.type !== 'radio' || event.detail === 0) return;
      const screen = ui;
      setTimeout(() => {
        if (screen !== ui || !row.classList.contains('open')) return;
        setRow(row, false);
        button.focus({ preventScroll: true });
      }, 220);
    });
  }
  $('crop-find').addEventListener('input', filterCrops);
}

/* "Crop to check": every crop in data/crop-needs.json, under its group. */
async function fillCrops() {
  const screen = ui;
  let crops;
  try {
    crops = await cropNeeds();
  } catch (error) {
    console.warn('The crop list did not load:', error);
    if (screen === ui) $('n-crop').textContent = TEXT.cropsFailed;
    return;
  }
  if (screen !== ui) return;
  const box = $('crop-box');
  box.replaceChildren();
  for (const { group, names } of cropGroups(crops)) {
    const title = document.createElement('p');
    title.className = 'crop-group';
    title.textContent = group;
    const options = document.createElement('div');
    options.className = 'opts';
    for (const name of names) {
      const label = document.createElement('label');
      label.className = 'opt';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'crop';
      input.value = name;
      const text = document.createElement('span');
      text.textContent = name;
      label.append(input, text);
      options.append(label);
    }
    box.append(title, options);
  }
  $('n-crop').textContent = `${count(crops.length)} crops. ${TEXT.cropNote}`;
  const names = new Set(crops.map((crop) => crop.name));
  if (!names.has(state.answers.crop) && names.has('Peas')) state.update({ answers: { crop: 'Peas' } });
  showAnswers();
}

function filterCrops() {
  const typed = foldText($('crop-find').value);
  let shown = 0;
  for (const options of $('crop-box').querySelectorAll('.opts')) {
    let inGroup = 0;
    for (const label of options.children) {
      const match = !typed || foldText(label.textContent).includes(typed);
      label.hidden = !match;
      if (match) inGroup += 1;
    }
    options.hidden = inGroup === 0;
    options.previousElementSibling.hidden = inGroup === 0;
    shown += inGroup;
  }
  $('n-crop').textContent = shown ? `${shown} ${plural(shown, 'crop', 'crops')} shown.` : 'No crop by that name. Check the spelling.';
}

/* "See my plan" needs a field or a pin. The router also calls this when someone opens Plan or
   Proof with no field picked. */
export function askForField() {
  if (!ui || state.field) return;
  if (ui.stage !== 'start') setStage('start');
  setStatus(TEXT.needField, true);
  (ui.mode === 'land' ? $('land-sec') : $('town-input')).focus({ preventScroll: true });
}

/* ---------- The list: picking a field without the map ---------- */

function showList(v, ready) {
  const fields = ready.flatMap((record) => record.fields);
  const near = fieldsNear(fields, v.centre, v.bounds, MAX_LISTED);
  const key = near.map((feature) => feature.id).join(',');
  if (key === ui.listKey) return;
  ui.listKey = key;
  const focusedId = document.activeElement?.dataset?.fieldId;
  ui.listed = new Map(near.map((feature) => [String(feature.id), feature]));
  $('field-list').replaceChildren(...near.map((feature) => {
    const props = feature.properties;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fieldrow';
    button.dataset.fieldId = String(feature.id);
    const crop = document.createElement('b');
    crop.textContent = clean(props.crop) || 'Crop not recorded';
    const facts = document.createElement('span');
    facts.textContent = `${Number.isFinite(props.ac) ? `${count(props.ac)} ac` : 'size not recorded'} · ${irrigationText(props.irr)}`;
    button.append(crop, ' ', facts);
    const item = document.createElement('li');
    item.append(button);
    return item;
  }));
  const fieldsWord = near.length === 1 ? 'one field' : `${near.length} fields`;
  const middle = ui.map ? 'the middle of the map, under the cross' : 'this spot';
  $('list-note').textContent = near.length
    ? `The ${fieldsWord} nearest ${middle}.${ui.map ? ' Move the map to see others.' : ''}`
    : 'No field outlines in this part of the map. Move the map, or pin the middle of it.';
  if (focusedId) $('field-list').querySelector(`[data-field-id="${focusedId}"]`)?.focus({ preventScroll: true });
}

/* On a phone the list covers the lower part of the map. The map's middle, and the cross that
   marks it, move up into the part that still shows. */
function aimForList() {
  if (!ui.map) return;
  const bottom = phone() && ui.listOpen ? $('lower').offsetHeight : 0;
  ui.root.querySelector('.crosshair').style.top = bottom ? `${(ui.root.clientHeight - bottom) / 2}px` : '';
  if (ui.map.getPadding().bottom !== bottom) ui.map.easeTo({ padding: { ...ZERO, bottom }, duration: reducedMotion() ? 0 : 300 });
}

function openList() {
  ui.listOpen = true;
  ui.listKey = '';
  setStage('arrived');
  showArrived();
  aimForList();
  $('list-title').focus({ preventScroll: true });
}

function closeList(focus = true) {
  ui.listOpen = false;
  lightOutline(null);
  setStage('arrived');
  aimForList();
  if (focus) $('open-list').focus({ preventScroll: true });
}

function wireList() {
  const list = $('field-list');
  $('open-list').addEventListener('click', () => (ui.listOpen ? closeList() : openList()));
  $('close-list').addEventListener('click', () => closeList());
  $('dock').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.listOpen) closeList();
  });
  list.addEventListener('click', (event) => {
    const feature = ui.listed.get(event.target.closest('[data-field-id]')?.dataset.fieldId);
    if (feature) pickFeature(feature);
  });
  const light = (event) => lightOutline(ui.listed.get(event.target.closest('[data-field-id]')?.dataset.fieldId) ?? null);
  list.addEventListener('mouseover', light);
  list.addEventListener('focusin', light);
  list.addEventListener('mouseleave', () => lightOutline(null));
  $('pin-middle').addEventListener('click', () => pickAt(view().centre));
  $('pin-middle-2').addEventListener('click', () => pickAt(view().centre));
  for (const type of ['mouseenter', 'focus']) $('pin-middle').addEventListener(type, () => ui.root.classList.add('aim'));
  for (const type of ['mouseleave', 'blur']) $('pin-middle').addEventListener(type, () => ui.root.classList.toggle('aim', ui.listOpen));
  $('zoom-middle').addEventListener('click', () => zoomToFarm(view().centre));
}

/* ---------- Way in 1: a town ---------- */

function loadTowns() {
  const screen = ui;
  if (screen.townsRequest) return screen.townsRequest;
  screen.townsRequest = places()
    .then((file) => {
      if (!townIndexCache.has(file)) townIndexCache.set(file, indexPlaces(file.places));
      screen.townIndex = townIndexCache.get(file);
      if (screen === ui && $('town-input').value) updateTownMatches();
    })
    .catch((error) => {
      console.warn('The town list did not load:', error);
      screen.townsRequest = null;
      if (screen === ui) setStatus(TEXT.townFailed, true);
    });
  return screen.townsRequest;
}

function townListOpen() {
  return ui.townOpen && ui.townMatches.length > 0;
}

function showTownList() {
  const input = $('town-input');
  const list = $('town-list');
  const open = townListOpen();
  list.replaceChildren(...(open ? ui.townMatches.map((place, i) => {
    const option = document.createElement('li');
    option.id = `town-option-${i}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(i === ui.townActive));
    option.dataset.index = String(i);
    const stateName = document.createElement('span');
    stateName.textContent = place.state;
    option.append(`${place.name},`, stateName);
    return option;
  }) : []));
  list.hidden = !open;
  if (open) {
    const room = ui.root.getBoundingClientRect().bottom - $('town-form').getBoundingClientRect().bottom - 26;
    list.style.maxHeight = `${Math.max(140, Math.min(368, room))}px`;
  }
  input.setAttribute('aria-expanded', String(open));
  if (open && ui.townActive >= 0) {
    input.setAttribute('aria-activedescendant', `town-option-${ui.townActive}`);
    list.children[ui.townActive].scrollIntoView({ block: 'nearest' });
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function closeTownList() {
  if (!ui) return; // the town box loses focus as the screen is taken off the page
  ui.townOpen = false;
  ui.townActive = -1;
  showTownList();
}

function updateTownMatches() {
  const typed = $('town-input').value;
  ui.townMatches = ui.townIndex ? searchPlaces(ui.townIndex, typed) : [];
  ui.townActive = -1;
  ui.townOpen = true;
  showTownList();
  if (typed.trim().length < MIN_QUERY_LETTERS) {
    setStatus('');
  } else if (!ui.townIndex) {
    setStatus(TEXT.townLoading);
  } else if (!ui.townMatches.length) {
    setStatus('No town by that name. Check the spelling, or try the nearest larger town.', true);
  } else {
    setStatus('');
    const found = ui.townMatches.length;
    announce(`${found} ${plural(found, 'town', 'towns')} in the list. Use the arrow keys.`);
  }
}

function onTownKey(event) {
  const total = ui.townMatches.length;
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && total) {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    ui.townActive = !townListOpen() || ui.townActive === -1
      ? (step > 0 ? 0 : total - 1)
      : (ui.townActive + step + total) % total;
    ui.townOpen = true;
    showTownList();
  } else if (event.key === 'Enter' && townListOpen() && ui.townActive >= 0) {
    event.preventDefault();
    chooseTown(ui.townMatches[ui.townActive]);
  } else if (event.key === 'Escape') {
    if (townListOpen()) {
      closeTownList();
    } else {
      $('town-input').value = '';
      updateTownMatches();
    }
  }
}

async function submitTown(event) {
  event.preventDefault();
  const typed = $('town-input').value.trim();
  if (!ui.townIndex) {
    setStatus(TEXT.townLoading);
    const screen = ui;
    await loadTowns();
    if (screen !== ui || !ui.townIndex) return;
  }
  const best = searchPlaces(ui.townIndex, typed, 1)[0];
  if (best) chooseTown(best);
  else if (typed.length < MIN_QUERY_LETTERS) setStatus(`Type at least ${MIN_QUERY_LETTERS} letters of your town’s name.`, true);
  else setStatus(`We could not find a town called “${typed}”. Check the spelling, or try the nearest larger town.`, true);
}

async function chooseTown(place) {
  const mine = newSearch();
  clearField();
  $('town-input').value = placeLabel(place);
  closeTownList();
  setStatus('');
  ui.place = placeLabel(place);
  ui.hasSection = false;
  setBanner({ eyebrow: 'Flying to', title: placeLabel(place) });
  setStage('flying');
  announce(`Flying to ${placeLabel(place)}.`);
  await move({ center: [place.lon, place.lat], zoom: townZoom(place.landSqMi) });
  if (!mine()) return;
  settle();
  announce(`This is the area around ${placeLabel(place)}. ${$('banner-title').textContent}`);
  focusTitle();
}

function wireTown() {
  const input = $('town-input');
  input.addEventListener('focus', loadTowns);
  input.addEventListener('input', updateTownMatches);
  input.addEventListener('keydown', onTownKey);
  input.addEventListener('blur', closeTownList);
  $('town-list').addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the box
  $('town-list').addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) chooseTown(ui.townMatches[Number(option.dataset.index)]);
  });
  $('town-form').addEventListener('submit', submitTown);
}

/* ---------- Way in 2: a land code (Washington, from the BLM land survey) ---------- */

function landInputs() {
  return { section: $('land-sec'), township: $('land-twp'), range: $('land-rng') };
}

function markLand(problems) {
  const wrong = new Set(problems.map(({ part }) => part));
  for (const [part, input] of Object.entries(landInputs())) {
    input.closest('.seg').dataset.invalid = String(wrong.has(part));
    if (wrong.has(part)) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', 'fa-status');
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }
}

async function fetchSection(code) {
  const response = await fetch(sectionQueryUrl(code), { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`The land survey map answered with status ${response.status}.`);
  const collection = await response.json();
  if (collection.error) throw new Error(collection.error.message ?? 'The land survey map reported an error.');
  return collection.features?.length ? collection : null;
}

async function findLandCode(event) {
  event.preventDefault();
  const mine = newSearch();
  const inputs = landInputs();
  const typed = { section: inputs.section.value, township: inputs.township.value, range: inputs.range.value };
  const problems = landCodeProblems(typed);
  markLand(problems);
  if (problems.length) {
    const nothingTyped = Object.values(typed).every((value) => !value.trim());
    setStatus(nothingTyped ? 'Type the section, township and range, like 1, 19 and 34.' : problems.map(({ message }) => message).join(' '), true);
    const first = inputs[problems[0].part];
    if (document.activeElement === first) announce($('fa-status').textContent);
    else first.focus();
    return;
  }
  const code = parseLandCode(typed);
  setStatus('Looking up your section…');
  let found;
  try {
    found = await fetchSection(code);
  } catch (error) {
    console.warn('The land code lookup failed:', error);
    if (mine()) setStatus(TEXT.lookupFailed, true);
    return;
  }
  if (!mine()) return;
  if (!found) {
    setStatus(`No ${landCodeText(code)} found in Washington. Check the numbers on your deed.`, true);
    return;
  }
  clearField();
  setStatus(TEXT.landHelp);
  ui.place = landCodeText(code);
  ui.hasSection = true;
  whenStyleReady(() => {
    ui.map.getSource('sec').setData(found);
    ui.map.setLayoutProperty('plss', 'visibility', 'visible'); // the survey grid, with the square mile
  });
  setBanner({ eyebrow: 'Flying to', title: landCodeText(code) });
  setStage('flying');
  const centre = boundsCentre(geometryBounds(found.features[0].geometry));
  await move({ center: centre, zoom: ZOOM.section });
  if (!mine()) return;
  settle();
  announce(`${landCodeText(code)}: your square mile is outlined in white. ${$('banner-title').textContent}`);
  focusTitle();
}

function setMode(mode, focus = true) {
  ui.mode = mode;
  ui.root.dataset.mode = mode;
  $('town-form').hidden = mode !== 'town';
  $('land-form').hidden = mode !== 'land';
  markLand([]);
  setStatus(mode === 'land' ? TEXT.landHelp : '');
  if (focus) (mode === 'land' ? $('land-sec') : $('town-input')).focus({ preventScroll: true });
}

/* ---------- Way in 3: I'm at my field ---------- */

function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus(TEXT.noLocation, true);
    return;
  }
  const mine = newSearch();
  setStatus('Finding you… We use your location only to find your field. Nothing is kept after you close this tab.');
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      if (!mine()) return;
      const point = [position.coords.longitude, position.coords.latitude];
      clearField();
      ui.place = 'Where you are standing';
      setStatus('');
      setBanner({ eyebrow: 'Flying to', title: 'Where you are standing' });
      setStage('flying');
      await move({ center: point, zoom: ZOOM.standing, speed: 0.9 });
      if (mine()) pickAt(point);
    },
    (error) => {
      if (mine()) setStatus(LOCATION_ERRORS[error.code] ?? LOCATION_ERRORS[2], true);
    },
    { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS },
  );
}

/* ---------- Sample farms ---------- */

/* What a sample farm is set up to grow now, read from its engine file once for each screen:
   { facts, request }. `facts` is null until the file is in, then { answer, words }. */
function sampleFacts(sampleId) {
  const screen = ui;
  const known = screen.sampleFacts.get(sampleId);
  if (known) return known;
  const record = { facts: null, request: null };
  record.request = engineById(sampleId)
    .then((engine) => {
      const crops = engine?.options?.[engine.current_option]?.crops;
      record.facts = { answer: rotationFromCrops(crops), words: rotationWords(crops, engine?.crops) };
    })
    .catch((error) => {
      console.warn('The sample farm engine file did not load:', error);
      record.facts = { answer: null, words: '' };
    })
    .then(() => {
      if (screen === ui) showAnswers();
      return record.facts;
    });
  screen.sampleFacts.set(sampleId, record);
  return record;
}

async function useSample(sample) {
  const mine = newSearch();
  clearField();
  ui.place = sample.label;
  ui.hasSection = false;
  setStatus('');
  setBanner({ eyebrow: 'Flying to', title: sample.label });
  setStage('flying');
  announce(`Flying to the ${sample.label}.`);
  // The outline arrives first (a moment), so the flight can end on the whole field in one move.
  const [fields, facts] = await Promise.all([fieldsOfCounty(sample.county), sampleFacts(sample.id).request]);
  if (!mine()) return;
  const feature = fields ? fieldAt(fields, sample.pin) : null;
  if (feature) setField(feature, sample.pin, { sampleId: sample.id, rotation: facts.answer });
  else setPin(sample.pin, { county: sample.county, sampleId: sample.id, rotation: facts.answer });
  showAnswers();
  await move(fieldCamera(state.field));
  if (!mine()) return;
  showFound(true);
}

function sampleButton(sample) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.dataset.sample = sample.id;
  const name = document.createElement('b');
  name.textContent = sample.label.replace(/\s*sample farm$/i, '');
  const hidden = document.createElement('span');
  hidden.className = 'visually-hidden';
  hidden.textContent = ' sample farm, ';
  const dim = document.createElement('span');
  dim.className = 'dim';
  dim.textContent = sampleBlurb(sample.blurb).split(/[.:]/)[0].toLowerCase();
  button.append(name, hidden, dim);
  button.addEventListener('click', () => useSample(sample));
  // Start loading the outlines as soon as the pointer or the keyboard lands on the pill.
  for (const type of ['pointerenter', 'focus']) button.addEventListener(type, () => fieldsOfCounty(sample.county), { once: true });
  return button;
}

async function fillSamples() {
  const screen = ui;
  let config;
  try {
    config = await fieldsConfig();
  } catch (error) {
    console.warn('The sample farms did not load:', error);
    return;
  }
  if (screen !== ui) return;
  screen.samples = config.fields;
  const row = $('sample-row');
  row.append(...config.fields.map(sampleButton));
  row.hidden = config.fields.length === 0;
  if (state.field?.sampleId) {
    ui.place = sampleOf(state.field)?.label ?? ui.place;
    $('place-name').textContent = ui.place || 'On the map';
    if (ui.stage === 'found') setBanner(foundCopy(state.field), true);
  }
}

/* ---------- Map views: the map, crop or rest, heat ---------- */

const HOVER = ['boolean', ['feature-state', 'hover'], false];
const CROP = ['coalesce', ['feature-state', 'crop'], -1]; // 1 a crop grew, 0 it rested, -1 no record
const FILL = {
  plain: { color: '#fff', opacity: ['case', HOVER, 0.2, 0] },
  crop: {
    color: ['match', CROP, 1, GREW, 0, RESTED, '#fff'],
    opacity: ['match', CROP, [0, 1], ['case', HOVER, 0.85, 0.7], ['case', HOVER, 0.2, 0]],
  },
};
const HEAT = ['coalesce', ['feature-state', 'heat'], -999]; // °F on the year's ECOSTRESS pass, -999 none

/* The heat view's field fill: cool to hot over the file's legend range. Fields with no reading stay clear. */
function heatFill() {
  const { low, high } = fieldHeatRange();
  const stops = FIELD_HEAT_RAMP.flatMap((colour, index) => [low + ((high - low) * index) / (FIELD_HEAT_RAMP.length - 1), colour]);
  return {
    color: ['interpolate', ['linear'], HEAT, ...stops],
    opacity: ['case', ['>', HEAT, -999], ['case', HOVER, 0.92, 0.85], ['case', HOVER, 0.2, 0]],
  };
}

const PLAY_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13M16 5.5v13" stroke-width="3"/></svg>';

function setView(view, speak = true) {
  stopPlay(false);
  ui.view = view;
  ui.root.dataset.view = view;
  for (const button of $('views').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.show === view));
  $('mv-key-crop').hidden = view !== 'crop';
  $('mv-key-heat').hidden = view !== 'heat';
  showViewBar();
  paintView();
  if (view !== 'map') writeYearLine(speak);
  writeHeatHint();
  writeHeatKey();
  showCredit();
  if (view === 'heat') loadFieldHeat();
}

/* The ECOSTRESS field heat, loaded the first time the heat view opens. */
async function loadFieldHeat() {
  const screen = ui;
  if (screen.heatRequested) return;
  screen.heatRequested = true;
  setFieldHeat(await satelliteHeat());
  if (screen !== ui) return;
  ui.heatLoaded = true;
  for (const record of ui.counties.values()) {
    record.heated = null;
    record.painted = null;
  }
  paintView();
  if (ui.view === 'heat') writeYearLine(false);
  writeHeatHint();
  writeHeatKey();
  showCredit();
}

/* The two ends of the heat legend: the 1 km squares zoomed out, the fields close in. */
function writeHeatKey(v = view()) {
  const key = heatKey(v.zoom);
  $('heat-low').textContent = key.low;
  $('heat-high').textContent = key.high;
  $('mv-key-heat').classList.toggle('fields', key.fields);
}

/* In the heat view, close in: how many fields have no colour, or to zoom out in a year with no
   field heat. Spoken politely when it comes or goes. */
function writeHeatHint(v = view()) {
  let text = '';
  if (ui.view === 'heat') {
    const { missing } = heatCounts(
      [...ui.counties.values()].flatMap((record) => heatedOf(record)),
      [...ui.counties.values()].flatMap((record) => recordedOf(record)),
      ui.year, v.bounds);
    text = heatHint(v.zoom, { year: ui.year, missing });
  }
  const hint = $('mv-hint');
  if (hint.textContent !== text) hint.textContent = text;
}

/* The year bar shows with the crop-or-rest and heat views, once the map is close in. */
function showViewBar() {
  const on = ui.view !== 'map' && ui.stage !== 'start';
  show($('mvbar'), on);
  ui.root.classList.toggle('viewing', on);
}

/* The words at the bottom left stand on the bar, however tall its line wraps. */
function watchBar() {
  const bar = $('mvbar');
  ui.barWatch = new ResizeObserver(() => ui?.root.style.setProperty('--bar-h', `${bar.offsetHeight}px`));
  ui.barWatch.observe(bar);
}

function setYear(year, speak) {
  ui.year = Math.min(VIEW_YEARS.last, Math.max(VIEW_YEARS.first, year));
  $('mv-year').value = String(ui.year);
  paintView();
  writeYearLine(speak);
  writeHeatHint();
}

/* The line over the slider. It is spoken when the farmer changes the year, or when play stops;
   not on every step of play, and not when the map moves. */
function writeYearLine(speak) {
  const line = $('mv-line');
  line.setAttribute('aria-live', speak ? 'polite' : 'off');
  if (ui.view === 'heat') {
    line.textContent = heatYearLine(ui.year, view().zoom);
    return;
  }
  const bounds = view().bounds;
  const recorded = [...ui.counties.values()].flatMap((record) => recordedOf(record));
  line.textContent = cropYearLine(ui.year, yearCounts(recorded, ui.year, bounds));
}

function recordedOf(record) {
  if (record.status !== 'ready') return [];
  record.recorded ??= recordedFields(record.fields);
  return record.recorded;
}

function heatedOf(record) {
  if (record.status !== 'ready' || !ui.heatLoaded) return [];
  record.heated ??= heatedFields(record.fields);
  return record.heated;
}

function paintView() {
  whenStyleReady(() => {
    const { map } = ui;
    if (ui.view === 'heat' && ui.heatYear !== ui.year) {
      map.getSource('heat').setTiles([heatTiles(ui.year)]);
      ui.heatYear = ui.year;
    }
    map.setLayoutProperty('heat', 'visibility', ui.view === 'heat' ? 'visible' : 'none');
    for (const record of ui.counties.values()) paintCounty(record);
  });
}

/* Colour a county's fields for the crop-or-rest or heat view, or put them back. */
function paintCounty(record) {
  const { map } = ui;
  if (!map || !ui.styleReady || record.status !== 'ready' || !map.getLayer(`${record.source}-fill`)) return;
  if (ui.view === 'crop') {
    for (const field of recordedOf(record)) {
      const grew = field.growing.get(ui.year);
      map.setFeatureState({ source: record.source, id: field.id }, { crop: grew === undefined ? -1 : Number(grew) });
    }
  }
  const heat = ui.view === 'heat' && ui.heatLoaded;
  if (heat) {
    for (const field of heatedOf(record)) {
      map.setFeatureState({ source: record.source, id: field.id }, { heat: field.heat.get(ui.year) ?? -999 });
    }
  }
  const want = ui.view === 'crop' ? 'crop' : heat ? 'heat' : 'plain';
  if ((record.painted ?? 'plain') === want) return;
  const fill = want === 'heat' ? heatFill() : FILL[want];
  map.setPaintProperty(`${record.source}-fill`, 'fill-color', fill.color);
  map.setPaintProperty(`${record.source}-fill`, 'fill-opacity', fill.opacity);
  record.painted = want;
}

function startPlay() {
  if (ui.year >= VIEW_YEARS.last) setYear(VIEW_YEARS.first, false);
  const screen = ui;
  screen.playTimer = setInterval(() => {
    if (screen !== ui) return;
    setYear(ui.year + 1, false);
    if (ui.year >= VIEW_YEARS.last) stopPlay(true);
  }, PLAY_MS);
  showPlay();
}

function stopPlay(speak) {
  if (!ui.playTimer) return;
  clearInterval(ui.playTimer);
  ui.playTimer = 0;
  showPlay();
  if (speak) writeYearLine(true);
}

function showPlay() {
  const play = $('mv-play');
  const playing = Boolean(ui.playTimer);
  play.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  play.setAttribute('aria-label', playing ? 'Pause' : 'Play the years');
}

/* ---------- Wiring ---------- */

function onStateChange() {
  showAnswers();
  drawField();
}

function wire() {
  wireTown();
  wireAnswers();
  wireList();
  $('land-form').addEventListener('submit', findLandCode);
  $('land-form').addEventListener('input', () => markLand([]));
  for (const button of ui.root.querySelectorAll('[data-way]')) {
    button.addEventListener('click', () => (button.dataset.way === 'gps' ? useMyLocation() : setMode(button.dataset.way)));
  }
  $('place').addEventListener('click', () => goStart());
  $('other-field').addEventListener('click', async () => {
    const mine = newSearch();
    clearField();
    closeRows();
    setStage('arrived');
    showArrived();
    focusTitle();
    if (ui.map && ui.map.getZoom() > ZOOM.backOut + 0.6) {
      await move({ zoom: Math.max(ZOOM.backOut, ui.map.getZoom() - 0.9), padding: ZERO, curve: 1, speed: 1.4 });
    }
    if (mine()) settle();
  });
  $('spin').addEventListener('click', () => {
    if (ui.spinning) {
      stopSpin();
      ui.map.stop();
    } else {
      startSpin(true);
    }
  });
  $('zoom-in').addEventListener('click', () => ui.map?.easeTo({ zoom: ui.map.getZoom() + 1, duration: reducedMotion() ? 0 : 320 }));
  $('zoom-out').addEventListener('click', () => ui.map?.easeTo({ zoom: ui.map.getZoom() - 1, duration: reducedMotion() ? 0 : 320 }));
  for (const button of $('views').querySelectorAll('button')) button.addEventListener('click', () => setView(button.dataset.show));
  $('mv-year').addEventListener('input', () => {
    stopPlay(false);
    setYear(Number($('mv-year').value), true);
  });
  $('mv-play').addEventListener('click', () => (ui.playTimer ? stopPlay(true) : startPlay()));
  showPlay();
  watchBar();
  ui.onResize = () => {
    clearTimeout(ui?.resizeTimer);
    if (!ui) return;
    ui.resizeTimer = setTimeout(() => {
      if (!ui?.map) return;
      if (ui.stage === 'start') ui.map.jumpTo(startView(ui.map.getCenter().lng));
      else if (ui.stage === 'found' && state.field) ui.map.jumpTo(fieldCamera(state.field));
    }, 150);
  };
  window.addEventListener('resize', ui.onResize);
}

/* ---------- Mount and unmount ---------- */

export function mount(container) {
  container.innerHTML = TEMPLATE;
  ui = newScreen(container);
  ui.indexRequest = loadIndex();
  loadSatelliteZone();
  wire();
  startMap();
  setStage('start');
  if (state.field) {
    ui.place = state.field.sampleId ? '' : 'Your field';
    showFound(false, true);
  }
  showAnswers();
  drawField();
  showCredit();
  ui.stopWatching = state.subscribe(onStateChange);
  fillCrops();
  fillSamples();
  if (state.field?.sampleId) sampleFacts(state.field.sampleId);
  if (!ui.map) loadTowns();
  else ui.map.once('load', () => ui && loadTowns());
}

export function unmount() {
  if (!ui) return;
  const screen = ui;
  ui = null;
  clearTimeout(screen.resizeTimer);
  clearInterval(screen.playTimer);
  screen.barWatch?.disconnect();
  window.removeEventListener('resize', screen.onResize);
  screen.stopWatching?.();
  screen.marker?.remove();
  screen.map?.remove();
}
