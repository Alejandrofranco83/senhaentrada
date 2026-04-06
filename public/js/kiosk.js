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

// Show operator selection screen
async function showOperatorScreen() {
  const res = await fetch('/api/operators/available');
  const operators = await res.json();

  const list = document.getElementById('operatorList');
  list.innerHTML = '';

  // Individual operators
  for (const op of operators) {
    const btn = document.createElement('button');
    btn.className = 'operator-btn';
    btn.textContent = op.name;
    btn.onclick = () => createTicket(specificServiceId, op.id);
    list.appendChild(btn);
  }

  // "First available" option
  const firstBtn = document.createElement('button');
  firstBtn.className = 'operator-btn first-available';
  firstBtn.innerHTML = `
    <div style="font-weight:700;">Primero disponible</div>
    <div style="font-size:0.9rem;opacity:0.8;margin-top:4px;">Primeiro disponível</div>
  `;
  firstBtn.onclick = () => createTicket(specificServiceId, null);
  list.appendChild(firstBtn);

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
