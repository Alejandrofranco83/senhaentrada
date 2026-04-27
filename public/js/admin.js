const socket = io();

// ─── INIT ────────────────────────────────────────────
async function init() {
  const config = await fetch('/config/default.json').then(r => r.json());
  document.getElementById('branchName').textContent = config.branch.name;

  loadStats();
  loadCounters();
  loadServices();
  loadOperators();
  loadQueue();
}

// ─── NAVIGATION ──────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.admin-nav .tab').forEach(t => t.classList.remove('active'));

  document.getElementById(`section-${name}`).classList.add('active');
  event.target.classList.add('active');

  // Refresh data
  if (name === 'stats') loadStats();
  if (name === 'counters') loadCounters();
  if (name === 'services') loadServices();
  if (name === 'operators') loadOperators();
  if (name === 'queue') loadQueue();
  if (name === 'ads') loadAds();
  if (name === 'announcements') loadAnnouncements();
  if (name === 'voices') loadVoiceConfig();
  if (name === 'reports') loadReports();
}

// ─── STATS ───────────────────────────────────────────
async function loadStats() {
  const [stats, summary] = await Promise.all([
    fetch('/api/stats/today').then(r => r.json()),
    fetch('/api/stats/summary').then(r => r.json())
  ]);

  document.getElementById('statCards').innerHTML = `
    <div class="stat-card">
      <div class="value">${stats.total.total}</div>
      <div class="label">Turnos Hoy / Senhas Hoje</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--success)">${stats.total.completed}</div>
      <div class="label">Atendidos / Atendidos</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--warning)">${stats.total.waiting}</div>
      <div class="label">En Espera / Em Espera</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--info)">${summary.avgWaitTime} min</div>
      <div class="label">Espera Promedio / Espera Média</div>
    </div>
  `;

  document.getElementById('statsTable').innerHTML = stats.byService.map(s => `
    <tr>
      <td><span style="color:${s.color}">${s.prefix}</span> ${s.name}</td>
      <td>${s.completed || 0}</td>
      <td>${s.waiting || 0}</td>
      <td>${s.no_show || 0}</td>
      <td>${s.avg_wait ? Math.round(s.avg_wait) + ' min' : '-'}</td>
    </tr>
  `).join('');

  checkStaleTickets();
}

async function checkStaleTickets() {
  try {
    const tickets = await fetch('/api/tickets/active').then(r => r.json());
    const today = new Date().toISOString().slice(0, 10);
    const stale = tickets.filter(t => t.created_at && t.created_at.slice(0, 10) < today);
    const banner = document.getElementById('staleTicketsBanner');
    if (stale.length > 0) {
      document.getElementById('staleTicketsMsg').textContent =
        `Hay ${stale.length} turno(s) de dias anteriores sin cerrar.`;
      banner.style.display = 'flex';
      banner.style.alignItems = 'center';
    } else {
      banner.style.display = 'none';
    }
  } catch (e) {}
}

async function runCleanup() {
  try {
    const r = await fetch('/api/cleanup/run', { method: 'POST' }).then(r => r.json());
    alert(`Limpieza completa: ${r.cancelled} cancelados, ${r.noShow} marcados no-show.`);
    loadStats();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ─── COUNTERS ────────────────────────────────────────
let allServices = []; // cache for editing

async function loadCounters() {
  const [counters, services] = await Promise.all([
    fetch('/api/counters').then(r => r.json()),
    fetch('/api/services').then(r => r.json())
  ]);
  allServices = services;

  document.getElementById('countersTable').innerHTML = counters.map(c => {
    const statusColors = {
      open: 'var(--success)', busy: 'var(--accent)',
      paused: 'var(--warning)', closed: 'var(--text-muted)'
    };
    const statusLabels = {
      open: 'Abierta', busy: 'Ocupada', paused: 'Pausada', closed: 'Cerrada'
    };
    const assignedIds = c.services.map(s => s.id);
    const serviceCheckboxes = services.filter(s => !s.is_specific).map(s => {
      const checked = assignedIds.includes(s.id) ? 'checked' : '';
      return `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;cursor:pointer;">
        <input type="checkbox" ${checked} onchange="toggleCounterService(${c.id}, ${s.id}, this.checked)"
               style="width:18px;height:18px;cursor:pointer;">
        <span style="color:${s.color};font-weight:600;">${s.prefix} ${s.name}</span>
      </label>`;
    }).join('');

    const closeBtn = c.status !== 'closed'
      ? `<button class="btn btn-danger" style="padding:4px 12px;font-size:0.8rem;" onclick="forceCloseCounter(${c.id})">Forzar Cierre</button>`
      : '<span style="color:var(--text-muted)">-</span>';

    return `
      <tr>
        <td>${c.number}</td>
        <td>${c.name}</td>
        <td><span style="color:${statusColors[c.status] || '#fff'}">${statusLabels[c.status] || c.status}</span></td>
        <td>${c.operator_name || '-'}</td>
        <td>${c.current_ticket_code || '-'}</td>
        <td>${serviceCheckboxes}</td>
        <td>${closeBtn}</td>
      </tr>
    `;
  }).join('');
}

async function forceCloseCounter(counterId) {
  await fetch(`/api/counters/${counterId}/close`, { method: 'POST' });
  loadCounters();
}

async function toggleCounterService(counterId, serviceId, enabled) {
  // Get current services for this counter
  const counters = await fetch('/api/counters').then(r => r.json());
  const counter = counters.find(c => c.id === counterId);
  if (!counter) return;

  let serviceIds = counter.services.map(s => s.id);

  if (enabled && !serviceIds.includes(serviceId)) {
    serviceIds.push(serviceId);
  } else if (!enabled) {
    serviceIds = serviceIds.filter(id => id !== serviceId);
  }

  await fetch(`/api/counters/${counterId}/services`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_ids: serviceIds })
  });
}

