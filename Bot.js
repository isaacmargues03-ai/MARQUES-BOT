/**
 * MARQUES BOT - WhatsApp Bot com Baileys
 *
 * Versão com correções e novas features:
 * - /fcamp cancelar (ou /camp cancelar) -> cancela o camp atual no grupo
 * - /auto <hora> <texto> -> agenda mensagem diária citando todos do grupo na hora especificada (ex: /auto 20:30 Bom dia!)
 * - /auto off -> desativa o agendamento para o grupo
 * - /jogodavelhaia: IA joga automaticamente contra o player mesmo quando o player usa mensagem numérica (1-9). Não precisa usar /jogo.
 *
 * Autenticacao persistida em pasta `auth_marques`
 *
 * Observação: /auto só funciona em grupos e só administradores/dono do bot podem configurar.
 *
 * Alterações nesta versão:
 * - Implementado /casar, /divorcio, /dupla (com proposta e aceitação via "aceito")
 * - Implementado /setprefix (também /set-prefix e /prefix) para configurar prefixo por grupo
 * - Prefixo por grupo é armazenado em db.prefixes (cada grupo pode ter seu próprio prefixo)
 * - Parser de comandos atualizado para reconhecer prefixo do grupo ou '/' como fallback
 * - Adicionado /r-camp @player -> remove pessoa da lista do camp (apenas admins)
 *
 * NOVA ATUALIZAÇÃO:
 * - /addregra <texto> -> Adiciona regra relacionada ao camp do grupo (apenas admins). A regra será exibida abaixo dos confrontos quando a lista for completa.
 * - Quando a lista do /camp completa e os confrontos são publicados, o bot cria um estado com os confrontos.
 *   O primeiro jogador que digitar "cria" para o seu confronto será registrado como "primeiro a falar".
 *   Ao detectar esse "cria", o bot enviará:
 *     "@<quem falou> falou cria primeiro entao o @<adversario> vai cria a sala"
 *   Esse "cria" só vale para o confronto do jogador e apenas a primeira ocorrência por confronto é considerada.
 *
 * NOVA FEATURE SOLICITADA:
 * - Sistema de continuidade do /camp: quando um jogador digita "GANHEI" (sem barra), o bot registra o vencedor do confronto,
 *   atualiza a classificação e, assim que todos os confrontos da fase atual forem finalizados, automaticamente gera a próxima fase
 *   (16 -> 8 -> 4 -> 2 -> Final), anunciando os novos confrontos e lidando com byes (avanco automático em caso de número ímpar).
 *
 * Observação: regras do /addregra são armazenadas dentro de db.camps[grupo].regra
 */

const {
  default: makeWASocket,
  useMultiFileAuthState: makeAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const os = require("os");
const sharp = require("sharp");
const readline = require("readline");
const { execFile } = require("child_process");
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// optional ffmpeg
let ffmpegPath = null;
try { ffmpegPath = require("ffmpeg-static"); } catch (e) { ffmpegPath = null; }

// optional qrcode renderer in terminal
let qrcodeTerminal = null;
try { qrcodeTerminal = require('qrcode-terminal'); } catch (e) { qrcodeTerminal = null; }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const DATABASE_FILE = path.join(__dirname, 'database.json');
const AUTH_FOLDER = path.join(__dirname, 'auth_marques');
const MENU_IMAGE_FILE = path.join(__dirname, 'menu_image.jpg');

const startTime = Math.floor(Date.now() / 1000);

function tmpFile(ext = '') {
  const safeExt = ext ? (ext.replace(/^\./,'') || 'tmp') : '';
  const name = `marques_${Date.now()}_${Math.floor(Math.random()*10000)}${safeExt ? '.'+safeExt : ''}`;
  return path.join(os.tmpdir(), name);
}

/**
 * Protecao contra processamento duplicado de eventos
 */
const processedMessages = new Map();
const PROCESSED_EXPIRATION_MS = 20 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of processedMessages.entries()) {
    if (now - t > PROCESSED_EXPIRATION_MS) processedMessages.delete(k);
  }
}, 10 * 1000);

function lerBanco() {
  const padrao = {
    owner: null,
    parceiros: {},
    classificados: {},
    gruposDesativados: [],
    antilink: [],
    antilinkApaga: [],
    advertencias: {},
    bemvindos: {},
    adeus: {},
    camps: {},
    ranking: {},
    soadm: {},
    muted: {},
    brincadeiras: {
      passiva: {},
      hetero: {},
      feminina: {},
      cornos: {},
      falsos: {}
    },
    casamentos: {},
    jogodavelha: {},
    cacapalavras: {},
    autos: {}, // novo: agendamentos por grupo
    prefixes: {} // novo: prefixos por grupo
  };
  if (fs.existsSync(DATABASE_FILE)) {
    try {
      const dados = fs.readFileSync(DATABASE_FILE, 'utf-8');
      const json = JSON.parse(dados);
      const parceiros = (json.parceiros && !Array.isArray(json.parceiros) && typeof json.parceiros === 'object')
        ? json.parceiros
        : padrao.parceiros;
      const advertencias = (json.advertencias && typeof json.advertencias === 'object')
        ? json.advertencias
        : padrao.advertencias;
      const brincadeiras = (json.brincadeiras && typeof json.brincadeiras === 'object')
        ? { ...padrao.brincadeiras, ...json.brincadeiras }
        : padrao.brincadeiras;
      return {
        ...padrao,
        ...json,
        parceiros,
        advertencias,
        brincadeiras,
        camps: { ...padrao.camps, ...(json.camps || {}) },
        classificados: { ...padrao.classificados, ...(json.classificados || {}) },
        ranking: { ...padrao.ranking, ...(json.ranking || {}) },
        soadm: { ...padrao.soadm, ...(json.soadm || {}) },
        muted: { ...padrao.muted, ...(json.muted || {}) },
        bemvindos: { ...padrao.bemvindos, ...(json.bemvindos || {}) },
        adeus: { ...padrao.adeus, ...(json.adeus || {}) },
        antilink: Array.isArray(json.antilink) ? json.antilink : padrao.antilink,
        antilinkApaga: Array.isArray(json.antilinkApaga) ? json.antilinkApaga : padrao.antilinkApaga,
        casamentos: { ...padrao.casamentos, ...(json.casamentos || {}) },
        jogodavelha: { ...padrao.jogodavelha || {} },
        cacapalavras: { ...padrao.cacapalavras || {} },
        autos: { ...padrao.autos || {} },
        prefixes: { ...padrao.prefixes, ...(json.prefixes || {}) }
      };
    } catch (e) {
      console.error('Erro ler DB:', e && e.message);
      return padrao;
    }
  }
  return padrao;
}

function salvarBanco(dados) {
  try { fs.writeFileSync(DATABASE_FILE, JSON.stringify(dados, null, 2)); } catch (e) { console.error('Erro salvar DB:', e && e.message); }
}

/**
 * Regex MELHORADA para detectar QUALQUER tipo de link:
 */
const URL_REGEX = /(?:https?:\/\/[^\s]+|ftp:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+|telegram\.me\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+|bit\.ly\/[^\s]+|tinyurl\.com\/[^\s]+|goo\.gl\/[^\s]+|is\.gd\/[^\s]+|rb\.gy\/[^\s]+|cutt\.ly\/[^\s]+|discord\.gg\/[^\s]+|discord\.com\/[^\s]+|youtu\.be\/[^\s]+|vm\.tiktok\.com\/[^\s]+|instagram\.com\/[^\s]+|facebook\.com\/[^\s]+|fb\.me\/[^\s]+|twitter\.com\/[^\s]+|x\.com\/[^\s]+|linkedin\.com\/[^\s]+|reddit\.com\/[^\s]+|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(?:\/[^\s]*)?|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|br|me|io|co|info|biz|xyz|app|dev|pro|site|online|store|shop|link|click|fun|top|club|live|tv|cc|gg|ly|us|uk|eu|de|fr|it|es|pt|ru|jp|cn|in|au|ca|mx|ar|cl|pe|uy|py|bo|ec|ve|cr|pa|do|cu|sv|gt|hn|ni|bz|tt|jm|ht|gd|ag|dm|lc|vc|kn|bb|bs|sr|gy|gf|pf|nc|mq|gp|re|yt|pm|wf|bl|mf|sx|cw|aw|bq|ai|vg|vi|ms|tc|ky)(?:\/[^\s]*)?)/i;

const bancoTimes = [
  { n: 'MAN CITY', e: '\u{1F499}' },
  { n: 'REAL MADRID', e: '\u26AA' },
  { n: 'BARCELONA', e: '\u{1F535}' },
  { n: 'LIVERPOOL', e: '\u2764\uFE0F' },
  { n: 'ARSENAL', e: '\u{1F534}' },
  { n: 'BAYERN', e: '\u{1F534}' },
  { n: 'PSG', e: '\u{1F535}' },
  { n: 'INTER MILAN', e: '\u26AB' },
  { n: 'MILAN', e: '\u{1F534}' },
  { n: 'FLAMENGO', e: '\u{1F534}' },
  { n: 'PALMEIRAS', e: '\u{1F7E2}' },
  { n: 'SAO PAULO', e: '\u26AA' },
  { n: 'FENERBAHCE', e: '\u{1F7E1}' },
  { n: 'BORUSSIA', e: '\u{1F7E2}' },
  { n: 'WEST HAM', e: '\u{1F7E3}' },
  { n: 'ASTON VILLA', e: '\u{1F7E3}' },
  { n: 'CORINTHIANS', e: '\u26AB' },
  { n: 'FLUMINENSE', e: '\u{1F7E2}' },
  { n: 'BOTAFOGO', e: '\u26AA' },
  { n: 'GREMIO', e: '\u{1F535}' },
  { n: 'INTERNACIONAL', e: '\u{1F534}' },
  { n: 'JUVENTUDE', e: '\u{1F7E2}' },
  { n: 'REMO', e: '\u{1F7E6}' },
  { n: 'ATLETICO MINEIRO', e: '\u26AB' },
  { n: 'NAPOLI', e: '\u{1F535}' },
  { n: 'RIVER PLATE', e: '\u{1F534}' },
  { n: 'BOCA JUNIORS', e: '\u{1F535}' },
  { n: 'PENAROL', e: '\u{1F7E1}' },
  { n: 'NACIONAL', e: '\u26AA' },
  { n: 'CHELSEA', e: '\u{1F535}' }
];

function normalizeJid(jid) {
  if (!jid) return jid;
  const base = jid.split(':')[0];
  return base.includes('@') ? base : `${base}@s.whatsapp.net`;
}

const META_TTL = 60 * 1000;
const ADMIN_TTL = 30 * 1000;
const MAX_MENTIONS = 100;

const metadataCache = new Map();
const adminCache = new Map();

function buildSampleRankTable() {
  return `\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u{1F3C6} RANKING ATIVO \u2013 TOP 10 \u{1F3C6}
\u{1F4CA} Mensagens
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
... (tabela de exemplo)
\u00A9 Marques Bot`;
}

async function getGroupMetadata(sock, group) {
  if (!group) return null;
  const now = Date.now();
  const entry = metadataCache.get(group);
  if (entry) {
    if (entry.metadata && (now - entry.ts) < META_TTL) return entry.metadata;
    if (entry.promise) {
      try { return await entry.promise; } catch (e) { return null; }
    }
  }

  const p = (async () => {
    try {
      const md = await sock.groupMetadata(group);
      metadataCache.set(group, { metadata: md, ts: Date.now(), promise: null });
      return md;
    } catch (e) {
      metadataCache.set(group, { metadata: null, ts: Date.now(), promise: null });
      throw e;
    }
  })();

  metadataCache.set(group, { metadata: null, ts: Date.now(), promise: p });
  try { return await p; } catch (e) { return null; }
}

async function isUserAdminCached(sock, group, user) {
  if (!group || !user) return false;
  const key = `${group}|${user}`;
  const now = Date.now();
  const entry = adminCache.get(key);
  if (entry) {
    if ((now - entry.ts) < ADMIN_TTL && typeof entry.val === 'boolean') return entry.val;
    if (entry.promise) {
      try { return await entry.promise; } catch (e) { return false; }
    }
  }

  const p = (async () => {
    try {
      const md = await getGroupMetadata(sock, group);
      const uNorm = normalizeJid(user);
      const isAdm = md && md.participants && md.participants.some(pp => {
        try {
          const pid = normalizeJid(pp.id || pp.jid || pp.participant);
          return pid === uNorm && (pp.admin === 'admin' || pp.admin === 'superadmin' || pp.isAdmin);
        } catch (e) { return false; }
      });
      adminCache.set(key, { val: isAdm, ts: Date.now(), promise: null });
      return isAdm;
    } catch (e) {
      adminCache.set(key, { val: false, ts: Date.now(), promise: null });
      return false;
    }
  })();

  adminCache.set(key, { val: false, ts: Date.now(), promise: p });
  try { return await p; } catch (e) { return false; }
}

