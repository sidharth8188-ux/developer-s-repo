const API_BASE = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------
const map = L.map('map', { zoomControl: true }).setView([30.3165, 78.0322], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 18
}).addTo(map);

let riskMarker = L.circleMarker([30.3165, 78.0322], {
  radius: 14, color: '#4f9d6e', fillColor: '#4f9d6e', fillOpacity: 0.5, weight: 2
}).addTo(map).bindPopup("Run an assessment to see risk here");

const reportMarkers = [];

// ---------------------------------------------------------------------
// Location picker
// ---------------------------------------------------------------------
const locationPicker = document.getElementById('locationPicker');
let customLocation = null; // set when user uses "current location" instead of the dropdown

function currentLatLng() {
  if (customLocation) return customLocation;
  const opt = locationPicker.selectedOptions[0];
  return { lat: parseFloat(opt.dataset.lat), lng: parseFloat(opt.dataset.lng), name: opt.textContent };
}
locationPicker.addEventListener('change', () => {
  customLocation = null; // dropdown chosen again — drop the custom pin
  document.getElementById('locationNameEditWrap').style.display = 'none';
  locationStatus.textContent = '';
  const { lat, lng } = currentLatLng();
  map.setView([lat, lng], 12);
  riskMarker.setLatLng([lat, lng]);
});

// ---------------------------------------------------------------------
// "Use my location" — browser Geolocation API
// ---------------------------------------------------------------------
const useLocationBtn = document.getElementById('useLocationBtn');
const locationStatus = document.getElementById('locationStatus');