// ─── SERVICES ────────────────────────────────────────
let servicesCache = [];
let editingServiceId = null;

const ICON_OPTIONS = [
  '🏥', '💊', '💉', '🩺', '🩹', '🌡️', '⚕️', '🔬',
  '🧪', '🧴', '👤', '👨‍⚕️', '👩‍⚕️', '📱', '📞', '📦',
  '🛒', '🛍️', '💳', '💰', '🧾', '📋', '📝', '🆘',
  '⭐', '❤️', '✨', '🎯', '🔔', '📢', '🏷️', '🎁'
];

const COLOR_OPTIONS = [
  '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#d42027',
  '#00BCD4', '#FFC107', '#E91E63', '#3F51B5', '#009688',
  '#795548', '#607D8B', '#673AB7', '#8BC34A', '#FF5722'
];

async function loadServices() {
  const services = await fetch('/api/services?all=true').then(r => r.json());
  servicesCache = services;

  document.getElementById('servicesTable').innerHTML = services.map(s => {
    const toggleLabel = s.active ? 'Desactivar' : 'Activar';
    const toggleClass = s.active ? 'btn-warning' : 'btn-success';
    return `
    <tr style="${s.active ? '' : 'opacity:0.55;'}">
      <td><span style="background:${s.color};padding:2px 8px;border-radius:4px;">${s.prefix}</span></td>
      <td>${s.icon || ''} ${s.name}</td>
      <td>${s.name_pt || '-'}</td>
      <td>${s.priority}</td>
      <td><span style="background:${s.color};display:inline-block;width:20px;height:20px;border-radius:4px;"></span> ${s.color}</td>
      <td>${s.active ? '✅ Activo' : '❌ Inactivo'}</td>
      <td>
        <button class="btn btn-info" style="padding:4px 12px;font-size:0.8rem;" onclick="openServiceModal(${s.id})">Editar</button>
        <button class="btn ${toggleClass}" style="padding:4px 12px;font-size:0.8rem;" onclick="toggleServiceActive(${s.id})">${toggleLabel}</button>
      </td>
    </tr>
  `;}).join('');
}

function buildIconPicker(selected) {
  const picker = document.getElementById('svcIconPicker');
  picker.innerHTML = ICON_OPTIONS.map(icon =>
    `<div class="icon-option ${icon === selected ? 'selected' : ''}" data-icon="${icon}">${icon}</div>`
  ).join('');

  picker.querySelectorAll('.icon-option').forEach(el => {
    el.onclick = () => {
      picker.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
    };
  });
}

function buildColorPicker(selected) {
  const picker = document.getElementById('svcColorPicker');
  const custom = document.getElementById('svcColorCustom');

  // Remove existing swatches (keep the custom input)
  picker.querySelectorAll('.color-swatch').forEach(el => el.remove());

  COLOR_OPTIONS.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.background = color;
    swatch.dataset.color = color;
    if (color.toLowerCase() === (selected || '').toLowerCase()) swatch.classList.add('selected');
    swatch.onclick = () => {
      picker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      custom.value = color;
    };
    picker.insertBefore(swatch, custom);
  });

  custom.value = selected || '#2196F3';
  custom.oninput = () => {
    picker.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  };
}

function openServiceModal(id) {
  editingServiceId = id || null;
  const s = id ? servicesCache.find(x => x.id === id) : null;

  document.getElementById('serviceModalTitle').textContent = s ? 'Editar Servicio' : 'Agregar Servicio';
  document.getElementById('svcName').value        = s?.name        || '';
  document.getElementById('svcNamePt').value      = s?.name_pt     || '';
  document.getElementById('svcPrefix').value      = s?.prefix      || '';
  document.getElementById('svcPriority').value    = s?.priority    || 1;
  document.getElementById('svcDescription').value = s?.description || '';
  document.getElementById('svcActive').checked    = s ? !!s.active : true;

  buildIconPicker(s?.icon || '');
  buildColorPicker(s?.color || '#2196F3');

  document.getElementById('serviceModal').classList.add('active');
}

