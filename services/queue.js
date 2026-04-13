const { db } = require('../database/db');

/**
 * Generate the next ticket code for a service (e.g., "F001")
 */
function generateTicketCode(serviceId) {
  const service = db.prepare('SELECT prefix FROM services WHERE id = ?').get(serviceId);
  if (!service) throw new Error('Service not found');

  const today = new Date().toISOString().slice(0, 10);

  // Upsert daily sequence
  db.prepare(`
    INSERT INTO daily_sequence (service_id, date, last_number)
    VALUES (?, ?, 1)
    ON CONFLICT(service_id, date)
    DO UPDATE SET last_number = last_number + 1
  `).run(serviceId, today);

  const seq = db.prepare(
    'SELECT last_number FROM daily_sequence WHERE service_id = ? AND date = ?'
  ).get(serviceId, today);

  return `${service.prefix}${String(seq.last_number).padStart(3, '0')}`;
}

/**
 * Create a new ticket
 */
function createTicket(serviceId, requestedOperatorId = null) {
  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(serviceId);
  if (!service) throw new Error('Service not found or inactive');

  const code = generateTicketCode(serviceId);
  const priority = service.priority;

  const result = db.prepare(`
    INSERT INTO tickets (code, service_id, requested_operator_id, priority, status)
    VALUES (?, ?, ?, ?, 'waiting')
  `).run(code, serviceId, requestedOperatorId, priority);

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);

  // Count waiting ahead
  const waitingAhead = db.prepare(`
    SELECT COUNT(*) as c FROM tickets
    WHERE status = 'waiting' AND id < ?
  `).get(ticket.id).c;

  // If operator was requested, fetch their name for the printed ticket
  let requestedOperator = null;
  if (requestedOperatorId) {
    requestedOperator = db.prepare('SELECT name FROM operators WHERE id = ?').get(requestedOperatorId);
  }

  return { ...ticket, waitingAhead, service, requestedOperator };
}

/**
 * Get the next ticket for a counter (core assignment logic)
 */
function getNextTicket(counterId) {
  const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(counterId);
  if (!counter) throw new Error('Counter not found');
  if (counter.status === 'paused') return null;
  if (counter.status === 'closed') throw new Error('Counter is closed');

  const operatorId = counter.operator_id;

  // Get services this counter handles
  const serviceIds = db.prepare(
    'SELECT service_id FROM counter_services WHERE counter_id = ?'
  ).all(counterId).map(r => r.service_id);

  if (serviceIds.length === 0 && !operatorId) return null;

  // Build query: tickets requesting THIS operator OR normal tickets for this counter's services
  const placeholders = serviceIds.map(() => '?').join(',');

  let query, params;
  if (operatorId && serviceIds.length > 0) {
    query = `
      SELECT * FROM tickets
      WHERE status = 'waiting'
        AND (
          (requested_operator_id = ?)
          OR
          (requested_operator_id IS NULL AND service_id IN (${placeholders}))
        )
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `;
    params = [operatorId, ...serviceIds];
  } else if (operatorId) {
    query = `
      SELECT * FROM tickets
      WHERE status = 'waiting' AND requested_operator_id = ?
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `;
    params = [operatorId];
  } else {
    query = `
      SELECT * FROM tickets
      WHERE status = 'waiting'
        AND requested_operator_id IS NULL
        AND service_id IN (${placeholders})
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `;
    params = [...serviceIds];
  }

  return db.prepare(query).get(...params) || null;
}

/**
 * Call the next ticket for a counter
 */
function callNextTicket(counterId) {
  const ticket = getNextTicket(counterId);
  if (!ticket) return null;

  const counter = db.prepare('SELECT * FROM counters WHERE id = ?').get(counterId);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`
    UPDATE tickets SET status = 'called', counter_id = ?, called_at = ?, serving_operator_id = ? WHERE id = ?
  `).run(counterId, now, counter.operator_id || null, ticket.id);

  db.prepare(`
    UPDATE counters SET current_ticket_id = ?, status = 'busy' WHERE id = ?
  `).run(ticket.id, counterId);

  const updated = db.prepare(`
    SELECT t.*, s.name as service_name, s.name_pt as service_name_pt, s.prefix,
           c.name as counter_name, c.number as counter_number
    FROM tickets t
    JOIN services s ON t.service_id = s.id
    JOIN counters c ON t.counter_id = c.id
    WHERE t.id = ?
  `).get(ticket.id);

  return updated;
}

/**
 * Complete the current ticket
 */
