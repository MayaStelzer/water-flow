/**
 * Ocean surface currents from /data/currents_vectors.json (OSCAR-style u,v grid).
 * Static view: curved streamlines (Watch Duty–style). Animate: short grey particle trails.
 */

const STEP = 0.75;
const LON_MIN = -179.25;
const LAT_MIN = -78.5;
const NLON = 480;
const NLAT = 223;

const SOURCE_STATIC = 'currents-streamlines';
const LAYER_STATIC = 'currents-streamlines-lines';
const SOURCE_TRAILS = 'currents-trails';
const LAYER_TRAIL = 'currents-trail-lines';

let map;
let uGrid;
let vGrid;
let speedGrid;
let validGrid;
let maxSpeed = 1;

let animating = true;
let speedColoring = true;
let visible = false;

let particles = [];
let animFrame = null;
let lastTick = 0;

const FPS_CAP = 14;
const BASE_STEP = 0.18;
let PARTICLE_COUNT = 1400;
const TRAIL_LEN = 44;
const MAX_AGE = 420;

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

function idx(x, y) {
  return y * NLON + x;
}

function buildGrids(vectors) {
  uGrid = new Float32Array(NLON * NLAT);
  vGrid = new Float32Array(NLON * NLAT);
  speedGrid = new Float32Array(NLON * NLAT);
  validGrid = new Uint8Array(NLON * NLAT);
  maxSpeed = 0.001;
  for (let i = 0; i < uGrid.length; i++) {
    uGrid[i] = NaN;
    vGrid[i] = NaN;
    speedGrid[i] = 0;
  }
  for (const p of vectors) {
    const ix = Math.round((p.lon - LON_MIN) / STEP);
    const iy = Math.round((p.lat - LAT_MIN) / STEP);
    if (ix < 0 || ix >= NLON || iy < 0 || iy >= NLAT) continue;
    const k = idx(ix, iy);
    uGrid[k] = p.u;
    vGrid[k] = p.v;
    const sp = p.speed ?? Math.hypot(p.u, p.v);
    speedGrid[k] = sp;
    validGrid[k] = 1;
    if (sp > maxSpeed) maxSpeed = sp;
  }
}

function cellUV(ix, iy) {
  if (ix < 0 || ix >= NLON || iy < 0 || iy >= NLAT) return null;
  const k = idx(ix, iy);
  if (!validGrid[k]) return null;
  const u = uGrid[k];
  const v = vGrid[k];
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return { u, v, speed: speedGrid[k] };
}

/** Bilinear sample; falls back if a corner is land. */
function sampleField(lon, lat) {
  if (lat < -85 || lat > 85) return null;
  let L = lon;
  while (L > 180) L -= 360;
  while (L < -180) L += 360;

  const fx = (L - LON_MIN) / STEP;
  const fy = (lat - LAT_MIN) / STEP;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 >= NLON - 1 || y0 >= NLAT - 1) return null;

  const tx = fx - x0;
  const ty = fy - y0;

  const c00 = cellUV(x0, y0);
  const c10 = cellUV(x0 + 1, y0);
  const c01 = cellUV(x0, y0 + 1);
  const c11 = cellUV(x0 + 1, y0 + 1);
  const corners = [c00, c10, c01, c11].filter(Boolean);
  if (corners.length === 0) return null;
  if (corners.length < 4) {
    let su = 0;
    let sv = 0;
    let ss = 0;
    let n = 0;
    for (const c of corners) {
      su += c.u;
      sv += c.v;
      ss += c.speed;
      n++;
    }
    return { u: su / n, v: sv / n, speed: ss / n };
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const u0 = lerp(c00.u, c10.u, tx);
  const u1 = lerp(c01.u, c11.u, tx);
  const v0 = lerp(c00.v, c10.v, tx);
  const v1 = lerp(c01.v, c11.v, tx);
  const s0 = lerp(c00.speed, c10.speed, tx);
  const s1 = lerp(c01.speed, c11.speed, tx);
  return {
    u: lerp(u0, u1, ty),
    v: lerp(v0, v1, ty),
    speed: lerp(s0, s1, ty)
  };
}

function stepPoint(lon, lat, sign) {
  const f = sampleField(lon, lat);
  if (!f || f.speed < 0.012) return null;
  const mag = Math.hypot(f.u, f.v);
  if (mag < 1e-8) return null;
  const nu = f.u / mag;
  const nv = f.v / mag;
  const cosL = Math.cos(lat * (Math.PI / 180));
  const cosClamped = Math.max(0.22, Math.abs(cosL));
  const boost = 0.45 + 0.9 * Math.min(f.speed / (maxSpeed || 0.5), 1.5);
  const d = sign * BASE_STEP * boost;
  let nlon = lon + (d * nu) / cosClamped;
  let nlat = lat + d * nv;
  if (nlat < -86 || nlat > 86) return null;
  if (nlon > 180) nlon -= 360;
  if (nlon < -180) nlon += 360;
  return { lon: nlon, lat: nlat, speed: f.speed };
}