function closeServiceModal() {
  document.getElementById('serviceModal').classList.remove('active');
  editingServiceId = null;
}

function addService() {
  openServiceModal(null);
}

async function saveService() {
  const name        = document.getElementById('svcName').value.trim();
  const name_pt     = document.getElementById('svcNamePt').value.trim();
  const prefix      = document.getElementById('svcPrefix').value.trim().toUpperCase();
  const priority    = parseInt(document.getElementById('svcPriority').value);
  const active      = document.getElementById('svcActive').checked ? 1 : 0;
  const color       = document.getElementById('svcColorCustom').value;
  const description = document.getElementById('svcDescription').value.trim() || null;
  const selectedIconEl = document.querySelector('#svcIconPicker .icon-option.selected');
  const icon = selectedIconEl ? selectedIconEl.dataset.icon : '';

  if (!name) { alert('El nombre (ES) es obligatorio'); return; }
  if (!prefix) { alert('El prefijo es obligatorio'); return; }

  const existing = editingServiceId ? servicesCache.find(x => x.id === editingServiceId) : null;
  const payload = {
    name,
    name_pt,
    prefix,
    icon,
    color,
    priority,
    description,
    is_specific: existing ? existing.is_specific : 0,
    sort_order: existing ? existing.sort_order : 10,
    active
  };

  const url = editingServiceId ? `/api/services/${editingServiceId}` : '/api/services';
  const method = editingServiceId ? 'PUT' : 'POST';

  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  closeServiceModal();
  loadServices();
}

