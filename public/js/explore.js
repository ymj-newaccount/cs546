// public/js/explore.js
// Explore page logic:
// - Filters -> AJAX fetch GeoJSON -> Leaflet markers + List view
// - Sidebar search (q) -> filtered AJAX fetch /explore/api?q=...
// - Community report submission (AJAX POST /api/reports with CSRF)
// - Follow/Unfollow stations (AJAX POST /api/stations/:stationId/(follow|unfollow) with CSRF)
// - Welcome poster modal (shows on every page load)

// -------------------- DOM API --------------------

const mapDiv = document.getElementById('map');

const filterStations = document.getElementById('filter-stations');
const filterAccessible = document.getElementById('filter-accessible');
const filterElevators = document.getElementById('filter-elevators');
const filterAPS = document.getElementById('filter-aps');
const filterRamps = document.getElementById('filter-ramps');

// New station filters
const filterLowRisk = document.getElementById('filter-low-risk');
const filterHasNearbyAPS = document.getElementById('filter-has-nearby-aps');

const DEFAULT_MAX_RISK_SCORE = 5;

// Sidebar search (in filters column)
const searchForm = document.getElementById('sidebar-search-form');
const searchInput = document.getElementById('sidebar-search-q');
const searchClear = document.getElementById('sidebar-search-clear');

const list = document.getElementById('location-list');
const statusL = document.getElementById('filter-status');
const errorDiv = document.getElementById('error');

// Report panel elements (exist only when logged in per explore.handlebars)
const reportPanel = document.getElementById('report-panel');
const reportForm = document.getElementById('report-form');
const reportTargetLabel = document.getElementById('report-target-label');
const reportTargetType = document.getElementById('report-target-type');
const reportTargetId = document.getElementById('report-target-id');
const reportText = document.getElementById('report-text');
const reportStatus = document.getElementById('report-status');
const reportCancel = document.getElementById('report-cancel');

// Welcome modal elements
const welcomeModal = document.getElementById('welcome-modal');
const welcomeCloseBtn = document.getElementById('welcome-close');
const welcomeCloseXBtn = document.getElementById('welcome-close-x');

// CSRF token is injected into <meta name="csrf-token" ...> by main.handlebars
const csrfToken =
  document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

// Follow/unfollow initial state (bookmarks) injected by explore.handlebars
const bookmarksJsonEl = document.getElementById('bookmarks-json');
let bookmarkedStations = new Set();
if (bookmarksJsonEl) {
  try {
    const arr = JSON.parse(bookmarksJsonEl.textContent || '[]');
    if (Array.isArray(arr)) {
      bookmarkedStations = new Set(arr.map((x) => String(x).trim()).filter(Boolean));
    }
  } catch {
    bookmarkedStations = new Set();
  }
}

// Search state
const MAX_SEARCH_LEN = 80;
let currentSearch = '';

let map;
let markersLayer;

// -------------------- Helpers --------------------

function isLoggedIn() {
  return Boolean(reportForm);
}

function displayError(message) {
  if (!errorDiv) return;
  errorDiv.hidden = false;
  errorDiv.textContent = 'Error: ' + String(message);
}

function clearError() {
  if (!errorDiv) return;
  errorDiv.hidden = true;
  errorDiv.textContent = '';
}

function setReportStatus(message) {
  if (!reportStatus) return;
  reportStatus.textContent = message ? String(message) : '';
}

function normalizeSearchTerm(v) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v[0];
  return String(v)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_LEN);
}

function setUrlQueryParam(q) {
  try {
    const u = new URL(window.location.href);
    if (q) u.searchParams.set('q', q);
    else u.searchParams.delete('q');
    history.replaceState(null, '', u.toString());
  } catch {
    // ignore
  }
}

function hasAnyLayerSelected() {
  return Boolean(
    filterStations?.checked ||
      filterAccessible?.checked ||
      filterElevators?.checked ||
      filterAPS?.checked ||
      filterRamps?.checked ||
      filterLowRisk?.checked ||
      filterHasNearbyAPS?.checked
  );
}

