const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const CACHE_DIR   = path.join(__dirname, '..', 'data', 'tts-cache');
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'tts-config.json');
const PIPER_DIR   = path.join(__dirname, '..', 'data', 'piper');
const PIPER_BIN   = path.join(PIPER_DIR, 'piper');
const PIPER_MODELS = path.join(PIPER_DIR, 'models');

const DEFAULT_CONFIG = {
  backend: 'auto',  // 'auto' | 'msedge' | 'piper' | 'espeak'
  ptVoice: 'pt-BR-FranciscaNeural',
  esVoice: 'es-MX-DaliaNeural',
  piperPtModel: 'pt_BR-faber-medium',
  piperEsModel: 'es_MX-ald-medium',
  piperLengthScale: 1.3,  // >1 = slower (1.0=normal, 1.3=lento, 1.6=muy lento)
  espeakPtVoice: 'pt-br',
  espeakEsVoice: 'es-mx',
  rate: '-15%',
  espeakSpeed: 120
};

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── BACKEND DETECTION ───────────────────────────────────
let espeakAvailable = null;
function hasEspeak() {
  if (espeakAvailable !== null) return espeakAvailable;
  try {
    execFileSync('espeak-ng', ['--version'], { stdio: 'pipe', timeout: 3000 });
    espeakAvailable = true;
  } catch (e) {
    espeakAvailable = false;
  }
  return espeakAvailable;
}

let piperAvailable = null;
function hasPiper() {
  if (piperAvailable !== null) return piperAvailable;
  if (!fs.existsSync(PIPER_BIN)) { piperAvailable = false; return false; }
  // Check at least one model exists
  if (!fs.existsSync(PIPER_MODELS)) { piperAvailable = false; return false; }
  const models = fs.readdirSync(PIPER_MODELS).filter(f => f.endsWith('.onnx'));
  piperAvailable = models.length > 0;
  return piperAvailable;
}

function getPiperModels() {
  if (!fs.existsSync(PIPER_MODELS)) return [];
  return fs.readdirSync(PIPER_MODELS)
    .filter(f => f.endsWith('.onnx'))
    .map(f => f.replace('.onnx', ''));
}

// ─── CONFIG ──────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (e) {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  const merged = { ...loadConfig(), ...cfg };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

// ─── CACHE ───────────────────────────────────────────────
function cacheKey(voice, text) {
  return crypto.createHash('sha1').update(`${voice}|${text}`).digest('hex');
}

