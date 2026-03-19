// Find the nearest feature to a [lng, lat] point
// features: array of GeoJSON LineString features
export function nearestFeature(lngLat, features) {
  let nearest = null;
  let minDist = Infinity;

  features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const d = pointToSegmentDist(lngLat, coords[i], coords[i + 1]);
      if (d < minDist) {
        minDist = d;
        nearest = feature;
      }
    }
  });

  return nearest;
}

// Squared distance from point P to segment AB
function pointToSegmentDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return dist2(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return dist2(p, [a[0] + t * dx, a[1] + t * dy]);
}

function dist2(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

// Interpolate position along a LineString at fraction t (0–1)
export function interpolateAlong(coords, t) {
  if (t <= 0) return coords[0];
  if (t >= 1) return coords[coords.length - 1];

  // compute total length
  let total = 0;
  const segs = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const d = dist2(coords[i], coords[i + 1]);
    segs.push(d);
    total += d;
  }

  let target = t * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const frac = target / segs[i];
      return [
        coords[i][0] + frac * (coords[i + 1][0] - coords[i][0]),
        coords[i][1] + frac * (coords[i + 1][1] - coords[i][1])
      ];
    }
    target -= segs[i];
  }

  return coords[coords.length - 1];
}

// Haversine distance in km between two [lng, lat] points
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = deg2rad(b[1] - a[1]);
  const dLon = deg2rad(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const c = sinLat * sinLat +
    Math.cos(deg2rad(a[1])) * Math.cos(deg2rad(b[1])) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

function deg2rad(d) { return d * Math.PI / 180; }
