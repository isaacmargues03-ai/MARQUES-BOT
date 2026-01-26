const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const DATABASE_FILE = path.join(__dirname, './database.json');
const AUTH_FOLDER = path.join(__dirname, 'auth_marques');

// Marcador de tempo para ignorar mensagens antigas
const startTime = Math.floor(Date.now() / 1000);

function lerBanco() {
    const padrao = { classificados: [] };
    if (fs.existsSync(DATABASE_FILE)) {
        try { 
            const dados = fs.readFileSync(DATABASE_FILE, 'utf-8');
            return dados ? JSON.parse(dados) : padrao;
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

let camp = { 
    status: false, 
    fase: 'X1', 
    limite: 1, 
    vagas: 4, 
    times: [], 
    inscritos: {}
};

async function ehAdmin(sock, grupo, usuario) {
    try {
        const metadata = await sock.groupMetadata(grupo);
        return metadata.participants.some(p => p.id === usuario && p.admin);
    } catch (e) { return false; }
}

async function iniciar() {
    if (!fs.existsSync(AUTH_FOLDER)) fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ 
        logger: pino({ level: 'silent' }), 
        auth: state, 
        printQRInTerminal: true,
        version: version,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (u) => { 
        const { connection, lastDisconnect, qr } = u;
        if (qr) console.log("📌 ESCANEIE O QR CODE NO WHATSAPP!");
        if(connection === 'open') console.log("✅ MARQUES BOT CONECTADO!");
        if(connection === 'close') {
            const motivo = lastDisconnect?.error?.output?.statusCode;
            if (motivo !== 401) setTimeout(iniciar, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.remoteJid === 'status@broadcast') return;
        if (m.messageTimestamp < startTime) return;

        const from = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        const body = (m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || "").trim();
        const db = lerBanco();

        // LÓGICA DO "GANHEI" -> CLASSIFICAÇÃO -> SEMIFINAL
        if (body.toLowerCase().includes('ganhei')) {
            let timeDoVencedor = null;
            for (const [time, jogadores] of Object.entries(camp.inscritos)) {
                if (jogadores.includes(sender)) { timeDoVencedor = time; break; }
            }
            if (timeDoVencedor) {
                const vencedores = camp.inscritos[timeDoVencedor];
                vencedores.forEach(v => { if (!db.classificados.includes(v)) db.classificados.push(v); });
                salvarBanco(db);
                
                let msgVit = "🏆 *VITÓRIA REGISTRADA!*\n\n" +
                             "🏟️ *Time:* " + timeDoVencedor + "\n" +
                             "👥 *Vencedores:* " + vencedores.map(v => "@" + v.split('@')[0]).join(", ") + "\n\n" +
                             "📜 *LISTA DE CLASSIFICADOS:*\n" +
                             db.classificados.map((v, i) => (i+1) + "º @" + v.split('@')[0]).join("\n");
                
                await sock.sendMessage(from, { text: msgVit, mentions: [...vencedores, ...db.classificados] });

                if (db.classificados.length >= camp.vagas) {
                    const agora = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
                    const prazo = new Date(agora.getTime() + 15 * 60000);
                    const horaPrazo = prazo.getHours().toString().padStart(2, '0') + ":" + prazo.getMinutes().toString().padStart(2, '0');

                    let sorteados = [...db.classificados].sort(() => 0.5 - Math.random());
                    let semiMsg = "🏁 *SEMIFINAL DEFINIDA!*\n";
                    semiMsg += "⏰ *PRAZO:* Até as " + horaPrazo + " (15 min)\n";
                    semiMsg += "━━━━━━━━━━━━━━━━━━━━\n\n";

                    for (let i = 0; i < sorteados.length; i += 2) {
                        if (i + 1 < sorteados.length) {
                            semiMsg += "⚽ *CONFRONTO " + (Math.floor(i/2) + 1) + "*\n";
                            semiMsg += "⚔️ @" + sorteados[i].split('@')[0] + " VS @" + sorteados[i+1].split('@')[0] + "\n";
                            semiMsg += "━━━━━━━━━━━━━━━━━━━━\n\n";
                        }
                    }
                    await sock.sendMessage(from, { text: semiMsg, mentions: sorteados });
                    db.classificados = [];
                    salvarBanco(db);
                }
                return;
            }
        }

        if (camp.status && !body.startsWith('/')) {
            const tFound = camp.times.find(t => t.n === body.toUpperCase());
            if (tFound) {
                const jaInscrito = Object.values(camp.inscritos).some(j => j.includes(sender));
                if (jaInscrito) return;
                if (camp.inscritos[tFound.n].length < camp.limite) {
                    camp.inscritos[tFound.n].push(sender);
                    let list = "📝 *LISTA " + camp.fase + " ATUALIZADA:*\n\n";
                    camp.times.forEach(t => {
                        let icones = camp.fase === 'X2' ? "🎮🎮" : camp.fase === 'X3' ? "🎮🎮🎮" : "🎮";
                        let ocupantes = camp.inscritos[t.n].map(v => "@" + v.split('@')[0]).join(" & ");
                        list += t.e + " " + t.n + " " + icones + ": " + (ocupantes || "_(Vago)_") + "\n";
                    });
                    await sock.sendMessage(from, { text: list, mentions: Object.values(camp.inscritos).flat() });
                    
                    let total = 0;
                    camp.times.forEach(t => total += camp.inscritos[t.n].length);
                    if (total >= (camp.vagas * camp.limite)) {
                        camp.status = false;
                        const agora = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
                        const prazo = new Date(agora.getTime() + 15 * 60000);
                        const horaPrazo = prazo.getHours().toString().padStart(2, '0') + ":" + prazo.getMinutes().toString().padStart(2, '0');

                        let res = "🏟️ **CONFRONTOS DEFINIDOS (" + camp.fase + ")**\n";
                        res += "⏰ *PRAZO:* Até as " + horaPrazo + " (15 min)\n";
                        res += "━━━━━━━━━━━━━━━━━━━━\n\n";
                        for (let i = 0; i < camp.times.length; i += 2) {
                            if (i + 1 < camp.times.length) {
                                res += "⚽ *JOGO " + (Math.floor(i/2) + 1) + "*\n";
                                res += "⚔️ " + camp.times[i].n + " VS " + camp.times[i+1].n + "\n";
                                res += "━━━━━━━━━━━━━━━━━━━━\n\n";
                            }
                        }
                        await sock.sendMessage(from, { text: res + "_Mande o print e escreva GANHEI!_", mentions: Object.values(camp.inscritos).flat() });
                    }
                }
                return;
            }
        }

        if (!body.startsWith('/')) return;
        const args = body.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const isAdmin = await ehAdmin(sock, from, sender);

        switch (command) {
            case 'menu':
                const menuTxt = "╭━━━⪩ MARQUES BOT ⪨━━━\n┃\n┃ 🏆 CAMP ALEATÓRIO\n┃ ▢ /camp (x1/x2/x3) [qtd]\n┃ ▢ /sortear [times...]\n┃ ▢ /regras\n┃\n┃ 🛡️ ADMINISTRAÇÃO (SÓ ADM)\n┃ ▢ /ban | /promover\n┃ ▢ /abrir | /fechar\n┃\n┃ 🪐 *Qualidade Marques Bot*\n╰━━━───「⚽」───━━━╯";
                await sock.sendMessage(from, { text: menuTxt });
                break;

            case 'camp':
                if (!isAdmin) return;
                let modo = (args[0] || "x1").toLowerCase();
                camp.fase = modo.toUpperCase();
                camp.vagas = parseInt(args[1]) || 4;
                camp.limite = modo === 'x2' ? 2 : modo === 'x3' ? 3 : 1;
                camp.times = bancoTimes.sort(() => 0.5 - Math.random()).slice(0, camp.vagas);
                camp.status = true; 
                camp.inscritos = {};
                camp.times.forEach(t => camp.inscritos[t.n] = []);
                db.classificados = [];
                salvarBanco(db);
                let msgIni = "🏆 *CAMP " + camp.fase + " ABERTO*\n\n";
                camp.times.forEach(t => msgIni += t.e + " " + t.n + "\n");
                await sock.sendMessage(from, { text: msgIni + "\n_Escolha seu time!_" });
                break;
        }
    });
}
iniciar();
