const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 5e6
});

app.use(express.static(path.join(__dirname, "public")));

const rooms = {};

const DEFAULT_CHAT_DURATION = 240;
const DEFAULT_VOTE_DURATION = 90;
const ELIMINATION_SUSPENSE_SECONDS = 5;
const NEXT_PHASE_DELAY_SECONDS = 10;

function generateRoomCode() {
    let code;

    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[code]);

    return code;
}

io.on("connection", socket => {

    socket.on("createRoom", data => {
        const { realName, nickName, avatar } = data;
        const roomCode = generateRoomCode();

        rooms[roomCode] = {
            host: socket.id,
            status: "LOBBY",
            chatDuration: DEFAULT_CHAT_DURATION,
            voteDuration: DEFAULT_VOTE_DURATION,

            players: [
                {
                    id: socket.id,
                    realName,
                    nickName,
                    avatar,
                    isAlive: true,
                    votes: {},
                    finalGuess: null,
                    warnings: 0,
                    score: 0
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

        const room = rooms[roomCode];

        if (room.status === "LOBBY") {
            const shuffledPlayers = [...room.players]
                .sort(() => Math.random() - 0.5);

            io.to(roomCode).emit("lobbyUpdated", {
                players: shuffledPlayers.map(p => ({
                    id: p.id,
                    realName: p.realName
                    })),
                    playerCount: room.players.length
                });
            }
    });

    socket.on("joinRoom", data => {
        const { roomCode, realName, nickName, avatar } = data;
        const room = rooms[roomCode];

        if (!room) {
            return socket.emit("errorMsg", "الغرفة غير موجودة.");
        }

        if (room.status !== "LOBBY") {
            return socket.emit("errorMsg", "اللعبة بدأت بالفعل.");
        }

        if (room.players.some(p => p.nickName === nickName)) {
            return socket.emit("errorMsg", "الاسم المستعار مستخدم.");
        }

        if (room.players.some(p => p.realName === realName)) {
            return socket.emit("errorMsg", "الاسم الحقيقي مستخدم.");
        }

        room.players.push({
            id: socket.id,
            realName,
            nickName,
            avatar,
            isAlive: true,
            votes: {},
            finalGuess: null,
            warnings: 0,
            score: 0
        });

        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit("joinedSuccess", {
            roomCode,
            settings: {
                chatDuration: room.chatDuration,
                voteDuration: room.voteDuration
            }
        });

        const shuffledPlayers = [...room.players]
        .sort(() => Math.random() - 0.5);

        io.to(roomCode).emit("lobbyUpdated", {
        players: shuffledPlayers.map(p => ({
                id: p.id,
                realName: p.realName
            })),
            playerCount: room.players.length
});
    });

    socket.on("startGame", data => {
        const roomCode =
            typeof data === "object" ? data.roomCode : data;

        const room = rooms[roomCode];

        if (!room || room.host !== socket.id) return;

        if (room.players.length < 4) {
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

    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
        clearInterval(room.timer);
        delete rooms[roomCode];
    } else {
        if (room.host === socket.id && room.status === "LOBBY") {
            const newHost = room.players.find(p => p.isAlive);

            if (newHost) {
                room.host = newHost.id;
                io.to(newHost.id).emit(
                    "errorMsg",
                    "👑 أصبحت أنت صاحب الغرفة."
                );
            }
        }

        if (room.status === "LOBBY") {
            const shuffledPlayers = [...room.players]
                .sort(() => Math.random() - 0.5);

            io.to(roomCode).emit("lobbyUpdated", {
                players: shuffledPlayers.map(p => ({
                    id: p.id,
                    realName: p.realName
                })),
                playerCount: room.players.length
            });
        }
    }
});

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

    io.to(roomCode).emit("phaseChanged", {
        phase: "VOTE",
        aliveNickNames: shuffledPlayers.map(p => p.nickName),
        realNames: shuffledPlayers.map(p => p.realName),
        avatars: shuffledPlayers.map(p => p.avatar)
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
    const roundScores = {};

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
}

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log("🎭 Secret Identity Server v3");
    console.log("🌐 http://localhost:3000");
});
