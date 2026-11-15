/* The router. It shows one screen at a time inside <main id="screen">.

   Routes: #/ (home), #/fields, #/plan, #/proof. Any other hash goes to #/. Plan and Proof need a
   picked field: without one they go to #/fields, and that screen is asked to say what is missing.

   A screen is a module that exports mount(container) and unmount(). On every route change the
   router waits for the old screen's unmount(), empties <main>, sets the page title and the header,
   calls the new screen's mount(container) and moves keyboard focus to <main>. A screen that can
   stand in for a route that needs a field also exports askForField(). */

import { state } from './state.js';
import { maps } from './map.js';

const HOME = '#/';
const FIELDS = '#/fields';

const ROUTES = {
  '#/': { name: 'home', title: 'Fieldproof', load: () => import('./home.js') },
  '#/fields': {
    name: 'fields',
    title: 'Fieldproof: Find your farm',
    load: () => import('./finder.js'),
    header: true,
  },
  '#/plan': {
    name: 'plan',
    title: 'Fieldproof: Your plan',
    load: () => import('./plan.js'),
    needsField: true,
    header: true,
  },
  '#/proof': {
    name: 'proof',
    title: 'Fieldproof: The proof',
    load: () => import('./proof.js'),
    needsField: true,
    header: true,
  },
};

const HEADER_LINKS = [
  { hash: '#/fields', text: 'Fields' },
  { hash: '#/plan', text: 'Plan' },
  { hash: '#/proof', text: 'Proof' },
];

const screenEl = document.getElementById('screen');
const headerEl = document.getElementById('app-header');
const liveEl = document.getElementById('live');
const skipLink = document.getElementById('skip');

let mounted = null; // { hash, screen } for the screen now on the page
let routeChanges = Promise.resolve(); // route changes run one after another, never two at once

/* The hash the app should be showing, after the rules above. `sentBack` is true when the person
   asked for a screen that needs a field and has not picked one yet. */
function resolveRoute() {
  const hash = window.location.hash;
  const route = ROUTES[hash];
  if (!route) return { hash: HOME, sentBack: false };
  if (route.needsField && !state.field) return { hash: FIELDS, sentBack: true };
  return { hash, sentBack: false };
}

function renderHeader(route, hash) {
  headerEl.hidden = !route.header;
  if (!route.header) {
    headerEl.replaceChildren();
    return;
  }
  const links = HEADER_LINKS.map((link) => {
    const current = link.hash === hash ? ' aria-current="page"' : '';
    return `<a href="${link.hash}"${current}>${link.text}</a>`;
  });
  headerEl.innerHTML = `
    <a class="brand" href="${HOME}" aria-label="Fieldproof home">Field<span>proof</span></a>
    <nav aria-label="Main">${links.join('')}</nav>`;
}

function showLoadError() {
  const title = document.createElement('h1');
  title.textContent = 'This page could not load';
  const text = document.createElement('p');
  text.textContent = 'Check your connection and reload the page, or go back to the start.';
  const home = document.createElement('a');
  home.className = 'btn';
  home.href = HOME;
  home.textContent = 'Back to the start';
  const box = document.createElement('div');
  box.className = 'load-error';
  box.append(title, text, home);
  screenEl.replaceChildren(box);
}

async function leave() {
  if (!mounted) return;
  const { screen } = mounted;
  mounted = null;
  try {
    await screen.unmount?.();
  } catch (error) {
    console.error('A screen did not close cleanly:', error);
  }
  screenEl.replaceChildren();
}

async function enter(hash) {
  const route = ROUTES[hash];
  document.title = route.title;
  document.body.dataset.route = route.name;
  liveEl.textContent = '';
  renderHeader(route, hash);
  window.scrollTo(0, 0);

  let screen = null;
  try {
    screen = await route.load();
    await screen.mount(screenEl);
  } catch (error) {
    console.error(`The ${route.name} screen could not load:`, error);
    try {
      await screen?.unmount?.();
    } catch {
      // The screen never finished starting, so there may be nothing to close.
    }
    screen = null;
    showLoadError();
  }
  mounted = { hash, screen: screen ?? {} };
}

async function showCurrentRoute() {
  const { hash, sentBack } = resolveRoute();
  if (hash !== window.location.hash) window.history.replaceState(null, '', hash);

  if (mounted?.hash !== hash) {
    const isFirstScreen = mounted === null;
    await leave();
    await enter(hash);
    // On the first screen, focus stays at the top of the page so Tab starts at the skip link.
    if (!isFirstScreen) screenEl.focus({ preventScroll: true });
  }
  // A link to Plan or Proof with no field picked must not look dead: the Fields screen says why.
  if (sentBack) mounted.screen.askForField?.();
}

function queueRouteChange() {
  routeChanges = routeChanges
    .then(showCurrentRoute)
    .catch((error) => console.error('The route change failed:', error));
}

/* The skip link points at #screen, which is not a route: handle it here instead of in the URL. */
function skipToMain(event) {
  event.preventDefault();
  screenEl.focus({ preventScroll: true });
  screenEl.scrollIntoView();
}

/* For browser checks and debugging: the state, and every live map by name. */
window.__fieldproof = { state, maps };

skipLink.addEventListener('click', skipToMain);
window.addEventListener('hashchange', queueRouteChange);
queueRouteChange();
