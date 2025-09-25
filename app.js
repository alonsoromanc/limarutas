/* app.js */
(function () {
  const MAP_CENTER = [-12.0464, -77.0428]; // Lima
  const DATA_URL = 'data/overpass.json';   // Pon aquí tu JSON

  const map = L.map('map', { preferCanvas: true }).setView(MAP_CENTER, 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  const statusEl = document.getElementById('status');

  fetch(DATA_URL)
    .then(r => {
      if (!r.ok) throw new Error('No se pudo cargar el JSON');
      return r.json();
    })
    .then(osmJson => {
      // Convierte Overpass JSON a GeoJSON
      const gj = osmtogeojson(osmJson);
      // Filtra solo líneas
      const features = (gj.features || []).filter(f =>
        f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
      );

      if (!features.length) {
        statusEl.textContent = 'No se encontraron líneas en el JSON. Asegúrate de incluir ways y nodos.';
        console.warn('GeoJSON sin líneas. ¿El Overpass trajo solo relaciones?');
        return;
      }

      // Capa principal
      const group = L.featureGroup().addTo(map);

      // Dibuja cada feature con estilo
      const layer = L.geoJSON(
        { type: 'FeatureCollection', features },
        {
          style: feat => {
            const tags = (feat.properties && feat.properties.tags) || {};
            const color = pickColor(tags.colour, feat.properties && feat.properties.id);
            return {
              color,
              weight: 3,
              opacity: 0.9
            };
          },
          onEachFeature: (feat, lyr) => {
            const tags = (feat.properties && feat.properties.tags) || {};
            const id = (feat.properties && feat.properties.id) || '';
            const name = tags.name || '';
            const ref = tags.ref || '';
            const from = tags.from || '';
            const to = tags.to || '';
            const operator = tags.operator || '';
            const html =
              `<b>${ref || name || 'Ruta'}</b><br>` +
              (from || to ? `<div>${from} → ${to}</div>` : '') +
              (operator ? `<div><i>${operator}</i></div>` : '') +
              (id ? `<div style="opacity:.7">OSM: ${id}</div>` : '');
            lyr.bindPopup(html);

            lyr.on('mouseover', () => lyr.setStyle({ weight: 6, opacity: 1 }));
            lyr.on('mouseout', () => lyr.setStyle({ weight: 3, opacity: 0.9 }));
          }
        }
      ).addTo(group);

      try {
        map.fitBounds(group.getBounds(), { padding: [20, 20] });
      } catch (e) {
        // Si no hay bounds válidos, deja el centro por defecto
      }

      statusEl.textContent = `Rutas dibujadas: ${features.length}`;
    })
    .catch(err => {
      statusEl.textContent = 'Error cargando datos';
      console.error(err);
    });

  // Toma el color del tag "colour" si existe y es válido; si no, genera uno estable por id
  function pickColor(colourTag, stableSeed) {
    if (isValidColor(colourTag)) return colourTag;
    const seed = String(stableSeed || Math.random());
    const hue = hashToHue(seed);
    return `hsl(${hue}, 85%, 45%)`;
  }

  function isValidColor(c) {
    if (!c || typeof c !== 'string') return false;
    // Acepta #RGB, #RRGGBB o valores CSS como "red" o "hsl(...)"
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return true;
    if (/^hsl\(/i.test(c)) return true;
    // Intento rápido
    const s = document.createElement('span');
    s.style.color = '';
    s.style.color = c;
    return s.style.color !== '';
  }

  function hashToHue(str) {
    // Hash simple y estable a 0..359
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h % 360;
  }
})();
