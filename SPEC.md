# Fieldproof app: build spec

Fieldproof helps a dryland farmer decide whether to change what they grow, and shows the smallest
safe test. This spec turns the click-through mock (`app/index.html`, one file with inline CSS and JS)
into the real app. Keep what the mock does unless this spec changes it.

## 0. Ground rules

- **Static site, no framework, no build step, no new dependencies.** Plain HTML, CSS and ES modules.
  MapLibre GL 5.6.0 from unpkg stays. It must run from `python3 -m http.server` inside `app/` and
  from any static host under a sub-path, so every URL is relative.
- **No dead controls.** Every button, tab and link does something. Remove the ones that do nothing.
- **Accessibility is required** (WCAG 2.2 AA): keyboard reaches everything, visible focus (the
  existing 3px outline), 44px targets, labels on inputs, `aria-live` for changed results, text
  contrast 4.5:1, no meaning by color alone, `prefers-reduced-motion` stops the hero drift, the
  globe spin and fly animations (jump instead). Every chart has a table or text with the same facts.
  The map is never the only way to do a task (see 3.4).
- **Wording.** Plain words, short sentences, no jargon. Never write "made up", "fictional",
  "simulated farm" or similar. Never say or imply that climate change will cut yields here. Every
  number shows where it came from. If data is missing, say what is missing and show no number.
- **Money comes only from the engine files** in `data/engine/`. Delete the mock's hard-coded
  `BASE`, `MONEY` and `addMoney` money math. Do not invent prices, yields or costs.
- Do not edit anything in `data/` or `tests/fixtures/`. They are produced by `tools/` and `fieldshift/`.

## 1. Files

```
app/index.html          page shell only; loads the css files and js/main.js (type=module)
app/css/base.css        tokens, type, buttons, focus, header; then one file per screen:
app/css/home.css  finder.css  plan.css  proof.css
app/js/main.js          hash router; mounts one screen module at a time
app/js/state.js         the one state object, saved to sessionStorage
app/js/data.js          fetch + cache of data files, NASA POWER call
app/js/map.js           shared MapLibre style and helpers
app/js/engine.js        pure functions, no DOM (section 5)
app/js/growcheck.js     pure functions, no DOM (section 6)
app/js/format.js        pure formatting helpers
app/js/home.js  finder.js  plan.js  proof.js     one per screen: export mount(container) and unmount()
app/js/*-util.js        pure helpers for a screen, so they can be tested
app/tests/*.test.js     node:test, run with `node --test app/tests/`
app/tests/browser/*.mjs headless Chrome checks, run with `node app/tools/browser_check.mjs <script>`
app/README.md           how to run, how to test, where each data file comes from
```
Each screen module builds its own markup inside the container it is given. Only the shell owns
`index.html`, `base.css`, `main.js`, `state.js`, `data.js` and `map.js`.

Routing: hash routes `#/`, `#/fields`, `#/plan`, `#/proof`. Back and forward work. The picked
field, answers and crop live in one state object and in `sessionStorage` (wrapped in try/catch), so
a reload keeps them. `#/plan` or `#/proof` with no field goes to `#/fields`.

## 2. Home (`#/`)

As the mock, with these changes:
- Hero background: the same slow MapLibre drift, but over the green Palouse:
  `center [-117.25, 46.88], zoom 13.6, pitch 62, bearing -20`. Corner label:
  "Real aerial photo · USDA" / "Wheat fields in the Palouse, WA". The map is `aria-hidden` and not
  focusable. The hero map is created only on the home route and removed when leaving it.
- The "Why" band keeps the three 2021 numbers and their sources. Add under it, small:
  "Numbers are for the Ritzville area, Adams County, Washington."
- "How it works" step 02 text: "Any of 55 crops. See if it can grow on your field, and what it
  earns next to what you grow now."

## 3. Fields (`#/fields`)

Split screen as the mock: one-page form on the left, globe on the right (stacked on phones).

3.1 **Sample farms.** Replace "use the sample farm" with two buttons built from
`data/engine/fields.json` (`label`, `blurb`): Ritzville sample farm and Pullman sample farm. Each
flies to its `pin`, selects the field under the pin, and fills the answers.

