'use strict';

/* Initialises Leaflet maps. Called after leaflet.js is loaded.
 * Overview map: reads window.MAP_DATA (injected by the map page template).
 * Ensemble map: reads window.ENSEMBLE_GEO (injected by ensemble detail template).
 */

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>-Mitwirkende';

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

function buildClusterIcon(count) {
  const inner =
    '<div style="background:#1a4f8a;color:#fff;border:2px solid #fff;border-radius:50%;' +
    'width:32px;height:32px;display:flex;align-items:center;justify-content:center;' +
    'font-weight:700;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,.4);">' +
    count + '</div>';
  return L.divIcon({
    html: inner,
    className: '',
    iconSize:    [32, 32],
    iconAnchor:  [16, 32],
    popupAnchor: [0, -34],
  });
}

function addTiles(map) {
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
}

function createLink(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}

function buildPopupContent(ens) {
  const div = document.createElement('div');

  if (ens.logoUrl) {
    const img = document.createElement('img');
    img.src = ens.logoUrl;
    img.alt = 'Logo ' + ens.title;
    img.style.cssText = 'max-width:64px;max-height:64px;object-fit:contain;float:right;margin:0 0 4px 8px;';
    div.appendChild(img);
  }

  const strong = document.createElement('strong');
  strong.appendChild(createLink(ens.url, ens.title));
  div.appendChild(strong);
  div.appendChild(document.createElement('br'));

  const small = document.createElement('small');
  small.textContent = ens.typeLabel;
  div.appendChild(small);

  if (ens.excerpt) {
    const p = document.createElement('p');
    p.style.cssText = 'margin:4px 0 6px;font-size:.85em;';
    p.textContent = ens.excerpt;
    div.appendChild(p);
  }

  div.appendChild(document.createElement('br'));
  div.appendChild(createLink(ens.url, 'Mehr erfahren \u2192'));
  return div;
}

function buildClusterPopupContent(group) {
  const div = document.createElement('div');

  const heading = document.createElement('strong');
  heading.textContent = group.length + ' Ensembles';
  div.appendChild(heading);

  const ul = document.createElement('ul');
  ul.style.cssText = 'margin:6px 0 0;padding-left:1rem;';

  for (const ens of group) {
    const li = document.createElement('li');
    li.appendChild(createLink(ens.url, ens.title));
    const typeSpan = document.createElement('span');
    typeSpan.style.cssText = 'color:#666;font-size:.85em;display:block;';
    typeSpan.textContent = ens.typeLabel;
    li.appendChild(typeSpan);
    ul.appendChild(li);
  }

  div.appendChild(ul);
  return div;
}

function groupByLocation(data) {
  const groups = new Map();
  for (const ens of data) {
    const key = `${ens.lat},${ens.lng}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ens);
  }
  return groups;
}

function fitOverviewMap(map, points) {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView(points[0], 10);
    return;
  }

  map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 10 });
}

function buildListItem(ens) {
  const li = document.createElement('li');
  li.className = 'map-ensemble-item';
  li.dataset.slug = ens.slug;

  const link = document.createElement('a');
  link.className = 'map-ensemble-item-link';
  link.href = ens.url;

  const titleSpan = document.createElement('span');
  titleSpan.className = 'map-ensemble-item-title';
  titleSpan.textContent = ens.title;

  const typeSpan = document.createElement('span');
  typeSpan.className = 'map-ensemble-item-type';
  typeSpan.textContent = ens.typeLabel;

  link.appendChild(titleSpan);
  link.appendChild(typeSpan);
  li.appendChild(link);
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

function watchContainerResize(map, el) {
  if (!('ResizeObserver' in window)) return;
  new ResizeObserver(() => map.invalidateSize()).observe(el);
}

function initOverviewMap() {
  const el = document.getElementById('map-overview');
  if (!el || !window.MAP_DATA || !window.MAP_DATA.length) return;

  const map = L.map('map-overview');
  addTiles(map);

  const singleIcon = buildPinIcon();
  const groups = groupByLocation(window.MAP_DATA);
  const points = [];

  for (const group of groups.values()) {
    const { lat, lng } = group[0];
    points.push([lat, lng]);
    if (group.length === 1) {
      L.marker([lat, lng], { icon: singleIcon, title: group[0].title })
        .bindPopup(buildPopupContent(group[0]))
        .addTo(map);
    } else {
      const names = group.map(e => e.title).join(', ');
      L.marker([lat, lng], { icon: buildClusterIcon(group.length), title: names })
        .bindPopup(buildClusterPopupContent(group))
        .addTo(map);
    }
  }

  const refresh = () => updateVisibleList(map, window.MAP_DATA);
  map.on('moveend', refresh);
  map.on('zoomend', refresh);
  fitOverviewMap(map, points);
  map.whenReady(refresh);
  watchContainerResize(map, el);
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

  watchContainerResize(map, el);
}

window.addEventListener('load', function () {
  initOverviewMap();
  initEnsembleMap();
});