function integrateFrom(lon0, lat0, maxSteps, sign) {
  const coords = [[lon0, lat0]];
  let lon = lon0;
  let lat = lat0;
  for (let i = 0; i < maxSteps; i++) {
    const n = stepPoint(lon, lat, sign);
    if (!n) break;
    // Avoid antimeridian "long chord" segments (horizontal streaks when zoomed out)
    if (Math.abs(n.lon - lon) > 90) break;
    lon = n.lon;
    lat = n.lat;
    coords.push([lon, lat]);
  }
  return coords;
}

function buildStreamline(seedLon, seedLat) {
  const pre = integrateFrom(seedLon, seedLat, 8 + (Math.random() * 6) | 0, -1);
  const post = integrateFrom(seedLon, seedLat, 18 + (Math.random() * 45) | 0, 1);
  const head = pre.length > 1 ? pre.slice(0, -1).reverse() : [];
  const line = head.concat(post);
  if (line.length < 3) return null;
  const f0 = sampleField(seedLon, seedLat);
  return { coords: line, speed: f0?.speed ?? 0 };
}

function speedToColor(speed) {
  const t = Math.min(speed / (maxSpeed * 0.85 || 0.4), 1);
  if (t < 0.33) {
    const s = t / 0.33;
    return `rgb(${Math.round(100 + 40 * s)},${Math.round(170 + 50 * s)},220)`;
  }
  if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    return `rgb(${Math.round(140 + 80 * s)},${Math.round(220 - 40 * s)},${Math.round(220 - 100 * s)})`;
  }
  const s = (t - 0.66) / 0.34;
  return `rgb(${Math.round(220 + 35 * s)},${Math.round(180 - 100 * s)},${Math.round(120 - 80 * s)})`;
}

function greyColor(speed) {
  const t = Math.min(speed / (maxSpeed || 0.5), 1.2);
  const base = 175 + Math.min(55, t * 40);
  const a = 0.28 + Math.min(0.32, t * 0.22);
  return `rgba(${base},${base + 8},${base + 14},${a})`;
}

function rebuildStaticStreamlines() {
  if (!map?.getSource(SOURCE_STATIC)) return;
  const b = map.getBounds();
  const west = b.getWest();
  const east = b.getEast();
  const south = b.getSouth();
  const north = b.getNorth();

  const spacing = Math.max(2.8, 4.6 - map.getZoom() * 0.28);
  const features = [];

  for (let lon = Math.floor(west / spacing) * spacing; lon <= east; lon += spacing) {
    for (let lat = Math.floor(south / spacing) * spacing; lat <= north; lat += spacing) {
      if (Math.random() < 0.4) continue;
      const jLon = lon + (Math.random() - 0.5) * spacing * 0.85;
      const jLat = lat + (Math.random() - 0.5) * spacing * 0.85;
      const sl = buildStreamline(jLon, jLat);
      if (!sl) continue;
      const color = speedColoring ? speedToColor(sl.speed) : 'rgba(198,210,228,0.38)';
      features.push({
        type: 'Feature',
        properties: { color, speed: sl.speed },
        geometry: { type: 'LineString', coordinates: sl.coords }
      });
    }
  }

  map.getSource(SOURCE_STATIC).setData({ type: 'FeatureCollection', features });
}

function spawnParticles() {
  const b = map.getBounds();
  const west = b.getWest();
  const east = b.getEast();
  const south = b.getSouth();
  const north = b.getNorth();
  const spacing = 2.6;
  const seeds = [];
  for (let lon = Math.floor(west / spacing) * spacing; lon <= east; lon += spacing) {
    for (let lat = Math.floor(south / spacing) * spacing; lat <= north; lat += spacing) {
      const f = sampleField(lon + (Math.random() - 0.5) * 0.4, lat + (Math.random() - 0.5) * 0.4);
      if (f && f.speed > 0.015) seeds.push({ lon, lat });
    }
  }
  if (seeds.length === 0) return;

  const n = Math.min(PARTICLE_COUNT, 900 + seeds.length * 6);
  particles = [];
  for (let i = 0; i < n; i++) {
    const s = seeds[i % seeds.length];
    particles.push({
      lon: s.lon + (Math.random() - 0.5) * spacing,
      lat: s.lat + (Math.random() - 0.5) * spacing,
      age: (Math.random() * MAX_AGE) | 0,
      trail: []
    });
  }
}