function findCachedFile(voice, text) {
  const hash = cacheKey(voice, text);
  for (const ext of ['.mp3', '.wav']) {
    const p = path.join(CACHE_DIR, `${hash}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isCached(voice, text) {
  return findCachedFile(voice, text) !== null;
}

// ─── SYNTHESIS QUEUE ─────────────────────────────────────
let synthChain = Promise.resolve();

function synthesize(text, voice, opts = {}) {
  const cached = findCachedFile(voice, text);
  if (cached) return Promise.resolve(cached);

  const job = synthChain.then(() => doSynthesize(text, voice, opts));
  synthChain = job.catch(() => {});
  return job;
}

function pickBackend() {
  const cfg = loadConfig();
  if (cfg.backend !== 'auto') return cfg.backend;
  return 'auto';
}

async function doSynthesize(text, voice, opts) {
  const hash = cacheKey(voice, text);
  const backend = pickBackend();

  // Explicit backend
  if (backend === 'msedge') return doSynthesizeMsEdge(text, voice, hash, opts);
  if (backend === 'piper')  return doSynthesizePiper(text, voice, hash, opts);
  if (backend === 'espeak') return doSynthesizeEspeak(text, voice, hash, opts);

  // Auto: try msedge → piper → espeak
  try {
    return await doSynthesizeMsEdge(text, voice, hash, opts);
  } catch (e) {
    console.log(`[tts] msedge failed (${e.message}), trying piper...`);
  }

  if (hasPiper()) {
    try {
      return await doSynthesizePiper(text, voice, hash, opts);
    } catch (e) {
      console.log(`[tts] piper failed (${e.message}), trying espeak-ng...`);
    }
  }

  if (hasEspeak()) {
    return doSynthesizeEspeak(text, voice, hash, opts);
  }

  throw new Error('TTS no disponible: ningún backend funciona. Instalar piper (bash scripts/setup-piper.sh) o espeak-ng (sudo dnf install espeak-ng)');
}

// ─── MSEDGE BACKEND ──────────────────────────────────────
async function doSynthesizeMsEdge(text, voice, hash, opts) {
  const outFile = path.join(CACHE_DIR, `${hash}.mp3`);
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate: opts.rate || loadConfig().rate });

    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', resolve);
      audioStream.on('error', reject);
      setTimeout(() => reject(new Error('TTS timeout')), 15000);
    });

    const buf = Buffer.concat(chunks);
    if (buf.length === 0) throw new Error('TTS returned empty audio');
    fs.writeFileSync(outFile, buf);
    return outFile;
  } finally {
    try { tts.close(); } catch (e) {}
  }
}

// ─── PIPER BACKEND ───────────────────────────────────────
function doSynthesizePiper(text, voice, hash, opts) {
  if (!hasPiper()) throw new Error('Piper no instalado. Ejecutar: bash scripts/setup-piper.sh');

  const outFile = path.join(CACHE_DIR, `${hash}.wav`);
  const cfg = loadConfig();

  // Resolve model: use configured model, or pick by language from voice name
  let modelName;
  if (voice.startsWith('pt')) modelName = cfg.piperPtModel || 'pt_BR-faber-medium';
  else modelName = cfg.piperEsModel || 'es_MX-ald-medium';

  const modelPath = path.join(PIPER_MODELS, `${modelName}.onnx`);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Piper model not found: ${modelName}.onnx`);
  }

  const lengthScale = String(cfg.piperLengthScale || 1.3);

  return new Promise((resolve, reject) => {
    const proc = execFile(PIPER_BIN, [
      '--model', modelPath,
      '--length_scale', lengthScale,
      '--output_file', outFile
    ], { timeout: 15000, env: { ...process.env, LD_LIBRARY_PATH: PIPER_DIR } }, (err) => {
      if (err) return reject(new Error('piper failed: ' + err.message));
      if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
        return reject(new Error('piper produced no audio'));
      }
      resolve(outFile);
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });
}

// ─── ESPEAK BACKEND ──────────────────────────────────────
function doSynthesizeEspeak(text, voice, hash, opts) {
  if (!hasEspeak()) throw new Error('espeak-ng no instalado. Ejecutar: sudo dnf install espeak-ng');

  const outFile = path.join(CACHE_DIR, `${hash}.wav`);
  const cfg = loadConfig();

  let espeakVoice;
  if (voice.startsWith('pt')) espeakVoice = cfg.espeakPtVoice || 'pt-br';
  else espeakVoice = cfg.espeakEsVoice || 'es-mx';

  const speed = String(cfg.espeakSpeed || 130);

  return new Promise((resolve, reject) => {
    execFile('espeak-ng', [
      '-v', espeakVoice,
      '-s', speed,
      '-w', outFile,
      text
    ], { timeout: 10000 }, (err) => {
      if (err) return reject(new Error('espeak-ng failed: ' + err.message));
      if (!fs.existsSync(outFile)) return reject(new Error('espeak-ng produced no file'));
      resolve(outFile);
    });
  });
}

// ─── TICKET SENTENCES ────────────────────────────────────
const ES_DIGITS = {'0':'cero','1':'uno','2':'dos','3':'tres','4':'cuatro','5':'cinco','6':'seis','7':'siete','8':'ocho','9':'nueve'};
const PT_DIGITS = {'0':'zero','1':'um','2':'dois','3':'três','4':'quatro','5':'cinco','6':'seis','7':'sete','8':'oito','9':'nove'};

// Spell out prefix letters so TTS pronounces them naturally
const ES_LETTERS = {
  'A':'a','B':'be','C':'ce','D':'de','E':'e','F':'efe','G':'ge','H':'hache',
  'I':'i','J':'jota','K':'ka','L':'ele','M':'eme','N':'ene','O':'o','P':'pe',
  'Q':'cu','R':'erre','S':'ese','T':'te','U':'u','V':'uve','W':'doble uve',
  'X':'equis','Y':'ye','Z':'zeta'
};
const PT_LETTERS = {
  'A':'a','B':'bê','C':'cê','D':'dê','E':'e','F':'éfe','G':'gê','H':'agá',
  'I':'i','J':'jota','K':'cá','L':'éle','M':'eme','N':'ene','O':'o','P':'pê',
  'Q':'quê','R':'érre','S':'ésse','T':'tê','U':'u','V':'vê','W':'dáblio',
  'X':'xis','Y':'ípsilon','Z':'zê'
};

function ticketSentence(code, counter, lang) {
  const digits  = lang === 'pt' ? PT_DIGITS : ES_DIGITS;
  const letters = lang === 'pt' ? PT_LETTERS : ES_LETTERS;

  const chars = String(code).split('');
  const parts = [];
  for (const c of chars) {
    if (digits[c]) parts.push(digits[c]);
    else if (letters[c.toUpperCase()]) parts.push(letters[c.toUpperCase()]);
    else parts.push(c);
  }

  // Join with comma between prefix letter(s) and digits for a clear pause
  const firstDigit = chars.findIndex(c => /\d/.test(c));
  let spoken;
  if (firstDigit > 0) {
    const letterPart = parts.slice(0, firstDigit).join(' ');
    const digitPart  = parts.slice(firstDigit).join(', ');
    spoken = `${letterPart}, ${digitPart}`;
  } else {
    spoken = parts.join(', ');
  }

  if (lang === 'pt') return `Senha ${spoken}, dirija-se ao Caixa ${counter}`;
  return `Turno ${spoken}, diríjase a Caja ${counter}`;
}

function getTicketCacheStatus(code, counter) {
  const cfg = loadConfig();
  return {
    pt: isCached(cfg.ptVoice, ticketSentence(code, counter, 'pt')),
    es: isCached(cfg.esVoice, ticketSentence(code, counter, 'es'))
  };
}

function preGenerateTicket(code, counter) {
  const cfg = loadConfig();
  for (const lang of ['pt', 'es']) {
    const voice = lang === 'pt' ? cfg.ptVoice : cfg.esVoice;
    const text  = ticketSentence(code, counter, lang);
    if (isCached(voice, text)) continue;
    synthesize(text, voice).catch((e) => {
      console.error(`[tts] pre-gen failed for "${text}":`, e.message);
    });
  }
}

function getTicketAudio(code, counter, lang) {
  const cfg   = loadConfig();
  const voice = lang === 'pt' ? cfg.ptVoice : cfg.esVoice;
  return synthesize(ticketSentence(code, counter, lang), voice);
}

function getTextAudio(text, lang) {
  const cfg   = loadConfig();
  const voice = lang === 'pt' ? cfg.ptVoice : cfg.esVoice;
  return synthesize(text, voice);
}

// ─── CACHE MANAGEMENT ────────────────────────────────────
function clearCache() {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (f.endsWith('.mp3') || f.endsWith('.wav')) {
      fs.unlinkSync(path.join(CACHE_DIR, f));
      n++;
    }
  }
  return n;
}

