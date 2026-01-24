const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers,
    downloadMediaMessage 
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");

const DATABASE_FILE = './database.json';
let cacheAdmins = {}; 

function lerBanco() {
    if (!fs.existsSync(DATABASE_FILE)) {
        return {
            prefixos: {}, antilink: {}, antilinkapaga: {}, rever: {}, 
            somenteadm: {}, parceiroId: "", advertencias: {}, bemVindos: {}, adeus: {},
            listaParcerias: {} 
        };
    }
    let dados = JSON.parse(fs.readFileSync(DATABASE_FILE));
    const chaves = ['prefixos', 'antilink', 'antilinkapaga', 'rever', 'somenteadm', 'advertencias', 'bemVindos', 'adeus', 'listaParcerias'];
    chaves.forEach(c => { if(!dados[c]) dados[c] = {}; });
    return dados;
}
function salvarBanco(dados) { fs.writeFileSync(DATABASE_FILE, JSON.stringify(dados, null, 2)); }

let db = lerBanco();

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessao_v2');
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.macOS("Desktop")
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        if (u.connection === 'close') iniciarBot();
        if (u.connection === 'open') console.log("✅ MARQUES BOT - REVER DETALHADO ATIVADO!");
    });

    sock.ev.on('group-participants.update', async (anu) => {
        const from = anu.id;
        delete cacheAdmins[from];
        const action = anu.action;
        const author = anu.author; // QUEM FEZ A AÇÃO
        let num = anu.participants[0];

        if (typeof num === 'object') num = num.id || num.jid; 
        if (!num) return;
        const numStr = String(num);

        // Mensagens de Boas-vindas e Saída
        if (action === 'add' && db.bemVindos[from]) {
            await sock.sendMessage(from, { text: db.bemVindos[from].replace('@user', '@' + numStr.split('@')[0]), mentions: [numStr] });
        } else if (action === 'remove' && db.adeus[from]) {
            await sock.sendMessage(from, { text: db.adeus[from].replace('@user', '@' + numStr.split('@')[0]), mentions: [numStr] });
        }

        // SISTEMA REVER DETALHADO (QUEM PROMOVEU/REBAIXOU QUEM)
        if (db.rever[from] && (action === 'promote' || action === 'demote')) {
            const executor = author ? "@" + author.split('@')[0] : "o Sistema";
            const alvo = "@" + numStr.split('@')[0];
            const mnts = author ? [numStr, author] : [numStr];

            let msgRever = "";
            if (action === 'promote') {
                msgRever = "🚨 *REVER:* " + executor + " PROMOVEU " + alvo + " para ADM!";
            } else {
                msgRever = "🚨 *REVER:* " + executor + " REBAIXOU " + alvo + " para Membro!";
            }

            await sock.sendMessage(from, { text: msgRever, mentions: mnts });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.remoteJid === 'status@broadcast') return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const participant = m.key.participant || from;
        const textMessage = (m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || "");
        const textLower = textMessage.toLowerCase();
        const prefixoAtual = db.prefixos[from] || ".";

        if (isGroup && !cacheAdmins[from]) {
            try {
                const meta = await sock.groupMetadata(from);
                cacheAdmins[from] = meta.participants.filter(v => v.admin !== null).map(v => v.id);
            } catch (e) { return; }
        }
        const admins = cacheAdmins[from] || [];
        const isAdm = admins.includes(participant);
        const isMe = m.key.fromMe;

        // Anti-link
        if (isGroup && !isMe && !isAdm && (participant !== db.parceiroId) && (textLower.includes("chat.whatsapp.com") || textLower.includes("http"))) {
            if (db.antilinkapaga[from]) await sock.sendMessage(from, { delete: m.key });
            if (db.antilink[from]) {
                await sock.sendMessage(from, { delete: m.key });
                await sock.groupParticipantsUpdate(from, [participant], "remove");
            }
            return;
        }

        if (textMessage.startsWith(prefixoAtual)) {
            const args = textMessage.slice(prefixoAtual.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const quoted = m.message.extendedTextMessage?.contextInfo;
            let alvoCmd = quoted?.participant || quoted?.mentionedJid?.[0];

            switch (command) {
                case 'menu':
                    const menuTxt = `╭━━⪩ *MARQUES BOT* ⪨━━
▢ • ${prefixoAtual}antilinkapaga 1/0
▢ • ${prefixoAtual}parceiro (marque)
▢ • ${prefixoAtual}parcerias
▢ • ${prefixoAtual}bemvindos (texto)
▢ • ${prefixoAtual}sair (texto)
▢ • ${prefixoAtual}vervisu (responda)
▢ • ${prefixoAtual}sortear (A, B, C...)
▢ • ${prefixoAtual}enquete T|O1|O2
▢ • ${prefixoAtual}citar (texto/arraste)
▢ • ${prefixoAtual}somenteadm 1/0
▢ • ${prefixoAtual}antilink 1/0
▢ • ${prefixoAtual}rever 1/0
▢ • ${prefixoAtual}adv (responda)
▢ • ${prefixoAtual}r-adv (responda)
▢ • ${prefixoAtual}ban (responda)
▢ • ${prefixoAtual}promover (responda)
▢ • ${prefixoAtual}rebaixar (responda)
▢ • ${prefixoAtual}abrir / ${prefixoAtual}fechar
▢ • ${prefixoAtual}s (Figurinha)
▢ • ${prefixoAtual}setmenu (responda foto)
╰━━─「🪐」─━━`;
                    const img = fs.existsSync('./menu.jpg') ? fs.readFileSync('./menu.jpg') : null;
                    if (img) await sock.sendMessage(from, { image: img, caption: menuTxt }, { quoted: m });
                    else await sock.sendMessage(from, { text: menuTxt }, { quoted: m });
                    break;

                case 'parceiro':
                    if ((isAdm || isMe) && alvoCmd) {
                        db.parceiroId = alvoCmd;
                        if (!db.listaParcerias[from]) db.listaParcerias[from] = [];
                        if (!db.listaParcerias[from].includes(alvoCmd)) db.listaParcerias[from].push(alvoCmd);
                        salvarBanco(db);
                        await sock.sendMessage(from, { text: "🤝 Parceiro @" + String(alvoCmd).split('@')[0] + " configurado!", mentions: [alvoCmd] });
                    } break;

                case 'parcerias':
                    if (!db.listaParcerias[from] || db.listaParcerias[from].length === 0) return await sock.sendMessage(from, { text: "❌ Sem parcerias." });
                    let mP = [];
                    let tP = "📜 *PARCERIAS:*\n\n";
                    db.listaParcerias[from].forEach(p => {
                        tP += "🔹 @" + String(p).split('@')[0] + "\n";
                        mP.push(p);
                    });
                    await sock.sendMessage(from, { text: tP, mentions: mP });
                    break;

                case 'rever': if (isAdm || isMe) { db.rever[from] = args[0] === '1'; salvarBanco(db); await sock.sendMessage(from, { text: "🔍 Rever: " + (args[0] === '1' ? "ON" : "OFF") }); } break;
                case 'promover': if ((isAdm || isMe) && alvoCmd) await sock.groupParticipantsUpdate(from, [alvoCmd], "promote"); break;
                case 'rebaixar': if ((isAdm || isMe) && alvoCmd) await sock.groupParticipantsUpdate(from, [alvoCmd], "demote"); break;
                case 'ban': if ((isAdm || isMe) && alvoCmd) await sock.groupParticipantsUpdate(from, [alvoCmd], "remove"); break;
                case 'abrir': if(isAdm || isMe) await sock.groupSettingUpdate(from, 'not_announcement'); break;
                case 'fechar': if(isAdm || isMe) await sock.groupSettingUpdate(from, 'announcement'); break;
                case 'adv':
                    if ((isAdm || isMe) && alvoCmd) {
                        if (!db.advertencias[from]) db.advertencias[from] = {};
                        db.advertencias[from][alvoCmd] = (db.advertencias[from][alvoCmd] || 0) + 1;
                        await sock.sendMessage(from, { text: "⚠️ Aviso " + db.advertencias[from][alvoCmd] + "/3 para @" + String(alvoCmd).split('@')[0], mentions: [alvoCmd] });
                        if (db.advertencias[from][alvoCmd] >= 3) {
                            await sock.groupParticipantsUpdate(from, [alvoCmd], "remove");
                            delete db.advertencias[from][alvoCmd];
                        }
                        salvarBanco(db);
                    } break;
                case 'citar':
                    if (isAdm || isMe) {
                        const mt = await sock.groupMetadata(from);
                        let msg = args.join(" ");
                        if (!msg && quoted?.quotedMessage) {
                            const q = quoted.quotedMessage;
                            msg = q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || "📢";
                        } else if (!msg) msg = "📢";
                        await sock.sendMessage(from, { text: msg, mentions: mt.participants.map(v => v.id) });
                    } break;
                case 's':
                    const ms = quoted?.quotedMessage ? { message: quoted.quotedMessage } : m;
                    const buf = await downloadMediaMessage(ms, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    if (buf) {
                        const sst = new Sticker(buf, { pack: 'Marques Bot', author: 'scoutAI', type: StickerTypes.CROPPED });
                        await sock.sendMessage(from, { sticker: await sst.toBuffer() }, { quoted: m });
                    } break;
            }
        }
    });
}
iniciarBot();
