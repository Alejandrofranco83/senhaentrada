const socket = io();

const MAX_CALLED = 10;
let calledTickets = [];

// ════════════════════════════════════════════════════════
//  STATE MACHINE
//  'idle'  → ads full-screen, no ticket overlay
//  'queue' → ads full-screen + glass ticket cards on top
// ════════════════════════════════════════════════════════
let displayState    = 'idle';
let announceTimer   = null;
let idleReturnTimer = null;

const ANNOUNCE_DURATION   = 10000;          // ms the center card stays visible
const IDLE_RETURN_TIMEOUT = 3 * 60 * 1000;  // 3 min no activity → back to idle

function setDisplayState(state) {
  if (displayState === state) return;
  displayState = state;
  document.getElementById('displayPage').dataset.state = state;
}

function resetIdleReturnTimer() {
  clearTimeout(idleReturnTimer);
  idleReturnTimer = setTimeout(() => setDisplayState('idle'), IDLE_RETURN_TIMEOUT);
}

// ─── INIT ────────────────────────────────────────────
async function init() {
  const active = await fetch('/api/tickets/active').then(r => r.json());
  calledTickets = active.slice(0, MAX_CALLED);
  renderCalled();

  if (calledTickets.length > 0) {
    setDisplayState('queue');
    resetIdleReturnTimer();
  }

  initAds();
  initAnnouncementScheduler();
}

