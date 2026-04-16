const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const CACHE_DIR   = path.join(__dirname, '..', 'data', 'tts-cache');
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'tts-config.json');

// espeak-ng voice mappings
const ESPEAK_VOICES = { pt: 'pt-br', es: 'es-mx' };

const DEFAULT_CONFIG = {
  backend: 'auto',  // 'auto' | 'msedge' | 'espeak'
  ptVoice: 'pt-BR-FranciscaNeural',
  esVoice: 'es-MX-DaliaNeural',
  espeakPtVoice: 'pt-br',
  espeakEsVoice: 'es-mx',
  rate: '-15%',
  espeakSpeed: 130   // words per minute (default ~175, lower = slower)
};

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Detect espeak-ng availability
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

function cacheKey(voice, text) {
  return crypto.createHash('sha1').update(`${voice}|${text}`).digest('hex');
}

// Returns path with .mp3 or .wav depending on what exists
function findCachedFile(voice, text) {
  const hash = cacheKey(voice, text);
  const mp3 = path.join(CACHE_DIR, `${hash}.mp3`);
  if (fs.existsSync(mp3)) return mp3;
  const wav = path.join(CACHE_DIR, `${hash}.wav`);
  if (fs.existsSync(wav)) return wav;
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
  if (cfg.backend === 'msedge') return 'msedge';
  if (cfg.backend === 'espeak') return 'espeak';
  // 'auto': try msedge, fallback to espeak
  return 'auto';
}

async function doSynthesize(text, voice, opts) {
  const hash = cacheKey(voice, text);
  const backend = pickBackend();

  if (backend === 'msedge' || backend === 'auto') {
    try {
      return await doSynthesizeMsEdge(text, voice, hash, opts);
    } catch (e) {
      if (backend === 'msedge') throw e;
      console.log(`[tts] msedge failed (${e.message}), falling back to espeak-ng`);
    }
  }

  // espeak-ng fallback
  if (!hasEspeak()) {
    throw new Error('TTS no disponible: msedge falló y espeak-ng no está instalado. Instalar: sudo dnf install espeak-ng');
  }
  return doSynthesizeEspeak(text, voice, hash, opts);
}

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

function doSynthesizeEspeak(text, voice, hash, opts) {
  const outFile = path.join(CACHE_DIR, `${hash}.wav`);
  const cfg = loadConfig();

  // Map msedge voice names to espeak voices
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
function ticketSentence(code, counter, lang) {
  const esNames = {'0':'cero','1':'uno','2':'dos','3':'tres','4':'cuatro','5':'cinco','6':'seis','7':'siete','8':'ocho','9':'nueve'};
  const ptNames = {'0':'zero','1':'um','2':'dois','3':'três','4':'quatro','5':'cinco','6':'seis','7':'sete','8':'oito','9':'nove'};
  const names = lang === 'pt' ? ptNames : esNames;
  const spoken = String(code).split('').map(c => names[c] || c).join(' ');
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

let voicesCache = null;
async function listVoices() {
  if (voicesCache) return voicesCache;

  const voices = [];

  // Try msedge voices
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

  // Add espeak voices if available
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
