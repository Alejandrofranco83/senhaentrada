const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'senhaentrada.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);

// Seed default data if empty
function seedDefaults(config) {
  const branchCount = db.prepare('SELECT COUNT(*) as c FROM branch').get().c;
  if (branchCount === 0) {
    db.prepare('INSERT INTO branch (name, code) VALUES (?, ?)').run(
      config.branch.name,
      config.branch.code
    );
  }

  const serviceCount = db.prepare('SELECT COUNT(*) as c FROM services').get().c;
  if (serviceCount === 0) {
    const insert = db.prepare(
      'INSERT INTO services (name, name_pt, prefix, icon, color, priority, is_specific, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insert.run('Farmacia General', 'Farmácia Geral', 'F', '🏥', '#4CAF50', 1, 0, 1);
    insert.run('Telefonía y Servicios', 'Telefonia e Serviços', 'T', '📱', '#2196F3', 1, 0, 2);
    insert.run('Retirada de Mercadería', 'Retirada de Mercadoria', 'M', '📦', '#FF9800', 2, 0, 3);
    insert.run('Elegir Atendiente', 'Escolher Atendente', 'E', '👤', '#9C27B0', 1, 1, 4);
  }

  const counterCount = db.prepare('SELECT COUNT(*) as c FROM counters').get().c;
  if (counterCount === 0) {
    const insert = db.prepare('INSERT INTO counters (name, number) VALUES (?, ?)');
    for (let i = 1; i <= 6; i++) {
      insert.run(`Caja ${i}`, i);
    }

    // Assign all non-specific services to all counters
    const services = db.prepare('SELECT id FROM services WHERE is_specific = 0').all();
    const counters = db.prepare('SELECT id FROM counters').all();
    const assignService = db.prepare('INSERT INTO counter_services (counter_id, service_id) VALUES (?, ?)');
    for (const counter of counters) {
      for (const service of services) {
        assignService.run(counter.id, service.id);
      }
    }
  }

  const operatorCount = db.prepare('SELECT COUNT(*) as c FROM operators').get().c;
  if (operatorCount === 0) {
    const insert = db.prepare('INSERT INTO operators (name) VALUES (?)');
    insert.run('Operador 1');
    insert.run('Operador 2');
    insert.run('Operador 3');
    insert.run('Operador 4');
    insert.run('Operador 5');
    insert.run('Operador 6');
  }
}

module.exports = { db, seedDefaults };
