const { db } = require('../database/db');
const { nowLocal } = require('./util');

let cleanupHour = 0;  // default: midnight (00:00)
let lastCleanupDate = null;
let socketEmitter = null;

function setSocketEmitter(emitter) {
  socketEmitter = emitter;
}

function setCleanupHour(hour) {
  cleanupHour = hour;
}

function runDailyCleanup() {
  const today = new Date().toISOString().slice(0, 10);
  const now   = nowLocal();

  // Mark old waiting tickets as cancelled
  const cancelled = db.prepare(`
    UPDATE tickets SET status = 'cancelled', completed_at = ?
    WHERE status = 'waiting' AND date(created_at) < date('now', 'localtime')
  `).run(now);

  // Mark old called/serving tickets as no_show
  const noShow = db.prepare(`
    UPDATE tickets SET status = 'no_show', completed_at = ?
    WHERE status IN ('called', 'serving') AND date(created_at) < date('now', 'localtime')
  `).run(now);

  // Reset counters that still have stale tickets
  db.prepare(`
    UPDATE counters SET current_ticket_id = NULL, status = 'closed', operator_id = NULL
    WHERE current_ticket_id IN (
      SELECT id FROM tickets WHERE status IN ('no_show', 'cancelled', 'completed')
    )
  `).run();

  const total = (cancelled.changes || 0) + (noShow.changes || 0);
  if (total > 0) {
    console.log(`[cleanup] ${today}: ${cancelled.changes} tickets cancelados, ${noShow.changes} marcados no-show`);
    if (socketEmitter) {
      const queue = require('./queue');
      socketEmitter.emitTicketCompleted({});
    }
  }

  lastCleanupDate = today;
  return { cancelled: cancelled.changes, noShow: noShow.changes };
}

function startScheduler() {
  // Check every minute if it's time to clean up
  setInterval(() => {
    const now  = new Date();
    const hour = now.getHours();
    const today = now.toISOString().slice(0, 10);

    if (hour === cleanupHour && lastCleanupDate !== today) {
      runDailyCleanup();
    }
  }, 60000);

  // Seed lastCleanupDate so we don't double-clean on startup
  const now = new Date();
  if (now.getHours() >= cleanupHour) {
    lastCleanupDate = now.toISOString().slice(0, 10);
  }

  // Also run cleanup immediately if there are stale tickets from previous days
  const stale = db.prepare(`
    SELECT COUNT(*) as c FROM tickets
    WHERE status IN ('waiting', 'called', 'serving') AND date(created_at) < date('now', 'localtime')
  `).get();

  if (stale.c > 0) {
    console.log(`[cleanup] Found ${stale.c} stale tickets from previous days, cleaning up...`);
    runDailyCleanup();
  }
}

module.exports = { startScheduler, setCleanupHour, setSocketEmitter, runDailyCleanup };
