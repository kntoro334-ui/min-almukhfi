const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 5e6
});

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};
const DATA_DIR = path.join(__dirname, "data");
const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
let playerProfiles = {};
try { playerProfiles = JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8")); } catch (_) { playerProfiles = {}; }
function savePlayerProfiles(){ try { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playerProfiles, null, 2)); } catch(e){ console.error("تعذر حفظ بيانات اللاعبين", e); } }
const DAILY_CHALLENGES = [
  {id:"daily_time",title:"العب لمدة 30 دقيقة",target:30,reward:100},
  {id:"daily_rounds",title:"أكمل 3 جولات",target:3,reward:150},
  {id:"daily_hidden4",title:"لا تنكشف في جولة فيها أكثر من 4 لاعبين",target:1,reward:200},
  {id:"daily_guesses",title:"خمّن هوية لاعب بشكل صحيح 5 مرات",target:5,reward:250}
];
const WEEKLY_CHALLENGES = [
  {id:"weekly_time",title:"العب لمدة 3 ساعات",target:180,reward:500},
  {id:"weekly_rounds",title:"أكمل 20 جولة",target:20,reward:750},
  {id:"weekly_hidden",title:"لا تنكشف 10 مرات",target:10,reward:1000},
  {id:"weekly_guesses",title:"خمّن 25 هوية بشكل صحيح",target:25,reward:1200}
];
function dayKey(){return new Date().toISOString().slice(0,10)}
function weekKey(){const d=new Date(); const first=new Date(d); first.setDate(d.getDate()-d.getDay()); return first.toISOString().slice(0,10)}
function ensureProfile(id,email="",name=""){if(!id)return null; let p=playerProfiles[id]; if(!p)p=playerProfiles[id]={accountId:id,email,name,level:1,xp:0,dailyKey:dayKey(),weeklyKey:weekKey(),daily:{},weekly:{},totalPlayMinutes:0}; if(p.dailyKey!==dayKey()){p.dailyKey=dayKey();p.daily={}} if(p.weeklyKey!==weekKey()){p.weeklyKey=weekKey();p.weekly={}} p.email=email||p.email||'';p.name=name||p.name||''; return p}
function challengeList(p, defs, bucket){return defs.map(d=>({id:d.id,title:d.title,target:d.target,reward:d.reward,progress:Number(p[bucket][d.id]||0),completed:Number(p[bucket][d.id]||0)>=d.target}))}
function publicProgress(p){return {level:p.level,xp:p.xp,daily:challengeList(p,DAILY_CHALLENGES,'daily'),weekly:challengeList(p,WEEKLY_CHALLENGES,'weekly')}}
function addXP(id, amount){const p=ensureProfile(id);if(!p)return; p.xp+=Math.max(0,amount); while(p.xp>=1000){p.xp-=1000;p.level++} savePlayerProfiles(); return p}
function addChallengeProgress(id, key, amount=1){const p=ensureProfile(id);if(!p)return; for(const [bucket,defs] of [["daily",DAILY_CHALLENGES],["weekly",WEEKLY_CHALLENGES]]){const d=defs.find(x=>x.id===key || (key.startsWith('time')&&x.id===bucket+'_time') || (key.startsWith('rounds')&&x.id===bucket+'_rounds') || (key.startsWith('hidden4')&&x.id===bucket+'_hidden4') || (key==='hidden'&&x.id===bucket+'_hidden') || (key.startsWith('guesses')&&x.id===bucket+'_guesses'));if(!d)continue;const old=Number(p[bucket][d.id]||0), next=Math.min(d.target,old+amount);p[bucket][d.id]=next;if(old<d.target&&next>=d.target)addXP(id,d.reward)} savePlayerProfiles(); return p}
function progressForPlayer(id){const p=ensureProfile(id); if(!p)return null; return publicProgress(p)}

const DEFAULT_CHAT_DURATION = 240;
const DEFAULT_VOTE_DURATION = 90;
const ELIMINATION_SUSPENSE_SECONDS = 5;
const NEXT_PHASE_DELAY_SECONDS = 10;
const RECONNECT_GRACE_MS = 30000;