function detectMyLocation(isAutomatic = false) {
  if (!navigator.geolocation) {
    if (!isAutomatic) locationStatus.textContent = 'Geolocation is not supported by this browser.';
    return;
  }

  locationStatus.textContent = isAutomatic ? 'Checking your location…' : 'Detecting your location…';
  useLocationBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      // Reverse-geocode to get a human-readable name (OpenStreetMap Nominatim — free, no key needed)
      // zoom=18 asks Nominatim for building/POI-level detail instead of just the town
      let placeName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        const data = await res.json();
        const addr = data.address || {};

        // Most specific first: named building/POI, then locality, then fall back to town/city.
        // data.display_name's first segment is usually the most specific labeled feature
        // (e.g. a university/building name) — prefer that over generic town/city fields.
        const specificFromDisplayName = data.display_name?.split(',')[0]?.trim();
        const isGenericMatch = specificFromDisplayName &&
          (specificFromDisplayName === addr.town || specificFromDisplayName === addr.city || specificFromDisplayName === addr.county);

        placeName =
          (specificFromDisplayName && !isGenericMatch && specificFromDisplayName) ||
          addr.college || addr.university ||
          addr.building || addr.amenity ||
          addr.suburb || addr.neighbourhood || addr.village || addr.hamlet ||
          addr.road ||
          addr.town || addr.city || addr.county ||
          placeName;
      } catch (e) {
        console.warn('Reverse geocoding failed, using coordinates instead.', e);
      }

      customLocation = { lat, lng, name: placeName };

      map.setView([lat, lng], 13);
      riskMarker.setLatLng([lat, lng]);
      riskMarker.setPopupContent(`Your location: ${placeName}`);
      riskMarker.openPopup();

      locationStatus.textContent = `Using your location: ${placeName}`;
      useLocationBtn.disabled = false;

      // Show an editable field pre-filled with the detected name — OpenStreetMap's
      // data can be imprecise for smaller localities, so we let the user correct it
      const editWrap = document.getElementById('locationNameEditWrap');
      const editInput = document.getElementById('locationNameEdit');
      editWrap.style.display = 'block';
      editInput.value = placeName;
      editInput.oninput = () => {
        if (customLocation) {
          customLocation.name = editInput.value.trim() || placeName;
          riskMarker.setPopupContent(`Your location: ${customLocation.name}`);
        }
      };
    },
    (error) => {
      const messages = {
        1: isAutomatic
          ? 'Location permission not granted — use the dropdown or search box below.'
          : 'Location permission denied. Please allow location access, or pick from the dropdown.',
        2: 'Location unavailable right now. Please pick from the dropdown or search manually.',
        3: 'Location request timed out. Please try again or pick from the dropdown.',
      };
      locationStatus.textContent = messages[error.code] || 'Could not get your location.';
      useLocationBtn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

useLocationBtn.addEventListener('click', () => detectMyLocation(false));

// Ask for location automatically as soon as the page loads — this way the
// dashboard opens already centered on the user's area, before they do anything
window.addEventListener('load', () => detectMyLocation(true));

// ---------------------------------------------------------------------
// Manual location search — type any place name, pick from results
// ---------------------------------------------------------------------
const manualSearchInput = document.getElementById('manualLocationSearch');
const manualSearchBtn = document.getElementById('manualSearchBtn');
const manualSearchResults = document.getElementById('manualSearchResults');

async function searchLocation() {
  const query = manualSearchInput.value.trim();
  if (!query) return;

  manualSearchResults.style.display = 'block';
  manualSearchResults.innerHTML = '<div style="padding:10px 12px;color:var(--text-muted);font-size:13px;">Searching…</div>';

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`);
    const results = await res.json();

    if (!results.length) {
      manualSearchResults.innerHTML = '<div style="padding:10px 12px;color:var(--text-muted);font-size:13px;">No matches found — try a different spelling.</div>';
      return;
    }

    manualSearchResults.innerHTML = results.map((r, i) => `
      <div class="manual-result-item" data-idx="${i}"
        style="padding:10px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--line);">
        ${r.display_name}
      </div>
    `).join('');

    manualSearchResults.querySelectorAll('.manual-result-item').forEach((el) => {
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--bg-panel)'; });
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
      el.addEventListener('click', () => {
        const r = results[parseInt(el.dataset.idx, 10)];
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lon);
        const name = r.display_name.split(',')[0].trim();

        customLocation = { lat, lng, name };
        map.setView([lat, lng], 13);
        riskMarker.setLatLng([lat, lng]);
        riskMarker.setPopupContent(`${name}`);
        riskMarker.openPopup();

        locationStatus.textContent = `Using: ${name}`;
        document.getElementById('locationNameEditWrap').style.display = 'block';
        document.getElementById('locationNameEdit').value = name;

        manualSearchResults.style.display = 'none';
        manualSearchInput.value = name;
      });
    });
  } catch (e) {
    manualSearchResults.innerHTML = '<div style="padding:10px 12px;color:var(--risk-critical);font-size:13px;">Search failed — check your internet connection.</div>';
    console.error(e);
  }
}

manualSearchBtn.addEventListener('click', searchLocation);
manualSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchLocation();
});
document.addEventListener('click', (e) => {
  if (!manualSearchResults.contains(e.target) && e.target !== manualSearchInput) {
    manualSearchResults.style.display = 'none';
  }
});

// ---------------------------------------------------------------------
// Risk colors
// ---------------------------------------------------------------------
const RISK_COLORS = {
  LOW: '#4f9d6e',
  MODERATE: '#d9a441',
  HIGH: '#dd7c3f',
  CRITICAL: '#c94a3e'
};

function setGauge(pct) {
  const circumference = 2 * Math.PI * 80; // r=80
  const dash = (pct / 100) * circumference;
  document.getElementById('gaugeArc').style.strokeDasharray = `${dash} ${circumference}`;
  document.getElementById('gaugePct').textContent = `${pct.toFixed(0)}%`;
}

// ---------------------------------------------------------------------
// Run assessment
// ---------------------------------------------------------------------
document.getElementById('runBtn').addEventListener('click', async () => {
  const { lat, lng, name } = currentLatLng();
  const payload = {
    latitude: lat,
    longitude: lng,
    rainfall_1h: parseFloat(document.getElementById('rainfall_1h').value),
    rainfall_3h: parseFloat(document.getElementById('rainfall_3h').value),
    rainfall_24h: parseFloat(document.getElementById('rainfall_24h').value),
    humidity: parseFloat(document.getElementById('humidity').value),
    elevation: parseFloat(document.getElementById('elevation').value),
    slope: parseFloat(document.getElementById('slope').value),
    soil_moisture: parseFloat(document.getElementById('soil_moisture').value),
    river_distance: parseFloat(document.getElementById('river_distance').value),
    location_name: name
  };

  const btn = document.getElementById('runBtn');
  btn.textContent = "Running…";
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();

    const pct = data.flood_probability * 100;
    const color = RISK_COLORS[data.risk_level] || '#4f9d6e';
    document.documentElement.style.setProperty('--risk-current', color);
    setGauge(pct);
    document.getElementById('riskBadge').textContent = data.risk_level + ' RISK';
    document.getElementById('warningMsg').textContent = data.warning_message;
    lastRiskLevel = data.risk_level;
    loadPersonalizedAlerts(data.risk_level);
    updateSafePlaces(data.risk_level, lat, lng);

    riskMarker.setStyle({ color, fillColor: color });
    riskMarker.setPopupContent(`${name}: ${data.risk_level} (${pct.toFixed(0)}%)`);
    riskMarker.openPopup();

    const factorsHtml = data.top_contributing_factors.map(f => `
      <div class="factor-row" style="display:block;">
        <div style="display:flex;justify-content:space-between;">
          <span class="factor-name">${f.factor.replace(/_/g, ' ')}</span>
          <span class="factor-value">${f.value} · ${f.importance_pct}% weight</span>
        </div>
        <div class="factor-bar-bg"><div class="factor-bar-fill" style="width:${f.importance_pct * 3}%; background:${color};"></div></div>
      </div>
    `).join('');
    document.getElementById('factorsList').innerHTML = factorsHtml;

  } catch (err) {
    document.getElementById('warningMsg').textContent =
      "Backend se connect nahi ho paya. Check karo ki uvicorn server chal raha hai (uvicorn main:app --reload).";
    console.error(err);
  } finally {
    btn.textContent = "Run flood risk assessment";
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------
// Safe places — evacuation guidance for HIGH/CRITICAL risk
// ---------------------------------------------------------------------
let safePlaceMarkers = [];
let safeRouteLine = null;

async function updateSafePlaces(riskLevel, lat, lng) {
  const section = document.getElementById('safePlacesSection');
  const list = document.getElementById('safePlacesList');

  // Clear previous markers/line regardless of outcome
  safePlaceMarkers.forEach(m => map.removeLayer(m));
  safePlaceMarkers = [];
  if (safeRouteLine) { map.removeLayer(safeRouteLine); safeRouteLine = null; }

  // Only show evacuation guidance when risk is actually elevated
  if (riskLevel !== 'HIGH' && riskLevel !== 'CRITICAL') {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = '<p class="empty-state">Finding nearest safe places…</p>';

  try {
    const res = await fetch(`${API_BASE}/safe-places?latitude=${lat}&longitude=${lng}&limit=3`);
    const data = await res.json();

    if (!data.safe_places.length) {
      list.innerHTML = '<p class="empty-state">No safe-place data available for this area yet.</p>';
      return;
    }

    const typeIcons = { 'Relief shelter': '🏠', 'High ground': '⛰️', 'Hospital': '🏥' };
    list.innerHTML = data.safe_places.map(p => `
      <div class="safe-place-item">
        <div>
          <div class="spname">${typeIcons[p.type] || '📍'} ${p.name}</div>
          <div class="sptype">${p.type}</div>
        </div>
        <div class="spdist">${p.distance_km} km</div>
      </div>
    `).join('');

    // Plot markers for each safe place
    data.safe_places.forEach(p => {
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: 8, color: '#4f9d6e', fillColor: '#4f9d6e', fillOpacity: 0.7, weight: 2
      }).addTo(map).bindPopup(`<b>${p.name}</b><br>${p.type} — ${p.distance_km} km away`);
      safePlaceMarkers.push(marker);
    });

    // Draw a straight-line path to the nearest one (as-the-crow-flies —
    // real road-routing would need a routing engine, noted as a future upgrade)
    const nearest = data.safe_places[0];
    safeRouteLine = L.polyline(
      [[lat, lng], [nearest.latitude, nearest.longitude]],
      { color: '#4f9d6e', weight: 3, dashArray: '6, 8' }
    ).addTo(map);

  } catch (err) {
    list.innerHTML = '<p class="empty-state">Could not load safe places. Check backend connection.</p>';
    console.error(err);
  }
}

// ---------------------------------------------------------------------
// Community reports
// ---------------------------------------------------------------------
async function loadReports() {
  try {
    const res = await fetch(`${API_BASE}/reports`);
    const data = await res.json();
    const list = document.getElementById('reportList');

    reportMarkers.forEach(m => map.removeLayer(m));
    reportMarkers.length = 0;

    if (!data.reports.length) {
      list.innerHTML = '<p class="empty-state">No reports yet for this session.</p>';
      return;
    }
    list.innerHTML = data.reports.slice().reverse().map(r => `
      <div class="report-item">
        <div class="rloc">${r.location_name}</div>
        <div>${r.water_level_description}</div>
        <div class="rtime">${r.reported_by} · ${new Date(r.timestamp).toLocaleTimeString()}</div>
      </div>
    `).join('');

    data.reports.forEach(r => {
      const m = L.marker([r.latitude, r.longitude])
        .addTo(map)
        .bindPopup(`<b>${r.location_name}</b><br>${r.water_level_description}`);
      reportMarkers.push(m);
    });
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('reportBtn').addEventListener('click', async () => {
  const { lat, lng } = currentLatLng();
  const locationName = document.getElementById('reportLocation').value.trim();
  if (!locationName) { alert('Location bharo pehle'); return; }

  const payload = {
    latitude: lat + (Math.random() - 0.5) * 0.01,
    longitude: lng + (Math.random() - 0.5) * 0.01,
    location_name: locationName,
    water_level_description: document.getElementById('reportSeverity').value,
    reported_by: document.getElementById('reportName').value.trim() || 'Anonymous'
  };

  await fetch(`${API_BASE}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  document.getElementById('reportLocation').value = '';
  document.getElementById('reportName').value = '';
  loadReports();
});

