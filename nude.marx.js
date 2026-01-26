const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DATABASE_FILE = path.join(__dirname, './database.json');
const AUTH_FOLDER = path.join(__dirname, 'auth_marques');
const MENU_IMAGE_FILE = path.join(__dirname, './menu_image.jpg');

const startTime = Math.floor(Date.now() / 1000);

function lerBanco() {
    const padrao = { 
        owner: null,
        classificados: [], 
        gruposDesativados: [], 
        antilink: [], 
        antilinkApaga: [],
        advertencias: {}, 
        parceiros: [],
        bemvindos: {},
        adeus: {}
    };
    if (fs.existsSync(DATABASE_FILE)) {
        try { 
            const dados = fs.readFileSync(DATABASE_FILE, 'utf-8');
            const json = JSON.parse(dados);
            return { ...padrao, ...json };
        } catch (e) { return padrao; }
    }
    return padrao;
}

function salvarBanco(dados) { 
    try { fs.writeFileSync(DATABASE_FILE, JSON.stringify(dados, null, 2)); } catch (e) {}
}

const bancoTimes = [
    {n:'MAN CITY', e:'🩵'}, {n:'REAL MADRID', e:'⚪'}, {n:'BARCELONA', e:'🔵'}, 
    {n:'LIVERPOOL', e:'❤️'}, {n:'ARSENAL', e:'🔴'}, {n:'BAYERN', e:'🔴'}, 
    {n:'PSG', e:'🔵'}, {n:'INTER MILAN', e:'⚫'}, {n:'MILAN', e:'🔴'}, 
    {n:'FLAMENGO', e:'🔴'}, {n:'PALMEIRAS', e:'🟢'}, {n:'SAO PAULO', e:'⚪'}
];

let camp = { status: false, fase: 'X1', limite: 1, vagas: 4, times: [], inscritos: {} };

async function ehAdmin(sock, grupo, usuario) {
    try {
        const metadata = await sock.groupMetadata(grupo);
        return metadata.participants.some(p => p.id === usuario && p.admin);
    } catch (e) { return false; }
}

