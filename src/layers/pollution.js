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
const PARTICLES_PER_DROP = 4;

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
  for (let i = 0; i < PARTICLES_PER_DROP; i++) {
    dropParticle(lng, lat, i);
  }
}

function dropParticle(lng, lat, index) {
  const nearest = nearestFeature([lng, lat], allFeatures);
  if (!nearest) return;

  const coords = nearest.geometry.coordinates;
  const discharge = nearest.properties.DIS_AV_CMS || 100;
  const distToOcean = nearest.properties.DIST_DN_KM || 0;

  // Stagger start position slightly along the segment so particles spread
  const tOffset = (index / PARTICLES_PER_DROP) * 0.8;
  // Each particle gets a unique random jitter applied during interpolation
  const tDeviation = (Math.random() - 0.5) * 0.18;
  // Speed varies ±30% per particle
  const speedMult = 0.7 + Math.random() * 0.6;
  // Unique hue shift so particles are subtly different colours
  const hueShift = Math.round((Math.random() - 0.5) * 30);

  particles.push({
    phase: 'river',
    feature: nearest,
    coords,
    t: tOffset,
    distLeft: distToOcean,
    totalDist: distToOcean,
    trail: [],
    speed: SPEED_SCALE * Math.max(1, Math.log10(discharge)) * speedMult,
    tDeviation,
    hueShift,
    id: Date.now() + Math.random()
  });

  canvas.style.display = 'block';
  syncAnimationLoop();
  updatePollutionStats();
}

// Draw a fading trail where opacity decreases toward the tail
function drawTrailScreen(trail, r, g, b, lineWidth) {
  if (trail.length < 2) return;
  for (let i = 1; i < trail.length; i++) {
    const alpha = (i / trail.length) * 0.55;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawGlowOrb(x, y, r, g, b, radius = 7) {
  const t = Date.now() * 0.004;
  const pulse = Math.sin(t) * 2;
  const outerR = radius + pulse + 5;

  // Soft outer glow ring
  const grd = ctx.createRadialGradient(x, y, 0, x, y, outerR);
  grd.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.55)`);
  grd.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.18)`);
  grd.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.beginPath();
  ctx.arc(x, y, outerR, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // Solid bright core
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${Math.min(r + 80, 255)}, ${Math.min(g + 80, 255)}, ${Math.min(b + 80, 255)}, 0.95)`;
  ctx.fill();
}

function drawOceanPulse(x, y, hueShift) {
  const t = Date.now() * 0.003;
  const pulse = (Math.sin(t) + 1) * 5;

  // Expanding ring
  ctx.beginPath();
  ctx.arc(x, y, 13 + pulse, 0, Math.PI * 2);
  ctx.strokeStyle = `hsla(${185 + hueShift}, 100%, 65%, 0.4)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Orb in ocean blue/cyan palette
  const [r, g, b] = hslToRgb(185 + hueShift, 100, 60);
  drawGlowOrb(x, y, r, g, b, 6);
}

// Utility: convert HSL to RGB integers
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
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
    const hue = p.hueShift || 0;

    if (p.phase === 'done') {
      const s = p.doneScreen || map.project([p.oceanLon, p.oceanLat]);
      drawOceanPulse(s.x, s.y, hue);
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

      drawTrailScreen(p.trail, 0, 212, 255, 2);
      drawOceanPulse(screen.x, screen.y, hue);
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

    // Clamp t with per-particle deviation for path spread
    const tJittered = Math.max(0, Math.min(1, p.t + p.tDeviation));
    const pos = interpolateAlong(p.coords, tJittered);
    const screen = map.project(pos);
    p.trail.push({ x: screen.x, y: screen.y });
    if (p.trail.length > 80) p.trail.shift();

    // River: warm red/orange palette with per-particle hue shift
    const [r, g, b] = hslToRgb(5 + hue, 95, 58);
    drawTrailScreen(p.trail, r, g, b, 2);
    drawGlowOrb(screen.x, screen.y, r, g, b, 7);
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