function newParticle() {
  const b = map.getBounds();
  for (let a = 0; a < 25; a++) {
    const lon = b.getWest() + Math.random() * (b.getEast() - b.getWest());
    const lat = b.getSouth() + Math.random() * (b.getNorth() - b.getSouth());
    const f = sampleField(lon, lat);
    if (f && f.speed > 0.015) {
      return { lon, lat, age: 0, trail: [] };
    }
  }
  return {
    lon: LON_MIN + Math.random() * (NLON - 1) * STEP,
    lat: LAT_MIN + Math.random() * (NLAT - 1) * STEP,
    age: 0,
    trail: []
  };
}

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

  const feats = [];
  particles.forEach((p, i) => {
    p.age++;
    if (p.age > MAX_AGE) {
      particles[i] = newParticle();
      return;
    }
    const f = sampleField(p.lon, p.lat);
    if (!f || f.speed < 0.012) {
      particles[i] = newParticle();
      return;
    }

    p.trail.push([p.lon, p.lat]);
    if (p.trail.length > TRAIL_LEN) p.trail.shift();

    const mag = Math.hypot(f.u, f.v);
    const nu = f.u / mag;
    const nv = f.v / mag;
    const cosClamped = Math.max(0.22, Math.abs(Math.cos(p.lat * (Math.PI / 180))));
    const step = BASE_STEP * 1.1;
    const lonBefore = p.lon;
    p.lon += (step * nu) / cosClamped;
    p.lat += step * nv;
    if (p.lon > 180) p.lon -= 360;
    if (p.lon < -180) p.lon += 360;
    p.lat = Math.max(-85, Math.min(85, p.lat));
    if (Math.abs(p.lon - lonBefore) > 90) {
      p.trail = [[p.lon, p.lat]];
      return;
    }

    if (p.trail.length < 2) return;
    const life = p.age / MAX_AGE;
    const fade = life < 0.05 ? life / 0.05 : life > 0.9 ? (1 - life) / 0.1 : 1;
    const color = speedColoring ? speedToColor(f.speed) : greyColor(f.speed);
    feats.push({
      type: 'Feature',
      properties: { color, op: Math.min(0.55, 0.2 + fade * 0.38) },
      geometry: { type: 'LineString', coordinates: p.trail.slice() }
    });
  });

  map.getSource(SOURCE_TRAILS)?.setData({ type: 'FeatureCollection', features: feats });
}

function applyVisibilityStyle() {
  if (!map?.getLayer(LAYER_STATIC)) return;
  map.setPaintProperty(
    LAYER_STATIC,
    'line-color',
    speedColoring ? ['get', 'color'] : 'rgba(198,210,228,0.38)'
  );
}

export async function initCurrents(mapInstance) {
  map = mapInstance;
  const res = await fetch(`${import.meta.env.BASE_URL}data/currents.geojson`);
  const vectors = await res.json();
  buildGrids(vectors);

  map.addSource(SOURCE_STATIC, { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: LAYER_STATIC,
    type: 'line',
    source: SOURCE_STATIC,
    layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.65, 4, 0.95, 8, 1.25],
      'line-opacity': 0.85
    }
  });

  map.addSource(SOURCE_TRAILS, { type: 'geojson', data: emptyFC() });
  map.addLayer({
    id: LAYER_TRAIL,
    type: 'line',
    source: SOURCE_TRAILS,
    layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 5, 0.9, 8, 1.1],
      'line-opacity': ['get', 'op']
    }
  });

  const onViewChange = () => {
    if (!visible) return;
    if (!animating) rebuildStaticStreamlines();
    else spawnParticles();
  };
  map.on('moveend', onViewChange);
  map.on('zoomend', onViewChange);

  spawnParticles();
}

export function setVisible(v) {
  visible = v;
  if (!map?.getLayer(LAYER_STATIC)) return;

  map.setLayoutProperty(LAYER_STATIC, 'visibility', v ? 'visible' : 'none');
  map.setLayoutProperty(LAYER_TRAIL, 'visibility', v ? 'visible' : 'none');

  if (v) {
    applyVisibilityStyle();
    if (animating) {
      spawnParticles();
      lastTick = 0;
      if (!animFrame) animFrame = requestAnimationFrame(tick);
      map.getSource(SOURCE_STATIC)?.setData(emptyFC());
    } else {
      if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
      rebuildStaticStreamlines();
    }
  } else {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    map.getSource(SOURCE_STATIC)?.setData(emptyFC());
    map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
  }
}

export function setAnimating(v) {
  animating = v;
  if (!visible) return;

  if (v) {
    if (animFrame) cancelAnimationFrame(animFrame);
    map.getSource(SOURCE_STATIC)?.setData(emptyFC());
    spawnParticles();
    lastTick = 0;
    animFrame = requestAnimationFrame(tick);
  } else {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    map.getSource(SOURCE_TRAILS)?.setData(emptyFC());
    rebuildStaticStreamlines();
  }
}

export function setSpeedColoring(v) {
  speedColoring = v;
  if (!visible) return;
  applyVisibilityStyle();
  if (!animating) rebuildStaticStreamlines();
}

/** One RK-style step along surface currents (same logic as animated particles). */
export function advectOceanStep(lon, lat) {
  const f = sampleField(lon, lat);
  if (!f || f.speed < 0.012) return null;
  const mag = Math.hypot(f.u, f.v);
  const nu = f.u / mag;
  const nv = f.v / mag;
  const cosClamped = Math.max(0.22, Math.abs(Math.cos(lat * (Math.PI / 180))));
  const step = BASE_STEP * 1.1;
  let nlon = lon + (step * nu) / cosClamped;
  let nlat = lat + step * nv;
  if (nlon > 180) nlon -= 360;
  if (nlon < -180) nlon += 360;
  nlat = Math.max(-85, Math.min(85, nlat));
  if (Math.abs(nlon - lon) > 90) return null;
  return { lon: nlon, lat: nlat, speed: f.speed };
}
