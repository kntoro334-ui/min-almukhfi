const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 2e6,
    pingTimeout: 20000,
    pingInterval: 25000,
    connectionStateRecovery: {
        maxDisconnectionDuration: 20000,
        skipMiddlewares: true
    }
});

app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

app.use(express.static(path.join(__dirname, "public"), {
    maxAge: "1h",
    etag: true
}));

// Pinterest helper: resolve a Pin URL to its og:image without storing/downloading the image.
app.post("/api/pinterest-resolve", async (req, res) => {
    try {
        const raw = String(req.body?.url || "").trim();
        if (!/^https?:\/\/\S+$/i.test(raw)) return res.status(400).json({ error: "رابط غير صالح." });
        const target = new URL(raw);
        const host = target.hostname.toLowerCase().replace(/^www\./, "");
        const allowed = host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it";
        if (!allowed) return res.status(400).json({ error: "أرسل رابط Pinterest فقط." });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        let response;
        try {
            response = await fetch(raw, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; MakhfiBot/1.0)", "accept": "text/html,application/xhtml+xml" } });
        } finally { clearTimeout(timeout); }
        if (!response.ok) return res.status(502).json({ error: "تعذر فتح رابط Pinterest." });
        const finalUrl = new URL(response.url);
        const finalHost = finalUrl.hostname.toLowerCase().replace(/^www\./, "");
        const finalAllowed = finalHost === "pinterest.com" || finalHost.endsWith(".pinterest.com") || finalHost === "pin.it";
        if (!finalAllowed) return res.status(400).json({ error: "الرابط لم يعد رابط Pinterest بعد التحويل." });
        const html = await response.text();

        // Pinterest يغيّر ترتيب خصائص meta أحياناً، لذلك لا نعتمد على
        // ترتيب property/content داخل الوسم.
        const decodeHtml = (value) => String(value || "")
            .replace(/&amp;/gi, "&")
            .replace(/&#x2F;|&#47;/gi, "/")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'");

        function findMetaImage(markup) {
            const tags = markup.match(/<meta\b[^>]*>/gi) || [];
            for (const tag of tags) {
                const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
                if (!property || !["og:image", "og:image:url", "twitter:image"].includes(property)) continue;
                const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
                if (content) return decodeHtml(content).trim();
            }
            return "";
        }

        let imageUrl = findMetaImage(html);

        // بعض صفحات Pinterest تضع الصورة داخل JSON المضمّن بدلاً من og:image.
        if (!imageUrl) {
            const jsonMatches = [
                html.match(/"image_url"\s*:\s*"([^"]+)"/i),
                html.match(/"url"\s*:\s*"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)
            ];
            for (const m of jsonMatches) {
                if (m?.[1]) {
                    imageUrl = decodeHtml(m[1]).replace(/\\u002F/g, "/").replace(/\\\//g, "/");
                    break;
                }
            }
        }

        if (!imageUrl || !/^https?:\/\/\S+$/i.test(imageUrl)) {
            return res.status(404).json({ error: "لم أجد صورة لهذا الـPin. تأكد أن الرابط رابط Pin فعلي ثم جرّب مرة أخرى." });
        }

        return res.json({ imageUrl });
    } catch (_) { return res.status(500).json({ error: "تعذر معالجة رابط Pinterest حالياً." }); }
});


const rooms = {};
const DATA_DIR = path.join(__dirname, "data");
const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Production storage: Render Postgres via DATABASE_URL.
// Local fallback: data/players.json so the game still runs during local development.
const DATABASE_URL = process.env.DATABASE_URL || "";
let db = DATABASE_URL ? new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false }
}) : null;

let playerProfiles = {};
let storageReady = false;
let profileSaveTimer = null;

function loadFileProfiles() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8")); }
    catch (_) { return {}; }
}