// When user searches but has no layers selected, auto-enable a reasonable default
function ensureDefaultLayersForSearch() {
  if (hasAnyLayerSelected()) return;
  if (filterStations) filterStations.checked = true;
  if (filterAPS) filterAPS.checked = true;
  if (filterRamps) filterRamps.checked = true;
}

function initSearchFromUrl() {
  const q = new URLSearchParams(window.location.search).get('q');
  currentSearch = normalizeSearchTerm(q);
  if (searchInput) searchInput.value = currentSearch;

  if (currentSearch) {
    ensureDefaultLayersForSearch();
  }
}

// Escape for safe HTML insertion
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function readErrorPayload(resp) {
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await resp.json().catch(() => ({}));
    return data?.error ? String(data.error) : '';
  }
  const text = await resp.text().catch(() => '');
  return text ? String(text) : '';
}

function buildDetailsLinkHtml(href, text) {
  const safeHref = escapeHtml(href);
  const safeText = escapeHtml(text);
  return (
    '<div style="margin-top:8px;">' +
    `<a class="btn btn-ghost" href="${safeHref}">${safeText}</a>` +
    '</div>'
  );
}

function applyFollowButtonUI(btn, followed) {
  if (!btn) return;

  const isFollowed = Boolean(followed);
  btn.dataset.followed = isFollowed ? 'true' : 'false';
  btn.setAttribute('aria-pressed', isFollowed ? 'true' : 'false');
  btn.textContent = isFollowed ? 'Unfollow station' : 'Follow station';
  btn.classList.toggle('btn-primary', isFollowed);
  btn.classList.toggle('btn-ghost', !isFollowed);
}

// -------------------- Report Panel --------------------

function openReportPanel(targetType, targetId, label) {
  if (!reportPanel || !reportForm) {
    displayError('Please log in to submit community reports.');
    return;
  }

  reportTargetType.value = targetType;
  reportTargetId.value = targetId;

  if (reportTargetLabel) {
    reportTargetLabel.textContent = `Reporting: ${label} (${targetType}:${targetId})`;
  }

  setReportStatus('');
  if (reportText) reportText.value = '';

  reportPanel.hidden = false;
  if (reportText) reportText.focus();
}

function closeReportPanel() {
  if (!reportPanel) return;
  reportPanel.hidden = true;
  setReportStatus('');
}

function buildReportButtonHtml(targetType, targetId, label) {
  if (!isLoggedIn()) return '';

  const t = escapeHtml(targetType);
  const id = escapeHtml(targetId);
  const lab = escapeHtml(label);

  return (
    '<div style="margin-top:8px;">' +
    '<button type="button" class="btn btn-primary js-report-open" ' +
    `data-target-type="${t}" data-target-id="${id}" data-target-label="${lab}">` +
    'Report obstacle</button>' +
    '</div>'
  );
}

// -------------------- Follow/Unfollow (Station) --------------------

function buildFollowButtonHtml(stationId, stationName) {
  if (!isLoggedIn()) return '';

  const sid = escapeHtml(stationId);
  const name = escapeHtml(stationName);

  const followed = bookmarkedStations.has(String(stationId).trim());
  const btnText = followed ? 'Unfollow station' : 'Follow station';
  const followedStr = followed ? 'true' : 'false';

  const styleClass = followed ? 'btn-primary' : 'btn-ghost';

  return (
    '<div style="margin-top:8px;">' +
    `<button type="button" class="btn ${styleClass} js-follow-toggle" ` +
    `data-station-id="${sid}" data-followed="${followedStr}" data-station-name="${name}" ` +
    `aria-pressed="${followedStr}">` +
    btnText +
    '</button>' +
    '</div>'
  );
}

async function postFollowToggle(stationId, shouldFollow) {
  if (!csrfToken) throw new Error('Missing CSRF token on page (check main.handlebars meta tag).');

  const action = shouldFollow ? 'follow' : 'unfollow';
  const url = `/api/stations/${encodeURIComponent(String(stationId))}/${action}`;

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'x-csrf-token': csrfToken
    }
  });

  if (!resp.ok) {
    const msg = (await readErrorPayload(resp)) || `Request failed (HTTP ${resp.status})`;
    throw new Error(msg);
  }

  const data = await resp.json().catch(() => ({}));
  return data;
}

