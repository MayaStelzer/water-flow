import './style.css';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import { initRivers } from './layers/rivers.js';
import { initCurrents } from './layers/currents.js';
import { initPollution } from './layers/pollution.js';
import { initControls } from './ui/controls.js';
import { initTooltip } from './ui/tooltip.js';
import { riverIndex } from './utils/graph.js';

// Register PMTiles protocol with MapLibre
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));

// Init map
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap © CARTO'
      }
    },
    layers: [{
      id: 'background',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 22
    }]
  },
  center: [10, 20],
  zoom: 2.5,
  minZoom: 2,
  maxZoom: 12
});

map.on('load', async () => {
  // Init layers in order
  await initRivers(map);

  // Currents and pollution init in background
  initCurrents(map).catch(console.error);

  // Pollution needs river features — wait for graph to be built
  const allFeatures = Object.values(riverIndex);
  initPollution(map, allFeatures);

  // Init UI
  initTooltip();
  initControls();

  // Rivers visible by default
  // Currents and pollution hidden until tab switch
});

map.on('error', e => {
  console.warn('Map error:', e.error?.message || e);
});