async function tentarPerfilFotoUrl(sock, jid) {
  try {
    if (!jid) return null;
    const nJid = normalizeJid(jid);
    try {
      const url = await sock.profilePictureUrl(nJid, 'image').catch(() => null);
      if (url) return url;
    } catch (e) {
      try {
        const url = await sock.profilePictureUrl(nJid).catch(() => null);
        if (url) return url;
      } catch (e2) {
        return null;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Criar figurinha (estatica ou animada) a partir de buffer.
 * Melhorias:
 * - Conversão animada com args mais robustos do ffmpeg (limita duração e ajusta fps/scale/pad)
 * - Fallback para figurinha estática (primeiro frame) caso a conversão animada falhe
 */
async function createStickerFromBuffer(sock, to, buffer, isAnimated = false) {
  if (!isAnimated) {
    try {
      const stickerBuffer = await sharp(buffer)
        .resize(512, 512, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
        .webp({ lossless: true })
        .toBuffer();
      await sock.sendMessage(to, { sticker: stickerBuffer });
      return;
    } catch (e) {
      console.warn('sharp static fallback failed:', e && e.message);
      // continue to attempt animated route if requested
    }
  }

  if (!ffmpegPath) throw new Error('ffmpeg nao disponivel no servidor. Instale ffmpeg ou ffmpeg-static.');

  const inFile = tmpFile('in');
  const outFile = tmpFile('webp');

  try {
    fs.writeFileSync(inFile, buffer);

    // args otimizados para criar webp animado compatível com figurinha
    // Limita duração para 8s para evitar arquivos enormes
    const filter = 'fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';
    const args = [
      '-y',
      '-i', inFile,
      '-t', '8',
      '-filter:v', filter,
      '-vcodec', 'libwebp',
      '-lossless', '0',
      '-compression_level', '6',
      '-qscale', '50',
      '-loop', '0',
      '-preset', 'default',
      '-an',
      '-vsync', '0',
      outFile
    ];

    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, (err, stdout, stderr) => {
        if (err) {
          // ffmpeg may write warnings; but if error exists, reject
          return reject(new Error(stderr || err.message || 'ffmpeg error'));
        }
        resolve();
      });
    });

    const webpBuffer = fs.readFileSync(outFile);
    await sock.sendMessage(to, { sticker: webpBuffer });
    return;
  } catch (e) {
    console.warn('Erro ao criar figurinha animada:', e && e.message);
    // fallback: tentar extrair primeiro frame e enviar como figurinha estatica
    try {
      const frameFile = tmpFile('png');
      await new Promise((resolve, reject) => {
        const args2 = ['-y', '-i', inFile, '-vframes', '1', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000', frameFile];
        execFile(ffmpegPath, args2, (err) => err ? reject(err) : resolve());
      });
      const imgBuf = fs.readFileSync(frameFile);
      try {
        const stickerBuffer = await sharp(imgBuf)
          .resize(512, 512, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
          .webp({ lossless: true })
          .toBuffer();
        await sock.sendMessage(to, { sticker: stickerBuffer });
        try { fs.unlinkSync(frameFile); } catch (er) {}
        return;
      } catch (err2) {
        try { await sock.sendMessage(to, { image: imgBuf, caption: '\u26A0\uFE0F Não foi possível criar sticker animado; envio como imagem.' }); } catch (er) {}
      }
    } catch (e2) {
      console.warn('Fallback frame extraction falhou:', e2 && (e2.message || e2));
    }
    throw new Error('Erro ao criar figurinha animada. Verifique ffmpeg.');
  } finally {
    try { fs.unlinkSync(inFile); } catch (e) {}
    try { fs.unlinkSync(outFile); } catch (e) {}
  }
}

function gerarTabuleiroCacaPalavras(words) {
  // words: array de strings (palavras)
  if (!Array.isArray(words) || words.length === 0) return '';
  const normalizedWords = words.map(w => (w || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  const maxLen = Math.max(...normalizedWords.map(w=>w.length));
  const size = Math.min(20, Math.max(12, Math.max(maxLen + 4, 12)));
  const grid = [];
  for (let i = 0; i < size; i++) {
    grid.push([]);
    for (let j = 0; j < size; j++) {
      grid[i].push('.');
    }
  }

  const directions = [
    { dx: 1, dy: 0 },   // direita
    { dx: 0, dy: 1 },   // baixo
    { dx: 1, dy: 1 },   // diagonal baixo-direita
    { dx: -1, dy: 0 },  // esquerda
    { dx: 0, dy: -1 },  // cima
    { dx: -1, dy: -1 }, // diagonal cima-esquerda
    { dx: 1, dy: -1 },  // diagonal cima-direita
    { dx: -1, dy: 1 }   // diagonal baixo-esquerda
  ];

  function fits(word, row, col, dir) {
    const l = word.length;
    const endRow = row + dir.dy * (l - 1);
    const endCol = col + dir.dx * (l - 1);
    if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) return false;
    for (let k = 0; k < l; k++) {
      const r = row + dir.dy * k;
      const c = col + dir.dx * k;
      const ch = grid[r][c];
      if (ch !== '.' && ch !== word[k]) return false;
    }
    return true;
  }

  function place(word) {
    const tries = 400;
    for (let t = 0; t < tries; t++) {
      const dir = directions[Math.floor(Math.random()*directions.length)];
      const row = Math.floor(Math.random() * size);
      const col = Math.floor(Math.random() * size);
      if (fits(word, row, col, dir)) {
        for (let k = 0; k < word.length; k++) {
          const r = row + dir.dy * k;
          const c = col + dir.dx * k;
          grid[r][c] = word[k];
        }
        return true;
      }
    }
    return false;
  }

  const placed = [];
  for (const w of normalizedWords) {
    const ok = place(w);
    placed.push({ word: w, placed: ok });
  }

  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (grid[i][j] === '.') {
        grid[i][j] = letras[Math.floor(Math.random() * letras.length)];
      }
    }
  }

  const gridText = grid.map(row => row.join(' ')).join('\n');

  return { gridText, placed };
}

// Estado em memoria para jogo da velha
const jogosVelha = new Map();

// Estado em memoria para propostas de casamento pendentes
const propostasCasamento = new Map();

function renderTabuleiroVelha(tab) {
  const simbolos = tab.map((c, i) => {
    if (c === 'X') return '\u274C';
    if (c === 'O') return '\u2B55';
    return String(i + 1) + '\uFE0F\u20E3';
  });
  return `${simbolos[0]} | ${simbolos[1]} | ${simbolos[2]}\n\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u253C\u2500\u2500\u2500\n${simbolos[3]} | ${simbolos[4]} | ${simbolos[5]}\n\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u253C\u2500\u2500\u2500\n${simbolos[6]} | ${simbolos[7]} | ${simbolos[8]}`;
}

function checarVencedorVelha(tab) {
  const linhas = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of linhas) {
    if (tab[a] !== '.' && tab[a] === tab[b] && tab[b] === tab[c]) return tab[a];
  }
  return null;
}

function jogadaIA(tab) {
  const linhas = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of linhas) {
    const vals = [tab[a],tab[b],tab[c]];
    if (vals.filter(v=>v==='O').length===2 && vals.filter(v=>v==='.').length===1) {
      return [a,b,c][vals.indexOf('.')];
    }
  }
  for (const [a,b,c] of linhas) {
    const vals = [tab[a],tab[b],tab[c]];
    if (vals.filter(v=>v==='X').length===2 && vals.filter(v=>v==='.').length===1) {
      return [a,b,c][vals.indexOf('.')];
    }
  }
  if (tab[4]==='.') return 4;
  const cantos = [0,2,6,8].filter(i=>tab[i]==='.');
  if (cantos.length) return cantos[Math.floor(Math.random()*cantos.length)];
  const livres = tab.map((v,i)=>v==='.'?i:-1).filter(i=>i!==-1);
  return livres.length ? livres[Math.floor(Math.random()*livres.length)] : -1;
}

function buildMenuNice() {
  // Atualizado conforme solicitado, layout fixo simplificado em texto
  return `╔══════════════════════════╗
║        🤖 MARQUES BOT        ║
╚══════════════════════════╝
     ⚡ MENU DE COMANDOS ⚡

━━━━━━━━━━━━━━━━━━━━━━
🏆 CAMPEONATO
━━━━━━━━━━━━━━━━━━━━━━
▢ .camp <x1|x2|x3> <vagas>
➛ Iniciar lista de campeonato

▢ /fcamp cancelar
➛ Cancelar lista atual

▢ /r-camp @player
➛ Remover pessoa da lista do camp

▢ /addregra <texto>
➛ Adicionar regra que será exibida abaixo dos confrontos quando a lista completar

━━━━━━━━━━━━━━━━━━━━━━
📊 RANKING DO GRUPO
━━━━━━━━━━━━━━━━━━━━━━
▢ /rank ou /top
➛ Top 10 que mais falam no grupo

━━━━━━━━━━━━━━━━━━━━━━
🎉 BRINCADEIRAS
━━━━━━━━━━━━━━━━━━━━━━
▢ /chance @user <texto>
━━━━━━━━━━━━━━━━━━━━━━
🎮 JOGOS
━━━━━━━━━━━━━━━━━━━━━━
▢ /jogodavelha @user
➛ Jogo da velha PvP

▢ /jogodavelhaia
➛ Contra ia
━━━━━━━━━━━━━━━━━━━━━━
💑 RELACIONAMENTO
━━━━━━━━━━━━━━━━━━━━━━
▢ /casar @user
➛ Pedir em casamento

▢ /dupla @user
➛ Ver casal e tempo

▢ /divorcio
➛ Separar do casal

━━━━━━━━━━━━━━━━━━━━━━
🛡️ ADMINISTRAÇÃO
━━━━━━━━━━━━━━━━━━━━━━
▢ /ban @user ➛ Banir membro
▢ .promover @user ➛ Virar ADM
▢ .rebaixar @user ➛ Tirar ADM
▢ .tiraadm @user ➛ Remover ADM

🔇 CONTROLE
▢ .mute / .unmute
▢ .mutelist

🔒 GRUPO
▢ .abrir / .fechar
▢ .off ➛ Desligar bot
▢ .on ➛ Ligar bot


🔧 PREFIXO POR GRUPO
▢ /setprefix <novoPrefixo>
➛ Define prefixo deste grupo (apenas admins)

━━━━━━━━━━━━━━━━━━━━━━
© 2026 • MARQUES BOT 🤖`;
}

const frases = {
  fabulous: ["Brilho intenso! \u{1F308}","Fabuloso nivel maximo! \u2728","Hoje e dia de arrasar! \u{1F483}","Sorriso contagiante! \u{1F604}"],
  sorte: ["Sorte em alta \u2014 jogue na loteria! \u{1F340}","Momento perfeito para tentar algo novo! \u2728","Cautela, mas oportunidade vindo! \u26A1","Dia neutro, aja com carinho. \u{1F324}\uFE0F"],
  meme: ["Meme master! \u{1F602}","Tem potencial viral! \u{1F525}","Risos garantidos! \u{1F606}","Modo silencioso \u2014 precisa treinar memes. \u{1F92B}"],
  amizade: ["Amizade solida! \u{1F4AA}","Parceria nivel lendario! \u{1F91D}","Bora marcar role! \u{1F389}","Melhor amigo(a) em formacao! \u{1F604}"]
};

async function fetchBuffer(url) {
  if (!url) throw new Error('No URL provided');
  let _fetch = globalThis.fetch;
  if (!_fetch) {
    try { _fetch = require('node-fetch'); } catch (e) { throw new Error('fetch nao disponivel. Use Node 18+ ou instale node-fetch'); }
  }
  const res = await _fetch(url);
  if (!res.ok) throw new Error('Falha ao baixar imagem: ' + res.status);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function createPercentImageWithFlag(baseBuffer, percent, label = '', options = { rainbow: false }) {
  const base = await sharp(baseBuffer).resize(512, 512, { fit: 'cover' }).png().toBuffer();
  const safeLabel = (label || '').replace(/[<>&'"]/g, '');
  const safePercent = String(percent) + '%';
  const rainbow = options.rainbow ? '<defs><linearGradient id="rg" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#E40303"/><stop offset="100%" stop-color="#B000B8"/></linearGradient></defs><rect x="0" y="0" width="512" height="56" fill="url(#rg)" opacity="0.9"/>' : '';
  const svg = `
  <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <style>
      .label { font-family: Arial, sans-serif; fill: #FFFFFF; font-weight:700; font-size:26px; }
      .percent { font-family: Arial, sans-serif; fill: #FFD700; font-weight:900; font-size:68px; }
      .badge { fill: rgba(0,0,0,0.45); rx:14; }
    </style>
    ${rainbow}
    <rect x="16" y="370" width="480" height="126" rx="16" class="badge"/>
    <text x="256" y="408" text-anchor="middle" class="label">${safeLabel}</text>
    <text x="256" y="464" text-anchor="middle" class="percent">${safePercent}</text>
  </svg>`;
  const svgBuffer = Buffer.from(svg);
  return await sharp(base).composite([{ input: svgBuffer, top: 0, left: 0 }]).png().toBuffer();
}

async function sendProfileWithOverlay(sock, to, targetJid, bufferImage, caption, mentions = []) {
  try {
    if (bufferImage) {
      await sock.sendMessage(to, { image: bufferImage, caption, mentions });
      return;
    }
  } catch (e) {}
  await sock.sendMessage(to, { text: caption, mentions });
}

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

function roundLabel(count) {
  if (count <= 2) return 'FINAL';
  if (count <= 4) return 'SEMIFINAIS';
  if (count <= 8) return 'QUARTAS';
  return 'ELIMINATORIO';
}

function findViewOnceNode(msgObj) {
  if (!msgObj || typeof msgObj !== 'object') return null;

  function search(obj) {
    if (!obj || typeof obj !== 'object') return null;

    if (obj.viewOnceMessage) {
      const candidate = obj.viewOnceMessage;
      const inner = candidate.message || candidate;
      const keys = Object.keys(inner || {});
      if (keys.length === 0) return null;
      const k = keys[0];
      return { vType: k, mediaNode: inner[k] };
    }

    if (obj.quotedMessage && obj.quotedMessage.viewOnceMessage) {
      const candidate = obj.quotedMessage.viewOnceMessage;
      const inner = candidate.message || candidate;
      const keys = Object.keys(inner || {});
      if (keys.length === 0) return null;
      const k = keys[0];
      return { vType: k, mediaNode: inner[k] };
    }

    for (const key of Object.keys(obj)) {
      try {
        const val = obj[key];
        if (val && typeof val === 'object') {
          const found = search(val);
          if (found) return found;
        }
      } catch (e) {}
    }
    return null;
  }

  return search(msgObj);
}

function resolveTargetJidFromMessage(m, args) {
  // 1) Verifica mencoes no texto
  const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentioned.length) return normalizeJid(mentioned[0]);

  // 2) Verifica se esta respondendo a uma mensagem (reply participant)
  const repliedParticipant = m.message?.extendedTextMessage?.contextInfo?.participant || null;
  if (repliedParticipant) return normalizeJid(repliedParticipant);

  // 3) Verifica argumentos (numero ou @user)
  if (args && args.length) {
    const raw = args[0].trim();
    if (raw.includes('@')) return normalizeJid(raw);
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 5) return normalizeJid(digits + '@s.whatsapp.net');
  }
  return null;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function onlyNumbers(str) {
  if (!str) return '';
  return String(str).replace(/\D/g, '');
}

async function trySendReact(sock, jid, key, text = '\u2B50') {
  try {
    await sock.sendMessage(jid, { reaction: { text, key } });
    return;
  } catch (e) {
    try {
      await sock.sendMessage(jid, { react: { text, key } });
      return;
    } catch (e2) {}
  }
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function handlePercentPlayCommand({ sock, m, from, sender, args, category, labelText, defaultPhrase }) {
  const db = lerBanco();
  db.brincadeiras = db.brincadeiras || { passiva:{}, hetero:{}, feminina:{}, cornos:{}, falsos:{} };

  const target = resolveTargetJidFromMessage(m, args) || sender;
  const label = labelText || category.toUpperCase();
  const phraseArgs = (() => {
    const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    let startIdx = 0;
    if (mentioned.length) startIdx = 1;
    else if (args && args.length) {
      if (/@/.test(args[0]) || /^\+?\d/.test(args[0])) startIdx = 1;
    }
    return args.slice(startIdx).join(' ').trim();
  })();

  const captionPhrase = phraseArgs || (defaultPhrase || `${label} rating`);
  const percent = Math.floor(Math.random()*101);

  try {
    const ppUrl = await tentarPerfilFotoUrl(sock, target).catch(()=>null);
    let overlayBuffer = null;
    if (ppUrl) {
      try {
        const buf = await fetchBuffer(ppUrl);
        overlayBuffer = await createPercentImageWithFlag(buf, percent, label, { rainbow: false });
      } catch (e) {
        const blank = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#222222' } }).png().toBuffer();
        overlayBuffer = await createPercentImageWithFlag(blank, percent, label, { rainbow: false });
      }
    } else {
      const blank = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#222222' } }).png().toBuffer();
      overlayBuffer = await createPercentImageWithFlag(blank, percent, label, { rainbow: false });
    }

    const j = normalizeJid(target);
    db.brincadeiras = db.brincadeiras || {};
    db.brincadeiras[category] = db.brincadeiras[category] || {};
    db.brincadeiras[category][j] = (db.brincadeiras[category][j] || 0) + percent;
    salvarBanco(db);

    // PREPEND mention text so the caption visibly contains @user as requested
    const caption = `@${j.split('@')[0]}\n\u{1F449} ${captionPhrase}\nResultado: *${percent}%*`;
    await sendProfileWithOverlay(sock, from, target, overlayBuffer, caption, [j]);
  } catch (e) {
    console.error(`ERR /${category}:`, e && e.stack);
    try { await sock.sendMessage(from, { text: `\u274C Erro ao processar comando ${label}.` }); } catch {}
  }
}

let autoIntervalStarted = false; // garante que apenas 1 intervalo de auto seja criado

// Util utilitario para obter hora em timezone especifica (padrao America/Sao_Paulo)
function getNowInTimeZone(tz = 'America/Sao_Paulo') {
  // usa formatToParts para extrair campos de forma segura
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(new Date());

  const map = {};
  for (const p of parts) {
    if (p.type && p.value) map[p.type] = p.value;
  }
  const YYYY = map.year || new Date().getFullYear();
  const MM = map.month || String(new Date().getMonth() + 1).padStart(2, '0');
  const DD = map.day || String(new Date().getDate()).padStart(2, '0');
  const hh = (map.hour || '00').padStart(2, '0');
  const mm = (map.minute || '00').padStart(2, '0');
  return { year: YYYY, month: MM, day: DD, hour: hh, minute: mm, key: `${YYYY}-${MM}-${DD} ${hh}:${mm}` };
}

async function iniciar() {
  // Garantir pasta de auth existe e é gravável (trata ENOSPC / ENOENT)
  let authFolderToUse = AUTH_FOLDER;
  try {
    // Tenta criar a pasta (recursivo)
    fs.mkdirSync(authFolderToUse, { recursive: true });
    // Teste de escrita
    const testFile = path.join(authFolderToUse, '.touch');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
  } catch (e) {
    console.error('Falha ao criar/usar pasta de auth:', e && e.code, e && e.message);
    if (e && e.code === 'ENOSPC') {
      console.error('\nERRO: Espaço insuficiente em disco (ENOSPC).');
      console.error('Libere espaço no dispositivo (ex: apagar arquivos, logs, node_modules antigos) e reinicie o bot.');
      process.exit(1);
    }
    // Tenta fallback para pasta temporária
    try {
      const fallback = path.join(os.tmpdir(), 'auth_marques');
      fs.mkdirSync(fallback, { recursive: true });
      const testFile2 = path.join(fallback, '.touch');
      fs.writeFileSync(testFile2, 'ok');
      fs.unlinkSync(testFile2);
      authFolderToUse = fallback;
      console.warn('Usando pasta de autenticação temporária em:', fallback);
      console.warn('OBS: Se o processo for reiniciado, a sessão pode não persistir se o tmp for limpo.');
    } catch (e2) {
      console.error('Falha ao criar pasta de fallback para auth:', e2 && e2.code, e2 && e2.message);
      console.error('Impossivel prosseguir sem uma pasta de autenticação gravavel.');
      process.exit(1);
    }
  }

  let state, saveCreds;
  try {
    const res = await makeAuthState(authFolderToUse);
    state = res.state;
    saveCreds = res.saveCreds;
  } catch (e) {
    console.error('Erro ao inicializar useMultiFileAuthState:', e && (e.code || e.message || e));
    if (e && e.code === 'ENOSPC') {
      console.error('\nERRO: Espaço insuficiente em disco (ENOSPC).');
      console.error('Libere espaço no dispositivo e reinicie o bot.');
    } else {
      console.error('Verifique permissões e existencia do caminho de auth:', authFolderToUse);
    }
    process.exit(1);
  }

  const { version } = await fetchLatestBaileysVersion();

  let CONFIG = {};
  try { CONFIG = require('../../config.js'); } catch (e) { CONFIG = {}; }
  const PREFIX = CONFIG.PREFIX || '.';
  const BOT_LID = CONFIG.BOT_LID || null;
  const OWNER_LID = CONFIG.OWNER_LID || null;

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    version,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false
  });

  // Função auxiliar: Avança fases do camp automaticamente conforme vencedores forem sendo registrados
  async function advanceCampRounds(db, groupId) {
    try {
      const camp = db.camps[groupId];
      if (!camp || !Array.isArray(camp.confrontos) || camp.confrontos.length === 0) return;

      // Repetir enquanto a fase atual estiver completamente finalizada (todos confrontos finished OR p2 == null)
      let loopSafe = 0;
      while (loopSafe < 10) {
        loopSafe++;
        const confs = camp.confrontos || [];
        // Considera um confronto finalizado se confronto.finished === true OR p2 === null (bye)
        const allFinished = confs.length > 0 && confs.every(c => c.finished || !c.p2);
        if (!allFinished) break;

        // Coleta vencedores (em ordem)
        let winners = confs.map(c => {
          if (c.finished && c.winner) return normalizeJid(c.winner);
          // se p2 == null => p1 avança automaticamente
          if (!c.p2) return normalizeJid(c.p1);
          // fallback (se algo estiver mal) -> ignore this confronto
          return null;
        }).filter(Boolean);

        // Shuffle winners before generating next round to ensure randomness each fase
        winners = shuffleArray(winners);

        // Salva histórico/ classificação parcial
        db.classificados = db.classificados || {};
        db.classificados[groupId] = db.classificados[groupId] || [];
        db.classificados[groupId].push({ round: camp.stage || roundLabel(winners.length), winners: winners.slice(), ts: Date.now() });

        if (winners.length <= 1) {
          // Temos um campeão
          if (winners.length === 1) {
            const champ = winners[0];
            try {
              await sock.sendMessage(groupId, {
                text: `\u{1F3C6} *CAMPEÃO DO CAMP* \n\nParabéns @${champ.split('@')[0]}! Você é o vencedor do campeonato.\n\nObrigado a todos que participaram!`,
                mentions: [champ]
              });
            } catch (e) {
              try { await sock.sendMessage(groupId, { text: `\u{1F3C6} Campeão: @${champ.split('@')[0]} !` }); } catch {}
            }
          } else {
            // Nenhum vencedor identificado (situacao improvavel) - limpa camp
            try { await sock.sendMessage(groupId, { text: '\u26A0\uFE0F Ocorreu um problema ao determinar vencedores. Camp finalizado sem campeão.' }); } catch {}
          }
          // Finaliza camp
          db.camps[groupId] = null;
          salvarBanco(db);
          break;
        }

        // Monta próxima fase, emparelhando vencedores sequencialmente
        const nextConfs = [];
        for (let i = 0; i < winners.length; i += 2) {
          const p1 = winners[i];
          const p2 = winners[i + 1] || null;
          nextConfs.push({ p1, p2, winner: null, finished: false, firstSaid: null, waitingFor: null });
        }

        // Atualiza stage (label) baseado no número de participantes (vencedores)
        const nextStageLabel = roundLabel(winners.length);
        camp.confrontos = nextConfs;
        camp.stage = nextStageLabel;
        // status permanece false (inscrições fechadas)
        db.camps[groupId] = camp;
        salvarBanco(db);

        // Mensagem anunciando próxima fase
        let res = `\u{1F3DF}\uFE0F *PRÓXIMA FASE: ${nextStageLabel}*\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n`;
        for (let i = 0; i < nextConfs.length; i++) {
          const c = nextConfs[i];
          res += `\u26BD *JOGO ${i+1}*\n@${normalizeJid(c.p1).split('@')[0]}  VS  ${c.p2 ? '@' + normalizeJid(c.p2).split('@')[0] : "_(AVANÇA POR BYE)_"}\n\n`;
        }
        const regra = (camp.regra && camp.regra.trim()) ? camp.regra.trim() : null;
        if (regra) {
          res += `\u{1F4D6} *REGRAS DO CAMP:*\n${regra}\n\n`;
        } else {
          res += `\u{1F4D6} *REGRAS DO CAMP:*\n_Nenhuma regra definida._\n\n`;
        }
        res += `\u2139\uFE0F Quando ganhar um confronto, digite "GANHEI" (sem barra) para registrar.`;

        // Menciona participantes (máx MAX_MENTIONS)
        const mentions = nextConfs.flatMap(c => [c.p1, c.p2].filter(Boolean)).slice(0, MAX_MENTIONS);
        try {
          await sock.sendMessage(groupId, { text: res, mentions });
        } catch (e) {
          try { await sock.sendMessage(groupId, { text: res }); } catch {}
        }

        // Se existirem confrontos com p2 == null (bye), marque-os como finished e winner=p1 para avançar imediatamente na próxima iteração
        let hadBye = false;
        for (const c of camp.confrontos) {
          if (!c.p2 && !c.finished) {
            c.winner = normalizeJid(c.p1);
            c.finished = true;
            hadBye = true;
          }
        }
        if (hadBye) {
          // Salva e continue loop para converter esses byes em avanços (isso alimentará a próxima rodada automaticamente)
          db.camps[groupId] = camp;
          salvarBanco(db);
          // loop continuará se todos confrontos estiverem finalizados (incl. byes que agora foram marcados)
          continue;
        } else {
          // sem byes -> esperamos os "GANHEI" dos players; sai do loop
          break;
        }
      } // end while
    } catch (e) {
      console.error('ERR advanceCampRounds:', e && (e.stack || e));
    }
  } // end advanceCampRounds

  // inicia rotina de checagem de /auto (apenas uma vez)
  if (!autoIntervalStarted) {
    autoIntervalStarted = true;
    setInterval(async () => {
      try {
        const db = lerBanco();
        if (!db.autos) return;

        // usa horario de Brasilia (America/Sao_Paulo)
        const nowObj = getNowInTimeZone('America/Sao_Paulo');
        const hh = String(nowObj.hour).padStart(2,'0');
        const mm = String(nowObj.minute).padStart(2,'0');
        const nowKey = nowObj.key;

        for (const groupId of Object.keys(db.autos || {})) {
          try {
            const auto = db.autos[groupId];
            if (!auto || !auto.time || !auto.text || !auto.active) continue;
            // auto.time stored as "HH:MM"
            const scheduled = auto.time;
            if (!/^\d{2}:\d{2}$/.test(scheduled)) continue;
            if (scheduled === `${hh}:${mm}`) {
              // verifica se ja enviou nesse minuto (usando mesmo timezone)
              if (auto.lastSent && auto.lastSent === nowKey) continue;
              // pega participantes
              const md = await getGroupMetadata(sock, groupId).catch(()=>null);
              const participants = (md?.participants || []).map(p => normalizeJid(p.id || p.jid || p.participant)).filter(Boolean);
              if (!participants || participants.length === 0) continue;
              const botJidNow = sock.user?.id ? normalizeJid(sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;
              // menciona todos (exceto o bot) até MAX_MENTIONS
              let mentions = participants.filter(p => p !== botJidNow).slice(0, MAX_MENTIONS);
              if (!mentions || mentions.length === 0) {
                // fallback: apenas texto simples
                try {
                  await sock.sendMessage(groupId, { text: auto.text });
                } catch (e) {
                  // ignore
                }
              } else {
                // constrói texto com @user para que as menções apareçam no chat
                const mentionText = mentions.map(j => `@${j.split('@')[0]}`).join(' ');
                const fullText = `${mentionText}\n${auto.text}`;
                try {
                  await sock.sendMessage(groupId, { text: fullText, mentions });
                } catch (e) {
                  // fallback: tenta enviar sem mentions (algumas instâncias podem rejeitar mentions grandes)
                  try { await sock.sendMessage(groupId, { text: fullText }); } catch (e2) { try { await sock.sendMessage(groupId, { text: auto.text }); } catch {} }
                }
              }
              // atualiza lastSent (usando chave com data/hora em timezone de Brasilia)
              db.autos[groupId].lastSent = nowKey;
              salvarBanco(db);
            }
          } catch (e) {
            // falha em um grupo nao deve parar loop
            console.error('ERR auto send group:', e && e.stack);
          }
        }
      } catch (e) {
        console.error('ERR auto interval:', e && e.stack);
      }
    }, 20 * 1000); // checa a cada 20s
  }

  try {
    if (!state || !state.creds || !state.creds.registered) {
      console.log("\u26A0\uFE0F AGUARDANDO NUMERO...");
      const phoneNumber = await question('Digite o numero do bot (ex: 5511999998888): ');
      try {
        const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
        console.log(`\n\n====================================`);
        console.log(`\u{1F517} SEU CODIGO DE PAREAMENTO: ${code}`);
        console.log(`====================================\n\n`);
      } catch (e) {
        console.warn('Falha ao solicitar codigo de pareamento:', e && (e.message || e));
        console.log('Voce pode precisar escanear QR manualmente se o metodo de pareamento nao estiver disponivel.');
      }
    }
  } catch (e) {
    console.error('Erro no fluxo de pareamento:', e && (e.stack || e.message));
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log('QR recebido \u2014 escaneie para parear.');
      if (qrcodeTerminal && typeof qrcodeTerminal.generate === 'function') {
        try { qrcodeTerminal.generate(qr, { small: true }); } catch (e) { console.log('Erro gerar QR no terminal, exibindo string do QR.'); console.log(qr); }
      } else {
        console.log('QR (string):', qr);
      }
    }
    if (connection === 'open') {
      console.log('MARQUES BOT ONLINE');
      const db = lerBanco();
      try {
        if (!db.owner && sock.user?.id) { db.owner = sock.user.id.split(':')[0] + '@s.whatsapp.net'; salvarBanco(db); }
      } catch (e) {}
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log('Conexao fechada, tentando reconectar...');
        iniciar();
      } else {
        console.log('Logout detectado. Remova auth_marques para reconfigurar.');
      }
    }
  });

  // group participants update (welcome / bye)
  sock.ev.on('group-participants.update', async (anu) => {
    try {
      const db = lerBanco();
      const { id, participants, action, author } = anu;

      if (db.gruposDesativados && db.gruposDesativados.includes(id)) return;

      for (const p of participants) {
        const jid = typeof p === 'string' ? p : (p?.id || p?.jid || null);
        if (!jid) continue;
        if (action === 'add') {
          if (db.bemvindos && db.bemvindos[id]) {
            const texto = (db.bemvindos[id] || '').replace(/@user/g, '@' + jid.split('@')[0]);
            const pp = await tentarPerfilFotoUrl(sock, jid).catch(()=>null);
            if (pp) {
              try { await sock.sendMessage(id, { image: { url: pp }, caption: texto, mentions: [jid] }); } catch { await sock.sendMessage(id, { text: texto, mentions: [jid] }); }
            } else {
              await sock.sendMessage(id, { text: texto, mentions: [jid] });
            }
          }
        } else if (action === 'remove') {
          if (db.adeus && db.adeus[id]) {
            const texto = (db.adeus[id] || '').replace(/@user/g, '@' + jid.split('@')[0]);
            const pp = await tentarPerfilFotoUrl(sock, jid).catch(()=>null);
            if (pp) {
              try { await sock.sendMessage(id, { image: { url: pp }, caption: texto, mentions: [jid] }); } catch { await sock.sendMessage(id, { text: texto, mentions: [jid] }); }
            } else {
              await sock.sendMessage(id, { text: texto, mentions: [jid] });
            }
          }

          if (author && author !== jid) {
            try { await sock.sendMessage(id, { text: `\u26A0\uFE0F *REVER:* O administrador @${author.split('@')[0]} removeu @${jid.split('@')[0]}!`, mentions: [author, jid] }); } catch {}
          }
        }
      }
    } catch (e) {
      console.error('Erro group update:', e && (e.stack||e.message));
    }
  });

  // messages.upsert
  sock.ev.on('messages.upsert', async (mUp) => {
    try {
      const messages = mUp.messages || (Array.isArray(mUp) ? mUp : []);
      const m = Array.isArray(messages) ? messages[0] : messages;
      if (!m) return;
      if (!m.message || m.key.remoteJid === 'status@broadcast' || m.messageTimestamp < startTime) return;

      const msgKey = `${m.key.remoteJid || ''}:${m.key.id || m.key.participant || ''}:${m.messageTimestamp || ''}`;
      const now = Date.now();
      const prev = processedMessages.get(msgKey);
      if (prev && (now - prev) < PROCESSED_EXPIRATION_MS) {
        return;
      }
      processedMessages.set(msgKey, now);

      function extractText(msg) {
        if (!msg) return '';
        if (msg.buttonsResponseMessage) return msg.buttonsResponseMessage.selectedDisplayText || msg.buttonsResponseMessage.selectedButtonId || '';
        if (msg.listResponseMessage) return msg.listResponseMessage.title || msg.listResponseMessage.singleSelectReply?.selectedRowId || msg.listResponseMessage.description || '';
        if (msg.templateButtonReply) return msg.templateButtonReply.selectedDisplayText || msg.templateButtonReply.selectedId || '';
        if (msg.conversation) return msg.conversation;
        if (msg.extendedTextMessage && msg.extendedTextMessage.text) return msg.extendedTextMessage.text;
        if (msg.imageMessage && msg.imageMessage.caption) return msg.imageMessage.caption;
        if (msg.videoMessage && msg.videoMessage.caption) return msg.videoMessage.caption;
        if (msg.documentMessage && msg.documentMessage.caption) return msg.documentMessage.caption;
        if (msg.audioMessage && msg.audioMessage.caption) return msg.audioMessage.caption;
        if (msg.contactMessage && msg.contactMessage.displayName) return msg.contactMessage.displayName;
        if (msg.viewOnceMessage && msg.viewOnceMessage.message) {
          const inner = msg.viewOnceMessage.message;
          const k = Object.keys(inner)[0];
          const node = inner[k];
          return node.caption || node.text || '';
        }
        return '';
      }

      const rawBody = extractText(m.message) || '';
      const body = (rawBody || '').toString().trim();
      const from = m.key.remoteJid;
      const sender = m.key.participant || (m.key.fromMe ? (sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : m.key.remoteJid) : m.key.remoteJid);
      const isGroup = isGroupJid(from);

      if (body.toLowerCase() === '/ping') {
        await sock.sendMessage(from, { text: 'PONG' });
        return;
      }

      // ====== COMANDO "todos" ======
      const isQuoted = !!m.message.extendedTextMessage?.contextInfo?.quotedMessage;
      if (body.toLowerCase() === 'todos' && isQuoted) {
        if (!isGroup) return;
        try {
          const md = await getGroupMetadata(sock, from);
          let participants = (md?.participants || []).map(p => normalizeJid(p.id || p.jid || p.participant)).filter(Boolean);
          participants = participants.slice(0, MAX_MENTIONS);
          await sock.sendMessage(from, {
            text: "\u{1F4E2} Chamada Geral!",
            mentions: participants
          }, {
            quoted: m
          });
        } catch (err) {
          console.error('ERR todos:', err && (err.stack || err));
          try { await sock.sendMessage(from, { text: "\u274C Falha ao mencionar todos." }); } catch {}
        }
        return;
      }

      let db = lerBanco();
      db.parceiros = db.parceiros || {};
      db.antilink = Array.isArray(db.antilink) ? db.antilink : [];
      db.antilinkApaga = Array.isArray(db.antilinkApaga) ? db.antilinkApaga : [];
      db.gruposDesativados = Array.isArray(db.gruposDesativados) ? db.gruposDesativados : [];
      db.muted = db.muted || {};
      db.ranking = db.ranking || {};
      db.camps = db.camps || {};
      db.advertencias = (db.advertencias && typeof db.advertencias === 'object') ? db.advertencias : {};
      db.brincadeiras = db.brincadeiras || { passiva:{}, hetero:{}, feminina:{}, cornos:{}, falsos:{} };
      db.casamentos = db.casamentos || {};
      db.jogodavelha = db.jogodavelha || {};
      db.cacapalavras = db.cacapalavras || {};
      db.autos = db.autos || {};
      db.prefixes = db.prefixes || {};

      const isOwner = sender === db.owner;
      const temPoder = isOwner;
      const isParceiro = isGroup ? (Array.isArray(db.parceiros[from]) && db.parceiros[from].includes(sender)) : false;

      if (isGroup && db.gruposDesativados.includes(from) && !temPoder && body.toLowerCase() !== '/on') return;

      // muted
      if (isGroup && db.muted && Array.isArray(db.muted[from]) && db.muted[from].includes(sender) && !temPoder && !isParceiro) {
        try { await sock.sendMessage(from, { delete: m.key }); } catch {}
        return;
      }

      // ====== ANTI-LINK ENFORCEMENT (MELHORADO) ======
      if (isGroup && body && URL_REGEX.test(body) && !temPoder && !isParceiro) {
        // Tambem checa admin do remetente - admins nao sao afetados
        const senderIsAdminForAntilink = await isUserAdminCached(sock, from, sender);
        if (!senderIsAdminForAntilink) {
          if (db.antilink && db.antilink.includes(from)) {
            try {
              try { await sock.sendMessage(from, { delete: m.key }); } catch {}
              try { await sock.groupParticipantsUpdate(from, [sender], "remove"); } catch {}
              try { await sock.sendMessage(from, { text: `\u{1F6AB} @${sender.split('@')[0]} removido por enviar link proibido.`, mentions: [sender] }); } catch {}
            } catch (err) {
              console.error('ERR antilink ban:', err && (err.stack || err));
            }
            return;
          }
          if (db.antilinkApaga && db.antilinkApaga.includes(from)) {
            try {
              try { await sock.sendMessage(from, { delete: m.key }); } catch {}
              try { await sock.sendMessage(from, { text: `\u26A0\uFE0F @${sender.split('@')[0]}, link apagado.`, mentions: [sender] }); } catch {}
            } catch (err) {
              console.error('ERR antilink apaga:', err && (err.stack || err));
            }
            return;
          }
        }
      }

      // ranking
      if (isGroup) {
        if (!db.ranking[from]) db.ranking[from] = {};
        db.ranking[from][sender] = (db.ranking[from][sender] || 0) + 1;
        salvarBanco(db);
      }

      // /on
      if (body.toLowerCase() === '/on') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (senderIsAdmin && db.gruposDesativados.includes(from)) {
          db.gruposDesativados = db.gruposDesativados.filter(id => id !== from);
          salvarBanco(db);
          await sock.sendMessage(from, { text: "\u2705 *Bot ativado neste grupo!*" });
        } else if (!db.gruposDesativados.includes(from)) {
          await sock.sendMessage(from, { text: "\u{1F7E2} O bot ja esta ativo neste grupo." });
        } else {
          await sock.sendMessage(from, { text: "\u274C Apenas administradores/dono podem ativar o bot neste grupo." });
        }
        return;
      }

      // ====== HANDLER: "aceito" para casamento ======
      if (body.toLowerCase() === 'aceito' && isGroup) {
        const chave = `${from}|${sender}`;
        const proposta = propostasCasamento.get(chave);
        if (proposta && (Date.now() - proposta.ts) < 5 * 60 * 1000) {
          propostasCasamento.delete(chave);
          db.casamentos = db.casamentos || {};
          db.casamentos[from] = db.casamentos[from] || [];
          const casal = { p1: proposta.de, p2: sender, data: Date.now() };
          db.casamentos[from].push(casal);
          salvarBanco(db);
          await sock.sendMessage(from, {
            text: `\u{1F492} @${normalizeJid(proposta.de).split('@')[0]} e @${normalizeJid(sender).split('@')[0]} estao oficialmente casados! Parabens ao casal!\n\u{1F48D} Data: ${new Date().toLocaleDateString('pt-BR')}`,
            mentions: [proposta.de, sender]
          });
          return;
        }
      }

      // ====== HANDLER: resposta do caca palavras (AGORA MULTI-PALAVRA e normaliza acentos) ======
      if (isGroup && db.cacapalavras && db.cacapalavras[from] && db.cacapalavras[from].ativo) {
        try {
          const cp = db.cacapalavras[from];
          const respostaRaw = body.trim();
          if (!respostaRaw) { /* ignore */ }
          else {
            const normalizeAnswer = (s) => {
              try {
                return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
              } catch (e) {
                return s.replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g,'');
              }
            };
            const resposta = normalizeAnswer(respostaRaw);
            const palavras = (cp.words || []).map(w => ({ orig: w, norm: normalizeAnswer(w) }));
            const remaining = palavras.filter(p => !(cp.found && cp.found[p.orig]));
            const match = remaining.find(p => p.norm === resposta);
            if (match) {
              cp.acertos = cp.acertos || {};
              cp.acertos[sender] = (cp.acertos[sender] || 0) + 1;
              cp.found = cp.found || {};
              cp.found[match.orig] = sender;
              db.cacapalavras[from] = cp;
              salvarBanco(db);

              const mentions = [sender];
              await sock.sendMessage(from, { text: `\u2705 @${normalizeJid(sender).split('@')[0]} acertou a palavra: *${match.orig}*`, mentions });

              const totalFound = Object.keys(cp.found || {}).length;
              if (totalFound >= (cp.words ? cp.words.length : 0)) {
                cp.ativo = false;
                db.cacapalavras[from] = cp;
                salvarBanco(db);

                const acertosEntries = Object.entries(cp.acertos || {}).sort((a,b) => b[1]-a[1]);
                let ranking = `\u{1F3C6} *CACA PALAVRAS - RESULTADO*\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n`;
                ranking += `\u2705 Todas as palavras foram encontradas!\n\n`;
                ranking += `*Placar final:*\n`;
                const mentionsAll = [];
                acertosEntries.forEach(([jid, pts], i) => {
                  ranking += `${i+1}\u00BA @${normalizeJid(jid).split('@')[0]} \u2014 ${pts} palavra(s)\n`;
                  mentionsAll.push(normalizeJid(jid));
                });
                await sock.sendMessage(from, { text: ranking, mentions: mentionsAll });
              } else {
                const rest = (cp.words ? cp.words.length : 0) - totalFound;
                await sock.sendMessage(from, { text: `\u2139\uFE0F Restam ${rest} palavra(s) para serem encontradas.` });
              }
            }
          }
        } catch (e) {
          console.error('ERR resposta caca palavras:', e && (e.stack || e));
        }
      }

      // ====== HANDLER: jogada 'cria' para confrontos do camp
      // Quando os confrontos sao publicados, db.camps[from].confrontos (array) sera criada
      // Cada item: { p1, p2, created: false, firstSaid: null, createdAt: null }
      if (isGroup && body.trim().toLowerCase() === 'cria') {
        try {
          const camp = db.camps[from];
          if (!camp || !camp.confrontos || !Array.isArray(camp.confrontos) || camp.confrontos.length === 0) {
            // nao ha confrontos pendentes
            // não incomodar o chat com mensagens desnecessárias
          } else {
            const normSender = normalizeJid(sender);
            // procura confronto onde sender é p1 ou p2 e firstSaid ainda não foi definido
            const encontroIdx = camp.confrontos.findIndex(cn => (normalizeJid(cn.p1) === normSender || normalizeJid(cn.p2) === normSender) && !cn.firstSaid);
            if (encontroIdx === -1) {
              // ou ja foi marcado por outro, ou nao participa
              // enviar feedback se participante pertence a algum confronto mas já foi marcado
              const pertence = camp.confrontos.find(cn => normalizeJid(cn.p1) === normSender || normalizeJid(cn.p2) === normSender);
              if (pertence) {
                await sock.sendMessage(from, { text: `\u2139\uFE0F Seu confronto ja teve o 'cria' acionado anteriormente ou ja foi processado.` });
              } else {
                // opcional: ignorar se pessoa nao faz parte dos confrontos
              }
            } else {
              const encontro = camp.confrontos[encontroIdx];
              // marca quem falou primeiro
              encontro.firstSaid = normSender;
              encontro.firstSaidAt = Date.now();
              // define adversario
              const adversario = (normalizeJid(encontro.p1) === normSender) ? normalizeJid(encontro.p2) : normalizeJid(encontro.p1);
              // registramos que o adversario deve criar a sala (conforme regra solicitada)
              encontro.waitingFor = adversario;
              salvarBanco(db);
              try {
                await sock.sendMessage(from, {
                  text: `\u{1F4AC} @${normSender.split('@')[0]} falou "cria" primeiro — então @${adversario.split('@')[0]} vai criar a sala!`,
                  mentions: [normSender, adversario]
                });
              } catch (e) {
                // fallback sem mentions
                await sock.sendMessage(from, { text: `@${normSender.split('@')[0]} falou "cria" primeiro — então @${adversario.split('@')[0]} vai criar a sala!` });
              }
            }
          }
        } catch (e) {
          console.error('ERR handler "cria":', e && (e.stack || e));
        }
        // continue processing other handlers (no return)
      }

      // ====== HANDLER: jogador registra "GANHEI" para confrontos do camp
      if (isGroup && body.trim().toLowerCase() === 'ganhei') {
        try {
          const camp = db.camps[from];
          if (!camp || !camp.confrontos || !Array.isArray(camp.confrontos) || camp.confrontos.length === 0) {
            // nada a fazer
          } else {
            const normSender = normalizeJid(sender);
            // procura confronto onde sender é p1 ou p2 e ainda nao finalizado
            const idx = camp.confrontos.findIndex(c => (normalizeJid(c.p1) === normSender || normalizeJid(c.p2) === normSender) && !c.finished);
            if (idx === -1) {
              // se participante ja pertence mas ja foi finalizado
              const pertence = camp.confrontos.find(c => normalizeJid(c.p1) === normSender || normalizeJid(c.p2) === normSender);
              if (pertence) {
                await sock.sendMessage(from, { text: `\u2139\uFE0F Seu confronto já está marcado como finalizado.` });
              } else {
                // ignore se não participa
              }
            } else {
              const confronto = camp.confrontos[idx];
              // marca vencedor
              confronto.winner = normSender;
              confronto.finished = true;
              salvarBanco(db);
              const adversario = normalizeJid(confronto.p1) === normSender ? normalizeJid(confronto.p2 || '') : normalizeJid(confronto.p1 || '');
              try {
                await sock.sendMessage(from, {
                  text: `\u2705 Resultado registrado: @${normSender.split('@')[0]} venceu o JOGO ${idx+1}!`,
                  mentions: [normSender, adversario].filter(Boolean)
                });
              } catch (e) {
                await sock.sendMessage(from, { text: `Resultado registrado: @${normSender.split('@')[0]} venceu o JOGO ${idx+1}!` });
              }
              // Chama rotina para checar se todos os confrontos da fase terminaram e avançar
              await advanceCampRounds(db, from);
            }
          }
        } catch (e) {
          console.error('ERR handler "ganhei":', e && (e.stack || e));
        }
        // não retorna - permite outras rotinas caso necessario
      }

      // ====== HANDLER: jogadas do jogo da velha por numero (sem /)
      // OBS: atualizado para suportar IA (jogodavelhaia) fazendo jogadas automaticamente
      if (isGroup && /^[1-9]$/.test(body.trim())) {
        const jogoKey = from;
        const jogo = jogosVelha.get(jogoKey);
        if (jogo && (normalizeJid(sender) === normalizeJid(jogo.p1) || normalizeJid(sender) === normalizeJid(jogo.p2))) {
          const turnoAtual = jogo.turno === 'X' ? jogo.p1 : jogo.p2;
          if (normalizeJid(sender) !== normalizeJid(turnoAtual)) {
            return; // nao e a vez dele, ignora silenciosamente
          }
          const pos = parseInt(body.trim()) - 1;
          if (jogo.tabuleiro[pos] !== '.') {
            await sock.sendMessage(from, { text: '\u274C Posicao ja ocupada! Escolha outra (1-9).' });
            return;
          }
          jogo.tabuleiro[pos] = jogo.turno;
          const vencedor = checarVencedorVelha(jogo.tabuleiro);
          if (vencedor) {
            jogosVelha.delete(jogoKey);
            const vencedorJid = vencedor === 'X' ? jogo.p1 : jogo.p2;
            await sock.sendMessage(from, {
              text: `${renderTabuleiroVelha(jogo.tabuleiro)}\n\n\u{1F3C6} @${normalizeJid(vencedorJid).split('@')[0]} venceu o Jogo da Velha!`,
              mentions: [jogo.p1, jogo.p2]
            });
            return;
          }
          if (!jogo.tabuleiro.includes('.')) {
            jogosVelha.delete(jogoKey);
            await sock.sendMessage(from, {
              text: `${renderTabuleiroVelha(jogo.tabuleiro)}\n\n\u{1F91D} Empate! Ninguem venceu.`,
              mentions: [jogo.p1, jogo.p2]
            });
            return;
          }

          // Se o jogo for contra IA, faça a jogada da IA automaticamente
          if (jogo.ia) {
            // troca turno para a IA (O)
            jogo.turno = 'O';
            const iaPos = jogadaIA(jogo.tabuleiro);
            if (iaPos >= 0) jogo.tabuleiro[iaPos] = 'O';
            const vencedorIa = checarVencedorVelha(jogo.tabuleiro);
            if (vencedorIa) {
              jogosVelha.delete(jogoKey);
              await sock.sendMessage(from, {
                text: `${renderTabuleiroVelha(jogo.tabuleiro)}\n\n\u{1F916} A IA venceu! Tente novamente com /jogodavelhaia.`,
                mentions: [jogo.p1]
              });
              return;
            }
            if (!jogo.tabuleiro.includes('.')) {
              jogosVelha.delete(jogoKey);
              await sock.sendMessage(from, {
                text: `${renderTabuleiroVelha(jogo.tabuleiro)}\n\n\u{1F91D} Empate contra a IA!`,
                mentions: [jogo.p1]
              });
              return;
            }
            // volta turno para jogador (X)
            jogo.turno = 'X';
            await sock.sendMessage(from, {
              text: `${renderTabuleiroVelha(jogo.tabuleiro)}\n\n\u{1F916} IA jogou! Sua vez, @${normalizeJid(jogo.p1).split('@')[0]}.\nDigite um numero de 1 a 9 ou /jogo <numero>.`,
              mentions: [jogo.p1]
            });
            return;
          }

          // PvP - troca turno
          jogo.turno = jogo.turno === 'X' ? 'O' : 'X';
          const proximo = jogo.turno === 'X' ? jogo.p1 : jogo.p2;
          await sock.sendMessage(from, {
            text: `${renderTabuleiroVelha(jogo.tabuleiro)}\n\nVez de @${normalizeJid(proximo).split('@')[0]} (${jogo.turno})\nDigite um numero de 1 a 9.`,
            mentions: [proximo]
          });
          return;
        }
      }

      if (!db.camps[from]) db.camps[from] = null;
      if (!db.classificados[from]) db.classificados[from] = [];

      // camp signup
      if (isGroup && db.camps[from] && db.camps[from].status === true && !body.startsWith('/')) {
        const botJidNow = sock.user?.id ? normalizeJid(sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;

        if (m.key.fromMe || (sender && botJidNow && normalizeJid(sender) === botJidNow)) {
          return;
        }

        const camp = db.camps[from];
        const rawInput = body.trim();

        function parseCampSelection(raw, campObj) {
          if (!raw) return null;
          const text = raw.trim();

          const numMatch = text.match(/#\s*(\d+)|\b(\d{1,3})\b/);
          if (numMatch) {
            const num = parseInt(numMatch[1] || numMatch[2], 10);
            if (!isNaN(num) && num >= 1 && num <= (campObj.times || []).length) {
              return campObj.times[num - 1];
            }
          }

          for (const t of campObj.times || []) {
            if (t.e && text.includes(t.e)) return t;
          }

          const up = text.toUpperCase();
          let found = (campObj.times || []).find(t => up.includes((t.n || '').toUpperCase()));
          if (found) return found;

          const inputTokens = up.split(/[^A-Z0-9]+/).filter(Boolean);
          if (inputTokens.length > 0) {
            for (const t of (campObj.times || [])) {
              const nameTokens = (t.n || '').toUpperCase().split(/\s+/).filter(Boolean);
              if (nameTokens.some(nt => nt.length >= 2 && inputTokens.includes(nt))) return t;
            }
          }

          return null;
        }

        let selectedTeam = parseCampSelection(rawInput, camp);

        if (!selectedTeam) {
          const lastToken = rawInput.split(/\s+/).pop().replace(/[^\w#\d\u{1F300}-\u{1F9FF}\u2600-\u26FF]+/gu, '');
          if (lastToken) {
            selectedTeam = parseCampSelection(lastToken, camp);
          }
        }

        if (selectedTeam) {
          if (!camp.inscritos) camp.inscritos = {};
          if (!camp.inscritos[selectedTeam.n]) camp.inscritos[selectedTeam.n] = [];
          const normalizedSender = normalizeJid(sender);

          const already = Object.values(camp.inscritos).flat().some(j => normalizeJid(j) === normalizedSender);
          if (already) return;

          if (camp.inscritos[selectedTeam.n].length >= camp.limite) {
            await sock.sendMessage(from, { text: `\u274C Time ${selectedTeam.n} ja esta cheio.` });
            return;
          }

          camp.inscritos[selectedTeam.n].push(sender);
          db.camps[from] = camp;
          salvarBanco(db);

          let list = `\u{1F4DD} *LISTA ${camp.fase} ATUALIZADA:*\n\n`;
          camp.times.forEach((t, i) => {
            const players = (camp.inscritos[t.n] || []).map(j => "@" + normalizeJid(j).split('@')[0]).join(" & ") || "_(Vago)_";
            list += `${i+1}. ${t.e} ${t.n}: ${players}\n`;
          });

          const mentions = Object.values(camp.inscritos).flat();
          await sock.sendMessage(from, { text: list, mentions: mentions });

          const uniqueParticipantsMap = new Map();
          for (const arr of Object.values(camp.inscritos)) {
            for (const j of arr) {
              const nj = normalizeJid(j);
              if (!uniqueParticipantsMap.has(nj)) uniqueParticipantsMap.set(nj, j);
            }
          }
          const totalUnique = uniqueParticipantsMap.size;

          if (totalUnique >= (camp.vagas * camp.limite)) {
            camp.status = false;
            camp.stage = roundLabel(totalUnique);
            // build confrontos
            // IMPORTANT: shuffle participants to ensure RANDOM pairing every time
            let campParticipants = Array.from(uniqueParticipantsMap.values());
            campParticipants = shuffleArray(campParticipants);

            const confrontosArr = [];
            let res = `\u{1F3DF}\uFE0F *CONFRONTOS DEFINIDOS (${camp.fase})*\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n`;
            for (let i = 0; i < campParticipants.length; i += 2) {
              const p1 = campParticipants[i];
              const p2 = campParticipants[i+1] || null;
              // Agora armazenamos winner/finished para permitir continuidade automática
              confrontosArr.push({ p1: p1, p2: p2 || null, winner: null, finished: false, firstSaid: null, waitingFor: null });
              res += `\u26BD *JOGO ${Math.floor(i/2)+1}*\n@${normalizeJid(p1).split('@')[0]}  VS  ${p2 ? '@' + normalizeJid(p2).split('@')[0] : "_(Aguardando oponente)_"}\n\n`;
            }

            // attach previously configured rule (if any)
            const regra = (camp.regra && camp.regra.trim()) ? camp.regra.trim() : null;
            if (regra) {
              res += `\u{1F4D6} *REGRAS DO CAMP:*\n${regra}\n\n`;
            } else {
              res += `\u{1F4D6} *REGRAS DO CAMP:*\n_Nenhuma regra definida. Use /addregra <texto> para adicionar._\n\n`;
            }

            res += `\u2139\uFE0F Digite "cria" no chat (sem barra) para sinalizar sua preferencia. O primeiro a digitar "cria" em cada confronto sera registrado e o bot indicara quem deve criar a sala.\n`;
            res += `\u2139\uFE0F Quando o jogador vencer seu confronto, digite "GANHEI" (sem barra) para registrar o resultado. O bot avançará automaticamente as fases até se chegar ao campeão.\n`;

            // save confrontos no DB dentro do camp (para interacao com comando "cria")
            db.camps[from] = { ...camp, confrontos: confrontosArr, status: false };
            salvarBanco(db);

            await sock.sendMessage(from, { text: res, mentions: campParticipants });

            // Caso existam confrontos com p2 == null (bye), avance automaticamente
            await advanceCampRounds(db, from);
          }
        } else {
          return;
        }
        return;
      }

      // parse command
      // Updated: supports per-group prefix (db.prefixes[from]) and always accepts '/' as fallback
      let matchedPrefix = null;
      let usedPrefix = null;
      if (isGroup && db.prefixes && db.prefixes[from]) {
        // try group prefix first (could be multiple chars)
        const gp = db.prefixes[from];
        if (body.startsWith(gp)) matchedPrefix = gp;
      }
      if (!matchedPrefix && body.startsWith('/')) matchedPrefix = '/';
      if (!matchedPrefix) {
        // not a command
        return;
      }
      usedPrefix = matchedPrefix;
      const argv = body.slice(usedPrefix.length).trim().split(/ +/);
      const command = (argv.shift() || '').toLowerCase();
      const args = argv;

      // soadm restriction
      if (isGroup && db.soadm && db.soadm[from] && !temPoder && !isParceiro) {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin && !isParceiro) {
          await sock.sendMessage(from, { text: "\u274C Este grupo esta no modo *SO ADMIN*. Apenas administradores, dono ou parceiros podem usar comandos." });
          return;
        }
      }

      // ---------- commands ----------

      // /chance
      if (command === 'chance' || command === 'chances') {
        await handlePercentPlayCommand({
          sock, m, from, sender, args,
          category: 'hetero',
          labelText: 'CHANCE',
          defaultPhrase: 'Chance'
        });
        return;
      }

      // /fabulous
      if (command === 'fabulous') {
        const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const target = (mentioned.length ? mentioned[0] : null) || (args[0] ? (args[0].replace(/[@]/g,'') + '@s.whatsapp.net') : null) || sender;
        try {
          const percent = Math.floor(Math.random()*101);
          const phraseList = frases.fabulous || ["Brilho!"];
          const phrase = phraseList[Math.floor(Math.random()*phraseList.length)];
          const j = normalizeJid(target);
          const caption = `@${j.split('@')[0]}\n${phrase}\n\u{1F449} Resultado: *${percent}%*`;
          const ppUrl = await tentarPerfilFotoUrl(sock, target);
          if (ppUrl) {
            const buf = await fetchBuffer(ppUrl);
            const overlay = await createPercentImageWithFlag(buf, percent, 'Fabulous Level', { rainbow: true });
            await sendProfileWithOverlay(sock, from, target, overlay, caption, [target]);
          } else {
            await sock.sendMessage(from, { text: caption, mentions: [target] });
          }
        } catch (e) {
          console.error('ERR /fabulous:', e && e.stack);
          await sock.sendMessage(from, { text: '\u274C Erro ao processar /fabulous.' });
        }
        return;
      }

      // block /gay / /hetero
      if (command === 'gay' || command === 'hetero') {
        await sock.sendMessage(from, { text: "\u274C Nao vou criar classificacoes sobre orientacao sexual. Use /fabulous @user para uma brincadeira respeitosa com bandeira colorida." });
        return;
      }

      // /sorte / /meme / /amizade
      if (command === 'sorte' || command === 'meme' || command === 'amizade') {
        const key = command === 'amizade' ? 'amizade' : command;
        const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const target = (mentioned.length ? mentioned[0] : null) || (args[0] ? (args[0].replace(/[@]/g,'') + '@s.whatsapp.net') : null) || sender;
        const percent = Math.floor(Math.random()*101);
        const phraseList = frases[key] || ["Diversao!"];
        const phrase = phraseList[Math.floor(Math.random()*phraseList.length)];
        const j = normalizeJid(target);
        const caption = `@${j.split('@')[0]}\n${phrase}\n\u{1F449} Resultado: *${percent}%*`;
        const ppUrl = await tentarPerfilFotoUrl(sock, target);
        if (ppUrl) {
          try {
            const buf = await fetchBuffer(ppUrl);
            const overlay = await createPercentImageWithFlag(buf, percent, key.charAt(0).toUpperCase() + key.slice(1), { rainbow: false });
            await sendProfileWithOverlay(sock, from, target, overlay, caption, [target]);
          } catch (e) {
            await sock.sendMessage(from, { text: caption, mentions: [target] });
          }
        } else {
          await sock.sendMessage(from, { text: caption, mentions: [target] });
        }
        return;
      }

      // menu/help
      if (command === 'menu' || command === 'help') {
        const menu = buildMenuNice();
        if (fs.existsSync(MENU_IMAGE_FILE)) await sock.sendMessage(from, { image: fs.readFileSync(MENU_IMAGE_FILE), caption: menu });
        else await sock.sendMessage(from, { text: menu });

        // REMOVIDO: envio automático do "TOP 5 - MENSAGENS (GRUPO)" conforme solicitado.
        return;
      }

      // rank/top
      if (command === 'rank' || command === 'top') {
        if (!isGroup) {
          await sock.sendMessage(from, { text: "\u2139\uFE0F O comando /rank funciona melhor em grupos (mostra dados do grupo)." });
          if (!db.ranking[from] || Object.keys(db.ranking[from]).length === 0) {
            const sample = buildSampleRankTable();
            await sock.sendMessage(from, { text: sample });
            return;
          }
        }

        let participants = [];
        try {
          metadataCache.delete(from);
          const md = await getGroupMetadata(sock, from);
          participants = (md?.participants || []).map(p => normalizeJid(p.id || p.jid || p.participant)).filter(Boolean);
        } catch (e) {
          participants = [];
        }

        const rankingMap = db.ranking[from] || {};
        const entries = Object.entries(rankingMap).filter(([jid]) => {
          if (!isGroup) return true;
          return participants.includes(normalizeJid(jid));
        }).sort((a,b) => b[1]-a[1]);
        const topMsgs = entries.slice(0,10);
        if (!topMsgs || topMsgs.length === 0) {
          const sample = buildSampleRankTable();
          await sock.sendMessage(from, { text: sample });
        } else {
          let txt = "\u{1F3C6} *RANKING - TOP 10 MENSAGENS*\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n";
          topMsgs.forEach(([jid, count], idx) => { txt += `${idx+1}\u00BA @${normalizeJid(jid).split('@')[0]} \u2014 ${count} msgs\n`; });
          await sock.sendMessage(from, { text: txt, mentions: topMsgs.map(t => normalizeJid(t[0])) });
        }

        return;
      }

      // zerarank
      if (command === 'zerarank' || command === 'resetarank' || command === 'reset-rank') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores/dono podem zerar o ranking." }); return; }
        db.ranking[from] = {};
        salvarBanco(db);
        const sample = buildSampleRankTable();
        await sock.sendMessage(from, { text: `\u2705 Ranking zerado com sucesso.\n\n${sample}` });
        return;
      }

      // camp start / camp cancelar (/fcamp)
      if (command === 'camp') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas admins podem iniciar camp." }); return; }
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'cancelar' || sub === 'fechar' || sub === 'stop') {
          if (db.camps[from]) {
            db.camps[from] = null;
            salvarBanco(db);
            await sock.sendMessage(from, { text: "\u2705 Camp cancelado neste grupo." });
          } else {
            await sock.sendMessage(from, { text: "\u2139\uFE0F Nao ha camp ativo para cancelar neste grupo." });
          }
          return;
        }
        const modo = (args[0] || 'x1').toLowerCase();
        const vagas = parseInt(args[1]) || 4;
        const limite = modo === 'x2' ? 2 : modo === 'x3' ? 3 : 1;
        const times = bancoTimes.slice().sort(() => 0.5 - Math.random()).slice(0, vagas);
        const timesNorm = times.map(t => ({ n: (t.n || '').toUpperCase(), e: t.e }));
        const novoCamp = { status:true, fase:modo.toUpperCase(), vagas, limite, times: timesNorm, inscritos:{}, stage:'OPEN', currentRound: [], regra: (db.camps && db.camps[from] && db.camps[from].regra) ? db.camps[from].regra : null };
        timesNorm.forEach(t => novoCamp.inscritos[t.n] = []);
        db.camps[from] = novoCamp;
        salvarBanco(db);
        let msgIni = `\u{1F3C6} *CAMP ${novoCamp.fase} ABERTO* \n\n`;
        novoCamp.times.forEach((t, i) => msgIni += `${i+1}. ${t.e} #${i+1} ${t.n}\n`);
        await sock.sendMessage(from, { text: msgIni });
        return;
      }
      if (command === 'fcamp') {
        // alias para cancelar camp (uso: /fcamp cancelar || simplesmente /fcamp para instrucoes)
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas admins podem cancelar camp." }); return; }
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'cancelar' || sub === 'fechar' || sub === 'stop') {
          if (db.camps[from]) {
            db.camps[from] = null;
            salvarBanco(db);
            await sock.sendMessage(from, { text: "\u2705 Camp cancelado neste grupo (fcamp)." });
          } else {
            await sock.sendMessage(from, { text: "\u2139\uFE0F Nao ha camp ativo neste grupo." });
          }
        } else {
          await sock.sendMessage(from, { text: "\u2139\uFE0F Uso: /fcamp cancelar  -> cancela o camp atual no grupo" });
        }
        return;
      }

      // ===== NOVO: /r-camp -> remove participante do camp atual (apenas admins)
      if (command === 'r-camp' || command === 'rcamp' || command === 'r_camp') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando apenas em grupos." }); return; }
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores podem remover participantes do camp." }); return; }
        const target = resolveTargetJidFromMessage(m, args);
        if (!target) { await sock.sendMessage(from, { text: "\u274C Marque ou responda a mensagem do participante a ser removido. Uso: /r-camp @usuario" }); return; }
        if (!db.camps[from] || !db.camps[from].inscritos) { await sock.sendMessage(from, { text: "\u2139\uFE0F Nao ha camp ativo neste grupo." }); return; }

        const normTarget = normalizeJid(target);
        let removed = false;
        for (const team of Object.keys(db.camps[from].inscritos || {})) {
          const arr = db.camps[from].inscritos[team] || [];
          const filtered = arr.filter(j => normalizeJid(j) !== normTarget);
          if (filtered.length !== arr.length) {
            db.camps[from].inscritos[team] = filtered;
            removed = true;
          }
        }

        if (removed) {
          salvarBanco(db);
          // envia confirmacao e lista atualizada
          await sock.sendMessage(from, { text: `\u2705 @${normTarget.split('@')[0]} removido do camp.`, mentions: [normTarget] });

          let list = `\u{1F4DD} *LISTA ${db.camps[from].fase} ATUALIZADA:*\n\n`;
          (db.camps[from].times || []).forEach((t, i) => {
            const players = (db.camps[from].inscritos[t.n] || []).map(j => "@" + normalizeJid(j).split('@')[0]).join(" & ") || "_(Vago)_";
            list += `${i+1}. ${t.e} ${t.n}: ${players}\n`;
          });

          const mentions = Object.values(db.camps[from].inscritos || {}).flat();
          await sock.sendMessage(from, { text: list, mentions });
        } else {
          await sock.sendMessage(from, { text: `\u2139\uFE0F @${normTarget.split('@')[0]} nao esta inscrito no camp atual.`, mentions: [normTarget] });
        }
        return;
      }

      // regras
      if (command === 'regras') {
        await sock.sendMessage(from, { text: "\u{1F4DC} *REGRAS DO CAMP*\n\n1. Respeite os adversarios.\n2. Mande o print e escreva GANHEI.\n3. Prazo de registro conforme combinado." });
        return;
      }

      // bem-vindos / adeus
      if (command === 'bem-vindos' || command === 'bemvindos' || command === 'bem-vindo' || command === 'bemvindo') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando apenas em grupos." }); return; }
        const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores/dono podem configurar bem-vindos." }); return; }
        const text = args.join(' ').trim();
        if (!text) {
          const current = db.bemvindos && db.bemvindos[from] ? db.bemvindos[from] : null;
          if (current) await sock.sendMessage(from, { text: `\u{1F4CC} Mensagem de boas-vindas atual:\n\n${current}` });
          else await sock.sendMessage(from, { text: "\u2139\uFE0F Mensagem de boas-vindas nao definida. Use /bem-vindos <texto> para definir (use @user no texto)." });
          return;
        }
        if (text.toLowerCase() === 'off' || text === '0') {
          if (db.bemvindos && db.bemvindos[from]) { delete db.bemvindos[from]; salvarBanco(db); await sock.sendMessage(from, { text: "\u2705 Boas-vindas desativadas neste grupo." }); }
          else await sock.sendMessage(from, { text: "\u2139\uFE0F Boas-vindas ja estao desativadas neste grupo." });
          return;
        }
        db.bemvindos = db.bemvindos || {};
        db.bemvindos[from] = text;
        salvarBanco(db);
        await sock.sendMessage(from, { text: `\u2705 Mensagem de boas-vindas definida:\n\n${text}\n\nDica: use @user para mencionar o novo membro.` });
        return;
      }
      if (command === 'adeus') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando apenas em grupos." }); return; }
        const senderIsAdmin2 = isOwner || await isUserAdminCached(sock, from, sender);
        if (!senderIsAdmin2) { await sock.sendMessage(from, { text: "\u274C Apenas administradores/dono podem configurar adeus." }); return; }
        const text2 = args.join(' ').trim();
        if (!text2) {
          const current = db.adeus && db.adeus[from] ? db.adeus[from] : null;
          if (current) await sock.sendMessage(from, { text: `\u{1F4CC} Mensagem de adeus atual:\n\n${current}` });
          else await sock.sendMessage(from, { text: "\u2139\uFE0F Mensagem de adeus nao definida. Use /adeus <texto> para definir (use @user no texto)." });
          return;
        }
        if (text2.toLowerCase() === 'off' || text2 === '0') {
          if (db.adeus && db.adeus[from]) { delete db.adeus[from]; salvarBanco(db); await sock.sendMessage(from, { text: "\u2705 Mensagem de adeus desativada neste grupo." }); }
          else await sock.sendMessage(from, { text: "\u2139\uFE0F Mensagem de adeus ja esta desativada neste grupo." });
          return;
        }
        db.adeus = db.adeus || {};
        db.adeus[from] = text2;
        salvarBanco(db);
        await sock.sendMessage(from, { text: `\u2705 Mensagem de adeus definida:\n\n${text2}\n\nDica: use @user para mencionar o membro que saiu.` });
        return;
      }

      // toimg
      if (command === 'toimg') {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const stickerMsg = m.message.stickerMessage || quoted?.stickerMessage;
        if (!stickerMsg) { await sock.sendMessage(from, { text: "\u274C Responda a uma figurinha (.webp) para converter." }); return; }
        try {
          const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
          let buffer = Buffer.from([]);
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          const outBuffer = await sharp(buffer, { animated: true, pages: 1 }).png().toBuffer();
          await sock.sendMessage(from, { image: outBuffer, caption: "\u{1F5BC}\uFE0F Aqui esta a imagem da figurinha." });
        } catch (e) { console.error(e); await sock.sendMessage(from, { text: "\u274C Falha ao converter figurinha." }); }
        return;
      }

      // togif
      if (command === 'togif') {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const stickerMsg = m.message.stickerMessage || quoted?.stickerMessage;
        if (!stickerMsg) { await sock.sendMessage(from, { text: "\u274C Responda a uma figurinha animada para converter." }); return; }
        try {
          const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
          let buffer = Buffer.from([]);
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          if (!ffmpegPath) {
            // Inform the user that ffmpeg is needed for full conversion, but still send the first frame as fallback
            const outPng = tmpFile('png');
            await sharp(buffer, { animated: true }).png().toFile(outPng);
            const img = fs.readFileSync(outPng); try { fs.unlinkSync(outPng); } catch (e) {}
            await sock.sendMessage(from, { image: img, caption: "\u26A0\uFE0F ffmpeg nao disponivel \u2014 enviei primeiro frame. Instale ffmpeg ou ffmpeg-static para converter figurinha animada para GIF." });
            return;
          }
          const inFile = tmpFile('webp'), outFile = tmpFile('gif'); fs.writeFileSync(inFile, buffer);
          await new Promise((res, rej) => execFile(ffmpegPath, ['-y','-i',inFile,'-r','15', outFile], (err) => err?rej(err):res()));
          const gifBuf = fs.readFileSync(outFile);
          await sock.sendMessage(from, { document: gifBuf, fileName: 'sticker.gif', mimetype: 'image/gif', caption: "\u{1F39E}\uFE0F GIF da figurinha animada." });
          try { fs.unlinkSync(inFile); } catch {} try { fs.unlinkSync(outFile); } catch {}
        } catch (e) { console.error(e); await sock.sendMessage(from, { text: "\u274C Falha ao processar figurinha animada. Verifique se ffmpeg esta instalado." }); }
        return;
      }

      // vervisu (view-once)
      if (command === 'vervisu' || command === 'ver-visu') {
        const found = findViewOnceNode(m.message) || findViewOnceNode(m.message?.extendedTextMessage?.contextInfo) || findViewOnceNode(m.message?.contextInfo);
        if (!found) { await sock.sendMessage(from, { text: "\u274C Responda a uma mensagem de visualizacao unica (view-once) valida." }); return; }
        try {
          const type = (found.vType || '').replace('Message','').toLowerCase();
          const stream = await downloadContentFromMessage(found.mediaNode, type);
          let buffer = Buffer.from([]);
          for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          if (found.vType === 'imageMessage') await sock.sendMessage(from, { image: buffer, caption: "\u{1F513} *Visualizacao Aberta!*" });
          else if (found.vType === 'videoMessage') await sock.sendMessage(from, { video: buffer, caption: "\u{1F513} *Visualizacao Aberta!*" });
          else if (found.vType === 'audioMessage') await sock.sendMessage(from, { audio: buffer, caption: "\u{1F513} *Audio recuperado!*" });
          else await sock.sendMessage(from, { document: buffer, fileName: 'visualizacao.dat', mimetype: found.mediaNode.mimetype || 'application/octet-stream', caption: "\u{1F513} *Visualizacao Aberta!*" });
        } catch (err) { console.error('ERR vervisu:', err && (err.stack || err)); await sock.sendMessage(from, { text: "\u274C Falha ao abrir a visualizacao. Talvez ja tenha sido aberta ou o WhatsApp nao permita mais o acesso." }); }
        return;
      }

      // sticker /s (reply)
      if (command === 's') {
        const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const imageMsg = m.message.imageMessage || quoted?.imageMessage;
        const videoMsg = m.message.videoMessage || quoted?.videoMessage;
        const stickerQuoted = m.message.stickerMessage || quoted?.stickerMessage;
        if (stickerQuoted) {
          try {
            const stream = await downloadContentFromMessage(stickerQuoted, 'sticker'); let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(from, { sticker: buffer });
          } catch (e) { console.error(e); await sock.sendMessage(from, { text: "\u274C Nao consegui processar a figurinha." }); }
          return;
        }
        const msgToDownload = imageMsg || videoMsg;
        if (!msgToDownload) { await sock.sendMessage(from, { text: "\u274C Responda a uma imagem/GIF/video para criar figurinha." }); return; }
        try {
          const isVideo = Boolean(videoMsg);
          const mimetype = (imageMsg?.mimetype || videoMsg?.mimetype || '').toLowerCase();
          const isGif = mimetype.includes('gif');
          const type = isVideo ? 'video' : 'image';
          const stream = await downloadContentFromMessage(msgToDownload, type);
          let buffer = Buffer.from([]); for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
          if (isVideo || isGif) {
            try {
              // converter para sticker animado - limitar duração ao converter
              await createStickerFromBuffer(sock, from, buffer, true);
            }
            catch (err) {
              console.error(err);
              // O createStickerFromBuffer já faz fallback para estático; se throw aqui, informar o usuário
              await sock.sendMessage(from, { text: "\u274C Erro ao criar figurinha animada. Verifique ffmpeg." });
            }
          }
          else {
            try { await createStickerFromBuffer(sock, from, buffer, false); }
            catch (err) { console.error(err); await sock.sendMessage(from, { text: "\u274C Nao foi possivel criar a figurinha deste arquivo." }); }
          }
        } catch (e) { console.error(e); await sock.sendMessage(from, { text: "\u274C Erro ao criar figurinha." }); }
        return;
      }

      // ADMIN/MODERATION - promote / demote / tiraadm
      if (command === 'rebaixar' || command === 'demote') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) return;
        const target = resolveTargetJidFromMessage(m, args);
        if (!target) { await sock.sendMessage(from, { text: "\u274C Marque alguem para rebaixar." }); return; }
        try { await sock.groupParticipantsUpdate(from, [normalizeJid(target)], "demote"); await sock.sendMessage(from, { text: `\u2705 @${normalizeJid(target).split('@')[0]} rebaixado.`, mentions:[normalizeJid(target)] }); } catch { await sock.sendMessage(from, { text: "\u274C Falha ao rebaixar (verifique permissoes)." }); }
        return;
      }

      if (command === 'promover' || command === 'promote') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) return;
        const target = resolveTargetJidFromMessage(m, args);
        if (!target) { await sock.sendMessage(from, { text: "\u274C Marque alguem para promover." }); return; }
        try { await sock.groupParticipantsUpdate(from, [normalizeJid(target)], "promote"); await sock.sendMessage(from, { text: `\u2705 @${normalizeJid(target).split('@')[0]} promovido.`, mentions:[normalizeJid(target)] }); } catch { await sock.sendMessage(from, { text: "\u274C Falha ao promover (verifique permissoes)." }); }
        return;
      }

      if (command === 'tiraadm' || command === 'tira-adm') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) return;
        const target = resolveTargetJidFromMessage(m, args);
        if (!target) { await sock.sendMessage(from, { text: "\u274C Marque alguem para tirar ADM." }); return; }
        try { await sock.groupParticipantsUpdate(from, [normalizeJid(target)], "demote"); await sock.sendMessage(from, { text: `\u2705 @${normalizeJid(target).split('@')[0]} teve ADM removido.`, mentions:[normalizeJid(target)] }); } catch { await sock.sendMessage(from, { text: "\u274C Falha ao remover ADM (verifique permissoes)." }); }
        return;
      }

      // mute/unmute
      if (command === 'mute') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) return;
        const target = resolveTargetJidFromMessage(m, args);
        if (!target) { await sock.sendMessage(from, { text: "\u274C Marque alguem para mutar." }); return; }
        db.muted[from] = db.muted[from] || [];
        if (!db.muted[from].includes(normalizeJid(target))) { db.muted[from].push(normalizeJid(target)); salvarBanco(db); await sock.sendMessage(from, { text: `\u{1F507} @${normalizeJid(target).split('@')[0]} foi mutado (bot apagara mensagens).`, mentions:[normalizeJid(target)] }); } else { await sock.sendMessage(from, { text: `\u2139\uFE0F @${normalizeJid(target).split('@')[0]} ja esta mutado.`, mentions:[normalizeJid(target)] }); }
        return;
      }
      if (command === 'unmute') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) return;
        const target = resolveTargetJidFromMessage(m, args);
        if (!target) { await sock.sendMessage(from, { text: "\u274C Marque alguem para desmutar." }); return; }
        db.muted[from] = db.muted[from] || [];
        if (db.muted[from].includes(normalizeJid(target))) { db.muted[from] = db.muted[from].filter(j => j !== normalizeJid(target)); salvarBanco(db); await sock.sendMessage(from, { text: `\u{1F50A} @${normalizeJid(target).split('@')[0]} foi desmutado.`, mentions:[normalizeJid(target)] }); } else { await sock.sendMessage(from, { text: `\u2139\uFE0F @${normalizeJid(target).split('@')[0]} nao esta mutado.`, mentions:[normalizeJid(target)] }); }
        return;
      }
      if (command === 'mutelist' || command === 'mutados') {
        const list = db.muted[from] && db.muted[from].length > 0 ? db.muted[from].map(j => "\u00BB @" + j.split('@')[0]).join("\n") : "_Nenhum usuario mutado neste grupo._";
        await sock.sendMessage(from, { text: `\u{1F507} *USUARIOS MUTADOS:*\n\n${list}`, mentions: db.muted[from] || [] });
        return;
      }

      // parceiro / parcerias (per-group)
      if (command === 'parceiro') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando em grupos." }); return; }
        if (!senderIsAdmin) return;
        const pJid = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!pJid) { await sock.sendMessage(from, { text: "\u274C Marque alguem para adicionar como parceiro." }); return; }
        db.parceiros[from] = db.parceiros[from] || [];
        if (!db.parceiros[from].includes(normalizeJid(pJid))) { db.parceiros[from].push(normalizeJid(pJid)); salvarBanco(db); await sock.sendMessage(from, { text: `\u{1F91D} @${normalizeJid(pJid).split('@')[0]} adicionado como parceiro neste grupo.`, mentions:[normalizeJid(pJid)] }); } else { await sock.sendMessage(from, { text: `\u2139\uFE0F @${normalizeJid(pJid).split('@')[0]} ja e parceiro neste grupo.`, mentions:[normalizeJid(pJid)] }); }
        return;
      }
      if (command === 'parcerias') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando em grupos." }); return; }
        db.parceiros[from] = db.parceiros[from] || [];
        let pList = "\u{1F91D} *PARCEIROS DESTE GRUPO:*\n\n";
        if (db.parceiros[from].length) pList += db.parceiros[from].map(p => "\u00BB @" + p.split('@')[0]).join("\n"); else pList += "_Nenhum parceiro definido neste grupo_";
        await sock.sendMessage(from, { text: pList, mentions: db.parceiros[from] });
        return;
      }

      // adv / r-adv (por grupo)
      if (command === 'adv') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores podem advertir." }); return; }
        const uAdvRaw = resolveTargetJidFromMessage(m, args);
        if (!uAdvRaw) { await sock.sendMessage(from, { text: "\u274C Marque alguem para advertir." }); return; }
        const uAdv = normalizeJid(uAdvRaw);

        db.advertencias = db.advertencias || {};
        db.advertencias[from] = db.advertencias[from] || {};
        db.advertencias[from][uAdv] = (db.advertencias[from][uAdv] || 0) + 1;
        salvarBanco(db);

        const count = db.advertencias[from][uAdv] || 0;
        if (count >= 3) {
          try {
            await sock.groupParticipantsUpdate(from, [uAdv], "remove");
          } catch (err) {
            console.error('ERR ADV BAN:', err && (err.stack || err));
          }
          delete db.advertencias[from][uAdv];
          salvarBanco(db);
          await sock.sendMessage(from, { text: `\u{1F6AB} @${uAdv.split('@')[0]} foi banido por atingir 3 advertencias!`, mentions:[uAdv] });
        } else {
          await sock.sendMessage(from, { text: `\u26A0\uFE0F @${uAdv.split('@')[0]} recebeu uma advertencia! [${count}/3]`, mentions:[uAdv] });
        }
        return;
      }
      if (command === 'r-adv') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores podem remover advertencia." }); return; }
        const urAdvRaw = resolveTargetJidFromMessage(m, args);
        if (!urAdvRaw) { await sock.sendMessage(from, { text: "\u274C Marque alguem para remover advertencia." }); return; }
        const urAdv = normalizeJid(urAdvRaw);
        db.advertencias = db.advertencias || {};
        db.advertencias[from] = db.advertencias[from] || {};
        if (db.advertencias[from][urAdv] && db.advertencias[from][urAdv] > 0) {
          db.advertencias[from][urAdv]--;
          if (db.advertencias[from][urAdv] <= 0) delete db.advertencias[from][urAdv];
          salvarBanco(db);
          await sock.sendMessage(from, { text: `\u2705 Advertencia de @${urAdv.split('@')[0]} removida.`, mentions:[urAdv] });
        } else {
          await sock.sendMessage(from, { text: `\u2139\uFE0F @${urAdv.split('@')[0]} nao possui advertencias neste grupo.`, mentions:[urAdv] });
        }
        return;
      }

      // antilink toggles
      if (command === 'antilink') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Comando disponivel apenas em grupos." }); return; }
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores podem alterar essa opcao." }); return; }
        db.antilink = Array.isArray(db.antilink) ? db.antilink : [];
        if (db.antilink.includes(from)) { db.antilink = db.antilink.filter(g => g !== from); salvarBanco(db); await sock.sendMessage(from, { text: "\u2705 Antilink (Ban) desativado." }); } else { db.antilink.push(from); db.antilinkApaga = (db.antilinkApaga || []).filter(g => g !== from); salvarBanco(db); await sock.sendMessage(from, { text: "\u2705 Antilink (Ban) ativado. Quem enviar link sera removido." }); }
        return;
      }
      if (command === 'antilinkapaga' || command === 'antilinkapagar') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Comando disponivel apenas em grupos." }); return; }
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores podem alterar essa opcao." }); return; }
        db.antilinkApaga = Array.isArray(db.antilinkApaga) ? db.antilinkApaga : [];
        if (db.antilinkApaga.includes(from)) { db.antilinkApaga = db.antilinkApaga.filter(g => g !== from); salvarBanco(db); await sock.sendMessage(from, { text: "\u2705 Antilink (Apagar) desativado." }); } else { db.antilinkApaga.push(from); db.antilink = (db.antilink || []).filter(g => g !== from); salvarBanco(db); await sock.sendMessage(from, { text: "\u2705 Antilink (Apagar) ativado. Links serao apagados automaticamente." }); }
        return;
      }

      // soadm
      if (command === 'soadm') {
        const senderIsAdmin = isOwner || (isGroup ? await isUserAdminCached(sock, from, sender) : false);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores." }); return; }
        const flag = args[0];
        if (!flag || (flag !== '1' && flag !== '0')) { await sock.sendMessage(from, { text: "\u274C Uso: /soadm 1 | /soadm 0" }); return; }
        db.soadm[from] = flag === '1'; salvarBanco(db);
        await sock.sendMessage(from, { text: db.soadm[from] ? "\u2705 Modo SO ADMIN ativado." : "\u2705 Modo SO ADMIN desativado." });
        return;
      }

      // abrir / fechar
      if (command === 'abrir') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Este comando funciona apenas em grupos." }); return; }
        const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores podem abrir o grupo." }); return; }
        try { await sock.groupSettingUpdate(from, 'not_announcement'); await sock.sendMessage(from, { text: "\u{1F513} Grupo aberto para todos os membros!" }); } catch (e) { await sock.sendMessage(from, { text: "\u274C Falha ao abrir (verifique permissoes)." }); }
        return;
      }
      if (command === 'fechar') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Este comando funciona apenas em grupos." }); return; }
        const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores podem fechar o grupo." }); return; }
        try { await sock.groupSettingUpdate(from, 'announcement'); await sock.sendMessage(from, { text: "\u{1F512} Grupo fechado! Apenas administradores podem enviar mensagens." }); } catch (e) { await sock.sendMessage(from, { text: "\u274C Falha ao fechar (verifique permissoes)." }); }
        return;
      }

      // /off
      if (command === 'off' || command === 'desligar') {
        if (isGroup) {
          const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
          if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores ou o dono do bot podem usar /off neste grupo." }); return; }
          db.gruposDesativados = db.gruposDesativados || [];
          const already = db.gruposDesativados.includes(from);
          if (!already) {
            db.gruposDesativados.push(from);
            salvarBanco(db);
            if (!isOwner) {
              await sock.sendMessage(from, { text: "\u26A0\uFE0F Bot desativado neste grupo. Use /on para reativar." });
            }
          } else {
            db.gruposDesativados = db.gruposDesativados.filter(g => g !== from);
            salvarBanco(db);
            await sock.sendMessage(from, { text: "\u2705 Bot reativado neste grupo." });
          }
          return;
        } else {
          const isOwnerCmd = sender === db.owner;
          if (!isOwnerCmd) {
            await sock.sendMessage(from, { text: "\u274C Apenas o dono do bot pode desligar globalmente." });
            return;
          }
          try {
            await sock.sendMessage(from, { text: "\u26A0\uFE0F Desligando o bot... Ate mais!" });
          } catch (e) { }
          setTimeout(() => {
            try { process.exit(0); } catch (e) { }
          }, 800);
          return;
        }
      }

      // ============================
      // /auto - agenda mensagens diarias por grupo
      // ============================
      if (command === 'auto') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C /auto funciona apenas em grupos." }); return; }
        const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores/dono podem configurar /auto." }); return; }
        const sub = args[0];
        if (!sub) {
          const current = db.autos[from];
          if (current && current.active) {
            await sock.sendMessage(from, { text: `\u2139\uFE0F Auto ativo: ${current.time} - ${current.text}` });
          } else {
            await sock.sendMessage(from, { text: "\u2139\uFE0F Uso: /auto <HH[:MM]> <texto>\nEx: /auto 08:30 Bom dia!\nOu /auto off para desativar." });
          }
          return;
        }
        if (sub.toLowerCase() === 'off') {
          if (db.autos && db.autos[from]) {
            db.autos[from].active = false;
            salvarBanco(db);
            await sock.sendMessage(from, { text: "\u2705 Auto desativado para este grupo." });
          } else {
            await sock.sendMessage(from, { text: "\u2139\uFE0F Nenhum auto estava configurado para este grupo." });
          }
          return;
        }
        // parse time
        const timeRaw = sub;
        const timeMatch = timeRaw.match(/^(\d{1,2})(?::(\d{2}))?$/);
        if (!timeMatch) {
          await sock.sendMessage(from, { text: "\u274C Hora inválida. Use HH ou HH:MM (ex: 9 ou 09:30)." });
          return;
        }
        let hh = parseInt(timeMatch[1], 10);
        let mm = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
          await sock.sendMessage(from, { text: "\u274C Hora inválida. Use HH:MM entre 00:00 e 23:59." });
          return;
        }
        hh = String(hh).padStart(2,'0');
        mm = String(mm).padStart(2,'0');
        const text = args.slice(1).join(' ').trim();
        if (!text) { await sock.sendMessage(from, { text: "\u274C Forneça a mensagem a ser enviada. Ex: /auto 20:30 Boa noite!" }); return; }

        db.autos = db.autos || {};
        // salva o horário no formato HH:MM (considerado em America/Sao_Paulo)
        db.autos[from] = { time: `${hh}:${mm}`, text, active: true, lastSent: null };
        salvarBanco(db);
        await sock.sendMessage(from, { text: `\u2705 Auto agendado: ${hh}:${mm} - "${text}"\nUse /auto off para desativar.` });
        return;
      }

      // ============================
      // PREFIXO POR GRUPO: /setprefix
      // ============================
      if (['setprefix','set-prefix','prefix','setprefixo'].includes(command)) {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Este comando funciona apenas em grupos." }); return; }
        const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores podem alterar o prefixo do grupo." }); return; }
        const newPrefix = (args[0] || '').trim();
        if (!newPrefix) {
          const current = (db.prefixes && db.prefixes[from]) ? db.prefixes[from] : '/';
          await sock.sendMessage(from, { text: `\u2139\uFE0F Prefixo atual deste grupo: "${current}"\nUso: /setprefix <novoPrefixo>\nEx: /setprefix !` });
          return;
        }
        if (newPrefix.length > 5) { await sock.sendMessage(from, { text: "\u274C Prefixo muito longo (max 5 caracteres)." }); return; }
        db.prefixes = db.prefixes || {};
        db.prefixes[from] = newPrefix;
        salvarBanco(db);
        await sock.sendMessage(from, { text: `\u2705 Prefixo do grupo alterado para: "${newPrefix}"\nVocê poderá usar "${newPrefix}comando" a partir de agora (ou ainda "/" como fallback).` });
        return;
      }

      if (command === 'getprefix') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando em grupos." }); return; }
        const current = (db.prefixes && db.prefixes[from]) ? db.prefixes[from] : '/';
        await sock.sendMessage(from, { text: `\u2139\uFE0F Prefixo atual deste grupo: "${current}"` });
        return;
      }

      // ============================
      // CITAR - menciona todos
      // ============================
      if (['citar','marcar','marca','tag-all','hidetag'].includes(command)) {
        if (!isGroup) {
          await sock.sendMessage(from, { text: "\u274C Comando disponivel apenas em grupos." });
          return;
        }

        try {
          metadataCache.delete(from);
          const md = await getGroupMetadata(sock, from);
          if (!md || !md.participants) {
            await sock.sendMessage(from, { text: "\u274C Nao consegui obter a lista de participantes. Tente novamente." });
            return;
          }
          const participants = (md?.participants || [])
            .map(p => normalizeJid(p.id || p.jid || p.participant))
            .filter(Boolean)
            .slice(0, MAX_MENTIONS);

          if (participants.length === 0) {
            await sock.sendMessage(from, { text: "\u274C Nao ha participantes para mencionar." });
            return;
          }

          const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage || null;
          let textToSend = args.join(' ').trim();

          if (!textToSend && quoted) {
            if (quoted.conversation) textToSend = quoted.conversation;
            else if (quoted.extendedTextMessage?.text) textToSend = quoted.extendedTextMessage.text;
            else if (quoted.imageMessage?.caption) textToSend = quoted.imageMessage.caption;
            else if (quoted.videoMessage?.caption) textToSend = quoted.videoMessage.caption;
            else if (quoted.documentMessage?.caption) textToSend = quoted.documentMessage.caption;
            else if (quoted.audioMessage?.caption) textToSend = quoted.audioMessage.caption;
            else textToSend = '';
          }

          if (textToSend) {
            await sock.sendMessage(from, { text: textToSend, mentions: participants });
            return;
          }

          if (quoted) {
            const mediaNode = quoted.imageMessage || quoted.videoMessage || quoted.documentMessage || quoted.audioMessage || quoted.stickerMessage || null;
            if (mediaNode) {
              try {
                let type = 'document';
                if (quoted.imageMessage) { type = 'image'; }
                else if (quoted.videoMessage) { type = 'video'; }
                else if (quoted.audioMessage) { type = 'audio'; }
                else if (quoted.stickerMessage) { type = 'sticker'; }
                else if (quoted.documentMessage) { type = 'document'; }

                const stream = await downloadContentFromMessage(mediaNode, type);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const caption = (mediaNode.caption || '').toString().trim();

                if (type === 'image') {
                  await sock.sendMessage(from, { image: buffer, caption: caption || undefined, mentions: participants });
                } else if (type === 'video') {
                  await sock.sendMessage(from, { video: buffer, caption: caption || undefined, mentions: participants });
                } else if (type === 'audio') {
                  await sock.sendMessage(from, { audio: buffer, caption: caption || undefined, mentions: participants });
                } else if (type === 'sticker') {
                  try {
                    await sock.sendMessage(from, { sticker: buffer });
                  } catch (e) {
                    await sock.sendMessage(from, { document: buffer, fileName: 'sticker.webp', mimetype: 'image/webp' });
                  }
                  const short = caption || "\u{1F4E2} Mensagem marcada:";
                  await sock.sendMessage(from, { text: short, mentions: participants });
                } else if (type === 'document') {
                  const fileName = mediaNode.fileName || 'file';
                  await sock.sendMessage(from, { document: buffer, fileName, mimetype: mediaNode.mimetype || 'application/octet-stream', caption: caption || undefined, mentions: participants });
                } else {
                  await sock.sendMessage(from, { text: "\u{1F4E2} Mensagem marcada (midia).", mentions: participants });
                }
                return;
              } catch (errMedia) {
                console.error('ERR /citar media resend:', errMedia && (errMedia.stack || errMedia));
              }
            }
          }

          const defaultText = args.join(' ').trim() || "\u{1F4E2} Chamada geral \u2014 atencao!";
          await sock.sendMessage(from, { text: defaultText, mentions: participants });
          return;
        } catch (err) {
          console.error('ERR /citar (marca todos):', err && (err.stack || err));
          await sock.sendMessage(from, { text: "\u274C Ocorreu um erro ao mencionar todos. Tente novamente." });
          return;
        }
      }

      // ============================
      // BAN (ARRUMADO)
      // ============================
      if (command === 'ban' || command === 'kick') {
        try {
          if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Comando disponivel apenas em grupos." }); return; }

          const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
          if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores ou dono podem usar este comando." }); return; }

          // ARRUMADO: Busca o alvo de 3 formas - reply, mencao, ou numero digitado
          let memberToRemove = null;

          // 1) Respondendo a mensagem de alguem (reply)
          const replyParticipant = m.message?.extendedTextMessage?.contextInfo?.participant || null;
          if (replyParticipant) {
            memberToRemove = normalizeJid(replyParticipant);
          }

          // 2) Mencao @user no texto
          if (!memberToRemove) {
            const mentionedJids = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentionedJids.length > 0) {
              memberToRemove = normalizeJid(mentionedJids[0]);
            }
          }

          // 3) Numero digitado como argumento
          if (!memberToRemove && args.length > 0 && args[0]) {
            const cleaned = onlyNumbers(args[0]);
            if (cleaned && cleaned.length >= 5) {
              memberToRemove = normalizeJid(cleaned + '@s.whatsapp.net');
            }
          }

          if (!memberToRemove) {
            await sock.sendMessage(from, { text: "\u274C Marque ou responda a mensagem do usuario que deseja banir, ou informe o numero.\n\nExemplos:\n- /ban @usuario\n- /ban 5511999998888\n- Responda a mensagem e digite /ban" });
            return;
          }

          const normalizedMember = normalizeJid(memberToRemove);
          const normalizedSender = normalizeJid(sender);
          const botJidNow = sock.user?.id ? normalizeJid(sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;
          const dbOwner = db.owner ? normalizeJid(db.owner) : (OWNER_LID ? OWNER_LID : null);

          if (normalizedMember === normalizedSender) {
            await sock.sendMessage(from, { text: "\u274C Voce nao pode remover voce mesmo!" });
            return;
          }
          if (dbOwner && normalizedMember === dbOwner) {
            await sock.sendMessage(from, { text: "\u274C Voce nao pode remover o dono do bot!" });
            return;
          }
          if (BOT_LID && normalizedMember === BOT_LID) {
            await sock.sendMessage(from, { text: "\u274C Voce nao pode me remover!" });
            return;
          }
          if (botJidNow && normalizedMember === botJidNow) {
            await sock.sendMessage(from, { text: "\u274C Voce nao pode me remover!" });
            return;
          }

          try {
            await sock.groupParticipantsUpdate(from, [normalizedMember], "remove");
            await sock.sendMessage(from, { text: `\u2705 @${normalizedMember.split('@')[0]} removido do grupo.`, mentions:[normalizedMember] });
          } catch (err) {
            console.error('ERR BAN:', err && (err.stack || err));
            // Tenta rebaixar primeiro e depois remover
            try {
              await sock.groupParticipantsUpdate(from, [normalizedMember], "demote");
              await sleep(800);
              await sock.groupParticipantsUpdate(from, [normalizedMember], "remove");
              await sock.sendMessage(from, { text: `\u2705 @${normalizedMember.split('@')[0]} rebaixado e removido do grupo.`, mentions:[normalizedMember] });
            } catch (err2) {
              console.error('ERR BAN fallback:', err2 && (err2.stack || err2));
              await sock.sendMessage(from, { text: `\u274C Falha ao remover @${normalizedMember.split('@')[0]}. Verifique se eu sou administrador e se o usuario ainda esta no grupo.`, mentions:[normalizedMember] });
            }
          }
        } catch (error) {
          console.error('ERR BAN flow:', error && (error.stack || error));
          try { await sock.sendMessage(from, { text: `Ocorreu um erro ao remover o membro: ${error && error.message ? error.message : String(error)}` }); } catch {}
        }
        return;
      }

      // SORTEAR
      if (command === 'sortear' || command === 'sorteio') {
        let items = [];
        if (args.length > 0) {
          items = args.join(' ').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
          if (items.length === 1) {
            const alt = args.map(a=>a.trim()).filter(Boolean);
            if (alt.length > 1) items = alt;
          }
        } else {
          const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (quoted) {
            let qtext = '';
            if (quoted.conversation) qtext = quoted.conversation;
            else if (quoted.extendedTextMessage?.text) qtext = quoted.extendedTextMessage.text;
            else if (quoted.imageMessage?.caption) qtext = quoted.imageMessage.caption || '';
            qtext = qtext.trim();
            if (qtext) {
              items = qtext.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            }
          }
        }

        if (!items || items.length < 2) {
          await sock.sendMessage(from, { text: "\u274C Uso: /sortear item1 item2 item3 ...\nOu responda a uma mensagem com itens em linhas e use /sortear\n(e necessario pelo menos 2 itens)." });
          return;
        }

        items = shuffleArray(items);
        let res = `\u{1F3B2} *RESULTADO DO SORTEIO* \u2014 ${items.length} participante(s)\n\n`;
        for (let i = 0; i < items.length; i += 2) {
          const a = items[i];
          const b = items[i+1] || null;
          res += `\u26BD *JOGO ${Math.floor(i/2)+1}*\n${a}  VS  ${b ? b : "_(Aguardando oponente)_" }\n\n`;
        }

        const mentions = items
          .map(it => {
            const mMatch = it.match(/@?(\d{5,})/);
            if (mMatch) return normalizeJid(mMatch[1] + '@s.whatsapp.net');
            const atMatch = it.match(/@([0-9]+|[^\s@]+)/);
            if (atMatch && atMatch[1] && /^\d+$/.test(atMatch[1])) return normalizeJid(atMatch[1] + '@s.whatsapp.net');
            return null;
          })
          .filter(Boolean)
          .slice(0, MAX_MENTIONS);

        await sock.sendMessage(from, { text: res, mentions });
        return;
      }

      // ============================
      // BRINCADEIRAS: /passiva /hetero /feminina /corno /falso
      // ============================
      if (['passiva','passivo'].includes(command)) {
        await handlePercentPlayCommand({ sock, m, from, sender, args, category: 'passiva', labelText: 'PASSIVA', defaultPhrase: 'Porcentagem Passiva' });
        return;
      }
      if (command === 'hetero') {
        // removed per user request: do not process /hetero
        await sock.sendMessage(from, { text: "\u2139\uFE0F Comando /hetero desativado neste bot." });
        return;
      }
      if (command === 'feminina' || command === 'feminino') {
        // removed per user request: do not process /feminina
        await sock.sendMessage(from, { text: "\u2139\uFE0F Comando /feminina desativado neste bot." });
        return;
      }
      if (command === 'corno') {
        await handlePercentPlayCommand({ sock, m, from, sender, args, category: 'cornos', labelText: 'CORNO', defaultPhrase: 'Porcentagem Corno' });
        return;
      }
      if (command === 'falso') {
        // removed per user request: do not process /falso
        await sock.sendMessage(from, { text: "\u2139\uFE0F Comando /falso desativado neste bot." });
        return;
      }

      // ============================
      // RANKS DE BRINCADEIRAS - SEMPRE ALEATORIO COM MEMBROS DO GRUPO
      // ============================
      async function sendBrincadeiraRank(from, categoryKey, title) {
        try {
          if (!isGroupJid(from)) {
            await sock.sendMessage(from, { text: `\u2139\uFE0F Este comando funciona apenas em grupos.` });
            return;
          }

          metadataCache.delete(from);
          const md = await getGroupMetadata(sock, from);
          const participants = (md?.participants || []).map(p => normalizeJid(p.id || p.jid || p.participant)).filter(Boolean);

          if (!participants || participants.length === 0) {
            await sock.sendMessage(from, { text: `\u2139\uFE0F Nao consegui obter participantes do grupo para gerar o ranking.` });
            return;
          }

          const botJidNow = sock.user?.id ? normalizeJid(sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;
          let pool = participants.filter(p => p !== botJidNow);

          if (pool.length === 0) {
            await sock.sendMessage(from, { text: `\u2139\uFE0F Nao ha participantes suficientes para exibir o ranking de ${title}.` });
            return;
          }

          const shuffled = shuffleArray(pool);
          const selected = shuffled.slice(0, Math.min(5, shuffled.length));

          const ranked = selected.map(jid => ({
            jid,
            pts: Math.floor(Math.random() * 300) + 1
          })).sort((a, b) => b.pts - a.pts);

          let txt = `\u{1F3C6} *TOP ${ranked.length} - ${title.toUpperCase()} (GRUPO)*\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
          const mentions = [];
          ranked.forEach((item, i) => {
            txt += `${i+1}\u00BA @${item.jid.split('@')[0]} \u2014 ${item.pts} pts\n`;
            mentions.push(item.jid);
          });
          await sock.sendMessage(from, { text: txt, mentions });
        } catch (e) {
          console.error('ERR sendBrincadeiraRank:', e && (e.stack || e));
          try { await sock.sendMessage(from, { text: `\u274C Erro ao gerar ranking ${title}.` }); } catch {}
        }
      }

      if (command === 'rankpassiva' || command === 'rank-passiva') {
        // removed per user request
        await sock.sendMessage(from, { text: "\u2139\uFE0F Comando /rankpassiva desativado neste bot." });
        return;
      }
      if (command === 'rankhetero' || command === 'rank-hetero') {
        // removed per user request
        await sock.sendMessage(from, { text: "\u2139\uFE0F Comando /rankhetero desativado neste bot." });
        return;
      }
      if (command === 'rankcornos' || command === 'rank-cornos' || command === 'rankcorno') {
        await sendBrincadeiraRank(from, 'cornos', 'Mais Cornos');
        return;
      }
      if (command === 'rankfalsos' || command === 'rank-falsos' || command === 'rankfalso') {
        // removed per user request
        await sock.sendMessage(from, { text: "\u2139\uFE0F Comando /rankfalsos desativado neste bot." });
        return;
      }

      // ============================
      // JOGO DA VELHA PvP
      // ============================
      if (command === 'jogodavelha') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Este comando funciona apenas em grupos." }); return; }
        const oponente = resolveTargetJidFromMessage(m, args);
        if (!oponente) { await sock.sendMessage(from, { text: "\u274C Marque alguem para jogar!\nUso: /jogodavelha @usuario" }); return; }
        if (normalizeJid(oponente) === normalizeJid(sender)) { await sock.sendMessage(from, { text: "\u274C Voce nao pode jogar contra si mesmo!" }); return; }
        const jogoKey = from;
        if (jogosVelha.has(jogoKey)) { await sock.sendMessage(from, { text: "\u274C Ja existe um jogo em andamento neste grupo! Termine o atual primeiro." }); return; }
        const novoJogo = {
          p1: normalizeJid(sender),
          p2: normalizeJid(oponente),
          tabuleiro: ['.','.','.','.','.','.','.','.','.'],
          turno: 'X',
          ia: false
        };
        jogosVelha.set(jogoKey, novoJogo);
        await sock.sendMessage(from, {
          text: `\u{1F3AE} *JOGO DA VELHA*\n\n@${normalizeJid(sender).split('@')[0]} (\u274C) VS @${normalizeJid(oponente).split('@')[0]} (\u2B55)\n\n${renderTabuleiroVelha(novoJogo.tabuleiro)}\n\nVez de @${normalizeJid(sender).split('@')[0]} (\u274C)\nDigite um numero de 1 a 9 para jogar!`,
          mentions: [normalizeJid(sender), normalizeJid(oponente)]
        });
        return;
      }

      // ============================
      // JOGO DA VELHA vs IA
      // ============================
      if (command === 'jogodavelhaia') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Este comando funciona apenas em grupos." }); return; }
        const jogoKey = from;
        if (jogosVelha.has(jogoKey)) { await sock.sendMessage(from, { text: "\u274C Ja existe um jogo em andamento neste grupo! Termine o atual primeiro." }); return; }
        const botJidIA = sock.user?.id ? normalizeJid(sock.user.id.split(':')[0] + '@s.whatsapp.net') : 'bot@s.whatsapp.net';
        const novoJogo = {
          p1: normalizeJid(sender),
          p2: botJidIA,
          tabuleiro: ['.','.','.','.','.','.','.','.','.'],
          turno: 'X',
          ia: true
        };
        jogosVelha.set(jogoKey, novoJogo);
        await sock.sendMessage(from, {
          text: `\u{1F3AE} *JOGO DA VELHA vs IA*\n\n@${normalizeJid(sender).split('@')[0]} (\u274C) VS \u{1F916} Bot (\u2B55)\n\n${renderTabuleiroVelha(novoJogo.tabuleiro)}\n\nSua vez! Digite um numero de 1 a 9.`,
          mentions: [normalizeJid(sender)]
        });
        return;
      }

      // ============================
      // ENQUETE BRINCADEIRA (REMOVIDO)
      // ============================

      // ============================
      // CACA PALAVRAS (OPÇÃO REMOVIDA)
      // ============================
      if (command === 'cacapalavras' || command === 'cacapalavra' || command === 'cacapalarvas') {
        // removed per user request
        await sock.sendMessage(from, { text: "\u2139\uFE0F Comando /cacapalavras desativado neste bot." });
        return;
      }

      // ============================
      // CASAR / DUPLA / DIVORCIO - IMPLEMENTAÇÃO
      // ============================
      if (command === 'casar' || command === 'casamento') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando apenas em grupos." }); return; }
        const target = resolveTargetJidFromMessage(m, args);
        if (!target) { await sock.sendMessage(from, { text: "\u274C Marque alguem para casar. Uso: /casar @usuario" }); return; }
        const pFrom = normalizeJid(sender);
        const pTo = normalizeJid(target);
        if (pFrom === pTo) { await sock.sendMessage(from, { text: "\u274C Voce nao pode se casar consigo mesmo!" }); return; }

        db.casamentos = db.casamentos || {};
        db.casamentos[from] = db.casamentos[from] || [];

        // verifica se algum dos dois ja esta casado no grupo
        const already = (db.casamentos[from] || []).some(c => c.p1 === pFrom || c.p2 === pFrom || c.p1 === pTo || c.p2 === pTo);
        if (already) {
          await sock.sendMessage(from, { text: "\u274C Um dos participantes ja esta casado neste grupo. Use /dupla para verificar." });
          return;
        }

        // cria proposta: chave = `${group}|${target}`, de = proposer
        const chave = `${from}|${pTo}`;
        propostasCasamento.set(chave, { de: pFrom, ts: Date.now() });
        salvarBanco(db);
        await sock.sendMessage(from, { text: `\u{1F48D} @${pFrom.split('@')[0]} pediu ${pTo ? `@${pTo.split('@')[0]}` : ''} em casamento!\nPara aceitar, responda com "aceito" (sem barra) nos proximos 5 minutos.`, mentions: [pFrom, pTo] });
        return;
      }

      if (command === 'dupla' || command === 'casal' || command === 'par') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando apenas em grupos." }); return; }
        const target = resolveTargetJidFromMessage(m, args) || sender;
        const j = normalizeJid(target);
        db.casamentos = db.casamentos || {};
        db.casamentos[from] = db.casamentos[from] || [];
        const casal = (db.casamentos[from] || []).find(c => c.p1 === j || c.p2 === j);
        if (!casal) {
          await sock.sendMessage(from, { text: `\u2139\uFE0F Nenhum casal encontrado para @${j.split('@')[0]} neste grupo.`, mentions: [j] });
          return;
        }
        const partner = casal.p1 === j ? casal.p2 : casal.p1;
        const data = casal.data ? new Date(casal.data).toLocaleDateString('pt-BR') : 'Data desconhecida';
        await sock.sendMessage(from, { text: `\u{1F48D} @${j.split('@')[0]} \u2764 @${partner.split('@')[0]}\nCasados desde: ${data}`, mentions: [j, partner] });
        return;
      }

      if (command === 'divorcio' || command === 'divorciar' || command === 'divorcio!') {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando apenas em grupos." }); return; }
        db.casamentos = db.casamentos || {};
        db.casamentos[from] = db.casamentos[from] || [];
        // se mencionar alguem, divorcia essa dupla (somente se sender for um dos dois ou for admin)
        const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length) {
          const target = normalizeJid(mentioned[0]);
          const casalIdx = db.casamentos[from].findIndex(c => c.p1 === target || c.p2 === target);
          if (casalIdx === -1) { await sock.sendMessage(from, { text: `\u2139\uFE0F Nenhum casal encontrado para @${target.split('@')[0]}.`, mentions: [target] }); return; }
          const casal = db.casamentos[from][casalIdx];
          const senderIsPartner = normalizeJid(sender) === casal.p1 || normalizeJid(sender) === casal.p2;
          const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
          if (!senderIsPartner && !senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas um dos cônjuges ou um administrador pode solicitar o divórcio." }); return; }
          db.casamentos[from].splice(casalIdx, 1);
          salvarBanco(db);
          await sock.sendMessage(from, { text: `\u{1F494} Casamento entre @${casal.p1.split('@')[0]} e @${casal.p2.split('@')[0]} foi dissolvido.`, mentions: [casal.p1, casal.p2] });
          return;
        } else {
          // sem menção: tenta divorciar o próprio sender (se casado)
          const j = normalizeJid(sender);
          const idx = db.casamentos[from].findIndex(c => c.p1 === j || c.p2 === j);
          if (idx === -1) { await sock.sendMessage(from, { text: "\u2139\uFE0F Voce nao esta casado neste grupo." }); return; }
          const casal = db.casamentos[from].splice(idx, 1)[0];
          salvarBanco(db);
          await sock.sendMessage(from, { text: `\u{1F494} @${j.split('@')[0]} divorciou-se de @${(casal.p1 === j ? casal.p2 : casal.p1).split('@')[0]}.`, mentions: [casal.p1, casal.p2] });
          return;
        }
      }

      // ============================
      // NOVO: /addregra <texto> -> adiciona regra para o camp do grupo
      // ============================
      if (['addregra','add-regra','adicionaregla'].includes(command)) {
        if (!isGroup) { await sock.sendMessage(from, { text: "\u274C Use este comando apenas em grupos." }); return; }
        const senderIsAdmin = isOwner || await isUserAdminCached(sock, from, sender);
        if (!senderIsAdmin) { await sock.sendMessage(from, { text: "\u274C Apenas administradores/dono podem definir regras do camp." }); return; }
        const texto = args.join(' ').trim();
        if (!texto) {
          const current = db.camps[from] && db.camps[from].regra ? db.camps[from].regra : null;
          if (current) {
            await sock.sendMessage(from, { text: `\u2139\uFE0F Regra atual do camp:\n\n${current}` });
          } else {
            await sock.sendMessage(from, { text: `\u2139\uFE0F Nao ha regra definida. Uso: /addregra <texto>\nEx: /addregra O vencedor deve enviar print e escrever GANHEI.` });
          }
          return;
        }
        db.camps = db.camps || {};
        db.camps[from] = db.camps[from] || { status: false };
        db.camps[from].regra = texto;
        salvarBanco(db);
        await sock.sendMessage(from, { text: `\u2705 Regra salva para o camp deste grupo:\n\n${texto}` });
        return;
      }

      // ============================
      // RESTANTE DOS HANDLERS (YouTube, etc.) permanece igual...
      // ============================

    } catch (err) {
      console.error('Erro no messages.upsert:', err && (err.stack || err.message || err));
    }
  });

  console.log('MARQUES BOT: inicializado e aguardando eventos...');
}

iniciar();
