const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config/default.json');
const { seedDefaults } = require('./database/db');
const { setupSocket } = require('./services/socket');
const apiRoutes = require('./routes/api');
const pageRoutes = require('./routes/pages');
const cleanup = require('./services/cleanup');

// Initialize
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/audio', express.static(path.join(__dirname, 'public', 'audio')));

// Serve socket.io client
app.get('/socket.io/socket.io.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.min.js'));
});

// Serve i18n config to frontend
app.get('/config/i18n.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'config', 'i18n.json'));
});

app.get('/config/default.json', (req, res) => {
  // Only expose safe config values to frontend
  res.json({
    branch: config.branch,
    display: config.display,
    kiosk: config.kiosk
  });
});

// Setup Socket.IO
const socketEmitter = setupSocket(io);

// Routes
apiRoutes.setSocketEmitter(socketEmitter);
app.use('/api', apiRoutes);
app.use('/', pageRoutes);

// Seed default data
seedDefaults(config);

// Daily cleanup scheduler — clears stale tickets at configured hour
cleanup.setSocketEmitter(socketEmitter);
cleanup.setCleanupHour(config.cleanup?.hour ?? 0);  // default: midnight
cleanup.startScheduler();

// Start server
const PORT = config.port || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       SISTEMA DE TURNOS / SISTEMA DE SENHAS      ║');
  console.log('║                                                  ║');
  console.log(`║  Sucursal: ${config.branch.name.padEnd(37)}║`);
  console.log(`║  Puerto: ${String(PORT).padEnd(39)}║`);
  console.log('║                                                  ║');
  console.log('║  Pantallas / Telas:                              ║');
  console.log(`║    Kiosko:   http://localhost:${PORT}/kiosk`.padEnd(51) + '║');
  console.log(`║    Display:  http://localhost:${PORT}/display`.padEnd(51) + '║');
  console.log(`║    Operador: http://localhost:${PORT}/operator`.padEnd(51) + '║');
  console.log(`║    Admin:    http://localhost:${PORT}/admin`.padEnd(51) + '║');
  console.log('║                                                  ║');
  console.log(`║  Impresora: ${config.printer.enabled ? 'ACTIVA (' + config.printer.ip + ')' : 'SIMULACIÓN (consola)'}`.padEnd(51) + '║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