function toggleServiceActive(id) {
  const s = servicesCache.find(x => x.id === id);
  if (!s) return;

  const newActive = s.active ? 0 : 1;
  const action = newActive ? 'activar' : 'desactivar';
  if (!confirm(`¿Seguro que querés ${action} el servicio "${s.name}"?`)) return;

  fetch(`/api/services/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: s.name,
      name_pt: s.name_pt,
      prefix: s.prefix,
      icon: s.icon || '',
      color: s.color,
      priority: s.priority,
      description: s.description || null,
      is_specific: s.is_specific,
      sort_order: s.sort_order,
      active: newActive
    })
  }).then(() => loadServices());
}

// Cerrar modal al hacer click fuera
document.addEventListener('click', (e) => {
  if (e.target.id === 'serviceModal') closeServiceModal();
});

// ─── OPERATORS ───────────────────────────────────────
async function loadOperators() {
  const operators = await fetch('/api/operators').then(r => r.json());

  document.getElementById('operatorsTable').innerHTML = operators.map(o => {
    const photoHtml = o.photo
      ? `<img src="${o.photo}?t=${Date.now()}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">`
      : `<div style="width:40px;height:40px;border-radius:50%;background:var(--purple);display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:white;">${o.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>`;
    return `
    <tr>
      <td>${o.id}</td>
      <td style="display:flex;align-items:center;gap:0.75rem;">${photoHtml} ${o.name}</td>
      <td>${o.active ? '✅ Activo' : '❌ Inactivo'}</td>
      <td>
        <label class="btn btn-purple" style="padding:4px 12px;font-size:0.8rem;cursor:pointer;">
          📷 Foto
          <input type="file" accept="image/*" style="display:none;" onchange="uploadPhoto(${o.id}, this)">
        </label>
        <button class="btn btn-info" style="padding:4px 12px;font-size:0.8rem;" onclick="editOperator(${o.id}, '${o.name.replace(/'/g, "\\'")}')">Editar</button>
        <button class="btn btn-danger" style="padding:4px 12px;font-size:0.8rem;" onclick="deleteOperator(${o.id})">Eliminar</button>
      </td>
    </tr>
  `}).join('');
}

async function uploadPhoto(operatorId, input) {
  const file = input.files[0];
  if (!file) return;

  // Resize and convert to base64
  const reader = new FileReader();
  reader.onload = async (e) => {
    // Create a canvas to resize
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const size = 300; // 300x300 max
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Crop to square from center
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);

      const base64 = canvas.toDataURL('image/jpeg', 0.85);

      await fetch(`/api/operators/${operatorId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: base64 })
      });

      loadOperators();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function addOperator() {
  const name = prompt('Nombre del operador:');
  if (!name) return;

  fetch('/api/operators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(() => loadOperators());
}

function editOperator(id, currentName) {
  const name = prompt('Nuevo nombre:', currentName);
  if (!name) return;

  fetch(`/api/operators/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, active: 1 })
  }).then(() => loadOperators());
}

function deleteOperator(id) {
  if (!confirm('¿Eliminar operador?')) return;
  fetch(`/api/operators/${id}`, { method: 'DELETE' }).then(() => loadOperators());
}

// ─── QUEUE ───────────────────────────────────────────
async function loadQueue() {
  const [waiting, active] = await Promise.all([
    fetch('/api/tickets/waiting').then(r => r.json()),
    fetch('/api/tickets/active').then(r => r.json())
  ]);

  const all = [...active, ...waiting];

  document.getElementById('queueTable').innerHTML = all.map(t => {
    const statusLabels = {
      waiting: '⏳ Esperando', called: '📢 Llamado',
      serving: '🔧 Atendiendo', completed: '✅ Completado'
    };
    const time = t.created_at ? new Date(t.created_at.replace(' ', 'T')).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <tr>
        <td style="font-weight:700;color:${t.color || '#fff'}">${t.code}</td>
        <td>${t.service_name || ''} / ${t.service_name_pt || ''}</td>
        <td>${statusLabels[t.status] || t.status}</td>
        <td>${t.counter_name || '-'}</td>
        <td>${time}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Sin turnos / Sem senhas</td></tr>';
}

// ─── ADS ─────────────────────────────────────────────
let adsCache = [];
let editingAdId = null;

async function loadAds() {
  adsCache = await fetch('/api/ads?all=true').then(r => r.json());

  document.getElementById('adsTable').innerHTML = adsCache.length === 0
    ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Sin publicidades. Sube una imagen o video con el botón de arriba.</td></tr>'
    : adsCache.map(ad => {
      const preview = ad.type === 'video'
        ? `<video src="/img/ads/${ad.filename}" style="height:54px;border-radius:6px;background:#000;" muted></video>`
        : `<img src="/img/ads/${ad.filename}" style="height:54px;border-radius:6px;object-fit:cover;max-width:90px;" alt="${ad.title}">`;
      return `
        <tr style="${ad.active ? '' : 'opacity:0.5;'}">
          <td>${preview}</td>
          <td style="font-weight:600;">${ad.title}</td>
          <td>${ad.type === 'video' ? '🎬 Video' : '🖼️ Imagen'}</td>
          <td>${ad.type === 'video' ? '<i style="color:var(--text-muted)">auto</i>' : ad.duration + 's'}</td>
          <td>${ad.sort_order}</td>
          <td>${ad.active ? '✅ Activa' : '⏸️ Inactiva'}</td>
          <td>
            <button class="btn btn-info" style="padding:4px 12px;font-size:0.8rem;" onclick="openAdModal(${ad.id})">Editar</button>
            <button class="btn btn-danger" style="padding:4px 12px;font-size:0.8rem;" onclick="deleteAd(${ad.id})">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
}

async function uploadAdFile(input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('adUploadStatus');
  const textEl = document.getElementById('adUploadText');
  statusEl.style.display = 'block';
  textEl.textContent = `Subiendo "${file.name}"...`;

  const formData = new FormData();
  formData.append('media', file);

  try {
    const uploadRes = await fetch('/api/ads/upload', { method: 'POST', body: formData }).then(r => r.json());
    if (uploadRes.error) throw new Error(uploadRes.error);

    // Auto-create the ad record
    const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    const createRes = await fetch('/api/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        type: uploadRes.type,
        filename: uploadRes.filename,
        duration: 8,
        sort_order: adsCache.length
      })
    }).then(r => r.json());

    if (createRes.error) throw new Error(createRes.error);

    textEl.textContent = `✅ "${title}" subida correctamente.`;
    input.value = '';
    loadAds();
    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
  } catch (err) {
    textEl.textContent = `❌ Error: ${err.message}`;
    setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
  }
}

function openAdModal(id) {
  editingAdId = id;
  const ad = adsCache.find(a => a.id === id);
  if (!ad) return;

  document.getElementById('adModalTitle').textContent = `Editar: ${ad.title}`;
  document.getElementById('adTitle').value = ad.title;
  document.getElementById('adDuration').value = ad.duration || 8;
  document.getElementById('adOrder').value = ad.sort_order || 0;
  document.getElementById('adActive').checked = !!ad.active;

  document.getElementById('adModal').classList.add('active');
}

function closeAdModal() {
  document.getElementById('adModal').classList.remove('active');
  editingAdId = null;
}

