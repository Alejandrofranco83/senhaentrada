const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const queue = require('../services/queue');
const { printTicket } = require('../services/printer');

// Socket emitter gets injected from server.js
let socketEmitter = null;
router.setSocketEmitter = function (emitter) {
  socketEmitter = emitter;
};

// ─── SERVICES ────────────────────────────────────────────
router.get('/services', (req, res) => {
  const services = db.prepare(
    'SELECT * FROM services WHERE active = 1 ORDER BY sort_order'
  ).all();
  res.json(services);
});

router.post('/services', (req, res) => {
  const { name, name_pt, prefix, icon, color, priority, is_specific, sort_order } = req.body;
  const result = db.prepare(
    'INSERT INTO services (name, name_pt, prefix, icon, color, priority, is_specific, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, name_pt, prefix, icon, color, priority || 1, is_specific || 0, sort_order || 0);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/services/:id', (req, res) => {
  const { name, name_pt, prefix, icon, color, priority, is_specific, sort_order, active } = req.body;
  db.prepare(`
    UPDATE services SET name=?, name_pt=?, prefix=?, icon=?, color=?, priority=?, is_specific=?, sort_order=?, active=?
    WHERE id=?
  `).run(name, name_pt, prefix, icon, color, priority, is_specific, sort_order, active, req.params.id);
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
    SELECT o.id, o.name, c.id as counter_id, c.name as counter_name, c.number as counter_number
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
