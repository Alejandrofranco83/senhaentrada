const socket = io();

let currentCounterId = null;
let currentOperatorId = null;
let currentTicket = null;
let isPaused = false;

// ─── SESSION PERSISTENCE ─────────────────────────────
function saveSession() {
  if (currentCounterId && currentOperatorId) {
    localStorage.setItem('operator_session', JSON.stringify({
      counterId: currentCounterId,
      operatorId: currentOperatorId
    }));
  } else {
    localStorage.removeItem('operator_session');
  }
}

function getSavedSession() {
  try {
    const data = localStorage.getItem('operator_session');
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

// ─── INIT ────────────────────────────────────────────
async function init() {
  const [operators, counters] = await Promise.all([
    fetch('/api/operators').then(r => r.json()),
    fetch('/api/counters').then(r => r.json())
  ]);

  // Check if we have a saved session to restore
  const saved = getSavedSession();
  if (saved) {
    const counter = counters.find(c => c.id === saved.counterId);
    const operator = operators.find(o => o.id === saved.operatorId);

    // Verify the counter is still ours (same operator)
    if (counter && operator && counter.operator_id === saved.operatorId && counter.status !== 'closed') {
      currentCounterId = saved.counterId;
      currentOperatorId = saved.operatorId;

      document.getElementById('counterName').textContent = counter.name;
      document.getElementById('operatorName').textContent = operator.name;
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('dashboard').style.display = 'flex';

      isPaused = counter.status === 'paused';

      if (isPaused) {
        updateStatus('paused');
        document.getElementById('btnPause').style.display = 'none';
        document.getElementById('btnResume').style.display = '';
        document.getElementById('btnCallNext').disabled = true;
      } else if (counter.current_ticket_id) {
        // Restore current ticket
        const active = await fetch('/api/tickets/active').then(r => r.json());
        const myTicket = active.find(t => t.counter_id === currentCounterId);
        if (myTicket) {
          currentTicket = myTicket;
          showCurrentTicket(myTicket);
        } else {
          updateStatus('open');
        }
      } else {
        updateStatus('open');
      }

      updateQueueCounts();
      return; // Skip login screen
    } else {
      // Session is stale, clear it
      localStorage.removeItem('operator_session');
    }
  }

  // Show login screen with selects
  const opSelect = document.getElementById('operatorSelect');
  for (const op of operators) {
    const opt = document.createElement('option');
    opt.value = op.id;
    opt.textContent = op.name;
    opSelect.appendChild(opt);
  }

  const cSelect = document.getElementById('counterSelect');
  for (const c of counters) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (Caixa ${c.number})`;
    if (c.status !== 'closed') {
      opt.textContent += ` - ${c.operator_name || 'Ocupada'}`;
      opt.disabled = true;
    }
    cSelect.appendChild(opt);
  }
}

// ─── OPEN COUNTER ────────────────────────────────────
async function openCounter() {
  const operatorId = document.getElementById('operatorSelect').value;
  const counterId = document.getElementById('counterSelect').value;

  if (!operatorId || !counterId) {
    alert('Seleccione operador y caja / Selecione operador e caixa');
    return;
  }

  const res = await fetch(`/api/counters/${counterId}/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator_id: parseInt(operatorId) })
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error || 'Error');
    return;
  }

  const counter = await res.json();

  currentCounterId = parseInt(counterId);
  currentOperatorId = parseInt(operatorId);

  document.getElementById('counterName').textContent = counter.name;
  document.getElementById('operatorName').textContent =
    document.getElementById('operatorSelect').selectedOptions[0].text;

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';

  updateStatus('open');
  updateQueueCounts();
  saveSession();
}

// ─── CLOSE COUNTER ───────────────────────────────────
async function closeCounter() {
  await fetch(`/api/counters/${currentCounterId}/close`, { method: 'POST' });

  currentCounterId = null;
  currentOperatorId = null;
  currentTicket = null;

  saveSession(); // clears localStorage

  document.getElementById('loginScreen').style.display = '';
  document.getElementById('dashboard').style.display = 'none';

  location.reload();
}

// ─── CALL NEXT ───────────────────────────────────────
async function callNext() {
  const res = await fetch('/api/tickets/call-next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ counter_id: currentCounterId })
  });

  const data = await res.json();
  if (data.empty) {
    showNoTickets();
    return;
  }

  currentTicket = data;
  showCurrentTicket(data);
}

// ─── RECALL ──────────────────────────────────────────
async function recall() {
  if (!currentTicket) return;
  await fetch(`/api/tickets/${currentTicket.id}/recall`, { method: 'POST' });
}

// ─── COMPLETE ────────────────────────────────────────
function confirmComplete() {
  if (!currentTicket) return;
  if (!confirm(`¿Completar turno ${currentTicket.code}?\nConcluir senha ${currentTicket.code}?`)) return;
  complete();
}

async function complete() {
  if (!currentTicket) return;
  await fetch(`/api/tickets/${currentTicket.id}/complete`, { method: 'POST' });
  currentTicket = null;
  showEmptyTicket();
  updateStatus('open');
}

