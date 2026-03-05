// initialize map
const map = L.map('map', {
  renderer: L.canvas()
}).setView([20, 0], 3);

// base map
L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 20,
    minZoom: 2
  }
).addTo(map);


// lookup tables
let riverIndex = {}; 
let upstreamIndex = {}; 
let layerIndex = {};

let riversLayer;


// load rivers
fetch("data/rivers.geojson")
  .then(response => response.json())
  .then(data => {

    // build indexes
    data.features.forEach(feature => {

      const id = feature.properties.HYRIV_ID;
      const next = feature.properties.NEXT_DOWN;

      riverIndex[id] = feature;

      if (!upstreamIndex[next]) {
        upstreamIndex[next] = [];
      }

      upstreamIndex[next].push(feature);

    });


    // rivers
    riversLayer = L.geoJSON(data, {

      style: {
        color: "blue",
        weight: 4,
        opacity: 0.9
      },

      onEachFeature: function(feature, layer) {

        const id = feature.properties.HYRIV_ID;

        // store layer for lookup
        layerIndex[id] = layer;

        layer.on("click", function() {

          riversLayer.resetStyle();

          highlightDownstream(feature);
          highlightUpstream(feature);

        });

      }

    }).addTo(map);

  });



// highlight downstream to ocean
function highlightDownstream(feature) {

  let current = feature;

  while (current) {

    highlightSegment(current);

    const nextID = current.properties.NEXT_DOWN;

    if (!nextID || nextID === 0) break;

    current = riverIndex[nextID];

  }

}


// highlight upstream tributaries recursively
function highlightUpstream(feature) {

  const id = feature.properties.HYRIV_ID;

  const upstream = upstreamIndex[id];

  if (!upstream) return;

  upstream.forEach(up => {

    highlightSegment(up);

    highlightUpstream(up);

  });

}


// highlight a single segment
function highlightSegment(feature) {

  const id = feature.properties.HYRIV_ID;

  const layer = layerIndex[id];

  if (layer) {
    layer.setStyle({
      color: "red",
      weight: 6
    });
  }

}