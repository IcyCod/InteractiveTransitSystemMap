/* The picture drawn underneath a real map, shared by the editor's map and the journey planner's: raster tiles through
   Leaflet, or a vector style through MapLibre GL (loaded only when one is picked). Swapping never touches the map's
   own data. Free, no-key sources: OSM Liberty (OpenFreeMap) is the default; VersaTiles' Neutrino and Colorful are made
   for the Shortbread tile schema. */
(function (TM) {
  const tiles = (TM.tiles = {});

  /* MapLibre GL JS v6 (an ES module only — no script file to include) + its Leaflet bridge, which looks for MapLibre on window */
  const MAPLIBRE = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.13.0/dist/';
  const BRIDGE_JS = 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js';
  let loading = null;
  function ensureMapLibre() {
    if (window.L && L.maplibreGL) return Promise.resolve();
    if (loading) return loading;
    loading = import(MAPLIBRE + 'maplibre-gl.mjs').then((lib) => new Promise((resolve, reject) => {
      window.maplibregl = lib;
      const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = MAPLIBRE + 'maplibre-gl.css'; document.head.appendChild(stylesheet);
      const pluginScript = document.createElement('script');
      pluginScript.src = BRIDGE_JS;
      pluginScript.onload = resolve;
      pluginScript.onerror = () => reject(new Error('maplibre-gl-leaflet failed to load'));
      document.head.appendChild(pluginScript);
    })).catch((e) => { loading = null; throw e; });
    return loading;
  }

  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  tiles.layers = {
    liberty: { name: 'OSM Liberty (default)', vector: true, style: 'https://tiles.openfreemap.org/styles/liberty', attr: OSM_ATTR + ', tiles by <a href="https://openfreemap.org">OpenFreeMap</a>' },
    osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: OSM_ATTR, max: 19 },
    neutrino: { name: 'Shortbread (VersaTiles Neutrino)', vector: true, style: 'https://tiles.versatiles.org/assets/styles/neutrino/style.json', attr: OSM_ATTR + ', tiles by <a href="https://versatiles.org">VersaTiles</a>' },
    colorful: { name: 'Shortbread (VersaTiles Colorful)', vector: true, style: 'https://tiles.versatiles.org/assets/styles/colorful/style.json', attr: OSM_ATTR + ', tiles by <a href="https://versatiles.org">VersaTiles</a>' },
    topo: { name: 'OpenTopoMap', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attr: OSM_ATTR + ', SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>', max: 17 },
    satellite: { name: 'Satellite (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '&copy; Esri', max: 19 },
  };
  tiles.key = () => (tiles.layers[TM.state.mapTileLayer] ? TM.state.mapTileLayer : 'liberty');

  /* Put the chosen layer on a Leaflet map; owner holds what is drawn ({ tile, _tileGen }). A generation token stops a
     slow vector load from clobbering a later switch; a vector style that cannot load falls back to plain OSM. */
  tiles.apply = (map, owner) => {
    const key = tiles.key(), layer = tiles.layers[key], generation = owner._tileGen = (owner._tileGen || 0) + 1;
    if (owner.tile) { map.removeLayer(owner.tile); owner.tile = null; }
    if (layer.vector) {
      ensureMapLibre().then(() => {
        if (owner._tileGen !== generation) return;
        owner.tile = L.maplibreGL({ style: layer.style, attribution: layer.attr }).addTo(map);
      }).catch(() => {
        if (owner._tileGen !== generation) return;
        TM.toast('Could not load the vector map layer (offline?)', 'err');
        TM.state.mapTileLayer = 'osm'; TM.emit('maptool'); tiles.apply(map, owner);
      });
    } else {
      owner.tile = L.tileLayer(layer.url, { attribution: layer.attr, maxZoom: layer.max }).addTo(map);
    }
    map.getContainer().classList.toggle('map-dark', (document.documentElement.dataset.theme || 'light') === 'dark' && key === 'osm');   // the dark CSS filter is tuned for OSM Standard only
  };
})(window.TM);