// ─── RENDER CALLED LIST ──────────────────────────────
function renderCalled() {
  const container = document.getElementById('calledList');

  if (calledTickets.length === 0) {
    container.innerHTML = `<div class="display-empty">Esperando turnos... / Aguardando senhas...</div>`;
    return;
  }

  container.innerHTML = calledTickets.map((t, i) => `
    <div class="display-ticket ${i === 0 ? 'highlight' : ''}">
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

// ─── CENTER ANNOUNCEMENT ─────────────────────────────
function showAnnounce(ticket) {
  const el = document.getElementById('ticketAnnounce');

  document.getElementById('taCode').textContent      = ticket.code;
  document.getElementById('taCode').style.color      = ticket.color || 'var(--accent)';
  document.getElementById('taNum').textContent       = ticket.counter_number || '-';
  document.getElementById('taService').textContent   = ticket.service_name    || '';
  document.getElementById('taServicePt').textContent = ticket.service_name_pt || '';

  // Re-trigger the enter animation by briefly removing the class
  el.classList.remove('show');
  void el.offsetWidth; // force reflow
  el.classList.add('show');
}

function hideAnnounce() {
  document.getElementById('ticketAnnounce').classList.remove('show');
}

// Serialized announcement queue: each ticket waits its turn, gets shown
// for ANNOUNCE_DURATION AND for as long as its TTS takes (whichever ends last).
const announceQueue = [];
let processingAnnounceQueue = false;

function enqueueAnnounce(ticket) {
  announceQueue.push(ticket);
  if (!processingAnnounceQueue) processAnnounceQueue();
}

async function processAnnounceQueue() {
  processingAnnounceQueue = true;
  while (announceQueue.length > 0) {
    const ticket = announceQueue.shift();
    showAnnounce(ticket);
    if (displayState === 'queue') resetIdleReturnTimer();

    const minVisible = new Promise(r => setTimeout(r, ANNOUNCE_DURATION));
    const ttsDone    = announceTicket(ticket).catch(() => {});

    await Promise.all([minVisible, ttsDone]);
  }
  hideAnnounce();
  if (calledTickets.length > 0) setDisplayState('queue');
  resetIdleReturnTimer();
  processingAnnounceQueue = false;
}

// ─── ADS CAROUSEL ────────────────────────────────────
let ads            = [];
let currentAdIndex = 0;
let adTimer        = null;

async function initAds() {
  await loadAds();

  // Poll for admin changes every 30 s — no page reload needed
  setInterval(async () => {
    try {
      const fresh    = await fetch('/api/ads').then(r => r.json());
      const freshIds = fresh.map(a => a.id).join(',');
      const currIds  = ads.map(a => a.id).join(',');
      if (freshIds !== currIds) {
        ads = fresh;
        currentAdIndex = 0;
        renderAds();
        if (ads.length > 0) showAd(0);
      }
    } catch (e) {}
  }, 30000);
}

async function loadAds() {
  try { ads = await fetch('/api/ads').then(r => r.json()); }
  catch (e) { ads = []; }
  renderAds();
  if (ads.length > 0) showAd(0);
}

function renderAds() {
  const panel = document.getElementById('adsPanel');
  const empty = document.getElementById('adsEmpty');

  panel.querySelectorAll('.ad-slide').forEach(el => el.remove());
  empty.style.display = ads.length === 0 ? 'flex' : 'none';
}

// Build a single <ad-slide> for the given ad, swapping out the previous one.
// Only the currently-playing ad lives in the DOM — prevents Smart TV memory
// pressure from N concurrent <video> decoders. El slide anterior queda visible
// hasta que el nuevo está realmente listo (video reproduciendo / imagen
// decodificada), así el cambio es sin hueco — nunca se ve el fondo/logo.
function showAd(index) {
  if (ads.length === 0) return;

  clearTimeout(adTimer);
  currentAdIndex = ((index % ads.length) + ads.length) % ads.length;
  const ad = ads[currentAdIndex];

  const panel = document.getElementById('adsPanel');

  // Limpia slides pendientes que nunca llegaron a mostrarse (ej. video que
  // no arrancó y saltamos por watchdog) — libera su decoder antes de seguir.
  panel.querySelectorAll('.ad-slide:not(.active)').forEach(el => {
    const sv = el.querySelector('video');
    if (sv) { sv.pause(); sv.removeAttribute('src'); sv.load(); }
    el.remove();
  });
  const prev = panel.querySelector('.ad-slide');

  const slide = document.createElement('div');
  slide.className = 'ad-slide';

  let advanced = false;
  const advance = () => {
    if (advanced || !panel.contains(slide)) return;
    advanced = true;
    showAd(currentAdIndex + 1);
  };

  // Fade-in del slide nuevo + retiro del anterior, recién cuando el nuevo
  // está listo. Libera el decoder viejo (pause+load) tras el fade.
  const swapIn = () => {
    requestAnimationFrame(() => slide.classList.add('active'));
    if (prev) {
      prev.classList.remove('active');
      setTimeout(() => {
        const oldVideo = prev.querySelector('video');
        if (oldVideo) { oldVideo.pause(); oldVideo.removeAttribute('src'); oldVideo.load(); }
        prev.remove();
      }, 1000);
    }
  };

  if (ad.type === 'video') {
    const v = document.createElement('video');
    v.muted       = true;
    v.autoplay    = true;
    v.playsInline = true;
    v.preload     = 'auto';
    let swapped = false;
    // Vigilante: si en 10s no llegó a reproducir, saltamos al siguiente.
    // Cubre play() que nunca resuelve, buffering eterno y stalls sin evento.
    let watchdog = setTimeout(advance, 10000);
    v.addEventListener('playing', () => {
      clearTimeout(watchdog);
      if (!swapped) { swapped = true; swapIn(); }
    });
    v.onended  = advance;
    v.onerror  = advance;
    // Stall a mitad de reproducción: 8s de gracia; si retoma, 'playing' lo cancela.
    v.onstalled = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(advance, 8000);
    };
    v.src = `/img/ads/${ad.filename}`;
    slide.appendChild(v);
    panel.appendChild(slide);   // oculto (sin .active) detrás del slide actual
    v.play().catch(advance);
  } else {
    const img = document.createElement('img');
    img.src = `/img/ads/${ad.filename}`;
    img.alt = ad.title || '';
    slide.appendChild(img);
    panel.appendChild(slide);
    // decode() espera la imagen lista; si falla (formato/red) igual mostramos.
    const show = () => { swapIn(); adTimer = setTimeout(advance, (ad.duration || 8) * 1000); };
    if (img.decode) { img.decode().then(show).catch(show); } else { show(); }
  }
}

// ─── AUDIO ACTIVATION ────────────────────────────────
// All TTS is now generated server-side as MP3 (msedge-tts) and played via <audio>.
// This works on Smart TV browsers (Tizen/webOS/Android TV) that don't support
// the Web Speech API.

let audioActivated           = false;
let currentAnnouncementAudio = null;   // tracks playing scheduled/manual audio
let currentTicketAudio       = null;   // tracks playing ticket-call audio
let isAnnouncingTicket       = false;  // true while ticket TTS is playing

function activateAudio() {
  audioActivated = true;
  document.getElementById('audioOverlay').style.display = 'none';
  // Unlock autoplay: play a 1-frame silent audio while we have a user gesture
  const unlock = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjQ1LjEwMAAAAAAAAAAAAAAA//tQwAADQAAB');
  unlock.volume = 0;
  unlock.play().catch(() => {});
}

// Stop any currently playing audio (ticket has priority over announcements)
function stopCurrentAnnouncement() {
  if (currentAnnouncementAudio) {
    currentAnnouncementAudio.pause();
    currentAnnouncementAudio.currentTime = 0;
    currentAnnouncementAudio = null;
  }
}

// Play an MP3 from a URL; returns a promise resolved on `ended`
function playAudioUrl(url) {
  return new Promise((resolve, reject) => {
    const a = new Audio(url);
    a.onended = () => resolve(a);
    a.onerror = () => reject(new Error('audio error'));
    a.play().then(() => { /* started */ }, reject);
  });
}

// ─── TICKET CALL TTS ─────────────────────────────────
async function announceTicket(ticket) {
  if (!audioActivated) return;
  stopCurrentAnnouncement();   // ticket preempts any running ad announcement
  isAnnouncingTicket = true;

  const code = ticket.code;
  const cn   = ticket.counter_number || '';

  const urlPt = `/api/tts/ticket?code=${encodeURIComponent(code)}&counter=${encodeURIComponent(cn)}&lang=pt`;
  const urlEs = `/api/tts/ticket?code=${encodeURIComponent(code)}&counter=${encodeURIComponent(cn)}&lang=es`;

  try {
    const ptAudio = new Audio(urlPt);
    currentTicketAudio = ptAudio;
    await new Promise((resolve) => {
      ptAudio.onended = resolve;
      ptAudio.onerror = resolve;
      ptAudio.play().catch(resolve);
    });

    if (currentTicketAudio !== ptAudio) return;  // was interrupted

    await new Promise(r => setTimeout(r, 500));

    const esAudio = new Audio(urlEs);
    currentTicketAudio = esAudio;
    await new Promise((resolve) => {
      esAudio.onended = resolve;
      esAudio.onerror = resolve;
      esAudio.play().catch(resolve);
    });
  } finally {
    if (currentTicketAudio && currentTicketAudio.src.includes('/api/tts/ticket')) {
      currentTicketAudio = null;
    }
    isAnnouncingTicket = false;
  }
}

// ─── SOCKET EVENTS ───────────────────────────────────
socket.on('ticket:called', (ticket) => {
  calledTickets.unshift(ticket);
  if (calledTickets.length > MAX_CALLED) calledTickets = calledTickets.slice(0, MAX_CALLED);
  renderCalled();
  enqueueAnnounce(ticket);
});

socket.on('ticket:recalled', (ticket) => {
  // Flash in the list
  document.querySelectorAll('.display-ticket').forEach(item => {
    if (item.querySelector('.ticket-code')?.textContent === ticket.code) {
      item.classList.remove('highlight');
      void item.offsetWidth;
      item.classList.add('highlight');
    }
  });
  enqueueAnnounce(ticket);
});

socket.on('ticket:completed', (ticket) => {
  calledTickets = calledTickets.filter(t => t.id !== ticket.id);
  renderCalled();
});

socket.on('ticket:no-show', (ticket) => {
  calledTickets = calledTickets.filter(t => t.id !== ticket.id);
  renderCalled();
});

socket.on('tickets:active', (active) => {
  calledTickets = active.slice(0, MAX_CALLED);
  renderCalled();
});

async function playAnnouncement(data) {
  stopCurrentAnnouncement();

  if (data.type === 'audio') {
    const audio = new Audio(`/audio/announcements/${data.filename}`);
    currentAnnouncementAudio = audio;
    audio.onended = () => { if (currentAnnouncementAudio === audio) currentAnnouncementAudio = null; };
    audio.play().catch(() => {});
    return;
  }

  // TTS announcement → server-generated MP3
  const text = data.content || '';
  if (!text) return;
  const lang = data.lang || 'both';
  const langs = lang === 'both' ? ['pt', 'es'] : [lang];

  for (const l of langs) {
    if (isAnnouncingTicket) return;  // ticket preempts
    const url = `/api/tts/text?lang=${l}&text=${encodeURIComponent(text)}`;
    const audio = new Audio(url);
    currentAnnouncementAudio = audio;
    try {
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(resolve);
      });
    } catch (e) {}
    if (currentAnnouncementAudio !== audio) return;  // interrupted
    if (langs.length > 1 && l !== langs[langs.length - 1]) {
      await new Promise(r => setTimeout(r, 600));
    }
  }
  currentAnnouncementAudio = null;
}

socket.on('announcement:play', (data) => playAnnouncement(data));

// ─── ANNOUNCEMENT SCHEDULER ──────────────────────────
const scheduledLastPlayed = {};  // annId → ms timestamp

async function initAnnouncementScheduler() {
  // Seed last-played to now so interval anns don't fire immediately on load
  try {
    const anns = await fetch('/api/announcements').then(r => r.json());
    const now  = Date.now();
    for (const ann of anns) {
      if (ann.schedule_type !== 'manual') scheduledLastPlayed[ann.id] = now;
    }
  } catch (e) {}
  setInterval(checkScheduledAnnouncements, 60000);
}

async function checkScheduledAnnouncements() {
  if (!audioActivated) return;
  try {
    const anns = await fetch('/api/announcements').then(r => r.json());
    const now  = Date.now();
    const d    = new Date();
    const hhmm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    for (const ann of anns) {
      if (ann.schedule_type === 'interval' && ann.schedule_interval > 0) {
        const last = scheduledLastPlayed[ann.id] || 0;
        if (now - last >= ann.schedule_interval * 60000) {
          scheduledLastPlayed[ann.id] = now;
          playScheduledAnnouncement(ann);
          break;  // one at a time
        }
      } else if (ann.schedule_type === 'time' && ann.schedule_time === hhmm) {
        const last = scheduledLastPlayed[ann.id] || 0;
        if (now - last > 55000) {
          scheduledLastPlayed[ann.id] = now;
          playScheduledAnnouncement(ann);
          break;
        }
      }
    }
  } catch (e) {}
}

function playScheduledAnnouncement(ann) {
  // Ticket has priority — don't play if ticket TTS is active
  if (isAnnouncingTicket) return;
  if (currentAnnouncementAudio) return;
  playAnnouncement(ann);
}

// ─── START ───────────────────────────────────────────
init();

// Keep-alive: prevent Smart TV browsers from sleeping
setInterval(() => {
  document.title = `Turnos - ${new Date().toLocaleTimeString()}`;
}, 60000);
