// riverIndex: HYRIV_ID -> feature
// upstreamIndex: NEXT_DOWN -> [features]
export let riverIndex = {};
export let upstreamIndex = {};

export function buildIndexes(features) {
  features.forEach(feature => {
    const id = feature.properties.HYRIV_ID;
    const next = feature.properties.NEXT_DOWN;
    riverIndex[id] = feature;
    if (!upstreamIndex[next]) upstreamIndex[next] = [];
    upstreamIndex[next].push(feature);
  });
}

// Returns Set of HYRIV_IDs downstream from feature to ocean
export function getDownstreamIds(feature) {
  const ids = new Set();
  let current = feature;
  while (current) {
    ids.add(current.properties.HYRIV_ID);
    const nextID = current.properties.NEXT_DOWN;
    if (!nextID || nextID === 0) break;
    current = riverIndex[nextID];
  }
  return ids;
}

// Returns Set of HYRIV_IDs for all upstream tributaries
export function getUpstreamIds(feature) {
  const ids = new Set();
  function walk(feat) {
    const id = feat.properties.HYRIV_ID;
    const upstream = upstreamIndex[id];
    if (!upstream) return;
    upstream.forEach(up => {
      ids.add(up.properties.HYRIV_ID);
      walk(up);
    });
  }
  walk(feature);
  return ids;
}

// Returns full connected watershed: upstream + downstream
export function getWatershedIds(feature) {
  const down = getDownstreamIds(feature);
  const up = getUpstreamIds(feature);
  return new Set([...down, ...up]);
}

// Compute total distance to ocean from a feature
export function distanceToOcean(feature) {
  return feature.properties.DIST_DN_KM || 0;
}

// Get the outlet feature (NEXT_DOWN === 0) for a given feature
export function getOceanOutlet(feature) {
  let current = feature;
  while (current) {
    const nextID = current.properties.NEXT_DOWN;
    if (!nextID || nextID === 0) return current;
    current = riverIndex[nextID];
  }
  return current;
}
