-- Información de la sucursal
CREATE TABLE IF NOT EXISTS branch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE
);

-- Tipos de servicio
CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_pt TEXT,
    prefix TEXT NOT NULL UNIQUE,
    icon TEXT,
    color TEXT,
    priority INTEGER DEFAULT 1,
    is_specific INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
);

-- Operadores/atendientes
CREATE TABLE IF NOT EXISTS operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    pin TEXT,
    photo TEXT,
    active INTEGER DEFAULT 1
);

-- Cajas/counters
CREATE TABLE IF NOT EXISTS counters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    number INTEGER NOT NULL,
    status TEXT DEFAULT 'closed',
    operator_id INTEGER,
    current_ticket_id INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (current_ticket_id) REFERENCES tickets(id)
);

-- Servicios por caja (N:M)
CREATE TABLE IF NOT EXISTS counter_services (
    counter_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    PRIMARY KEY (counter_id, service_id),
    FOREIGN KEY (counter_id) REFERENCES counters(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
);

-- Tickets/turnos
CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    service_id INTEGER NOT NULL,
    counter_id INTEGER,
    requested_operator_id INTEGER,
    status TEXT DEFAULT 'waiting',
    priority INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    called_at DATETIME,
    serving_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (service_id) REFERENCES services(id),
    FOREIGN KEY (counter_id) REFERENCES counters(id),
    FOREIGN KEY (requested_operator_id) REFERENCES operators(id)
);

-- Contadores diarios (reinicio automático)
CREATE TABLE IF NOT EXISTS daily_sequence (
    service_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    last_number INTEGER DEFAULT 0,
    PRIMARY KEY (service_id, date),
    FOREIGN KEY (service_id) REFERENCES services(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_service_status ON tickets(service_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
