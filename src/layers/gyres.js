/**
 * Approximate centers of major ocean garbage gyres (subtropical convergence zones).
 * Coordinates are indicative for education — replace with your dataset when available.
 */
const GYRES = [
  { name: 'North Pacific', lon: -145, lat: 38 },
  { name: 'South Pacific', lon: -125, lat: -32 },
  { name: 'North Atlantic', lon: -42, lat: 34 },
  { name: 'South Atlantic', lon: -12, lat: -28 },
  { name: 'Indian Ocean', lon: 68, lat: -22 }
];

const SOURCE_ID = 'gyres-src';
const LAYER_CIRCLE = 'gyres-circles';
const LAYER_LABEL = 'gyres-labels';

let map;

function buildGeoJSON() {
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
  map.addSource(SOURCE_ID, { type: 'geojson', data: buildGeoJSON() });
  map.addLayer({
    id: LAYER_CIRCLE,
    type: 'circle',
    source: SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 32, 4, 22, 8, 14],
      'circle-color': 'rgba(0, 255, 157, 0.1)',
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(0, 255, 157, 0.45)'
    }
  });
  map.addLayer({
    id: LAYER_LABEL,
    type: 'symbol',
    source: SOURCE_ID,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': 11,
      'text-offset': [0, 1.35],
      'text-anchor': 'top',
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
  if (!map?.getLayer(LAYER_CIRCLE)) return;
  const vis = v ? 'visible' : 'none';
  map.setLayoutProperty(LAYER_CIRCLE, 'visibility', vis);
  map.setLayoutProperty(LAYER_LABEL, 'visibility', vis);
}
