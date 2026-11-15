/* Home screen (#/): the hero photo that drifts over the Palouse, why it matters, how it works,
   the data behind it, and the way in. The hero map exists only while this screen is mounted. */

import { createMap, reducedMotion } from './map.js';

/* Where the hero starts: green wheat country between Colfax and Palouse, Washington. */
const HERO_VIEW = { center: [-117.25, 46.88], zoom: 13.6, pitch: 62, bearing: -20 };

/* The drift: every step the camera turns a little and moves a little along a slow loop about
   3 miles across, so it never leaves the Palouse however long the page stays open. */
const DRIFT = {
  stepMs: 4000,
  bearingPerStep: 4,
  loopRadiusDeg: 0.03,
  stepsPerLoop: 47,
};

const TEMPLATE = `
<div class="home">
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-film" aria-hidden="true" inert></div>

    <div class="topbar">
      <div class="brand">Field<span>proof</span></div>
      <nav aria-label="On this page">
        <button type="button" class="navlink" data-scroll-to="why">Why</button>
        <button type="button" class="navlink" data-scroll-to="how">How it works</button>
        <button type="button" class="navlink" data-scroll-to="data">NASA data</button>
      </nav>
    </div>

    <div class="filmtag">
      <p>Real aerial photo · USDA<br>Wheat fields in the Palouse, WA</p>
      <button type="button" class="motion-toggle" hidden></button>
    </div>

    <div class="herotext">
      <div>
        <h1 id="hero-title">What should you grow between your wheat years?</h1>
        <p>NASA weather records for your own field. An answer that fits your field and your finances.</p>
      </div>
      <div class="hero-actions">
        <a class="pill" href="#/fields">Find my farm</a>
        <button type="button" class="ghost" data-scroll-to="why">See why</button>
      </div>
    </div>
  </section>

  <section class="band" id="why" tabindex="-1" aria-labelledby="why-title">
    <p class="eyebrow">Spring 2021, Adams County, Washington</p>
    <h2 id="why-title">The driest spring in 45 years of NASA records. Washington's wheat harvest fell by almost half.</h2>
    <ul class="stats3" role="list">
      <li>
        <strong>0.63 in</strong>
        <span>of rain from April to June at the WSU trial site</span>
        <small>Source: NASA POWER, 1981–2025</small>
      </li>
      <li>
        <strong>−48%</strong>
        <span>Washington wheat harvest, 2021 vs. 2020</span>
        <small>Source: USDA NASS</small>
      </li>
      <li>
        <strong>$118M</strong>
        <span>crop insurance paid to Adams County wheat growers, 2021–2024</span>
        <small>Source: USDA RMA</small>
      </li>
    </ul>
    <p class="band-point">Know what a dry year costs before you switch.</p>
    <p class="band-note">Each number covers a different area.</p>
    <details class="home-more">
      <summary>Where these numbers come from</summary>
      <p>Rain is for the Ritzville area (NASA POWER). Insurance is for Adams County (USDA RMA). The harvest drop is for all of Washington (USDA NASS).</p>
    </details>
  </section>

  <section class="band" id="how" tabindex="-1" aria-labelledby="how-title">
    <p class="eyebrow">How it works</p>
    <h2 id="how-title">One honest answer for your fields, before you seed.</h2>
    <ol class="steps3" role="list">
      <li>
        <div class="step-number" aria-hidden="true">01</div>
        <h3>Find your farm</h3>
        <p>Pin your field on the map. In three Washington counties, the state crop map fills in what grows there.</p>
      </li>
      <li>
        <div class="step-number" aria-hidden="true">02</div>
        <h3>Check a new crop</h3>
        <p>Any of 55 crops. See if it can grow on your field, and what it earns next to what you grow now.</p>
      </li>
      <li>
        <div class="step-number" aria-hidden="true">03</div>
        <h3>See the risk</h3>
        <p>What each choice earns in a normal year, a dry year and the worst year, what would change the answer, and how the advice held up in past years.</p>
      </li>
    </ol>
  </section>

  <section class="band" id="data" tabindex="-1" aria-labelledby="data-title">
    <p class="eyebrow">Built on public data</p>
    <h2 id="data-title">NASA weather, USDA harvests and prices, and university cost budgets.</h2>
    <p class="band-lede">Weather and harvest records from NASA and USDA. Every number on screen shows where it came from.</p>
    <details class="home-more">
      <summary>Sources</summary>
      <ul>
        <li>NASA POWER weather</li>
        <li>NASA HLS satellite record (Landsat and Sentinel-2) for fields in Adams, Lincoln and Whitman counties</li>
        <li>NASA MODIS ground heat, through NASA GIBS, for the wider region</li>
        <li>NASA ECOSTRESS ground heat, from the Space Station</li>
        <li>NASA GIBS and USDA NAIP imagery</li>
        <li>USDA NASS harvests and prices, and USDA RMA crop insurance</li>
        <li>WSU and University of Idaho crop budgets</li>
        <li>Washington state crop map</li>
        <li>FAO EcoCrop</li>
      </ul>
    </details>
  </section>

  <section class="band cta" aria-labelledby="cta-title">
    <h2 id="cta-title">See what your fields can do.</h2>
    <a class="pill" href="#/fields">Find my farm</a>
  </section>
</div>`;

