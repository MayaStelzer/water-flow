import { riverIndex, upstreamIndex } from '../utils/graph.js';
import { nearestFeature, interpolateAlong, haversineKm } from '../utils/geo.js';

let map;
let particles = [];
let animFrame = null;
let canvas, ctx;
let dropMode = false;
let visible = false;
let allFeatures = [];

const SPEED_SCALE = 0.0008; // fraction of segment per frame, scaled by discharge

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
  if (!dropMode || !visible) return;
  const { lng, lat } = e.lngLat;
  dropParticle(lng, lat);
}

function dropParticle(lng, lat) {
  // Find nearest river segment
  const nearest = nearestFeature([lng, lat], allFeatures);
  if (!nearest) return;

  const coords = nearest.geometry.coordinates;
  const discharge = nearest.properties.DIS_AV_CMS || 100;
  const distToOcean = nearest.properties.DIST_DN_KM || 0;

  particles.push({
    feature: nearest,
    coords,
    t: 0,           // progress along current segment (0–1)
    distLeft: distToOcean,
    totalDist: distToOcean,
    reachedOcean: false,
    trail: [],
    speed: SPEED_SCALE * Math.max(1, Math.log10(discharge)),
    id: Date.now() + Math.random()
  });

  updatePollutionStats();
}

function animate() {
  if (!visible) return;
  animFrame = requestAnimationFrame(animate);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  particles.forEach(p => {
    if (p.reachedOcean) {
      drawReachedOcean(p);
      return;
    }

    // Advance along segment
    p.t += p.speed;

    // Move to next segment when done
    while (p.t >= 1) {
      p.t -= 1;
      const nextID = p.feature.properties.NEXT_DOWN;
      if (!nextID || nextID === 0) {
        p.reachedOcean = true;
        p.t = 1;
        break;
      }
      const nextFeature = riverIndex[nextID];
      if (!nextFeature) {
        p.reachedOcean = true;
        break;
      }
      p.feature = nextFeature;
      p.coords = nextFeature.geometry.coordinates;
      p.distLeft = nextFeature.properties.DIST_DN_KM || 0;
    }

    // Current position
    const pos = interpolateAlong(p.coords, p.t);
    const screen = map.project(pos);

    // Add to trail
    p.trail.push({ x: screen.x, y: screen.y });
    if (p.trail.length > 80) p.trail.shift();

    // Draw trail
    drawTrail(p);

    // Draw particle
    drawParticle(screen.x, screen.y, false);
  });

  updatePollutionStats();
}

function drawTrail(p) {
  if (p.trail.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(p.trail[0].x, p.trail[0].y);
  for (let i = 1; i < p.trail.length; i++) {
    const alpha = i / p.trail.length;
    ctx.lineTo(p.trail[i].x, p.trail[i].y);
  }
  ctx.strokeStyle = 'rgba(255, 50, 50, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawParticle(x, y, atOcean) {
  const color = atOcean ? '#ff6b35' : '#ff3232';
  const radius = atOcean ? 8 : 5;

  // Glow
  const grd = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.5);
  grd.addColorStop(0, atOcean ? 'rgba(255,107,53,0.6)' : 'rgba(255,50,50,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // Core dot
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawReachedOcean(p) {
  // Pulse animation at final position
  const pos = p.coords[p.coords.length - 1];
  const screen = map.project(pos);
  const pulse = (Math.sin(Date.now() * 0.003) + 1) * 6;

  drawParticle(screen.x, screen.y, true);

  // Pulse ring
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, 10 + pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 107, 53, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function updatePollutionStats() {
  const panel = document.getElementById('pollution-stats');
  const statusEl = document.getElementById('poll-status');
  const distEl = document.getElementById('poll-distance');
  const timeEl = document.getElementById('poll-time');

  if (!panel || particles.length === 0) return;
  panel.classList.remove('hidden');

  const active = particles.filter(p => !p.reachedOcean);
  const reached = particles.filter(p => p.reachedOcean);

  if (statusEl) statusEl.textContent =
    reached.length > 0
      ? `${reached.length} reached ocean`
      : `${active.length} in transit`;

  const p = active[0] || particles[0];
  if (distEl) distEl.textContent = p.reachedOcean
    ? 'At ocean outlet'
    : `~${Math.round(p.distLeft).toLocaleString()} km`;

  if (timeEl) timeEl.textContent = particles.length > 0
    ? `${particles.length} particle${particles.length > 1 ? 's' : ''} total`
    : '—';
}

export function setVisible(v) {
  visible = v;
  if (!canvas) return;
  canvas.style.display = v ? 'block' : 'none';
  if (v) {
    animate();
  } else {
    if (animFrame) cancelAnimationFrame(animFrame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function setDropMode(v) {
  dropMode = v;
  map.getCanvas().style.cursor = v ? 'crosshair' : '';
}

export function clearParticles() {
  particles = [];
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  const panel = document.getElementById('pollution-stats');
  if (panel) panel.classList.add('hidden');
  const clearBtn = document.getElementById('clear-pollution');
  if (clearBtn) clearBtn.classList.add('hidden');
}