// -------------------- Map Refresh (AJAX) --------------------

async function refreshMap() {
  clearError();
  if (statusL) statusL.textContent = 'Loading map data...';

  const stationsChecked = Boolean(filterStations?.checked);
  const accessibleChecked = Boolean(filterAccessible?.checked);
  const elevatorsChecked = Boolean(filterElevators?.checked);
  const apsChecked = Boolean(filterAPS?.checked);
  const rampsChecked = Boolean(filterRamps?.checked);

  const lowRiskChecked = Boolean(filterLowRisk?.checked);
  const nearbyApsChecked = Boolean(filterHasNearbyAPS?.checked);

  // Station filters should also enable station results.
  const showStationsEffective =
    stationsChecked || accessibleChecked || lowRiskChecked || nearbyApsChecked;

  // Backend requires all 5 base keys; station filters are optional.
  const params = new URLSearchParams();
  params.set('showStations', String(showStationsEffective));
  params.set('onlyAccessible', String(accessibleChecked));
  params.set('showElevators', String(elevatorsChecked));
  params.set('showAPS', String(apsChecked));
  params.set('showRamps', String(rampsChecked));

  // New optional station filter params
  params.set('onlyLowRisk', String(lowRiskChecked));
  params.set('onlyHasNearbyAPS', String(nearbyApsChecked));
  if (lowRiskChecked) {
    params.set('maxRiskScore', String(DEFAULT_MAX_RISK_SCORE));
  }

  // Include search term if present
  if (currentSearch) {
    params.set('q', currentSearch);
  }

  try {
    const response = await fetch('/explore/api?' + params.toString(), {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      const msg =
        (await readErrorPayload(response)) || `Failed to load data (HTTP ${response.status})`;
      displayError(msg);
      if (statusL) statusL.textContent = 'Error loading data';
      return;
    }

    const geoJSON = await response.json();

    if (!geoJSON || !Array.isArray(geoJSON.features)) {
      displayError('Invalid data format');
      if (statusL) statusL.textContent = 'Error loading data';
      return;
    }

    if (geoJSON.features.length === 0) {
      const anyFilter = showStationsEffective || apsChecked || rampsChecked || elevatorsChecked;

      if (markersLayer) markersLayer.clearLayers();
      if (list) list.innerHTML = '';

      if (anyFilter) {
        displayError(
          currentSearch
            ? `No locations found for "${currentSearch}" with the selected filters.`
            : 'No locations found for selected filters.'
        );
        if (statusL) statusL.textContent = 'No locations to display';
      } else {
        clearError();
        if (statusL) statusL.textContent = 'No filters selected';
      }
      return;
    }

    clearError();

    if (markersLayer) {
      markersLayer.clearLayers();
      markersLayer.addData(geoJSON);
    }

    try {
      const bounds = markersLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 18 });
    } catch (e) {
      console.warn('Warning: Could not fit within map bounds:', e);
    }

    updateListView(geoJSON);

    if (statusL) statusL.textContent = geoJSON.features.length + ' locations shown.';
  } catch (e) {
    displayError(e?.message || String(e));
    if (statusL) statusL.textContent = 'Error loading data.';
  }
}

// -------------------- List View --------------------