3.2 **Three ways to find a farm** (tabs, as the mock): Land code (BLM lookup, Washington only; say
so), Town, I'm at my field.
- Town: search `data/us-places.json` (`[name, state, lat, lon, land_sq_mi]`, 32,333 places). Load
  it the first time the Town tab opens. Accessible combobox (ARIA APG pattern): type at least 2
  letters, show up to 8 matches as "Name, ST", prefix matches first, then Washington first.
  Choosing one flies there at a zoom that shows the whole town plus farmland around it:
  `zoom = clamp(11.5 - 0.5 * log2(max(land_sq_mi, 1)), 8.5, 11.5)`. Then "Click near your farm".

3.3 **Field outlines.** `data/fields-index.json` lists one GeoJSON per county with its bbox. Never
load them on the home page. Load a county file the first time the map is at zoom >= 10 and its view
touches that county's bbox. Feature `id` is the field id; properties: `crop, irr, ac, co, rot, surv`.
Outside these counties there are no outlines: the farmer drops a pin, and the form says "Field
outlines cover Adams, Lincoln and Whitman counties so far. Your pin works everywhere."

3.4 **Without the map.** Under the map hint, when zoom >= 12 and outlines are loaded, show a list
"Fields in view" of up to 12 fields nearest the map centre, each a button: "Wheat Fallow · 620 ac ·
no irrigation". Choosing one selects it exactly like clicking its outline. Keyboard users can do the
whole flow with Land code or Town, then this list.

3.5 **Answers.** Selecting a field fills question 3 (dryland or irrigated, from `irr`) and
question 2 (as the mock). The satellite strip stays only for the three traced fields in the mock
(`FIELDS`); other fields show the state crop map line. Question 4 lists the 55 crops by group.
Question 5 becomes three choices that map to the engine priority:
"Steady income in bad years" (`steady`), "The best typical year" (`typical`), "Better soil" (`soil`).
"See my plan" goes to `#/plan`; it needs a field or a pin, otherwise it says what is missing.

## 4. Plan (`#/plan`)

Header nav: Fields · Plan · Proof (real links). Field title, meta line and "Edit field" as the mock.
Left: map with the picked field outlined. Right: decision panel. Below: rotations, conditions.

4.1 **Crop check** (as the mock): crop select with 55 crops, quick buttons, verdict box, reason
list. Local proof uses the picked field's county: `crop.local[county]`, wording "N fields in
{county} County grow it without irrigation, M with irrigation (2025 state crop map)". With a bare
pin (no county), sum all three counties and say "in Adams, Lincoln and Whitman counties".
A crop with no EcoCrop numbers shows only the local proof and says the weather fit can't be checked.

4.2 **Money: compare rotations.** If the field's county has an engine file (`fields.json`: Adams
uses ritzville, Whitman uses pullman), show a table of every engine option, ranked by the farmer's
priority, from `engine.rank()`:

| Rotation | Typical year | Bad year (1 in 5) | Worst year |

- Rows show the option label and its crops as colored chips with text. The current rotation is
  marked "What you grow now". The top row is marked "Best for: {priority}". If `tie` is true, mark
  the top two "Too close to call" and say: "These are within $10 an acre. A soil test, your buyer
  and your equipment decide."
- Options with `full_record: false` get the note "Shorter record ({first}–{last})".
- Toggle: "Today's prices" (default) / "Each year's own price". Under it:
  "Harvests are from {first}–{last}. Today's prices are USDA's {prices_today_span} averages."
- All money is shown in today's dollars: `value * engine.toTodayFactor(app)`, rounded to whole
  dollars, with a sign and words for losses ("−$12, a loss"). Caption: "Dollars per acre per year
  after seed, fertilizer, fuel and other yearly costs. Land and machinery payments are not
  counted. Costs: {field.cost_source}, adjusted for inflation."
- If the chosen crop (4.1) maps to an engine crop code (`fields.json` `crop_codes`), highlight the
  options that contain it. If it is in no option, say: "No rotation with {crop} has been tested for
  this area yet. The table shows the rotations that have."
- No engine file for the county, or a bare pin: "The money comparison covers Adams and Whitman
  counties so far. The crop check above works everywhere." No numbers.

