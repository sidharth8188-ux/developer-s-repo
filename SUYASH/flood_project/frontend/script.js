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
function currentLatLng() {
  const opt = locationPicker.selectedOptions[0];
  return { lat: parseFloat(opt.dataset.lat), lng: parseFloat(opt.dataset.lng), name: opt.textContent };
}
locationPicker.addEventListener('change', () => {
  const { lat, lng } = currentLatLng();
  map.setView([lat, lng], 12);
  riskMarker.setLatLng([lat, lng]);
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