async function saveAd() {
  const ad = adsCache.find(a => a.id === editingAdId);
  if (!ad) return;

  await fetch(`/api/ads/${editingAdId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: document.getElementById('adTitle').value.trim() || ad.title,
      duration: parseInt(document.getElementById('adDuration').value) || 8,
      sort_order: parseInt(document.getElementById('adOrder').value) || 0,
      active: document.getElementById('adActive').checked ? 1 : 0
    })
  });

  closeAdModal();
  loadAds();
}

async function deleteAd(id) {
  const ad = adsCache.find(a => a.id === id);
  if (!ad || !confirm(`¿Eliminar la publicidad "${ad.title}"? Esto también borra el archivo.`)) return;

  await fetch(`/api/ads/${id}`, { method: 'DELETE' });
  loadAds();
}

// Cerrar modal de ads al hacer click fuera
document.addEventListener('click', (e) => {
  if (e.target.id === 'adModal') closeAdModal();
  if (e.target.id === 'announcementModal') closeAnnouncementModal();
});

// ─── ANNOUNCEMENTS ────────────────────────────────────
let announcementsCache = [];
let editingAnnId       = null;
let editingAnnType     = null;

const LANG_LABELS = { both: '🌐 PT + ES', pt: '🇧🇷 PT', es: '🇦🇷 ES' };

async function loadAnnouncements() {
  announcementsCache = await fetch('/api/announcements?all=true').then(r => r.json());

  document.getElementById('announcementsTable').innerHTML = announcementsCache.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Sin avisos. Agregá un texto de voz o subí un audio.</td></tr>'
    : announcementsCache.map(a => {
        const typeLabel = a.type === 'audio' ? '🎵 Audio' : '🗣️ Voz';
        const schedLabel = a.schedule_type === 'interval' && a.schedule_interval
          ? `<span style="color:var(--info);font-size:0.8rem;">⏱ cada ${a.schedule_interval} min</span>`
          : a.schedule_type === 'time' && a.schedule_time
          ? `<span style="color:var(--info);font-size:0.8rem;">🕐 ${a.schedule_time}</span>`
          : '<span style="color:var(--text-muted);font-size:0.8rem;">—</span>';
        const preview = a.type === 'audio'
          ? `<audio controls src="/audio/announcements/${a.filename}" style="height:32px;max-width:220px;"></audio>`
          : `<span style="color:var(--text-muted);font-size:0.85rem;">${(a.content || '').slice(0, 60)}${a.content?.length > 60 ? '…' : ''}</span>`;
        const editBtn = `<button class="btn btn-info" style="padding:4px 10px;font-size:0.8rem;" onclick="openAnnouncementModal(${a.id})">Editar</button>`;
        return `
          <tr>
            <td style="font-weight:600;">${a.title}</td>
            <td>${typeLabel}</td>
            <td>${LANG_LABELS[a.lang] || a.lang}</td>
            <td>${schedLabel}</td>
            <td>${preview}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-success" style="padding:4px 12px;font-size:0.8rem;" onclick="playAnnouncement(${a.id})">▶ Reproducir</button>
              ${editBtn}
              <button class="btn btn-danger"  style="padding:4px 10px;font-size:0.8rem;" onclick="deleteAnnouncement(${a.id})">Eliminar</button>
            </td>
          </tr>
        `;
      }).join('');
}

async function playAnnouncement(id) {
  const btn = event.target;
  btn.textContent = '⏳';
  btn.disabled = true;
  await fetch(`/api/announcements/${id}/play`, { method: 'POST' });
  btn.textContent = '✅';
  setTimeout(() => { btn.textContent = '▶ Reproducir'; btn.disabled = false; }, 1500);
}

async function uploadAnnouncementAudio(input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('annUploadStatus');
  statusEl.style.display = 'block';
  statusEl.textContent   = `Subiendo "${file.name}"...`;

  const formData = new FormData();
  formData.append('audio', file);

  try {
    const up = await fetch('/api/announcements/upload-audio', { method: 'POST', body: formData }).then(r => r.json());
    if (up.error) throw new Error(up.error);

    const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    const cr = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, type: 'audio', filename: up.filename, lang: 'both' })
    }).then(r => r.json());
    if (cr.error) throw new Error(cr.error);

    statusEl.textContent = `✅ "${title}" subido. Podés configurar la programación ahora.`;
    input.value = '';
    await loadAnnouncements();
    openAnnouncementModal(cr.id);
    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
  }
}

function openAnnouncementModal(id, forceType) {
  editingAnnId   = id || null;
  const a        = id ? announcementsCache.find(x => x.id === id) : null;
  editingAnnType = a?.type || forceType || 'tts';

  const isAudio = editingAnnType === 'audio';
  document.getElementById('annModalTitle').textContent = a
    ? (isAudio ? 'Editar Aviso de Audio' : 'Editar Aviso de Voz')
    : 'Nuevo Aviso de Voz';

  document.getElementById('annTitle').value   = a?.title   || '';
  document.getElementById('annContent').value = a?.content || '';
  document.getElementById('annLang').value    = a?.lang    || 'both';

  // Hide content textarea for audio announcements
  document.getElementById('annContentGroup').style.display = isAudio ? 'none' : '';

  const schedType = a?.schedule_type || 'manual';
  const radio = document.querySelector(`[name="annScheduleType"][value="${schedType}"]`);
  if (radio) radio.checked = true;
  document.getElementById('annInterval').value = a?.schedule_interval || 30;
  document.getElementById('annTime').value     = a?.schedule_time     || '09:00';

  document.getElementById('announcementModal').classList.add('active');
}

function closeAnnouncementModal() {
  document.getElementById('announcementModal').classList.remove('active');
  editingAnnId   = null;
  editingAnnType = null;
}

async function saveAnnouncement() {
  const title    = document.getElementById('annTitle').value.trim();
  const content  = document.getElementById('annContent').value.trim();
  const lang     = document.getElementById('annLang').value;
  const schedType = document.querySelector('[name="annScheduleType"]:checked')?.value || 'manual';
  const schedInterval = schedType === 'interval'
    ? (parseInt(document.getElementById('annInterval').value) || 30)
    : null;
  const schedTime = schedType === 'time'
    ? document.getElementById('annTime').value
    : null;

  if (!title) { alert('El título es obligatorio'); return; }
  if (!content && editingAnnType !== 'audio') { alert('El texto es obligatorio'); return; }

  const payload = {
    title, content: editingAnnType === 'audio' ? null : content, lang, active: 1,
    schedule_type: schedType,
    schedule_interval: schedInterval,
    schedule_time: schedTime
  };

  if (editingAnnId) {
    await fetch(`/api/announcements/${editingAnnId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, type: 'tts' })
    });
  }

  closeAnnouncementModal();
  loadAnnouncements();
}

