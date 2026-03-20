'use strict';

/* Initialises Leaflet maps. Called after leaflet.min.js is loaded.
 * Overview map: reads window.MAP_DATA (injected by the map page template).
 * Ensemble map: reads window.ENSEMBLE_GEO (injected by ensemble detail template).
 */

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';

function buildPinIcon() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">' +
    '<path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24S24 21 24 12C24 5.373 18.627 0 12 0z"' +
    ' fill="#1a4f8a" stroke="#fff" stroke-width="1.5"/>' +
    '<circle cx="12" cy="12" r="4.5" fill="#fff"/>' +
    '</svg>';
  return L.divIcon({
    html: svg,
    className: '',
    iconSize:    [24, 36],
    iconAnchor:  [12, 36],
    popupAnchor: [0, -36],
  });
}

function addTiles(map) {
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
}

function buildPopupHtml(ens) {
  const logo = ens.logoUrl
    ? `<img src="${ens.logoUrl}" alt="Logo ${ens.title}" style="max-width:64px;max-height:64px;object-fit:contain;float:right;margin:0 0 4px 8px;">`
    : '';
  const excerpt = ens.excerpt ? `<p style="margin:4px 0 6px;font-size:.85em;">${ens.excerpt}</p>` : '';
  return (
    `${logo}<strong><a href="${ens.url}">${ens.title}</a></strong>` +
    `<br><small>${ens.typeLabel}</small>` +
    excerpt +
    `<br><a href="${ens.url}">Mehr erfahren →</a>`
  );
}

function buildListItem(ens) {
  const li = document.createElement('li');
  li.className = 'map-ensemble-item';
  li.dataset.slug = ens.slug;
  li.innerHTML =
    `<a href="${ens.url}" class="map-ensemble-item-link">` +
    `<span class="map-ensemble-item-title">${ens.title}</span>` +
    `<span class="map-ensemble-item-type">${ens.typeLabel}</span>` +
    `</a>`;
  return li;
}

function updateVisibleList(map, data) {
  const listEl = document.getElementById('map-ensemble-list');
  const countEl = document.getElementById('map-list-count');
  if (!listEl) return;

  const bounds = map.getBounds();
  const visible = data.filter(ens => bounds.contains([ens.lat, ens.lng]));

  listEl.innerHTML = '';
  for (const ens of visible) {
    listEl.appendChild(buildListItem(ens));
  }
  if (countEl) countEl.textContent = `(${visible.length})`;
}

function initOverviewMap() {
  const el = document.getElementById('map-overview');
  if (!el || !window.MAP_DATA || !window.MAP_DATA.length) return;

  const map = L.map('map-overview').setView([52.27, 9.15], 11);
  addTiles(map);

  const icon = buildPinIcon();
  for (const ens of window.MAP_DATA) {
    L.marker([ens.lat, ens.lng], { icon, title: ens.title })
      .bindPopup(buildPopupHtml(ens))
      .addTo(map);
  }

  const refresh = () => updateVisibleList(map, window.MAP_DATA);
  map.on('moveend', refresh);
  map.on('zoomend', refresh);
  map.whenReady(refresh);
}

function initEnsembleMap() {
  const el = document.getElementById('map-ensemble');
  if (!el || !window.ENSEMBLE_GEO) return;

  const { lat, lng, title } = window.ENSEMBLE_GEO;
  const map = L.map('map-ensemble').setView([lat, lng], 14);
  addTiles(map);

  L.marker([lat, lng], { icon: buildPinIcon(), title })
    .bindPopup(`<strong>${title}</strong>`)
    .addTo(map)
    .openPopup();
}

initOverviewMap();
initEnsembleMap();
