/**
 * Approximate centers of major ocean garbage gyres (subtropical convergence zones).
 * Coordinates are indicative for education — replace with your dataset when available.
 * Rendered as rotated ellipses (polygons) to better reflect real gyre shapes.
 */
const GYRES = [
  // lon, lat = center; rx = half-width in degrees lon; ry = half-height in degrees lat; rotDeg = clockwise tilt
  { name: 'North Pacific',  lon: -150, lat: 32,  rx: 38, ry: 14, rotDeg:  10 },
  { name: 'South Pacific',  lon: -120, lat: -35, rx: 32, ry: 12, rotDeg: -10 },
  { name: 'North Atlantic', lon:  -38, lat: 34,  rx: 22, ry: 12, rotDeg:  15 },
  { name: 'South Atlantic', lon:  -14, lat: -28, rx: 18, ry: 10, rotDeg: -10 },
  { name: 'Indian Ocean',   lon:   76, lat: -26, rx: 22, ry: 11, rotDeg:   5 }
];

const SOURCE_ID   = 'gyres-src';
const LAYER_FILL  = 'gyres-fill';
const LAYER_LINE  = 'gyres-line';
const LAYER_LABEL = 'gyres-labels';
const LABEL_SRC   = 'gyres-label-src';

let map;

/** Generate a rotated ellipse polygon as a GeoJSON ring. */
function ellipseRing(lon, lat, rx, ry, rotDeg, steps = 64) {
  const rot = (rotDeg * Math.PI) / 180;
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const ex = rx * Math.cos(theta);
    const ey = ry * Math.sin(theta);
    const rx2 = ex * Math.cos(rot) - ey * Math.sin(rot);
    const ry2 = ex * Math.sin(rot) + ey * Math.cos(rot);
    coords.push([lon + rx2, lat + ry2]);
  }
  return coords;
}

function buildPolygonGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: GYRES.map(g => ({
      type: 'Feature',
      properties: { name: g.name },
      geometry: {
        type: 'Polygon',
        coordinates: [ellipseRing(g.lon, g.lat, g.rx, g.ry, g.rotDeg)]
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

  // Polygon source for fill + stroke
  map.addSource(SOURCE_ID, { type: 'geojson', data: buildPolygonGeoJSON() });

  // Fill layer
  map.addLayer({
    id: LAYER_FILL,
    type: 'fill',
    source: SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': 'rgba(0, 255, 157, 0.08)',
      'fill-antialias': true
    }
  });

  // Stroke layer
  map.addLayer({
    id: LAYER_LINE,
    type: 'line',
    source: SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'line-color': 'rgba(0, 255, 157, 0.5)',
      'line-width': 1.8,
      'line-blur': 0.5
    }
  });

  // Separate point source for labels (centred on each gyre)
  map.addSource(LABEL_SRC, { type: 'geojson', data: buildLabelGeoJSON() });

  map.addLayer({
    id: LAYER_LABEL,
    type: 'symbol',
    source: LABEL_SRC,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': 11,
      'text-offset': [0, 0],
      'text-anchor': 'center',
      'text-allow-overlap': false
    },
    paint: {
      'text-color': '#9ae6c9',
      'text-halo-color': '#0a0e1a',
      'text-halo-width': 1.2
    }
  });
}

export function setGyresVisible(v) {
  if (!map?.getLayer(LAYER_FILL)) return;
  const vis = v ? 'visible' : 'none';
  map.setLayoutProperty(LAYER_FILL,  'visibility', vis);
  map.setLayoutProperty(LAYER_LINE,  'visibility', vis);
  map.setLayoutProperty(LAYER_LABEL, 'visibility', vis);
}