async function iniciar() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ 
        logger: pino({ level: 'silent' }), 
        auth: state, 
        version: version,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (u) => {
        const { connection, qr } = u;
        if (qr) console.log("📌 ESCANEIE O QR CODE NO WHATSAPP!");
        if(connection === 'open') {
            console.log("✅ MARQUES BOT CONECTADO!");
            const db = lerBanco();
            if (!db.owner) {
                db.owner = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                salvarBanco(db);
                console.log("👑 DONO IDENTIFICADO: " + db.owner);
            }
        }
        if(connection === 'close') setTimeout(iniciar, 5000);
    });

    sock.ev.on('group-participants.update', async (anu) => {
        const db = lerBanco();
        const { id, participants, action, author } = anu;
        for (let participant of participants) {
            const jid = typeof participant === 'string' ? participant : participant.id;
            if (action === 'add' && db.bemvindos[id]) {
                await sock.sendMessage(id, { text: db.bemvindos[id].replace('@user', '@' + jid.split('@')[0]), mentions: [jid] });
            } else if (action === 'remove') {
                if (author && author !== jid) {
                    await sock.sendMessage(id, { text: `⚠️ *REVER:* O administrador @${author.split('@')[0]} removeu o cargo de @${jid.split('@')[0]}!`, mentions: [author, jid] });
                }
                if (db.adeus[id]) {
                    await sock.sendMessage(id, { text: db.adeus[id].replace('@user', '@' + jid.split('@')[0]), mentions: [jid] });
                }
            } else if (action === 'demote') {
                if (author) {
                    await sock.sendMessage(id, { text: `⚠️ *REVER:* O administrador @${author.split('@')[0]} rebaixou @${jid.split('@')[0]}!`, mentions: [author, jid] });
                }
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.remoteJid === 'status@broadcast') return;
        if (m.messageTimestamp < startTime) return;

        const from = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        const body = (m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || "").trim();
        const db = lerBanco();
        const isGroup = from.endsWith('@g.us');
        const isAdmin = isGroup ? await ehAdmin(sock, from, sender) : true;
        const isOwner = sender === db.owner;
        const isParceiro = db.parceiros.includes(sender);

        if (isGroup && !isAdmin && !isParceiro) {
            if (body.includes('chat.whatsapp.com')) {
                if (db.antilink.includes(from)) {
                    await sock.sendMessage(from, { delete: m.key });
                    await sock.groupParticipantsUpdate(from, [sender], "remove");
                    return;
                } else if (db.antilinkApaga.includes(from)) {
                    await sock.sendMessage(from, { delete: m.key });
                    return;
                }
            }
        }

        if (body.toLowerCase() === '.on' || body.toLowerCase() === '/on') {
            if (isAdmin && db.gruposDesativados.includes(from)) {
                db.gruposDesativados = db.gruposDesativados.filter(id => id !== from);
                salvarBanco(db);
                await sock.sendMessage(from, { text: "✅ *Bot ativado com sucesso!*" });
            }
            return;
        }
        if (db.gruposDesativados.includes(from) && isGroup) return;

        if (body.toLowerCase().includes('ganhei')) {
            let timeDoVencedor = null;
            for (const [time, jogadores] of Object.entries(camp.inscritos)) {
                if (jogadores.includes(sender)) { timeDoVencedor = time; break; }
            }
            if (timeDoVencedor || db.classificados.includes(sender)) {
                const vencedores = timeDoVencedor ? camp.inscritos[timeDoVencedor] : [sender];
                vencedores.forEach(v => { if (!db.classificados.includes(v)) db.classificados.push(v); });
                salvarBanco(db);
                let msgVit = "🏆 *VITÓRIA REGISTRADA!*\n\n" + (timeDoVencedor ? "��️ *Time:* " + timeDoVencedor + "\n" : "") + "👥 *Vencedores:* " + vencedores.map(v => "@" + v.split('@')[0]).join(", ") + "\n\n📜 *LISTA DE CLASSIFICADOS:*\n" + db.classificados.map((v, i) => (i+1) + "º @" + v.split('@')[0]).join("\n");
                await sock.sendMessage(from, { text: msgVit, mentions: [...vencedores, ...db.classificados] });
                if (db.classificados.length === 4) {
                    let sorteados = [...db.classificados].sort(() => 0.5 - Math.random());
                    let semiMsg = "🏁 *SEMIFINAL DEFINIDA!*\n━━━━━━━━━━━━━━━━━━━━\n\n";
                    for (let i = 0; i < sorteados.length; i += 2) {
                        if (i + 1 < sorteados.length) semiMsg += "⚽ *CONFRONTO " + (Math.floor(i/2) + 1) + "*\n⚔️ @" + sorteados[i].split('@')[0] + " VS @" + sorteados[i+1].split('@')[0] + "\n━━━━━━━━━━━━━━━━━━━━\n\n";
                    }
                    await sock.sendMessage(from, { text: semiMsg, mentions: sorteados });
                    db.classificados = []; salvarBanco(db);
                } else if (db.classificados.length === 2 && !camp.status) {
                    let finalMsg = "🔥 *FINAL DEFINIDA!*\n━━━━━━━━━━━━━━━━━━━━\n\n�� *GRANDE FINAL* 🏆\n⚔️ @" + db.classificados[0].split('@')[0] + " VS @" + db.classificados[1].split('@')[0] + "\n\n━━━━━━━━━━━━━━━━━━━━\n";
                    await sock.sendMessage(from, { text: finalMsg, mentions: db.classificados });
                    db.classificados = []; salvarBanco(db);
                }
                return;
            }
        }

        if (camp.status && !body.startsWith('.') && !body.startsWith('/')) {
            const tFound = camp.times.find(t => t.n === body.toUpperCase());
            if (tFound) {
                if (Object.values(camp.inscritos).some(j => j.includes(sender))) return;
                if (camp.inscritos[tFound.n].length < camp.limite) {
                    camp.inscritos[tFound.n].push(sender);
                    let list = "📝 *LISTA " + camp.fase + " ATUALIZADA:*\n\n";
                    camp.times.forEach(t => {
                        let icones = camp.fase === 'X2' ? "🎮��" : camp.fase === 'X3' ? "🎮🎮🎮" : "🎮";
                        list += t.e + " " + t.n + " " + icones + ": " + (camp.inscritos[t.n].map(v => "@" + v.split('@')[0]).join(" & ") || "_(Vago)_") + "\n";
                    });
                    await sock.sendMessage(from, { text: list, mentions: Object.values(camp.inscritos).flat() });
                    let total = 0; camp.times.forEach(t => total += camp.inscritos[t.n].length);
                    if (total >= (camp.vagas * camp.limite)) {
                        camp.status = false;
                        let res = "🏟️ **CONFRONTOS DEFINIDOS (" + camp.fase + ")**\n━━━━━━━━━━━━━━━━━━━━\n\n";
                        for (let i = 0; i < camp.times.length; i += 2) {
                            if (i + 1 < camp.times.length) res += "⚽ *JOGO " + (Math.floor(i/2) + 1) + "*\n⚔️ " + camp.times[i].n + " VS " + camp.times[i+1].n + "\n━━━━━━━━━━━━━━━━━━━━\n\n";
                        }
                        await sock.sendMessage(from, { text: res + "_Mande o print e escreva GANHEI!_", mentions: Object.values(camp.inscritos).flat() });
                    }
                }
                return;
            }
        }

        const prefix = body.startsWith('.') ? '.' : body.startsWith('/') ? '/' : null;
        if (!prefix) return;
        const args = body.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === 'menu') {
            const menuTxt = "╭━━━⪩ MARQUES BOT ⪨━━━\n┃  \n┃\n┃ 🏆 CAMP ALEATÓRIO\n┃ ▢ 1. .camp (Inicia o Sorteio)\n┃ ▢ 2. .regras (Ver Termos)\n┃\n┃ ��️ ADMINISTRAÇÃO\n┃ ▢ 3. .ban (Remover Membro)\n┃ ▢ 4. .promover (Dar ADM)\n┃ ▢ 5. .abrir (Liberar Grupo)\n┃ ▢ 6. .fechar (Fechar Grupo)\n┃ ▢ 7. .somenteadm (Bot ADM)\n┃ ▢ .off (Desativar Bot)\n┃\n┃ �� AVISOS & GRUPO\n┃ ▢ 8. .citar (Marcar Todos)\n┃ ▢ 9. .bemvindos (Set Entrada)\n┃ ▢ 10. .adeus (Set Saída)\n┃ ▢ 11. .parceiro (Add Parceiro)\n┃ ▢ 12. .parcerias (Ver Lista)\n┃ ▢ 13. .enquete (Criar Votação)\n┃\n┃ 🛠️ UTILITÁRIOS\n┃ ▢ 14. .s (Fazer Figurinha)\n┃ ▢ 15. .vervisu (Abrir Única)\n┃ ▢ 16. .adv (Dar Advertência)\n┃ ▢ 17. .r-adv (Remover Adv)\n┃ ▢ 18. .antilink (Expulsão ON)\n┃ ▢ 19. .antilinkapaga (Auto-Del)\n┃ ▢ 20. .rever (Ver Dados)\n┃ ▢ 21. .sortear (Aleatório)\n┃\n┃ 🪐 *Qualidade Marques Bot*\n╰━━━───「⚽」───━━━╯";
            if (fs.existsSync(MENU_IMAGE_FILE)) {
                await sock.sendMessage(from, { image: fs.readFileSync(MENU_IMAGE_FILE), caption: menuTxt });
            } else {
                await sock.sendMessage(from, { text: menuTxt });
            }
            return;
        }

        if (command === 'regras') {
            await sock.sendMessage(from, { text: "📜 *REGRAS DO CAMP*\n\n1. Respeite os adversários.\n2. Mande o print da vitória e escreva GANHEI.\n3. O prazo de cada rodada é de 15 minutos.\n4. Proibido qualquer tipo de ofensa." });
            return;
        }

        if (command === 's') {
            const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const current = m.message.imageMessage || m.message.videoMessage;
            const msgToDownload = current || (quoted ? (quoted.imageMessage || quoted.videoMessage) : null);
            if (msgToDownload) {
                await sock.sendMessage(from, { text: "⏳ *Processando figurinha...*" });
                const type = current ? (m.message.imageMessage ? 'image' : 'video') : (quoted.imageMessage ? 'image' : 'video');
                const stream = await downloadContentFromMessage(msgToDownload, type);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                try {
                    const stickerBuffer = await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
                    await sock.sendMessage(from, { sticker: stickerBuffer });
                } catch (e) { await sock.sendMessage(from, { text: "❌ *Erro ao processar figurinha.*" }); }
            }
            return;
        }

        if (command === 'setmenu' && isOwner) {
            const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const current = m.message.imageMessage;
            const msgToDownload = current || (quoted ? quoted.imageMessage : null);
            if (msgToDownload) {
                await sock.sendMessage(from, { text: "⏳ *Baixando e configurando nova imagem do menu...*" });
                const stream = await downloadContentFromMessage(msgToDownload, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                fs.writeFileSync(MENU_IMAGE_FILE, buffer);
                await sock.sendMessage(from, { text: "✅ *Foto do menu atualizada com sucesso!*" });
            } else {
                await sock.sendMessage(from, { text: "❌ *Responda a uma imagem com .setmenu para definir a foto do menu!*" });
            }
            return;
        }

        if (!isAdmin) return;

        switch (command) {
            case 'off':
                db.gruposDesativados.push(from); salvarBanco(db);
                await sock.sendMessage(from, { text: "❌ *Bot desativado!*" });
                break;
            case 'camp':
                let modo = (args[0] || "x1").toLowerCase();
                camp.fase = modo.toUpperCase();
                camp.vagas = parseInt(args[1]) || 4;
                camp.limite = modo === 'x2' ? 2 : modo === 'x3' ? 3 : 1;
                camp.times = bancoTimes.sort(() => 0.5 - Math.random()).slice(0, camp.vagas);
                camp.status = true; camp.inscritos = {};
                camp.times.forEach(t => camp.inscritos[t.n] = []);
                db.classificados = []; salvarBanco(db);
                let msgIni = "🏆 *CAMP " + camp.fase + " ABERTO*\n\n";
                camp.times.forEach(t => msgIni += t.e + " " + t.n + "\n");
                await sock.sendMessage(from, { text: msgIni + "\n_Escolha seu time!_" });
                break;
            case 'ban':
                let userBan = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? args[0].replace('@', '') + '@s.whatsapp.net' : null);
                if (userBan) {
                    await sock.groupParticipantsUpdate(from, [userBan], "remove");
                    await sock.sendMessage(from, { text: `🚫 *Usuário @${userBan.split('@')[0]} removido!*`, mentions: [userBan] });
                }
                break;
            case 'promover':
                let userAdm = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? args[0].replace('@', '') + '@s.whatsapp.net' : null);
                if (userAdm) {
                    await sock.groupParticipantsUpdate(from, [userAdm], "promote");
                    await sock.sendMessage(from, { text: `🛡️ *Usuário @${userAdm.split('@')[0]} promovido!*`, mentions: [userAdm] });
                }
                break;
            case 'rebaixar':
                let userDem = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? args[0].replace('@', '') + '@s.whatsapp.net' : null);
                if (userDem) {
                    await sock.groupParticipantsUpdate(from, [userDem], "demote");
                    await sock.sendMessage(from, { text: `⚠️ *Usuário @${userDem.split('@')[0]} rebaixado!*`, mentions: [userDem] });
                }
                break;
            case 'abrir':
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: "🔓 *Grupo aberto!*" });
                break;
            case 'fechar':
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: "🔒 *Grupo fechado!*" });
                break;
            case 'citar':
                const metadata = await sock.groupMetadata(from);
                const participants = metadata.participants.map(p => p.id);
                const quotedMsg = m.message.extendedTextMessage?.contextInfo;
                let textToRepeat = "";
                if (quotedMsg && quotedMsg.quotedMessage) {
                    const q = quotedMsg.quotedMessage;
                    textToRepeat = q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || "";
                }
                if (!textToRepeat) textToRepeat = "‎";
                await sock.sendMessage(from, { text: textToRepeat, mentions: participants });
                break;
            case 'bemvindos':
                db.bemvindos[from] = args.join(" "); salvarBanco(db);
                await sock.sendMessage(from, { text: "✅ *Boas-vindas configurada!*" });
                break;
            case 'adeus':
                db.adeus[from] = args.join(" "); salvarBanco(db);
                await sock.sendMessage(from, { text: "✅ *Adeus configurado!*" });
                break;
            case 'parceiro':
                let pJid = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (pJid) {
                    if (!db.parceiros.includes(pJid)) {
                        db.parceiros.push(pJid);
                        salvarBanco(db);
                        await sock.sendMessage(from, { text: `🤝 *Parceiro @${pJid.split('@')[0]} adicionado!*`, mentions: [pJid] });
                    }
                }
                break;
            case 'parcerias':
                let pList = "🤝 *LISTA DE PARCERIAS:*\n\n" + db.parceiros.map(p => "@" + p.split('@')[0]).join("\n");
                await sock.sendMessage(from, { text: pList, mentions: db.parceiros });
                break;
            case 'enquete':
                let qParts = args.join(" ").split(",");
                let question = qParts[0] || "Vocês querem CAMP?";
                let options = qParts.slice(1).length > 0 ? qParts.slice(1) : ["X1", "X2", "X3"];
                await sock.sendMessage(from, { poll: { name: question, values: options, selectableCount: 1 } });
                const metaPoll = await sock.groupMetadata(from);
                await sock.sendMessage(from, { text: "📢 *VOTEM NA ENQUETE ACIMA!*", mentions: metaPoll.participants.map(p => p.id) });
                break;
            case 'vervisu':
                const quotedVisu = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedVisu?.viewOnceMessageV2 || quotedVisu?.viewOnceMessage) {
                    const viewOnce = quotedVisu.viewOnceMessageV2 || quotedVisu.viewOnceMessage;
                    const vType = Object.keys(viewOnce.message)[0];
                    const media = await downloadContentFromMessage(viewOnce.message[vType], vType.replace('Message', ''));
                    let vBuffer = Buffer.from([]);
                    for await (const chunk of media) vBuffer = Buffer.concat([vBuffer, chunk]);
                    if (vType === 'imageMessage') await sock.sendMessage(from, { image: vBuffer, caption: "🔓 *Visualização Única Aberta!*" });
                    else if (vType === 'videoMessage') await sock.sendMessage(from, { video: vBuffer, caption: "🔓 *Visualização Única Aberta!*" });
                }
                break;
            case 'adv':
                let uAdv = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (uAdv) {
                    db.advertencias[uAdv] = (db.advertencias[uAdv] || 0) + 1;
                    if (db.advertencias[uAdv] >= 3) {
                        await sock.groupParticipantsUpdate(from, [uAdv], "remove");
                        delete db.advertencias[uAdv];
                        await sock.sendMessage(from, { text: `🚫 *Usuário @${uAdv.split('@')[0]} banido por 3 advertências!*`, mentions: [uAdv] });
                    } else {
                        await sock.sendMessage(from, { text: `⚠️ *Usuário @${uAdv.split('@')[0]} advertido! (${db.advertencias[uAdv]}/3)*`, mentions: [uAdv] });
                    }
                    salvarBanco(db);
                }
                break;
            case 'r-adv':
                let urAdv = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (urAdv && db.advertencias[urAdv]) {
                    db.advertencias[urAdv]--;
                    await sock.sendMessage(from, { text: `✅ *Advertência removida! (${db.advertencias[urAdv]}/3)*`, mentions: [urAdv] });
                    salvarBanco(db);
                }
                break;
            case 'antilink':
                if (db.antilink.includes(from)) {
                    db.antilink = db.antilink.filter(id => id !== from);
                    await sock.sendMessage(from, { text: "✅ *Antilink (Ban) desativado!*" });
                } else {
                    db.antilink.push(from);
                    await sock.sendMessage(from, { text: "✅ *Antilink (Ban) ativado!*" });
                }
                salvarBanco(db);
                break;
            case 'antilinkapaga':
                if (db.antilinkApaga.includes(from)) {
                    db.antilinkApaga = db.antilinkApaga.filter(id => id !== from);
                    await sock.sendMessage(from, { text: "✅ *Antilink (Apagar) desativado!*" });
                } else {
                    db.antilinkApaga.push(from);
                    await sock.sendMessage(from, { text: "✅ *Antilink (Apagar) ativado!*" });
                }
                salvarBanco(db);
                break;
            case 'sortear':
                if (args.length < 2) return;
                let srt = args.sort(() => 0.5 - Math.random());
                let srtMsg = "🎲 *CONFRONTOS SORTEADOS*\n━━━━━━━━━━━━━━━━━━━━\n\n";
                for (let i = 0; i < srt.length; i += 2) {
                    if (srt[i+1]) srtMsg += `⚽ *JOGO ${Math.floor(i/2) + 1}*\n⚔️ ${srt[i]} VS ${srt[i+1]}\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                    else srtMsg += `🏅 *FOLGA:* ${srt[i]}\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                }
                await sock.sendMessage(from, { text: srtMsg });
                break;
        }
    });
}
iniciar();