4.3 **What would change the answer.** Shown when the chosen crop is in an option that is not the
current one (pick the best-ranked such option, call it O, crop code X).
- Price slider for X in its own unit (`$/bu` or `$/cwt`; for cwt also show ¢/lb), nominal dollars,
  from 0.4x to 2.5x today's price, default today's price.
- Yield slider: "Your {crop} yield next to the county average", −40% to +40%, default 0.
- Both re-rank the table at once (`priceOverride`, `yieldFactor`) and announce one short result.
- One line from `engine.breakEvenPrice()`: "{Crop} start beating what you grow now at {price}.
  Today: {price}." or, if O already wins, "At today's price, {O label} beats what you grow now by
  ${n} an acre." If there is no price in range: "No {crop} price in this range changes the answer."
- A "Reset" button puts both sliders back.

4.4 **Smallest safe test.** Shown with 4.3. "12 acres of {crop}, next to 12 acres of
{baseline crop name}" and the proportional bar (24 of the field's acres). From `engine.testCost()`:
"In a typical year this gives up about ${typical}. In a bad year, about ${bad}. If the {crop} fail
completely, about ${fail}." If typical is negative: "In a typical year it earns about ${n} more
than {baseline} on those acres." Map footer: "Your field is outlined. Strip placement comes later."
The button under it is "See the proof →" (`#/proof`).

4.5 **Rotation rows** ("Your rotation, 6 years"): the current option and O, built from their crop
lists repeated to 6 years, chips with text labels and patterns (wheat lines, pulse/other hatch,
rest plain). **Conditions** cards as the mock (rain, frost-free stretch, growing window), with a
text line under each chart giving the same facts.

## 5. `js/engine.js` (must match `fieldshift/recommend.py`)

`app` is a parsed engine file. Read `fieldshift/recommend.py`: port it exactly.

```
rank(app, {priority='steady', prices='hist', pulseCut=0, priceOverride={}, yieldFactor={}})
  -> {pick, runner_up, tie, gap, current_option, ranked:[{option_id,label,crops,soil_score,
      full_record,typical,bad_year,worst,bad_year_climate,years:[first,last]}]}
optionIncomes(app, optionId, opts) -> [[year, dollarsPerAcre], ...]
toTodayFactor(app)        -> prices_today.WW.nominal / prices_today.WW.real
breakEvenPrice(app, optionId, cropCode, opts) -> nominal price, or null
testCost(app, cropCode, baselineCropCode, opts) -> {typical, bad, fail}   (dollars per acre, real)
```

- With no overrides, `rank()` equals `recommend()` for all 24 cases in
  `tests/fixtures/recommend.json`: same order, `pick`, `runner_up`, `tie`, and every number within
  0.05. This includes Python's median, the bad-year rule (`_bad_year`), the weighted percentile
  and one-decimal rounding.
- `priceOverride {code: nominal}` applies only when `prices === 'today'`: real price =
  nominal / toTodayFactor(app). `yieldFactor {code: f}` multiplies that crop's yield by `1 + f`.
- `breakEvenPrice`: smallest nominal price for `cropCode`, between 0.4x and 2.5x today's, where
  the option's metric (the priority's; `soil` uses `typical`) is at least the current option's
  at today's prices. Bisection to the cent. `null` if none.
- `testCost`: per year, `d = margin(baseline) − margin(crop)` at today's prices with overrides,
  for years where both exist. `typical` = median d, `bad` = 80th percentile of d (same rule as
  `_bad_year` on the sorted list, taking the high end), `fail` = median margin(baseline) + cost of
  crop. Multiply by 12 and by `toTodayFactor` for display.

## 6. `js/growcheck.js`

Move the mock's `tempCheck`, `rainCheck` and `verdictFor` here unchanged in behavior, as pure
functions that return data (class, headline, reasons as `{kind, text}`), with the county-aware
local counts from 4.1. NASA POWER climatology is fetched in `data.js` (same URL as the mock) with
the saved Ritzville copy as fallback, and the source line says which one was used.

## 7. Proof (`#/proof`)