async function deleteAnnouncement(id) {
  const a = announcementsCache.find(x => x.id === id);
  if (!a || !confirm(`¿Eliminar el aviso "${a.title}"?`)) return;
  await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
  loadAnnouncements();
}

// ─── REPORTS ─────────────────────────────────────────
let reportData = null;
let reportFiltersReady = false;

async function loadReports() {
  if (!reportFiltersReady) {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('rptFrom').value = today;
    document.getElementById('rptTo').value   = today;

    const [services, operators] = await Promise.all([
      fetch('/api/services?all=true').then(r => r.json()),
      fetch('/api/operators').then(r => r.json())
    ]);

    const svcSel = document.getElementById('rptService');
    services.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = `${s.prefix} ${s.name}`;
      svcSel.appendChild(o);
    });

    const opSel = document.getElementById('rptOperator');
    operators.forEach(op => {
      const o = document.createElement('option');
      o.value = op.id; o.textContent = op.name;
      opSel.appendChild(o);
    });

    reportFiltersReady = true;
  }
  runReport();
}

async function runReport() {
  const from = document.getElementById('rptFrom').value;
  const to   = document.getElementById('rptTo').value;
  const svc  = document.getElementById('rptService').value;
  const op   = document.getElementById('rptOperator').value;

  if (!from || !to) { alert('Seleccioná un rango de fechas'); return; }

  const p = new URLSearchParams({ date_from: from, date_to: to });
  if (svc) p.set('service_id',  svc);
  if (op)  p.set('operator_id', op);

  const data = await fetch(`/api/reports?${p}`).then(r => r.json());
  reportData = data;

  renderRptSummary(data.summary);
  renderRptByService(data.byService);
  renderRptByOperator(data.byOperator);
  renderRptByHour(data.byHour);
  renderRptTickets(data.tickets);
}

function renderRptSummary(s) {
  const noShow   = s.no_show   || 0;
  const noShowPct = s.total > 0 ? Math.round(noShow / s.total * 100) : 0;
  document.getElementById('rptSummary').innerHTML = `
    <div class="stat-card">
      <div class="value">${s.total}</div>
      <div class="label">Total Turnos</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--success)">${s.completed || 0}</div>
      <div class="label">Atendidos</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--warning)">${noShow} <small style="font-size:1.2rem;">(${noShowPct}%)</small></div>
      <div class="label">No-show</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--info)">${s.avg_wait ?? '—'} min</div>
      <div class="label">Espera Promedio</div>
    </div>
  `;
}

function renderRptByService(rows) {
  document.getElementById('rptByService').innerHTML = rows.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Sin datos</td></tr>'
    : rows.map(r => `
      <tr>
        <td><span style="color:${r.color};font-weight:700;">${r.prefix}</span> ${r.name}</td>
        <td>${r.total}</td>
        <td style="color:var(--success)">${r.completed}</td>
        <td style="color:var(--warning)">${r.no_show}</td>
        <td>${r.avg_wait != null ? r.avg_wait + ' min' : '—'}</td>
      </tr>`).join('');
}