function updateListView(geoJSON) {
  if (!list) {
    displayError('List could not be found');
    return;
  }

  const showStations = Boolean(filterStations?.checked);
  const showAccessibleOnly = Boolean(filterAccessible?.checked);
  const showAPSNow = Boolean(filterAPS?.checked);
  const showRampsNow = Boolean(filterRamps?.checked);
  const showElevatorsNow = Boolean(filterElevators?.checked);

  const lowRiskChecked = Boolean(filterLowRisk?.checked);
  const nearbyApsChecked = Boolean(filterHasNearbyAPS?.checked);

  const showStationsEffective =
    showStations || showAccessibleOnly || lowRiskChecked || nearbyApsChecked;

  const anyFilter = showStationsEffective || showAPSNow || showRampsNow || showElevatorsNow;

  if (!anyFilter) {
    list.innerHTML = '';
    list.style.display = 'none';
    return;
  } else {
    list.style.display = '';
  }

  list.innerHTML = '';

  for (let i = 0; i < geoJSON.features.length; i++) {
    const f = geoJSON.features[i];
    const p = f.properties;

    const li = document.createElement('li');

    if (!p) {
      li.textContent = 'Unknown Feature';
      li.tabIndex = 0;
      list.appendChild(li);
      continue;
    }

    if (p.kind === 'station') {
      if (!showStationsEffective) continue;

      const stationName = p.name || 'Unknown Station';
      const stationId = String(p.stationId || '').trim();

      let routesText = '';
      if (Array.isArray(p.routes)) routesText = p.routes.join(', ');
      else if (typeof p.routes === 'string') routesText = p.routes;

      if (stationId) {
        const a = document.createElement('a');
        a.href = '/station/' + encodeURIComponent(stationId);
        a.textContent = stationName;
        li.appendChild(a);
        li.tabIndex = -1;
      } else {
        li.appendChild(document.createTextNode(stationName));
        li.tabIndex = 0;
      }

      const accessibleText = p.adaStatus || 'Unknown';
      const hasNearbyApsText = p.hasNearbyAPS ? 'Yes' : 'No';

      li.appendChild(
        document.createTextNode(
          ` | Routes: ${routesText || 'None'} | Accessible: ${accessibleText} | APS nearby: ${hasNearbyApsText}`
        )
      );

      list.appendChild(li);
      continue;
    }

    if (p.kind === 'elevator') {
      if (!showElevatorsNow) continue;

      const availability =
        p.availabilityPct == null ? 'Unknown' : String(p.availabilityPct) + '%';
      const risk = p.riskScore == null ? 'Unknown' : String(p.riskScore);

      li.textContent =
        'Elevator ' +
        (p.elevatorId || 'Not Available') +
        ' | Borough: ' +
        (p.borough || 'Not Available') +
        ' | Status: ' +
        (p.status || 'Not Available') +
        ' | Availability: ' +
        availability +
        ' | Risk: ' +
        risk;

      li.tabIndex = 0;
      list.appendChild(li);
      continue;
    }

    if (p.kind === 'aps') {
      if (!showAPSNow) continue;

      const apsId = String(p.apsId || '').trim();
      const label = 'APS at ' + (p.intersection || 'Not available');

      if (apsId) {
        const a = document.createElement('a');
        a.href = '/crossing/' + encodeURIComponent(apsId);
        a.textContent = label;
        li.appendChild(a);
        li.tabIndex = -1;
      } else {
        li.textContent = label;
        li.tabIndex = 0;
      }

      list.appendChild(li);
      continue;
    }

    if (p.kind === 'ramp') {
      if (!showRampsNow) continue;

      const rampId = String(p.rampId || '').trim();
      const label =
        'Curb ramp at: ' +
        (p.streetName || 'Unknown street') +
        ' | ' +
        (p.borough || 'Unknown');

      if (rampId) {
        const a = document.createElement('a');
        a.href = '/crossing/' + encodeURIComponent(rampId);
        a.textContent = label;
        li.appendChild(a);
        li.tabIndex = -1;
      } else {
        li.textContent = label;
        li.tabIndex = 0;
      }

      list.appendChild(li);
      continue;
    }

    li.textContent = 'Unknown Feature';
    li.tabIndex = 0;
    list.appendChild(li);
  }
}

// -------------------- Leaflet Init + Popups --------------------

