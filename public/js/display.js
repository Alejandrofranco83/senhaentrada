const socket = io();

const MAX_CALLED = 10;
let calledTickets = [];
let i18n = {};

// ─── INIT ────────────────────────────────────────────
async function init() {
  try {
    i18n = await fetch('/config/i18n.json').then(r => r.json());
  } catch (e) {
    console.warn('Could not load i18n');
  }

  // Load current active tickets
  const active = await fetch('/api/tickets/active').then(r => r.json());
  calledTickets = active.slice(0, MAX_CALLED);
  renderCalled();

  // Load initial stats
  const stats = await fetch('/api/stats/summary').then(r => r.json());
  renderWaitingStats(stats);
}

// ─── RENDER CALLED LIST ──────────────────────────────
function renderCalled() {
  const container = document.getElementById('calledList');

  if (calledTickets.length === 0) {
    container.innerHTML = `<div class="display-empty">Esperando turnos... / Aguardando senhas...</div>`;
    return;
  }

  container.innerHTML = calledTickets.map((t, i) => `
    <div class="display-ticket ${i === 0 ? 'highlight' : ''}" style="animation: slideIn 0.3s ease ${i * 0.05}s both;">
      <div class="ticket-left">
        <div class="ticket-code" style="color:${t.color || 'var(--accent)'}">${t.code}</div>
        <div class="ticket-service">${t.service_name || ''} / ${t.service_name_pt || ''}</div>
      </div>
      <div class="arrow">→</div>
      <div class="ticket-counter">
        <div class="counter-label">Caja / <i>Caixa</i></div>
        <div class="counter-number">${t.counter_number || ''}</div>
      </div>
    </div>
  `).join('');
}

// ─── RENDER WAITING STATS ────────────────────────────
function renderWaitingStats(stats) {
  const container = document.getElementById('waitingStats');

  if (!stats || !stats.waiting) return;

  container.innerHTML = stats.waiting.map(w => `
    <div class="stat" style="border-left: 3px solid ${w.color || '#666'}">
      <span class="icon">${w.icon || ''}</span>
      <span class="count">${w.count}</span>
      <span class="label">${w.name}<br><i>${w.name_pt || ''}</i></span>
    </div>
  `).join('');
}

// ─── AUDIO ACTIVATION ────────────────────────────────
let audioActivated = false;
let esVoice = null;
let ptVoice = null;

function activateAudio() {
  audioActivated = true;
  document.getElementById('audioOverlay').style.display = 'none';

  // Trigger a silent utterance to unlock audio
  const unlock = new SpeechSynthesisUtterance('');
  unlock.volume = 0;
  speechSynthesis.speak(unlock);

  // Find best voices
  findVoices();
  // Voices may load async in some browsers
  speechSynthesis.onvoiceschanged = findVoices;
}

function findVoices() {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return;

  // Spanish: prefer Latin American variants, fallback to any Spanish
  const esPreferred = ['es-MX', 'es-AR', 'es-US', 'es-CO', 'es-CL', 'es-419'];
  for (const lang of esPreferred) {
    const v = voices.find(v => v.lang === lang);
    if (v) { esVoice = v; break; }
  }
  if (!esVoice) {
    esVoice = voices.find(v => v.lang.startsWith('es')) || null;
  }

  // Portuguese: prefer Brazilian
  ptVoice = voices.find(v => v.lang === 'pt-BR')
    || voices.find(v => v.lang.startsWith('pt'))
    || null;

  console.log('TTS voices:', esVoice?.lang, esVoice?.name, '|', ptVoice?.lang, ptVoice?.name);
}

// ─── TEXT-TO-SPEECH ──────────────────────────────────
function announceTicket(ticket) {
  if (!audioActivated || !('speechSynthesis' in window)) return;

  // Cancel any ongoing speech
  speechSynthesis.cancel();

  // Spell out the code for clarity: "F 0 1 2" → "F cero uno dos"
  const code = ticket.code;
  const spokenCode = code.split('').map(c => {
    const digitNames = {
      '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro',
      '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve'
    };
    return digitNames[c] || c;
  }).join(' ');

  const counterNum = ticket.counter_number || '';

  // Spanish announcement
  const esText = `Turno ${spokenCode}, diríjase a Caja ${counterNum}`;
  const esUtterance = new SpeechSynthesisUtterance(esText);
  if (esVoice) esUtterance.voice = esVoice;
  esUtterance.lang = esVoice ? esVoice.lang : 'es-MX';
  esUtterance.rate = 0.85;
  esUtterance.volume = 1;

  // Portuguese announcement
  const ptDigits = {
    '0': 'zero', '1': 'um', '2': 'dois', '3': 'três', '4': 'quatro',
    '5': 'cinco', '6': 'seis', '7': 'sete', '8': 'oito', '9': 'nove'
  };
  const spokenCodePt = code.split('').map(c => ptDigits[c] || c).join(' ');
  const ptText = `Senha ${spokenCodePt}, dirija-se ao Caixa ${counterNum}`;
  const ptUtterance = new SpeechSynthesisUtterance(ptText);
  if (ptVoice) ptUtterance.voice = ptVoice;
  ptUtterance.lang = ptVoice ? ptVoice.lang : 'pt-BR';
  ptUtterance.rate = 0.85;
  ptUtterance.volume = 1;

  // Speak: Spanish first, then Portuguese
  esUtterance.onend = () => {
    setTimeout(() => speechSynthesis.speak(ptUtterance), 500);
  };

  speechSynthesis.speak(esUtterance);
}

// ─── SOCKET EVENTS ───────────────────────────────────
socket.on('ticket:called', (ticket) => {
  // Add to front of list, keep max
  calledTickets.unshift(ticket);
  if (calledTickets.length > MAX_CALLED) {
    calledTickets = calledTickets.slice(0, MAX_CALLED);
  }
  renderCalled();
  announceTicket(ticket);
});

socket.on('ticket:recalled', (ticket) => {
  announceTicket(ticket);

  // Flash the ticket in the list
  const items = document.querySelectorAll('.display-ticket');
  items.forEach(item => {
    if (item.querySelector('.ticket-code')?.textContent === ticket.code) {
      item.classList.remove('highlight');
      void item.offsetWidth; // force reflow
      item.classList.add('highlight');
    }
  });
});

socket.on('ticket:completed', (ticket) => {
  calledTickets = calledTickets.filter(t => t.id !== ticket.id);
  renderCalled();
});

socket.on('ticket:no-show', (ticket) => {
  calledTickets = calledTickets.filter(t => t.id !== ticket.id);
  renderCalled();
});

socket.on('queue:stats', (stats) => {
  renderWaitingStats(stats);
});

socket.on('tickets:active', (active) => {
  calledTickets = active.slice(0, MAX_CALLED);
  renderCalled();
});

// ─── START ───────────────────────────────────────────
init();

// Keep alive: prevent Smart TV browsers from sleeping
setInterval(() => {
  document.title = `Turnos - ${new Date().toLocaleTimeString()}`;
}, 60000);
