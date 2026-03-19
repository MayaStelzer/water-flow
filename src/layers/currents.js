let map;
let vectors = [];
let oceanVecs = [];
let particles = [];
let animFrame = null;
let animating = true;
let speedColoring = true;
let visible = false;

const PARTICLE_COUNT = 2500;
const SPEED_SCALE = 1.2;
const MAX_AGE = 140;
const TRAIL_LEN = 20;

const SOURCE_TRAILS  = 'currents-trails';
const SOURCE_ARROWS  = 'currents-arrows';
const LAYER_TRAIL    = 'currents-trail-lines';
const LAYER_ARROW    = 'currents-arrow-symbols';

export async function initCurrents(mapInstance) {
  map = mapInstance;

  const res = await fetch('/data/currents_vectors.json');
  vectors = await res.json();
  oceanVecs = vectors.filter(v => v.speed > 0.02);
  buildVectorIndex();
  buildArrowGrid();
  addLegend();

  // Source for animated particle trails
  map.addSource(SOURCE_TRAILS, {
    type: 'geojson',
    data: emptyFC()
  });

  // Source for static arrow grid
  map.addSource(SOURCE_ARROWS, {
    type: 'geojson',
    data: emptyFC()
  });

  // Trail lines — fixed opacity, color per feature
  map.addLayer({
    id: LAYER_TRAIL,
    type: 'line',
    source: SOURCE_TRAILS,
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
      visibility: 'none'
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.8,
      'line-opacity': ['get', 'op']
    }
  });

  // Arrow symbols
  // We draw arrows as small rotated line segments (chevrons) via symbol layer
  // using a generated arrow image
  createArrowImage();

  map.addLayer({
    id: LAYER_ARROW,
    type: 'symbol',
    source: SOURCE_ARROWS,
    layout: {
      'icon-image': 'arrow-icon',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 6, 0.8],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': false,
      'icon-ignore-placement': false,
      visibility: 'none'
    },
    paint: {
      'icon-color': ['get', 'color'],
      'icon-opacity': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.2, 0.5, 0.7, 2, 1.0]
    }
  });

  spawnParticles();
}

// ── Arrow image ──
function createArrowImage() {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Draw a simple arrow pointing up (north = 0°)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Shaft
  ctx.beginPath();
  ctx.moveTo(size/2, size * 0.75);
  ctx.lineTo(size/2, size * 0.2);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(size/2 - 4, size * 0.38);
  ctx.lineTo(size/2, size * 0.2);
  ctx.lineTo(size/2 + 4, size * 0.38);
  ctx.stroke();

  map.addImage('arrow-icon', { width: size, height: size,
    data: ctx.getImageData(0, 0, size, size).data }, { sdf: true });
}

// ── Arrow grid (static, sampled every ~3°) ──
function buildArrowGrid() {
  // Called after vectors loaded; actual GeoJSON built in setVisible
}