// ---------------------------------------------------------------------
// Visual water-level analysis
// ---------------------------------------------------------------------
document.getElementById('analyzeImgBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('imageInput');
  const resultBox = document.getElementById('imageResult');
  if (!fileInput.files.length) {
    resultBox.innerHTML = '<p class="empty-state">Pehle ek photo select karo.</p>';
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  resultBox.innerHTML = '<p class="empty-state">Analyzing image…</p>';

  try {
    const res = await fetch(`${API_BASE}/analyze-image`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Analysis failed');
    const data = await res.json();

    const severityColors = {
      MINIMAL: '#4f9d6e', MODERATE: '#d9a441', SIGNIFICANT: '#dd7c3f', SEVERE: '#c94a3e'
    };
    const color = severityColors[data.severity] || '#4f8bab';

    resultBox.innerHTML = `
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:32px;font-weight:600;color:${color};">
          ${data.water_coverage_pct}%
        </div>
        <div>
          <div style="font-family:'Archivo',sans-serif;font-weight:700;color:${color};">${data.severity} water coverage</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${data.note}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Method: ${data.method}</div>
        </div>
      </div>
    `;
  } catch (err) {
    resultBox.innerHTML = '<p class="empty-state">Analysis fail ho gaya. Backend check karo.</p>';
    console.error(err);
  }
});

// ---------------------------------------------------------------------
// Profile registration + personalized alerts
// ---------------------------------------------------------------------
let lastRiskLevel = null; // last /predict call ka risk level yaad rakhta hai

document.getElementById('registerBtn').addEventListener('click', async () => {
  const { lat, lng } = currentLatLng();
  const name = document.getElementById('profName').value.trim();
  if (!name) { alert('Naam bharo pehle'); return; }

  const payload = {
    name,
    location_name: currentLatLng().name,
    latitude: lat,
    longitude: lng,
    house_type: document.getElementById('profHouseType').value,
    floor: document.getElementById('profFloor').value,
    has_vulnerable_members: document.getElementById('profVulnerable').checked
  };

  await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  document.getElementById('personalizedAlerts').innerHTML =
    `<p style="font-size:13px;color:var(--risk-low);">Profile registered! Ab risk assessment run karo — tumhe apna personalized action-advice dikhega neeche.</p>`;

  if (lastRiskLevel) loadPersonalizedAlerts(lastRiskLevel);
});

async function loadPersonalizedAlerts(riskLevel) {
  try {
    const res = await fetch(`${API_BASE}/personalized-alerts?risk_level=${riskLevel}`);
    const data = await res.json();
    const box = document.getElementById('personalizedAlerts');
    if (!data.alerts.length) {
      box.innerHTML = '<p class="empty-state">Koi registered profile nahi hai abhi.</p>';
      return;
    }
    box.innerHTML = data.alerts.map(a => `
      <div class="report-item" style="border-left-color:var(--risk-current);margin-bottom:8px;">
        <div class="rloc">${a.name} — ${a.house_type}, ${a.floor} floor</div>
        <div style="margin-top:4px;">${a.personalized_action}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------------
// Backend connection check
// ---------------------------------------------------------------------
async function checkConnection() {
  try {
    const res = await fetch(`${API_BASE}/`);
    const data = await res.json();
    document.getElementById('connDot').classList.remove('off');
    document.getElementById('connText').textContent = 'Backend connected';
    document.getElementById('modelName').textContent = data.model || '—';
  } catch (err) {
    document.getElementById('connDot').classList.add('off');
    document.getElementById('connText').textContent = 'Backend not reachable';
  }
}

checkConnection();
loadReports();
