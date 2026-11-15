/* Boxes, points and field outlines. Pure functions shared by the Fields and Plan screens: no DOM,
   no fetch, no globals.

   A point is [lon, lat]. A box is [west, south, east, north]. A geometry is a GeoJSON Polygon or
   MultiPolygon, the two shapes a field outline can have. */

/* Every ring of a Polygon or MultiPolygon, outer rings and holes alike. */
function ringsOf(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates;
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

/* ---------- Boxes ---------- */

/* The box around a geometry, or null when it has no points. */
export function geometryBounds(geometry) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of ringsOf(geometry)) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return west === Infinity ? null : [west, south, east, north];
}

export function boundsCentre([west, south, east, north]) {
  return [(west + east) / 2, (south + north) / 2];
}

export function boundsTouch(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function boundsHold([west, south, east, north], [lon, lat]) {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/* A box grown by `margin` degrees on every side. */
export function growBounds([west, south, east, north], margin) {
  return [west - margin, south - margin, east + margin, north + margin];
}

/* A box of about `km` kilometres each way around a point, for when there is no map to ask. */
export function boundsAround([lon, lat], km) {
  const dLat = km / 111;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/* ---------- Points ---------- */

/* Is the point inside one closed ring of [lon, lat] points? */
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function inPolygon(point, rings) {
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

/* Is the point on the field? Holes in the outline do not count as the field. */
export function pointInGeometry(point, geometry) {
  if (geometry?.type === 'Polygon') return inPolygon(point, geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some((rings) => inPolygon(point, rings));
  return false;
}

/* Where the outline's edges cross one latitude, west to east. */
function crossingsAt(lat, geometry) {
  const crossings = [];
  for (const ring of ringsOf(geometry)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat)) crossings.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
    }
  }
  return crossings.sort((a, b) => a - b);
}

/* A point that is surely on the field, to hold the pin when the field is picked from a list.
   The middle of the outline's box if that is on the field; if not (an L-shaped field, a hole),
   the middle of the widest stretch of field along the box's middle latitude. */
export function pointInside(geometry) {
  const bounds = geometryBounds(geometry);
  if (!bounds) return null;
  const centre = boundsCentre(bounds);
  if (pointInGeometry(centre, geometry)) return centre;

  const crossings = crossingsAt(centre[1], geometry);
  let best = null;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const width = crossings[i + 1] - crossings[i];
    if (!best || width > best.width) best = { width, lon: (crossings[i] + crossings[i + 1]) / 2 };
  }
  if (best) return [best.lon, centre[1]];
  return ringsOf(geometry)[0]?.[0] ?? null;
}
