const fs = require('fs');
const path = require('path');

const defaults = require('./default.json');

const localPath = path.join(__dirname, 'local.json');
let local = {};
if (fs.existsSync(localPath)) {
  try {
    local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  } catch (err) {
    console.error('[config] No se pudo leer config/local.json:', err.message);
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const key of Object.keys(override)) {
    if (isPlainObject(base[key]) && isPlainObject(override[key])) {
      out[key] = deepMerge(base[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

module.exports = deepMerge(defaults, local);
