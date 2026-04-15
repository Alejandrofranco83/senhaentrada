// TTS service: synthesizes Microsoft Edge neural voices to MP3 and caches on disk.
// Cache key = SHA1(voiceName + '|' + text). Once cached, no internet needed.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const CACHE_DIR  = path.join(__dirname, '..', 'data', 'tts-cache');
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'tts-config.json');

const DEFAULT_CONFIG = {
  ptVoice: 'pt-BR-FranciscaNeural',
  esVoice: 'es-MX-DaliaNeural',
  rate: '-15%'   // slower for clarity, matches old TTS rate 0.85
};

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

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

function cachePath(voice, text) {
  return path.join(CACHE_DIR, `${cacheKey(voice, text)}.mp3`);
}

function isCached(voice, text) {
  return fs.existsSync(cachePath(voice, text));
}

// Serialize synthesis: msedge-tts opens a websocket per call; running many in parallel
// can hit Microsoft's rate limits. Queue them.
let synthChain = Promise.resolve();

function synthesize(text, voice, opts = {}) {
  const file = cachePath(voice, text);
  if (fs.existsSync(file)) return Promise.resolve(file);

  const job = synthChain.then(() => doSynthesize(text, voice, file, opts));
  synthChain = job.catch(() => {});  // never break the chain
  return job;
}

async function doSynthesize(text, voice, outFile, opts) {
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

// Build the spoken sentence for a ticket call in PT or ES
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

// Fire-and-forget pre-generation when a ticket is created/called.
// Both PT and ES so by the time the call is announced, files are ready.
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

// Clear cache (useful when switching voices)
function clearCache() {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (f.endsWith('.mp3')) { fs.unlinkSync(path.join(CACHE_DIR, f)); n++; }
  }
  return n;
}

let voicesCache = null;
async function listVoices() {
  if (voicesCache) return voicesCache;
  try {
    const tts = new MsEdgeTTS();
    const all = await tts.getVoices();
    try { tts.close(); } catch (e) {}
    voicesCache = all
      .filter(v => v.Locale.startsWith('pt-BR') || v.Locale.startsWith('es-'))
      .map(v => ({
        shortName: v.ShortName,
        locale: v.Locale,
        gender: v.Gender,
        friendlyName: v.FriendlyName
      }));
    return voicesCache;
  } catch (e) {
    return [];
  }
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
  cachePath
};