function renderRptByOperator(rows) {
  document.getElementById('rptByOperator').innerHTML = rows.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Sin datos</td></tr>'
    : rows.map(r => `
      <tr>
        <td>${r.operator_name}</td>
        <td>${r.total}</td>
        <td style="color:var(--success)">${r.completed}</td>
        <td style="color:var(--warning)">${r.no_show}</td>
        <td>${r.avg_service != null ? r.avg_service + ' min' : '—'}</td>
      </tr>`).join('');
}

function renderRptByHour(rows) {
  const el = document.getElementById('rptByHour');
  if (rows.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);">Sin datos para el período.</p>';
    return;
  }
  const maxVal = Math.max(...rows.map(r => r.total));
  el.innerHTML = `<div style="display:grid;gap:7px;max-width:680px;">` +
    rows.map(r => {
      const pct = maxVal > 0 ? (r.total / maxVal * 100).toFixed(1) : 0;
      return `
        <div style="display:grid;grid-template-columns:3.8rem 1fr 2.8rem;align-items:center;gap:10px;">
          <span style="font-size:0.82rem;color:var(--text-muted);text-align:right;">${r.hour}:00h</span>
          <div style="background:var(--bg-surface);border-radius:4px;height:22px;overflow:hidden;">
            <div style="background:var(--accent);height:100%;width:${pct}%;border-radius:4px;transition:width 0.5s ease;"></div>
          </div>
          <span style="font-size:0.85rem;font-weight:700;">${r.total}</span>
        </div>`;
    }).join('') + `</div>`;
}

const RPT_STATUS = {
  completed: '✅ Atendido', no_show: '👻 No-show',
  cancelled: '❌ Cancelado', waiting: '⏳ Esperando',
  called: '📢 Llamado',     serving: '🔧 Atendiendo'
};

function renderRptTickets(tickets) {
  document.getElementById('rptCount').textContent = `(${tickets.length} registros)`;
  document.getElementById('rptTickets').innerHTML = tickets.length === 0
    ? '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);">Sin turnos en el período.</td></tr>'
    : tickets.map(t => {
        const toMs  = s => s ? new Date(s.replace(' ', 'T')).getTime() : null;
        const waitMin = (toMs(t.called_at) && toMs(t.created_at))
          ? Math.round((toMs(t.called_at) - toMs(t.created_at)) / 60000) : null;
        const durMin  = (toMs(t.completed_at) && toMs(t.called_at))
          ? Math.round((toMs(t.completed_at) - toMs(t.called_at)) / 60000) : null;
        const hhmm = s => s ? s.slice(11, 16) : '—';
        return `
          <tr>
            <td style="font-weight:700;color:${t.color||'#fff'}">${t.code}</td>
            <td>${t.service_name}</td>
            <td>${RPT_STATUS[t.status] || t.status}</td>
            <td>${t.counter_number ?? '—'}</td>
            <td>${t.operator_name  ?? '—'}</td>
            <td style="font-size:0.85rem;">${hhmm(t.created_at)}</td>
            <td style="font-size:0.85rem;">${hhmm(t.called_at)}</td>
            <td>${waitMin != null ? waitMin : '—'}</td>
            <td>${durMin  != null ? durMin  : '—'}</td>
          </tr>`;
      }).join('');
}

function exportReportCSV() {
  if (!reportData?.tickets?.length) { alert('Primero generá un reporte.'); return; }

  const toMs  = s => s ? new Date(s.replace(' ', 'T')).getTime() : null;
  const headers = ['Código','Servicio','Estado','Caja','Operador',
                   'Entrada','Llamado','Completado','Espera(min)','Duración(min)'];
  const rows = reportData.tickets.map(t => {
    const waitMin = (toMs(t.called_at) && toMs(t.created_at))
      ? Math.round((toMs(t.called_at) - toMs(t.created_at)) / 60000) : '';
    const durMin  = (toMs(t.completed_at) && toMs(t.called_at))
      ? Math.round((toMs(t.completed_at) - toMs(t.called_at)) / 60000) : '';
    return [
      t.code, t.service_name, t.status,
      t.counter_number ?? '', t.operator_name ?? '',
      t.created_at ?? '', t.called_at ?? '', t.completed_at ?? '',
      waitMin, durMin
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  });

  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `reporte_${document.getElementById('rptFrom').value}_al_${document.getElementById('rptTo').value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── VOICES (TTS) ────────────────────────────────────
let voicesList = null;

async function loadVoiceConfig() {
  const statusEl = document.getElementById('voiceStatus');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Cargando voces...'; }

  try {
    const [voices, cfg, status] = await Promise.all([
      voicesList || fetch('/api/tts/voices').then(r => r.json()),
      fetch('/api/tts/config').then(r => r.json()),
      fetch('/api/tts/status').then(r => r.json())
    ]);
    if (!voicesList) voicesList = voices;

    // Backend info
    const infoEl = document.getElementById('voiceBackendInfo');
    const piperOk  = status.piperAvailable;
    const espeakOk = status.espeakAvailable;
    const msedgeOk = voicesList.some(v => v.backend === 'msedge');
    let info = '';
    info += msedgeOk
      ? '<span style="color:var(--success);">&#10003;</span> Microsoft Edge Neural: disponible<br>'
      : '<span style="color:var(--text-muted);">&#10007;</span> Microsoft Edge Neural: no disponible (sin internet o bloqueado)<br>';
    info += piperOk
      ? `<span style="color:var(--success);">&#10003;</span> Piper Neural (offline): disponible — modelos: ${status.piperModels.join(', ')}<br>`
      : '<span style="color:var(--warning);">&#9888;</span> Piper Neural (offline): no instalado — <code>bash scripts/setup-piper.sh</code><br>';
    info += espeakOk
      ? '<span style="color:var(--success);">&#10003;</span> espeak-ng (offline): disponible'
      : '<span style="color:var(--text-muted);">&#10007;</span> espeak-ng (offline): no instalado — <code>sudo dnf install espeak-ng</code>';
    infoEl.innerHTML = info;

    const backendSel = document.getElementById('voiceBackend');
    backendSel.value = cfg.backend || 'auto';
    backendSel.onchange = () => renderVoiceDropdowns();

    document.getElementById('voiceRate').value = cfg.rate || '-15%';
    document.getElementById('voicePiperSpeed').value = String(cfg.piperLengthScale || 1.3);

    renderVoiceDropdowns({ pt: cfg.ptVoice, es: cfg.esVoice });

    if (statusEl) statusEl.style.display = 'none';
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Error al cargar voces: ' + e.message;
  }
}

