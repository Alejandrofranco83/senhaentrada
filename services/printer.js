const config = require('../config/default.json');
const i18n = require('../config/i18n.json');

/**
 * Print a ticket via ESC/POS network printer.
 * Falls back to console simulation if printer is disabled or unavailable.
 */
async function printTicket(ticket) {
  const { code, service, waitingAhead } = ticket;
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit'
  });

  if (!config.printer.enabled) {
    // Simulation mode
    console.log('\n╔══════════════════════════════╗');
    console.log('║    TURNO / SENHA             ║');
    console.log('║                              ║');
    console.log(`║    >>> ${code} <<<`.padEnd(31) + '║');
    console.log('║                              ║');
    console.log(`║  ${service.name}`.padEnd(31) + '║');
    console.log(`║  ${service.name_pt || ''}`.padEnd(31) + '║');
    console.log(`║  ${dateStr} ${timeStr}`.padEnd(31) + '║');
    console.log(`║  Espera/Espera: ${waitingAhead} personas`.padEnd(31) + '║');
    console.log('║                              ║');
    console.log('║  Gracias por su espera       ║');
    console.log('║  Obrigado pela espera        ║');
    console.log('╚══════════════════════════════╝\n');
    return true;
  }

  try {
    const escpos = require('escpos');
    const Network = require('escpos-network');

    const device = new Network(config.printer.ip, config.printer.port);
    const printer = new escpos.Printer(device);

    return new Promise((resolve, reject) => {
      device.open((err) => {
        if (err) {
          console.error('Printer connection error:', err.message);
          console.log('[FALLBACK] Printing to console instead');
          resolve(false);
          return;
        }

        printer
          .align('ct')
          .style('b')
          .size(1, 1)
          .text(config.branch.name)
          .text('')
          .text('TURNO / SENHA')
          .text('')
          .size(2, 2)
          .text(code)
          .size(1, 1)
          .text('')
          .text(`${service.name}`)
          .text(`${service.name_pt || ''}`)
          .text('')
          .align('lt')
          .text(`Fecha/Data: ${dateStr} ${timeStr}`)
          .text(`Espera: ${waitingAhead} personas/pessoas`)
          .text('')
          .align('ct')
          .text('Gracias por su espera')
          .text('Obrigado pela espera')
          .feed(5)
          .cut()
          .close(() => resolve(true));
      });
    });
  } catch (err) {
    console.error('Printer error:', err.message);
    return false;
  }
}

module.exports = { printTicket };
