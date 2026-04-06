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
async function loadServices() {
  const services = await fetch('/api/services').then(r => r.json());

  document.getElementById('servicesTable').innerHTML = services.map(s => `
    <tr>
      <td><span style="background:${s.color};padding:2px 8px;border-radius:4px;">${s.prefix}</span></td>
      <td>${s.icon} ${s.name}</td>
      <td>${s.name_pt || '-'}</td>
      <td>${s.priority}</td>
      <td><span style="background:${s.color};display:inline-block;width:20px;height:20px;border-radius:4px;"></span> ${s.color}</td>
      <td>${s.active ? '✅ Activo' : '❌ Inactivo'}</td>
    </tr>
  `).join('');
}

function addService() {
  const name = prompt('Nombre (ES):');
  if (!name) return;
  const name_pt = prompt('Nombre (PT):');
  const prefix = prompt('Prefijo (1 letra):');
  if (!prefix) return;
  const color = prompt('Color (hex):', '#2196F3');
  const priority = prompt('Prioridad (1=normal, 2=alta):', '1');

  fetch('/api/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, name_pt, prefix: prefix.toUpperCase(),
      icon: '', color, priority: parseInt(priority),
      is_specific: 0, sort_order: 10, active: 1
    })
  }).then(() => loadServices());
}

// ─── OPERATORS ───────────────────────────────────────
async function loadOperators() {
  const operators = await fetch('/api/operators').then(r => r.json());

  document.getElementById('operatorsTable').innerHTML = operators.map(o => `
    <tr>
      <td>${o.id}</td>
      <td>${o.name}</td>
      <td>${o.active ? '✅ Activo' : '❌ Inactivo'}</td>
      <td>
        <button class="btn btn-info" style="padding:4px 12px;font-size:0.8rem;" onclick="editOperator(${o.id}, '${o.name}')">Editar</button>
        <button class="btn btn-danger" style="padding:4px 12px;font-size:0.8rem;" onclick="deleteOperator(${o.id})">Eliminar</button>
      </td>
    </tr>
  `).join('');
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

// ─── SOCKET EVENTS ───────────────────────────────────
socket.on('ticket:created', () => { loadStats(); loadQueue(); });
socket.on('ticket:called', () => { loadStats(); loadQueue(); loadCounters(); });
socket.on('ticket:completed', () => { loadStats(); loadQueue(); loadCounters(); });
socket.on('ticket:no-show', () => { loadStats(); loadQueue(); loadCounters(); });
socket.on('counter:updated', () => { loadCounters(); });

// ─── START ───────────────────────────────────────────
init();
