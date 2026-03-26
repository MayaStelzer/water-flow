let map;
let vectors = [];
let oceanVecs = [];
let particles = [];
let animFrame = null;
let lastTick = 0;
let animating = true;
let speedColoring = true;
let visible = false;

// ── Tunable defaults ──
let PARTICLE_COUNT = 4000;
let SPEED_SCALE    = 1.0;
let MAX_AGE        = 500;
let TRAIL_LEN      = 150;
let FPS_CAP        = 10;

// Step per tick: 0.25° * speed * vec_magnitude
// At zoom 3, 0.25° ≈ 2px/tick, 150 trail pts = 300px ≈ 3 inches
const BASE_STEP = 0.25;

const SOURCE_TRAILS = 'currents-trails';
const LAYER_TRAIL   = 'currents-trail-lines';

export async function initCurrents(mapInstance) {
  map = mapInstance;

  const res = await fetch('/data/currents_vectors.json');
  vectors = await res.json();
  oceanVecs = vectors.filter(v => v.speed > 0.02);
  buildVectorIndex();
  addLegend();

  map.addSource(SOURCE_TRAILS, {
    type: 'geojson',
    data: emptyFC()
  });

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
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        2, 1.5,
        5, 2.2,
        8, 3.5
      ],
      'line-opacity': ['get', 'op']
    }
  });

  spawnParticles();

  // Re-seed when map moves so new viewport area gets filled immediately
  map.on('moveend', () => { if (visible) spawnParticles(); });
  map.on('zoomend', () => { if (visible) spawnParticles(); });
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

// ── Seed particles on a uniform grid across the current viewport ──
// This guarantees dense coverage of whatever the user is looking at,
// rather than randomly sampling a global ocean point cloud.
function spawnParticles() {
  const bounds = map.getBounds();
  const west  = bounds.getWest();
  const east  = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  // Grid spacing in degrees — tighter = denser coverage
  const spacing = 1.5;

  const grid = [];
  for (let lon = Math.floor(west / spacing) * spacing; lon <= east; lon += spacing) {
    for (let lat = Math.floor(south / spacing) * spacing; lat <= north; lat += spacing) {
      const vec = lookupVector(lon, lat);
      if (vec && vec.speed > 0.02) {
        grid.push({ lon, lat });
      }
    }
  }

  // Fill PARTICLE_COUNT slots from the grid, cycling through it
  particles = [];
  if (grid.length === 0) return;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const g = grid[i % grid.length];
    // Jitter so multiple particles per grid cell don't overlap exactly
    particles.push({
      lon: g.lon + (Math.random() - 0.5) * spacing,
      lat: g.lat + (Math.random() - 0.5) * spacing,
      age: Math.floor(Math.random() * MAX_AGE),
      trail: []
    });
  }
}

function newParticle() {
  // Respawn within current viewport bounds
  const bounds = map.getBounds();
  const west  = bounds.getWest();
  const east  = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  // Try up to 20 random positions in the viewport until we find ocean
  for (let attempt = 0; attempt < 20; attempt++) {
    const lon = west + Math.random() * (east - west);
    const lat = south + Math.random() * (north - south);
    const vec = lookupVector(lon, lat);
    if (vec && vec.speed > 0.02) {
      return { lon, lat, age: 0, trail: [] };
    }
  }

  // Fallback: random global ocean point
  const v = oceanVecs[Math.floor(Math.random() * oceanVecs.length)];
  return { lon: v.lon, lat: v.lat, age: 0, trail: [] };
}

// ── Color ramp: slow=blue → fast=red ──
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

// ── Animation loop ──
function tick(now) {
  if (!visible || !animating) {
    animFrame = null;
    map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
    return;
  }

  animFrame = requestAnimationFrame(tick);

  const interval = 1000 / FPS_CAP;
  if (now - lastTick < interval) return;
  lastTick = now;

  const trailFeatures = [];

  particles.forEach((p, i) => {
    p.age++;

    if (p.age > MAX_AGE) {
      particles[i] = newParticle();
      return;
    }

    const vec = lookupVector(p.lon, p.lat);
    if (!vec || vec.speed < 0.02) {
      particles[i] = newParticle();
      return;
    }

    p.trail.push([p.lon, p.lat]);
    if (p.trail.length > TRAIL_LEN) p.trail.shift();

    const step = BASE_STEP * SPEED_SCALE;
    p.lon += vec.u * step;
    p.lat += vec.v * step;
    if (p.lon >  180) p.lon -= 360;
    if (p.lon < -180) p.lon += 360;
    p.lat = Math.max(-85, Math.min(85, p.lat));

    if (p.trail.length < 2) return;

    const lifeFrac = p.age / MAX_AGE;
    const fade = lifeFrac < 0.04 ? lifeFrac / 0.04
               : lifeFrac > 0.88 ? (1 - lifeFrac) / 0.12
               : 1;

    trailFeatures.push({
      type: 'Feature',
      properties: {
        color: speedToColor(vec.speed),
        op: Math.min(fade * 0.85, 0.85)
      },
      geometry: {
        type: 'LineString',
        coordinates: p.trail.slice()
      }
    });
  });

  map.getSource(SOURCE_TRAILS)?.setData({
    type: 'FeatureCollection',
    features: trailFeatures
  });
}

