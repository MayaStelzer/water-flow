import { riverIndex } from '../utils/graph.js';
import { nearestFeature, interpolateAlong } from '../utils/geo.js';
import { advectOceanStep } from './currents.js';

let map;
let particles = [];
let animFrame = null;
let canvas, ctx;
let dropMode = false;
let allFeatures = [];

const SPEED_SCALE = 0.0008;
const MAX_OCEAN_FRAMES = 2400;
const OCEAN_STALL_DONE = 50;

function syncAnimationLoop() {
  const run = dropMode || particles.length > 0;
  if (!run) {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (!animFrame) animFrame = requestAnimationFrame(animate);
}

export function initPollution(mapInstance, features) {
  map = mapInstance;
  allFeatures = features;

  canvas = document.createElement('canvas');
  canvas.style.cssText = `
    position: fixed; inset: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 15;
    display: none;
  `;
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  map.on('click', onMapClick);
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function onMapClick(e) {
  if (!dropMode) return;
  const { lng, lat } = e.lngLat;
  dropParticle(lng, lat);
}

function dropParticle(lng, lat) {
  const nearest = nearestFeature([lng, lat], allFeatures);
  if (!nearest) return;

  const coords = nearest.geometry.coordinates;
  const discharge = nearest.properties.DIS_AV_CMS || 100;
  const distToOcean = nearest.properties.DIST_DN_KM || 0;

  particles.push({
    phase: 'river',
    feature: nearest,
    coords,
    t: 0,
    distLeft: distToOcean,
    totalDist: distToOcean,
    trail: [],
    speed: SPEED_SCALE * Math.max(1, Math.log10(discharge)),
    id: Date.now() + Math.random()
  });

  canvas.style.display = 'block';
  syncAnimationLoop();
  updatePollutionStats();
}

function drawTrailScreen(trail, strokeStyle, lineWidth) {
  if (trail.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(trail[0].x, trail[0].y);
  for (let i = 1; i < trail.length; i++) {
    ctx.lineTo(trail[i].x, trail[i].y);
  }
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawGarbageEmoji(x, y) {
  const size = 20;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🗑️', x, y);
}

function drawOceanPulse(x, y) {
  const pulse = (Math.sin(Date.now() * 0.003) + 1) * 6;
  ctx.beginPath();
  ctx.arc(x, y, 12 + pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawGarbageEmoji(x, y);
}

function animate() {
  if (!dropMode && particles.length === 0) {
    animFrame = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  animFrame = requestAnimationFrame(animate);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  particles.forEach(p => {
    if (p.phase === 'done') {
      const s = p.doneScreen || map.project([p.oceanLon, p.oceanLat]);
      drawOceanPulse(s.x, s.y);
      return;
    }

    if (p.phase === 'ocean') {
      const n = advectOceanStep(p.oceanLon, p.oceanLat);
      p.oceanFrames = (p.oceanFrames || 0) + 1;

      const screen = map.project([p.oceanLon, p.oceanLat]);
      p.trail.push({ x: screen.x, y: screen.y });
      if (p.trail.length > 100) p.trail.shift();

      if (!n) p.oceanStall = (p.oceanStall || 0) + 1;
      else {
        p.oceanStall = 0;
        p.oceanLon = n.lon;
        p.oceanLat = n.lat;
      }

      if (p.oceanStall >= OCEAN_STALL_DONE || p.oceanFrames >= MAX_OCEAN_FRAMES) {
        p.phase = 'done';
        p.doneScreen = map.project([p.oceanLon, p.oceanLat]);
      }

      drawTrailScreen(p.trail, 'rgba(0, 212, 255, 0.38)', 2);
      drawGarbageEmoji(screen.x, screen.y);
      return;
    }

    // River phase
    p.t += p.speed;

    while (p.t >= 1) {
      p.t -= 1;
      const nextID = p.feature.properties.NEXT_DOWN;
      if (!nextID || nextID === 0) {
        const mouth = p.coords[p.coords.length - 1];
        p.phase = 'ocean';
        p.oceanLon = mouth[0];
        p.oceanLat = mouth[1];
        p.oceanFrames = 0;
        p.oceanStall = 0;
        p.trail = [];
        p.t = 1;
        break;
      }
      const nextFeature = riverIndex[nextID];
      if (!nextFeature) {
        const mouth = p.coords[p.coords.length - 1];
        p.phase = 'ocean';
        p.oceanLon = mouth[0];
        p.oceanLat = mouth[1];
        p.oceanFrames = 0;
        p.oceanStall = 0;
        p.trail = [];
        break;
      }
      p.feature = nextFeature;
      p.coords = nextFeature.geometry.coordinates;
      p.distLeft = nextFeature.properties.DIST_DN_KM || 0;
    }

    if (p.phase === 'ocean') return;

    const pos = interpolateAlong(p.coords, p.t);
    const screen = map.project(pos);
    p.trail.push({ x: screen.x, y: screen.y });
    if (p.trail.length > 80) p.trail.shift();

    drawTrailScreen(p.trail, 'rgba(255, 50, 50, 0.4)', 2);
    drawGarbageEmoji(screen.x, screen.y);
  });

  updatePollutionStats();
}

function updatePollutionStats() {
  const panel = document.getElementById('pollution-stats');
  const statusEl = document.getElementById('poll-status');
  const distEl = document.getElementById('poll-distance');
  const timeEl = document.getElementById('poll-time');

  if (!panel || particles.length === 0) return;
  panel.classList.remove('hidden');

  const activeRiver = particles.filter(p => p.phase === 'river');
  const activeOcean = particles.filter(p => p.phase === 'ocean');
  const done = particles.filter(p => p.phase === 'done');

  if (statusEl) {
    if (activeOcean.length > 0) statusEl.textContent = `${activeOcean.length} following currents`;
    else if (activeRiver.length > 0) statusEl.textContent = `${activeRiver.length} in river`;
    else if (done.length > 0) statusEl.textContent = `${done.length} path finished`;
    else statusEl.textContent = '—';
  }

  const p = activeRiver[0] || activeOcean[0] || particles[0];
  if (distEl) {
    if (p.phase === 'river') {
      distEl.textContent = p.distLeft != null ? `~${Math.round(p.distLeft).toLocaleString()} km` : '—';
    } else if (p.phase === 'ocean') {
      distEl.textContent = 'Surface drift (model)';
    } else {
      distEl.textContent = 'See map';
    }
  }

  if (timeEl) {
    timeEl.textContent = `${particles.length} marker${particles.length > 1 ? 's' : ''}`;
  }
}

export function setDropMode(v) {
  dropMode = v;
  map.getCanvas().style.cursor = v ? 'crosshair' : '';
  if (!v && particles.length === 0) canvas.style.display = 'none';
  else if (v || particles.length > 0) canvas.style.display = 'block';
  syncAnimationLoop();
}

export function clearParticles() {
  particles = [];
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display = 'none';
  const panel = document.getElementById('pollution-stats');
  if (panel) panel.classList.add('hidden');
  const clearBtn = document.getElementById('clear-pollution');
  if (clearBtn) clearBtn.classList.add('hidden');
}