// ─── NO SHOW ─────────────────────────────────────────
function confirmNoShow() {
  if (!currentTicket) return;
  if (!confirm(`¿Marcar ${currentTicket.code} como no presentado?\nMarcar ${currentTicket.code} como não compareceu?`)) return;
  noShow();
}

async function noShow() {
  if (!currentTicket) return;
  await fetch(`/api/tickets/${currentTicket.id}/no-show`, { method: 'POST' });
  currentTicket = null;
  showEmptyTicket();
  updateStatus('open');
}

// ─── CLOSE (with confirmation) ───────────────────────
function confirmClose() {
  if (!confirm('¿Cerrar caja? / Fechar caixa?')) return;
  closeCounter();
}

// ─── PAUSE / RESUME ──────────────────────────────────
async function pauseCounter() {
  await fetch(`/api/counters/${currentCounterId}/pause`, { method: 'POST' });
  isPaused = true;
  updateStatus('paused');
  document.getElementById('btnPause').style.display = 'none';
  document.getElementById('btnResume').style.display = '';
  document.getElementById('btnCallNext').disabled = true;
}

async function resumeCounter() {
  await fetch(`/api/counters/${currentCounterId}/resume`, { method: 'POST' });
  isPaused = false;
  updateStatus(currentTicket ? 'busy' : 'open');
  document.getElementById('btnPause').style.display = '';
  document.getElementById('btnResume').style.display = 'none';
  document.getElementById('btnCallNext').disabled = false;
}

// ─── UI HELPERS ──────────────────────────────────────
function showCurrentTicket(ticket) {
  const card = document.getElementById('currentTicketCard');
  card.classList.remove('empty');
  document.getElementById('currentTicketCode').textContent = ticket.code;
  document.getElementById('currentTicketService').innerHTML =
    `${ticket.service_name || ''}<br><small style="color:var(--text-muted);font-style:italic;">${ticket.service_name_pt || ''}</small>`;

  document.getElementById('btnCallNext').disabled = true;
  document.getElementById('btnRecall').disabled = false;
  document.getElementById('btnComplete').disabled = false;
  document.getElementById('btnNoShow').disabled = false;

  updateStatus('busy');
}

function showEmptyTicket() {
  const card = document.getElementById('currentTicketCard');
  card.classList.add('empty');
  document.getElementById('currentTicketCode').innerHTML =
    'Sin turno activo<br><small style="font-size:0.7em;">Sem senha ativa</small>';
  document.getElementById('currentTicketService').textContent = '';

  document.getElementById('btnCallNext').disabled = isPaused;
  document.getElementById('btnRecall').disabled = true;
  document.getElementById('btnComplete').disabled = true;
  document.getElementById('btnNoShow').disabled = true;
}

function showNoTickets() {
  const card = document.getElementById('currentTicketCard');
  card.classList.add('empty');
  document.getElementById('currentTicketCode').innerHTML =
    'No hay turnos en espera<br><small style="font-size:0.7em;">Sem senhas em espera</small>';
}

function updateStatus(status) {
  const indicator = document.getElementById('statusIndicator');
  indicator.className = 'status-indicator ' + status;

  const labels = {
    open: 'Abierta / Aberto',
    busy: 'Ocupada / Ocupado',
    paused: 'Pausada / Pausado',
    closed: 'Cerrada / Fechado'
  };
  document.getElementById('statusText').textContent = labels[status] || status;
}

async function updateQueueCounts() {
  if (!currentCounterId) return;

  try {
    const [waiting, counters] = await Promise.all([
      fetch('/api/tickets/waiting').then(r => r.json()),
      fetch('/api/counters').then(r => r.json())
    ]);

    const myCounter = counters.find(c => c.id === currentCounterId);
    const myServiceIds = myCounter ? myCounter.services.map(s => s.id) : [];

    // Count tickets waiting for my services
    const waitingForMe = waiting.filter(t =>
      t.requested_operator_id === null && myServiceIds.includes(t.service_id)
    ).length;

    // Count tickets requesting me specifically
    const forMe = waiting.filter(t =>
      t.requested_operator_id === currentOperatorId
    ).length;

    document.getElementById('waitingCount').textContent = waitingForMe;
    document.getElementById('forYouCount').textContent = forMe;
  } catch (e) {
    console.error('Error updating counts:', e);
  }
}

// ─── SOCKET EVENTS ───────────────────────────────────
socket.on('ticket:created', () => updateQueueCounts());
socket.on('ticket:completed', () => updateQueueCounts());
socket.on('ticket:no-show', () => updateQueueCounts());
socket.on('queue:stats', () => updateQueueCounts());

socket.on('counter:updated', (counters) => {
  if (!currentCounterId) return;
  const mine = counters.find(c => c.id === currentCounterId);
  if (mine && mine.status === 'closed' && mine.operator_id !== currentOperatorId) {
    // Someone closed our counter remotely
    localStorage.removeItem('operator_session');
    location.reload();
  }
});

// ─── START ───────────────────────────────────────────
init();
