import { buildIndexes, getWatershedIds, getDownstreamIds, distanceToOcean, riverIndex } from '../utils/graph.js';

const LAYER_ID = 'rivers';
const SOURCE_ID = 'rivers-src';

// Colors
const COLOR_DEFAULT   = '#2563eb';
const COLOR_HIGHLIGHT = '#00d4ff';
const COLOR_BASIN_A   = '#00d4ff';
const COLOR_BASIN_B   = '#ff6b35';
const COLOR_DIM       = 'rgba(30,50,100,0.25)';

let map;
let allFeatures = [];
let compareMode = false;
let compareStep = 0; // 0 = picking A, 1 = picking B
let basinA = null;
let basinB = null;
let activeHighlight = null;

export async function initRivers(mapInstance) {
  map = mapInstance;

  // Load full GeoJSON for graph traversal (needed for upstream/downstream logic)
  const res = await fetch('/data/rivers.geojson');
  const data = await res.json();
  allFeatures = data.features;
  buildIndexes(allFeatures);

  // Add PMTiles source for rendering
  map.addSource(SOURCE_ID, {
    type: 'vector',
    url: `pmtiles://${window.location.origin}/data/rivers.pmtiles`
  });

  // Base river layer — width and opacity driven by discharge + stream order
  map.addLayer({
    id: LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'rivers',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COLOR_DEFAULT,
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        2, ['interpolate', ['linear'], ['get', 'ORD_STRA'], 6, 0.5, 10, 2],
        8, ['interpolate', ['linear'], ['get', 'ORD_STRA'], 6, 1, 10, 5],
      ],
      'line-opacity': [
        'interpolate', ['linear'], ['get', 'ORD_FLOW'],
        1, 1.0,
        2, 0.8,
        3, 0.5
      ]
    }
  });

  // Highlight layer (drawn on top)
  map.addLayer({
    id: `${LAYER_ID}-highlight`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'rivers',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COLOR_HIGHLIGHT,
      'line-width': 4,
      'line-opacity': 0
    }
  });

  // Dim layer (drawn under highlight)
  map.addLayer({
    id: `${LAYER_ID}-dim`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'rivers',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COLOR_DIM,
      'line-width': 1,
      'line-opacity': 0
    }
  }, `${LAYER_ID}-highlight`);

  map.on('click', LAYER_ID, onRiverClick);
  map.on('mouseenter', LAYER_ID, () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', LAYER_ID, () => map.getCanvas().style.cursor = '');
}

function onRiverClick(e) {
  const props = e.features[0].properties;
  const id = props.HYRIV_ID;
  const feature = riverIndex[id];
  if (!feature) return;

  if (compareMode) {
    handleCompareClick(feature);
  } else {
    highlightWatershed(feature, COLOR_HIGHLIGHT);
    updateStats(feature);
    activeHighlight = feature;
  }
}

function highlightWatershed(feature, color) {
  const ids = getWatershedIds(feature);
  const idList = Array.from(ids);

  // Show dim layer
  map.setPaintProperty(`${LAYER_ID}-dim`, 'line-opacity', 1);

  // Highlight matching features
  map.setPaintProperty(`${LAYER_ID}-highlight`, 'line-color', color);
  map.setPaintProperty(`${LAYER_ID}-highlight`, 'line-opacity', [
    'case',
    ['in', ['get', 'HYRIV_ID'], ['literal', idList]],
    1,
    0
  ]);
}

function highlightCompare() {
  if (!basinA && !basinB) {
    resetHighlight();
    return;
  }

  const idsA = basinA ? getWatershedIds(basinA) : new Set();
  const idsB = basinB ? getWatershedIds(basinB) : new Set();

  const listA = Array.from(idsA);
  const listB = Array.from(idsB);
  const allHighlighted = [...listA, ...listB];

  map.setPaintProperty(`${LAYER_ID}-dim`, 'line-opacity', 1);

  // Use a stepped color expression for A vs B
  map.setPaintProperty(`${LAYER_ID}-highlight`, 'line-color', [
    'case',
    ['in', ['get', 'HYRIV_ID'], ['literal', listA]], COLOR_BASIN_A,
    ['in', ['get', 'HYRIV_ID'], ['literal', listB]], COLOR_BASIN_B,
    COLOR_DIM
  ]);

  map.setPaintProperty(`${LAYER_ID}-highlight`, 'line-opacity', [
    'case',
    ['in', ['get', 'HYRIV_ID'], ['literal', allHighlighted]], 1,
    0
  ]);
}

function handleCompareClick(feature) {
  if (compareStep === 0) {
    basinA = feature;
    compareStep = 1;
    updateCompareLabels();
    highlightCompare();
  } else {
    basinB = feature;
    compareStep = 0;
    updateCompareLabels();
    highlightCompare();
  }
}

function updateCompareLabels() {
  const labelA = document.querySelector('#basin-a-label span:last-child');
  const labelB = document.querySelector('#basin-b-label span:last-child');
  if (labelA) labelA.textContent = basinA
    ? `MAIN_RIV ${basinA.properties.MAIN_RIV}`
    : 'Basin A — click a river';
  if (labelB) labelB.textContent = basinB
    ? `MAIN_RIV ${basinB.properties.MAIN_RIV}`
    : 'Basin B — click a river';
}

export function resetHighlight() {
  map.setPaintProperty(`${LAYER_ID}-highlight`, 'line-opacity', 0);
  map.setPaintProperty(`${LAYER_ID}-dim`, 'line-opacity', 0);
  activeHighlight = null;
}

export function enableCompareMode() {
  compareMode = true;
  compareStep = 0;
  basinA = null;
  basinB = null;
  resetHighlight();
  updateCompareLabels();
}

export function disableCompareMode() {
  compareMode = false;
  basinA = null;
  basinB = null;
  resetHighlight();
}

export function setVisible(visible) {
  const vis = visible ? 'visible' : 'none';
  [LAYER_ID, `${LAYER_ID}-highlight`, `${LAYER_ID}-dim`].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  });
}

// ── Stats panel ──
function updateStats(feature) {
  const p = feature.properties;
  const panel = document.getElementById('river-stats');
  if (!panel) return;
  panel.classList.remove('hidden');

  document.getElementById('stat-name').textContent = `MAIN_RIV ${p.MAIN_RIV}`;
  document.getElementById('stat-discharge').textContent =
    `${p.DIS_AV_CMS.toLocaleString()} m³/s`;
  document.getElementById('stat-length').textContent =
    `${Math.round(p.DIST_DN_KM).toLocaleString()} km`;
  document.getElementById('stat-endorheic').textContent =
    p.ENDORHEIC === 1 ? 'Endorheic (no ocean outlet)' : 'Drains to ocean';
  document.getElementById('stat-order').textContent =
    `Strahler ${p.ORD_STRA}`;
}