if (mapDiv) {
  map = L.map('map').setView([40.7128, -74.006], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  markersLayer = L.geoJSON(null, {
    onEachFeature: function (feature, layer) {
      const p = feature.properties || {};
      let popupText = '';

      if (p.kind === 'station') {
        let routesText = '';
        if (Array.isArray(p.routes)) routesText = p.routes.join(', ');
        else if (typeof p.routes === 'string') routesText = p.routes;

        const name = p.name || 'Unknown Station';
        const stationId = p.stationId ? String(p.stationId) : '';

        popupText =
          escapeHtml(name) +
          '<br>' +
          'Station ID: ' +
          escapeHtml(stationId || 'Not Available') +
          '<br>' +
          'Accessible: ' +
          escapeHtml(p.adaStatus || 'Unknown') +
          '<br>' +
          'Routes: ' +
          escapeHtml(routesText || 'None') +
          '<br>' +
          'APS nearby: ' +
          escapeHtml(p.hasNearbyAPS ? 'Yes' : 'No') +
          '<br>';

        if (stationId) {
          popupText += buildDetailsLinkHtml(
            '/station/' + encodeURIComponent(stationId),
            'View station details'
          );
          popupText += buildFollowButtonHtml(stationId, name);
          popupText += buildReportButtonHtml('station', stationId, name);
        }
      } else if (p.kind === 'elevator') {
        const elevatorId = p.elevatorId ? String(p.elevatorId) : '';
        const label = elevatorId ? `Elevator ${elevatorId}` : 'Elevator';

        const availability =
          p.availabilityPct == null ? 'Unknown' : String(p.availabilityPct) + '%';
        const risk = p.riskScore == null ? 'Unknown' : String(p.riskScore);

        popupText =
          'Elevator ' +
          escapeHtml(elevatorId || 'Not Available') +
          '<br>' +
          'Equipment ID: ' +
          escapeHtml(p.equipmentId || 'None') +
          '<br>' +
          'Borough: ' +
          escapeHtml(p.borough || 'Not available') +
          '<br>' +
          'Status: ' +
          escapeHtml(p.status || 'None') +
          '<br>' +
          'Availability: ' +
          escapeHtml(availability) +
          '<br>' +
          'Risk score: ' +
          escapeHtml(risk) +
          '<br>' +
          'Last Updated: ' +
          escapeHtml(p.lastUpdated || 'None') +
          '<br>';

        if (elevatorId) popupText += buildReportButtonHtml('elevator', elevatorId, label);
      } else if (p.kind === 'aps') {
        const apsId = p.apsId ? String(p.apsId) : '';
        const intersection = p.intersection || 'Not available';
        const label = `APS at ${intersection}`;

        popupText =
          'Accessible Pedestrian Signal (APS)<br>' +
          'Intersection: ' +
          escapeHtml(intersection) +
          '<br>' +
          'Borough: ' +
          escapeHtml(p.borough || 'Not available') +
          '<br>';

        if (apsId) {
          popupText += buildDetailsLinkHtml(
            '/crossing/' + encodeURIComponent(apsId),
            'View crossing details'
          );
          popupText += buildReportButtonHtml('aps', apsId, label);
        }
      } else if (p.kind === 'ramp') {
        const rampId = p.rampId ? String(p.rampId) : '';
        const street = p.streetName || 'Unknown street';
        const label = `Curb ramp at ${street}`;

        popupText =
          'Curb Ramp<br>' +
          'Street: ' +
          escapeHtml(street) +
          '<br>' +
          'Borough: ' +
          escapeHtml(p.borough || 'Not available') +
          '<br>';

        if (rampId) {
          popupText += buildDetailsLinkHtml(
            '/crossing/' + encodeURIComponent(rampId),
            'View crossing details'
          );
          popupText += buildReportButtonHtml('ramp', rampId, label);
        }
      } else {
        popupText = 'Unknown Feature';
      }

      layer.bindPopup(popupText);
    }
  }).addTo(map);

  map.on('popupopen', (e) => {
    const el = e.popup?.getElement?.();
    if (!el) return;

    const btn = el.querySelector('.js-follow-toggle');
    if (!btn) return;

    const stationId = (btn.dataset.stationId || '').trim();
    if (!stationId) return;

    const followed = bookmarkedStations.has(stationId);
    applyFollowButtonUI(btn, followed);
  });

  // Filter listeners
  if (filterStations) filterStations.addEventListener('change', refreshMap);
  if (filterAccessible) filterAccessible.addEventListener('change', refreshMap);
  if (filterElevators) filterElevators.addEventListener('change', refreshMap);
  if (filterAPS) filterAPS.addEventListener('change', refreshMap);
  if (filterRamps) filterRamps.addEventListener('change', refreshMap);

  if (filterLowRisk) filterLowRisk.addEventListener('change', refreshMap);
  if (filterHasNearbyAPS) filterHasNearbyAPS.addEventListener('change', refreshMap);

  // Sidebar search listeners
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();

      currentSearch = normalizeSearchTerm(searchInput?.value || '');
      if (searchInput) searchInput.value = currentSearch;

      setUrlQueryParam(currentSearch);

      if (currentSearch) {
        ensureDefaultLayersForSearch();
      }

      refreshMap();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      currentSearch = '';
      if (searchInput) searchInput.value = '';
      setUrlQueryParam('');
      refreshMap();
      searchInput?.focus?.();
    });
  }

  // Initialize search state from URL before first load
  initSearchFromUrl();

  refreshMap();
} else {
  displayError('Map information not found.');
}

