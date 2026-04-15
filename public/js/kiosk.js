const socket = io();

let services = [];
let specificServiceId = null;
let resetTimer = null;

// Load services and render buttons
async function init() {
  const res = await fetch('/api/services');
  services = await res.json();

  const container = document.getElementById('serviceButtons');
  container.innerHTML = '';

  for (const svc of services) {
    if (svc.is_specific) {
      specificServiceId = svc.id;
    }

    const btn = document.createElement('button');
    btn.className = 'kiosk-btn';
    btn.style.background = svc.color || '#333';
    btn.innerHTML = `
      <span class="icon">${svc.icon || ''}</span>
      <span class="label-es">${svc.name}</span>
      <span class="label-pt">${svc.name_pt || ''}</span>
      ${svc.description ? `<span class="label-desc">${svc.description}</span>` : ''}
    `;

    if (svc.is_specific) {
      btn.onclick = () => showOperatorScreen();
    } else {
      btn.onclick = () => createTicket(svc.id);
    }

    container.appendChild(btn);
  }
}

// Create a ticket for a normal service
async function createTicket(serviceId, operatorId = null) {
  try {
    const body = { service_id: serviceId };
    if (operatorId) body.requested_operator_id = operatorId;

    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const ticket = await res.json();
    if (ticket.error) {
      console.error(ticket.error);
      return;
    }

    showTicketResult(ticket);
  } catch (err) {
    console.error('Error creating ticket:', err);
  }
}

// Get initials from name
function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// Show operator selection screen
async function showOperatorScreen() {
  const res = await fetch('/api/operators/available');
  const operators = await res.json();

  const list = document.getElementById('operatorList');
  list.innerHTML = '';

  // Individual operators with photo
  for (const op of operators) {
    const btn = document.createElement('button');
    btn.className = 'operator-btn';

    const photoHtml = op.photo
      ? `<img class="op-photo" src="${op.photo}" alt="${op.name}">`
      : `<div class="op-initials">${getInitials(op.name)}</div>`;

    btn.innerHTML = `${photoHtml}<div class="op-name">${op.name}</div>`;
    btn.onclick = () => createTicket(specificServiceId, op.id);
    list.appendChild(btn);
  }

  // "First available" option
  const firstBtn = document.createElement('button');
  firstBtn.className = 'operator-btn first-available';
  firstBtn.innerHTML = `
    <div class="op-initials" style="background:var(--success);">⚡</div>
    <div class="op-name">Primero disponible<br><small style="opacity:0.7;">Primeiro disponível</small></div>
  `;
  firstBtn.onclick = () => createTicket(specificServiceId, null);
  list.appendChild(firstBtn);

  // Calculate grid: prefer 2 rows to keep photos from getting too narrow
  const total = operators.length + 1; // +1 for "first available"
  let cols, rows;
  if (total <= 2) { cols = total; rows = 1; }
  else if (total <= 4) { cols = 2; rows = 2; }
  else if (total <= 6) { cols = 3; rows = 2; }
  else if (total <= 8) { cols = 4; rows = 2; }
  else if (total <= 10) { cols = 5; rows = 2; }
  else { cols = Math.ceil(total / 3); rows = 3; }

  list.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  list.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  // When total is odd and fills 2 rows with one slot empty, make the
  // "first available" button span 2 columns so the layout looks balanced.
  if (total === 3) {
    firstBtn.style.gridColumn = 'span 2';
  }

  document.getElementById('serviceScreen').style.display = 'none';
  document.getElementById('operatorScreen').classList.add('active');
  document.getElementById('ticketScreen').classList.remove('active');
}

// Show service selection screen
function showServiceScreen() {
  document.getElementById('serviceScreen').style.display = '';
  document.getElementById('operatorScreen').classList.remove('active');
  document.getElementById('ticketScreen').classList.remove('active');
  clearTimeout(resetTimer);
}

// Show ticket confirmation
function showTicketResult(ticket) {
  document.getElementById('ticketCode').textContent = ticket.code;
  document.getElementById('ticketServiceEs').textContent = ticket.service ? ticket.service.name : '';
  document.getElementById('ticketServicePt').textContent = ticket.service ? (ticket.service.name_pt || '') : '';

  document.getElementById('serviceScreen').style.display = 'none';
  document.getElementById('operatorScreen').classList.remove('active');
  document.getElementById('ticketScreen').classList.add('active');

  // Auto-reset after 5 seconds
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    showServiceScreen();
  }, 5000);
}

// Initialize
init();