function completeTicket(ticketId) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  db.prepare(`
    UPDATE tickets SET status = 'completed', completed_at = ? WHERE id = ?
  `).run(now, ticketId);

  if (ticket.counter_id) {
    db.prepare(`
      UPDATE counters SET current_ticket_id = NULL, status = 'open' WHERE id = ?
    `).run(ticket.counter_id);
  }

  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
}

/**
 * Mark ticket as no-show
 */
function noShowTicket(ticketId) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  db.prepare(`
    UPDATE tickets SET status = 'no_show', completed_at = ? WHERE id = ?
  `).run(now, ticketId);

  if (ticket.counter_id) {
    db.prepare(`
      UPDATE counters SET current_ticket_id = NULL, status = 'open' WHERE id = ?
    `).run(ticket.counter_id);
  }

  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
}

/**
 * Cancel a ticket
 */
function cancelTicket(ticketId) {
  db.prepare(`UPDATE tickets SET status = 'cancelled' WHERE id = ?`).run(ticketId);
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
}

/**
 * Get waiting tickets
 */
function getWaitingTickets() {
  return db.prepare(`
    SELECT t.*, s.name as service_name, s.name_pt as service_name_pt, s.prefix, s.color, s.icon
    FROM tickets t
    JOIN services s ON t.service_id = s.id
    WHERE t.status = 'waiting'
    ORDER BY t.priority DESC, t.created_at ASC
  `).all();
}

/**
 * Get active tickets (called/serving)
 */
function getActiveTickets() {
  return db.prepare(`
    SELECT t.*, s.name as service_name, s.name_pt as service_name_pt, s.prefix, s.color,
           c.name as counter_name, c.number as counter_number
    FROM tickets t
    JOIN services s ON t.service_id = s.id
    LEFT JOIN counters c ON t.counter_id = c.id
    WHERE t.status IN ('called', 'serving')
    ORDER BY t.called_at DESC
  `).all();
}

/**
 * Get queue stats
 */
function getQueueStats() {
  const waiting = db.prepare(`
    SELECT s.id, s.name, s.name_pt, s.prefix, s.color, s.icon, COUNT(t.id) as count
    FROM services s
    LEFT JOIN tickets t ON s.id = t.service_id AND t.status = 'waiting'
    WHERE s.active = 1 AND s.is_specific = 0
    GROUP BY s.id
    ORDER BY s.sort_order
  `).all();

  const totalWaiting = db.prepare(
    "SELECT COUNT(*) as c FROM tickets WHERE status = 'waiting'"
  ).get().c;

  const todayCompleted = db.prepare(`
    SELECT COUNT(*) as c FROM tickets
    WHERE status = 'completed' AND date(created_at) = date('now', 'localtime')
  `).get().c;

  const avgWaitTime = db.prepare(`
    SELECT AVG((julianday(called_at) - julianday(created_at)) * 1440) as avg_minutes
    FROM tickets
    WHERE status IN ('completed', 'called', 'serving')
      AND called_at IS NOT NULL
      AND date(created_at) = date('now', 'localtime')
  `).get().avg_minutes || 0;

  return { waiting, totalWaiting, todayCompleted, avgWaitTime: Math.round(avgWaitTime) };
}

/**
 * Get today's stats for admin
 */
function getTodayStats() {
  const byService = db.prepare(`
    SELECT s.name, s.name_pt, s.prefix, s.color,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN t.status = 'waiting' THEN 1 END) as waiting,
      COUNT(CASE WHEN t.status = 'no_show' THEN 1 END) as no_show,
      COUNT(CASE WHEN t.status = 'cancelled' THEN 1 END) as cancelled,
      AVG(CASE WHEN t.called_at IS NOT NULL THEN (julianday(t.called_at) - julianday(t.created_at)) * 1440 END) as avg_wait
    FROM services s
    LEFT JOIN tickets t ON s.id = t.service_id AND date(t.created_at) = date('now', 'localtime')
    WHERE s.active = 1
    GROUP BY s.id
    ORDER BY s.sort_order
  `).all();

  const total = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'waiting' THEN 1 END) as waiting,
      COUNT(CASE WHEN status IN ('called','serving') THEN 1 END) as active,
      COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_show
    FROM tickets
    WHERE date(created_at) = date('now', 'localtime')
  `).get();

  return { byService, total };
}

module.exports = {
  createTicket,
  callNextTicket,
  completeTicket,
  noShowTicket,
  cancelTicket,
  getNextTicket,
  getWaitingTickets,
  getActiveTickets,
  getQueueStats,
  getTodayStats
};