// ─── VOICE LIST ──────────────────────────────────────────
let voicesCache = null;
async function listVoices() {
  if (voicesCache) return voicesCache;

  const voices = [];

  // msedge voices
  try {
    const tts = new MsEdgeTTS();
    const all = await tts.getVoices();
    try { tts.close(); } catch (e) {}
    for (const v of all) {
      if (v.Locale.startsWith('pt-BR') || v.Locale.startsWith('es-')) {
        voices.push({
          shortName: v.ShortName,
          locale: v.Locale,
          gender: v.Gender,
          friendlyName: v.FriendlyName,
          backend: 'msedge'
        });
      }
    }
  } catch (e) {
    console.log('[tts] Could not fetch msedge voices:', e.message);
  }

  // Piper voices (from installed models)
  if (hasPiper()) {
    for (const model of getPiperModels()) {
      const locale = model.startsWith('pt_BR') ? 'pt-BR' : model.startsWith('es_MX') ? 'es-MX' : model.startsWith('es_') ? 'es' : model.split('-')[0].replace('_', '-');
      voices.push({
        shortName: `piper:${model}`,
        locale: locale,
        gender: 'Neural',
        friendlyName: `Piper — ${model}`,
        backend: 'piper'
      });
    }
  }

  // espeak-ng voices
  if (hasEspeak()) {
    voices.push(
      { shortName: 'pt-br', locale: 'pt-BR', gender: 'Male', friendlyName: 'espeak-ng Português BR', backend: 'espeak' },
      { shortName: 'pt-br+f2', locale: 'pt-BR', gender: 'Female', friendlyName: 'espeak-ng Português BR (fem)', backend: 'espeak' },
      { shortName: 'es-mx', locale: 'es-MX', gender: 'Male', friendlyName: 'espeak-ng Español MX', backend: 'espeak' },
      { shortName: 'es', locale: 'es', gender: 'Male', friendlyName: 'espeak-ng Español', backend: 'espeak' },
      { shortName: 'es+f2', locale: 'es', gender: 'Female', friendlyName: 'espeak-ng Español (fem)', backend: 'espeak' }
    );
  }

  if (voices.length > 0) voicesCache = voices;
  return voices;
}

function getBackendStatus() {
  return {
    espeakAvailable: hasEspeak(),
    piperAvailable: hasPiper(),
    piperModels: getPiperModels(),
    backend: loadConfig().backend || 'auto'
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  synthesize,
  preGenerateTicket,
  getTicketAudio,
  getTextAudio,
  getTicketCacheStatus,
  ticketSentence,
  clearCache,
  listVoices,
  isCached,
  findCachedFile,
  getBackendStatus
};