app.get("/google-client-config", (req, res) => {
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

    socket.on("registerAccount", data => { const p=ensureProfile(data?.accountId || data?.email, data?.email, data?.name); if(p){ savePlayerProfiles(); socket.emit("profileProgress", publicProgress(p)); } });
    socket.on("getProgress", data => { const p=ensureProfile(data?.accountId || data?.email, data?.email); if(p) socket.emit("profileProgress", publicProgress(p)); });

    socket.on("createRoom", data => {
        const { realName, nickName, avatar, playerKey, accountId, email } = data;
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            host: socket.id,
            status: "LOBBY",
            chatDuration: DEFAULT_CHAT_DURATION,
            voteDuration: DEFAULT_VOTE_DURATION,

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
        const { roomCode, realName, nickName, avatar, playerKey, accountId, email } = data;
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
        const { roomCode, playerKey } = data || {};
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
        const { roomCode, playerKey } = data || {};
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

    socket.on("startGame", data => {
        const roomCode =
            typeof data === "object" ? data.roomCode : data;

        const room = rooms[roomCode];

        if (!room || room.host !== socket.id) return;

        const connectedPlayers = room.players.filter(p => p.connected !== false);
        if (connectedPlayers.length < 4) {
            return socket.emit(
                "errorMsg",
                "يحتاج اللعب إلى 4 لاعبين على الأقل."
            );
        }

        if (data.chatDuration) {
            room.chatDuration =
                parseInt(data.chatDuration, 10) || DEFAULT_CHAT_DURATION;
        }

        if (data.voteDuration) {
            room.voteDuration =
                parseInt(data.voteDuration, 10) || DEFAULT_VOTE_DURATION;
        }

        room.status = "PLAYING";
        room.gameStartedAt = Date.now();
        room.players.forEach(p => { p.gameStartedAt = Date.now(); ensureProfile(p.accountId || p.email || p.playerKey, p.email, p.realName); });
        savePlayerProfiles();
        startChatPhase(roomCode);
    });

    socket.on("sendMessage", data => {
        const { roomCode, message } = data;
        const room = rooms[roomCode];

        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);

        if (
            player &&
            player.isAlive &&
            room.phase === "CHAT" &&
            typeof message === "string" &&
            message.trim()
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
        const { roomCode, message } = data;
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
        const { roomCode, guesses } = data;
        const room = rooms[roomCode];

        if (!room || room.phase !== "VOTE") return;

        const player = room.players.find(p => p.id === socket.id);

        if (!player || !player.isAlive) return;

        player.votes = guesses;
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
        const { roomCode, guessedRealName } = data;
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

        // بعد بدء اللعبة، السلوك القديم يبقى: اللاعب المنقطع يخرج من الغرفة.
        room.players = room.players.filter(p => p.id !== socket.id);

        if (room.players.length === 0) {
            clearInterval(room.timer);
            delete rooms[roomCode];
            return;
        }

        broadcastLobby(roomCode);
    });
});

function broadcastLobby(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.status !== "LOBBY") return;

    const shuffledPlayers = [...room.players]
        .filter(p => p.connected !== false)
        .sort(() => Math.random() - 0.5);

    io.to(roomCode).emit("lobbyUpdated", {
        players: shuffledPlayers.map(p => ({
            id: p.id,
            realName: p.realName,
            nickName: p.nickName,
            avatar: p.avatar
        })),
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

    io.to(roomCode).emit("phaseChanged", {
        phase: "CHAT"
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

    // أهداف التصويت = اللاعبون الأحياء فقط.
    // قائمة الأسماء الحقيقية = جميع لاعبي الجولة، بما فيهم من تم استبعاده،
    // وتبقى ثابتة حتى نهاية اللعبة.
    io.to(roomCode).emit("phaseChanged", {
        phase: "VOTE",
        players: shuffledPlayers.map(p => ({
            nickName: p.nickName,
            realName: p.realName,
            avatar: p.avatar
        })),
        aliveNickNames: shuffledPlayers.map(p => p.nickName),
        realNames: shuffledPlayers.map(p => p.realName),
        avatars: shuffledPlayers.map(p => p.avatar),
        allRealNames: room.players.map(p => p.realName)
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
        realNames: room.players.map(p => p.realName),
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
    const sortedPlayers = [...room.players].sort(
        (a, b) => b.score - a.score
    );

    playSound(roomCode, "victory");
    io.to(roomCode).emit("gameOver", {
        result: resultData,
        rankings: sortedPlayers.map((p, index) => ({
            rank: index + 1,
            realName: p.realName,
            nickName: p.nickName,
            avatar: p.avatar,
            score: p.score
        }))
    });
    room.players.forEach(p => { const id=p.accountId || p.email || p.playerKey; const profile=progressForPlayer(id); if(profile) io.to(p.id).emit("progressUpdated", profile); });
}

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log("🎭 Secret Identity Server v3");
    console.log("🌐 http://localhost:3000");
});