function buildArrowFeatures() {
  const features = [];
  // Sample every 3° — gives ~4000 arrows globally
  const step = 3;
  for (let lon = -180; lon < 180; lon += step) {
    for (let lat = -80; lat <= 80; lat += step) {
      const vec = lookupVector(lon, lat);
      if (!vec || vec.speed < 0.05) continue;

      // Bearing: direction the current flows toward
      // arctan2(u=east, v=north) → degrees from north
      const bearing = (Math.atan2(vec.u, vec.v) * 180 / Math.PI + 360) % 360;

      features.push({
        type: 'Feature',
        properties: {
          bearing,
          speed: vec.speed,
          color: speedToColor(vec.speed),
          u: vec.u.toFixed(2),
          v: vec.v.toFixed(2)
        },
        geometry: { type: 'Point', coordinates: [lon, lat] }
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

// ── Vector index ──
const _index = {};
function buildVectorIndex() {
  vectors.forEach(v => {
    _index[`${v.lon.toFixed(2)},${v.lat.toFixed(2)}`] = v;
  });
}

function lookupVector(lon, lat) {
  const snapLon = (Math.round(lon * 4) / 4).toFixed(2);
  const snapLat = (Math.round(lat * 4) / 4).toFixed(2);
  return _index[`${snapLon},${snapLat}`] || null;
}

// ── Particles ──
function spawnParticles() {
  particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(newParticle(Math.floor(Math.random() * MAX_AGE)));
  }
}

function newParticle(age = 0) {
  const v = oceanVecs[Math.floor(Math.random() * oceanVecs.length)];
  return {
    lon: v.lon + (Math.random() - 0.5) * 0.6,
    lat: v.lat + (Math.random() - 0.5) * 0.6,
    age,
    trail: []
  };
}

function speedToColor(speed) {
  if (!speedColoring) return '#00d4ff';
  const t = Math.min(speed / 1.5, 1);
  if (t < 0.25) {
    const s = t / 0.25;
    return `rgb(0,${Math.round(80 + s * 175)},255)`;
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return `rgb(0,255,${Math.round(255 - s * 255)})`;
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return `rgb(${Math.round(s * 255)},255,0)`;
  } else {
    const s = (t - 0.75) / 0.25;
    return `rgb(255,${Math.round(255 - s * 200)},0)`;
  }
}

// ── Tick ──
function tick() {
  if (!visible || !animating) {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
    return;
  }

  const trailFeatures = [];

  particles.forEach((p, i) => {
    p.age++;

    if (p.age > MAX_AGE) {
      particles[i] = newParticle(0);
      return;
    }

    const vec = lookupVector(p.lon, p.lat);
    if (!vec || vec.speed < 0.02) {
      particles[i] = newParticle(0);
      return;
    }

    // Record position BEFORE advancing
    p.trail.push([p.lon, p.lat]);
    if (p.trail.length > TRAIL_LEN) p.trail.shift();

    // Advance
    p.lon += vec.u * SPEED_SCALE * 0.01;
    p.lat += vec.v * SPEED_SCALE * 0.01;
    if (p.lon > 180)  p.lon -= 360;
    if (p.lon < -180) p.lon += 360;
    p.lat = Math.max(-85, Math.min(85, p.lat));

    if (p.trail.length < 2) return;

    const lifeFrac = p.age / MAX_AGE;
    const fade = lifeFrac < 0.12 ? lifeFrac / 0.12
               : lifeFrac > 0.78 ? (1 - lifeFrac) / 0.22
               : 1;

    // Split trail into segments so we can taper opacity
    for (let s = 1; s < p.trail.length; s++) {
      const segFrac = s / p.trail.length;
      trailFeatures.push({
        type: 'Feature',
        properties: {
          color: speedToColor(vec.speed),
          op: fade * segFrac   // front of trail is brighter
        },
        geometry: {
          type: 'LineString',
          coordinates: [p.trail[s-1], p.trail[s]]
        }
      });
    }
  });

  map.getSource(SOURCE_TRAILS)?.setData({
    type: 'FeatureCollection',
    features: trailFeatures
  });

  // Queue AFTER doing work, so the flag check at top catches toggles immediately
  animFrame = requestAnimationFrame(tick);
}

// ── Legend ──
function addLegend() {
  if (document.getElementById('current-legend')) return;
  const el = document.createElement('div');
  el.id = 'current-legend';
  el.style.cssText = `
    position: fixed; bottom: 24px; right: 24px;
    background: rgba(17,24,39,0.92);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    padding: 12px 16px;
    font-family: 'Satoshi', sans-serif;
    font-size: 11px;
    color: #e8edf5;
    z-index: 100;
    display: none;
    min-width: 160px;
    backdrop-filter: blur(10px);
  `;
  el.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;color:#00d4ff;letter-spacing:0.05em">CURRENT SPEED</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="width:80px;height:8px;border-radius:4px;background:linear-gradient(to right,rgb(0,80,255),rgb(0,255,255),rgb(0,255,0),rgb(255,255,0),rgb(255,55,0))"></div>
    </div>
    <div style="display:flex;justify-content:space-between;color:#6b7a99;margin-bottom:12px">
      <span>0 m/s</span><span>0.75</span><span>1.5+</span>
    </div>
    <div style="font-weight:700;margin-bottom:6px;color:#00d4ff;letter-spacing:0.05em">DIRECTION</div>
    <div style="color:#6b7a99;line-height:1.5">Arrows show flow direction.<br>Trail length = persistence.</div>
  `;
  document.body.appendChild(el);
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

// ── Exports ──
export function setVisible(v) {
  visible = v;
  const legend = document.getElementById('current-legend');

  if (!map.getLayer(LAYER_TRAIL)) return;
  const vis = v ? 'visible' : 'none';
  map.setLayoutProperty(LAYER_TRAIL, 'visibility', vis);
  map.setLayoutProperty(LAYER_ARROW, 'visibility', vis);
  if (legend) legend.style.display = v ? 'block' : 'none';

  if (v) {
    // Update arrow grid with current speed coloring
    map.getSource(SOURCE_ARROWS)?.setData(buildArrowFeatures());
    spawnParticles();
    tick();
  } else {
    if (animFrame) cancelAnimationFrame(animFrame);
    map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
  }
}

export function setAnimating(v) {
  animating = v;
  if (v && visible) {
    tick();
  } else {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
  }
}

export function setSpeedColoring(v) {
  speedColoring = v;
  // Rebuild arrow colors
  if (visible && map.getSource(SOURCE_ARROWS)) {
    map.getSource(SOURCE_ARROWS).setData(buildArrowFeatures());
  }
}