function renderVoiceDropdowns(preselect) {
  const backend = document.getElementById('voiceBackend').value;
  const compatible = (v) => backend === 'auto' || v.backend === backend;

  // Keep the user's current pick across motor switches when possible
  const currentPt = preselect?.pt ?? document.getElementById('voicePtSelect').value;
  const currentEs = preselect?.es ?? document.getElementById('voiceEsSelect').value;

  fillVoiceSelect(
    'voicePtSelect',
    voicesList.filter(v => (v.locale.startsWith('pt-BR') || v.locale.startsWith('pt')) && compatible(v)),
    currentPt
  );
  fillVoiceSelect(
    'voiceEsSelect',
    voicesList.filter(v => v.locale.startsWith('es') && compatible(v)),
    currentEs
  );
}

function fillVoiceSelect(id, voices, selected) {
  const sel = document.getElementById(id);
  sel.innerHTML = voices.map(v => {
    const label = v.backend === 'espeak'
      ? `${v.friendlyName}`
      : `${v.locale} — ${v.gender} — ${v.shortName.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/Neural$/, '')}`;
    return `<option value="${v.shortName}" ${v.shortName === selected ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

function previewVoice(lang) {
  const sel   = document.getElementById(lang === 'pt' ? 'voicePtSelect' : 'voiceEsSelect');
  const voice = sel.value;
  const audio = document.getElementById('voicePreviewAudio');
  audio.src = `/api/tts/preview?voice=${encodeURIComponent(voice)}&lang=${lang}&t=${Date.now()}`;
  audio.play().catch((e) => alert('No se pudo reproducir: ' + e.message));
}

async function saveVoiceConfig(clearCache) {
  const ptVoice = document.getElementById('voicePtSelect').value;
  const esVoice = document.getElementById('voiceEsSelect').value;
  const rate    = document.getElementById('voiceRate').value;
  const backend = document.getElementById('voiceBackend').value;
  const piperLengthScale = parseFloat(document.getElementById('voicePiperSpeed').value) || 1.3;
  // Map piper scale to espeak WPM: scale 1.0→150, 1.3→120, 1.6→100, 1.8→90
  const espeakSpeed = Math.round(150 / piperLengthScale);
  const statusEl = document.getElementById('voiceStatus');
  statusEl.style.display = 'block';
  statusEl.textContent = 'Guardando...';

  try {
    const r = await fetch('/api/tts/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ptVoice, esVoice, rate, backend, piperLengthScale, espeakSpeed, clearCache })
    }).then(r => r.json());
    statusEl.textContent = clearCache
      ? `Guardado. Cache limpiado: ${r.cleared} archivos eliminados.`
      : 'Guardado.';
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

// ─── SOCKET EVENTS ───────────────────────────────────
socket.on('ticket:created', () => { loadStats(); loadQueue(); });
socket.on('ticket:called', () => { loadStats(); loadQueue(); loadCounters(); });
socket.on('ticket:completed', () => { loadStats(); loadQueue(); loadCounters(); });
socket.on('ticket:no-show', () => { loadStats(); loadQueue(); loadCounters(); });
socket.on('counter:updated', () => { loadCounters(); });

// ─── START ───────────────────────────────────────────
init();