Title: "Did this advice hold up in past years?" All from the field's engine file, `validation`.
1. One plain paragraph: "We replayed {first}–{last}. Each time, the method could only see the years
   before. It said to switch rotations in {any_start_switches} of {any_start_windows} tests. The
   switch did at least as well in the worst year {any_start_share_worst}% of the time, and at
   least as well on average {any_start_share_mean}% of the time."
2. Table from `validation.split`: Strategy · Picked (option label) · Bad year · Worst year ·
   Average, in today's dollars, with the caption "Chosen with {train years}, scored on
   {test_years}." (Train years: `years[0]` to the year before `test_years` starts.)
3. "Hot, dry years at this field": a bar per year of spring rain (`weather[].rain_spring_mm`, shown
   in inches), hot-dry years (`hot_dry_years`) marked with a pattern and the word "hot, dry", plus
   the sentence "Hot, dry years: {list}. Source: NASA POWER." and a table toggle.
4. "What this does not prove": the field's `gaps` list from `fields.json`.
5. "Where the weather is heading", only if `data/engine/{id}-climate.json` exists
   (`trend_at_field_1981_2025`): for `heat_junjul_c` and `rain_spring_mm`, if `p_value < 0.05` say
   "has risen/fallen about {per_decade} per decade since 1981" (°C and °F; mm and inches), else
   "shows no clear trend since 1981". Then from `region.bands`: "Across the region's dryland
   farms, where spring rain is under 160 mm (6.3 in), pulses are {pulse_pct}% of acres and
   {fallow_pct}% rests each year. Where it is 230 mm (9 in) or more: {pulse_pct}% and
   {fallow_pct}%." Sources: NASA POWER, USDA Crop Sequence Boundaries.
6. "Springs to come", only if `data/engine/future-rain.json` exists (section 8).
7. Static note, with links: "Washington State University crop-model studies for this region
   project dryland wheat yields rising as CO2 rises, and less land left in fallow
   (Ahmed et al. 2017; Karimi et al. 2017). That makes 'is it time to rest less ground?' a live
   question. Fieldproof answers it for one field, with a small test."
   Links: https://www.frontiersin.org/articles/10.3389/fevo.2017.00051/full and
   https://www.frontiersin.org/articles/10.3389/fevo.2017.00020/full
A missing optional file hides its card. Nothing else on the page changes.

## 8. `data/engine/future-rain.json` (optional; may be absent while you build)

```
{"source": "NASA NEX-GDDP-CMIP6", "baseline_years": [1981, 2014], "future_years": [2040, 2059],
 "dry_spring_definition": "...", "models": ["..."],
 "fields": {"ritzville": {"scenarios": {
   "ssp245": {"label": "Middle-of-the-road emissions",
     "dry_springs_per_20yr": {"baseline": 4, "median": 5, "min": 2, "max": 9},
     "spring_rain_change_pct": {"median": -3, "min": -15, "max": 12},
     "per_model": [{"model": "...", "dry_springs": 5, "spring_rain_change_pct": -4.2}]},
   "ssp585": {"label": "High emissions", ...}}}, "pullman": {...}}}
```
Card text per scenario: "{label}: {median} dry springs in 20 years (2040–2059), next to {baseline}
in 20 years before. The {n} climate models range from {min} to {max}." Then the definition, then
"Source: NASA NEX-GDDP-CMIP6." Test this card with a fixture you write under `tests/` (its numbers
are test values only; never copy them into `data/`).

## 9. Tests (node:test, no dependencies)

- `engine.test.js`: all 24 parity cases; `toTodayFactor`; a price override that flips a ranking;
  `breakEvenPrice` returns a price at which the option's metric meets the current option's (and
  one cent lower does not); `testCost` on a hand-computed case.
- `growcheck.test.js`: peas, canola and potatoes at the Ritzville fallback climate with Adams
  counts give "Grows here", "Grows here" and "Only with irrigation"; a crop with no EcoCrop numbers
  gives no weather reasons; an irrigated field skips the rain limit.
- `format.test.js`: money signs and rounding, ¢/lb, inches.
- `data.test.js`: every file named in `fields.json` and `fields-index.json` exists and parses; every
  option's crops exist in `crops`, `crop_year` and `prices_today`.
