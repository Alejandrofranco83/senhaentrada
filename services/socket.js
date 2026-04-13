const queue = require('./queue');

function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Send initial state on connection
    socket.emit('queue:stats', queue.getQueueStats());
    socket.emit('tickets:active', queue.getActiveTickets());
    socket.emit('tickets:waiting', queue.getWaitingTickets());

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  return {
    emitTicketCreated(ticket) {
      io.emit('ticket:created', ticket);
      io.emit('queue:stats', queue.getQueueStats());
      io.emit('tickets:waiting', queue.getWaitingTickets());
    },

    emitTicketCalled(ticket) {
      io.emit('ticket:called', ticket);
      io.emit('queue:stats', queue.getQueueStats());
      io.emit('tickets:active', queue.getActiveTickets());
      io.emit('tickets:waiting', queue.getWaitingTickets());
    },

    emitTicketRecalled(ticket) {
      io.emit('ticket:recalled', ticket);
    },

    emitTicketCompleted(ticket) {
      io.emit('ticket:completed', ticket);
      io.emit('queue:stats', queue.getQueueStats());
      io.emit('tickets:active', queue.getActiveTickets());
    },

    emitTicketNoShow(ticket) {
      io.emit('ticket:no-show', ticket);
      io.emit('queue:stats', queue.getQueueStats());
      io.emit('tickets:active', queue.getActiveTickets());
    },

    emitCounterUpdated(counters) {
      io.emit('counter:updated', counters);
    },

    emitAnnouncementPlay(data) {
      io.emit('announcement:play', data);
    }
  };
}

module.exports = { setupSocket };
