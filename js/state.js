/* The one state object. Every screen reads it and changes it through update().

   Shape:

     state.field      null, or the picked field:
                        id        field id from the county file (the GeoJSON feature id), or null for a bare pin
                        props     { crop, irr, ac, co, rot, surv } from the state crop map, or null for a bare pin
                        pin       [lon, lat]
                        county    'Adams' | 'Lincoln' | 'Whitman' | ... or null when it is not known
                        sampleId  'ritzville' | 'pullman' when it is a sample farm, else null
                        geometry  the field outline as a GeoJSON geometry, or null
     state.answers    { rotation: 'wf' | 'ww' | 'other' | null,
                        water:    'Dryland' | 'Irrigated',
                        crop:     a crop name from data/crop-needs.json, 'Peas' at first,
                        priority: 'steady' | 'typical' | 'soil' }
     state.priceView  'today' | 'hist'

   Use:

     state.update({ answers: { crop: 'Lentils' } })      answers merge key by key
     state.update({ field: { pin: [-118.4, 47.1] } })    field merges key by key too. When the farmer
                                                         picks a different field, pass all six keys so
                                                         nothing is left over from the last one.
     state.update({ field: null })                       forget the field
     const stop = state.subscribe(fn)                    fn(state) runs after every change; call stop() in unmount()
     state.reset()                                       back to the start

   A field needs a pin: without one it is stored as null. Keys other than field, answers and
   priceView are ignored. The values handed out are frozen: change them only through update().
   Every change is saved to sessionStorage, so a reload keeps the field and the answers. */

const STORAGE_KEY = 'fieldproof.state';

const EMPTY_FIELD = Object.freeze({
  id: null,
  props: null,
  pin: null,
  county: null,
  sampleId: null,
  geometry: null,
});

const DEFAULT_ANSWERS = Object.freeze({
  rotation: null,
  water: 'Dryland',
  crop: 'Peas',
  priority: 'steady',
});

const ALLOWED = {
  rotation: ['wf', 'ww', 'other', null],
  water: ['Dryland', 'Irrigated'],
  priority: ['steady', 'typical', 'soil'],
  priceView: ['today', 'hist'],
};

const subscribers = new Set();
let data = restore();

function defaults() {
  return { field: null, answers: DEFAULT_ANSWERS, priceView: 'today' };
}

function isPin(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/* A field is only kept if it has a usable pin; anything else means "no field". */
function cleanField(field) {
  if (!isPlainObject(field) || !isPin(field.pin)) return null;
  return Object.freeze({ ...EMPTY_FIELD, ...field });
}

function cleanAnswers(answers) {
  const merged = { ...DEFAULT_ANSWERS, ...(isPlainObject(answers) ? answers : {}) };
  for (const key of ['rotation', 'water', 'priority']) {
    if (!ALLOWED[key].includes(merged[key])) merged[key] = DEFAULT_ANSWERS[key];
  }
  if (typeof merged.crop !== 'string' || !merged.crop) merged.crop = DEFAULT_ANSWERS.crop;
  return Object.freeze(merged);
}

function clean(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    field: cleanField(source.field),
    answers: cleanAnswers(source.answers),
    priceView: ALLOWED.priceView.includes(source.priceView) ? source.priceView : 'today',
  };
}

function restore() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? clean(JSON.parse(saved)) : defaults();
  } catch {
    // No storage (private mode, a blocked cookie setting, or not a browser): start fresh.
    return defaults();
  }
}

function save() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage is full or blocked. The app still works; a reload will start over.
  }
}

function notify() {
  for (const fn of subscribers) {
    try {
      fn(state);
    } catch (error) {
      console.error('A state subscriber failed:', error);
    }
  }
}

function mergeField(current, patch) {
  if (patch === null) return null;
  return { ...(current ?? EMPTY_FIELD), ...patch };
}

function update(patch) {
  if (!isPlainObject(patch)) return;
  const next = { ...data };
  if ('field' in patch) next.field = mergeField(data.field, patch.field);
  if ('answers' in patch) next.answers = { ...data.answers, ...patch.answers };
  if ('priceView' in patch) next.priceView = patch.priceView;
  data = clean(next);
  save();
  notify();
}

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function reset() {
  data = defaults();
  save();
  notify();
}

export const state = {
  get field() {
    return data.field;
  },
  get answers() {
    return data.answers;
  },
  get priceView() {
    return data.priceView;
  },
  update,
  subscribe,
  reset,
};
