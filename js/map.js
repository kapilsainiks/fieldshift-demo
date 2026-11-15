/* Shared MapLibre style and helpers. MapLibre GL itself is loaded by index.html (window.maplibregl).

     const map = createMap(element, { name: 'globe', center: [-100, 30], zoom: 1.9 });
     if (!map) { ...show the text way to do the task... }
     await fly(map, { center: pin, zoom: 14 });     // jumps when reduced motion is on
     const marker = addPin(map, pin);               // the red pin on the picked field
     foldCredits(map);                              // close the map credits; the "i" button opens them
     map.remove();                                  // always, in the screen's unmount()

   Every map made here is listed in `maps` under its name until it is removed. main.js shows that
   list as window.__fieldproof.maps, so browser checks can reach the live maps. */

const BLUE_MARBLE_TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
  + 'BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const USGS_IMAGERY_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/'
  + 'USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';

/* NASA Blue Marble from space, fading into USGS aerial photos (USDA NAIP) as you zoom in. */
export const STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    bm: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 8,
      attribution: 'NASA GIBS Blue Marble',
      tiles: [BLUE_MARBLE_TILES],
    },
    usgs: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 16,
      attribution: 'USGS The National Map (USDA NAIP)',
      tiles: [USGS_IMAGERY_TILES],
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#02040b' } },
    { id: 'bm', type: 'raster', source: 'bm' },
    {
      id: 'usgs',
      type: 'raster',
      source: 'usgs',
      minzoom: 5,
      paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 1] },
    },
  ],
  sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
};

/* The live maps, by name. */
export const maps = {};

/* True when the person has asked their device for less motion. Read it each time: it can change. */
export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* Make a map with the shared style. `options` are MapLibre map options, plus an optional `name`
   for the debug list. Returns null when a map cannot start here (MapLibre did not load, or the
   browser has no WebGL), so the caller can fall back to its text way of doing the task. */
export function createMap(container, options = {}) {
  const { name, ...mapOptions } = options;
  if (!window.maplibregl) {
    console.warn('The map library did not load, so no map is shown.');
    return null;
  }
  try {
    const map = new window.maplibregl.Map({
      container,
      style: structuredClone(STYLE),
      attributionControl: { compact: true },
      ...mapOptions,
    });
    if (name) listMap(name, map);
    return map;
  } catch (error) {
    console.warn('The map could not start:', error);
    return null;
  }
}

function listMap(name, map) {
  maps[name] = map;
  map.once('remove', () => {
    if (maps[name] === map) delete maps[name];
  });
}

const PIN_COLOR = '#d63a3a';

/* Put the red pin on the map at [lon, lat]. Gives back the marker: move it with setLngLat(), take
   it off with remove(). */
export function addPin(map, point) {
  return new window.maplibregl.Marker({ color: PIN_COLOR }).setLngLat(point).addTo(map);
}

/* MapLibre opens the map credits at the start and folds them at the first drag. Where they would
   cover too much of a small map, fold them right away: the round "i" button opens them again. */
export function foldCredits(map) {
  const credits = map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
  credits?.classList.remove('maplibregl-compact-show');
  credits?.removeAttribute('open');
}

let flightCount = 0;

/* Move the camera: a flight, or a jump when reduced motion is on. `options` are MapLibre flyTo
   options. The promise settles when this move has ended (also when another move cuts it short).
   Each move carries its own number, so the end of some other move is never taken for this one. */
export function fly(map, options) {
  const flight = ++flightCount;
  return new Promise((resolve) => {
    // Resolve on the first moveend after this flight starts, even when a drag, a scroll or
    // another flight interrupted it (those moveends carry no flight id). A timer is the backstop,
    // so the screen can never stay stuck in "flying".
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off('moveend', onMoveEnd);
      clearTimeout(timer);
      resolve();
    };
    const onMoveEnd = (event) => {
      if (event.flight === flight) return finish();
      // Ignore the globe's spin and the end of the move this flight replaced; finish only when a
      // drag or scroll stopped this flight and the map is now still.
      if (event.spin || event.flight !== undefined) return;
      setTimeout(() => { if (!map.isMoving()) finish(); }, 0);
    };
    const timer = setTimeout(finish, (options.maxDuration ?? 7000) + 1500);
    map.on('moveend', onMoveEnd);
    if (reducedMotion()) {
      map.jumpTo(options, { flight });
    } else {
      map.flyTo(options, { flight });
    }
  });
}