let hero = null; // { map, moving, step, bearing, warned } while the hero map is alive

/* The camera centre after `step` steps: a loop that starts at the hero view, heading east. */
function driftCenter(step) {
  const [lon, lat] = HERO_VIEW.center;
  const angle = (2 * Math.PI * step) / DRIFT.stepsPerLoop;
  const northScale = Math.cos((lat * Math.PI) / 180); // keeps the loop round on the ground
  return [
    lon + DRIFT.loopRadiusDeg * Math.sin(angle),
    lat + DRIFT.loopRadiusDeg * northScale * (1 - Math.cos(angle)),
  ];
}

function driftOneStep() {
  hero.step += 1;
  hero.bearing += DRIFT.bearingPerStep;
  hero.map.easeTo({
    center: driftCenter(hero.step),
    bearing: hero.bearing,
    duration: DRIFT.stepMs,
    easing: (t) => t,
    // The drift only runs when the person has not asked for less motion, or has pressed Play.
    essential: true,
  });
}

function continueDrift() {
  if (hero?.moving && !hero.map.isMoving()) driftOneStep();
}

function showMotionState(button) {
  button.textContent = hero.moving ? 'Pause motion' : 'Play motion';
}

function toggleMotion(button) {
  hero.moving = !hero.moving;
  showMotionState(button);
  if (hero.moving) {
    continueDrift();
  } else {
    hero.map.stop();
  }
}

/* The photo is decoration: if tiles fail, say so once and carry on with what loaded. */
function warnOnce(event) {
  if (!hero || hero.warned) return;
  hero.warned = true;
  console.warn('The hero photo did not fully load:', event.error?.message ?? 'unknown error');
}

function startHero(container) {
  const map = createMap(container.querySelector('.hero-film'), {
    name: 'hero',
    ...HERO_VIEW,
    maxPitch: HERO_VIEW.pitch, // MapLibre stops at 60 degrees unless told otherwise
    interactive: false,
    attributionControl: false, // the corner label credits the photo; the map itself is hidden from assistive tech
  });
  if (!map) return; // no map here: the hero keeps its plain dark-green background

  hero = { map, moving: !reducedMotion(), step: 0, bearing: HERO_VIEW.bearing, warned: false };
  map.on('error', warnOnce);
  map.once('load', continueDrift);
  map.on('moveend', continueDrift);

  const button = container.querySelector('.motion-toggle');
  button.hidden = false;
  showMotionState(button);
  button.addEventListener('click', () => toggleMotion(button));
}

function stopHero() {
  if (!hero) return;
  hero.moving = false;
  hero.map.remove();
  hero = null;
}

function scrollToSection(container, id) {
  const section = container.querySelector(`#${id}`);
  section.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
  section.focus({ preventScroll: true });
}

function wireScrollButtons(container) {
  for (const button of container.querySelectorAll('[data-scroll-to]')) {
    button.addEventListener('click', () => scrollToSection(container, button.dataset.scrollTo));
  }
}

export function mount(container) {
  container.innerHTML = TEMPLATE;
  wireScrollButtons(container);
  startHero(container);
}

export function unmount() {
  stopHero();
}
