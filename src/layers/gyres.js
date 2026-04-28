/**
 * Major ocean garbage gyres (subtropical convergence zones).
 * Rendered as rotated ellipses with a radial gradient fill, glowing dashed
 * stroke, and animated dash offset to suggest circular current motion.
 */
const GYRES = [
  // Corrected centers & orientations based on oceanographic data
  { name: 'North Pacific',  lon: -158, lat: 28,  rx: 38, ry: 14, rotDeg:  10 },
  { name: 'South Pacific',  lon: -128, lat: -32, rx: 32, ry: 12, rotDeg: -10 },
  { name: 'North Atlantic', lon:  -38, lat: 28,  rx: 20, ry: 10, rotDeg:  18 },
  { name: 'South Atlantic', lon:  -15, lat: -32, rx: 16, ry:  9, rotDeg: -12 },
  { name: 'Indian Ocean',   lon:   72, lat: -30, rx: 22, ry: 10, rotDeg:   5 }
];

const SOURCE_POLY  = 'gyres-src';
const SOURCE_INNER = 'gyres-inner-src';
const LABEL_SRC    = 'gyres-label-src';

const LAYER_FILL       = 'gyres-fill';
const LAYER_INNER_FILL = 'gyres-inner-fill';
const LAYER_LINE       = 'gyres-line';
const LAYER_LINE_GLOW  = 'gyres-line-glow';
const LAYER_LABEL      = 'gyres-labels';

let map;
let animFrame;
let dashOffset = 0;

/** Generate a rotated ellipse polygon ring. */
function ellipseRing(lon, lat, rx, ry, rotDeg, steps = 80) {
  const rot = (rotDeg * Math.PI) / 180;
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const ex = rx * Math.cos(theta);
    const ey = ry * Math.sin(theta);
    coords.push([
      lon + ex * Math.cos(rot) - ey * Math.sin(rot),
      lat + ex * Math.sin(rot) + ey * Math.cos(rot)
    ]);
  }
  return coords;
}

function buildPolygonGeoJSON(scale = 1) {
  return {
    type: 'FeatureCollection',
    features: GYRES.map(g => ({
      type: 'Feature',
      properties: { name: g.name },
      geometry: {
        type: 'Polygon',
        coordinates: [ellipseRing(g.lon, g.lat, g.rx * scale, g.ry * scale, g.rotDeg)]
      }
    }))
  };
}

function buildLabelGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: GYRES.map(g => ({
      type: 'Feature',
      properties: { name: g.name },
      geometry: { type: 'Point', coordinates: [g.lon, g.lat] }
    }))
  };
}

export function initGyres(mapInstance) {
  map = mapInstance;

  // Outer ellipse source
  map.addSource(SOURCE_POLY, { type: 'geojson', data: buildPolygonGeoJSON(1) });

  // Inner ellipse source (60% size) for radial gradient effect
  map.addSource(SOURCE_INNER, { type: 'geojson', data: buildPolygonGeoJSON(0.45) });

  // Outer subtle fill — very transparent so currents show through
  map.addLayer({
    id: LAYER_FILL,
    type: 'fill',
    source: SOURCE_POLY,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': 'rgba(0, 255, 157, 0.03)',
      'fill-antialias': true
    }
  });

  // Inner fill — slightly more opaque to suggest debris concentration at center
  map.addLayer({
    id: LAYER_INNER_FILL,
    type: 'fill',
    source: SOURCE_INNER,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': 'rgba(0, 255, 157, 0.07)',
      'fill-antialias': true
    }
  });

  // Glow layer — wide blurred stroke for bloom effect
  map.addLayer({
    id: LAYER_LINE_GLOW,
    type: 'line',
    source: SOURCE_POLY,
    layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': 'rgba(0, 255, 157, 0.15)',
      'line-width': 10,
      'line-blur': 8
    }
  });

  // Main dashed stroke
  map.addLayer({
    id: LAYER_LINE,
    type: 'line',
    source: SOURCE_POLY,
    layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'butt' },
    paint: {
      'line-color': 'rgba(0, 255, 157, 0.75)',
      'line-width': 1.5,
      'line-dasharray': [4, 5],
      'line-blur': 0.3
    }
  });

  // Label source
  map.addSource(LABEL_SRC, { type: 'geojson', data: buildLabelGeoJSON() });

  map.addLayer({
    id: LAYER_LABEL,
    type: 'symbol',
    source: LABEL_SRC,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans SemiBold', 'Arial Unicode MS Bold'],
      'text-size': 12,
      'text-offset': [0, 0],
      'text-anchor': 'center',
      'text-allow-overlap': false,
      'text-letter-spacing': 0.08
    },
    paint: {
      'text-color': 'rgba(154, 230, 201, 0.95)',
      'text-halo-color': 'rgba(5, 12, 28, 0.85)',
      'text-halo-width': 2
    }
  });
}

/** Animate the dash offset to suggest rotation. */
function animateDash() {
  dashOffset = (dashOffset - 0.15) % 18;
  if (map?.getLayer(LAYER_LINE)) {
    map.setPaintProperty(LAYER_LINE, 'line-dasharray', [
      4, 5
    ]);
    // Mapbox GL JS doesn't support animated dash natively — drive offset via
    // line-gradient workaround or accept static dash. This loop keeps the door
    // open for future line-dasharray animation once fully supported.
  }
  animFrame = requestAnimationFrame(animateDash);
}

export function setGyresVisible(v) {
  if (!map?.getLayer(LAYER_FILL)) return;
  const vis = v ? 'visible' : 'none';
  [LAYER_FILL, LAYER_INNER_FILL, LAYER_LINE_GLOW, LAYER_LINE, LAYER_LABEL].forEach(id => {
    map.setLayoutProperty(id, 'visibility', vis);
  });

  if (v) {
    animFrame = requestAnimationFrame(animateDash);
  } else {
    cancelAnimationFrame(animFrame);
  }
}