// ── Legend + Settings panel ──
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
    min-width: 200px;
    backdrop-filter: blur(10px);
  `;
  el.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;color:#00d4ff;letter-spacing:0.05em">CURRENT SPEED</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="width:120px;height:8px;border-radius:4px;background:linear-gradient(to right,rgb(0,80,255),rgb(0,255,255),rgb(0,255,0),rgb(255,255,0),rgb(255,55,0))"></div>
    </div>
    <div style="display:flex;justify-content:space-between;color:#6b7a99;margin-bottom:14px;width:120px">
      <span>0</span><span>0.75</span><span>1.5+ m/s</span>
    </div>

    <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">
      <div style="font-weight:700;margin-bottom:10px;color:#00d4ff;letter-spacing:0.05em">SETTINGS</div>

      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <label style="color:#a0aec0;">Speed</label>
          <span id="curr-speed-val" style="color:#e8edf5;">1.0</span>
        </div>
        <input id="curr-speed" type="range" min="0.1" max="5" step="0.1" value="1.0"
          style="width:100%;accent-color:#00d4ff;cursor:pointer;">
      </div>

      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <label style="color:#a0aec0;">Particle count</label>
          <span id="curr-count-val" style="color:#e8edf5;">4000</span>
        </div>
        <input id="curr-count" type="range" min="500" max="15000" step="500" value="4000"
          style="width:100%;accent-color:#00d4ff;cursor:pointer;">
      </div>

      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <label style="color:#a0aec0;">Trail length</label>
          <span id="curr-trail-val" style="color:#e8edf5;">150</span>
        </div>
        <input id="curr-trail" type="range" min="10" max="300" step="5" value="150"
          style="width:100%;accent-color:#00d4ff;cursor:pointer;">
      </div>

      <div style="margin-bottom:4px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <label style="color:#a0aec0;">Particle lifetime</label>
          <span id="curr-age-val" style="color:#e8edf5;">500</span>
        </div>
        <input id="curr-age" type="range" min="50" max="2000" step="50" value="500"
          style="width:100%;accent-color:#00d4ff;cursor:pointer;">
      </div>
    </div>
  `;
  document.body.appendChild(el);

  document.getElementById('curr-speed').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    document.getElementById('curr-speed-val').textContent = val.toFixed(1);
    setSpeedScale(val);
  });
  document.getElementById('curr-count').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('curr-count-val').textContent = val;
    setParticleCount(val);
  });
  document.getElementById('curr-trail').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('curr-trail-val').textContent = val;
    setTrailLength(val);
  });
  document.getElementById('curr-age').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('curr-age-val').textContent = val;
    setMaxAge(val);
  });
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

// ── Exports ──
export function setVisible(v) {
  visible = v;
  const legend = document.getElementById('current-legend');
  if (!map.getLayer(LAYER_TRAIL)) return;

  map.setLayoutProperty(LAYER_TRAIL, 'visibility', v ? 'visible' : 'none');
  if (legend) legend.style.display = v ? 'block' : 'none';

  if (v) {
    spawnParticles();
    lastTick = 0;
    if (!animFrame) animFrame = requestAnimationFrame(tick);
  } else {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
  }
}

export function setAnimating(v) {
  animating = v;
  if (v && visible) {
    lastTick = 0;
    if (!animFrame) animFrame = requestAnimationFrame(tick);
  } else {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
  }
}

export function setSpeedColoring(v) { speedColoring = v; }

export function setSpeedScale(v) { SPEED_SCALE = Math.max(0.01, v); }

export function setParticleCount(v) {
  const n = Math.max(1, Math.round(v));
  PARTICLE_COUNT = n;
  while (particles.length < n) particles.push(newParticle());
  if (particles.length > n) particles.length = n;
}

export function setTrailLength(v) {
  TRAIL_LEN = Math.max(2, Math.round(v));
  particles.forEach(p => { if (p.trail.length > TRAIL_LEN) p.trail = p.trail.slice(-TRAIL_LEN); });
}

export function setMaxAge(v) {
  MAX_AGE = Math.max(10, Math.round(v));
  particles.forEach((p, i) => { if (p.age > MAX_AGE) particles[i] = newParticle(); });
}

export function setFpsCap(v) { FPS_CAP = Math.max(1, Math.min(60, Math.round(v))); }

export function getSettings() {
  return { speedScale: SPEED_SCALE, particleCount: PARTICLE_COUNT,
           trailLength: TRAIL_LEN, maxAge: MAX_AGE, fpsCap: FPS_CAP,
           speedColoring, animating, visible };
}