// -------------------- Click Handlers (CAPTURE) --------------------

document.addEventListener(
  'click',
  (e) => {
    const btn = e.target.closest('.js-report-open');
    if (!btn) return;

    e.preventDefault();

    openReportPanel(
      btn.dataset.targetType || '',
      btn.dataset.targetId || '',
      btn.dataset.targetLabel || 'Location'
    );
  },
  true
);

document.addEventListener(
  'click',
  async (e) => {
    const btn = e.target.closest('.js-follow-toggle');
    if (!btn) return;

    e.preventDefault();

    if (!isLoggedIn()) {
      displayError('Please log in to follow stations.');
      return;
    }

    const stationId = (btn.dataset.stationId || '').trim();
    const currentlyFollowed = btn.dataset.followed === 'true';
    if (!stationId) return;

    btn.disabled = true;

    try {
      const data = await postFollowToggle(stationId, !currentlyFollowed);

      const newFollowed = typeof data.followed === 'boolean' ? data.followed : !currentlyFollowed;

      if (Array.isArray(data.bookmarks)) {
        bookmarkedStations = new Set(data.bookmarks.map((x) => String(x).trim()).filter(Boolean));
      } else {
        if (newFollowed) bookmarkedStations.add(stationId);
        else bookmarkedStations.delete(stationId);
      }

      applyFollowButtonUI(btn, newFollowed);

      clearError();
    } catch (err) {
      displayError(err?.message || String(err));
    } finally {
      btn.disabled = false;
    }
  },
  true
);

// -------------------- Report Submit --------------------

if (reportCancel) {
  reportCancel.addEventListener('click', closeReportPanel);
}

if (reportForm) {
  reportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setReportStatus('');

    const payload = {
      targetType: reportTargetType?.value || '',
      targetId: reportTargetId?.value || '',
      text: reportText?.value?.trim() || ''
    };

    if (!payload.targetType || !payload.targetId) {
      setReportStatus('Missing target information. Please reopen the report form from a map marker.');
      return;
    }

    if (!payload.text) {
      setReportStatus('Please enter a description.');
      return;
    }

    if (!csrfToken) {
      setReportStatus('Missing CSRF token on page (check main.handlebars meta tag).');
      return;
    }

    try {
      const resp = await fetch('/api/reports', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const msg = (await readErrorPayload(resp)) || `Submit failed (HTTP ${resp.status})`;
        setReportStatus(msg);
        return;
      }

      const data = await resp.json().catch(() => ({}));
      setReportStatus(`Submitted successfully. Report ID: ${data.report?.reportId || 'OK'}`);

      if (reportText) reportText.value = '';
    } catch (err) {
      setReportStatus(err?.message || String(err));
    }
  });
}

// -------------------- Welcome Poster Modal --------------------

(function initWelcomeModal() {
  if (!welcomeModal) return;

  function open() {
    welcomeModal.hidden = false;
    document.body.style.overflow = 'hidden';
    (welcomeCloseBtn || welcomeCloseXBtn)?.focus?.();
  }

  function close() {
    welcomeModal.hidden = true;
    document.body.style.overflow = '';
  }

  open();

  welcomeCloseBtn?.addEventListener('click', close);
  welcomeCloseXBtn?.addEventListener('click', close);

  welcomeModal.addEventListener('click', (e) => {
    if (e.target === welcomeModal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (!welcomeModal.hidden && e.key === 'Escape') close();
  });
})();
