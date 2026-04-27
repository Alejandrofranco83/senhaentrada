const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db } = require('../database/db');
const queue = require('../services/queue');
const { printTicket } = require('../services/printer');
const tts = require('../services/tts');
const { nowLocal } = require('../services/util');

// Multer config for announcement audio uploads
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'audio', 'announcements'));
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `ann_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
    cb(null, name);
  }
});
const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    if (/\.(mp3|wav|ogg|m4a|aac)$/i.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de audio'));
    }
  }
});

// Multer config for ad media uploads
const adsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'img', 'ads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `ad_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
    cb(null, name);
  }
});
const adsUpload = multer({
  storage: adsStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido'));
    }
  }
});

// Socket emitter gets injected from server.js
let socketEmitter = null;
router.setSocketEmitter = function (emitter) {
  socketEmitter = emitter;
};

// ─── SERVICES ────────────────────────────────────────────
router.get('/services', (req, res) => {
  const sql = req.query.all === 'true'
    ? 'SELECT * FROM services ORDER BY sort_order'
    : 'SELECT * FROM services WHERE active = 1 ORDER BY sort_order';
  const services = db.prepare(sql).all();
  res.json(services);
});

router.post('/services', (req, res) => {
  const { name, name_pt, prefix, icon, color, priority, is_specific, sort_order, description } = req.body;
  const result = db.prepare(
    'INSERT INTO services (name, name_pt, prefix, icon, color, priority, is_specific, sort_order, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, name_pt, prefix, icon, color, priority || 1, is_specific || 0, sort_order || 0, description || null);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/services/:id', (req, res) => {
  const { name, name_pt, prefix, icon, color, priority, is_specific, sort_order, active, description } = req.body;
  db.prepare(`
    UPDATE services SET name=?, name_pt=?, prefix=?, icon=?, color=?, priority=?, is_specific=?, sort_order=?, active=?, description=?
    WHERE id=?
  `).run(name, name_pt, prefix, icon, color, priority, is_specific, sort_order, active, description || null, req.params.id);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});

router.delete('/services/:id', (req, res) => {
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── OPERATORS ───────────────────────────────────────────
router.get('/operators', (req, res) => {
  const operators = db.prepare('SELECT * FROM operators WHERE active = 1 ORDER BY name').all();
  res.json(operators);
});

router.get('/operators/available', (req, res) => {
  // Operators who are logged in to an open (not paused, not closed) counter
  const available = db.prepare(`
    SELECT o.id, o.name, o.photo, c.id as counter_id, c.name as counter_name, c.number as counter_number
    FROM operators o
    JOIN counters c ON c.operator_id = o.id
    WHERE o.active = 1 AND c.status IN ('open', 'busy')
    ORDER BY o.name
  `).all();
  res.json(available);
});

router.post('/operators', (req, res) => {
  const { name, pin } = req.body;
  const result = db.prepare('INSERT INTO operators (name, pin) VALUES (?, ?)').run(name, pin || null);
  res.json(db.prepare('SELECT * FROM operators WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/operators/:id', (req, res) => {
  const { name, pin, active } = req.body;
  db.prepare('UPDATE operators SET name=?, pin=?, active=? WHERE id=?')
    .run(name, pin, active !== undefined ? active : 1, req.params.id);
  res.json(db.prepare('SELECT * FROM operators WHERE id = ?').get(req.params.id));
});

router.delete('/operators/:id', (req, res) => {
  db.prepare('UPDATE operators SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/operators/:id/photo', (req, res) => {
  const { photo } = req.body; // base64 string: "data:image/jpeg;base64,..."
  if (!photo) return res.status(400).json({ error: 'photo required' });

  // Save as file
  const match = photo.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'invalid image format' });

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const data = Buffer.from(match[2], 'base64');
  const filename = `operator_${req.params.id}.${ext}`;
  const filepath = path.join(__dirname, '..', 'public', 'img', 'operators', filename);

  fs.writeFileSync(filepath, data);

  const photoUrl = `/img/operators/${filename}`;
  db.prepare('UPDATE operators SET photo = ? WHERE id = ?').run(photoUrl, req.params.id);

  res.json({ ok: true, photo: photoUrl });
});

// ─── COUNTERS ────────────────────────────────────────────
router.get('/counters', (req, res) => {
  const counters = db.prepare(`
    SELECT c.*, o.name as operator_name,
           t.code as current_ticket_code, t.status as current_ticket_status
    FROM counters c
    LEFT JOIN operators o ON c.operator_id = o.id
    LEFT JOIN tickets t ON c.current_ticket_id = t.id
    ORDER BY c.number
  `).all();

  // Attach services for each counter
  for (const counter of counters) {
    counter.services = db.prepare(`
      SELECT s.* FROM services s
      JOIN counter_services cs ON cs.service_id = s.id
      WHERE cs.counter_id = ?
    `).all(counter.id);
  }

  res.json(counters);
});

router.post('/counters/:id/open', (req, res) => {
  const { operator_id } = req.body;
  if (!operator_id) return res.status(400).json({ error: 'operator_id required' });

  db.prepare('UPDATE counters SET status = ?, operator_id = ?, current_ticket_id = NULL WHERE id = ?')
    .run('open', operator_id, req.params.id);

  const counters = getAllCounters();
  if (socketEmitter) socketEmitter.emitCounterUpdated(counters);
  res.json(counters.find(c => c.id === parseInt(req.params.id)));
});

router.post('/counters/:id/close', (req, res) => {
  const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(req.params.id);

  // Complete any active ticket on this counter
  if (counter && counter.current_ticket_id) {
    const now = nowLocal();
    db.prepare("UPDATE tickets SET status = 'completed', completed_at = ? WHERE id = ? AND status IN ('called','serving')")
      .run(now, counter.current_ticket_id);
    if (socketEmitter) {
      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(counter.current_ticket_id);
      if (ticket) socketEmitter.emitTicketCompleted(ticket);
    }
  }

  db.prepare('UPDATE counters SET status = ?, operator_id = NULL, current_ticket_id = NULL WHERE id = ?')
    .run('closed', req.params.id);

  const counters = getAllCounters();
  if (socketEmitter) socketEmitter.emitCounterUpdated(counters);
  res.json({ ok: true });
});

router.post('/counters/:id/pause', (req, res) => {
  db.prepare('UPDATE counters SET status = ? WHERE id = ?').run('paused', req.params.id);

  const counters = getAllCounters();
  if (socketEmitter) socketEmitter.emitCounterUpdated(counters);
  res.json({ ok: true });
});

router.post('/counters/:id/resume', (req, res) => {
  const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(req.params.id);
  const newStatus = counter.current_ticket_id ? 'busy' : 'open';
  db.prepare('UPDATE counters SET status = ? WHERE id = ?').run(newStatus, req.params.id);

  const counters = getAllCounters();
  if (socketEmitter) socketEmitter.emitCounterUpdated(counters);
  res.json({ ok: true });
});

router.put('/counters/:id/services', (req, res) => {
  const { service_ids } = req.body;
  const counterId = req.params.id;

  db.prepare('DELETE FROM counter_services WHERE counter_id = ?').run(counterId);
  const insert = db.prepare('INSERT INTO counter_services (counter_id, service_id) VALUES (?, ?)');
  for (const sid of service_ids) {
    insert.run(counterId, sid);
  }

  res.json({ ok: true });
});

// ─── TICKETS ─────────────────────────────────────────────
router.post('/tickets', async (req, res) => {
  try {
    const { service_id, requested_operator_id } = req.body;
    const ticket = queue.createTicket(service_id, requested_operator_id || null);

    // Print ticket
    await printTicket(ticket);

    // Pre-generate TTS MP3s for every open counter so by call-time they're cached
    const openCounters = db.prepare(
      "SELECT number FROM counters WHERE status != 'closed'"
    ).all();
    for (const c of openCounters) {
      tts.preGenerateTicket(ticket.code, c.number);
    }

    if (socketEmitter) socketEmitter.emitTicketCreated(ticket);
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/tickets/waiting', (req, res) => {
  res.json(queue.getWaitingTickets());
});

router.get('/tickets/active', (req, res) => {
  res.json(queue.getActiveTickets());
});

router.post('/tickets/:id/call', (req, res) => {
  // Call next ticket for the counter that this operator is on
  const { counter_id } = req.body;
  try {
    const ticket = queue.callNextTicket(counter_id);
    if (!ticket) return res.json({ empty: true });

    if (socketEmitter) socketEmitter.emitTicketCalled(ticket);
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/tickets/call-next', (req, res) => {
  const { counter_id } = req.body;
  try {
    const ticket = queue.callNextTicket(counter_id);
    if (!ticket) return res.json({ empty: true });

    if (socketEmitter) socketEmitter.emitTicketCalled(ticket);
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/tickets/:id/recall', (req, res) => {
  const ticket = db.prepare(`
    SELECT t.*, s.name as service_name, s.name_pt as service_name_pt, s.prefix,
           c.name as counter_name, c.number as counter_number
    FROM tickets t
    JOIN services s ON t.service_id = s.id
    LEFT JOIN counters c ON t.counter_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  if (socketEmitter) socketEmitter.emitTicketRecalled(ticket);
  res.json(ticket);
});

router.post('/tickets/:id/complete', (req, res) => {
  try {
    const ticket = queue.completeTicket(parseInt(req.params.id));
    if (socketEmitter) {
      socketEmitter.emitTicketCompleted(ticket);
      socketEmitter.emitCounterUpdated(getAllCounters());
    }
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/tickets/:id/no-show', (req, res) => {
  try {
    const ticket = queue.noShowTicket(parseInt(req.params.id));
    if (socketEmitter) {
      socketEmitter.emitTicketNoShow(ticket);
      socketEmitter.emitCounterUpdated(getAllCounters());
    }
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/tickets/:id/cancel', (req, res) => {
  try {
    const ticket = queue.cancelTicket(parseInt(req.params.id));
    if (socketEmitter) socketEmitter.emitTicketCompleted(ticket);
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── STATS ───────────────────────────────────────────────
router.get('/stats/today', (req, res) => {
  res.json(queue.getTodayStats());
});

router.get('/stats/summary', (req, res) => {
  res.json(queue.getQueueStats());
});

// ─── ANNOUNCEMENTS ───────────────────────────────────────
router.get('/announcements', (req, res) => {
  const sql = req.query.all === 'true'
    ? 'SELECT * FROM announcements ORDER BY created_at DESC'
    : 'SELECT * FROM announcements WHERE active = 1 ORDER BY created_at DESC';
  res.json(db.prepare(sql).all());
});

router.post('/announcements/upload-audio', audioUpload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  res.json({ ok: true, filename: req.file.filename, url: `/audio/announcements/${req.file.filename}` });
});

function preGenAnnouncementTts(content, lang) {
  if (!content) return;
  const langs = lang === 'both' ? ['pt', 'es'] : [lang];
  for (const l of langs) {
    tts.getTextAudio(content, l).catch((e) =>
      console.error(`[tts] announcement pre-gen failed:`, e.message));
  }
}

router.post('/announcements', (req, res) => {
  const { title, type, content, filename, lang, schedule_type, schedule_interval, schedule_time } = req.body;
  if (!title || !type) return res.status(400).json({ error: 'title y type son requeridos' });
  const result = db.prepare(
    'INSERT INTO announcements (title, type, content, filename, lang, schedule_type, schedule_interval, schedule_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(title, type, content || null, filename || null, lang || 'both',
        schedule_type || 'manual', schedule_interval || null, schedule_time || null);
  if (type === 'tts') preGenAnnouncementTts(content, lang || 'both');
  res.json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/announcements/:id', (req, res) => {
  const { title, content, lang, active, schedule_type, schedule_interval, schedule_time } = req.body;
  db.prepare('UPDATE announcements SET title=?, content=?, lang=?, active=?, schedule_type=?, schedule_interval=?, schedule_time=? WHERE id=?')
    .run(title, content, lang, active,
         schedule_type || 'manual', schedule_interval || null, schedule_time || null,
         req.params.id);
  const ann = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (ann && ann.type === 'tts') preGenAnnouncementTts(ann.content, ann.lang);
  res.json(ann);
});

router.delete('/announcements/:id', (req, res) => {
  const ann = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!ann) return res.status(404).json({ error: 'No encontrado' });
  if (ann.filename) {
    const fp = path.join(__dirname, '..', 'public', 'audio', 'announcements', ann.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/announcements/:id/play', (req, res) => {
  const ann = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!ann) return res.status(404).json({ error: 'No encontrado' });
  if (socketEmitter) socketEmitter.emitAnnouncementPlay({
    type: ann.type,
    content: ann.content,
    filename: ann.filename,
    lang: ann.lang,
    title: ann.title
  });
  res.json({ ok: true });
});

// ─── REPORTS ─────────────────────────────────────────
router.get('/reports', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { date_from = today, date_to = today, service_id, operator_id } = req.query;

  const where  = ["date(t.created_at) BETWEEN ? AND ?"];
  const params = [date_from, date_to];

  if (service_id)  { where.push("t.service_id = ?");          params.push(service_id); }
  if (operator_id) { where.push("t.serving_operator_id = ?"); params.push(operator_id); }

  const w = where.join(' AND ');

  const summary = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN t.status = 'no_show'   THEN 1 END) as no_show,
      COUNT(CASE WHEN t.status = 'cancelled' THEN 1 END) as cancelled,
      ROUND(AVG(CASE WHEN t.called_at IS NOT NULL
        THEN (julianday(t.called_at) - julianday(t.created_at)) * 1440 END), 1) as avg_wait,
      ROUND(AVG(CASE WHEN t.completed_at IS NOT NULL AND t.called_at IS NOT NULL
        THEN (julianday(t.completed_at) - julianday(t.called_at)) * 1440 END), 1) as avg_service
    FROM tickets t WHERE ${w}
  `).get(...params);

  const byService = db.prepare(`
    SELECT s.name, s.prefix, s.color,
      COUNT(t.id) as total,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN t.status = 'no_show'   THEN 1 END) as no_show,
      ROUND(AVG(CASE WHEN t.called_at IS NOT NULL
        THEN (julianday(t.called_at) - julianday(t.created_at)) * 1440 END), 1) as avg_wait
    FROM tickets t JOIN services s ON t.service_id = s.id
    WHERE ${w} GROUP BY t.service_id ORDER BY total DESC
  `).all(...params);

  const byOperator = db.prepare(`
    SELECT COALESCE(o.name, 'Sin asignar') as operator_name,
      COUNT(t.id) as total,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN t.status = 'no_show'   THEN 1 END) as no_show,
      ROUND(AVG(CASE WHEN t.completed_at IS NOT NULL AND t.called_at IS NOT NULL
        THEN (julianday(t.completed_at) - julianday(t.called_at)) * 1440 END), 1) as avg_service
    FROM tickets t LEFT JOIN operators o ON t.serving_operator_id = o.id
    WHERE ${w} GROUP BY t.serving_operator_id ORDER BY total DESC
  `).all(...params);

  const byHour = db.prepare(`
    SELECT strftime('%H', t.created_at) as hour,
      COUNT(*) as total,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed
    FROM tickets t WHERE ${w} GROUP BY hour ORDER BY hour
  `).all(...params);

  const tickets = db.prepare(`
    SELECT t.*, s.name as service_name, s.prefix, s.color,
           c.number as counter_number, o.name as operator_name
    FROM tickets t
    JOIN services s ON t.service_id = s.id
    LEFT JOIN counters c ON t.counter_id = c.id
    LEFT JOIN operators o ON t.serving_operator_id = o.id
    WHERE ${w} ORDER BY t.created_at DESC LIMIT 500
  `).all(...params);

  res.json({ summary, byService, byOperator, byHour, tickets });
});

// ─── ADS ─────────────────────────────────────────────────
router.get('/ads', (req, res) => {
  const sql = req.query.all === 'true'
    ? 'SELECT * FROM media_ads ORDER BY sort_order, id'
    : 'SELECT * FROM media_ads WHERE active = 1 ORDER BY sort_order, id';
  res.json(db.prepare(sql).all());
});

router.post('/ads/upload', adsUpload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  const videoExts = ['.mp4', '.webm', '.mov'];
  const type = videoExts.includes(ext) ? 'video' : 'image';
  const url = `/img/ads/${req.file.filename}`;

  res.json({ ok: true, filename: req.file.filename, url, type });
});

router.post('/ads', (req, res) => {
  const { title, type, filename, duration, sort_order } = req.body;
  if (!title || !type || !filename) return res.status(400).json({ error: 'title, type y filename son requeridos' });

  const result = db.prepare(
    'INSERT INTO media_ads (title, type, filename, duration, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(title, type, filename, duration || 8, sort_order || 0);

  res.json(db.prepare('SELECT * FROM media_ads WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/ads/:id', (req, res) => {
  const { title, duration, sort_order, active } = req.body;
  db.prepare('UPDATE media_ads SET title=?, duration=?, sort_order=?, active=? WHERE id=?')
    .run(title, duration, sort_order, active, req.params.id);
  res.json(db.prepare('SELECT * FROM media_ads WHERE id = ?').get(req.params.id));
});

router.delete('/ads/:id', (req, res) => {
  const ad = db.prepare('SELECT * FROM media_ads WHERE id = ?').get(req.params.id);
  if (!ad) return res.status(404).json({ error: 'No encontrado' });

  // Remove file from disk
  const filePath = path.join(__dirname, '..', 'public', 'img', 'ads', ad.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM media_ads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── TTS ─────────────────────────────────────────────────
function sendTtsFile(res, filePath) {
  const ct = filePath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
  res.set('Content-Type', ct);
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
}

router.get('/tts/ticket', async (req, res) => {
  const { code, counter, lang } = req.query;
  if (!code || !counter || !['pt', 'es'].includes(lang)) {
    return res.status(400).json({ error: 'code, counter, lang (pt|es) requeridos' });
  }
  try {
    const file = await tts.getTicketAudio(code, counter, lang);
    sendTtsFile(res, file);
  } catch (e) {
    res.status(503).json({ error: 'TTS no disponible: ' + e.message });
  }
});

router.get('/tts/text', async (req, res) => {
  const { text, lang } = req.query;
  if (!text || !['pt', 'es'].includes(lang)) {
    return res.status(400).json({ error: 'text y lang (pt|es) requeridos' });
  }
  try {
    const file = await tts.getTextAudio(text, lang);
    sendTtsFile(res, file);
  } catch (e) {
    res.status(503).json({ error: 'TTS no disponible: ' + e.message });
  }
});

router.get('/tts/preview', async (req, res) => {
  const { voice, text } = req.query;
  if (!voice) return res.status(400).json({ error: 'voice requerido' });
  const sample = text || (voice.startsWith('pt-')
    ? 'Senha um dois três, dirija-se ao Caixa um'
    : 'Turno uno dos tres, diríjase a Caja uno');
  try {
    const file = await tts.synthesize(sample, voice);
    sendTtsFile(res, file);
  } catch (e) {
    res.status(503).json({ error: 'TTS no disponible: ' + e.message });
  }
});

router.get('/tts/voices', async (req, res) => {
  res.json(await tts.listVoices());
});

router.get('/tts/config', (req, res) => {
  res.json(tts.loadConfig());
});

router.get('/tts/status', (req, res) => {
  res.json(tts.getBackendStatus());
});

router.post('/tts/config', (req, res) => {
  const { ptVoice, esVoice, rate, backend, espeakPtVoice, espeakEsVoice, espeakSpeed, clearCache } = req.body || {};
  const cfg = tts.saveConfig({ ptVoice, esVoice, rate, backend, espeakPtVoice, espeakEsVoice, espeakSpeed });
  let cleared = 0;
  if (clearCache) cleared = tts.clearCache();
  res.json({ ...cfg, cleared });
});

router.post('/tts/clear-cache', (req, res) => {
  res.json({ cleared: tts.clearCache() });
});

// ─── CLEANUP ─────────────────────────────────────────────
const cleanup = require('../services/cleanup');

router.post('/cleanup/run', (req, res) => {
  const result = cleanup.runDailyCleanup();
  res.json({ ok: true, ...result });
});

// ─── HELPERS ─────────────────────────────────────────────
function getAllCounters() {
  const counters = db.prepare(`
    SELECT c.*, o.name as operator_name,
           t.code as current_ticket_code, t.status as current_ticket_status
    FROM counters c
    LEFT JOIN operators o ON c.operator_id = o.id
    LEFT JOIN tickets t ON c.current_ticket_id = t.id
    ORDER BY c.number
  `).all();
  for (const counter of counters) {
    counter.services = db.prepare(`
      SELECT s.* FROM services s
      JOIN counter_services cs ON cs.service_id = s.id
      WHERE cs.counter_id = ?
    `).all(counter.id);
  }
  return counters;
}

module.exports = router;