async function initStorage() {
    if (!db) {
        playerProfiles = loadFileProfiles();
        storageReady = true;
        console.warn("⚠️ DATABASE_URL غير موجود؛ سيتم استخدام data/players.json محلياً.");
        return;
    }

    await db.query(`
        CREATE TABLE IF NOT EXISTS player_profiles (
            account_id TEXT PRIMARY KEY,
            email TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL DEFAULT '',
            level INTEGER NOT NULL DEFAULT 1,
            xp INTEGER NOT NULL DEFAULT 0,
            daily_key TEXT NOT NULL DEFAULT '',
            weekly_key TEXT NOT NULL DEFAULT '',
            daily JSONB NOT NULL DEFAULT '{}'::jsonb,
            weekly JSONB NOT NULL DEFAULT '{}'::jsonb,
            total_play_minutes INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    const result = await db.query(`
        SELECT account_id, email, name, level, xp, daily_key, weekly_key, daily, weekly, total_play_minutes
        FROM player_profiles
    `);

    playerProfiles = {};
    for (const row of result.rows) {
        playerProfiles[row.account_id] = {
            accountId: row.account_id,
            email: row.email || '',
            name: row.name || '',
            level: Number(row.level || 1),
            xp: Number(row.xp || 0),
            dailyKey: row.daily_key || dayKey(),
            weeklyKey: row.weekly_key || weekKey(),
            daily: row.daily || {},
            weekly: row.weekly || {},
            totalPlayMinutes: Number(row.total_play_minutes || 0)
        };
    }

    // One-time migration from the old JSON file when the DB is still empty.
    if (result.rowCount === 0) {
        const legacy = loadFileProfiles();
        const entries = Object.values(legacy);
        for (const p of entries) {
            if (!p?.accountId) continue;
            await upsertProfile(p);
            playerProfiles[p.accountId] = p;
        }
        if (entries.length) console.log(`✅ تم ترحيل ${entries.length} لاعب من players.json إلى PostgreSQL.`);
    }

    storageReady = true;
    console.log("✅ PostgreSQL storage connected.");
}

async function upsertProfile(p) {
    if (!db || !p?.accountId) return;
    await db.query(`
        INSERT INTO player_profiles (account_id, email, name, level, xp, daily_key, weekly_key, daily, weekly, total_play_minutes, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            email=EXCLUDED.email,
            name=EXCLUDED.name,
            level=EXCLUDED.level,
            xp=EXCLUDED.xp,
            daily_key=EXCLUDED.daily_key,
            weekly_key=EXCLUDED.weekly_key,
            daily=EXCLUDED.daily,
            weekly=EXCLUDED.weekly,
            total_play_minutes=EXCLUDED.total_play_minutes,
            updated_at=NOW()
    `, [
        p.accountId, p.email || '', p.name || '', Number(p.level || 1), Number(p.xp || 0),
        p.dailyKey || dayKey(), p.weeklyKey || weekKey(), JSON.stringify(p.daily || {}), JSON.stringify(p.weekly || {}),
        Number(p.totalPlayMinutes || 0)
    ]);
}

async function savePlayerProfilesNow(){
    if (db) {
        if (!storageReady) return;
        try {
            for (const p of Object.values(playerProfiles)) await upsertProfile(p);
        } catch (e) {
            console.error("تعذر حفظ بيانات اللاعبين في PostgreSQL", e);
        }
        return;
    }
    try {
        fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playerProfiles, null, 2));
    } catch(e){
        console.error("تعذر حفظ بيانات اللاعبين", e);
    }
}

function savePlayerProfiles(){
    clearTimeout(profileSaveTimer);
    profileSaveTimer = setTimeout(() => {
        profileSaveTimer = null;
        void savePlayerProfilesNow();
    }, 500);
}

async function shutdown(){
    try { await savePlayerProfilesNow(); } catch (_) {}
    if (db) { try { await db.end(); } catch (_) {} }
}
process.on("SIGINT", async () => { await shutdown(); process.exit(0); });
process.on("SIGTERM", async () => { await shutdown(); process.exit(0); });
const DAILY_CHALLENGES = [
  {id:"daily_time",title:"العب لمدة 30 دقيقة",description:"اجمع 30 دقيقة من وقت اللعب خلال اليوم.",target:30,reward:100},
  {id:"daily_rounds",title:"أكمل 3 جولات",description:"شارك في ثلاث جولات مكتملة حتى النهاية.",target:3,reward:150},
  {id:"daily_hidden4",title:"لا تنكشف في جولة فيها أكثر من 4 لاعبين",description:"أكمل جولة وأنت مخفي بينما عدد المشاركين أكثر من أربعة.",target:1,reward:200},
  {id:"daily_guesses",title:"خمّن هوية لاعب بشكل صحيح 5 مرات",description:"طابق خمسة أسماء مستعارة مع الأسماء الحقيقية الصحيحة أثناء التصويت.",target:5,reward:250}
];
const WEEKLY_CHALLENGES = [
  {id:"weekly_time",title:"العب لمدة 3 ساعات",description:"اجمع 180 دقيقة من اللعب خلال الأسبوع.",target:180,reward:500},
  {id:"weekly_rounds",title:"أكمل 20 جولة",description:"شارك في عشرين جولة مكتملة خلال الأسبوع.",target:20,reward:750},
  {id:"weekly_hidden",title:"لا تنكشف 10 مرات",description:"نجح في البقاء مخفياً في عشر جولات مختلفة.",target:10,reward:1000},
  {id:"weekly_guesses",title:"خمّن 25 هوية بشكل صحيح",description:"احصل على 25 تخمين هوية صحيح خلال الأسبوع.",target:25,reward:1200}
];
function riyadhParts(){
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
        .formatToParts(new Date());
    return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
}
function dayKey(){const p=riyadhParts(); return `${p.year}-${p.month}-${p.day}`;}
function weekKey(){
    const p=riyadhParts();
    const d = new Date(`${p.year}-${p.month}-${p.day}T12:00:00+03:00`);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0,10);
}
function ensureProfile(id,email="",name=""){
    id = normalizeAccountId(id);
    if(!id)return null;
    let p=playerProfiles[id];
    if(!p)p=playerProfiles[id]={accountId:id,email:cleanText(email,180).toLowerCase(),name:cleanText(name,80),level:1,xp:0,dailyKey:dayKey(),weeklyKey:weekKey(),daily:{},weekly:{},totalPlayMinutes:0};
    if(p.dailyKey!==dayKey()){p.dailyKey=dayKey();p.daily={};}
    if(p.weeklyKey!==weekKey()){p.weeklyKey=weekKey();p.weekly={};}
    p.email=cleanText(email,180).toLowerCase()||p.email||'';
    p.name=cleanText(name,80)||p.name||'';
    p.totalPlayMinutes=Number(p.totalPlayMinutes||0);
    return p
}
function challengeList(p, defs, bucket){return defs.map(d=>({id:d.id,title:d.title,target:d.target,reward:d.reward,progress:Number(p[bucket][d.id]||0),completed:Number(p[bucket][d.id]||0)>=d.target}))}
function xpNeededForLevel(level){
    // المستوى 1 يحتاج 100 XP للانتقال للمستوى 2،
    // ثم يزيد المطلوب 100 XP كل مستوى حتى 800 XP، وبعدها يثبت.
    return Math.min(800, Math.max(100, Number(level || 1) * 100));
}
function normalizeProfileXP(p){
    p.level = Math.max(1, Number(p.level || 1));
    p.xp = Math.max(0, Number(p.xp || 0));
    let changed = false;
    while (p.xp >= xpNeededForLevel(p.level)) {
        p.xp -= xpNeededForLevel(p.level);
        p.level += 1;
        changed = true;
    }
    return changed;
}
function publicProgress(p){
    normalizeProfileXP(p);
    return {level:p.level,xp:p.xp,nextLevelXP:xpNeededForLevel(p.level),daily:challengeList(p,DAILY_CHALLENGES,'daily'),weekly:challengeList(p,WEEKLY_CHALLENGES,'weekly')};
}
function addXP(id, amount){
    const p=ensureProfile(id);
    if(!p)return;
    p.xp+=Math.max(0,Number(amount)||0);
    normalizeProfileXP(p);
    savePlayerProfiles();
    return p
}
function addChallengeProgress(id, key, amount=1){
    const p=ensureProfile(id);
    if(!p)return;
    if(key === 'time') p.totalPlayMinutes += Math.max(0, Number(amount) || 0);
    for(const [bucket,defs] of [["daily",DAILY_CHALLENGES],["weekly",WEEKLY_CHALLENGES]]){
        const d=defs.find(x=>x.id===key || (key.startsWith('time')&&x.id===bucket+'_time') || (key.startsWith('rounds')&&x.id===bucket+'_rounds') || (key.startsWith('hidden4')&&x.id===bucket+'_hidden4') || (key==='hidden'&&x.id===bucket+'_hidden') || (key.startsWith('guesses')&&x.id===bucket+'_guesses'));
        if(!d)continue;
        const old=Number(p[bucket][d.id]||0), next=Math.min(d.target,old+Math.max(0, Number(amount)||0));
        p[bucket][d.id]=next;
        if(old<d.target&&next>=d.target)addXP(id,d.reward);
    }
    savePlayerProfiles();
    return p
}
function progressForPlayer(id){const p=ensureProfile(id); if(!p)return null; return publicProgress(p)}

// --------- Basic anti-spam / anti-abuse guards ---------
const SOCKET_EVENT_LIMITS = {
    createRoom: [3, 15000],
    joinRoom: [6, 15000],
    reconnectRoom: [8, 15000],
    startGame: [4, 15000],
    leaveRoom: [6, 15000],
    kickPlayer: [10, 15000],
    sendMessage: [6, 5000],
    sendSpectatorMessage: [6, 5000],
    submitVotes: [4, 10000],
    submitFinalGuess: [4, 10000],
    registerAccount: [5, 10000],
    getProgress: [10, 10000],
    updateLobbyProfile: [5, 10000],
    requestReturnToLobby: [3, 10000]
};

function allowSocketEvent(socket, eventName) {
    const [maxCount, windowMs] = SOCKET_EVENT_LIMITS[eventName] || [20, 10000];
    const now = Date.now();
    socket.data.eventHits ||= {};
    const hits = socket.data.eventHits[eventName] || [];
    const recent = hits.filter(ts => now - ts < windowMs);
    if (recent.length >= maxCount) {
        socket.data.eventHits[eventName] = recent;
        return false;
    }
    recent.push(now);
    socket.data.eventHits[eventName] = recent;
    return true;
}

function cleanText(value, max = 40) {
    return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

function cleanAvatar(value) {
    const avatar = String(value ?? "");
    if (!avatar) return "#ef4444";
    if (/^#[0-9a-f]{3,8}$/i.test(avatar)) return avatar;
    if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(avatar) && avatar.length <= 350000) return avatar;
    if (/^https:\/\/[^\s]{1,500}$/i.test(avatar)) return avatar.slice(0, 600);
    return "#ef4444";
}

function normalizeAccountId(value) {
    return cleanText(value, 180).toLowerCase();
}

const DEFAULT_CHAT_DURATION = 240;
const DEFAULT_VOTE_DURATION = 90;
const ELIMINATION_SUSPENSE_SECONDS = 5;
const NEXT_PHASE_DELAY_SECONDS = 10;
const RECONNECT_GRACE_MS = 30000;

const httpHits = new Map();
function httpRateLimit(limit = 40, windowMs = 60000) {
    return (req, res, next) => {
        const key = String(req.ip || req.socket.remoteAddress || "unknown");
        const now = Date.now();
        const recent = (httpHits.get(key) || []).filter(ts => now - ts < windowMs);
        if (recent.length >= limit) return res.status(429).json({ error: "Too many requests" });
        recent.push(now);
        httpHits.set(key, recent);
        next();
    };
}

app.get("/google-client-config", httpRateLimit(30, 60000), (req, res) => {
    res.json({ clientId: process.env.GOOGLE_CLIENT_ID || "" });
});

function generateRoomCode() {
    let code;

    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);

    return code;
}

io.on("connection", socket => {
    if (!storageReady) { socket.disconnect(true); return; }

    socket.on("registerAccount", data => {
        if (!allowSocketEvent(socket, "registerAccount")) return;
        const id = normalizeAccountId(data?.accountId || data?.email);
        const p=ensureProfile(id, data?.email, data?.name);
        if(p){ savePlayerProfiles(); socket.data.accountId=id; socket.emit("profileProgress", publicProgress(p)); }
    });
    socket.on("getProgress", data => {
        if (!allowSocketEvent(socket, "getProgress")) return;
        const id = normalizeAccountId(data?.accountId || data?.email);
        const p=ensureProfile(id, data?.email);
        if(p) socket.emit("profileProgress", publicProgress(p));
    });

    socket.on("createRoom", data => {
        if (!allowSocketEvent(socket, "createRoom")) return socket.emit("errorMsg", "⏳ تم إيقاف الطلبات السريعة مؤقتاً. حاول بعد لحظات.");
        const realName = cleanText(data?.realName, 20);
        const nickName = cleanText(data?.nickName, 20);
        const avatar = cleanAvatar(data?.avatar);
        const playerKey = cleanText(data?.playerKey, 120);
        const accountId = normalizeAccountId(data?.accountId);
        const email = cleanText(data?.email, 180).toLowerCase();
        if (!realName || !nickName || !playerKey) return socket.emit("errorMsg", "أكمل بيانات اللاعب أولاً.");
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            host: socket.id,
            status: "LOBBY",
            selectedChatDuration: DEFAULT_CHAT_DURATION,
            selectedVoteDuration: DEFAULT_VOTE_DURATION,
            chatDuration: DEFAULT_CHAT_DURATION,
            voteDuration: DEFAULT_VOTE_DURATION,
            gameNumber: 0,

            players: [
                {
                    id: socket.id,
                    playerKey,
                    accountId: accountId || email || playerKey,
                    email: email || "",
                    realName,
                    nickName,
                    avatar,
                    isAlive: true,
                    votes: {},
                    finalGuess: null,
                    warnings: 0,
                    score: 0,
                    connected: true,
                    disconnectTimer: null
                }
            ],

            timer: null,
            timerSeconds: 0,
            phase: null,
            finalResolving: false
        };

        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit("roomCreated", {
            roomCode,
            settings: {
                chatDuration: DEFAULT_CHAT_DURATION,
                voteDuration: DEFAULT_VOTE_DURATION
            }
        });

        broadcastLobby(roomCode);
    });

    socket.on("joinRoom", data => {
        if (!allowSocketEvent(socket, "joinRoom")) return socket.emit("errorMsg", "⏳ تم إيقاف الطلبات السريعة مؤقتاً. حاول بعد لحظات.");
        const roomCode = cleanText(data?.roomCode, 4);
        const realName = cleanText(data?.realName, 20);
        const nickName = cleanText(data?.nickName, 20);
        const avatar = cleanAvatar(data?.avatar);
        const playerKey = cleanText(data?.playerKey, 120);
        const accountId = normalizeAccountId(data?.accountId);
        const email = cleanText(data?.email, 180).toLowerCase();
        const room = rooms[roomCode];

        if (!room) {
            return socket.emit("errorMsg", "الغرفة غير موجودة.");
        }

        if (room.status !== "LOBBY") {
            return socket.emit("errorMsg", "اللعبة بدأت بالفعل.");
        }

        if (room.players.some(p => p.nickName === nickName && p.playerKey !== playerKey)) {
            return socket.emit("errorMsg", "الاسم المستعار مستخدم.");
        }

        if (room.players.some(p => p.realName === realName && p.playerKey !== playerKey)) {
            return socket.emit("errorMsg", "الاسم الحقيقي مستخدم.");
        }

        if (room.players.some(p => p.playerKey === playerKey)) {
            return socket.emit("errorMsg", "هذا اللاعب موجود بالفعل في الغرفة.");
        }

        if (room.players.filter(p => p.connected !== false).length >= 8) {
            return socket.emit("errorMsg", "الغرفة ممتلئة. الحد الأقصى 8 لاعبين.");
        }

        room.players.push({
            id: socket.id,
            playerKey,
            accountId: accountId || email || playerKey,
            email: email || "",
            realName,
            nickName,
            avatar,
            isAlive: true,
            votes: {},
            finalGuess: null,
            warnings: 0,
            score: 0,
            connected: true,
            disconnectTimer: null
        });

        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit("joinedSuccess", {
            roomCode,
            isHost: room.host === socket.id,
            settings: {
                chatDuration: room.chatDuration,
                voteDuration: room.voteDuration
            }
        });

        broadcastLobby(roomCode);
    });

    // إعادة ربط اللاعب بعد تحديث الصفحة أثناء اللوبي.
    socket.on("reconnectRoom", data => {
        if (!allowSocketEvent(socket, "reconnectRoom")) return socket.emit("reconnectFailed", "⏳ كثرة محاولات إعادة الاتصال. حاول بعد لحظات.");
        const roomCode = cleanText(data?.roomCode, 4);
        const playerKey = cleanText(data?.playerKey, 120);
        const room = rooms[roomCode];

        if (!room || room.status !== "LOBBY") {
            return socket.emit("reconnectFailed", "الغرفة لم تعد متاحة.");
        }

        const player = room.players.find(p => p.playerKey === playerKey);

        if (!player) {
            return socket.emit("reconnectFailed", "لم يتم العثور على لاعبك في الغرفة.");
        }

        if (player.disconnectTimer) {
            clearTimeout(player.disconnectTimer);
            player.disconnectTimer = null;
        }

        const wasHost = room.host === player.id;
        player.id = socket.id;
        player.connected = true;
        if (wasHost) room.host = socket.id;

        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit("reconnectedToRoom", {
            roomCode,
            isHost: room.host === socket.id,
            realName: player.realName,
            nickName: player.nickName,
            avatar: player.avatar,
            settings: {
                chatDuration: room.chatDuration,
                voteDuration: room.voteDuration
            }
        });

        broadcastLobby(roomCode);
    });

    // خروج يدوي من اللوبي إلى الصفحة الرئيسية.
    socket.on("leaveRoom", data => {
        if (!allowSocketEvent(socket, "leaveRoom")) return;
        const roomCode = cleanText(data?.roomCode, 4);
        const playerKey = cleanText(data?.playerKey, 120);
        const room = rooms[roomCode];
        if (!room || room.status !== "LOBBY") return;

        const index = room.players.findIndex(p => p.playerKey === playerKey);
        if (index === -1) return;

        const wasHost = room.host === room.players[index].id;
        const player = room.players[index];
        if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

        room.players.splice(index, 1);
        socket.leave(roomCode);
        socket.roomCode = null;

        if (room.players.length === 0) {
            clearInterval(room.timer);
            delete rooms[roomCode];
            return;
        }

        if (wasHost) {
            const newHost = room.players.find(p => p.connected !== false) || room.players[0];
            room.host = newHost.id;
            io.to(newHost.id).emit("errorMsg", "👑 أصبحت أنت صاحب الغرفة.");
        }

        broadcastLobby(roomCode);
    });

    socket.on("kickPlayer", data => {
        if (!allowSocketEvent(socket, "kickPlayer")) return;
        const roomCode = cleanText(data?.roomCode, 4);
        const targetPlayerId = cleanText(data?.targetPlayerId, 120);
        const room = rooms[roomCode];

        if (!room || room.status !== "LOBBY") return;
        if (room.host !== socket.id) return;
        if (!targetPlayerId || targetPlayerId === socket.id) return;

        const index = room.players.findIndex(p => p.id === targetPlayerId);
        if (index === -1) return;

        const target = room.players[index];
        if (target.disconnectTimer) clearTimeout(target.disconnectTimer);

        room.players.splice(index, 1);

        const targetSocket = io.sockets.sockets.get(target.id);
        if (targetSocket) {
            targetSocket.leave(roomCode);
            targetSocket.roomCode = null;
            targetSocket.emit("kickedFromRoom", {
                message: "⛔ تم طردك من اللوبي بواسطة صاحب الغرفة."
            });
        }

        if (room.players.length === 0) {
            clearInterval(room.timer);
            delete rooms[roomCode];
            return;
        }

        broadcastLobby(roomCode);
    });

    socket.on("updateLobbyProfile", data => {
        if (!allowSocketEvent(socket, "updateLobbyProfile")) return socket.emit("errorMsg", "⏳ كثرة التعديلات. حاول بعد لحظات.");
        const roomCode = cleanText(data?.roomCode, 4);
        const nickName = cleanText(data?.nickName, 20);
        const avatar = cleanAvatar(data?.avatar);
        const room = rooms[roomCode];
        if (!room || room.status !== "LOBBY") return socket.emit("errorMsg", "يمكن تعديل الاسم والصورة من اللوبي فقط.");
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return socket.emit("errorMsg", "لم يتم العثور على لاعبك في الغرفة.");
        if (!nickName) return socket.emit("errorMsg", "اكتب اسماً مستعاراً.");
        if (room.players.some(p => p.id !== player.id && p.nickName === nickName && p.connected !== false)) {
            return socket.emit("errorMsg", "الاسم المستعار مستخدم من لاعب آخر.");
        }
        player.nickName = nickName;
        player.avatar = avatar;
        player.updatedAt = Date.now();
        savePlayerProfiles();
        socket.emit("lobbyProfileUpdated", { nickName: player.nickName, avatar: player.avatar });
        broadcastLobby(roomCode);
    });

    socket.on("startGame", data => {
        if (!allowSocketEvent(socket, "startGame")) return socket.emit("errorMsg", "⏳ كثرة الطلبات. حاول بعد لحظات.");
        const roomCode = cleanText(typeof data === "object" ? data.roomCode : data, 4);

        const room = rooms[roomCode];

        if (!room || room.host !== socket.id) return;

        const connectedPlayers = room.players.filter(p => p.connected !== false);
        if (connectedPlayers.length < 4) {
            return socket.emit(
                "errorMsg",
                "يحتاج اللعب إلى 4 لاعبين على الأقل."
            );
        }

        const requestedChatDuration =
            parseInt(data.chatDuration, 10) || room.selectedChatDuration || DEFAULT_CHAT_DURATION;
        const requestedVoteDuration =
            parseInt(data.voteDuration, 10) || room.selectedVoteDuration || DEFAULT_VOTE_DURATION;

        const selectionChanged =
            requestedChatDuration !== room.selectedChatDuration ||
            requestedVoteDuration !== room.selectedVoteDuration;

        if (room.gameNumber === 0 || selectionChanged) {
            room.selectedChatDuration = requestedChatDuration;
            room.selectedVoteDuration = requestedVoteDuration;
            room.gameNumber = 1;
        } else {
            room.gameNumber += 1;
        }

        const reductionFactor = Math.pow(0.93, Math.max(0, room.gameNumber - 1));
        room.chatDuration = Math.max(1, Math.floor(room.selectedChatDuration * reductionFactor));
        room.voteDuration = Math.max(1, Math.floor(room.selectedVoteDuration * reductionFactor));

        room.status = "PLAYING";
        room.gameStartedAt = Date.now();
        room.players.forEach(p => { p.gameStartedAt = Date.now(); ensureProfile(p.accountId || p.email || p.playerKey, p.email, p.realName); });
        savePlayerProfiles();
        startChatPhase(roomCode);
    });

    socket.on("sendMessage", data => {
        if (!allowSocketEvent(socket, "sendMessage")) return socket.emit("errorMsg", "⏳ تم إيقاف الرسائل السريعة مؤقتاً.");
        const roomCode = cleanText(data?.roomCode, 4);
        const message = cleanText(data?.message, 300);
        const room = rooms[roomCode];

        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);

        if (
            player &&
            player.isAlive &&
            room.phase === "CHAT" &&
            typeof message === "string" &&
            message.length > 0 &&
            message.length <= 300
        ) {
            io.to(roomCode).emit("newMessage", {
                playerId: player.id,
                nickName: player.nickName,
                realName: player.realName,
                avatar: player.avatar,
                message: message.trim()
            });
        }
    });

    socket.on("sendSpectatorMessage", data => {
        if (!allowSocketEvent(socket, "sendSpectatorMessage")) return socket.emit("errorMsg", "⏳ تم إيقاف الرسائل السريعة مؤقتاً.");
        const roomCode = cleanText(data?.roomCode, 4);
        const message = cleanText(data?.message, 300);
        const room = rooms[roomCode];

        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);

        if (
            player &&
            !player.isAlive &&
            typeof message === "string" &&
            message.trim()
        ) {
            room.players
                .filter(p => !p.isAlive)
                .forEach(p => {
                    io.to(p.id).emit("spectatorMessage", {
                        playerId: player.id,
                        nickName: player.nickName,
                        realName: player.realName,
                        avatar: player.avatar,
                        message: message.trim()
                    });
                });
        }
    });

    socket.on("submitVotes", data => {
        if (!allowSocketEvent(socket, "submitVotes")) return socket.emit("errorMsg", "⏳ تم إيقاف إرسال التصويت المتكرر.");
        const roomCode = cleanText(data?.roomCode, 4);
        const guesses = (data?.guesses && typeof data.guesses === "object") ? data.guesses : {};
        const room = rooms[roomCode];

        if (!room || room.phase !== "VOTE") return;

        const player = room.players.find(p => p.id === socket.id);

        if (!player || !player.isAlive) return;

        const safeGuesses = {};
        for (const [nick, real] of Object.entries(guesses).slice(0, 8)) {
            const safeNick = cleanText(nick, 20);
            const safeReal = cleanText(real, 20);
            if (safeNick && safeReal) safeGuesses[safeNick] = safeReal;
        }
        player.votes = safeGuesses;
        socket.emit("voteSubmitted");
        socket.emit("audioEvent", { name: "lock" });

        const alivePlayers = room.players.filter(p => p.isAlive);
        if (
            alivePlayers.length > 0 &&
            alivePlayers.every(p => Object.keys(p.votes).length > 0)
        ) {
            clearInterval(room.timer);
            processRoundResults(roomCode);
        }
    });

    socket.on("submitFinalGuess", data => {
        if (!allowSocketEvent(socket, "submitFinalGuess")) return socket.emit("errorMsg", "⏳ تم إيقاف الإرسال المتكرر.");
        const roomCode = cleanText(data?.roomCode, 4);
        const guessedRealName = cleanText(data?.guessedRealName, 20);
        const room = rooms[roomCode];

        if (!room || room.status !== "FINAL") return;

        const player = room.players.find(p => p.id === socket.id);

        if (!player || !player.isAlive) return;

        player.finalGuess = guessedRealName;
        socket.emit("finalGuessSubmitted");
        socket.emit("audioEvent", { name: "lock" });

        const alivePlayers = room.players.filter(p => p.isAlive);

        if (alivePlayers.every(p => p.finalGuess !== null)) {
            processFinalGuessResults(roomCode);
        }
    });

    socket.on("requestReturnToLobby", data => {
        if (!allowSocketEvent(socket, "requestReturnToLobby")) return;
        const roomCode = cleanText(data?.roomCode, 4);
        const room = rooms[roomCode];
        if (!room || room.status !== "ENDED") return;
        if (!room.players.some(p => p.id === socket.id && p.connected !== false)) return;
        resetRoomToLobby(roomCode);
    });

    socket.on("disconnect", () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        const room = rooms[roomCode];
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // أثناء اللوبي ننتظر قليلًا قبل حذف اللاعب، حتى يتمكن تحديث الصفحة
        // من إعادة ربطه بنفس مكانه في الغرفة.
        if (room.status === "LOBBY") {
            player.connected = false;

            if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

            player.disconnectTimer = setTimeout(() => {
                const currentRoom = rooms[roomCode];
                if (!currentRoom) return;

                const currentIndex = currentRoom.players.findIndex(
                    p => p.playerKey === player.playerKey
                );

                if (currentIndex === -1) return;

                const currentPlayer = currentRoom.players[currentIndex];
                if (currentPlayer.connected !== false) return;

                const wasHost = currentRoom.host === currentPlayer.id;
                currentRoom.players.splice(currentIndex, 1);

                if (currentRoom.players.length === 0) {
                    delete rooms[roomCode];
                    return;
                }

                if (wasHost) {
                    const newHost = currentRoom.players.find(p => p.connected !== false) || currentRoom.players[0];
                    currentRoom.host = newHost.id;
                    io.to(newHost.id).emit("errorMsg", "👑 أصبحت أنت صاحب الغرفة.");
                }

                broadcastLobby(roomCode);
            }, RECONNECT_GRACE_MS);

            broadcastLobby(roomCode);
            return;
        }

        // بعد بدء اللعبة لا نحذف اللاعب من سجل الجولة.
        // نخليه موجوداً (connected=false) حتى تبقى هويته الحقيقية
        // متاحة في قوائم التخمين حتى لو أغلق الموقع أو انقطع اتصاله.
        player.connected = false;
        player.disconnectedAt = Date.now();
        // لا يستطيع اللاعب المنقطع التصويت أو تعطيل الجولة، لكن سجله وهويته يبقيان موجودين.
        player.isAlive = false;
        player.id = `offline:${player.playerKey}`;
        player.disconnectTimer = null;
        savePlayerProfiles();
    });
});

function broadcastLobby(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.status !== "LOBBY") return;

    const shuffledPlayers = [...room.players]
        .filter(p => p.connected !== false)
        .sort(() => Math.random() - 0.5);

    io.to(roomCode).emit("lobbyUpdated", {
        players: shuffledPlayers.map(p => {
            const profile = progressForPlayer(p.accountId || p.email || p.playerKey);
            return {
                id: p.id,
                realName: p.realName,
                level: profile?.level || 1,
                isHost: room.host === p.id
            };
        }),
        playerCount: shuffledPlayers.length,
        hostId: room.host
    });
}

function playSound(roomCode, name) {
    if (rooms[roomCode]) io.to(roomCode).emit("audioEvent", { name });
}

function startChatPhase(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.status = "PLAYING";
    room.phase = "CHAT";

    room.players
        .filter(p => p.isAlive)
        .forEach(p => {
            p.votes = {};
        });

    const chatMembers = room.players
        .filter(p => p.isAlive)
        .sort(() => Math.random() - 0.5)
        .map(p => ({
            id: p.id,
            nickName: p.nickName,
            avatar: p.avatar
        }));

    io.to(roomCode).emit("phaseChanged", {
        phase: "CHAT",
        chatMembers
    });

    io.to(roomCode).emit("chatMembersUpdated", {
        members: chatMembers
    });
    playSound(roomCode, "phase");

    runTimer(roomCode, room.chatDuration, () => {
        startVotePhase(roomCode);
    });
}

function startVotePhase(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.phase = "VOTE";

    const alivePlayers = room.players.filter(p => p.isAlive);

    const shuffledPlayers = [...alivePlayers]
        .sort(() => Math.random() - 0.5);

    io.to(roomCode).emit("phaseChanged", {
        phase: "VOTE",
        // من نصوت عليهم = الأحياء فقط.
        players: shuffledPlayers.map(p => ({
            nickName: p.nickName,
            realName: p.realName,
            avatar: p.avatar
        })),
        aliveNickNames: shuffledPlayers.map(p => p.nickName),
        // خيارات الاسم الحقيقي = جميع لاعبي الجولة حتى من خرج أو استبعد.
        identityOptions: room.players.map(p => ({
            realName: p.realName,
            nickName: p.nickName
        })),
        realNames: room.players.map(p => p.realName),
        avatars: room.players.map(p => p.avatar)
    });

    playSound(roomCode, "vote");

    runTimer(roomCode, room.voteDuration, () => {
        processRoundResults(roomCode);
    });
}

function runTimer(roomCode, seconds, callback) {
    const room = rooms[roomCode];
    if (!room) return;

    clearInterval(room.timer);

    room.timerSeconds = seconds;

    io.to(roomCode).emit("timerUpdate", room.timerSeconds);

    room.timer = setInterval(() => {
        room.timerSeconds--;

        io.to(roomCode).emit("timerUpdate", room.timerSeconds);

        if (room.timerSeconds <= 0) {
            clearInterval(room.timer);
            room.timer = null;
            callback();
        }
    }, 1000);
}

function processRoundResults(roomCode) {
    const room = rooms[roomCode];

    if (!room || room.phase !== "VOTE") return;

    // يمنع معالجة نفس الجولة مرتين.
    room.phase = "RESULT";
    clearInterval(room.timer);
    room.timer = null;

    const alivePlayers = room.players.filter(p => p.isAlive);
    const roundParticipants = [...alivePlayers];
    const roundScores = {};
    room.players.forEach(p => { if (p.gameStartedAt) { const minutes = Math.max(0, (Date.now()-p.gameStartedAt)/60000); p.sessionMinutes = minutes; } });

    alivePlayers.forEach(p => {
        roundScores[p.id] = 0;
    });

    const eliminatedPlayers = [];

    // AFK / عدم التصويت
    alivePlayers.forEach(p => {
        if (Object.keys(p.votes).length === 0) {
            p.warnings = (p.warnings || 0) + 1;

            if (p.warnings === 1) {
                io.to(p.id).emit(
                    "errorMsg",
                    "⚠️ تنبيه: لم تقم بالتصويت! المرة القادمة سيتم استبعادك."
                );
                io.to(p.id).emit("audioEvent", { name: "warning" });
            } else {
                p.isAlive = false;
                eliminatedPlayers.push(p);

                // لا نرسل spectatorMode الآن.
                // سيصل بعد لحظة كشف المستبعد حتى يعيش اللاعب التشويق مع الجميع.
            }
        } else {
            p.warnings = 0;
        }
    });

    // حساب النقاط
    alivePlayers.forEach(voter => {
        if (Object.keys(voter.votes).length > 0) {
            for (const [targetNick, guessedReal] of Object.entries(voter.votes)) {
                const actualPlayer = room.players.find(
                    p => p.nickName === targetNick
                );

                if (
                    actualPlayer &&
                    actualPlayer.realName === guessedReal
                ) {
                    roundScores[voter.id] += 1;
                    voter.score += 1;
                }
            }
        }
    });

    room.players.forEach(p => {
        const id=p.accountId || p.email || p.playerKey;
        if(!id) return;
        addChallengeProgress(id,'rounds',1);
        const correct=roundScores[p.id]||0;
        if(correct>0) addChallengeProgress(id,'guesses',correct);
    });

    let currentlyAlive = room.players.filter(p => p.isAlive);

    // الاستبعاد الطبيعي
    if (currentlyAlive.length > 2) {
        let minScore = Infinity;
        let candidates = [];

        for (const p of currentlyAlive) {
            const score = roundScores[p.id] || 0;

            if (score < minScore) {
                minScore = score;
                candidates = [p];
            } else if (score === minScore) {
                candidates.push(p);
            }
        }

        const normalEliminated =
            candidates[Math.floor(Math.random() * candidates.length)];

        normalEliminated.isAlive = false;
        eliminatedPlayers.push(normalEliminated);
    }

    const eliminatedNames = eliminatedPlayers.map(p => p.nickName);
    roundParticipants.forEach(p => {
        if (!eliminatedPlayers.includes(p)) {
            const id = p.accountId || p.email || p.playerKey;
            addChallengeProgress(id, 'hidden', 1);
            if (room.players.length > 4) addChallengeProgress(id, 'hidden4', 1);
        }
    });
    room.players.forEach(p => { const id=p.accountId || p.email || p.playerKey; if(id && p.gameStartedAt){ const minutes=Math.floor((Date.now()-p.gameStartedAt)/60000); if(minutes>0){ addChallengeProgress(id,'time',minutes); p.gameStartedAt=Date.now(); } } });

    // أولاً: تشويق بدون كشف الاسم
    io.to(roomCode).emit("eliminationPending", {
        seconds: ELIMINATION_SUSPENSE_SECONDS
    });
    playSound(roomCode, "suspense");

    setTimeout(() => {
        const currentRoom = rooms[roomCode];
        if (!currentRoom) return;

        // ثانياً: كشف الاسم بعد انتهاء العد التنازلي
        playSound(roomCode, eliminatedNames.length > 0 ? "elimination" : "reveal");
        io.to(roomCode).emit("roundResult", {
            eliminatedNick:
                eliminatedNames.length > 0
                    ? eliminatedNames.join(" و ")
                    : "لا أحد",
            nextPhaseIn: NEXT_PHASE_DELAY_SECONDS
        });

        // إعطاء المستبعدين وضع المشاهد بعد الكشف مباشرة.
        eliminatedPlayers.forEach(p => {
            io.to(p.id).emit("spectatorMode", {
                nickName: p.nickName,
                realName: p.realName
            });
        });

        // ثالثاً: الانتقال للجولة التالية
        setTimeout(() => {
            const latestRoom = rooms[roomCode];
            if (!latestRoom) return;

            const remainingAlive =
                latestRoom.players.filter(p => p.isAlive);

            if (remainingAlive.length === 2) {
                startFinalGuess(roomCode);
            } else if (remainingAlive.length < 2) {
                endGame(roomCode, { type: "NORMAL" });
            } else {
                startChatPhase(roomCode);
            }
        }, NEXT_PHASE_DELAY_SECONDS * 1000);

    }, ELIMINATION_SUSPENSE_SECONDS * 1000);
}

function startFinalGuess(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.status = "FINAL";
    room.phase = "FINAL";

    const alivePlayers = room.players.filter(p => p.isAlive);

    alivePlayers.forEach(p => {
        p.finalGuess = null;
    });

    io.to(roomCode).emit("finalGuessStarted", {
        players: alivePlayers.map(p => p.nickName),

    // جميع اللاعبين، الأحياء والمستبعدين
        identityOptions: room.players.map(p => ({
            realName: p.realName,
            nickName: p.nickName,
            avatar: p.avatar
        }))
    });
    playSound(roomCode, "final");
}

function processFinalGuessResults(roomCode) {
    const room = rooms[roomCode];

    if (!room || room.phase !== "FINAL") return;

    const alive = room.players.filter(p => p.isAlive);

    if (alive.length !== 2) return;

    const [p1, p2] = alive;

    // يمنع الضغط/الإرسال أكثر من مرة أثناء مرحلة التشويق.
    if (room.finalResolving) return;
    room.finalResolving = true;
    room.phase = "FINAL_RESULT";

    const p1Correct = p1.finalGuess === p2.realName;
    const p2Correct = p2.finalGuess === p1.realName;

    if (p1Correct) p1.score += 3;
    if (p2Correct) p2.score += 3;

    let resultType = "BOTH_WRONG";
    let winners = [];

    if (p1Correct && p2Correct) {
        resultType = "BOTH_CORRECT";
        winners = [p1.realName, p2.realName];
    } else if (p1Correct) {
        resultType = "ONE_CORRECT";
        winners = [p1.realName];
    } else if (p2Correct) {
        resultType = "ONE_CORRECT";
        winners = [p2.realName];
    }

    // أولاً نعرض شاشة التشويق، وبعدها نكشف النتيجة.
    io.to(roomCode).emit("finalGuessSuspense");
    playSound(roomCode, "suspense");

    setTimeout(() => {
        const currentRoom = rooms[roomCode];
        if (!currentRoom) return;

        playSound(roomCode, resultType === "BOTH_CORRECT" || resultType === "ONE_CORRECT" ? "correct" : "wrong");
        io.to(roomCode).emit("finalGuessReveal", {
            type: resultType,
            correctPlayers: winners,
            players: [
                {
                    nickName: p1.nickName,
                    realName: p1.realName,
                    correct: p1Correct
                },
                {
                    nickName: p2.nickName,
                    realName: p2.realName,
                    correct: p2Correct
                }
            ]
        });

        setTimeout(() => {
            const latestRoom = rooms[roomCode];
            if (!latestRoom) return;

            if (resultType === "BOTH_CORRECT") {
                endGame(roomCode, {
                    type: "BOTH_WIN",
                    winners
                });
                return;
            }

            if (resultType === "ONE_CORRECT") {
                endGame(roomCode, {
                    type: "PLAYER_WIN",
                    winners
                });
                return;
            }

            // الاثنان أخطآ: إعادة التوقع من جديد بعد لحظة التشويق.
            const latestAlive = latestRoom.players.filter(p => p.isAlive);
            latestAlive.forEach(p => p.finalGuess = null);

            latestRoom.finalResolving = false;
            latestRoom.phase = "FINAL";

            io.to(roomCode).emit("finalGuessRetry", {
                message: "❌ كلا التوقعين خطأ! أعيدوا المحاولة."
            });
        }, 3500);
    }, 4000);
}

function endGame(roomCode, resultData) {
    const room = rooms[roomCode];
    if (!room) return;

    room.status = "ENDED";
    room.phase = "ENDED";

    clearInterval(room.timer);
    room.timer = null;

    room.players.forEach(p => { const id=p.accountId || p.email || p.playerKey; if(id && p.gameStartedAt){ const minutes=Math.floor((Date.now()-p.gameStartedAt)/60000); if(minutes>0) addChallengeProgress(id,'time',minutes); p.gameStartedAt=null; } });
    const sortedPlayers = [...room.players].filter(p => p.connected !== false).sort(
        (a, b) => b.score - a.score
    );
    const topScore = sortedPlayers.length ? sortedPlayers[0].score : 0;
    const winnersByScore = sortedPlayers.filter(p => p.score === topScore).map(p => p.nickName);

    playSound(roomCode, "victory");
    io.to(roomCode).emit("gameOver", {
        result: { type: "SCORE", winners: winnersByScore, topScore },
        rankings: sortedPlayers.map((p, index) => ({
            rank: index + 1,
            realName: p.realName,
            nickName: p.nickName,
            avatar: p.avatar,
            score: p.score
        }))
    });
    room.players.forEach(p => { const id=p.accountId || p.email || p.playerKey; const profile=progressForPlayer(id); if(profile && p.connected !== false) io.to(p.id).emit("progressUpdated", profile); });

    // بعد عرض النتائج، يرجع جميع اللاعبين المتصلين إلى نفس اللوبي
    // وتُصفّر حالة الجولة السابقة حتى تبدأ المباراة التالية من الصفر.
    setTimeout(() => resetRoomToLobby(roomCode), 8000);
}

function resetRoomToLobby(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.status !== "ENDED") return;
    clearInterval(room.timer);
    room.timer = null;
    room.status = "LOBBY";
    room.phase = null;
    room.finalResolving = false;
    room.timerSeconds = 0;
    room.chatDuration = room.selectedChatDuration || DEFAULT_CHAT_DURATION;
    room.voteDuration = room.selectedVoteDuration || DEFAULT_VOTE_DURATION;

    const connected = room.players.filter(p => p.connected !== false);
    room.players.forEach(p => {
        p.isAlive = true;
        p.votes = {};
        p.finalGuess = null;
        p.warnings = 0;
        p.score = 0;
        p.gameStartedAt = null;
        p.sessionMinutes = 0;
    });

    if (!connected.length) {
        delete rooms[roomCode];
        return;
    }

    if (!connected.some(p => p.id === room.host)) {
        room.host = connected[0].id;
    }

    io.to(roomCode).emit("returnToLobby", {
        players: connected.map(p => ({ playerKey: p.playerKey, realName: p.realName, nickName: p.nickName, avatar: p.avatar }))
    });
    broadcastLobby(roomCode);
}

const PORT = Number(process.env.PORT) || 3000;
(async () => {
    // لا تجعل فشل PostgreSQL يمنع تشغيل الموقع على Render.
    // إذا فشل الاتصال بقاعدة البيانات، نستخدم players.json كحل احتياطي.
    try {
        await initStorage();
    } catch (error) {
        console.error("⚠️ تعذر الاتصال بـ PostgreSQL، سيتم تشغيل السيرفر باستخدام data/players.json:", error?.message || error);
        try { if (db) await db.end(); } catch (_) {}
        db = null;
        playerProfiles = loadFileProfiles();
        storageReady = true;
    }

    // افتح المنفذ حتى لو تعذر التخزين الخارجي؛ Render يحتاج أن يرى السيرفر يستمع على PORT.
    server.listen(PORT, '0.0.0.0', () => {
        console.log("🎭 مخفي Server v5");
        console.log(`🌐 Server listening on 0.0.0.0:${PORT}`);
        console.log(`💾 Storage: ${db ? "PostgreSQL" : "data/players.json"}`);
    });
})();
